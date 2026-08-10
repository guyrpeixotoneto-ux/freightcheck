import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { attributeTable, curationEventTable, factTable } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, realExportPath, type TestDb } from "@workspace/ingest/testing";
import { getCurationQueue, confirmAttribute, runProposalPass } from "../engine";
import { seedTaxonomy } from "../taxonomy";

/**
 * Curation against the real dataset.
 *
 * The theme throughout: the engine may propose, the database decides what can
 * be confirmed, and every edit we make is recorded as a CURATION_CHANGE that
 * never touches a fact.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("curation");
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

describe("the proposal pass proposes and nothing more", () => {
  it("confirms nothing, ever", async () => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(attributeTable)
      .where(eq(attributeTable.semanticsStatus, "CONFIRMED"));
    expect(row.count).toBe(0);
  });

  it("never fills periodicity on its own", async () => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(attributeTable)
      .where(sql`${attributeTable.periodicity} IS NOT NULL`);
    expect(row.count).toBe(0);
  });

  it("writes a rationale for everything it moves to PRESUMED", async () => {
    const presumed = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.semanticsStatus, "PRESUMED"));
    expect(presumed.length).toBeGreaterThan(50);
    for (const attribute of presumed) {
      expect(attribute.semanticsRationale).toBeTruthy();
    }
  });

  it("records every proposal as a CURATION_CHANGE", async () => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable)
      .where(eq(curationEventTable.changeCategory, "CURATION_CHANGE"));
    expect(row.count).toBeGreaterThan(0);

    const [other] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable)
      .where(sql`${curationEventTable.changeCategory} <> 'CURATION_CHANGE'`);
    expect(other.count).toBe(0);
  });

  it("is idempotent — a second pass changes nothing", async () => {
    const before = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable);
    await runProposalPass(ctx.db, "test:proposal-again");
    const after = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(curationEventTable);
    expect(after[0].count).toBe(before[0].count);
  });
});

describe("the periodicity conflict is caught on the real data", () => {
  it("blocks both sides of the ipvaLicenciamento pair", async () => {
    const rows = await ctx.db
      .select()
      .from(attributeTable)
      .where(
        sql`${attributeTable.code} IN ('carreta.ipva_licenciamento', 'carreta.ipva_licenciamento_mensal')`,
      );
    expect(rows).toHaveLength(2);
    for (const attribute of rows) {
      expect(attribute.semanticsStatus).toBe("UNKNOWN");
      expect(attribute.unit).toBeNull();
      expect(attribute.aggregation).toBeNull();
      expect(attribute.semanticsRationale).toMatch(/CONFLITO DE PERIODICIDADE/);
    }
  });

  it("leaves the cavalos counterpart alone — it has no conflicting twin", async () => {
    const [cavalo] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "cavalo.ipva_licenciamento"));
    expect(cavalo.semanticsStatus).toBe("PRESUMED");
    expect(cavalo.unit).toBe("BRL");
  });
});

describe("confirmation is a human act, enforced by the database", () => {
  it("rejects CONFIRMED without an attributed confirmer, even via raw SQL", async () => {
    // A non-monetary attribute, so the only rule that can fire is the one
    // under test: no confirmer, no confirmation.
    await expect(
      ctx.pool.query(
        `UPDATE attribute SET semantics_status = 'CONFIRMED' WHERE code = 'cavalo.chassi'`,
      ),
    ).rejects.toThrow(/attribute_confirmed_requires_actor/);

    // Half an attribution is still no attribution.
    await expect(
      ctx.pool.query(
        `UPDATE attribute SET semantics_status = 'CONFIRMED', confirmed_by = 'alguem'
          WHERE code = 'cavalo.chassi'`,
      ),
    ).rejects.toThrow(/attribute_confirmed_requires_actor/);
  });

  it("rejects a CONFIRMED monetary attribute with unknown periodicity", async () => {
    await expect(
      ctx.pool.query(
        `UPDATE attribute
            SET semantics_status = 'CONFIRMED',
                confirmed_by = 'someone',
                confirmed_at = now(),
                is_monetary = true,
                unit = 'BRL',
                periodicity = NULL,
                aggregation = 'SUM'
          WHERE code = 'carreta.seguro'`,
      ),
    ).rejects.toThrow(/attribute_confirmed_monetary_is_complete/);
  });

  it("refuses a confirmation with no justification", async () => {
    await expect(
      confirmAttribute(ctx.db, {
        code: "carreta.seguro",
        actor: "guy",
        reason: "   ",
      }),
    ).rejects.toThrow(/justificativa/);
  });

  it("refuses to confirm a monetary attribute whose periodicity is still unknown", async () => {
    await expect(
      confirmAttribute(ctx.db, {
        code: "carreta.seguro",
        actor: "guy",
        reason: "Contrato de seguro anual.",
        periodicity: null,
      }),
    ).rejects.toThrow(/periodicidade/i);
  });

  it("confirms when the semantics are complete, and records who and why", async () => {
    await confirmAttribute(ctx.db, {
      code: "carreta.seguro",
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
      taxonomyCode: "cf_seguros_tributos",
      actor: "guy@operalog",
      reason: "Confirmado com a apólice: valor mensal por implemento.",
    });

    const [attribute] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "carreta.seguro"));
    expect(attribute.semanticsStatus).toBe("CONFIRMED");
    expect(attribute.confirmedBy).toBe("guy@operalog");
    expect(attribute.confirmedAt).toBeInstanceOf(Date);
    expect(attribute.periodicity).toBe("MENSAL");

    const events = await ctx.db
      .select()
      .from(curationEventTable)
      .where(
        and(
          eq(curationEventTable.targetLabel, "carreta.seguro"),
          eq(curationEventTable.field, "semantics_status"),
        ),
      );
    const confirmation = events.find((e) => e.valueAfter === "CONFIRMED");
    expect(confirmation).toBeDefined();
    expect(confirmation!.actor).toBe("guy@operalog");
    expect(confirmation!.reason).toMatch(/apólice/);
  });
});

describe("curation never masquerades as a source change", () => {
  it("leaves every fact untouched while semantics move around", async () => {
    const [before] = await ctx.db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        checksum: sql<string>`md5(string_agg(${factTable.valueHash}, '' ORDER BY ${factTable.id}))`,
      })
      .from(factTable);

    await runProposalPass(ctx.db, "test:another-pass");
    await confirmAttribute(ctx.db, {
      code: "carreta.custo_fixo",
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
      actor: "guy@operalog",
      reason: "Custo fixo mensal por implemento, conforme contrato.",
    });

    const [after] = await ctx.db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        checksum: sql<string>`md5(string_agg(${factTable.valueHash}, '' ORDER BY ${factTable.id}))`,
      })
      .from(factTable);

    // Byte-for-byte identical: a reclassification can never be mistaken for
    // the Ambev having changed the remuneration.
    expect(after.count).toBe(before.count);
    expect(after.checksum).toBe(before.checksum);
  });
});

describe("the queue puts the money first", () => {
  it("ranks monetary attributes above the rest, by magnitude", async () => {
    const queue = await getCurationQueue(ctx.db);
    const firstNonMonetary = queue.findIndex((i) => i.isMonetary !== true);
    const lastMonetary = queue.map((i) => i.isMonetary === true).lastIndexOf(true);
    expect(lastMonetary).toBeLessThan(firstNonMonetary);

    const monetary = queue.filter((i) => i.isMonetary === true);
    expect(monetary.length).toBeGreaterThanOrEqual(20);
    expect(monetary[0].code).toBe("cavalo.valor_nf_compra");

    // Descending magnitude within the monetary block.
    for (let i = 1; i < monetary.length; i++) {
      expect(Math.abs(monetary[i - 1].magnitude ?? 0)).toBeGreaterThanOrEqual(
        Math.abs(monetary[i].magnitude ?? 0),
      );
    }
  });

  it("drops an attribute from the queue once it is confirmed", async () => {
    const queue = await getCurationQueue(ctx.db);
    expect(queue.map((i) => i.code)).not.toContain("carreta.seguro");
  });
});

describe("taxonomy", () => {
  it("is idempotent", async () => {
    const again = await seedTaxonomy(ctx.db, "test:bootstrap-again");
    expect(again.created).toBe(0);
    expect(again.existing).toBeGreaterThan(0);
  });
});
