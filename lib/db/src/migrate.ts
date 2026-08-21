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
  /**
   * Registradas sem rodar, porque tudo o que elas criam já existia no banco.
   *
   * É a saída para o registro perdido — ver `adotarSeTudoJaExiste`. Sai
   * separado de `applied` de propósito: "entrou agora" e "já estava lá, e o
   * registro é que não sabia" são desfechos diferentes, e quem lê o relatório
   * precisa distinguir os dois.
   */
  adopted: string[];
  /**
   * Das adotadas, as que carregam `INSERT`/`UPDATE`/`DELETE`.
   *
   * Elas saem nomeadas porque a evidência que sustenta a adoção — o schema
   * estar como a migration o deixaria — não diz nada sobre o backfill que ela
   * também fazia. Quem adotou precisa conferir esse pedaço à mão, e para isso
   * precisa saber quais são.
   */
  adoptedWithData: string[];
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

/*
 * A lista de SQLSTATEs de "isto já existe" morava aqui e não era usada por
 * ninguém: a adoção decide por inspeção de schema (ver `tudoJaExiste`), e não
 * por código de erro. Quem precisava dela de verdade era o diagnóstico, que
 * mantinha a sua própria cópia literal no `/api/healthz` — duas listas que
 * ninguém garantia andarem juntas. Agora existe uma só, em `diagnostico.ts`.
 */

/** O que uma migration cria, extraído do SQL dela. */
export interface ObjetosCriados {
  tabelas: string[];
  tipos: string[];
  indices: string[];
  colunas: { tabela: string; coluna: string }[];
  /** `CREATE TRIGGER x ... ON "tabela"` — o nome vem sem aspas no SQL daqui. */
  gatilhos: { tabela: string; gatilho: string }[];
}

/*
  Exportada porque a reconvergência precisa da mesma leitura para a pergunta
  inversa: aqui ela serve para decidir se uma migration já rodou; lá, para
  saber o que **ainda não** rodou — e não confundir "a fila ainda não chegou
  nesta tabela" com "esta tabela foi arrancada do banco". Duas redações do que
  um `CREATE TABLE` cria divergiriam no primeiro DDL que fugisse do formato.
*/
export function objetosCriadosPor(statements: string[]): ObjetosCriados {
  const sql = statements.join("\n");
  const todos = (re: RegExp): string[] =>
    [...sql.matchAll(re)].map((m) => m[1]);

  return {
    tabelas: todos(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi),
    tipos: todos(/CREATE\s+TYPE\s+(?:"public"\.)?"([^"]+)"/gi),
    indices: todos(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi),
    colunas: [
      ...sql.matchAll(
        /ALTER\s+TABLE\s+"([^"]+)"\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi,
      ),
    ].map((m) => ({ tabela: m[1], coluna: m[2] })),
    gatilhos: [
      ...sql.matchAll(
        /CREATE\s+TRIGGER\s+"?([A-Za-z0-9_]+)"?[\s\S]*?\sON\s+"?([A-Za-z0-9_]+)"?/gi,
      ),
    ].map((m) => ({ gatilho: m[1], tabela: m[2] })),
  };
}

/*
 * `CREATE OR REPLACE FUNCTION`, `CREATE OR REPLACE VIEW`, `CREATE TABLE IF NOT
 * EXISTS` e `CREATE EXTENSION IF NOT EXISTS` ficam de fora de propósito: são
 * idempotentes, nunca levantam duplicata, e por isso nunca são o motivo de uma
 * migration falhar aqui. Conferi-los seria trabalho sem consequência.
 */

/**
 * O que uma migration **remove** — para descontar do que se exige adiante.
 *
 * Sem isto a conferência é estrita demais e nunca adota nada numa história de
 * schema real. A `0000` cria `snapshot_business_key_uq`; a `0016` derruba esse
 * índice e põe outro no lugar. Exigir que tudo o que a `0000` criou ainda
 * exista reprova a `0000` num banco perfeitamente em dia — e o efeito é o
 * ambiente continuar travado, que é justamente o que se quer destravar.
 *
 * A pergunta certa não é "tudo o que ela criou existe?", e sim "tudo o que ela
 * criou **e que ninguém removeu depois** existe?".
 */
function objetosRemovidosPor(statements: string[]): Set<string> {
  const sql = statements.join("\n");
  const nomes = new Set<string>();
  const capturar = (re: RegExp) => {
    for (const m of sql.matchAll(re)) nomes.add(m[1]);
  };
  capturar(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi);
  capturar(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi);
  capturar(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi);
  capturar(/DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?(?:"public"\.)?"([^"]+)"/gi);
  for (const m of sql.matchAll(
    /ALTER\s+TABLE\s+"([^"]+)"\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi,
  )) {
    nomes.add(`${m[1]}.${m[2]}`);
  }
  return nomes;
}

/**
 * A migration mexe em dados, e não só em estrutura?
 *
 * A pergunta existe para a adoção: o schema estar como a migration o deixaria
 * prova que a estrutura entrou, e não prova nada sobre um backfill. Quem adota
 * precisa conferir esse pedaço à mão, e para isso precisa saber quais são.
 *
 * **Corpo de função não conta.** A `0009` define
 * `freightcheck_correct_entity_type`, e dentro dela há uma dúzia de `UPDATE` —
 * que não rodam quando a migration roda: rodam quando alguém chama a função,
 * um dia, se chamar. Contá-los fazia a adoção acusar a `0009` e mandar
 * conferir à mão um backfill que nunca existiu. Um aviso que não se sustenta
 * gasta a atenção de quem opera e ensina a ignorar os próximos — que é o
 * oposto do que estes avisos existem para fazer.
 *
 * O corte é pelos delimitadores `$$` (ou `$tag$`), que é como todo corpo de
 * função aqui é escrito. Fora deles, um `UPDATE` roda na hora da migration.
 */
export function mexeEmDados(statements: string[]): boolean {
  const semCorpoDeFuncao = statements
    .join("\n")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " corpo de função ");
  return /^\s*(INSERT INTO|UPDATE\s|DELETE FROM)/im.test(semCorpoDeFuncao);
}

/**
 * Tudo o que esta migration cria já está no banco?
 *
 * É a evidência de que ela já rodou — e é **evidência, não prova**, o que
 * decide a forma da operação inteira: a adoção é um ato declarado por quem
 * opera (ver `adoptExisting`), e não algo que a partida faça sozinha.
 *
 * Duas descobertas moldaram esta função, e as duas vieram de tentar adotar
 * automaticamente numa história de schema real:
 *
 * **O SQLSTATE não serve de critério.** Reaplicar uma migration já aplicada
 * falha por duplicata quando ela cria (`42710`) e por ausência quando ela
 * derruba (`42703`, a `0004` dropando uma coluna que ela mesma já tirou). O
 * código diz o que quebrou, não se ela rodou.
 *
 * **Nem tudo o que ela cria precisa existir hoje.** A `0000` cria
 * `snapshot_business_key_uq`; a `0016` derruba esse índice. Exigir o conjunto
 * inteiro reprovaria a `0000` num banco impecável. Por isso `removidosDepois`.
 */
async function tudoJaExiste(
  client: pg.PoolClient,
  statements: string[],
  /** O que as migrations seguintes removem — não se exige o que já foi tirado. */
  removidosDepois: Set<string>,
): Promise<boolean> {
  const bruto = objetosCriadosPor(statements);
  const objetos: ObjetosCriados = {
    tabelas: bruto.tabelas.filter((n) => !removidosDepois.has(n)),
    tipos: bruto.tipos.filter((n) => !removidosDepois.has(n)),
    indices: bruto.indices.filter((n) => !removidosDepois.has(n)),
    colunas: bruto.colunas.filter(
      (c) =>
        !removidosDepois.has(`${c.tabela}.${c.coluna}`) &&
        !removidosDepois.has(c.tabela),
    ),
    gatilhos: bruto.gatilhos.filter(
      (g) =>
        !removidosDepois.has(g.gatilho) && !removidosDepois.has(g.tabela),
    ),
  };
  const total =
    objetos.tabelas.length +
    objetos.tipos.length +
    objetos.indices.length +
    objetos.colunas.length +
    objetos.gatilhos.length;
  if (total === 0) return false;

  // `to_regclass`/`to_regtype` devolvem NULL em vez de levantar erro quando o
  // objeto não existe — é o que permite perguntar sem abortar a transação.
  for (const tabela of [...objetos.tabelas, ...objetos.indices]) {
    const { rows } = await client.query<{ existe: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS existe`,
      [`public."${tabela}"`],
    );
    if (!rows[0]?.existe) return false;
  }
  for (const tipo of objetos.tipos) {
    const { rows } = await client.query<{ existe: boolean }>(
      `SELECT to_regtype($1) IS NOT NULL AS existe`,
      [`public."${tipo}"`],
    );
    if (!rows[0]?.existe) return false;
  }
  for (const { tabela, gatilho } of objetos.gatilhos) {
    const { rows } = await client.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_trigger t
           JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal
            AND t.tgname = $1
            AND c.relname = $2
       ) AS existe`,
      [gatilho, tabela],
    );
    if (!rows[0]?.existe) return false;
  }
  for (const { tabela, coluna } of objetos.colunas) {
    const { rows } = await client.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND column_name = $2
       ) AS existe`,
      [tabela, coluna],
    );
    if (!rows[0]?.existe) return false;
  }

  return true;
}

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
export interface RunOptions {
  /**
   * Registrar como aplicada, sem rodar, toda migration cujos objetos já
   * existem no banco — a saída para o registro perdido.
   *
   * **Nunca é ligado sozinho.** Quem opera declara isto porque sabe que o
   * banco já teve aquelas migrations; nós só conferimos que o schema é
   * compatível com a declaração. A diferença importa por causa das migrations
   * que mexem em dados: nenhuma inspeção de schema prova que um backfill
   * rodou, e uma partida de servidor não pode decidir isso por ninguém.
   */
  adoptExisting?: boolean;
}

export async function runMigrations(
  connectionString: string,
  /** Sobrescreve a pasta — o bundle do api-server carrega a sua própria cópia. */
  migrationsFolder: string = MIGRATIONS_FOLDER,
  options: RunOptions = {},
): Promise<MigrationReport> {
  const migrations = readMigrations(migrationsFolder);
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  const report: MigrationReport = {
    alreadyApplied: [],
    applied: [],
    pending: [],
    adopted: [],
    adoptedWithData: [],
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

      /*
        A adoção acontece **antes** de tentar rodar, e não depois de falhar.
        Depender da falha amarraria a decisão ao SQLSTATE, que não distingue
        "já rodou" de "o banco está quebrado": reaplicar uma migration aplicada
        falha por duplicata quando ela cria e por ausência quando ela derruba.
        O que decide é o schema estar como ela o deixaria.
      */
      if (options.adoptExisting) {
        const removidosDepois = new Set<string>();
        for (const posterior of migrations.slice(
          migrations.indexOf(migration) + 1,
        )) {
          for (const nome of objetosRemovidosPor(posterior.statements)) {
            removidosDepois.add(nome);
          }
        }
        if (await tudoJaExiste(client, migration.statements, removidosDepois)) {
          await client.query(
            `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
             VALUES ($1, $2)`,
            [migration.hash, migration.when],
          );
          report.adopted.push(migration.tag);
          if (mexeEmDados(migration.statements)) {
            report.adoptedWithData.push(migration.tag);
          }
          continue;
        }
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
