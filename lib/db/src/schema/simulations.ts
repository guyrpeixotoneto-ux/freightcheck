import { pgTable, text, uuid, integer, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { snapshotsTable } from "./snapshots";

export const simulationRunsTable = pgTable("simulation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  snapshotAId: uuid("snapshot_a_id").notNull().references(() => snapshotsTable.id),
  snapshotBId: uuid("snapshot_b_id").references(() => snapshotsTable.id),
  dateFrom: date("date_from", { mode: "string" }).notNull(),
  dateUntil: date("date_until", { mode: "string" }).notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING|RUNNING|DONE|FAILED
  totalShipments: integer("total_shipments"),
  totalAmountA: numeric("total_amount_a", { precision: 15, scale: 2 }),
  totalAmountB: numeric("total_amount_b", { precision: 15, scale: 2 }),
  totalDelta: numeric("total_delta", { precision: 15, scale: 2 }),
  deltaPercent: numeric("delta_percent", { precision: 8, scale: 4 }),
  annualizedDelta: numeric("annualized_delta", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertSimulationRunSchema = createInsertSchema(simulationRunsTable).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});
export type InsertSimulationRun = z.infer<typeof insertSimulationRunSchema>;
export type SimulationRun = typeof simulationRunsTable.$inferSelect;
