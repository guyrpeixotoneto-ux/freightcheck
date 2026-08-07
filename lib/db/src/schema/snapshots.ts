import { pgTable, text, uuid, boolean, integer, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const snapshotsTable = pgTable("snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  snapshotDate: date("snapshot_date", { mode: "string" }).notNull(),
  importJobId: uuid("import_job_id"),
  status: text("status").notNull().default("DRAFT"), // DRAFT|ACTIVE|ARCHIVED
  isCurrent: boolean("is_current").notNull().default(false),
  parameterCount: integer("parameter_count").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSnapshotSchema = createInsertSchema(snapshotsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshotsTable.$inferSelect;
