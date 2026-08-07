import { pgTable, text, uuid, boolean, integer, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { snapshotsTable } from "./snapshots";

export const parametersTable = pgTable("parameters", {
  id: uuid("id").primaryKey().defaultRandom(),
  snapshotId: uuid("snapshot_id").notNull().references(() => snapshotsTable.id),
  parameterKey: text("parameter_key").notNull(),
  parameterName: text("parameter_name").notNull(),
  category: text("category").notNull(), // TARIFF|SURCHARGE|PENALTY|BONUS
  dataType: text("data_type").notNull(), // NUMERIC|PERCENTAGE|BOOLEAN|TEXT
  unit: text("unit"),                    // BRL|BRL_PER_KM|HOURS|KG
  scopeLabel: text("scope_label"),       // human-readable scope (e.g. "Operação Recife / Carreta")
  valueNumeric: numeric("value_numeric", { precision: 15, scale: 2 }),
  valueText: text("value_text"),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveUntil: date("effective_until", { mode: "string" }),
  version: integer("version").notNull().default(1),
  isSuperseded: boolean("is_superseded").notNull().default(false),
  source: text("source"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertParameterSchema = createInsertSchema(parametersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertParameter = z.infer<typeof insertParameterSchema>;
export type Parameter = typeof parametersTable.$inferSelect;
