import { describe, expect, it } from "vitest";
import {
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

describe("periodicity conflict detection", () => {
  it("catches the ipvaLicenciamento pair from the real export", () => {
    const conflicts = detectPeriodicityConflicts([
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
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].annualCode).toBe("carreta.ipva_licenciamento");
    expect(conflicts[0].monthlyCode).toBe("carreta.ipva_licenciamento_mensal");
    expect(conflicts[0].ratio).toBeCloseTo(2.15, 2);
    expect(conflicts[0].message).toMatch(/1\/12/);
  });

  it("stays quiet when the monthly figure is plausibly a twelfth", () => {
    const conflicts = detectPeriodicityConflicts([
      evidence({ code: "x.custo", sourceName: "custo", latestSum: 12000 }),
      evidence({ code: "x.custo_mensal", sourceName: "custoMensal", latestSum: 1000 }),
    ]);
    expect(conflicts).toHaveLength(0);
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
