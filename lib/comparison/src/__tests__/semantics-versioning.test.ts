import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { attributeSemanticsTable, attributeTable } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  backfillSemantics,
  correctSemantics,
  getSemanticsHistory,
  recordSourceSemanticsChange,
  resolveSemanticsAt,
  seedTaxonomy,
} from "@workspace/curation";
import { computeChangeSet } from "../engine";
import { listChanges } from "../query";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * Versioned semantics, end to end.
 *
 * The scenario is the one that would break the product worst: a column whose
 * meaning the source changes mid-series. Read naively it looks like a
 * 1.100% rise across the fleet.
 */

let ctx: TestDb;
let snapshotIds: Record<string, string>;

const ATTRIBUTES: AttributeSpec[] = [
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
  {
    code: "carreta.ipva",
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
  ctx = await createTestDatabase("semantics_versioning");
  await seedTaxonomy(ctx.db, "test");
  const built = await buildFixture(ctx.db, ATTRIBUTES, [
    {
      label: "JAN",
      effectiveDate: "2026-01-01",
      data: { AAA1A11: { "carreta.custo_fixo": 1000, "carreta.ipva": 12000 } },
    },
    {
      label: "FEV",
      effectiveDate: "2026-02-01",
      data: { AAA1A11: { "carreta.custo_fixo": 1100, "carreta.ipva": 12000 } },
    },
    {
      label: "MAR",
      effectiveDate: "2026-03-01",
      // custoFixo passa a vir anualizado: 13.200 = 1.100 x 12.
      data: { AAA1A11: { "carreta.custo_fixo": 13200, "carreta.ipva": 9000 } },
    },
  ]);
  snapshotIds = built.snapshotIds;
  await backfillSemantics(ctx.db);
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("backfill", () => {
  it("dá versão 1 a todo atributo, cobrindo a série inteira", async () => {
    const history = await getSemanticsHistory(ctx.db, "carreta.custo_fixo");
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
    expect(history[0].effectiveFrom).toBe("2026-01-01");
    expect(history[0].effectiveUntil).toBeNull();
    expect(history[0].changeOrigin).toBe("INITIAL");
    expect(history[0].periodicity).toBe("MENSAL");
  });

  it("é idempotente", async () => {
    const again = await backfillSemantics(ctx.db);
    expect(again.created).toBe(0);
    expect(again.existing).toBeGreaterThan(0);
  });

  it("não altera comparações existentes — uma versão só nunca é incompatível", async () => {
    const set = await computeChangeSet(ctx.db, snapshotIds.JAN, snapshotIds.FEV, {
      force: true,
    });
    expect(set.valueChanges).toBe(1);
    expect(set.semanticsChanges).toBe(0);
    expect(set.calculatedImpactByPeriodicity).toEqual({ MENSAL: 100 });
  });
});

describe("a fonte muda o significado", () => {
  it("fecha a versão anterior e abre a nova, sem reescrever o passado", async () => {
    await recordSourceSemanticsChange(ctx.db, {
      code: "carreta.custo_fixo",
      effectiveFrom: "2026-03-01",
      periodicity: "ANUAL",
      actor: "guy@operalog",
      reason: "A partir de março a Ambev passou a entregar custoFixo anualizado.",
      status: "CONFIRMED",
      evidenceSnapshotId: snapshotIds.MAR,
    });

    const history = await getSemanticsHistory(ctx.db, "carreta.custo_fixo");
    expect(history).toHaveLength(2);

    // O passado continua verdadeiro para o trecho dele.
    expect(history[0].version).toBe(1);
    expect(history[0].periodicity).toBe("MENSAL");
    expect(history[0].effectiveFrom).toBe("2026-01-01");
    expect(history[0].effectiveUntil).toBe("2026-03-01");

    expect(history[1].version).toBe(2);
    expect(history[1].periodicity).toBe("ANUAL");
    expect(history[1].effectiveUntil).toBeNull();
    expect(history[1].changeOrigin).toBe("SOURCE_SEMANTICS_CHANGE");
  });

  it("resolve o significado pela data da vigência", async () => {
    const emJaneiro = await resolveSemanticsAt(ctx.db, "2026-01-01");
    const emMarco = await resolveSemanticsAt(ctx.db, "2026-03-01");
    const [attribute] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "carreta.custo_fixo"));

    expect(emJaneiro.get(attribute.id)?.periodicity).toBe("MENSAL");
    expect(emMarco.get(attribute.id)?.periodicity).toBe("ANUAL");
  });

  it("mantém attribute como projeção da versão corrente", async () => {
    const [attribute] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "carreta.custo_fixo"));
    expect(attribute.periodicity).toBe("ANUAL");
  });

  it("recusa uma mudança que começaria antes da versão em vigor", async () => {
    await expect(
      recordSourceSemanticsChange(ctx.db, {
        code: "carreta.custo_fixo",
        effectiveFrom: "2026-02-01",
        periodicity: "MENSAL",
        actor: "guy@operalog",
        reason: "Tentando reescrever o passado.",
      }),
    ).rejects.toThrow(/correção, não mudança/);
  });

  it("o banco recusa dois períodos sobrepostos, mesmo por SQL cru", async () => {
    const [attribute] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "carreta.custo_fixo"));
    await expect(
      ctx.pool.query(
        `INSERT INTO attribute_semantics
           (attribute_id, version, effective_from, effective_until, semantics_status)
         VALUES ($1, 99, '2026-01-15', '2026-04-01', 'UNKNOWN')`,
        [attribute.id],
      ),
    ).rejects.toThrow(/attribute_semantics_no_overlap/);
  });
});

describe("a comparação recusa somar significados incompatíveis", () => {
  it("marca a mudança de periodicidade como inconclusiva, sem impacto", async () => {
    const set = await computeChangeSet(ctx.db, snapshotIds.FEV, snapshotIds.MAR, {
      force: true,
    });

    const { rows } = await listChanges(ctx.db, set.id, {
      attributeCode: "carreta.custo_fixo",
      limit: 10,
    });
    const change = rows.find((r) => r.changeType === "VALUE_CHANGED")!;

    // Lido cru, 1.100 -> 13.200 é um aumento de 1.100%.
    expect(change.valueBefore).toBe("1100");
    expect(change.valueAfter).toBe("13200");
    // O produto se recusa a dizer isso.
    expect(change.comparability).toBe("INCONCLUSIVE");
    expect(change.deltaAbsolute).toBeNull();
    expect(change.impactConfidence).toBe("NOT_CALCULABLE");
    expect(change.inconclusiveReason).toMatch(/periodicidade mudou de MENSAL para ANUAL/);
  });

  it("mantém fora do impacto o que ficou incompatível", async () => {
    const set = await computeChangeSet(ctx.db, snapshotIds.FEV, snapshotIds.MAR);
    // Só o IPVA, que não mudou de significado, entra: 12.000 -> 9.000.
    expect(set.calculatedImpactByPeriodicity).toEqual({ ANUAL: -3000 });
    // Os R$ 12.100 de "aumento" do custoFixo não aparecem em lugar nenhum.
    expect(set.calculatedImpactByPeriodicity.MENSAL).toBeUndefined();
  });

  it("compara normalmente o atributo cujo significado não mudou", async () => {
    const set = await computeChangeSet(ctx.db, snapshotIds.FEV, snapshotIds.MAR);
    const { rows } = await listChanges(ctx.db, set.id, {
      attributeCode: "carreta.ipva",
      limit: 10,
    });
    const ipva = rows[0];
    expect(ipva.comparability).toBe("COMPARABLE");
    expect(ipva.deltaAbsolute).toBe(-3000);
    expect(ipva.impactConfidence).toBe("CALCULATED");
  });
});

describe("a mudança de significado é notícia própria", () => {
  it("emite uma linha por atributo, não uma por ativo", async () => {
    const set = await computeChangeSet(ctx.db, snapshotIds.FEV, snapshotIds.MAR);
    expect(set.semanticsChanges).toBe(1);

    const { rows } = await listChanges(ctx.db, set.id, {
      category: "SEMANTICS_CHANGE",
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].attributeCode).toBe("carreta.custo_fixo");
    expect(rows[0].nature).toBe("PERIODICITY");
    expect(rows[0].valueBefore).toBe("MENSAL");
    expect(rows[0].valueAfter).toBe("ANUAL");
    expect(rows[0].entityLabel).toBeNull();
  });
});

describe("correção nossa não vira mudança da fonte", () => {
  it("corrige a versão inteira e não emite SEMANTICS_CHANGE", async () => {
    await correctSemantics(ctx.db, {
      code: "carreta.ipva",
      unit: "BRL",
      calculationBasis: "1,000% do valor da NF",
      actor: "guy@operalog",
      reason: "Base de cálculo identificada; sempre foi assim, eu é que não sabia.",
    });

    const history = await getSemanticsHistory(ctx.db, "carreta.ipva");
    // Uma versão só: corrigir não parte a linha do tempo.
    expect(history).toHaveLength(1);
    expect(history[0].calculationBasis).toBe("1,000% do valor da NF");
    expect(history[0].changeOrigin).toBe("INITIAL");

    const set = await computeChangeSet(ctx.db, snapshotIds.FEV, snapshotIds.MAR, {
      force: true,
    });
    const { rows } = await listChanges(ctx.db, set.id, {
      category: "SEMANTICS_CHANGE",
      limit: 10,
    });
    // Continua só a do custoFixo — a correção do IPVA não virou notícia.
    expect(rows.map((r) => r.attributeCode)).toEqual(["carreta.custo_fixo"]);
  });

  it("registra a correção como CURATION_CHANGE, com quem e por quê", async () => {
    const { rows } = await ctx.db.execute<{ actor: string; reason: string; detail: unknown }>(
      sql`SELECT actor, reason, detail FROM curation_event
           WHERE target_label = 'carreta.ipva' AND field = 'calculation_basis'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toMatch(/@/);
    expect(rows[0].reason).toMatch(/eu é que não sabia/);
    expect((rows[0].detail as { changeOrigin: string }).changeOrigin).toBe(
      "CURATION_CORRECTION",
    );
  });
});

describe("mudança de base de cálculo", () => {
  it("bloqueia a comparação mesmo com unidade e periodicidade iguais", async () => {
    // O caso real do IPVA dos cavalos: BRL e anual dos dois lados, fórmula
    // diferente. Sem isso, uma troca de fórmula lê-se como redução de custo.
    await recordSourceSemanticsChange(ctx.db, {
      code: "carreta.ipva",
      effectiveFrom: "2026-03-01",
      calculationBasis: "0,651% do valor da NF",
      actor: "guy@operalog",
      reason: "A Ambev trocou a fórmula do IPVA a partir de março.",
      status: "CONFIRMED",
    });

    const set = await computeChangeSet(ctx.db, snapshotIds.FEV, snapshotIds.MAR, {
      force: true,
    });
    const { rows } = await listChanges(ctx.db, set.id, {
      attributeCode: "carreta.ipva",
      limit: 10,
    });
    const value = rows.find((r) => r.changeType === "VALUE_CHANGED")!;

    expect(value.comparability).toBe("INCONCLUSIVE");
    expect(value.inconclusiveReason).toMatch(/base de cálculo mudou/);
    expect(value.impactConfidence).toBe("NOT_CALCULABLE");
    // E agora nada é calculável nesta transição.
    expect(set.calculatedImpactByPeriodicity).toEqual({});
    expect(set.semanticsChanges).toBe(2);
  });
});
