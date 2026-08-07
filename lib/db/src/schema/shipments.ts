import { pgTable, text, uuid, integer, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const shipmentsTable = pgTable("shipments", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").unique(),
  importJobId: uuid("import_job_id"),
  shipmentDate: date("shipment_date", { mode: "string" }).notNull(),
  operationCode: text("operation_code"),
  originCode: text("origin_code"),
  destinationCode: text("destination_code"),
  routeCode: text("route_code"),
  vehicleType: text("vehicle_type"),         // TRUCK|CARRETA|TOCO
  vehicleId: text("vehicle_id"),
  driverId: text("driver_id"),
  distanceKm: numeric("distance_km", { precision: 10, scale: 2 }),
  weightKg: numeric("weight_kg", { precision: 10, scale: 2 }),
  volumeM3: numeric("volume_m3", { precision: 10, scale: 4 }),
  deliveriesCount: integer("deliveries_count"),
  waitingTimeHours: numeric("waiting_time_hours", { precision: 6, scale: 2 }),
  helpersCount: integer("helpers_count"),
  actualAmountPaid: numeric("actual_amount_paid", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertShipmentSchema = createInsertSchema(shipmentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type Shipment = typeof shipmentsTable.$inferSelect;
