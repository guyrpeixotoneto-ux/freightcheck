import { pgTable, text, uuid, boolean, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertsTable = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  alertType: text("alert_type").notNull(), // PARAMETER_CHANGE|NEW_SNAPSHOT|DIVERGENCE
  severity: text("severity").notNull(),    // LOW|MEDIUM|HIGH|CRITICAL
  title: text("title").notNull(),
  body: text("body"),
  sourceDiffId: uuid("source_diff_id"),
  sourceDiffItemId: uuid("source_diff_item_id"),
  estimatedImpact: numeric("estimated_impact", { precision: 15, scale: 2 }),
  isRead: boolean("is_read").notNull().default(false),
  isDismissed: boolean("is_dismissed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;
