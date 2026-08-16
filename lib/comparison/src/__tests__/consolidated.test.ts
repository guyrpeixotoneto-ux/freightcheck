import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { getConsolidated, listPeriods } from "../consolidated";
import { listChanges } from "../query";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * The consolidated view.
 *
 * It sums independent series for a period without merging anything: no
 * snapshot is combined, no series waits for the other, and a period that is
 * missing one of them is reported as partial with the absent series named.
 */

let ctx: TestDb;
const SCOPE = "scope-consolidado";

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

beforeAll(async () => {
  ctx = await createTestDatabase("consolidated");
  await seedTaxonomy(ctx.db, "test");

  // Carretas deliver three periods.
  await buildFixture(
    ctx.db,
    CARRETA,
    [
      { label: "CAR_JAN", effectiveDate: "2026-01-01", data: { AAA1A11: { "carreta.custo_fixo": 1000 } } },
      { label: "CAR_FEV", effectiveDate: "2026-02-01", data: { AAA1A11: { "carreta.custo_fixo": 1300 } } },
      { label: "CAR_MAR", effectiveDate: "2026-03-01", data: { AAA1A11: { "carreta.custo_fixo": 1350 } } },
    ],
    { entityType: "CARRETA", scopeHash: SCOPE },
  );

  // Cavalos deliver January and March — February never arrived.
  await buildFixture(
    ctx.db,
    CAVALO,
    [
      {
        label: "CAV_JAN",
        effectiveDate: "2026-01-01",
        data: { BBB2B22: { "cavalo.custo_fixo": 5000, "cavalo.ipva": 12000 } },
      },
      {
        label: "CAV_MAR",
        effectiveDate: "2026-03-01",
        data: { BBB2B22: { "cavalo.custo_fixo": 5500, "cavalo.ipva": 9000 } },
      },
    ],
    { entityType: "CAVALO", scopeHash: SCOPE },
  );
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("períodos", () => {
  it("lista quais séries entregaram em cada um", async () => {
    const periods = await listPeriods(ctx.db);
    const byDate = new Map(periods.map((p) => [p.effective_date, p.series]));
    expect(byDate.get("2026-01-01")?.sort()).toEqual(["CARRETA", "CAVALO"]);
    // Fevereiro só teve carreta.
    expect(byDate.get("2026-02-01")).toEqual(["CARRETA"]);
    expect(byDate.get("2026-03-01")?.sort()).toEqual(["CARRETA", "CAVALO"]);
  });
});

describe("período completo", () => {
  it("soma as duas séries e se declara completo", async () => {
    const view = (await getConsolidated(ctx.db, "2026-03-01"))!;
    expect(view.complete).toBe(true);
    expect(view.missing).toEqual([]);
    expect(view.present.map((p) => p.entityTypeSet).sort()).toEqual([
      "CARRETA",
      "CAVALO",
    ]);

    // carreta 1300 -> 1350 (+50, mensal)
    // cavalo  5000 -> 5500 (+500, mensal) e 12000 -> 9000 (-3000, anual)
    expect(view.totals.valueChanges).toBe(3);
    expect(view.impactByPeriodicity).toEqual({ MENSAL: 550, ANUAL: -3000 });
  });

  it("compara cada série contra a anterior da própria série", async () => {
    const view = (await getConsolidated(ctx.db, "2026-03-01"))!;
    const carreta = view.present.find((p) => p.entityTypeSet === "CARRETA")!;
    const cavalo = view.present.find((p) => p.entityTypeSet === "CAVALO")!;
    // Carretas entregaram fevereiro; cavalos pularam e comparam com janeiro.
    expect(carreta.previousLabel).toBe("CAR_FEV");
    expect(cavalo.previousLabel).toBe("CAV_JAN");
  });

  it("nunca junta periodicidades diferentes num total", async () => {
    const view = (await getConsolidated(ctx.db, "2026-03-01"))!;
    // Somar daria -2450, que não significa nada.
    expect(Object.keys(view.impactByPeriodicity).sort()).toEqual([
      "ANUAL",
      "MENSAL",
    ]);
    expect(view.impactByPeriodicity.MENSAL).toBe(550);
    expect(view.impactByPeriodicity.ANUAL).toBe(-3000);
  });
});

describe("período parcial", () => {
  it("não bloqueia a análise e nomeia a série ausente", async () => {
    const view = (await getConsolidated(ctx.db, "2026-02-01"))!;

    expect(view.complete).toBe(false);
    expect(view.missing).toEqual(["CAVALO"]);
    expect(view.present.map((p) => p.entityTypeSet)).toEqual(["CARRETA"]);

    // A série que chegou é analisada normalmente: 1000 -> 1300.
    expect(view.totals.valueChanges).toBe(1);
    expect(view.impactByPeriodicity).toEqual({ MENSAL: 300 });
  });

  it("lista as alterações da série presente", async () => {
    const view = (await getConsolidated(ctx.db, "2026-02-01"))!;
    const { rows, total } = await listChanges(ctx.db, view.changeSetIds);
    expect(total).toBe(1);
    expect(rows[0].attributeCode).toBe("carreta.custo_fixo");
    expect(rows[0].impactAmount).toBe(300);
  });

  it("não trata a série ausente como zero", async () => {
    const fevereiro = (await getConsolidated(ctx.db, "2026-02-01"))!;
    const marco = (await getConsolidated(ctx.db, "2026-03-01"))!;
    // Fevereiro não inclui cavalo em nenhum número — nem somando, nem zerando.
    expect(fevereiro.present.some((p) => p.entityTypeSet === "CAVALO")).toBe(false);
    expect(fevereiro.impactByPeriodicity.ANUAL).toBeUndefined();
    // E março, que tem as duas, traz o anual do cavalo.
    expect(marco.impactByPeriodicity.ANUAL).toBe(-3000);
  });
});

describe("primeira vigência de uma série", () => {
  it("diz que não há anterior em vez de inventar uma comparação", async () => {
    const view = (await getConsolidated(ctx.db, "2026-01-01"))!;
    expect(view.complete).toBe(true);
    for (const series of view.present) {
      expect(series.changeSetId).toBeNull();
      expect(series.reason).toMatch(/Primeira vigência/);
    }
    expect(view.totals.valueChanges).toBe(0);
    expect(view.impactByPeriodicity).toEqual({});
  });
});

/**
 * O recorte por equipamento **dentro** do período.
 *
 * É o que a Visão geral pede quando alguém clica no equipamento mais tocado.
 * A alternativa — trocar de série — responde outra pergunta: a comparação de uma
 * série é sempre a mais recente dela, e num período parcial como fevereiro isso
 * daria a comparação de março do cavalo sob o rótulo de fevereiro.
 */
describe("recorte por equipamento dentro do período", () => {
  it("lista só as linhas do equipamento pedido, sem trocar de vigência", async () => {
    const view = (await getConsolidated(ctx.db, "2026-03-01"))!;

    const cavalo = await listChanges(ctx.db, view.changeSetIds, {
      entityType: "CAVALO",
    });
    expect(cavalo.total).toBe(2);
    expect(cavalo.rows.map((r) => r.attributeCode).sort()).toEqual([
      "cavalo.custo_fixo",
      "cavalo.ipva",
    ]);

    const carreta = await listChanges(ctx.db, view.changeSetIds, {
      entityType: "CARRETA",
    });
    expect(carreta.total).toBe(1);
    expect(carreta.rows[0].attributeCode).toBe("carreta.custo_fixo");
  });

  it("é filtro de linha, e o total sem ele continua o do período inteiro", async () => {
    const view = (await getConsolidated(ctx.db, "2026-03-01"))!;
    const tudo = await listChanges(ctx.db, view.changeSetIds);
    expect(tudo.total).toBe(3);
    // As duas fatias fecham o total: nenhuma linha fica de fora nem é contada
    // duas vezes.
    const cavalo = await listChanges(ctx.db, view.changeSetIds, { entityType: "CAVALO" });
    const carreta = await listChanges(ctx.db, view.changeSetIds, { entityType: "CARRETA" });
    expect(cavalo.total + carreta.total).toBe(tudo.total);
  });

  it("combina com os outros filtros em vez de substituí-los", async () => {
    const view = (await getConsolidated(ctx.db, "2026-03-01"))!;
    // "cavalo, e só o que tem impacto apurado" é o recorte de quem chegou pela
    // faixa de atenção da Visão geral.
    const { total } = await listChanges(ctx.db, view.changeSetIds, {
      entityType: "CAVALO",
      impactConfidence: "CALCULATED",
    });
    expect(total).toBe(2);

    const nenhuma = await listChanges(ctx.db, view.changeSetIds, {
      entityType: "CAVALO",
      attributeCode: "carreta.custo_fixo",
    });
    expect(nenhuma.total).toBe(0);
  });
});

/**
 * O rótulo do período vem do servidor.
 *
 * A Visão geral escreve "março de 2026" no cabeçalho a partir de
 * `GroupedView.periodLabel`; as Alterações precisam escrever a mesma coisa na
 * faixa de recorte. Formatar a data no navegador seria uma segunda regra de
 * rótulo, e duas regras é uma a mais do que se consegue manter iguais.
 */
describe("o período dito por extenso", () => {
  it("acompanha a data, com a mesma regra das outras telas", async () => {
    const view = (await getConsolidated(ctx.db, "2026-03-01"))!;
    expect(view.period).toBe("2026-03-01");
    expect(view.periodLabel).toBe("março/2026");
  });
});

describe("o consolidado é projeção, não entidade", () => {
  it("não cria snapshot nem altera os existentes", async () => {
    const before = await listPeriods(ctx.db);
    await getConsolidated(ctx.db, "2026-03-01");
    await getConsolidated(ctx.db, "2026-02-01");
    const after = await listPeriods(ctx.db);
    // Mesmos períodos, mesmas séries: consolidar não fabrica vigência.
    expect(after).toEqual(before);
  });
});
