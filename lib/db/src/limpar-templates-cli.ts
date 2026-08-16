/**
 * Derruba os bancos-template que os testes deixam para trás.
 *
 *     pnpm run test:limpar-templates
 *
 * As suítes que partem de dado real clonam um template em vez de refazer a
 * importação — ver `lib/ingest/src/testing.ts`. O nome do template carrega um
 * hash das migrations, dos workbooks e do código que o constrói, então mudar
 * qualquer um deles já faz nascer um template novo; o antigo fica para trás
 * ocupando ~100 MB.
 *
 * O que o hash **não** alcança é código de outro pacote — a curadoria, o motor
 * de comparação. Se você mudou um deles e uma suíte de fixture insiste num
 * número velho, é aqui que se resolve. No CI isso não acontece: o banco nasce
 * vazio a cada job e o template é sempre construído do zero.
 *
 * Um template em uso por outra execução recusa o `DROP`, e este comando segue
 * em frente dizendo qual foi. É o comportamento certo: derrubar à força o banco
 * de quem está rodando trocaria um desperdício de disco por uma suíte vermelha.
 */
import pg from "pg";

const url =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/postgres";

const pool = new pg.Pool({ connectionString: url });
try {
  const { rows } = await pool.query<{ datname: string; tamanho: string }>(
    `SELECT datname, pg_size_pretty(pg_database_size(datname)) AS tamanho
       FROM pg_database WHERE datname LIKE 'fc\\_tpl\\_%' ORDER BY datname`,
  );
  if (rows.length === 0) console.log("Nenhum template a derrubar.");
  for (const { datname, tamanho } of rows) {
    try {
      await pool.query(`DROP DATABASE "${datname}"`);
      console.log(`derrubado  ${datname} (${tamanho})`);
    } catch (err) {
      console.log(
        `em uso     ${datname} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
} finally {
  await pool.end();
}
