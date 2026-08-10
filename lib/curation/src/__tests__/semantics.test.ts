import { describe, expect, it } from "vitest";
import {
  classifyNamePair,
  detectPeriodicityConflicts,
  guessTaxonomyCode,
  proposeSemantics,
  type AttributeEvidence,
} from "../semantics";

function evidence(over: Partial<AttributeEvidence> = {}): AttributeEvidence {
  return {
    code: "cavalo.teste",
    sourceName: "teste",
    entityType: "CAVALO",
    dataType: "NUMERIC",
    valueCount: 62,
    nullCount: 0,
    distinctCount: 10,
    min: 0,
    max: 1000,
    mean: 500,
    latestSum: 62000,
    zeroCount: 0,
    negativeCount: 0,
    ...over,
  };
}

describe("periodicity is never inferred from a column name", () => {
  it("leaves periodicity null even for an obviously monetary column", () => {
    const proposal = proposeSemantics(
      evidence({ code: "cavalo.ipva_licenciamento", sourceName: "ipvaLicenciamento" }),
    );
    expect(proposal.unit).toBe("BRL");
    expect(proposal.isMonetary).toBe(true);
    // The one field the engine refuses to fill.
    expect(proposal.periodicity).toBeNull();
    expect(proposal.rationale).toMatch(/Periodicidade NÃO proposta/);
  });

  it("never proposes CONFIRMED", () => {
    const codes = [
      "cavalo.valor_nf_compra",
      "carreta.custo_fixo",
      "cavalo.chassi",
      "cavalo.combustivel_consumo_neg",
    ];
    for (const code of codes) {
      const proposal = proposeSemantics(evidence({ code }));
      expect(["PRESUMED", "UNKNOWN"]).toContain(proposal.status);
    }
  });
});

describe("aggregation follows the unit, not the data type", () => {
  it("makes money summable", () => {
    const proposal = proposeSemantics(
      evidence({ code: "carreta.custo_fixo", sourceName: "custoFixo" }),
    );
    expect(proposal.unit).toBe("BRL");
    expect(proposal.aggregation).toBe("SUM");
  });

  it("refuses to aggregate a ratio, and says why", () => {
    // Custo Variável Simulado is named like money and holds 3.66 — it is
    // R$/km. Summing 62 plates gives a meaningless "R$ 258", which is exactly
    // the mistake the magnitude check exists to prevent.
    const perKm = proposeSemantics(
      evidence({
        code: "cavalo.custo_variavel_simulado",
        sourceName: "Custo Variável Simulado",
        min: 0,
        max: 5,
      }),
    );
    expect(perKm.aggregation).not.toBe("SUM");
    expect(perKm.isMonetary).not.toBe(true);
    expect(perKm.unit).toBeNull();
    expect(perKm.rationale).toMatch(/taxa|R\$\/km/i);

    // A genuine per-asset amount of the same family is still proposed as money.
    const realAmount = proposeSemantics(
      evidence({ code: "carreta.custo_fixo", sourceName: "custoFixo", min: 0, max: 18500 }),
    );
    expect(realAmount.unit).toBe("BRL");
    expect(realAmount.aggregation).toBe("SUM");

    const consumo = proposeSemantics(
      evidence({ code: "cavalo.combustivel_consumo_neg", sourceName: "combustivelConsumoNeg", min: 1.5, max: 3 }),
    );
    expect(consumo.unit).toBe("KM_L");
    expect(consumo.aggregation).toBe("NONE");
  });

  it("does not treat a calendar year as a quantity", () => {
    const proposal = proposeSemantics(
      evidence({ code: "cavalo.ano", sourceName: "ano", min: 2020, max: 2024 }),
    );
    expect(proposal.unit).toBe("ANO");
    expect(proposal.aggregation).toBe("NONE");
    expect(proposal.isMonetary).toBe(false);
  });

  it("does not aggregate text or booleans", () => {
    expect(proposeSemantics(evidence({ dataType: "TEXT" })).aggregation).toBe("NONE");
    expect(proposeSemantics(evidence({ dataType: "BOOLEAN" })).aggregation).toBe("NONE");
  });

  it("holds back a column the source types inconsistently", () => {
    const proposal = proposeSemantics(
      evidence({ code: "cavalo.data_fim_contrato", dataType: "MIXED" }),
    );
    expect(proposal.unit).toBeNull();
    expect(proposal.rationale).toMatch(/mais de um tipo/);
  });
});

describe("classifyNamePair", () => {
  it("calls homonymy when the per-asset ratio scatters", () => {
    // The real carreta pair: ratio from -3.01x to 5.23x across 71 assets.
    // Two measures of one quantity would track each other; these do not.
    const { verdict, blocks } = classifyNamePair({
      sampleSize: 71,
      meanRatio: 2.1,
      stddevRatio: 1.31,
      minRatio: -3.01,
      maxRatio: 5.23,
    });
    expect(verdict).toBe("DISTINCT_BASES");
    // Homonymy is a naming problem, not a contradiction — it must not block.
    expect(blocks).toBe(false);
  });

  it("calls a real contradiction when the ratio is tight but wrong", () => {
    const { verdict, blocks } = classifyNamePair({
      sampleSize: 60,
      meanRatio: 2.0,
      stddevRatio: 0.05,
      minRatio: 1.9,
      maxRatio: 2.1,
    });
    expect(verdict).toBe("PERIODICITY_CONTRADICTION");
    expect(blocks).toBe(true);
  });

  it("stays quiet when the ratio really is a twelfth", () => {
    const { verdict, blocks } = classifyNamePair({
      sampleSize: 60,
      meanRatio: 1 / 12,
      stddevRatio: 0.002,
      minRatio: 0.08,
      maxRatio: 0.086,
    });
    expect(verdict).toBe("CONSISTENT");
    expect(blocks).toBe(false);
  });

  it("refuses to conclude anything from too few pairs", () => {
    const { verdict, blocks } = classifyNamePair({
      sampleSize: 3,
      meanRatio: 9,
      stddevRatio: 0.1,
      minRatio: 8.9,
      maxRatio: 9.1,
    });
    expect(verdict).toBe("INSUFFICIENT_DATA");
    expect(blocks).toBe(false);
  });
});

describe("periodicity conflict detection", () => {
  const pair = [
    evidence({
      code: "carreta.ipva_licenciamento",
      sourceName: "ipvaLicenciamento",
      latestSum: 10875.69,
    }),
    evidence({
      code: "carreta.ipva_licenciamento_mensal",
      sourceName: "ipvaLicenciamentoMensal",
      latestSum: 23343.88,
    }),
  ];

  it("reports the real pair as homonymy, not as a contradiction", () => {
    const conflicts = detectPeriodicityConflicts(
      pair,
      new Map([
        [
          "carreta.ipva_licenciamento_mensal",
          { sampleSize: 71, meanRatio: 2.1, stddevRatio: 1.31, minRatio: -3.01, maxRatio: 5.23 },
        ],
      ]),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].verdict).toBe("DISTINCT_BASES");
    expect(conflicts[0].blocks).toBe(false);
    expect(conflicts[0].message).toMatch(/homonímia/i);
    expect(conflicts[0].message).toMatch(/71 ativos/);
  });

  it("does not conclude from fleet totals alone", () => {
    // Same totals, no per-asset evidence: the honest answer is "cannot say".
    const conflicts = detectPeriodicityConflicts(pair);
    expect(conflicts[0].verdict).toBe("INSUFFICIENT_DATA");
    expect(conflicts[0].blocks).toBe(false);
  });

  it("ignores a monthly column with no annual counterpart", () => {
    const conflicts = detectPeriodicityConflicts([
      evidence({ code: "x.algo_mensal", sourceName: "algoMensal", latestSum: 999 }),
    ]);
    expect(conflicts).toHaveLength(0);
  });
});

describe("taxonomy placement", () => {
  it("separates cost from cadastral data", () => {
    expect(guessTaxonomyCode("cavalo.amortizacao_cavalo", "CAVALO")).toBe("cf_depreciacao");
    expect(guessTaxonomyCode("cavalo.finame_cavalo", "CAVALO")).toBe("cf_financiamento");
    expect(guessTaxonomyCode("carreta.ipva_licenciamento", "CARRETA")).toBe("cf_seguros_tributos");
    expect(guessTaxonomyCode("cavalo.combustivel_consumo_neg", "CAVALO")).toBe("cv_combustivel");
    expect(guessTaxonomyCode("cavalo.valor_pneu", "CAVALO")).toBe("cv_pneus");
    // Not a cost at all.
    expect(guessTaxonomyCode("cavalo.chassi", "CAVALO")).toBe("cad_identificacao");
    expect(guessTaxonomyCode("cavalo.unidade_cnpj", "CAVALO")).toBe("cad_escopo");
  });

  it("routes custoFixo by entity type", () => {
    expect(guessTaxonomyCode("cavalo.custo_fixo", "CAVALO")).toBe("cf_frota_cavalo");
    expect(guessTaxonomyCode("carreta.custo_fixo", "CARRETA")).toBe("cf_frota_carreta");
  });

  it("falls back to an explicit unclassified bucket rather than a wrong guess", () => {
    expect(guessTaxonomyCode("cavalo.algo_totalmente_novo", "CAVALO")).toBe("nao_classificado");
  });
});
