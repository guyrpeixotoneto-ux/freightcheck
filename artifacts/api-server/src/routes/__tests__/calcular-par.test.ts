import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import {
  createTestDatabase,
  importFixture,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { listComparableSnapshots } from "@workspace/comparison";
import { chaveDeLockDoPar } from "../calcular-par";

/**
 * `POST /alteracoes-por-modulo/calcular` — a lacuna virando comparação.
 *
 * As três garantias que um botão de cálculo precisa dar estão uma em cada caso:
 * ele não duplica trabalho quando dois cliques chegam juntos, ele não recalcula
 * o que já está pronto, e ele recusa o pedido malformado antes de tocar no
 * motor.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

async function post(corpo: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/alteracoes-por-modulo/calcular`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: res.status, body: await res.json() };
}

async function duasVigencias() {
  const lista = await listComparableSnapshots(ctx.db);
  const ordenadas = [...lista].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  return { comparada: ordenadas[0], base: ordenadas[1] };
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_calcular_par");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");

  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test:proposal");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);

  const { default: router } = await import("../calcular-par");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(router);
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null) throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 600_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await ctx?.pool.end().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});

  const admin = createDb(
    process.env.TEST_ADMIN_DATABASE_URL ??
      "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433",
  );
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [nomeDoBanco],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nomeDoBanco}" WITH (FORCE)`);
  await admin.pool.end();
}, 60_000);

describe("a chave de lock de um par", () => {
  it("é estável para o mesmo par, e diferente para pares diferentes", () => {
    expect(chaveDeLockDoPar("a", "b")).toBe(chaveDeLockDoPar("a", "b"));
    expect(chaveDeLockDoPar("a", "b")).not.toBe(chaveDeLockDoPar("b", "a"));
  });

  it("cabe no bigint assinado do Postgres", () => {
    for (const [a, b] of [
      ["a", "b"],
      ["vigencia-de-julho", "vigencia-de-agosto"],
      ["", ""],
    ]) {
      const chave = chaveDeLockDoPar(a, b);
      expect(chave >= 0n).toBe(true);
      expect(chave <= 0x7fffffffffffffffn).toBe(true);
    }
  });
});

describe("POST /alteracoes-por-modulo/calcular", () => {
  it("recusa o pedido sem as duas pontas, antes de tocar no motor", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ baseId: "só-uma" })).status).toBe(400);
    expect((await post({ baseId: "", comparadaId: "" })).status).toBe(400);
  });

  it("recusa com motivo o par que o motor não aceita", async () => {
    const { base: a } = await duasVigencias();
    /* Uma vigência não se compara consigo mesma — recusa de regra, e a frase
       tem de chegar a quem clicou, em vez de um 500. */
    const { status, body } = await post({ baseId: a.id, comparadaId: a.id });
    expect(status).toBe(422);
    expect(typeof body.error).toBe("string");
  }, 120_000);

  /**
   * Concorrência e idempotência no mesmo caso, porque é assim que o defeito
   * apareceria: dois cliques ao mesmo tempo no mesmo par — duas abas abertas, ou
   * dois cartões da mesma cobertura — chegariam juntos, os dois não achariam
   * comparação e os dois gravariam uma.
   */
  it("dois pedidos simultâneos produzem uma comparação só", async () => {
    const { base: a, comparada: b } = await duasVigencias();

    const [um, dois] = await Promise.all([
      post({ baseId: a.id, comparadaId: b.id }),
      post({ baseId: a.id, comparadaId: b.id }),
    ]);

    expect(um.status).toBe(200);
    expect(dois.status).toBe(200);
    expect(um.body.changeSetId).toBe(dois.body.changeSetId);

    const { rows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM change_set
        WHERE snapshot_a_id = $1 AND snapshot_b_id = $2`,
      [a.id, b.id],
    );
    expect(rows[0].n).toBe(1);
  }, 600_000);

  it("um terceiro pedido encontra o trabalho feito e não recalcula", async () => {
    const { base: a, comparada: b } = await duasVigencias();
    const { status, body } = await post({ baseId: a.id, comparadaId: b.id });

    expect(status).toBe(200);
    expect(body.jaExistia).toBe(true);
    expect(body.changeSetId).toBeTruthy();
  }, 120_000);
});
