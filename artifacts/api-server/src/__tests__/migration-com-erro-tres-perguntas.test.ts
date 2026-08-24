import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createDb, encerrarPoolDoProcesso, type Database } from "@workspace/db";
import { readMigrations } from "@workspace/db/migrate";
import { tentativaComecou, tentativaTerminou } from "../lib/partida";

/**
 * Migration com erro — as três perguntas da tarefa, respondidas juntas, com
 * um Postgres de verdade e uma sessão autenticada de verdade.
 *
 * ---------------------------------------------------------------------------
 * Por que reaproveitar o banco parado, e não sintetizar SQLSTATE 23514
 * ---------------------------------------------------------------------------
 * O que decide o comportamento do portão e das rotas não é o código do erro —
 * é o **estado do diagnóstico**: `MIGRATIONS_PENDENTES` e `MIGRATION_FALHOU`
 * estão no mesmo conjunto (`CONTRATO_DIVERGENTE`, em `lib/prontidao.ts`) e
 * produzem o mesmo comportamento de portão. `MIGRATION_FALHOU` em si — o
 * SQLSTATE, a classificação — já está provado em `lib/db/src/__tests__/
 * diagnostico.test.ts`. O que faltava provar é o comportamento **de ponta a
 * ponta** enquanto esse estado terminal vale, e a montagem mais fiel para
 * isso é a mesma que `janela-da-partida.test.ts` já usa: um banco real, parado
 * antes da última migration, com sessão de verdade.
 *
 * A diferença deste arquivo para aquele: lá a partida nunca chamou
 * `tentativaComecou`/`tentativaTerminou` (o teste dirige o portão sozinho,
 * sem terminar a partida) — aqui a tentativa é declarada **terminada, com
 * falha**, à mão, porque é exatamente esse desfecho que decide o que
 * `/startupz` responde.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const temBanco = Boolean(
  process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
);

const ANTES_DA_ULTIMA = readMigrations().at(-2)!.tag;
const A_QUE_FALTA = readMigrations().at(-1)!.tag;
const NOME = `fc_test_migration_falhou_${process.pid}`;
const SENHA = "quinzena-de-julho-2026";

let url: string;
let servidor: Server;
let base: string;
let db: Database;
let poolDoTeste: ReturnType<typeof createDb>["pool"];
let cookie: string;

interface Resposta {
  status: number;
  body: any;
}

async function pedir(caminho: string, init?: RequestInit): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, init);
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  if (!temBanco) return;

  const admin = createDb(ADMIN);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.pool.query(`CREATE DATABASE "${NOME}"`);
  await admin.pool.end();

  url = ADMIN.replace(/\/[^/?]*(\?|$)/, `/${NOME}$1`);

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
    if (m.tag === ANTES_DA_ULTIMA) break;
  }
  await pool.end();

  process.env.DATABASE_URL = url;
  process.env.DB_MIGRATE_ON_BOOT = "0";

  const { default: app } = await import("../app");
  ({ db, pool: poolDoTeste } = createDb(url));

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null)
    throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  const { hashPassword } = await import("../lib/auth");
  const { rows } = await poolDoTeste.query<{ id: string }>(
    `INSERT INTO "app_user" ("name","email","password_hash","role")
     VALUES ('Guy','guy@freightcheck',$1,'OPERADOR') RETURNING id`,
    [await hashPassword(SENHA)],
  );
  const { startSession } = await import("../lib/session");
  const sessao = await startSession(db, rows[0]!.id);
  cookie = `freightcheck_session=${sessao.token}`;

  /*
    A tentativa terminou, e terminou com falha — declarado à mão, porque é
    isso que `/startupz` precisa para decidir, e não a mecânica de qual
    SQLSTATE produziu o estado. O banco fica genuinamente com uma migration
    faltando (a última, nunca aplicada aqui), que é o mesmo balde
    (`CONTRATO_DIVERGENTE`) que `MIGRATION_FALHOU` — o portão não distingue.
  */
  tentativaComecou();
  tentativaTerminou(
    `A migration ${A_QUE_FALTA} foi recusada pelo banco (SQLSTATE 23514).`,
  );
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

describe.skipIf(!temBanco)(
  "migration com erro — o que cada uma das três perguntas responde",
  () => {
    it("1. /api/startupz: libera — o processo sobe, diagnosticável", async () => {
      const r = await pedir("/api/startupz");
      expect(r.status).toBe(200);
      expect(r.body.liberar).toBe(true);
      expect(r.body.detail).toContain(A_QUE_FALTA);
    });

    it("2. o portão (/api/readyz): continua recusando — nomeando a migration que falta", async () => {
      const r = await pedir("/api/readyz");
      expect(r.status).toBe(503);
      expect(r.body.diagnostico.estado).toBe("MIGRATIONS_PENDENTES");
      expect(r.body.diagnostico.evidencia).toContain(A_QUE_FALTA);
    });

    it("3. rota de negócio, com sessão válida: nenhuma passa — 503 do portão, não a resposta da rota", async () => {
      const r = await pedir(
        "/api/fechamento/competencias",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ ano: 2026, mes: 7, quinzena: 1 }),
        },
      );
      expect(r.status).toBe(503);
      expect(r.body.code).toBe("SERVICO_NAO_PRONTO");
      // E não é 400/422 de payload incompleto — a rota nunca chegou a rodar.
      expect(r.body.contexto).toMatch(/nada foi gravado/i);
    });

    it("o liveness segue verde — a publicação sobe mesmo com a migration recusada", async () => {
      const r = await pedir("/api/healthz");
      expect(r.status).toBe(200);
    });
  },
);
