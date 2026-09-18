import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * `GET /ipva/totais` — **a mesma régua de `finame-totais.test.ts`, na tela vizinha.**
 *
 * As seis telas de comparação leem o acervo direto pelo mesmo caminho, e todas
 * o pediam sem dizer qual recorte lê: `getEntityTable`, sem contexto, resolve
 * para o primeiro do acervo, e a data do par depois recorta aquela unidade
 * errada em vez de esvaziá-la. `recorte-do-par.test.ts` prende a classe do
 * defeito lendo as rotas; este prova o comportamento numa segunda tela, porque
 * uma regra escrita sobre o código não prova que o dado sai certo.
 *
 * O IPVA é a escolhida por ser a de leitura menos parecida com a do FINAME:
 * são duas colunas por veículo — o imposto e a base de compra —, e é sobre as
 * duas juntas que a alíquota implícita é calculada.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

const CAMPOS: AttributeSpec[] = [
  {
    code: "cavalo.ipva_licenciamento",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.valor_nf_compra",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "AQUISICAO",
    aggregation: "SUM",
    isMonetary: true,
  },
];

const JULHO = "2026-07-02";
const AGOSTO = "2026-08-02";

let vigencia: Record<string, string> = {};

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

function total(body: any, ponta: "BASE" | "COMPARADA"): number | undefined {
  return body.totais.find((t: any) => t.ponta === ponta)?.total;
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_ipva_totais");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");
  await seedTaxonomy(ctx.db, "test");

  const camacari = await buildFixture(
    ctx.db,
    CAMPOS,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          CAM1A11: {
            "cavalo.ipva_licenciamento": 1000,
            "cavalo.valor_nf_compra": 100_000,
          },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          CAM1A11: {
            "cavalo.ipva_licenciamento": 1100,
            "cavalo.valor_nf_compra": 100_000,
          },
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: "scope-ipva-camacari", canal: "EMPURRADA" },
  );

  const pernambuco = await buildFixture(
    ctx.db,
    CAMPOS,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          PER3C33: {
            "cavalo.ipva_licenciamento": 50_000,
            "cavalo.valor_nf_compra": 900_000,
          },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          PER3C33: {
            "cavalo.ipva_licenciamento": 40_000,
            "cavalo.valor_nf_compra": 900_000,
          },
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: "scope-ipva-pernambuco", canal: "EMPURRADA" },
  );

  vigencia = {
    camacariBase: camacari.snapshotIds["EMPURRADA_2_7_2026"]!,
    camacariComparada: camacari.snapshotIds["EMPURRADA_2_8_2026"]!,
    pernambucoBase: pernambuco.snapshotIds["EMPURRADA_2_7_2026"]!,
    pernambucoComparada: pernambuco.snapshotIds["EMPURRADA_2_8_2026"]!,
  };

  const { default: ipvaRouter } = await import("../ipva");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(ipvaRouter);
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

describe("GET /ipva/totais", () => {
  it("soma a unidade do par, e não a primeira do acervo", async () => {
    const res = await get(
      `/ipva/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    expect(res.status).toBe(200);
    expect(total(res.body, "BASE")).toBe(1000);
    expect(total(res.body, "COMPARADA")).toBe(1100);
  });

  it("soma a outra unidade quando o par é o dela", async () => {
    const res = await get(
      `/ipva/totais?base=${vigencia.pernambucoBase}&comparada=${vigencia.pernambucoComparada}`,
    );
    expect(res.status).toBe(200);
    expect(total(res.body, "BASE")).toBe(50_000);
    expect(total(res.body, "COMPARADA")).toBe(40_000);
  });

  /* A alíquota implícita sai da mesma leitura: se o recorte vazar, ela passa a
     dividir o imposto de uma unidade pela base de compra da outra. */
  it("dá a alíquota da unidade do par", async () => {
    const res = await get(
      `/ipva/totais?base=${vigencia.pernambucoBase}&comparada=${vigencia.pernambucoComparada}`,
    );
    const daBase = res.body.aliquotas.find((a: any) => a.ponta === "BASE");
    expect(daBase.veiculos).toBe(1);
    expect(daBase.media).toBeCloseTo((50_000 / 900_000) * 100, 4);
  });

  /* A alíquota placa a placa sai da **mesma** leitura, e é isso que este caso
     prende: se a de cima e a de baixo divergissem de recorte, a tela publicaria
     uma média sobre uma população e a lista sobre outra — e quem conferisse
     placa a placa não fecharia com o veredito impresso acima. */
  it("dá a mesma alíquota, ativo a ativo, no mesmo recorte", async () => {
    const res = await get(
      `/ipva/totais?base=${vigencia.pernambucoBase}&comparada=${vigencia.pernambucoComparada}`,
    );
    const daBase = res.body.aliquotas.find((a: any) => a.ponta === "BASE");
    expect(res.body.porAtivo).toHaveLength(daBase.veiculos);
    expect(res.body.porAtivo[0].aliquotaBase).toBeCloseTo(daBase.media, 3);
  });
});
