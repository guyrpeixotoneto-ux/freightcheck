import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * `GET /velocidade-media/totais` — **de quem é a velocidade que ele devolve.**
 *
 * A última das seis telas de comparação a ganhar prova de comportamento sobre a
 * mesma regra (ver `finame-totais`, `ipva-totais` e `km-rodado-totais`). Aqui o
 * número da tela é o mais fácil de ler sem desconfiar: 55 km/h e 88 km/h são os
 * dois plausíveis, e um recorte vazado troca um pelo outro sem deixar rastro —
 * nenhum total infla, nenhuma célula fica vazia.
 *
 * Duas leituras por trecho bastam: a velocidade que a fonte declara e o ciclo
 * que ela paga, que é o que a partição do tempo lê da mesma linha.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

const minutos = (code: string): AttributeSpec => ({
  code,
  dataType: "NUMERIC",
  semanticsStatus: "CONFIRMED",
  unit: "MIN",
  aggregation: "SUM",
  isMonetary: false,
});

const CAMPOS: AttributeSpec[] = [
  {
    code: "trecho.velocidade_media_km_h",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "KM_H",
    aggregation: "AVG",
    isMonetary: false,
  },
  minutos("trecho.carga_horaria_por_trajeto_minuto"),
  minutos("trecho.tempo_trajeto_fabrica_cd_minuto"),
  minutos("trecho.tempo_interno_origem"),
  minutos("trecho.tempo_interno_destino"),
  minutos("trecho.tempo_refeicao_minuto"),
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

/** A velocidade declarada de uma ponta, como o cartão da tela a lê. */
function declarada(body: any, ponta: "BASE" | "COMPARADA"): number | null | undefined {
  return body.velocidade.find((v: any) => v.ponta === ponta)?.declaradaMedia;
}

/*
  O ciclo só se decompõe quando as três paradas existem: a soma delas é
  estrita, e um único nulo faz o tempo rodando virar nulo junto — ausência não
  vira zero, aqui como no resto do produto.
*/
const trecho = (velocidade: number, ciclo: number) => ({
  "trecho.velocidade_media_km_h": velocidade,
  "trecho.carga_horaria_por_trajeto_minuto": ciclo,
  "trecho.tempo_trajeto_fabrica_cd_minuto": 120,
  "trecho.tempo_interno_origem": 60,
  "trecho.tempo_interno_destino": 60,
  "trecho.tempo_refeicao_minuto": 40,
  "trecho.km_rodado": 200,
});

beforeAll(async () => {
  ctx = await createTestDatabase("api_velocidade_totais");
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
        data: { "CAMACARI-RECIFE": trecho(55, 600) },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: { "CAMACARI-RECIFE": trecho(50, 660) },
      },
    ],
    {
      entityType: "TRECHO",
      /* A vigência real entrega cavalo e trecho no mesmo arquivo; `'TRECHO'`
         puro é a casca que `listContexts` deixa de fora, e um acervo só de
         cascas não tem contexto nenhum — a rota responderia vazio por um motivo
         que não tem nada a ver com o recorte. */
      entityTypeSet: "CAVALO,TRECHO",
      scopeHash: "scope-velocidade-camacari",
      canal: "EMPURRADA",
    },
  );

  const pernambuco = await buildFixture(
    ctx.db,
    CAMPOS,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: { "SUAPE-PETROLINA": trecho(88, 400) },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: { "SUAPE-PETROLINA": trecho(84, 420) },
      },
    ],
    {
      entityType: "TRECHO",
      entityTypeSet: "CAVALO,TRECHO",
      scopeHash: "scope-velocidade-pernambuco",
      canal: "EMPURRADA",
    },
  );

  vigencia = {
    camacariBase: camacari.snapshotIds["EMPURRADA_2_7_2026"]!,
    camacariComparada: camacari.snapshotIds["EMPURRADA_2_8_2026"]!,
    pernambucoBase: pernambuco.snapshotIds["EMPURRADA_2_7_2026"]!,
    pernambucoComparada: pernambuco.snapshotIds["EMPURRADA_2_8_2026"]!,
  };

  const { default: velocidadeRouter } = await import("../velocidade-media");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(velocidadeRouter);
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

describe("GET /velocidade-media/totais", () => {
  it("lê os trechos da unidade do par, e não os da primeira do acervo", async () => {
    const res = await get(
      `/velocidade-media/totais?base=${vigencia.camacariBase}` +
        `&comparada=${vigencia.camacariComparada}`,
    );
    expect(res.status).toBe(200);
    expect(declarada(res.body, "BASE")).toBeCloseTo(55, 4);
    expect(declarada(res.body, "COMPARADA")).toBeCloseTo(50, 4);
  });

  it("lê os da outra unidade quando o par é o dela", async () => {
    const res = await get(
      `/velocidade-media/totais?base=${vigencia.pernambucoBase}` +
        `&comparada=${vigencia.pernambucoComparada}`,
    );
    expect(res.status).toBe(200);
    expect(declarada(res.body, "BASE")).toBeCloseTo(88, 4);
    expect(declarada(res.body, "COMPARADA")).toBeCloseTo(84, 4);
  });

  /* A partição do ciclo sai da mesma leitura: com o recorte vazado, ela
     descreveria o tempo pago de uma praça sob o nome da outra. */
  it("particiona o ciclo da unidade do par", async () => {
    const res = await get(
      `/velocidade-media/totais?base=${vigencia.pernambucoBase}` +
        `&comparada=${vigencia.pernambucoComparada}`,
    );
    const daBase = res.body.particao.find((p: any) => p.ponta === "BASE");
    expect(daBase.trechos).toBe(1);
    expect(daBase.cicloMedio).toBeCloseTo(400, 4);
  });
});
