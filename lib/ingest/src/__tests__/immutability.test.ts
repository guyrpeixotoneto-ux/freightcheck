import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  factTable,
  rawCellTable,
  rawSheetTable,
  snapshotTable,
  sourceFileTable,
} from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { createTestDatabase, realExportPath, type TestDb } from "../testing";

/**
 * These invariants are enforced by database triggers, so the tests deliberately
 * bypass the application layer and issue raw SQL. Anything the application can
 * be talked into doing, a stray script can do too — the guard has to live
 * below both.
 */

let ctx: TestDb;
let snapshotId: string;

beforeAll(async () => {
  ctx = await createTestDatabase("immutability");
  const received = await receiveFile(ctx.db, { filePath: realExportPath() });
  await captureRaw(ctx.db, received.importRunId);
  await stage(ctx.db, received.importRunId);
  await preview(ctx.db, received.importRunId);
  const result = await promote(ctx.db, received.importRunId);
  snapshotId = result.snapshotIds[0];
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("RAW is immutable", () => {
  it("rejects UPDATE on every RAW table", async () => {
    await expect(
      ctx.pool.query(`UPDATE raw_cell SET raw_value = 'tampered' WHERE id = (SELECT min(id) FROM raw_cell)`),
    ).rejects.toThrow(/RAW layer is immutable/);

    await expect(
      ctx.pool.query(`UPDATE raw_sheet SET sheet_name = 'tampered'`),
    ).rejects.toThrow(/RAW layer is immutable/);

    await expect(
      ctx.pool.query(`UPDATE source_file SET filename = 'tampered'`),
    ).rejects.toThrow(/RAW layer is immutable/);

    await expect(
      ctx.pool.query(`UPDATE raw_row SET row_index = -1`),
    ).rejects.toThrow(/RAW layer is immutable/);
  });

  it("rejects DELETE on every RAW table", async () => {
    await expect(ctx.pool.query(`DELETE FROM raw_cell`)).rejects.toThrow(
      /RAW layer is immutable/,
    );
    await expect(ctx.pool.query(`DELETE FROM source_file`)).rejects.toThrow(
      /RAW layer is immutable/,
    );
  });

  it("leaves the evidence intact after the failed attempts", async () => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(rawCellTable);
    expect(row.count).toBeGreaterThan(80_000);

    const [tampered] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(rawCellTable)
      .where(eq(rawCellTable.rawValue, "tampered"));
    expect(tampered.count).toBe(0);

    const files = await ctx.db.select().from(sourceFileTable);
    expect(files.every((f) => f.filename !== "tampered")).toBe(true);
  });
});

describe("a closed snapshot is immutable", () => {
  it("rejects any field change on a CLOSED snapshot", async () => {
    await expect(
      ctx.pool.query(`UPDATE snapshot SET source_label = 'tampered' WHERE id = $1`, [
        snapshotId,
      ]),
    ).rejects.toThrow(/CLOSED and immutable/);

    await expect(
      ctx.pool.query(`UPDATE snapshot SET effective_date = '1999-01-01' WHERE id = $1`, [
        snapshotId,
      ]),
    ).rejects.toThrow(/CLOSED and immutable/);

    await expect(
      ctx.pool.query(`UPDATE snapshot SET fact_count = 0 WHERE id = $1`, [snapshotId]),
    ).rejects.toThrow(/CLOSED and immutable/);
  });

  it("rejects deleting a closed snapshot", async () => {
    await expect(
      ctx.pool.query(`DELETE FROM snapshot WHERE id = $1`, [snapshotId]),
    ).rejects.toThrow(/cannot be deleted/);
  });

  it("freezes the facts of a closed snapshot against write, update and delete", async () => {
    await expect(
      ctx.pool.query(
        `UPDATE fact SET value_numeric = 999 WHERE snapshot_id = $1 AND value_numeric IS NOT NULL`,
        [snapshotId],
      ),
    ).rejects.toThrow(/facts are immutable/);

    await expect(
      ctx.pool.query(`DELETE FROM fact WHERE snapshot_id = $1`, [snapshotId]),
    ).rejects.toThrow(/facts are immutable/);

    // Not even appending a new fact to a closed snapshot.
    await expect(
      ctx.pool.query(
        `INSERT INTO fact (snapshot_id, entity_id, attribute_id, value_numeric, value_hash, is_null, raw_cell_id)
         SELECT $1, entity_id, attribute_id, 1, 'n:1', false, raw_cell_id
         FROM fact WHERE snapshot_id = $1 LIMIT 1`,
        [snapshotId],
      ),
    ).rejects.toThrow(/facts are immutable/);
  });

  it("allows only the CLOSED -> SUPERSEDED transition", async () => {
    const [before] = await ctx.db
      .select()
      .from(snapshotTable)
      .where(eq(snapshotTable.id, snapshotId));
    expect(before.status).toBe("CLOSED");

    // Reopening a closed snapshot is forbidden — that would erase history.
    await expect(
      ctx.pool.query(`UPDATE snapshot SET status = 'DRAFT' WHERE id = $1`, [snapshotId]),
    ).rejects.toThrow(/CLOSED and immutable/);

    // Stepping aside for a revision is allowed, and preserves the row.
    await ctx.pool.query(`UPDATE snapshot SET status = 'SUPERSEDED' WHERE id = $1`, [
      snapshotId,
    ]);
    const [after] = await ctx.db
      .select()
      .from(snapshotTable)
      .where(eq(snapshotTable.id, snapshotId));
    expect(after.status).toBe("SUPERSEDED");
    expect(after.sourceLabel).toBe(before.sourceLabel);
    expect(after.factCount).toBe(before.factCount);

    // SUPERSEDED is terminal.
    await expect(
      ctx.pool.query(`UPDATE snapshot SET status = 'CLOSED' WHERE id = $1`, [snapshotId]),
    ).rejects.toThrow(/terminal/);
  });

  it("kept every fact of the superseded snapshot", async () => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(factTable)
      .where(eq(factTable.snapshotId, snapshotId));
    expect(row.count).toBeGreaterThan(0);
  });
});

describe("money is never a float", () => {
  it("stores quantitative values as NUMERIC(18,6)", async () => {
    const { rows } = await ctx.pool.query<{
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      `SELECT data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_name = 'fact' AND column_name = 'value_numeric'`,
    );
    expect(rows[0].data_type).toBe("numeric");
    expect(rows[0].numeric_precision).toBe(18);
    expect(rows[0].numeric_scale).toBe(6);
  });

  it("has no floating-point column anywhere in the schema", async () => {
    const { rows } = await ctx.pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('real', 'double precision')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("revision handling", () => {
  it("records a corrected vigência as a new revision instead of an edit", async () => {
    const fresh = await createTestDatabase("revision");
    try {
      const first = await receiveFile(fresh.db, { filePath: realExportPath() });
      await captureRaw(fresh.db, first.importRunId);
      await stage(fresh.db, first.importRunId);
      await preview(fresh.db, first.importRunId);
      await promote(fresh.db, first.importRunId);

      const { copyFileSync, appendFileSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const path = await import("node:path");
      const copy = path.join(tmpdir(), `freightec-revision-${process.pid}.xlsx`);
      copyFileSync(realExportPath(), copy);
      appendFileSync(copy, Buffer.from("revision"));

      const second = await receiveFile(fresh.db, { filePath: copy });
      await captureRaw(fresh.db, second.importRunId);
      await stage(fresh.db, second.importRunId);
      await preview(fresh.db, second.importRunId);
      const result = await promote(fresh.db, second.importRunId, {
        onExistingSnapshot: "NEW_REVISION",
      });

      expect(result.snapshots.every((s) => s.revision === 2)).toBe(true);

      const all = await fresh.db.select().from(snapshotTable);
      expect(all).toHaveLength(18); // 9 superseded + 9 live
      expect(all.filter((s) => s.status === "SUPERSEDED")).toHaveLength(9);
      expect(all.filter((s) => s.status === "CLOSED")).toHaveLength(9);

      // Every revision 2 points back at the revision it replaced.
      for (const snapshot of all.filter((s) => s.revision === 2)) {
        expect(snapshot.supersedesSnapshotId).toBeTruthy();
      }
    } finally {
      await fresh.drop();
    }
  }, 300_000);
});
