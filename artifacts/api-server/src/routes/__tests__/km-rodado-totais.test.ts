import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * `GET /km-rodado/totais` — **de quem é o preço por km que ele devolve.**
 *
 * A terceira prova de comportamento da mesma regra (ver `finame-totais` e
 * `ipva-totais`), e a primeira sobre uma leitura que **não é de veículo**: a
 * entidade aqui é o trecho, e o número da tela não é uma soma, é uma média
 * entre trechos. Um recorte vazado não aparece como total inflado — aparece
 * como um R$/km plausível, da praça errada, e é por isso que ele merece caso
 * próprio em vez de confiança por analogia.
 *
 * Os dois componentes bastam para o preço existir: ele é a soma das razões
 * declaradas, e a margem é a parcela que fica fora do custo.
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

const CAMPOS: AttributeSpec[] = [
  razao("trecho.frete_reais_km_diesel"),
  razao("trecho.frete_reais_km_lucro_variavel"),
  {
    code: "trecho.km_rodado",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "KM",
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

/** O preço médio de uma ponta, como o cartão da tela o lê. */
function precoMedio(body: any, ponta: "BASE" | "COMPARADA"): number | null | undefined {
  return body.preco.find((p: any) => p.ponta === ponta)?.media;
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_km_totais");
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
          "CAMACARI-RECIFE": {
            "trecho.frete_reais_km_diesel": 1.0,
            "trecho.frete_reais_km_lucro_variavel": 0.5,
            "trecho.km_rodado": 800,
          },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          "CAMACARI-RECIFE": {
            "trecho.frete_reais_km_diesel": 1.2,
            "trecho.frete_reais_km_lucro_variavel": 0.5,
            "trecho.km_rodado": 800,
          },
        },
      },
    ],
    {
      entityType: "TRECHO",
      /* A vigência real entrega cavalo e trecho no mesmo arquivo; `'TRECHO'` puro
         é a casca que `listContexts` deixa de fora, e um acervo só de cascas não
         tem contexto nenhum — a rota responderia vazio por um motivo que não
         tem nada a ver com o recorte. */
      entityTypeSet: "CAVALO,TRECHO",
      scopeHash: "scope-km-camacari",
      canal: "EMPURRADA",
    },
  );

  /* A outra praça, nas mesmas datas e com preço de outra ordem: um vazamento
     não se esconde numa casa decimal. */
  const pernambuco = await buildFixture(
    ctx.db,
    CAMPOS,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          "SUAPE-PETROLINA": {
            "trecho.frete_reais_km_diesel": 6.0,
            "trecho.frete_reais_km_lucro_variavel": 1.0,
            "trecho.km_rodado": 1400,
          },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          "SUAPE-PETROLINA": {
            "trecho.frete_reais_km_diesel": 5.0,
            "trecho.frete_reais_km_lucro_variavel": 1.0,
            "trecho.km_rodado": 1400,
          },
        },
      },
    ],
    {
      entityType: "TRECHO",
      entityTypeSet: "CAVALO,TRECHO",
      scopeHash: "scope-km-pernambuco",
      canal: "EMPURRADA",
    },
  );

  vigencia = {
    camacariBase: camacari.snapshotIds["EMPURRADA_2_7_2026"]!,
    camacariComparada: camacari.snapshotIds["EMPURRADA_2_8_2026"]!,
    pernambucoBase: pernambuco.snapshotIds["EMPURRADA_2_7_2026"]!,
    pernambucoComparada: pernambuco.snapshotIds["EMPURRADA_2_8_2026"]!,
  };

  const { default: kmRouter } = await import("../km-rodado");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(kmRouter);
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

describe("GET /km-rodado/totais", () => {
  it("lê os trechos da unidade do par, e não os da primeira do acervo", async () => {
    const res = await get(
      `/km-rodado/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    expect(res.status).toBe(200);
    expect(precoMedio(res.body, "BASE")).toBeCloseTo(1.5, 4);
    expect(precoMedio(res.body, "COMPARADA")).toBeCloseTo(1.7, 4);
  });

  it("lê os da outra unidade quando o par é o dela", async () => {
    const res = await get(
      `/km-rodado/totais?base=${vigencia.pernambucoBase}&comparada=${vigencia.pernambucoComparada}`,
    );
    expect(res.status).toBe(200);
    expect(precoMedio(res.body, "BASE")).toBeCloseTo(7.0, 4);
    expect(precoMedio(res.body, "COMPARADA")).toBeCloseTo(6.0, 4);
  });

  /* A composição sai da mesma leitura: com o recorte vazado, ela descreveria o
     diesel de uma praça sob o nome da outra. */
  it("compõe o preço com o diesel da unidade do par", async () => {
    const res = await get(
      `/km-rodado/totais?base=${vigencia.pernambucoBase}&comparada=${vigencia.pernambucoComparada}`,
    );
    const diesel = res.body.composicao.find(
      (c: any) => c.componente === "diesel" && c.ponta === "BASE",
    );
    expect(diesel.media).toBeCloseTo(6.0, 4);
  });
});
