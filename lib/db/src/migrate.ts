import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./index";

const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

/**
 * Apply every pending versioned migration.
 *
 * This is the only supported way to change the schema. `drizzle-kit push` is
 * deliberately not used: it diffs against live state, which would let a
 * developer's local drift become undocumented production schema — the exact
 * opposite of what an audit system needs.
 */
/**
 * Chave arbitrária, fixa: só precisa ser a mesma em todas as instâncias.
 * Em autoscale, várias sobem ao mesmo tempo e todas tentam migrar; sem o lock
 * elas disputam a mesma tabela e a corrida derruba parte delas na partida.
 */
const MIGRATION_LOCK = 8_675_309;

export async function runMigrations(
  connectionString: string,
  /** Sobrescreve a pasta — o bundle do api-server carrega a sua própria cópia. */
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<void> {
  const { db, pool } = createDb(connectionString);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await migrate(db, { migrationsFolder });
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK])
      .catch(() => {
        // Se a conexão já caiu, o lock morre com ela. Nada a fazer.
      });
    client.release();
    await pool.end();
  }
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
