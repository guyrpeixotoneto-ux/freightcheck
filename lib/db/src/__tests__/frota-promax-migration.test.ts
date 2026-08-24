import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readMigrations, runMigrations } from "../migrate";

/**
 * A `0056` — a frota Promax entra sobre um banco que já tinha o Fechamento em
 * uso, com competência encerrada.
 *
 * Ao contrário da `0055`, esta migration não migra dado existente — ela só
 * cria uma tabela nova e alarga uma `CHECK`. O que se prova aqui é que essa
 * simplicidade é real: a migration sobe sobre um banco com competência
 * congelada sem precisar desligar gatilho nenhum, porque não escreve em linha
 * de competência nenhuma — e que, depois dela, a proteção de congelamento e a
 * cascata de exclusão valem para a tabela nova exatamente como valem para as
 * demais.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_frota_promax_migration_${process.pid}`;
const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

async function comAdmin<T>(f: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await f(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function bancoAlcancavel(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const noCi = process.env.CI === "true" || process.env.CI === "1";
const temBanco = noCi || (await bancoAlcancavel());

async function migradoAte(pool: pg.Pool, ate: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  for (const m of readMigrations()) {
    for (const comando of m.statements) await pool.query(comando);
    await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ($1,$2)`,
      [m.hash, m.when],
    );
    if (m.tag === ate) return;
  }
  throw new Error(`migration ${ate} não existe`);
}

describe.skipIf(!temBanco)("a 0056 sobre um banco que já tinha o Fechamento em uso", () => {
  let pool: pg.Pool;
  const competencia = {
    aberta: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
    encerrada: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc",
  };

  beforeAll(async () => {
    await comAdmin(async (a) => {
      await a.query(`DROP DATABASE IF EXISTS "${NOME}"`);
      await a.query(`CREATE DATABASE "${NOME}"`);
    });
    pool = new pg.Pool({ connectionString: urlDe(NOME) });
    /* O estado imediatamente anterior a esta migration — a `0055` já aplicada. */
    await migradoAte(pool, "0055_disponibilidade_por_frota");

    const abrir = (id: string, chave: string, estado: string) =>
      pool.query(
        `INSERT INTO "fechamento_competencia"
           ("id","chave","ano","mes","quinzena","inicio","fim","estado",
            "unidade_codigo","unidade_nome","transportadora_codigo","transportadora_nome")
         VALUES ($1, $2, 2026, 7, 2, '2026-07-16', '2026-07-31', $3, '443', 'CDD BELEM', '36', 'TRANSPORTES FICTICIA')`,
        [id, chave, estado],
      );

    await abrir(competencia.aberta, "2026-07-Q2", "ABERTA");
    await abrir(competencia.encerrada, "2026-06-Q2", "ABERTA");

    /* Um documento comum, de uma fonte que já existia — prova que o banco
       "antigo" tem dado de verdade antes da migration rodar por cima dele. */
    await pool.query(
      `INSERT INTO "fechamento_documento"
         ("id","competencia_id","tipo","nome_do_arquivo","sha256","tamanho_em_bytes","vigente")
       VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', $1, 'CTE', '03.08.15.xlsx', ${"'" + "e".repeat(64) + "'"}, 1024, true)`,
      [competencia.encerrada],
    );

    await pool.query(
      `UPDATE "fechamento_competencia" SET "estado" = 'ENCERRADA', "encerrada_em" = now()
        WHERE "id" = $1`,
      [competencia.encerrada],
    );
  }, 300_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await comAdmin(async (a) => {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [NOME],
      );
      await a.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    });
  }, 300_000);

  it("sobe sem tocar na competência congelada nem no documento que já existia", async () => {
    const relatorio = await runMigrations(urlDe(NOME));
    expect(relatorio.failure).toBeUndefined();
    expect(relatorio.applied).toContain("0056_frota_promax");

    const { rows } = await pool.query<{ estado: string }>(
      `SELECT "estado" FROM "fechamento_competencia" WHERE "id" = $1`,
      [competencia.encerrada],
    );
    expect(rows[0]!.estado).toBe("ENCERRADA");

    const { rows: docs } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM "fechamento_documento" WHERE "competencia_id" = $1`,
      [competencia.encerrada],
    );
    expect(Number(docs[0]!.n)).toBe(1);
  }, 300_000);

  it("a tabela nova existe, com FK, índice e CHECK de situação", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'fechamento_frota_promax' ORDER BY column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(
      [
        "categoria",
        "competencia_id",
        "documento_id",
        "id",
        "linha_no_arquivo",
        "modelo",
        "placa",
        "situacao",
        "unidade",
      ].sort(),
    );
  }, 300_000);

  it("o CHECK de fechamento_documento.tipo aceita as duas fontes novas", async () => {
    const { rows } = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'fechamento_documento_tipo'`,
    );
    expect(rows[0]!.def).toContain("FROTA_PROMAX_ATIVA");
    expect(rows[0]!.def).toContain("FROTA_PROMAX_INATIVA");

    /* E o valor antigo ainda funciona — a lista cresceu, não foi substituída. */
    await pool.query(
      `INSERT INTO "fechamento_documento"
         ("competencia_id","tipo","nome_do_arquivo","sha256","tamanho_em_bytes")
       VALUES ($1, 'CTE', 'outro.xlsx', ${"'" + "f".repeat(64) + "'"}, 10)`,
      [competencia.aberta],
    );
  }, 300_000);

  it("a competência congelada recusa escrita na tabela nova, como recusa nas demais", async () => {
    const [doc] = (
      await pool.query<{ id: string }>(
        `INSERT INTO "fechamento_documento"
           ("competencia_id","tipo","nome_do_arquivo","sha256","tamanho_em_bytes")
         VALUES ($1, 'FROTA_PROMAX_ATIVA', 'frota.xlsx', ${"'" + "0".repeat(64) + "'"}, 10)
         RETURNING id`,
        [competencia.aberta],
      )
    ).rows;

    await pool.query(
      `INSERT INTO "fechamento_frota_promax"
         ("documento_id","competencia_id","linha_no_arquivo","situacao","unidade","placa","modelo")
       VALUES ($1, $2, 2, 'ATIVA', '443', 'ABC1D23', 'TRUCK X')`,
      [doc!.id, competencia.aberta],
    );

    await pool.query(
      `UPDATE "fechamento_competencia" SET "estado" = 'ENCERRADA', "encerrada_em" = now()
        WHERE "id" = $1`,
      [competencia.aberta],
    );

    await expect(
      pool.query(
        `INSERT INTO "fechamento_frota_promax"
           ("documento_id","competencia_id","linha_no_arquivo","situacao","unidade","placa","modelo")
         VALUES ($1, $2, 3, 'ATIVA', '443', 'XYZ9W88', 'TRUCK Y')`,
        [doc!.id, competencia.aberta],
      ),
    ).rejects.toThrow(/encerrada/);

    /* A cascata de exclusão: apagar a competência leva as linhas de frota junto. */
    await pool.query(`UPDATE "fechamento_competencia" SET "estado" = 'ABERTA' WHERE "id" = $1`, [
      competencia.aberta,
    ]);
    await pool.query(`DELETE FROM "fechamento_competencia" WHERE "id" = $1`, [competencia.aberta]);
    const { rows: restantes } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM "fechamento_frota_promax" WHERE "documento_id" = $1`,
      [doc!.id],
    );
    expect(Number(restantes[0]!.n)).toBe(0);
  }, 300_000);
});
