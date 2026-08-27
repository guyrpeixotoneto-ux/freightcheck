import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTaxonomy } from "@workspace/curation";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { buildFixture } from "./fixtures";
import { computeMissingChangeSets } from "../consolidated";
import { getRangeAnalysis } from "../families-view";
import { getRadarDaCelula, getRadarDaUnidade } from "../radar";

/**
 * A leitura mínima do Radar — e a única coisa que ela não pode ser é
 * *parecida* com a leitura grande.
 *
 * `getRadarDaUnidade` existe para o Radar não pagar `entries` e `byParameter`
 * (97% dos 517 KB de `/changes/range`, medidos no seed do produto) para
 * desenhar 45 células. A economia só vale se os números forem **os mesmos** —
 * e "os mesmos" aqui não é uma aproximação aceitável: a grade e a Linha do
 * Tempo mostram o mesmo dinheiro do mesmo intervalo, lado a lado no produto.
 *
 * Por isso o teste central deste arquivo não verifica valores esperados
 * escritos à mão: ele compara as duas leituras **entre si**, sobre o mesmo
 * banco. Um valor à mão só provaria que alguém escreveu o mesmo número duas
 * vezes; a comparação prova que as duas rotas não podem divergir sem quebrar
 * a suíte.
 *
 * As duas partem da mesma `baseDoIntervalo` e chamam o mesmo
 * `montarMovimentosEGaps` — a igualdade é estrutural. Este arquivo é o que
 * impede alguém de desfazer isso sem perceber.
 */
let tdb: TestDb;
const scopeHash = "radar-min";
const canal = "EMPURRADA";

beforeAll(async () => {
  tdb = await createTestDatabase("radar_min");
  await seedTaxonomy(tdb.db, "teste:radar");

  await buildFixture(
    tdb.db,
    [
      { code: "carreta.custo_fixo", dataType: "NUMERIC", unit: "BRL", periodicity: "MENSAL", isMonetary: true, aggregation: "SUM", semanticsStatus: "CONFIRMED" },
      { code: "carreta.seguro", dataType: "NUMERIC", unit: "BRL", periodicity: "ANUAL", isMonetary: true, aggregation: "SUM", semanticsStatus: "CONFIRMED" },
      // Sem semântica confirmada não há preço apurado: é o caso "mexeu e não
      // dá para precificar", que a célula tem de continuar mostrando.
      { code: "carreta.observacao", dataType: "TEXT", semanticsStatus: "UNKNOWN" },
    ],
    [
      {
        label: "EMPURRADA_01_01_2026",
        effectiveDate: "2026-01-02",
        data: {
          AAA1A11: { "carreta.custo_fixo": 1000, "carreta.seguro": 12000, "carreta.observacao": "a" },
          BBB2B22: { "carreta.custo_fixo": 2000, "carreta.seguro": 24000, "carreta.observacao": "a" },
        },
      },
      {
        label: "EMPURRADA_01_02_2026",
        effectiveDate: "2026-02-02",
        data: {
          AAA1A11: { "carreta.custo_fixo": 1500, "carreta.seguro": 12000, "carreta.observacao": "b" },
          BBB2B22: { "carreta.custo_fixo": 1800, "carreta.seguro": 30000, "carreta.observacao": "a" },
        },
      },
      {
        label: "EMPURRADA_01_03_2026",
        effectiveDate: "2026-03-02",
        data: {
          AAA1A11: { "carreta.custo_fixo": 1500, "carreta.seguro": 9000, "carreta.observacao": "c" },
          BBB2B22: { "carreta.custo_fixo": 1900, "carreta.seguro": 30000, "carreta.observacao": "a" },
        },
      },
    ],
    { scopeHash, canal, entityType: "CARRETA" },
  );

  await computeMissingChangeSets(tdb.db, "teste:radar");
}, 120_000);

afterAll(async () => {
  await tdb?.drop();
});

const contexto = { scopeHash, channel: canal };

describe("getRadarDaUnidade", () => {
  it("devolve movements e gaps idênticos aos de getRangeAnalysis", async () => {
    const grande = await getRangeAnalysis(tdb.db, "2026-01-02", "2026-03-02", contexto);
    const minima = await getRadarDaUnidade(tdb.db, "2026-01-02", "2026-03-02", contexto);

    expect(minima).not.toBeNull();
    expect(minima!.movements).toEqual(grande!.movements);
    expect(minima!.gaps).toEqual(grande!.gaps);
    expect(minima!.from).toBe(grande!.from);
    expect(minima!.to).toBe(grande!.to);
  });

  it("bate em todas as janelas do histórico, não só na inteira", async () => {
    const pontas = ["2026-01-02", "2026-02-02", "2026-03-02"];
    for (const from of pontas) {
      for (const to of pontas) {
        const grande = await getRangeAnalysis(tdb.db, from, to, contexto);
        const minima = await getRadarDaUnidade(tdb.db, from, to, contexto);
        expect({ from, to, m: minima?.movements ?? null, g: minima?.gaps ?? null }).toEqual({
          from,
          to,
          m: grande?.movements ?? null,
          g: grande?.gaps ?? null,
        });
      }
    }
  });

  it("não devolve o que a grade não desenha", async () => {
    // O contrato mínimo é o ponto do exercício: um campo a mais aqui é um campo
    // a mais multiplicado por unidade, toda vez que o telão recarrega.
    const minima = await getRadarDaUnidade(tdb.db, "2026-01-02", "2026-03-02", contexto);
    expect(Object.keys(minima!).sort()).toEqual(["from", "gaps", "movements", "to"]);
    expect(JSON.stringify(minima)).not.toContain("entries");
    expect(JSON.stringify(minima)).not.toContain("byParameter");
  });

  it("uma vigência sem comparação continua sendo lacuna, e não zero", async () => {
    // A promessa central da grade: `sem-comparacao` ≠ `0 alterações`. Se a rota
    // mínima perdesse os gaps, a célula viraria um zero apurado.
    const minima = await getRadarDaUnidade(tdb.db, "2026-01-02", "2026-03-02", contexto);
    const grande = await getRangeAnalysis(tdb.db, "2026-01-02", "2026-03-02", contexto);
    expect(minima!.gaps.map((g) => g.period)).toEqual(grande!.gaps.map((g) => g.period));
  });

  it("contexto inexistente falha do mesmo jeito que a leitura grande", async () => {
    // Não é `null`: `resolveContext` levanta `ContextNotFoundError` com a lista
    // do que existe, e a rota mínima herda isso por usar a mesma base. O que
    // este teste guarda é a **igualdade** dos dois caminhos — uma rota nova que
    // engolisse o erro faria a tela mostrar grade vazia onde a outra explica.
    const pedido = { scopeHash: "nao-existe", channel: "NENHUM" };
    const erroDaMinima = await getRadarDaUnidade(tdb.db, undefined, undefined, pedido).catch((e) => e);
    const erroDaGrande = await getRangeAnalysis(tdb.db, undefined, undefined, pedido).catch((e) => e);
    expect(erroDaMinima).toBeInstanceOf(Error);
    expect(erroDaMinima.constructor.name).toBe(erroDaGrande.constructor.name);
    expect(erroDaMinima.message).toBe(erroDaGrande.message);
  });
});

describe("getRadarDaCelula", () => {
  it("devolve os mesmos atributos que os entries daquela vigência", async () => {
    const grande = await getRangeAnalysis(tdb.db, "2026-01-02", "2026-03-02", contexto);
    for (const period of ["2026-02-02", "2026-03-02"]) {
      const esperado = grande!.entries
        .filter((e) => e.period === period)
        .map((e) => ({
          period: e.period,
          parameterKey: e.parameterKey,
          parameterName: e.parameterName,
          family: e.family,
          attributeCode: e.attributeCode,
          amount: e.amount,
          periodicity: e.periodicity,
        }))
        .sort((a, b) => a.parameterKey.localeCompare(b.parameterKey));

      const obtido = (await getRadarDaCelula(tdb.db, period, "2026-01-02", "2026-03-02", contexto))!
        .slice()
        .sort((a, b) => a.parameterKey.localeCompare(b.parameterKey));

      expect(obtido).toEqual(esperado);
    }
  });

  it("é uma entrada por grupo, e não por linha de mudança", async () => {
    // A contagem que a gaveta imprime (`N alterações` por atributo) conta
    // entradas. Uma entrada por linha inflaria a coluna de um atributo que
    // mudou em dois veículos com o mesmo padrão.
    const grande = await getRangeAnalysis(tdb.db, "2026-01-02", "2026-03-02", contexto);
    const obtido = await getRadarDaCelula(tdb.db, "2026-02-02", "2026-01-02", "2026-03-02", contexto);
    expect(obtido!.length).toBe(grande!.entries.filter((e) => e.period === "2026-02-02").length);
  });

  it("o recorte por vigência é do servidor — outra vigência não vaza", async () => {
    // Esta regra morava na tela (`atributosDaCelula` filtrava por `period`) e
    // mudou de camada quando a rota passou a responder por uma vigência.
    const obtido = await getRadarDaCelula(tdb.db, "2026-03-02", "2026-01-02", "2026-03-02", contexto);
    expect(obtido!.every((e) => e.period === "2026-03-02")).toBe(true);
    expect(obtido!.length).toBeGreaterThan(0);
  });

  it("atributo sem preço apurado aparece com amount nulo, e não some", async () => {
    const obtido = await getRadarDaCelula(tdb.db, "2026-02-02", "2026-01-02", "2026-03-02", contexto);
    const semPreco = obtido!.filter((e) => e.amount === null);
    expect(semPreco.length).toBeGreaterThan(0);
  });

  it("vigência fora do intervalo devolve lista vazia, não erro", async () => {
    const obtido = await getRadarDaCelula(tdb.db, "2025-01-01", "2026-01-02", "2026-03-02", contexto);
    expect(obtido).toEqual([]);
  });
});

/**
 * `sem_leitura_no_intervalo` — a exclusão que o Radar deixou de aplicar.
 *
 * Ao tirar `/changes/range/overview` do caminho do Radar (Parte V), a grade
 * passou a montar as linhas a partir do `/contexts`. O overview aplicava, além
 * da régua de canal ambíguo, uma segunda exclusão: a unidade cuja leitura do
 * intervalo voltasse `null`. A Parte V registrou isso como "mudança de
 * comportamento pequena e declarada" — e declarar não é provar.
 *
 * Estes testes existem para responder o que a exclusão de fato significa,
 * antes de consolidar a mudança. A resposta é que **ela não pode acontecer**:
 * `listContexts` e `listPeriods` aplicam exatamente os mesmos três filtros
 * (`status <> 'SUPERSEDED'`, import não escondido, `naoEhSoTrecho`), então um
 * contexto que saiu da primeira tem, por construção, ao menos uma vigência na
 * segunda. O ramo é defensivo e inalcançável pelo caminho que o alimenta.
 *
 * Os dois testes abaixo tentam alcançá-lo de propósito. Se algum dia um deles
 * passar a falhar, a exclusão virou real e o Radar precisa voltar a aplicá-la.
 */
describe("sem_leitura_no_intervalo", () => {
  it("nenhum contexto vivo produz leitura nula — o gatilho não dispara", async () => {
    const { listContexts } = await import("../series");
    const contexts = await listContexts(tdb.db);
    expect(contexts.length).toBeGreaterThan(0);

    for (const c of contexts) {
      for (const janela of [
        [undefined, undefined],
        ["2026-01-02", "2026-03-02"],
        ["2026-03-02", "2026-03-02"],
      ] as const) {
        const leitura = await getRangeAnalysis(
          tdb.db,
          janela[0],
          janela[1],
          { scopeHash: c.scopeHash, channel: c.channel },
          undefined,
          contexts,
        );
        expect(leitura).not.toBeNull();
      }
    }
  });

  it("esconder o import tira a unidade das DUAS listas, e não de uma só", async () => {
    /*
      A tentativa de forçar o caso. Esconder o import é o jeito mais direto de
      fazer uma unidade "não ter leitura" — e o que se observa é que ela
      desaparece também de `listContexts`, que é o outro lado do filtro. Não
      sobra a combinação que a exclusão descreve (está na lista **e** não tem
      leitura), e é por isso que o Radar montar as linhas do `/contexts` não
      perde nenhuma unidade que o overview tiraria.
    */
    const { importRunTable, snapshotTable } = await import("@workspace/db");
    const { listContexts } = await import("../series");
    const { eq, inArray } = await import("drizzle-orm");

    const antes = await listContexts(tdb.db);
    expect(antes.length).toBe(1);

    const snaps = await tdb.db
      .select({ importRunId: snapshotTable.importRunId })
      .from(snapshotTable)
      .where(eq(snapshotTable.scopeHash, scopeHash));
    const runs = [...new Set(snaps.map((s) => s.importRunId))];

    await tdb.db
      .update(importRunTable)
      .set({ hiddenAt: new Date() })
      .where(inArray(importRunTable.id, runs));

    try {
      const depois = await listContexts(tdb.db);
      // Sumiu da lista de contextos: não há unidade "na grade sem leitura".
      expect(depois.length).toBe(0);
    } finally {
      await tdb.db
        .update(importRunTable)
        .set({ hiddenAt: null })
        .where(inArray(importRunTable.id, runs));
    }

    expect((await listContexts(tdb.db)).length).toBe(1);
  });
});
