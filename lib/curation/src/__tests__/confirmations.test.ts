import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { attributeTable, curationEventTable, factTable } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, realExportPath, type TestDb } from "@workspace/ingest/testing";
import { applyConfirmations, CONFIRMED_SEMANTICS } from "../confirmations";
import { runProposalPass } from "../engine";
import { seedTaxonomy } from "../taxonomy";

/**
 * The confirmed-semantics registry.
 *
 * Its job is to carry a person's decision into any fresh database without
 * loosening a single guard along the way.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("confirmations");
  const received = await receiveFile(ctx.db, { filePath: realExportPath() });
  await captureRaw(ctx.db, received.importRunId);
  await stage(ctx.db, received.importRunId);
  await preview(ctx.db, received.importRunId);
  await promote(ctx.db, received.importRunId);
  await seedTaxonomy(ctx.db, "test:bootstrap");
  await runProposalPass(ctx.db, "test:proposal");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("the registry only records real decisions", () => {
  it("attributes every entry to a person and states the basis", () => {
    expect(CONFIRMED_SEMANTICS.length).toBeGreaterThan(0);
    for (const entry of CONFIRMED_SEMANTICS) {
      expect(entry.confirmedBy).toMatch(/@/);
      expect(entry.confirmedBy).not.toMatch(/^(engine|api|cli|system):/);
      expect(entry.basis.trim().length).toBeGreaterThan(20);
    }
  });

  it("keeps rates out of money, and money out of rates", () => {
    for (const entry of CONFIRMED_SEMANTICS) {
      if (entry.unit === "PERCENT") {
        // A rate is never summed and never counted as an amount.
        expect(entry.isMonetary).toBe(false);
        expect(entry.aggregation).toBe("NONE");
      }
      if (entry.isMonetary) {
        // The database would reject this anyway; failing here is friendlier.
        expect(entry.unit).not.toBeNull();
        expect(entry.periodicity).not.toBeNull();
        expect(entry.aggregation).not.toBe("NONE");
      }
    }
  });
});

describe("applying the registry", () => {
  it("confirms exactly the listed attributes and nothing else", async () => {
    const result = await applyConfirmations(ctx.db);
    expect(result.missing).toEqual([]);
    expect(result.applied.sort()).toEqual(
      CONFIRMED_SEMANTICS.map((e) => e.code).sort(),
    );

    const confirmed = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.semanticsStatus, "CONFIRMED"));
    expect(confirmed.map((a) => a.code).sort()).toEqual(
      CONFIRMED_SEMANTICS.map((e) => e.code).sort(),
    );
  });

  it("records the person and the basis, not the tooling", async () => {
    const [custoFixo] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "carreta.custo_fixo"));
    expect(custoFixo.periodicity).toBe("MENSAL");
    expect(custoFixo.isMonetary).toBe(true);
    expect(custoFixo.confirmedBy).toMatch(/@/);
    expect(custoFixo.semanticsRationale).toMatch(/transportador/i);

    const [event] = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        sql`${curationEventTable.targetLabel} = 'carreta.custo_fixo'
            AND ${curationEventTable.field} = 'semantics_status'
            AND ${curationEventTable.valueAfter} = 'CONFIRMED'`,
      );
    expect(event.actor).toMatch(/@/);
    expect(event.reason).toMatch(/mensal/i);
  });

  it("turns the tax columns into rates that cannot be summed", async () => {
    for (const code of ["carreta.icms", "carreta.pis_cofins"]) {
      const [attribute] = await ctx.db
        .select()
        .from(attributeTable)
        .where(eq(attributeTable.code, code));
      expect(attribute.unit).toBe("PERCENT");
      expect(attribute.aggregation).toBe("NONE");
      expect(attribute.isMonetary).toBe(false);
      expect(attribute.periodicity).toBeNull();
    }

    // The matching amount columns are a different thing and stay monetary.
    const [valorPisCofins] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "carreta.valor_pis_cofins"));
    expect(valorPisCofins.isMonetary).toBe(true);
  });

  it("is idempotent — a second run writes nothing", async () => {
    const [before] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable);

    const second = await applyConfirmations(ctx.db);
    expect(second.applied).toEqual([]);
    expect(second.unchanged.sort()).toEqual(
      CONFIRMED_SEMANTICS.map((e) => e.code).sort(),
    );

    const [after] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable);
    expect(after.count).toBe(before.count);
  });

  it("leaves the Ambev's facts untouched", async () => {
    const [before] = await ctx.db
      .select({
        checksum: sql<string>`md5(string_agg(${factTable.valueHash}, '' ORDER BY ${factTable.id}))`,
      })
      .from(factTable);
    await applyConfirmations(ctx.db);
    const [after] = await ctx.db
      .select({
        checksum: sql<string>`md5(string_agg(${factTable.valueHash}, '' ORDER BY ${factTable.id}))`,
      })
      .from(factTable);
    expect(after.checksum).toBe(before.checksum);
  });

  it("reports a missing attribute instead of failing silently", async () => {
    const result = await applyConfirmations(ctx.db, [
      {
        code: "cavalo.coluna_que_nao_existe",
        unit: "BRL",
        periodicity: "MENSAL",
        aggregation: "SUM",
        isMonetary: true,
        confirmedBy: "alguem@empresa.com",
        basis: "Entrada deliberadamente inválida para exercitar o relatório.",
      },
    ]);
    expect(result.missing).toEqual(["cavalo.coluna_que_nao_existe"]);
    expect(result.applied).toEqual([]);
  });
});
