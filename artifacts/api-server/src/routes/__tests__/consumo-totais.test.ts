import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * `GET /consumo/totais` — **de quem é o diesel que ele devolve.**
 *
 * A mesma prova de isolamento das rotas de totais anteriores (ver
 * `km-rodado-totais` e `pneu-totais`), e aqui ela carrega mais peso do que em
 * qualquer outra: o preço do litro de referência é a **mediana entre os trechos
 * da vigência**, e uma mediana calculada sobre a praça errada não erra por uma
 * casa decimal — ela desloca a régua inteira e passa a acusar como desviantes os
 * trechos corretos.
 *
 * O caso central é o achado desta rubrica: o preço do litro **não é coluna de
 * lugar nenhum**. Ele é `R$/km × km/l`, e é comparando esse produto entre trechos
 * da mesma vigência que aparece o percurso precificado sobre outra premissa de
 * combustível — coisa que nenhum delta entre vigências enxerga.
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

const rendimento = (code: string): AttributeSpec => ({
  code,
  dataType: "NUMERIC",
  semanticsStatus: "CONFIRMED",
  unit: "KM_L",
  aggregation: "AVG",
  isMonetary: false,
});

const CAMPOS: AttributeSpec[] = [
  razao("trecho.diesel_consumo_diesel_reais_km"),
  razao("trecho.frete_reais_km_diesel"),
  rendimento("trecho.diesel_consumo_km_l"),
  rendimento("trecho.consumo_diesel_ajustado"),
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

/** A conferência de uma ponta — onde mora o preço do litro. */
function conferencia(body: any, ponta: "BASE" | "COMPARADA"): any {
  return body.conferencias.find((c: any) => c.ponta === ponta);
}

/**
 * Um trecho coerente com um diesel de `precoDoLitro` reais.
 *
 * O R$/km sai do preço dividido pelo rendimento ajustado, que é a conta que o
 * modelo faz — e é ela, invertida, que a tela recupera. Escrever o R$/km à mão
 * faria o caso provar a aritmética do teste em vez da da rota.
 */
function trecho(precoDoLitro: number, ajustado: number, kmLitro: number) {
  return {
    "trecho.diesel_consumo_diesel_reais_km": precoDoLitro / ajustado,
    "trecho.frete_reais_km_diesel": precoDoLitro / ajustado,
    "trecho.diesel_consumo_km_l": kmLitro,
    "trecho.consumo_diesel_ajustado": ajustado,
    "trecho.km_rodado": 800,
  };
}

beforeAll(async () => {
  ctx = await createTestDatabase("api_consumo_totais");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");
  await seedTaxonomy(ctx.db, "test");

  /*
    Camaçari: três trechos a R$ 6,00 o litro e um a R$ 9,00 na comparada. A
    mediana continua em 6,00 — é para isso que ela existe —, e o quarto trecho
    sai acusado.
  */
  const camacari = await buildFixture(
    ctx.db,
    CAMPOS,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          "CAMACARI-RECIFE": trecho(6, 2.5, 2.8),
          "CAMACARI-ARACAJU": trecho(6, 2.0, 2.3),
          "CAMACARI-ILHEUS": trecho(6, 3.0, 3.2),
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          "CAMACARI-RECIFE": trecho(6, 2.5, 2.8),
          "CAMACARI-ARACAJU": trecho(6, 2.0, 2.3),
          "CAMACARI-ILHEUS": trecho(9, 3.0, 3.2),
        },
      },
    ],
    {
      entityType: "TRECHO",
      /* A vigência real entrega cavalo e trecho no mesmo arquivo; `'TRECHO'` puro
         é a casca que `listContexts` deixa de fora. */
      entityTypeSet: "CAVALO,TRECHO",
      scopeHash: "scope-consumo-camacari",
      canal: "EMPURRADA",
    },
  );

  /* A outra praça, nas mesmas datas e com um diesel de outra ordem: uma mediana
     vazada não se esconde numa casa decimal. */
  const pernambuco = await buildFixture(
    ctx.db,
    CAMPOS,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: { "SUAPE-PETROLINA": trecho(4, 2.0, 2.2) },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: { "SUAPE-PETROLINA": trecho(4, 2.0, 2.2) },
      },
    ],
    {
      entityType: "TRECHO",
      entityTypeSet: "CAVALO,TRECHO",
      scopeHash: "scope-consumo-pernambuco",
      canal: "EMPURRADA",
    },
  );

  vigencia = {
    camacariBase: camacari.snapshotIds["EMPURRADA_2_7_2026"]!,
    camacariComparada: camacari.snapshotIds["EMPURRADA_2_8_2026"]!,
    pernambucoBase: pernambuco.snapshotIds["EMPURRADA_2_7_2026"]!,
    pernambucoComparada: pernambuco.snapshotIds["EMPURRADA_2_8_2026"]!,
  };

  const { default: consumoRouter } = await import("../consumo");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(consumoRouter);
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

describe("GET /consumo/totais", () => {
  /* O número que nenhuma coluna declara, recuperado da unidade certa. */
  it("devolve o diesel praticado na unidade do par", async () => {
    const res = await get(
      `/consumo/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    expect(res.status).toBe(200);
    expect(conferencia(res.body, "BASE").precoDoLitroDeReferencia).toBeCloseTo(6, 2);
  });

  it("lê o da outra unidade quando o par é o dela", async () => {
    const res = await get(
      `/consumo/totais?base=${vigencia.pernambucoBase}&comparada=${vigencia.pernambucoComparada}`,
    );
    expect(res.status).toBe(200);
    expect(conferencia(res.body, "BASE").precoDoLitroDeReferencia).toBeCloseTo(4, 2);
  });

  /*
    A leitura própria desta tela: o trecho precificado sobre outro diesel. Na
    base os três concordam; na comparada um deles passou a embutir R$ 9,00 o
    litro, e a mediana — que continua em 6,00, porque é mediana — o acusa.
  */
  it("acusa o trecho precificado sobre outra premissa de diesel", async () => {
    const res = await get(
      `/consumo/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    expect(conferencia(res.body, "BASE").litroDestoa).toBe(0);
    expect(conferencia(res.body, "BASE").confere).toBe(3);

    const comparada = conferencia(res.body, "COMPARADA");
    expect(comparada.precoDoLitroDeReferencia).toBeCloseTo(6, 2);
    expect(comparada.litroDestoa).toBe(1);
    expect(comparada.precoDoLitroMaximo).toBeCloseTo(9, 2);
  });

  /* O rendimento é média simples entre trechos, e a perda é a distância medida
     entre os dois rendimentos — nunca a soma das três colunas de perda. */
  it("devolve o rendimento da unidade do par, com a perda medida", async () => {
    const res = await get(
      `/consumo/totais?base=${vigencia.camacariBase}&comparada=${vigencia.camacariComparada}`,
    );
    const base = res.body.rendimento.find((r: any) => r.ponta === "BASE");
    expect(base.trechos).toBe(3);
    // (2,8 + 2,3 + 3,2) / 3
    expect(base.kmLitroMedio).toBeCloseTo(2.77, 1);
    expect(base.ajustadoMedio).toBeCloseTo(2.5, 1);
    expect(base.perdaMedidaEmPontos).toBeGreaterThan(0);
  });

  it("sem par, recusa com 400 e diz o que falta", async () => {
    const res = await get(`/consumo/totais?comparada=${vigencia.camacariComparada}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/base e comparada/i);
  });
});
