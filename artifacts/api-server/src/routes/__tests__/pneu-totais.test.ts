import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * `GET /pneu/totais` — **de quem é o custo de pneu que ele devolve**, e o que a
 * conferência acusa.
 *
 * A mesma prova de isolamento das rotas de totais anteriores (ver
 * `km-rodado-totais`), sobre a primeira rubrica que nasceu de uma separação: o
 * pneu saiu da Auditoria de Manutenção, onde era uma coluna zerada do
 * equipamento, e passou a ler as sete colunas que a tabela de frete declara por
 * trecho. Um recorte vazado aqui não apareceria como total inflado — apareceria
 * como um R$/km de pneu plausível, da praça errada.
 *
 * E há um caso que só esta rubrica tem: **o preço do frete contra o custo
 * apurado**. As duas colunas são independentes, descrevem o mesmo dinheiro, e a
 * régua da vigência conta quantos trechos discordam — com os que cobram **menos**
 * do que custam separados dos demais, porque é neles que há desgaste sem
 * cobrança.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

const razao = (code: string): AttributeSpec => ({
  code,
  dataType: "NUMERIC",
  semanticsStatus: "CONFIRMED",
  unit: "BRL",
  periodicity: "POR_KM",
  aggregation: "AVG",
  isMonetary: true,
});

const distancia = (code: string): AttributeSpec => ({
  code,
  dataType: "NUMERIC",
  semanticsStatus: "CONFIRMED",
  unit: "KM",
  aggregation: "SUM",
  isMonetary: false,
});

const CAMPOS: AttributeSpec[] = [
  razao("trecho.pneu_custo_pneus_camaras_reais_km"),
  razao("trecho.frete_reais_km_pneu"),
  distancia("trecho.km_rodado"),
  distancia("trecho.vidautil_ajustada_pneu"),
  {
    code: "trecho.pneu_quantidade_de_pneus",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "UN",
    aggregation: "SUM",
    isMonetary: false,
  },
];

const JULHO = "2026-07-02";
const AGOSTO = "2026-08-02";

let vigencia: Record<string, string> = {};

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

/** O custo médio de uma ponta, como o painel da tela o lê. */
function custoMedio(body: any, ponta: "BASE" | "COMPARADA"): number | null | undefined {
  return body.custo.find((c: any) => c.ponta === ponta)?.custoMedio;
}

/** A conferência de uma ponta. */
function conferencia(body: any, ponta: "BASE" | "COMPARADA"): any {
  return body.conferencias.find((c: any) => c.ponta === ponta);
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_pneu_totais");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");
  await seedTaxonomy(ctx.db, "test");

  /*
    Camaçari fecha as duas contas na base — preço igual ao custo — e deixa de
    fechar na comparada, onde o frete passa a cobrar menos do que o pneu custa.
    É o caso que a tela existe para mostrar.
  */
  const camacari = await buildFixture(
    ctx.db,
    CAMPOS,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          "CAMACARI-RECIFE": {
            "trecho.pneu_custo_pneus_camaras_reais_km": 0.03,
            "trecho.frete_reais_km_pneu": 0.03,
            "trecho.km_rodado": 800,
            "trecho.vidautil_ajustada_pneu": 480000,
            "trecho.pneu_quantidade_de_pneus": 6,
          },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          "CAMACARI-RECIFE": {
            "trecho.pneu_custo_pneus_camaras_reais_km": 0.05,
            "trecho.frete_reais_km_pneu": 0.03,
            "trecho.km_rodado": 800,
            "trecho.vidautil_ajustada_pneu": 480000,
            "trecho.pneu_quantidade_de_pneus": 6,
          },
        },
      },
    ],
    {
      entityType: "TRECHO",
      /* A vigência real entrega cavalo e trecho no mesmo arquivo; `'TRECHO'` puro
         é a casca que `listContexts` deixa de fora, e um acervo só de cascas não
         tem contexto nenhum — a rota responderia vazio por um motivo que não tem
         nada a ver com o recorte. */
      entityTypeSet: "CAVALO,TRECHO",
      scopeHash: "scope-pneu-camacari",
      canal: "EMPURRADA",
    },
  );

  /* A outra praça, nas mesmas datas e com custo de outra ordem: um vazamento não
     se esconde numa casa decimal. */
  const pernambuco = await buildFixture(
    ctx.db,
    CAMPOS,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          "SUAPE-PETROLINA": {
            "trecho.pneu_custo_pneus_camaras_reais_km": 0.2,
            "trecho.frete_reais_km_pneu": 0.2,
            "trecho.km_rodado": 1400,
            "trecho.vidautil_ajustada_pneu": 300000,
            "trecho.pneu_quantidade_de_pneus": 10,
          },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          "SUAPE-PETROLINA": {
            "trecho.pneu_custo_pneus_camaras_reais_km": 0.22,
            "trecho.frete_reais_km_pneu": 0.22,
            "trecho.km_rodado": 1400,
            "trecho.vidautil_ajustada_pneu": 300000,
            "trecho.pneu_quantidade_de_pneus": 10,
          },
        },
      },
    ],
    {
      entityType: "TRECHO",
      entityTypeSet: "CAVALO,TRECHO",
      scopeHash: "scope-pneu-pernambuco",
      canal: "EMPURRADA",
    },
  );

  vigencia = {
    camacariBase: camacari.snapshotIds["EMPURRADA_2_7_2026"]!,
    camacariComparada: camacari.snapshotIds["EMPURRADA_2_8_2026"]!,
    pernambucoBase: pernambuco.snapshotIds["EMPURRADA_2_7_2026"]!,
    pernambucoComparada: pernambuco.snapshotIds["EMPURRADA_2_8_2026"]!,
  };

  const { default: pneuRouter } = await import("../pneu");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(pneuRouter);
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

describe("GET /pneu/totais", () => {
  it("lê os trechos da unidade do par, e não os da primeira do acervo", async () => {
    const res = await get(
      `/pneu/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    expect(res.status).toBe(200);
    expect(custoMedio(res.body, "BASE")).toBeCloseTo(0.03, 4);
    expect(custoMedio(res.body, "COMPARADA")).toBeCloseTo(0.05, 4);
  });

  it("lê os da outra unidade quando o par é o dela", async () => {
    const res = await get(
      `/pneu/totais?base=${vigencia.pernambucoBase}&comparada=${vigencia.pernambucoComparada}`,
    );
    expect(res.status).toBe(200);
    expect(custoMedio(res.body, "BASE")).toBeCloseTo(0.2, 4);
    expect(custoMedio(res.body, "COMPARADA")).toBeCloseTo(0.22, 4);
  });

  /*
    A leitura própria desta tela. Na base o preço é o custo; na comparada o custo
    subiu e o preço ficou — e é isso que a régua tem de dizer, com a direção
    separada.
  */
  it("acusa o trecho em que o preço deixou de cobrir o custo apurado", async () => {
    const res = await get(
      `/pneu/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    expect(conferencia(res.body, "BASE").confere).toBe(1);
    expect(conferencia(res.body, "BASE").divergeDoCusto).toBe(0);
    expect(conferencia(res.body, "COMPARADA").divergeDoCusto).toBe(1);
    expect(conferencia(res.body, "COMPARADA").abaixoDoCusto).toBe(1);
  });

  /* A reconstituição precisa dos cinco componentes; com três, ela não sai — e
     dizer isso é a resposta certa, não devolver um número montado com zeros. */
  it("a reconstituição não inventa o que falta", async () => {
    const res = await get(
      `/pneu/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    const base = res.body.reconstituicao.find((r: any) => r.ponta === "BASE");
    expect(base.trechosReconstituidos).toBe(0);
    expect(base.trechosIncompletos).toBe(1);
    expect(base.mediaReconstituida).toBeNull();
  });

  it("sem par, recusa com 400 e diz o que falta", async () => {
    const res = await get(`/pneu/totais?base=${vigencia.camacariBase}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/base e comparada/i);
  });
});
