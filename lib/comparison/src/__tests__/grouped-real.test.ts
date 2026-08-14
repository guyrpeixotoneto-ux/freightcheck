import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  importFixture,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { getAttributeSeries, getGroupedView, getGroupVehicles } from "../grouped";

/**
 * A visão agrupada contra o export real da Freightec.
 *
 * Os números aqui são contrato de regressão, apurados sobre os dois arquivos de
 * `attached_assets` (`Modelo_Carreta` e `Modelo_Cavalo`, 9 vigências cada). Se
 * algum deles mudar sem que alguém tenha mudado uma regra de propósito, a regra
 * mudou sozinha — que é exatamente o que um produto de auditoria não pode
 * deixar acontecer.
 */

const AGOSTO = "2026-08-01";
const JULHO = "2026-07-02";
const MARCO = "2026-03-02";

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("grouped_real");
  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
  await computeMissingChangeSets(ctx.db, "test:grouped");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("agrupamento — a redução de linhas a conclusões", () => {
  it("agosto/2026: 267 alterações viram 20 grupos", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    expect(view).not.toBeNull();
    expect(view!.totals.changes).toBe(267);
    expect(view!.totals.groups).toBe(20);
    expect(view!.periodLabel).toBe("agosto/2026");
  });

  it("julho/2026: 593 alterações viram 26 grupos — a lista antiga mostrava 300", async () => {
    const view = await getGroupedView(ctx.db, JULHO);
    expect(view!.totals.changes).toBe(593);
    expect(view!.totals.groups).toBe(26);
  });

  it("as duas séries da vigência aparecem, nenhuma some por empate de data", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    const series = view!.series.map((s) => s.entityTypeSet).sort();
    expect(series).toEqual(["CARRETA", "CAVALO"]);
    // Determinístico: a ordem não pode depender do que o Postgres devolver.
    expect(view!.series[0].entityTypeSet).toBe("CARRETA");
    expect(view!.complete).toBe(true);
  });
});

describe("dupla contagem — o número em destaque", () => {
  it("agosto/2026: o impacto sai de R$ 39.936,28 para R$ 28.511,24 por mês", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    expect(view!.impact.byPeriodicity.MENSAL).toBeCloseTo(28511.24, 2);
    expect(view!.impact.excludedByPeriodicity.MENSAL).toBeCloseTo(11425.04, 2);
    expect(view!.impact.excludedChanges).toBe(6);
    // A soma das duas partes reproduz o total antigo: nada sumiu, foi separado.
    expect(
      view!.impact.byPeriodicity.MENSAL + view!.impact.excludedByPeriodicity.MENSAL,
    ).toBeCloseTo(39936.28, 2);
  });

  it("o custo fixo da carreta sai inteiro do total, e diz por quê", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    const group = view!.groups.find(
      (g) => g.attributeCode === "carreta.custo_fixo" && g.entityType === "CARRETA",
    );
    expect(group).toBeDefined();
    expect(group!.vehicles).toBe(5);
    expect(group!.impact.excludedVehicles).toBe(5);
    expect(group!.impact.countedVehicles).toBe(0);
    expect(group!.impact.excludedAmount).toBeCloseTo(16594.54, 2);
    expect(group!.impact.excludedReason).toContain("total de");
    expect(group!.composition?.parts).toContain("carreta.finame");
  });

  it("o custo fixo do cavalo sai em 1 veículo e permanece em 4 — a regra é por ativo", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    const group = view!.groups.find((g) => g.attributeCode === "cavalo.finame_cavalo");
    expect(group!.vehicles).toBe(5);
    expect(group!.impact.excludedVehicles).toBe(1);
    expect(group!.impact.countedVehicles).toBe(4);
    expect(group!.impact.excludedAmount).toBeCloseTo(-5169.5, 2);
    expect(group!.impact.amount).toBeCloseTo(17086.2, 2);
  });

  it("as parcelas nunca são excluídas — são elas que sustentam o total", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    const finame = view!.groups.find((g) => g.attributeCode === "carreta.finame");
    expect(finame!.impact.excludedVehicles).toBe(0);
    expect(finame!.impact.amount).toBeCloseTo(11916.69, 2);
  });
});

describe("vigência × acumulado — nunca o mesmo número", () => {
  it("o acumulado cobre 16 comparações e é diferente do valor da vigência", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    expect(view!.accumulated.comparisons).toBe(16);
    expect(view!.accumulated.byPeriodicity.ANUAL).toBeCloseTo(-735312.15, 2);
    expect(view!.accumulated.byPeriodicity.MENSAL).not.toBeCloseTo(
      view!.impact.byPeriodicity.MENSAL,
      2,
    );
  });

  it("março/2026 não tem impacto financeiro apurável, e isso é uma resposta", async () => {
    const view = await getGroupedView(ctx.db, MARCO);
    expect(view!.totals.changes).toBe(400);
    expect(Object.keys(view!.impact.byPeriodicity)).toHaveLength(0);
    expect(view!.impact.notCalculable).toBe(400);
    // O acumulado continua existindo e continua separado.
    expect(view!.accumulated.comparisons).toBe(16);
  });
});

describe("agregação — só soma o que a semântica autoriza", () => {
  it("atributo SUM produz total e média com denominador explícito", async () => {
    const view = await getGroupedView(ctx.db, JULHO);
    const ipva = view!.groups.find((g) => g.attributeCode === "cavalo.ipva_licenciamento");
    expect(ipva!.aggregate.summable).toBe(true);
    expect(ipva!.aggregate.totalBefore).toBeCloseTo(413826.3, 2);
    expect(ipva!.aggregate.totalAfter).toBeCloseTo(268951.8, 2);
    expect(ipva!.aggregate.deltaPercent).toBeCloseTo(-35, 1);
    expect(ipva!.aggregate.perVehicle?.denominator).toBe(62);
    expect(ipva!.impact.amount).toBeCloseTo(-144874.5, 2);
    expect(ipva!.impact.periodicity).toBe("ANUAL");
    expect(ipva!.coverage).toBe("TOTAL");
    expect(ipva!.patterns).toBe(13);
  });

  it("atributo não somável (AVG) não produz total nenhum", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    const vida = view!.groups.find((g) => g.attributeCode === "cavalo.manutencao_vida_meses");
    expect(vida!.aggregate.summable).toBe(false);
    expect(vida!.aggregate.totalBefore).toBeNull();
    expect(vida!.aggregate.totalAfter).toBeNull();
    expect(vida!.aggregate.perVehicle).toBeNull();
    // A faixa continua sendo mostrada: não somar não é esconder.
    expect(vida!.aggregate.minPercent).not.toBeNull();
    expect(vida!.aggregate.maxPercent).not.toBeNull();
  });

  it("atributo sem semântica confirmada é listado e não é precificado", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    const simulado = view!.groups.find(
      (g) => g.attributeCode === "cavalo.custo_variavel_simulado",
    );
    expect(simulado).toBeDefined();
    expect(simulado!.semanticsStatus).toBe("UNKNOWN");
    expect(simulado!.impact.amount).toBeNull();
    expect(simulado!.impact.reason).toContain("não foi confirmado");
  });
});

describe("cobertura — determinística, sem piso financeiro", () => {
  it("100% é toda a frota; abaixo de 50% é a contagem crua", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    const total = view!.groups.find((g) => g.attributeCode === "cavalo.manutencao_vida_meses");
    expect(total!.coverage).toBe("TOTAL");
    expect(total!.coverageLabel).toContain("Toda a frota");
    expect(total!.coverageLabel).toContain("62 de 62 cavalos");

    const parcial = view!.groups.find((g) => g.attributeCode === "carreta.finame");
    expect(parcial!.coverage).toBe("PARCIAL");
    expect(parcial!.coverageLabel).toBe("5 de 71 carretas");
  });

  it("maioria da frota aparece entre 50% e 100%", async () => {
    const view = await getGroupedView(ctx.db, MARCO);
    const emprestada = view!.groups.find(
      (g) => g.attributeCode === "carreta.frota_emprestada",
    );
    expect(emprestada!.coverage).toBe("MAIORIA");
    expect(emprestada!.coverageLabel).toContain("Maioria da frota");
  });
});

describe("anomalia de formato — o serial do Excel", () => {
  it("separa os 54 do mesmo instante dos 8 que também mudaram de valor", async () => {
    const view = await getGroupedView(ctx.db, AGOSTO);
    const contrato = view!.groups.find(
      (g) => g.attributeCode === "cavalo.data_fim_contrato",
    );
    expect(contrato).toBeDefined();
    expect(contrato!.vehicles).toBe(62);
    expect(contrato!.badge).toBe("RUPTURA");

    const same = contrato!.anomalies.find((a) => a.sameInstant);
    const different = contrato!.anomalies.find((a) => !a.sameInstant);
    expect(same?.vehicles).toBe(54);
    expect(different?.vehicles).toBe(8);
    expect(same?.interpretation).toContain("2028-07-01T12:00:00Z");

    // Os 8 diferem por UM milissegundo: 2028-07-01T23:59:59.999Z não cabe num
    // serial do Excel. É perda de precisão do formato, e a frase precisa dizer
    // isso — chamar de mudança de data alarmaria oito contratos sem motivo.
    expect(different?.differenceMs).toBe(1);
    expect(different?.explanation).toContain("precisão que o formato perdeu");
  });

  it("o valor original de cada lado continua rastreável até a célula", async () => {
    const vehicles = await getGroupVehicles(ctx.db, {
      period: AGOSTO,
      attributeCode: "cavalo.data_fim_contrato",
      entityType: "CAVALO",
    });
    expect(vehicles).toHaveLength(62);
    // Nada foi convertido: os dois lados continuam como a fonte os entregou.
    expect(vehicles[0].valueBefore).toMatch(/^2028-/);
    expect(vehicles[0].valueAfter).toMatch(/^469\d\d/);
    expect(vehicles[0].anomaly).not.toBeNull();
  });
});

describe("série do atributo — numerador, denominador e frota", () => {
  it("o IPVA dos cavalos mostra que a alta de jan→fev foi entrada de frota", async () => {
    const series = await getAttributeSeries(ctx.db, "cavalo.ipva_licenciamento");
    expect(series!.summable).toBe(true);
    expect(series!.points).toHaveLength(9);

    expect(series!.points.every((p) => p.vehicles === p.numericVehicles)).toBe(true);

    const janeiro = series!.points.find((p) => p.effectiveDate === "2026-01-02")!;
    const fevereiro = series!.points.find((p) => p.effectiveDate === "2026-02-02")!;
    expect(janeiro.vehicles).toBe(60);
    expect(fevereiro.vehicles).toBe(62);

    // A soma sobe R$ 14.420,00 (+3,6%)…
    const somaSubiu = (fevereiro.total! - janeiro.total!) / janeiro.total!;
    // …enquanto a média por veículo sobe R$ 17,85 (+0,27%).
    const mediaSubiu = (fevereiro.average! - janeiro.average!) / janeiro.average!;
    expect(somaSubiu).toBeGreaterThan(0.03);
    expect(mediaSubiu).toBeLessThan(0.005);
    // A soma cresceu mais de dez vezes mais do que o preço por veículo: quem
    // olhasse só o total leria entrada de frota como encarecimento. É por isso
    // que a série é obrigada a devolver numerador, denominador e média.
    expect(somaSubiu / mediaSubiu).toBeGreaterThan(10);

    const dezembro = series!.points[0];
    const agosto = series!.points[8];
    expect(dezembro.total).toBeCloseTo(989843.95, 2);
    expect(agosto.total).toBeCloseTo(268951.8, 2);
  });

  it("atributo não somável não devolve total, e diz por quê", async () => {
    const series = await getAttributeSeries(ctx.db, "cavalo.manutencao_vida_meses");
    expect(series!.summable).toBe(false);
    expect(series!.averageable).toBe(true);
    expect(series!.points.every((p) => p.total === null)).toBe(true);
    expect(series!.points.every((p) => p.average !== null)).toBe(true);
    expect(series!.note).toContain("não é somável");
  });

  it("coluna de data conta os ativos que têm valor, não só os numéricos", async () => {
    // A série contava apenas valores numéricos e devolvia zero veículos em oito
    // das nove vigências para `dataFimContrato` — dizia que ninguém tinha data
    // de fim de contrato até agosto, quando todos tinham.
    const series = await getAttributeSeries(ctx.db, "cavalo.data_fim_contrato");
    const julho = series!.points.find((p) => p.effectiveDate === "2026-07-02")!;
    expect(julho.vehicles).toBe(62);
    expect(julho.numericVehicles).toBe(0);
    const agosto = series!.points.find((p) => p.effectiveDate === "2026-08-01")!;
    expect(agosto.vehicles).toBe(62);
    expect(agosto.numericVehicles).toBe(62);
  });

  it("atributo sem agregação não devolve nem total nem média", async () => {
    const series = await getAttributeSeries(ctx.db, "cavalo.custo_variavel_simulado");
    expect(series!.summable).toBe(false);
    expect(series!.averageable).toBe(false);
    expect(series!.points.every((p) => p.total === null && p.average === null)).toBe(true);
    expect(series!.points.every((p) => p.min !== null && p.max !== null)).toBe(true);
  });
});
