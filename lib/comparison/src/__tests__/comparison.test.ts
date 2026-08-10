import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeChangeSet } from "../engine";
import { listChanges } from "../query";
import { absent, buildFixture, type AttributeSpec } from "./fixtures";

/**
 * The comparison engine, one variable at a time.
 *
 * Each case builds two synthetic snapshots that differ in exactly one way, so
 * a failure points at one rule rather than at "something in 83k facts".
 */

let ctx: TestDb;

const ATTRIBUTES: AttributeSpec[] = [
  {
    // The only attribute whose semantics are settled, so the only one whose
    // changes can carry a calculated impact.
    code: "carreta.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
  {
    code: "carreta.tarifa_km",
    dataType: "NUMERIC",
    semanticsStatus: "PRESUMED",
    unit: "BRL_KM",
    aggregation: "NONE",
    isMonetary: false,
    taxonomyCode: "cv_combustivel",
  },
  {
    // Confirmed, and deliberately not summable: exercises the aggregation gate
    // on its own, without the semantics gate firing first.
    code: "carreta.consumo_ref",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "KM_L",
    periodicity: null,
    aggregation: "NONE",
    isMonetary: false,
    taxonomyCode: "cv_combustivel",
  },
  { code: "carreta.modelo", dataType: "TEXT", semanticsStatus: "PRESUMED" },
  { code: "carreta.misterio", dataType: "NUMERIC", semanticsStatus: "UNKNOWN" },
  { code: "carreta.emprestada", dataType: "BOOLEAN", semanticsStatus: "PRESUMED" },
];

beforeAll(async () => {
  ctx = await createTestDatabase("comparison");
  await seedTaxonomy(ctx.db, "test");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

async function compare(
  attributes: AttributeSpec[],
  a: Record<string, Record<string, unknown>>,
  b: Record<string, Record<string, unknown>>,
) {
  const { snapshotIds } = await buildFixture(ctx.db, attributes, [
    { label: `A-${Math.random()}`, effectiveDate: "2026-01-01", data: a as never },
    { label: `B-${Math.random()}`, effectiveDate: "2026-02-01", data: b as never },
  ]);
  const [labelA, labelB] = Object.keys(snapshotIds);
  const set = await computeChangeSet(ctx.db, snapshotIds[labelA], snapshotIds[labelB], {
    force: true,
  });
  const { rows } = await listChanges(ctx.db, set.id, { limit: 100 });
  return { set, rows };
}

describe("snapshots idênticos", () => {
  it("não produz nenhuma alteração", async () => {
    const data = {
      AAA1A11: { "carreta.custo_fixo": 1000, "carreta.modelo": "Randon" },
      BBB2B22: { "carreta.custo_fixo": 2000, "carreta.modelo": "Facchini" },
    };
    const { set, rows } = await compare(ATTRIBUTES, data, structuredClone(data));

    expect(set.valueChanges).toBe(0);
    expect(set.entitiesAdded).toBe(0);
    expect(set.entitiesRemoved).toBe(0);
    expect(set.attributesAdded).toBe(0);
    expect(set.attributesRemoved).toBe(0);
    expect(rows).toHaveLength(0);
    // Re-importing the same content must never invent news.
    expect(set.unchanged).toBe(4);
    expect(set.calculatedImpactByPeriodicity).toEqual({});
  });
});

describe("mudança numérica", () => {
  it("calcula variação absoluta e percentual", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": 1000 } },
      { AAA1A11: { "carreta.custo_fixo": 1250 } },
    );

    expect(rows).toHaveLength(1);
    const change = rows[0];
    expect(change.changeType).toBe("VALUE_CHANGED");
    expect(change.nature).toBe("NUMERIC");
    expect(change.valueBefore).toBe("1000");
    expect(change.valueAfter).toBe("1250");
    expect(change.deltaAbsolute).toBe(250);
    expect(change.deltaPercent).toBeCloseTo(25, 6);
    expect(change.comparability).toBe("COMPARABLE");
  });

  it("não calcula percentual quando o valor anterior é zero", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": 0 } },
      { AAA1A11: { "carreta.custo_fixo": 500 } },
    );
    expect(rows[0].deltaAbsolute).toBe(500);
    // Dividing by zero would be infinity dressed up as a percentage.
    expect(rows[0].deltaPercent).toBeNull();
    expect(rows[0].nature).toBe("FROM_ZERO");
  });

  it("marca zeramento como natureza própria", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": 800 } },
      { AAA1A11: { "carreta.custo_fixo": 0 } },
    );
    expect(rows[0].nature).toBe("ZEROING");
    expect(rows[0].deltaPercent).toBeCloseTo(-100, 6);
    // Zero is a value, not an absence.
    expect(rows[0].valueAfter).toBe("0");
  });
});

describe("materialidade e impacto", () => {
  it("calcula impacto só para semântica confirmada", async () => {
    const { set, rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": 1000, "carreta.tarifa_km": 2.5 } },
      { AAA1A11: { "carreta.custo_fixo": 1400, "carreta.tarifa_km": 3.0 } },
    );

    const confirmed = rows.find((r) => r.attributeCode === "carreta.custo_fixo")!;
    expect(confirmed.impactConfidence).toBe("CALCULATED");
    expect(confirmed.impactAmount).toBe(400);
    expect(confirmed.impactPeriodicity).toBe("MENSAL");

    // Semantics not confirmed: that gate fires first, before anything else is
    // even considered.
    const rate = rows.find((r) => r.attributeCode === "carreta.tarifa_km")!;
    expect(rate.impactConfidence).toBe("NOT_CALCULABLE");
    expect(rate.impactAmount).toBeNull();
    expect(rate.impactReason).toMatch(/presumida|curadoria/i);
    // ...but the variation itself is still reported.
    expect(rate.deltaAbsolute).toBeCloseTo(0.5, 6);

    expect(set.calculatedImpactByPeriodicity).toEqual({ MENSAL: 400 });
    expect(set.impactNotCalculable).toBe(1);
  });

  it("recusa monetizar uma razão, mesmo com semântica confirmada", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.consumo_ref": 2.35 } },
      { AAA1A11: { "carreta.consumo_ref": 2.21 } },
    );
    const consumo = rows[0];
    expect(consumo.semanticsStatus).toBe("CONFIRMED");
    expect(consumo.impactConfidence).toBe("NOT_CALCULABLE");
    // km/l is confirmed and well understood — and still not money.
    expect(consumo.impactReason).toMatch(/não é um montante financeiro/i);
    // A ratio still gets its variation — km/l falling is real news.
    expect(consumo.deltaAbsolute).toBeCloseTo(-0.14, 6);
    expect(consumo.deltaPercent).toBeCloseTo(-5.957, 2);
  });

  it("nunca soma periodicidades diferentes num único número", async () => {
    // The defect this locks: with only MENSAL confirmed the total was safe,
    // and the moment an ANUAL attribute was confirmed the scalar quietly
    // started adding R$/mês to R$/ano. Buckets make that impossible.
    const { set } = await compare(
      [
        ...ATTRIBUTES,
        {
          code: "carreta.ipva_anual",
          dataType: "NUMERIC",
          semanticsStatus: "CONFIRMED",
          unit: "BRL",
          periodicity: "ANUAL",
          aggregation: "SUM",
          isMonetary: true,
          taxonomyCode: "cf_frota_carreta",
        },
      ],
      { AAA1A11: { "carreta.custo_fixo": 1000, "carreta.ipva_anual": 6000 } },
      { AAA1A11: { "carreta.custo_fixo": 1100, "carreta.ipva_anual": 4800 } },
    );

    expect(set.calculatedImpactByPeriodicity).toEqual({
      MENSAL: 100,
      ANUAL: -1200,
    });
    // The two must never collapse into the -1100 a scalar would have produced.
    const buckets = Object.values(set.calculatedImpactByPeriodicity);
    expect(buckets).toHaveLength(2);
    expect(buckets.reduce((a, b) => a + b, 0)).not.toBe(
      set.calculatedImpactByPeriodicity.MENSAL,
    );
  });

  it("não converte periodicidade implicitamente", async () => {
    // An annual attribute's impact is its raw delta, expressed as annual.
    // Nothing divides by 12, nothing multiplies by 12. Any conversion to a
    // common base is F4's job and has to be explicit and deterministic.
    const { set, rows } = await compare(
      [
        ...ATTRIBUTES,
        {
          code: "carreta.ipva_anual",
          dataType: "NUMERIC",
          semanticsStatus: "CONFIRMED",
          unit: "BRL",
          periodicity: "ANUAL",
          aggregation: "SUM",
          isMonetary: true,
          taxonomyCode: "cf_frota_carreta",
        },
      ],
      { AAA1A11: { "carreta.ipva_anual": 12000 } },
      { AAA1A11: { "carreta.ipva_anual": 6000 } },
    );

    const change = rows[0];
    expect(change.deltaAbsolute).toBe(-6000);
    // The raw difference, untouched — not -500 (a twelfth) nor -72000 (×12).
    expect(change.impactAmount).toBe(-6000);
    expect(change.impactPeriodicity).toBe("ANUAL");
    expect(set.calculatedImpactByPeriodicity).toEqual({ ANUAL: -6000 });
  });

  it("dá bucket próprio a um impacto sem periodicidade declarada", async () => {
    // Never pooled into MENSAL or ANUAL by default: an undeclared periodicity
    // is unknown, not monthly.
    const { set } = await compare(
      [
        ...ATTRIBUTES,
        {
          code: "carreta.valor_aquisicao",
          dataType: "NUMERIC",
          semanticsStatus: "CONFIRMED",
          unit: "BRL",
          periodicity: "PONTUAL",
          aggregation: "SUM",
          isMonetary: true,
          taxonomyCode: "cf_frota_carreta",
        },
      ],
      { AAA1A11: { "carreta.custo_fixo": 100, "carreta.valor_aquisicao": 200000 } },
      { AAA1A11: { "carreta.custo_fixo": 150, "carreta.valor_aquisicao": 210000 } },
    );
    expect(set.calculatedImpactByPeriodicity).toEqual({
      MENSAL: 50,
      PONTUAL: 10000,
    });
  });

  it("ordena por materialidade sem esconder o que é pequeno", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      {
        AAA1A11: { "carreta.custo_fixo": 1000 },
        BBB2B22: { "carreta.custo_fixo": 1000 },
        CCC3C33: { "carreta.custo_fixo": 1000 },
      },
      {
        AAA1A11: { "carreta.custo_fixo": 1001 }, // +1
        BBB2B22: { "carreta.custo_fixo": 9000 }, // +8000
        CCC3C33: { "carreta.custo_fixo": 1050 }, // +50
      },
    );

    expect(rows.map((r) => r.impactAmount)).toEqual([8000, 50, 1]);
    // The one-real change is last, but it is there.
    expect(rows).toHaveLength(3);
  });
});

describe("mudança textual", () => {
  it("é reportada, sem variação numérica inventada", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.modelo": "Randon SR" } },
      { AAA1A11: { "carreta.modelo": "Randon SR 3E" } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nature).toBe("TEXT");
    expect(rows[0].valueBefore).toBe("Randon SR");
    expect(rows[0].valueAfter).toBe("Randon SR 3E");
    expect(rows[0].deltaAbsolute).toBeNull();
    expect(rows[0].deltaPercent).toBeNull();
    expect(rows[0].comparability).toBe("COMPARABLE");
    expect(rows[0].impactConfidence).toBe("NOT_CALCULABLE");
  });

  it("não reporta mudança quando o texto é idêntico", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.modelo": "Randon SR" } },
      { AAA1A11: { "carreta.modelo": "Randon SR" } },
    );
    expect(rows).toHaveLength(0);
  });
});

describe("semântica UNKNOWN", () => {
  it("reporta a mudança mas recusa transformá-la em dinheiro", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.misterio": 100 } },
      { AAA1A11: { "carreta.misterio": 900 } },
    );
    expect(rows).toHaveLength(1);
    // The change is visible and quantified...
    expect(rows[0].deltaAbsolute).toBe(800);
    expect(rows[0].deltaPercent).toBeCloseTo(800, 6);
    expect(rows[0].semanticsStatus).toBe("UNKNOWN");
    // ...but never priced.
    expect(rows[0].impactConfidence).toBe("NOT_CALCULABLE");
    expect(rows[0].impactReason).toMatch(/desconhecida|curadoria/i);
  });
});

describe("aparecimento e desaparecimento de valor", () => {
  it("marca como inconclusivo, com o motivo", async () => {
    const { set, rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": absent("VALUE_MISSING") } },
      { AAA1A11: { "carreta.custo_fixo": 700 } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nature).toBe("APPEARED");
    expect(rows[0].comparability).toBe("INCONCLUSIVE");
    expect(rows[0].inconclusiveReason).toMatch(/não havia valor/i);
    expect(rows[0].deltaAbsolute).toBeNull();
    expect(set.inconclusive).toBe(1);
  });

  it("distingue ausência de zero", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": 0 } },
      { AAA1A11: { "carreta.custo_fixo": absent("VALUE_MISSING") } },
    );
    expect(rows[0].nature).toBe("DISAPPEARED");
    expect(rows[0].comparability).toBe("INCONCLUSIVE");
    expect(rows[0].isNullBefore).toBeFalsy();
  });

  it("reporta troca de motivo de ausência", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": absent("VALUE_MISSING") } },
      { AAA1A11: { "carreta.custo_fixo": absent("EMPTY") } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].nature).toBe("NULL_REASON");
    expect(rows[0].inconclusiveReason).toMatch(/motivo da ausência/i);
  });
});

describe("entrada e saída de ativo", () => {
  it("conta uma vez, não uma por atributo", async () => {
    const { set, rows } = await compare(
      ATTRIBUTES,
      {
        AAA1A11: { "carreta.custo_fixo": 1000, "carreta.modelo": "Randon" },
        BBB2B22: { "carreta.custo_fixo": 2000, "carreta.modelo": "Facchini" },
      },
      {
        AAA1A11: { "carreta.custo_fixo": 1000, "carreta.modelo": "Randon" },
        CCC3C33: { "carreta.custo_fixo": 3000, "carreta.modelo": "Guerra" },
      },
    );

    expect(set.entitiesAdded).toBe(1);
    expect(set.entitiesRemoved).toBe(1);
    // Two assets moved, each producing exactly one change — not two per
    // attribute, which is what a naive diff would emit.
    const fleet = rows.filter((r) => r.category === "FLEET_CHANGE");
    expect(fleet).toHaveLength(2);
    expect(fleet.map((r) => r.entityLabel).sort()).toEqual(["BBB2B22", "CCC3C33"]);
    expect(set.valueChanges).toBe(0);
  });
});

describe("inclusão e remoção de atributo", () => {
  it("detecta coluna nova no layout", async () => {
    const { set, rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": 1000 } },
      { AAA1A11: { "carreta.custo_fixo": 1000, "carreta.emprestada": true } },
    );
    expect(set.attributesAdded).toBe(1);
    expect(set.attributesRemoved).toBe(0);
    const layout = rows.find((r) => r.category === "LAYOUT_CHANGE")!;
    expect(layout.changeType).toBe("ATTRIBUTE_ADDED");
    expect(layout.attributeCode).toBe("carreta.emprestada");
    expect(layout.impactReason).toMatch(/não há valor anterior/i);
  });

  it("detecta coluna que deixou de vir", async () => {
    const { set, rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": 1000, "carreta.modelo": "Randon" } },
      { AAA1A11: { "carreta.custo_fixo": 1000 } },
    );
    expect(set.attributesRemoved).toBe(1);
    const layout = rows.find((r) => r.category === "LAYOUT_CHANGE")!;
    expect(layout.changeType).toBe("ATTRIBUTE_REMOVED");
    expect(layout.attributeCode).toBe("carreta.modelo");
  });
});

describe("identidade, não posição", () => {
  it("segue o ativo mesmo quando a ordem das linhas muda", async () => {
    const { set, rows } = await compare(
      ATTRIBUTES,
      {
        AAA1A11: { "carreta.custo_fixo": 1000 },
        BBB2B22: { "carreta.custo_fixo": 2000 },
        CCC3C33: { "carreta.custo_fixo": 3000 },
      },
      {
        // Same three assets, written in reverse order, one value changed.
        CCC3C33: { "carreta.custo_fixo": 3000 },
        BBB2B22: { "carreta.custo_fixo": 2500 },
        AAA1A11: { "carreta.custo_fixo": 1000 },
      },
    );
    // A positional diff would report three changes here. Identity reports one.
    expect(set.valueChanges).toBe(1);
    expect(rows[0].entityLabel).toBe("BBB2B22");
    expect(rows[0].deltaAbsolute).toBe(500);
  });
});

describe("classificação de custo", () => {
  it("resolve FIXO e VARIAVEL por herança na taxonomia", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.custo_fixo": 1000, "carreta.tarifa_km": 2 } },
      { AAA1A11: { "carreta.custo_fixo": 1100, "carreta.tarifa_km": 3 } },
    );
    const fixo = rows.find((r) => r.attributeCode === "carreta.custo_fixo")!;
    const variavel = rows.find((r) => r.attributeCode === "carreta.tarifa_km")!;
    // The gap the audit found: attributes hang off GROUP nodes, and the class
    // lives on their CLASS ancestor.
    expect(fixo.costClass).toBe("FIXO");
    expect(variavel.costClass).toBe("VARIAVEL");
  });

  it("deixa sem classe o que não foi classificado, em vez de chutar", async () => {
    const { rows } = await compare(
      ATTRIBUTES,
      { AAA1A11: { "carreta.misterio": 1 } },
      { AAA1A11: { "carreta.misterio": 2 } },
    );
    expect(rows[0].costClass).toBeNull();
  });
});
