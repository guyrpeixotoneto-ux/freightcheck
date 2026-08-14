/**
 * As migrations versionadas, aplicadas **uma transação por migration**.
 *
 * This is the only supported way to change the schema. `drizzle-kit push` is
 * deliberately not used: it diffs against live state, which would let a
 * developer's local drift become undocumented production schema — the exact
 * opposite of what an audit system needs.
 *
 * **Por que não se usa o `migrate()` do drizzle.** Ele abre *uma* transação e
 * roda todas as pendentes dentro dela. O efeito é que a última pendente decide
 * o destino de todas: uma que falhe leva junto as anteriores, que estavam
 * corretas e já tinham rodado. Foi assim que a tabela do Book do Operador
 * (`0008`) deixou de existir num banco onde tudo o que veio antes existia — o
 * servidor subia, as telas antigas funcionavam, e só as rotas do Book
 * respondiam 500, longe demais da causa.
 *
 * Aqui cada migration é uma transação: ou ela entra inteira, ou não entra. A
 * primeira que falhar interrompe a fila — as seguintes quase sempre dependem
 * dela —, mas o que passou fica aplicado e registrado. O relatório diz o que
 * entrou, o que ficou faltando e onde parou.
 *
 * O registro continua sendo `drizzle.__drizzle_migrations`, com o mesmo hash e
 * o mesmo carimbo que o migrator do drizzle grava: se um dia se voltar para
 * ele, ele reconhece o que já foi aplicado aqui e não repete nada.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { codigoDoPostgres, type Database } from "./index";
import { sql } from "drizzle-orm";

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

/** Uma migration como ela está no disco. */
export interface MigrationFile {
  /** `0008_book_entries` — o nome do arquivo, sem extensão. */
  tag: string;
  /** O carimbo do journal, que é o número de ordem gravado no banco. */
  when: number;
  /** SHA-256 do arquivo inteiro — a mesma conta que o drizzle faz. */
  hash: string;
  /** Os comandos, já separados pelos `--> statement-breakpoint`. */
  statements: string[];
}

/** Onde a fila parou, para quem precisa explicar o estado do banco. */
export interface MigrationReport {
  /** Já estavam no banco quando esta chamada começou. */
  alreadyApplied: string[];
  /** Entraram agora, em ordem. */
  applied: string[];
  /** Continuam faltando — a que falhou e todas depois dela. */
  pending: string[];
  /**
   * A primeira que falhou, quando alguma falhou.
   *
   * `code` é o SQLSTATE do Postgres (`42P01` relação inexistente, `42501`
   * permissão negada, …). É o que permite dizer o que aconteceu sem repetir a
   * mensagem do driver, que carrega host e usuário.
   */
  failure?: { tag: string; code?: string; message: string };
}

interface JournalEntry {
  tag: string;
  when: number;
}

/**
 * As migrations do disco, na ordem do journal.
 *
 * O hash é do arquivo inteiro e não dos comandos separados, porque é assim que
 * o drizzle o calcula — e a compatibilidade do registro vale mais do que
 * qualquer melhoria de forma aqui.
 */
export function readMigrations(
  migrationsFolder: string = MIGRATIONS_FOLDER,
): MigrationFile[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: JournalEntry[];
  };

  return journal.entries
    .slice()
    .sort((a, b) => a.when - b.when)
    .map((entry) => {
      const arquivo = readFileSync(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        "utf8",
      );
      return {
        tag: entry.tag,
        when: entry.when,
        hash: createHash("sha256").update(arquivo).digest("hex"),
        statements: arquivo
          .split("--> statement-breakpoint")
          .map((comando) => comando.trim())
          .filter((comando) => comando !== ""),
      };
    });
}

/**
 * Chave arbitrária, fixa: só precisa ser a mesma em todas as instâncias.
 * Em autoscale, várias sobem ao mesmo tempo e todas tentam migrar; sem o lock
 * elas disputam a mesma tabela e a corrida derruba parte delas na partida.
 */
const MIGRATION_LOCK = 8_675_309;

const CRIAR_REGISTRO = [
  `CREATE SCHEMA IF NOT EXISTS "drizzle"`,
  `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
     id SERIAL PRIMARY KEY,
     hash text NOT NULL,
     created_at bigint
   )`,
];

/**
 * Aplica o que falta e conta o que fez.
 *
 * Não lança quando uma migration falha: o desfecho "entrou até a 0008" é
 * informação, não exceção, e é dela que dependem tanto o `/api/healthz` quanto
 * a decisão do servidor de continuar no ar. Lança, sim, quando não dá nem para
 * tentar — pasta ausente, banco inalcançável —, porque aí não há relatório
 * nenhum a dar.
 */
export async function runMigrations(
  connectionString: string,
  /** Sobrescreve a pasta — o bundle do api-server carrega a sua própria cópia. */
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<MigrationReport> {
  const migrations = readMigrations(migrationsFolder);
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  const report: MigrationReport = {
    alreadyApplied: [],
    applied: [],
    pending: [],
  };

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    for (const comando of CRIAR_REGISTRO) await client.query(comando);

    const { rows } = await client.query<{ created_at: string }>(
      `SELECT created_at FROM "drizzle"."__drizzle_migrations"`,
    );
    const aplicadas = new Set(rows.map((linha) => Number(linha.created_at)));

    for (const migration of migrations) {
      if (aplicadas.has(migration.when)) {
        report.alreadyApplied.push(migration.tag);
        continue;
      }
      /*
        Depois da primeira falha, o resto é pendente sem sequer ser tentado.
        Uma migration que roda fora de ordem costuma falhar por um motivo
        secundário — a tabela que a anterior criaria — e o log passaria a
        acusar o sintoma no lugar da causa.
      */
      if (report.failure) {
        report.pending.push(migration.tag);
        continue;
      }

      try {
        await client.query("BEGIN");
        for (const comando of migration.statements) {
          await client.query(comando);
        }
        await client.query(
          `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
           VALUES ($1, $2)`,
          [migration.hash, migration.when],
        );
        await client.query("COMMIT");
        report.applied.push(migration.tag);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {
          // A conexão pode ter caído junto; a transação morre com ela.
        });
        report.pending.push(migration.tag);
        report.failure = {
          tag: migration.tag,
          ...(codigoDoPostgres(err) ? { code: codigoDoPostgres(err) } : {}),
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK])
      .catch(() => {
        // Se a conexão já caiu, o lock morre com ela. Nada a fazer.
      });
    client.release();
    await pool.end();
  }

  return report;
}

/**
 * Quais migrations este banco tem, perguntando a ele — e não ao que o processo
 * lembra de ter feito na partida.
 *
 * A diferença importa: quem migrou pode ter sido outra instância, ou uma pessoa
 * pela linha de comando. `/api/healthz` precisa da verdade de agora.
 */
export async function appliedMigrations(db: Database): Promise<number[]> {
  const resultado = await db.execute<{ created_at: string }>(
    sql`select created_at from drizzle.__drizzle_migrations`,
  );
  return resultado.rows.map((linha) => Number(linha.created_at));
}

export { MIGRATIONS_FOLDER };

/*
 * O modo linha de comando fica em `migrate-cli.ts`, não aqui.
 *
 * Este módulo tinha um bloco "fui executado diretamente?", comparando
 * `import.meta.url` com `process.argv[1]`. A comparação é verdadeira quando se
 * roda o arquivo, e volta a ser verdadeira depois que o esbuild o embute em
 * `dist/index.mjs` — porque aí os dois apontam para o mesmo bundle. O
 * resultado era o servidor subir, escutar, e em seguida ser morto pelo
 * `process.exit(1)` de um CLI que ninguém pediu, procurando migrations numa
 * pasta que não existe no bundle. Separar os arquivos elimina a ambiguidade em
 * vez de tentar adivinhá-la melhor.
 */
