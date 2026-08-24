import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDb, encerrarPoolDoProcesso, type Database } from "@workspace/db";
import { readMigrations } from "@workspace/db/migrate";

/**
 * O banco à frente do build — o desfecho normal de um rollback.
 *
 * ---------------------------------------------------------------------------
 * O que era irrepresentável, e por que importa
 * ---------------------------------------------------------------------------
 * `observarBanco()` só calculava o que **falta**. Um banco com um carimbo que
 * o build não empacota — publicar de novo uma versão anterior sobre um schema
 * que já avançou — saía com zero pendências e chegava a `diagnosticar`
 * indistinguível de um banco em dia: `SAUDAVEL`, portão aberto, ninguém
 * avisado de que o código no ar é anterior ao schema.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo prova, e a garantia que ele fixa
 * ---------------------------------------------------------------------------
 * Com o **app de verdade** sobre um banco que tem um carimbo a mais que este
 * build:
 *
 *   - o estado sai nomeado (`BANCO_A_FRENTE_DO_BUILD`), não mais `SAUDAVEL`;
 *   - `/readyz` responde não-pronto, para quem consulta por probe;
 *   - e — a garantia que a tarefa pediu explicitamente — **nenhuma rota de
 *     produto é bloqueada**: o portão não fecha, o rollback continua sendo uma
 *     saída operacional possível, e nada é revertido automaticamente. Nenhuma
 *     linha do registro de migrations é escrita pela partida deste teste.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const temBanco = Boolean(
  process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
);

const NOME = `fc_test_a_frente_${process.pid}`;
/** Um carimbo que nenhuma migration real usa — no futuro de todas elas. */
const CARIMBO_DO_FUTURO = 9_999_999_999_999;

let url: string;
let servidor: Server;
let base: string;
let db: Database;
let poolDoTeste: ReturnType<typeof createDb>["pool"];

interface Resposta {
  status: number;
  body: any;
}

async function pedir(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function contarRegistro(): Promise<number> {
  const { rows } = await poolDoTeste.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM "drizzle"."__drizzle_migrations"`,
  );
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  if (!temBanco) return;

  const admin = createDb(ADMIN);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.pool.query(`CREATE DATABASE "${NOME}"`);
  await admin.pool.end();

  url = ADMIN.replace(/\/[^/?]*(\?|$)/, `/${NOME}$1`);

  /*
    A fila inteira, em dia — e, por cima dela, um carimbo que nenhuma migration
    deste build tem. É o rollback: o código publicado é este build, e o schema
    é de um build mais novo, cuja `9999_do_futuro` este processo nunca viu.
  */
  const { pool } = createDb(url);
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
  }
  await pool.query(
    `INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ($1,$2)`,
    ["carimbo-de-build-mais-novo-que-este-processo-nunca-viu", CARIMBO_DO_FUTURO],
  );
  await pool.end();

  process.env.DATABASE_URL = url;
  process.env.DB_MIGRATE_ON_BOOT = "0";

  const { default: app } = await import("../app");
  ({ db, pool: poolDoTeste } = createDb(url));

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address() as AddressInfo;
  base = `http://127.0.0.1:${endereco.port}`;
}, 300_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await poolDoTeste?.end().catch(() => {});
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

describe.skipIf(!temBanco)("banco à frente do build — o rollback", () => {
  it("o estado sai nomeado — não mais indistinguível de SAUDAVEL", async () => {
    const readyz = await pedir("/api/readyz");
    expect(readyz.status).toBe(503);
    expect(readyz.body.diagnostico.estado).toBe("BANCO_A_FRENTE_DO_BUILD");
    expect(readyz.body.diagnostico.evidencia).toMatch(/1 delas/);
  });

  it("não oferece comando de reversão — desfazer migration não é uma ação segura", async () => {
    const readyz = await pedir("/api/readyz");
    expect(readyz.body.diagnostico.acao.codigo).toBe("ALINHAR_BUILD");
    expect(readyz.body.diagnostico.acao.comando).toBeUndefined();
  });

  it("não afirma risco a dados — nada foi perdido", async () => {
    const readyz = await pedir("/api/readyz");
    expect(readyz.body.diagnostico.risco.emRisco).toBe(false);
  });

  /*
    A garantia central: o rollback continua sendo uma saída operacional
    possível. Uma rota de produto real, sem sessão — o mesmo teste que
    `janela-da-partida.test.ts` usa para provar o *fechamento*, aqui prova a
    *abertura*: 401 (sessão ausente, e nada além disso) é o oposto de 503.
  */
  it("o portão não fecha — uma rota de produto passa dele (401 de sessão, não 503 de portão)", async () => {
    const r = await pedir("/api/fechamento/competencias");
    expect(r.status).not.toBe(503);
    expect(r.body?.code).not.toBe("SERVICO_NAO_PRONTO");
  });

  it("o liveness e o startup continuam verdes — a publicação sobe normalmente", async () => {
    expect((await pedir("/api/healthz")).status).toBe(200);
  });

  it("nada foi escrito no registro de migrations pela partida — nenhuma reversão automática", async () => {
    // A fila real tem N migrations + o carimbo do futuro inserido no setup.
    const esperado = readMigrations().length + 1;
    expect(await contarRegistro()).toBe(esperado);
  });
});
