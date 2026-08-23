import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { diagnosticar } from "@workspace/db/diagnostico";
import { readMigrations, runMigrations } from "@workspace/db/migrate";

/**
 * O relatório da partida envelhece — e a prontidão não pode envelhecer com ele.
 *
 * ---------------------------------------------------------------------------
 * O estado obsoleto que isto elimina
 * ---------------------------------------------------------------------------
 * O processo tenta a fila na partida, o banco recusa uma migration, e o
 * relatório fica guardado **na memória deste processo**. Até aqui, correto: é a
 * única fonte do "onde parou", que o banco não registra.
 *
 * O defeito era o relatório valer para sempre. Se depois da falha outra
 * instância — ou uma pessoa, pela linha de comando — aplicasse a migration,
 * este processo continuava anunciando `MIGRATION_FALHOU` sobre um banco já em
 * dia: a prontidão ficava vermelha, o portão fechado, e a única saída era
 * reiniciar — exatamente o reinício indevido que a prontidão medida existe
 * para eliminar.
 *
 * A regra que este arquivo prova: **a falha da partida só é dita enquanto a
 * migration dela ainda estiver pendente.** O registro do banco é a autoridade
 * sobre o que foi aplicado; o relatório só acrescenta onde parou, e essa
 * informação só é verdadeira sobre uma migration que continua faltando.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const temBanco = Boolean(
  process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
);

const NOME = `fc_test_relatorio_${process.pid}`;

let url: string;
let observarBanco: typeof import("../migrations").observarBanco;
let lembrarRelatorio: typeof import("../migrations").lembrarRelatorio;
let ultimaTag: string;

beforeAll(async () => {
  if (!temBanco) return;

  const admin = createDb(ADMIN);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.pool.query(`CREATE DATABASE "${NOME}"`);
  await admin.pool.end();

  url = ADMIN.replace(/\/[^/?]*(\?|$)/, `/${NOME}$1`);

  /* A fila parada na penúltima: a última fica pendente, como numa partida que
     falhou nela. */
  const todas = readMigrations();
  ultimaTag = todas[todas.length - 1]!.tag;
  const penultima = todas[todas.length - 2]!.tag;

  const { pool } = createDb(url);
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  for (const m of todas) {
    for (const comando of m.statements) await pool.query(comando);
    await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ($1,$2)`,
      [m.hash, m.when],
    );
    if (m.tag === penultima) break;
  }
  await pool.end();

  process.env.DATABASE_URL = url;
  ({ observarBanco, lembrarRelatorio } = await import("../migrations"));
}, 300_000);

afterAll(async () => {
  await encerrarPoolDoProcesso().catch(() => {});
  if (!temBanco) return;
  const admin = createDb(ADMIN);
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [NOME],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}" WITH (FORCE)`);
  await admin.pool.end();
});

describe.skipIf(!temBanco)("o relatório da partida e a fila do banco", () => {
  it("enquanto a migration da falha está pendente, a falha é dita", async () => {
    /* A partida deste processo tentou e o banco recusou a última. */
    lembrarRelatorio({
      alreadyApplied: [],
      applied: [],
      pending: [ultimaTag],
      adopted: [],
      adoptedWithData: [],
      failure: { tag: ultimaTag, code: "42710", message: "already exists" },
    });

    const estado = await observarBanco();

    expect(estado.pendentes).toContain(ultimaTag);
    expect(estado.falha?.tag).toBe(ultimaTag);
    expect(diagnosticar(estado).estado).toBe("MIGRATION_FALHOU");
  });

  it("aplicada por fora, a falha guardada deixa de ser dita — sem reiniciar", async () => {
    /* Outra instância, ou uma pessoa, aplica a fila. O relatório na memória
       deste processo continua o mesmo. */
    expect((await runMigrations(url)).failure).toBeUndefined();

    const estado = await observarBanco();

    expect(estado.pendentes).toEqual([]);
    /* O que não pode acontecer: `falha` sobrevivendo à migration aplicada. */
    expect(estado.falha).toBeUndefined();
    expect(diagnosticar(estado).estado).toBe("SAUDAVEL");
  });
});
