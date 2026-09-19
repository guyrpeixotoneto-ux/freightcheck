import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";

/**
 * `GET /finame/reconciliacao` — **os dois blocos da tela, na mesma conta.**
 *
 * A tela publicava o cartão "Impacto financeiro" e o painel "Evolução entre as
 * duas vigências" a um palmo um do outro, com uma observação no meio dizendo
 * que as bases eram diferentes. A pergunta que chegou foi: *"por que não batem
 * se estão na mesma tela?"*.
 *
 * O que este arquivo prende é a resposta, **de ponta a ponta e contra um banco
 * de verdade**: o degrau do cartão é o mesmo número de `/finame/comparacao`, o
 * saldo de baixo é o mesmo de `/finame/totais`, e a escada entre os dois fecha
 * na casa do centavo. Um teste de unidade prova a escada; só este prova que as
 * **três rotas** leem o mesmo acervo — que é onde a divergência nasceria de
 * novo, sem ninguém ver.
 *
 * A quitação está no cenário de propósito: é ela que produz a reclassificação
 * para outro módulo, que era exatamente a diferença que a observação antiga
 * tentava explicar em palavras.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;
let nomeDoBanco: string;

const FINAME: AttributeSpec[] = [
  {
    code: "cavalo.finame_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.amortizacao_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.juros_finame_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
  {
    code: "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
  },
];

const JULHO = "2026-07-02";
const AGOSTO = "2026-08-02";
const ESCOPO = "scope-finame-reconciliacao";

let vigencia: Record<string, string> = {};

async function get(caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json() };
}

const degrau = (body: any, recorte: string, chave: string) =>
  body.recortes[recorte].periodicidades
    .find((p: any) => p.periodicidade === "MENSAL")!
    .degraus.find((d: any) => d.chave === chave)!;

beforeAll(async () => {
  ctx = await createTestDatabase("api_finame_reconciliacao");
  process.env.DATABASE_URL = ctx.url;
  nomeDoBanco = ctx.url.replace(/^.*\//, "").replace(/\?.*$/, "");
  await seedTaxonomy(ctx.db, "test");

  const acervo = await buildFixture(
    ctx.db,
    FINAME,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          /* Quitada em agosto: amortização e juros zeram, e o que sobra na
             parcela passa a ser lucro fixo — rubrica de outro módulo. */
          QUI1A11: {
            "cavalo.finame_cavalo": 10_000,
            "cavalo.amortizacao_cavalo": 7_000,
            "cavalo.juros_finame_cavalo": 3_000,
            "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 0,
          },
          /* Reajuste simples: só a parcela se move. */
          REA2B22: { "cavalo.finame_cavalo": 1_000 },
          /* Sai da frota em agosto. */
          SAI3C33: { "cavalo.finame_cavalo": 4_000 },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          QUI1A11: {
            "cavalo.finame_cavalo": 2_500,
            "cavalo.amortizacao_cavalo": 0,
            "cavalo.juros_finame_cavalo": 0,
            "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 2_500,
          },
          REA2B22: { "cavalo.finame_cavalo": 1_200 },
          /* Entra na frota em agosto. */
          ENT4D44: { "cavalo.finame_cavalo": 6_000 },
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: ESCOPO, canal: "EMPURRADA" },
  );

  vigencia = {
    base: acervo.snapshotIds["EMPURRADA_2_7_2026"]!,
    comparada: acervo.snapshotIds["EMPURRADA_2_8_2026"]!,
  };

  const { default: finameRouter } = await import("../finame");
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    next();
  });
  app.use(finameRouter);
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

const par = () => `base=${vigencia.base}&comparada=${vigencia.comparada}`;

describe("GET /finame/reconciliacao", () => {
  it("exige as duas pontas", async () => {
    expect((await get("/finame/reconciliacao")).status).toBe(400);
  });

  it("fecha: saldo da base mais os movimentos é o saldo da comparada", async () => {
    const res = await get(`/finame/reconciliacao?${par()}`);
    expect(res.status).toBe(200);
    const escada = res.body.recortes.TODOS.periodicidades.find(
      (p: any) => p.periodicidade === "MENSAL",
    );
    expect(escada.fecha).toBe(true);
    expect(escada.residuo).toBe(0);

    /* Base: 10.000 + 1.000 + 4.000. Comparada: 2.500 + 1.200 + 6.000. */
    expect(degrau(res.body, "TODOS", "SALDO_BASE").valor).toBe(15_000);
    expect(degrau(res.body, "TODOS", "SALDO_COMPARADA").valor).toBe(9_700);

    const movimentos = escada.degraus
      .filter((d: any) => d.tipo === "MOVIMENTO")
      .reduce((s: number, d: any) => s + d.valor, 0);
    expect(15_000 + movimentos).toBeCloseTo(9_700, 2);
  });

  it("publica no degrau do cartão o mesmo número que a comparação publica", async () => {
    const [rec, comp] = await Promise.all([
      get(`/finame/reconciliacao?${par()}`),
      get(`/finame/comparacao?${par()}`),
    ]);
    /* A quitação: este módulo soma as partes (−7.000 e −3.000), não a parcela.
       O reajuste entra inteiro (+200). */
    expect(degrau(rec.body, "TODOS", "ALTERADO_COMPARADOS").valor).toBe(-9_800);
    expect(comp.body.resumo.impacto.porPeriodicidade.MENSAL).toBe(-9_800);
  });

  it("nomeia o que virou rubrica de outro módulo, com a placa", async () => {
    const res = await get(`/finame/reconciliacao?${par()}`);
    const d = degrau(res.body, "TODOS", "RECLASSIFICADO");
    /* A parcela caiu 7.500 e as partes somadas caíram 10.000: os 2.500 de
       diferença são o lucro fixo, que a Auditoria de Lucro Fixo soma. */
    expect(d.valor).toBe(2_500);
    expect(d.itens).toEqual([
      expect.objectContaining({
        placa: "QUI1A11",
        rubrica: "Lucro fixo do cavalo",
        base: 0,
        comparada: 2_500,
        valor: 2_500,
        nota: "Somado pela Auditoria de Lucro Fixo",
      }),
    ]);
  });

  it("usa a mesma leitura de frota que os totais, com o mesmo sinal", async () => {
    const [rec, totais] = await Promise.all([
      get(`/finame/reconciliacao?${par()}`),
      get(`/finame/totais?${par()}`),
    ]);
    const cavalo = totais.body.evolucao.find((e: any) => e.entityType === "CAVALO");
    expect(degrau(rec.body, "TODOS", "FROTA_EXISTENTE").valor).toBe(cavalo.alterados);
    expect(degrau(rec.body, "TODOS", "ENTRADAS").valor).toBe(cavalo.entradas);
    /* A saída é negativa aqui e positiva lá: é a escada que fixa a convenção,
       e o painel a escreve negativa a partir dela. */
    expect(degrau(rec.body, "TODOS", "SAIDAS").valor).toBe(-cavalo.saidas);
    expect(degrau(rec.body, "TODOS", "SAIDAS").itens[0]).toMatchObject({
      placa: "SAI3C33",
      base: 4_000,
      comparada: null,
      valor: -4_000,
    });
  });

  it("não deixa resíduo mudo: a linha do não explicado vem, valendo zero", async () => {
    const res = await get(`/finame/reconciliacao?${par()}`);
    const d = degrau(res.body, "TODOS", "NAO_EXPLICADO");
    expect(d.valor).toBe(0);
    expect(d.rotulo).toBe("Diferença não explicada");
  });
});
