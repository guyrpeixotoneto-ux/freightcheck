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
import { listComparableSnapshots, SEM_IMPACTO_DE_TMA } from "@workspace/comparison";

/**
 * `GET /tma/candidatos` — o que cada candidata a "De" produz contra o "Para".
 *
 * A irmã mais nova das outras sete, e a que precisou de uma justificativa extra:
 * a comparação desta tela não tem change set, porque o grão dela é o **local** e
 * local não é entidade do acervo. O menu é outra pergunta — *vale a pena abrir
 * este par?* —, e essa se responde no grão em que o motor pareia.
 *
 * O que se protege aqui:
 *
 * 1. **a lista é da série do destino** — mesma unidade, mesma cobertura;
 * 2. **a linha não tem dinheiro, e diz por quê** — `semImpacto` com a frase, e
 *    nunca `baldes` valorados que virariam `R$ 0,00` na tela;
 * 3. **ausência nunca vira zero**: o que não coube no orçamento volta `null`, e
 *    `pendentes` conta exatamente essas.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

interface Resposta {
  status: number;
  body: any;
}

async function get(caminho: string): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

/** As vigências do acervo de teste, da mais recente para a mais antiga. */
async function vigencias() {
  const lista = await listComparableSnapshots(ctx.db);
  return [...lista].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_tma_candidatos");
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

  const { default: tmaRouter } = await import("../tma");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(tmaRouter);
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

describe("GET /tma/candidatos", () => {
  it("exige a vigência de destino", async () => {
    const res = await get("/tma/candidatos");
    expect(res.status).toBe(400);
  });

  it("só oferece candidatas da mesma unidade e da mesma cobertura", async () => {
    const lista = await vigencias();
    const destino = lista[0];
    const { status, body } = await get(`/tma/candidatos?para=${destino.id}`);

    expect(status).toBe(200);
    expect(body.candidatos.length).toBeGreaterThan(0);

    const porId = new Map(lista.map((v) => [v.id, v]));
    for (const candidato of body.candidatos) {
      const v = porId.get(candidato.id);
      expect(v?.scopeHash).toBe(destino.scopeHash);
      expect(v?.entityTypeSet).toBe(destino.entityTypeSet);
      expect(candidato.id).not.toBe(destino.id);
    }
  }, 300_000);

  /**
   * O requisito 2: a linha não publica dinheiro, e o campo que diz isso é o
   * mesmo do QLP.
   *
   * `baldes` vazio **sem** a frase desceria para a tela como `R$ 0,00` —
   * afirmando que o dinheiro não se moveu numa comparação que nunca olhou para
   * ele. É a mentira por omissão que `numeros: null` evita do outro lado.
   */
  it("conta o que se moveu e diz por que não há dinheiro na linha", async () => {
    const lista = await vigencias();
    const { body } = await get(`/tma/candidatos?para=${lista[0].id}`);
    const comNumero = body.candidatos.find(
      (c: { numeros: unknown }) => c.numeros !== null,
    );
    expect(comNumero).toBeDefined();

    expect(typeof comNumero.numeros.alteracoes).toBe("number");
    expect(comNumero.numeros.alteracoes).toBeGreaterThanOrEqual(0);
    expect(comNumero.numeros.impacto.baldes).toEqual([]);
    expect(comNumero.numeros.semImpacto).toBe(SEM_IMPACTO_DE_TMA);
  }, 300_000);

  it("ausência de cálculo é null, e nunca um zero inventado", async () => {
    const lista = await vigencias();
    const { body } = await get(`/tma/candidatos?para=${lista[0].id}`);

    for (const candidato of body.candidatos) {
      expect(candidato).toHaveProperty("numeros");
      if (candidato.numeros === null) continue;
      expect(typeof candidato.numeros.alteracoes).toBe("number");
      expect(candidato.numeros.impacto.baldes).toEqual([]);
    }

    const semNumero = body.candidatos.filter(
      (c: { numeros: unknown }) => c.numeros === null,
    ).length;
    expect(body.pendentes).toBe(semNumero);
  }, 120_000);
});
