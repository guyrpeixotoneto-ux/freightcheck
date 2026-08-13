import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, modelExportPaths, type TestDb } from "@workspace/ingest/testing";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { getEntityTable } from "../grouped";

/**
 * Um inventário vazio precisa dizer **qual** dos vazios ele é.
 *
 * O cartão CARRETA abria com "0 ativos · 0 colunas" e a frase "38 colunas deste
 * cartão não existem no dicionário do export". A frase era verdadeira e
 * respondia à pergunta errada: as 38 colunas existem no Freightech e existiriam
 * aqui — o que faltava era o **arquivo da carreta**, nunca importado naquele
 * ambiente. Sem coluna nenhuma de carreta no dicionário, todas caem em
 * `missingColumns` de uma vez, e a tela culpava o cartão por uma planilha que
 * ninguém mandou.
 *
 * As duas causas mandam fazer coisas opostas — uma manda importar, a outra
 * manda conferir o cartão — e por isso a resposta agora carrega o diagnóstico.
 *
 * Este arquivo importa **só o cavalo**, de propósito: é o ambiente que produziu
 * o defeito.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("inventario_vazio");
  const { cavalo } = modelExportPaths();
  const received = await receiveFile(ctx.db, { filePath: cavalo });
  await captureRaw(ctx.db, received.importRunId);
  await stage(ctx.db, received.importRunId);
  await preview(ctx.db, received.importRunId);
  await promote(ctx.db, received.importRunId);
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

const COLUNAS_DO_CARTAO_CARRETA = [
  "carreta.placa",
  "carreta.data",
  "carreta.implemento",
  "carreta.chassi",
  "carreta.ciclo",
];

describe("a série que nunca foi importada", () => {
  it("não é confundida com um cartão que pede colunas erradas", async () => {
    const tabela = (await getEntityTable(
      ctx.db,
      "CARRETA",
      COLUNAS_DO_CARTAO_CARRETA,
    ))!;

    expect(tabela.rows).toHaveLength(0);
    expect(tabela.missingColumns).toEqual(COLUNAS_DO_CARTAO_CARRETA);

    // O diagnóstico: nenhuma coluna de carreta no dicionário, e a vigência não
    // entregou a série. É o par que a tela lê para dizer "falta o arquivo".
    expect(tabela.attributesKnown).toBe(0);
    expect(tabela.seriesDelivered).toBe(false);
  });

  it("o cavalo, que foi importado, continua respondendo com dado", async () => {
    const tabela = (await getEntityTable(ctx.db, "CAVALO", [
      "cavalo.chassi",
      "cavalo.ano",
      "cavalo.montadora",
    ]))!;

    expect(tabela.seriesDelivered).toBe(true);
    expect(tabela.attributesKnown).toBeGreaterThan(0);
    expect(tabela.missingColumns).toEqual([]);
    expect(tabela.rows.length).toBeGreaterThan(0);
  });

  it("uma coluna inventada continua sendo dita como desconhecida, e não como arquivo faltando", async () => {
    const tabela = (await getEntityTable(ctx.db, "CAVALO", [
      "cavalo.chassi",
      "cavalo.coluna_que_a_ambev_nunca_mandou",
    ]))!;

    expect(tabela.missingColumns).toEqual(["cavalo.coluna_que_a_ambev_nunca_mandou"]);
    // A série está lá; o que falta é a coluna. A tela não pode mandar importar.
    expect(tabela.seriesDelivered).toBe(true);
    expect(tabela.rows.length).toBeGreaterThan(0);
  });
});
