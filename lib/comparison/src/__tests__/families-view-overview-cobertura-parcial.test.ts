import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * A corrida que `getFamiliesOverview` prevê: `listContexts` viu a
 * competência num contexto elegível, mas `getFamiliesView` não a encontra
 * mais na leitura seguinte (a vigência foi removida entre as duas
 * consultas). Testado à parte porque exercitá-la de verdade exigiria
 * apagar dado no meio de uma requisição em voo — aqui, `getFamiliesView` é
 * simulado para falhar só para um dos dois contextos elegíveis da unidade,
 * mantendo o outro real.
 */
vi.mock("../families-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("../families-view")>();
  return { ...real, getFamiliesView: vi.fn(real.getFamiliesView) };
});

let ctx: TestDb;

const AGOSTO = "2026-08-02";
const JULHO = "2026-07-02";

const CUSTO: AttributeSpec[] = [
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

async function anexarEscopo(
  db: Database,
  snapshotIds: string[],
  entradas: { scopeType: string; code: string }[],
): Promise<void> {
  for (const entrada of entradas) {
    await db.execute(sql`
      INSERT INTO "scope" ("scope_type", "code") VALUES (${entrada.scopeType}, ${entrada.code})
      ON CONFLICT ("scope_type", "code") DO NOTHING
    `);
  }
  for (const snapshotId of snapshotIds) {
    for (const entrada of entradas) {
      await db.execute(sql`
        INSERT INTO "snapshot_scope" ("snapshot_id", "scope_id")
        SELECT ${snapshotId}::uuid, id FROM "scope"
         WHERE scope_type = ${entrada.scopeType} AND code = ${entrada.code}
        ON CONFLICT DO NOTHING
      `);
    }
  }
}

let scopeHashQueFalha: string;

beforeAll(async () => {
  ctx = await createTestDatabase("families_view_overview_parcial");
  await seedTaxonomy(ctx.db, "test");

  // Uma unidade real, dois canais — o único jeito de ter dois contextos
  // elegíveis na mesma competência sem cair na régua de sobreposição.
  const empurrada = await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_7_2026", effectiveDate: JULHO, data: { PPP0001: { "carreta.custo_fixo": 800 } } },
      { label: "EMPURRADA_2_8_2026", effectiveDate: AGOSTO, data: { PPP0001: { "carreta.custo_fixo": 900 } } },
    ],
    { entityType: "CARRETA", scopeHash: "cobertura-parcial-empurrada", canal: "EMPURRADA" },
  );
  const rota = await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "ROTA_2_7_2026", effectiveDate: JULHO, data: { PPP0002: { "carreta.custo_fixo": 300 } } },
      { label: "ROTA_2_8_2026", effectiveDate: AGOSTO, data: { PPP0002: { "carreta.custo_fixo": 500 } } },
    ],
    { entityType: "CARRETA", scopeHash: "cobertura-parcial-rota", canal: "ROTA" },
  );
  await anexarEscopo(
    ctx.db,
    [...Object.values(empurrada.snapshotIds), ...Object.values(rota.snapshotIds)],
    [{ scopeType: "UNIDADE", code: "unidade-cobertura-parcial" }],
  );

  await computeMissingChangeSets(ctx.db, "test");

  scopeHashQueFalha = "cobertura-parcial-rota";
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("getFamiliesOverview — cobertura parcial", () => {
  it("um contexto elegível falhando na leitura não derruba a unidade, mas marca coberturaParcial", async () => {
    const familiesView = await import("../families-view");
    const overview = await import("../families-view-overview");

    const real = await vi.importActual<typeof import("../families-view")>("../families-view");
    const mocked = vi.mocked(familiesView.getFamiliesView);
    mocked.mockImplementation(async (db, period, context) => {
      if (context?.scopeHash === scopeHashQueFalha) return null;
      return real.getFamiliesView(db, period, context);
    });

    try {
      const resultado = await overview.getFamiliesOverview(ctx.db, AGOSTO);
      expect(resultado).not.toBeNull();

      const unidade = resultado!.unitsIncluded.find((u) => u.unidade === "unidade-cobertura-parcial");
      expect(unidade).toBeDefined();
      // Continua incluída — o contexto EMPURRADA respondeu.
      expect(unidade!.contexts).toHaveLength(2);
      // Mas a cobertura não é silenciosamente reportada como completa.
      expect(unidade!.coberturaParcial).toBeDefined();
      expect(unidade!.coberturaParcial).toHaveLength(1);
      expect(unidade!.coberturaParcial![0].scopeHash).toBe(scopeHashQueFalha);
      expect(unidade!.coberturaParcial![0].motivo).toBe("vigencia_indisponivel_na_leitura");

      // A soma reflete só o contexto que respondeu (EMPURRADA: +100/mês), não
      // os dois — o que confirmaria uma soma inventada sobre dado ausente.
      const soEmpurrada = await real.getFamiliesView(ctx.db, AGOSTO, {
        scopeHash: "cobertura-parcial-empurrada",
        channel: "EMPURRADA",
      });
      expect(resultado!.summary.impact.byPeriodicity.MENSAL).toBeCloseTo(
        soEmpurrada!.summary.impact.byPeriodicity.MENSAL,
        2,
      );

      expect(resultado!.unitsExcluded.some((u) => u.unidade === "unidade-cobertura-parcial")).toBe(
        false,
      );
    } finally {
      mocked.mockReset();
    }
  });

  it("se os dois contextos elegíveis falharem, a unidade vira exclusão — nunca inclusão vazia disfarçada", async () => {
    const familiesView = await import("../families-view");
    const overview = await import("../families-view-overview");
    const mocked = vi.mocked(familiesView.getFamiliesView);
    mocked.mockImplementation(async () => null);

    try {
      const resultado = await overview.getFamiliesOverview(ctx.db, AGOSTO);
      expect(resultado).not.toBeNull();
      expect(resultado!.unitsIncluded.some((u) => u.unidade === "unidade-cobertura-parcial")).toBe(
        false,
      );
      const excluida = resultado!.unitsExcluded.find((u) => u.unidade === "unidade-cobertura-parcial");
      expect(excluida?.reason).toBe("vigencia_indisponivel_na_leitura");
    } finally {
      mocked.mockReset();
    }
  });
});
