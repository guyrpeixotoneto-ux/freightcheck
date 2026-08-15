/**
 * A configuração do drizzle-kit — e a porta que ela tranca.
 *
 * ---------------------------------------------------------------------------
 * Uma autoridade só
 * ---------------------------------------------------------------------------
 * Quem altera o schema deste projeto são as migrations versionadas de
 * `./migrations`, aplicadas por `runMigrations()` (ver `src/migrate.ts`). Só
 * elas. Um diff de schema — seja o `drizzle-kit push`, seja o que o Publishing
 * do Replit propõe comparando desenvolvimento com produção — sabe copiar
 * *estrutura* e não sabe nada do resto: não carrega backfill, não carrega as
 * funções `IMMUTABLE` de que a coluna gerada depende, não carrega a fusão das
 * vigências duplicadas da `0016`, e não sabe que `dataset_family`, `canal` e
 * `canonical_scope` só podem ficar `NOT NULL` depois que os dados históricos
 * tiverem sido convertidos.
 *
 * O diff aplicado sozinho não é uma versão mais rápida da migration: é um banco
 * num estado que nenhuma das duas autoridades reconhece.
 *
 * Por isso os subcomandos que **escrevem** — em banco ou na fila — abortam
 * aqui, antes de qualquer conexão. `generate`, `check`, `up` e `studio`
 * continuam liberados: eles mexem em arquivo do repositório, que é onde a
 * decisão de schema é tomada e revisada.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo não se chama `drizzle.config.ts`
 * ---------------------------------------------------------------------------
 * Porque o nome é o gatilho. O Publishing do Replit decide que um projeto "usa
 * Drizzle" procurando um `drizzle.config.ts`; achando um, ele acrescenta ao
 * deploy um passo próprio de migração de schema, derivado do `schema.ts` e
 * aplicado direto no banco de produção — fora da fila versionada, e sem passar
 * por este arquivo, de modo que as proibições acima não o alcançam.
 *
 * Esse passo não tem como funcionar aqui, e o motivo é estrutural:
 * `snapshot.canonical_snapshot_key` é uma coluna gerada por
 * `freightcheck_snapshot_key(...)` (ver `schema/canonical.ts`), e o drizzle
 * modela a coluna mas não a função — nenhum snapshot dele descreve funções.
 * O DDL que ele emite chama uma função que ele nunca cria:
 *
 *     ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text
 *       GENERATED ALWAYS AS (freightcheck_snapshot_key(...)) STORED;
 *     ERROR: function freightcheck_snapshot_key(text, text, text, date, jsonb)
 *            does not exist
 *
 * O deploy morria aí, e a única saída que a tela oferecia era copiar o banco de
 * desenvolvimento por cima do de produção. Com o arquivo fora do nome
 * procurado, o passo não é montado: a publicação volta a ser build e start, e
 * quem aplica o schema é `runMigrations()` na partida, como sempre foi.
 *
 * O `generate` continua inteiro — `package.json` o chama com `--config`
 * explícito. É o desenvolvedor que aponta para esta configuração; nenhuma
 * varredura a encontra sozinha.
 */
import { defineConfig } from "drizzle-kit";

/**
 * Os subcomandos que alteram banco ou fila, e o que fazer em vez de cada um.
 *
 * `push` e `migrate` escrevem no banco por fora da fila versionada. `drop`
 * apaga uma migration do journal, o que faz o registro de um banco já migrado
 * deixar de bater com o disco.
 */
const PROIBIDOS: Record<string, string> = {
  push: "escreve o diff direto no banco, sem migration e sem backfill",
  migrate: "aplica a fila por fora de runMigrations(), tudo numa transação só",
  drop: "apaga uma migration do journal e dessincroniza o registro dos bancos já migrados",
};

const subcomando = process.argv.slice(2).filter((a) => !a.startsWith("-"))[0];

if (subcomando && subcomando in PROIBIDOS) {
  throw new Error(
    `drizzle-kit ${subcomando} está desligado neste projeto: ${PROIBIDOS[subcomando]}.\n` +
      `O schema do FreightCheck muda por migration versionada em lib/db/migrations, aplicada por runMigrations().\n` +
      `Para propor uma mudança: edite src/schema, rode "pnpm --filter @workspace/db run generate", revise o SQL gerado e commite.\n` +
      `Para aplicar: "pnpm --filter @workspace/db run migrate" (o servidor também aplica sozinho na partida).\n` +
      `Ver docs/MIGRATIONS.md.`,
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Paths are relative to this package: drizzle-kit resolves `out` against the
// process cwd, and an absolute path here ends up concatenated onto it.
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
});
