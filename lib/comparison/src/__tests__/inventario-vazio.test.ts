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

  it("só diz 'nunca chegou' depois de procurar a série no resto do banco", async () => {
    const tabela = (await getEntityTable(
      ctx.db,
      "CARRETA",
      COLUNAS_DO_CARTAO_CARRETA,
    ))!;

    // Aqui a carreta realmente não existe em lugar nenhum: nem com outro nome
    // no dicionário, nem em outra vigência ou unidade. É o que autoriza a
    // frase mais dura da tela.
    expect(tabela.elsewhere.aliasTypes).toEqual([]);
    expect(tabela.elsewhere.otherDeliveries).toEqual([]);
    expect(tabela.elsewhere.receivedNotPromoted).toEqual([]);
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

  it("a série que entrou com outra identidade é achada, e não dada por inexistente", async () => {
    /*
      O defeito que o operador viu: importou `Modelo_Carreta.xlsx` e a tela
      respondeu "nenhum arquivo de CARRETA foi importado". O arquivo tinha
      chegado — antes da correção de `deriveEntityType`, o nome da aba virava o
      tipo, e as 65 colunas entraram como MODELOCARRETA. Corrigir a regra não
      reescreve o que já está no banco, então a tela precisa achar a identidade
      vizinha em vez de mandar importar de novo o que já existe.

      Aqui a pergunta é feita ao contrário — pede-se MODELOCAVALO num banco que
      só conhece CAVALO — porque a vizinhança é a mesma relação, e assim o teste
      usa dado importado de verdade em vez de linhas plantadas à mão.
    */
    const tabela = (await getEntityTable(ctx.db, "MODELOCAVALO", [
      "modelocavalo.chassi",
      "modelocavalo.ano",
    ]))!;

    expect(tabela.rows).toHaveLength(0);
    expect(tabela.attributesKnown).toBe(0);

    const vizinho = tabela.elsewhere.aliasTypes[0];
    expect(vizinho?.entityType).toBe("CAVALO");
    expect(vizinho?.attributes).toBeGreaterThan(0);

    // E diz onde a série está: a vigência, o contexto e o rótulo do arquivo.
    expect(tabela.elsewhere.otherDeliveries.length).toBeGreaterThan(0);
    const entrega = tabela.elsewhere.otherDeliveries[0];
    expect(entrega.entityType).toBe("CAVALO");
    expect(entrega.sourceLabel).toMatch(/^EMPURRADA_/);
    expect(entrega.periodLabel).toMatch(/\/20\d\d$/);
  });

  it("a série que existe aqui não é anunciada como estando noutro lugar", async () => {
    const tabela = (await getEntityTable(ctx.db, "CAVALO", ["cavalo.chassi"]))!;

    // Diagnóstico é resposta para tabela vazia; com linhas na tela ele não é
    // calculado — nem cobrado do banco.
    expect(tabela.rows.length).toBeGreaterThan(0);
    expect(tabela.elsewhere).toEqual({
      aliasTypes: [],
      otherDeliveries: [],
      receivedNotPromoted: [],
    });
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

/**
 * O arquivo que chegou e parou no meio do caminho.
 *
 * Precisa vir por último no arquivo: recebe a carreta no RAW sem promover, e
 * os testes acima afirmam justamente que nada de carreta chegou ao banco.
 */
describe("o arquivo recebido que não virou vigência", () => {
  beforeAll(async () => {
    const { carreta } = modelExportPaths();
    const received = await receiveFile(ctx.db, { filePath: carreta });
    // De propósito só até o RAW: é o estado de quem importou, viu a tela de
    // pré-visualização e não promoveu — e depois foi cobrar o dado no cartão.
    await captureRaw(ctx.db, received.importRunId);
  }, 300_000);

  it("é nomeado, com o motivo, em vez de virar 'nunca foi importado'", async () => {
    const tabela = (await getEntityTable(
      ctx.db,
      "CARRETA",
      COLUNAS_DO_CARTAO_CARRETA,
    ))!;

    expect(tabela.attributesKnown).toBe(0);
    expect(tabela.elsewhere.aliasTypes).toEqual([]);
    expect(tabela.elsewhere.otherDeliveries).toEqual([]);

    const parado = tabela.elsewhere.receivedNotPromoted[0];
    expect(parado?.filename).toMatch(/Modelo_Carreta/);
    expect(parado?.sheetName).toBe("Modelo_Carreta");
    expect(parado?.sheetRole).toBe("SOURCE");
    // A importação parou antes de promover, e o estado dela é o diagnóstico.
    expect(parado?.importStatus).not.toBe("PROMOTED");
  });
});
