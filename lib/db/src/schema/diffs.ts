import { pgTable, text, uuid, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { snapshotsTable } from "./snapshots";

export const snapshotDiffsTable = pgTable("snapshot_diffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotAId: uuid("snapshot_a_id").notNull().references(() => snapshotsTable.id),
  snapshotBId: uuid("snapshot_b_id").notNull().references(() => snapshotsTable.id),
  status: text("status").notNull().default("PENDING"), // PENDING|DONE|FAILED
  totalAdded: integer("total_added").notNull().default(0),
  totalRemoved: integer("total_removed").notNull().default(0),
  totalChanged: integer("total_changed").notNull().default(0),
  totalUnchanged: integer("total_unchanged").notNull().default(0),
  estimatedMonthlyImpact: numeric("estimated_monthly_impact", { precision: 15, scale: 2 }),
  notes: text("notes"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const diffItemsTable = pgTable("diff_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  diffId: uuid("diff_id").notNull().references(() => snapshotDiffsTable.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(), // PARAMETER|TARIFF_TABLE|RULE
  entityKey: text("entity_key").notNull(),
  entityName: text("entity_name").notNull(),
  changeType: text("change_type").notNull(), // ADDED|REMOVED|CHANGED|UNCHANGED
  changeNature: text("change_nature"),        // PRICE_CHANGE|RANGE_CHANGE|FORMULA_CHANGE|etc.
  severity: text("severity").default("UNKNOWN"), // LOW|MEDIUM|HIGH|CRITICAL|UNKNOWN
  valueBefore: numeric("value_before", { precision: 15, scale: 2 }),
  valueAfter: numeric("value_after", { precision: 15, scale: 2 }),
  valueBeforeText: text("value_before_text"),
  valueAfterText: text("value_after_text"),
  deltaAbsolute: numeric("delta_absolute", { precision: 15, scale: 2 }),
  deltaPercent: numeric("delta_percent", { precision: 8, scale: 4 }),
  estimatedMonthlyImpact: numeric("estimated_monthly_impact", { precision: 15, scale: 2 }),
  unit: text("unit"),
  notes: text("notes"),
});

export const insertSnapshotDiffSchema = createInsertSchema(snapshotDiffsTable).omit({
  id: true,
  generatedAt: true,
});
export type InsertSnapshotDiff = z.infer<typeof insertSnapshotDiffSchema>;
export type SnapshotDiff = typeof snapshotDiffsTable.$inferSelect;

export const insertDiffItemSchema = createInsertSchema(diffItemsTable).omit({
  id: true,
});
export type InsertDiffItem = z.infer<typeof insertDiffItemSchema>;
export type DiffItem = typeof diffItemsTable.$inferSelect;
