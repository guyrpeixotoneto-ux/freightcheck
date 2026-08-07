import { pgTable, text, uuid, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const importJobsTable = pgTable("import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: text("source_type").notNull(), // CSV|EXCEL|MANUAL|API|PDF
  filename: text("filename"),
  checksum: text("checksum").unique(),        // SHA-256 for idempotency
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("PENDING"), // PENDING|PROCESSING|DONE|FAILED|SKIPPED
  snapshotId: uuid("snapshot_id"),
  rowCount: integer("row_count"),
  validCount: integer("valid_count"),
  warningCount: integer("warning_count"),
  errorCount: integer("error_count"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertImportJobSchema = createInsertSchema(importJobsTable).omit({
  id: true,
  importedAt: true,
  createdAt: true,
});
export type InsertImportJob = z.infer<typeof insertImportJobSchema>;
export type ImportJob = typeof importJobsTable.$inferSelect;
