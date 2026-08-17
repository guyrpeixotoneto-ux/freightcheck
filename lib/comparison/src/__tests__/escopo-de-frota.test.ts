import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTaxonomy } from "@workspace/curation";
import {
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { buildFixture, type AttributeSpec } from "./fixtures";
import { listarFrota } from "../ativos";
import {
  getTicketClassification,
  getTicketTotals,
  getTicketsByParameter,
  listTicketChanges,
} from "../chamados";
import { getConsolidated } from "../consolidated";
import { lerEscopo, temEscopo } from "../escopo";
import { getQuinzenaMatrix } from "../impacto";
import { getChangeSetBreakdown, totaisDoEscopo } from "../query";

/**
 * O escopo de frota — o que Cavalo 360° e Carreta 360° pedem às mesmas leituras
 * de Alterações.
 *
 * O que este arquivo protege é uma única frase: **escopo não é filtro**. Um
 * filtro estreita a lista dentro de uma população anunciada; um escopo troca a
 * população, e por isso ele tem de alcançar os cartões, os painéis e os totais.
 * Uma tela chamada "Cavalo 360°" mostrando 3 alterações na lista e 5 no cartão
 * é a mentira mais fácil de escrever aqui — e a mais difícil de perceber
 * lendo a tela, porque os dois números parecem igualmente verdadeiros.
 *
 * Duas provas sustentam a recontagem, e nenhuma é opcional:
 *
 * 1. **A identidade.** Com escopo vazio, `totaisDoEscopo` devolve exatamente o
 *    que o motor gravou em `change_set`. Sem isso, a recontagem seria uma
 *    segunda verdade financeira esperando para divergir da primeira.
 * 2. **A partição.** Cavalo mais carreta somam o todo, em cada número e em cada
 *    periodicidade. É o que impede um recorte de perder linha pelo caminho —
 *    uma alteração que não caia em nenhum dos dois escopos sumiria das duas
 *    telas 360° sem aparecer em lugar nenhum.
 */

let ctx: TestDb;
const SCOPE = "scope-escopo-frota";

const CARRETA: AttributeSpec[] = [
  {
    code: "carreta.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

const CAVALO: AttributeSpec[] = [
  {
    code: "cavalo.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
  {
    code: "cavalo.ipva",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

let envioId: string;

beforeAll(async () => {
  ctx = await createTestDatabase("escopo_de_frota");
  await seedTaxonomy(ctx.db, "test");

  /*
    Duas carretas e dois cavalos, e cada equipamento com um ativo que mexe e
    outro que não. O que não mexe é o ponto: ele não existe em lista de
    alteração nenhuma, e é ele que separa a leitura da frota (que o conhece) da
    leitura da alteração (que não o conhece).
  */
  await buildFixture(
    ctx.db,
    CARRETA,
    [
      {
        label: "CAR_JAN",
        effectiveDate: "2026-01-01",
        data: {
          AAA1A11: { "carreta.custo_fixo": 1000 },
          AAA2A22: { "carreta.custo_fixo": 2000 },
        },
      },
      {
        label: "CAR_FEV",
        effectiveDate: "2026-02-01",
        data: {
          AAA1A11: { "carreta.custo_fixo": 1300 },
          AAA2A22: { "carreta.custo_fixo": 2000 },
        },
      },
    ],
    { entityType: "CARRETA", scopeHash: SCOPE },
  );

  await buildFixture(
    ctx.db,
    CAVALO,
    [
      {
        label: "CAV_JAN",
        effectiveDate: "2026-01-01",
        data: {
          BBB1B11: { "cavalo.custo_fixo": 5000, "cavalo.ipva": 12000 },
          BBB2B22: { "cavalo.custo_fixo": 4000, "cavalo.ipva": 8000 },
        },
      },
      {
        label: "CAV_FEV",
        effectiveDate: "2026-02-01",
        data: {
          BBB1B11: { "cavalo.custo_fixo": 5500, "cavalo.ipva": 9000 },
          BBB2B22: { "cavalo.custo_fixo": 4000, "cavalo.ipva": 8000 },
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: SCOPE },
  );

  // --- os chamados, sintéticos e com placa -----------------------------------
  const [envio] = await ctx.db
    .insert(ticketImportTable)
    .values({
      filename: "chamados.xlsx",
      contentSha256: `sha-escopo-${Date.now()}`,
      byteSize: 1,
      status: "READ",
      rowCount: 3,
      ticketCount: 3,
    })
    .returning();
  envioId = envio.id;

  const [doCavalo, doOutroCavalo, daCarreta] = await ctx.db
    .insert(ticketTable)
    .values([
      {
        ticketImportId: envioId,
        externalId: "CH-1",
        statusBucket: "ATENDIDO",
        sourceRowIndex: 1,
        entityLabel: "BBB1B11",
        entityType: "CAVALO",
        changedParameterCount: 2,
      },
      {
        ticketImportId: envioId,
        externalId: "CH-2",
        statusBucket: "ABERTO",
        sourceRowIndex: 2,
        entityLabel: "BBB2B22",
        entityType: "CAVALO",
        changedParameterCount: 1,
      },
      {
        ticketImportId: envioId,
        externalId: "CH-3",
        statusBucket: "ATENDIDO",
        sourceRowIndex: 3,
        entityLabel: "AAA1A11",
        entityType: "CARRETA",
        changedParameterCount: 1,
      },
    ])
    .returning();

  await ctx.db.insert(ticketChangeTable).values([
    {
      ticketId: doCavalo.id,
      ticketImportId: envioId,
      parameterLabel: "Frete peso",
      entityLabel: "BBB1B11",
      entityType: "CAVALO",
      sourceColumnIndex: 0,
      changeKind: "SET",
      beforeSource: "ARQUIVO",
      deltaAbsolute: "10",
      impactAmount: "10",
      impactConfidence: "CALCULATED",
    },
    {
      ticketId: doCavalo.id,
      ticketImportId: envioId,
      parameterLabel: "Pedágio",
      entityLabel: "BBB1B11",
      entityType: "CAVALO",
      sourceColumnIndex: 1,
      changeKind: "SET",
      beforeSource: "VIGENCIA",
      deltaAbsolute: "-5",
    },
    {
      ticketId: doOutroCavalo.id,
      ticketImportId: envioId,
      parameterLabel: "Frete peso",
      entityLabel: "BBB2B22",
      entityType: "CAVALO",
      sourceColumnIndex: 0,
      changeKind: "SET",
      beforeSource: "ARQUIVO",
      deltaAbsolute: "7",
      impactAmount: "7",
      impactConfidence: "CALCULATED",
    },
    {
      ticketId: daCarreta.id,
      ticketImportId: envioId,
      parameterLabel: "Frete peso",
      entityLabel: "AAA1A11",
      entityType: "CARRETA",
      sourceColumnIndex: 0,
      changeKind: "SET",
      beforeSource: "ARQUIVO",
      deltaAbsolute: "3",
      impactAmount: "3",
      impactConfidence: "CALCULATED",
    },
  ]);
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

const idsDoPeriodo = async () =>
  (await getConsolidated(ctx.db, "2026-02-01"))!.changeSetIds;

describe("o vocabulário", () => {
  it("descarta o vazio, que não estreita nada", () => {
    expect(lerEscopo({ entityType: "", plate: "  " })).toEqual({});
    expect(temEscopo({})).toBe(false);
    expect(temEscopo(undefined)).toBe(false);
  });

  it("lê o que veio escrito, sem espaço em volta", () => {
    expect(lerEscopo({ entityType: " CAVALO ", plate: " BBB1B11 " })).toEqual({
      entityType: "CAVALO",
      plate: "BBB1B11",
    });
    expect(temEscopo({ plate: "BBB1B11" })).toBe(true);
  });
});

describe("os totais recontados", () => {
  it("com escopo vazio, são exatamente os que o motor gravou", async () => {
    const view = (await getConsolidated(ctx.db, "2026-02-01"))!;
    const totais = await totaisDoEscopo(ctx.db, view.changeSetIds);

    // A identidade: a recontagem não é uma segunda opinião sobre a comparação.
    expect(totais.valueChanges).toBe(view.totals.valueChanges);
    expect(totais.entitiesAdded).toBe(view.totals.entitiesAdded);
    expect(totais.entitiesRemoved).toBe(view.totals.entitiesRemoved);
    expect(totais.inconclusive).toBe(view.totals.inconclusive);
    expect(totais.impactNotCalculable).toBe(view.totals.impactNotCalculable);
    expect(totais.impactByPeriodicity).toEqual(view.impactByPeriodicity);
  });

  it("recortam a população, e não só a lista", async () => {
    const ids = await idsDoPeriodo();
    const cavalo = await totaisDoEscopo(ctx.db, ids, { entityType: "CAVALO" });

    // 5000→5500 e 12000→9000 no BBB1B11; o BBB2B22 não mexeu em nada.
    expect(cavalo.valueChanges).toBe(2);
    expect(cavalo.impactByPeriodicity).toEqual({ MENSAL: 500, ANUAL: -3000 });
  });

  it("somam o todo: cavalo mais carreta é a frota, número a número", async () => {
    const ids = await idsDoPeriodo();
    const [tudo, cavalo, carreta] = await Promise.all([
      totaisDoEscopo(ctx.db, ids),
      totaisDoEscopo(ctx.db, ids, { entityType: "CAVALO" }),
      totaisDoEscopo(ctx.db, ids, { entityType: "CARRETA" }),
    ]);

    expect(cavalo.valueChanges + carreta.valueChanges).toBe(tudo.valueChanges);
    expect(cavalo.inconclusive + carreta.inconclusive).toBe(tudo.inconclusive);
    expect(cavalo.impactNotCalculable + carreta.impactNotCalculable).toBe(
      tudo.impactNotCalculable,
    );
    expect(
      (cavalo.impactByPeriodicity.MENSAL ?? 0) +
        (carreta.impactByPeriodicity.MENSAL ?? 0),
    ).toBe(tudo.impactByPeriodicity.MENSAL);
  });

  it("descem até a placa", async () => {
    const ids = await idsDoPeriodo();
    const mexeu = await totaisDoEscopo(ctx.db, ids, {
      entityType: "CAVALO",
      plate: "BBB1B11",
    });
    const parado = await totaisDoEscopo(ctx.db, ids, {
      entityType: "CAVALO",
      plate: "BBB2B22",
    });

    expect(mexeu.valueChanges).toBe(2);
    expect(mexeu.impactByPeriodicity).toEqual({ MENSAL: 500, ANUAL: -3000 });

    // O ativo que não mexeu: zero alterações, e **não** ausência de tela. É o
    // caso que a aba Impacto existe para cobrir — ver `ativos.ts`.
    expect(parado.valueChanges).toBe(0);
    expect(parado.impactByPeriodicity).toEqual({});
  });

  it("nunca somam periodicidades diferentes", async () => {
    const ids = await idsDoPeriodo();
    const cavalo = await totaisDoEscopo(ctx.db, ids, { entityType: "CAVALO" });
    // Somar daria −2500, que não quer dizer nada.
    expect(Object.keys(cavalo.impactByPeriodicity).sort()).toEqual([
      "ANUAL",
      "MENSAL",
    ]);
  });
});

describe("os painéis de concentração", () => {
  it("só mostram atributos do equipamento em escopo", async () => {
    const ids = await idsDoPeriodo();
    const cavalo = await getChangeSetBreakdown(ctx.db, ids, {
      entityType: "CAVALO",
    });
    const codigos = cavalo.byAttribute.map((a) => a.attributeCode);

    expect(codigos.sort()).toEqual(["cavalo.custo_fixo", "cavalo.ipva"]);
    expect(codigos.some((c) => c.startsWith("carreta."))).toBe(false);
  });

  it("fecham com os totais do mesmo escopo", async () => {
    const ids = await idsDoPeriodo();
    const [breakdown, totais] = await Promise.all([
      getChangeSetBreakdown(ctx.db, ids, { entityType: "CAVALO" }),
      totaisDoEscopo(ctx.db, ids, { entityType: "CAVALO" }),
    ]);

    const mensal = breakdown.byAttribute
      .flatMap((a) => a.impact)
      .filter((i) => i.periodicity === "MENSAL")
      .reduce((soma, i) => soma + i.amount, 0);

    expect(mensal).toBe(totais.impactByPeriodicity.MENSAL);
  });
});

describe("a matriz por quinzena", () => {
  it("desce a uma placa e recalcula tudo para ela", async () => {
    const matriz = (await getQuinzenaMatrix(ctx.db, {
      entityType: "CAVALO",
      attributeCode: "cavalo.custo_fixo",
      plate: "BBB1B11",
    }))!;

    expect(matriz.plate).toBe("BBB1B11");
    expect(matriz.entities).toBe(1);

    const linhas = matriz.groups.flatMap((g) => g.rows);
    expect(linhas.map((l) => l.plate)).toEqual(["BBB1B11"]);

    // O rodapé é o do ativo, e não o da frota: 5000 e 5500, não 9000 e 9500.
    expect(matriz.totals).toEqual([5000, 5500]);
    expect(matriz.pontaAPonta?.comparados).toEqual({ entities: 1, delta: 500 });
  });

  it("aceita a placa como ela foi digitada", async () => {
    const matriz = (await getQuinzenaMatrix(ctx.db, {
      entityType: "CAVALO",
      plate: " bbb1b11 ",
    }))!;
    expect(matriz.plate).toBe("BBB1B11");
    expect(matriz.entities).toBe(1);
  });

  it("volta à frota quando a placa não é deste equipamento, e diz que voltou", async () => {
    const matriz = (await getQuinzenaMatrix(ctx.db, {
      entityType: "CAVALO",
      plate: "AAA1A11",
    }))!;

    // `plate: null` é o que impede o silêncio: a tela sabe que não está
    // mostrando o ativo pedido, em vez de exibir a frota sob o nome dele.
    expect(matriz.plate).toBeNull();
    expect(matriz.entities).toBe(2);
  });

  it("sem placa, continua a frota inteira", async () => {
    const matriz = (await getQuinzenaMatrix(ctx.db, { entityType: "CAVALO" }))!;
    expect(matriz.plate).toBeNull();
    expect(matriz.entities).toBe(2);
  });
});

describe("a frota", () => {
  it("conhece o ativo que nunca mudou", async () => {
    const frota = (await listarFrota(ctx.db, { entityType: "CAVALO" }))!;
    const placas = frota.ativos.map((a) => a.plate);

    // O BBB2B22 não aparece em alteração nenhuma; um seletor montado sobre a
    // lista de alterações o esconderia, e quem procurasse por ele concluiria
    // que não está na base.
    expect(placas).toEqual(["BBB1B11", "BBB2B22"]);
    expect(frota.equipment).toBeTruthy();
    expect(frota.entityTypes.sort()).toEqual(["CARRETA", "CAVALO"]);
  });

  it("diz em quantas vigências cada ativo apareceu, e se ainda está lá", async () => {
    const frota = (await listarFrota(ctx.db, { entityType: "CAVALO" }))!;
    for (const ativo of frota.ativos) {
      expect(ativo.periods).toBe(2);
      expect(ativo.firstLabel).toBe("CAV_JAN");
      expect(ativo.lastLabel).toBe("CAV_FEV");
      expect(ativo.current).toBe(true);
    }
    expect(frota.latestLabel).toBe("CAV_FEV");
  });

  it("não mistura equipamentos", async () => {
    const carretas = (await listarFrota(ctx.db, { entityType: "CARRETA" }))!;
    expect(carretas.ativos.map((a) => a.plate)).toEqual(["AAA1A11", "AAA2A22"]);
  });
});

describe("os chamados", () => {
  it("recortam os cartões, e não só a lista", async () => {
    const tudo = await getTicketTotals(ctx.db, envioId);
    // `null` no lugar do recorte de vigências: o escopo de frota é o terceiro
    // eixo da assinatura, e este caso mede só ele.
    const cavalo = await getTicketTotals(ctx.db, envioId, null, {
      entityType: "CAVALO",
    });

    expect(tudo.changes).toBe(4);
    expect(tudo.tickets).toBe(3);

    // O cartão do topo é o do cavalo: três alterações em dois chamados.
    expect(cavalo.changes).toBe(3);
    expect(cavalo.tickets).toBe(2);
    expect(cavalo.impactSum).toBe(17);
  });

  it("mantêm o cartão e a lista dizendo o mesmo número", async () => {
    const escopo = { entityType: "CAVALO" as const };
    const totals = await getTicketTotals(ctx.db, envioId, null, escopo);
    const lista = await listTicketChanges(ctx.db, envioId, {}, escopo);

    // A promessa que um número ao lado de um filtro faz: é isto que sobra.
    expect(lista.total).toBe(totals.changes);
    expect(lista.rows.every((r) => r.entityType === "CAVALO")).toBe(true);
  });

  it("descem até a placa", async () => {
    const escopo = { entityType: "CAVALO", plate: "BBB1B11" };
    const totals = await getTicketTotals(ctx.db, envioId, null, escopo);
    const lista = await listTicketChanges(ctx.db, envioId, {}, escopo);

    expect(totals.changes).toBe(2);
    expect(totals.tickets).toBe(1);
    expect(lista.rows.map((r) => r.parameterLabel).sort()).toEqual([
      "Frete peso",
      "Pedágio",
    ]);
  });

  it("recortam também os painéis e a árvore por tipo", async () => {
    const escopo = { entityType: "CAVALO", plate: "BBB1B11" };
    const porParametro = await getTicketsByParameter(ctx.db, envioId, null, 15, escopo);
    const arvore = await getTicketClassification(ctx.db, envioId, null, escopo);

    expect(porParametro.map((p) => p.parameterLabel).sort()).toEqual([
      "Frete peso",
      "Pedágio",
    ]);
    expect(porParametro.find((p) => p.parameterLabel === "Frete peso")?.count).toBe(1);
    expect(arvore.changes).toBe(2);
  });

  it("sem escopo, continuam sendo o arquivo inteiro", async () => {
    const arvore = await getTicketClassification(ctx.db, envioId);
    expect(arvore.changes).toBe(4);
  });
});
