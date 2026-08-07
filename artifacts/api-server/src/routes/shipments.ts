import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { shipmentsTable } from "@workspace/db";
import { eq, and, gte, lte, desc, count, sum, avg } from "drizzle-orm";
import { CreateShipmentBody, ListShipmentsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/shipments", async (req, res): Promise<void> => {
  try {
    const query = ListShipmentsQueryParams.safeParse(req.query);
    const conditions = [];

    if (query.success) {
      if (query.data.operationCode) {
        conditions.push(eq(shipmentsTable.operationCode, query.data.operationCode));
      }
      if (query.data.vehicleType) {
        conditions.push(eq(shipmentsTable.vehicleType, query.data.vehicleType));
      }
      if (query.data.dateFrom) {
        conditions.push(gte(shipmentsTable.shipmentDate, String(query.data.dateFrom)));
      }
      if (query.data.dateUntil) {
        conditions.push(lte(shipmentsTable.shipmentDate, String(query.data.dateUntil)));
      }
    }

    const limit = (query.success && query.data.limit) ? Number(query.data.limit) : 50;

    const shipments = await db
      .select()
      .from(shipmentsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(shipmentsTable.shipmentDate))
      .limit(limit);

    const result = shipments.map((s) => ({
      ...s,
      distanceKm: s.distanceKm ? Number(s.distanceKm) : null,
      weightKg: s.weightKg ? Number(s.weightKg) : null,
      waitingTimeHours: s.waitingTimeHours ? Number(s.waitingTimeHours) : null,
      actualAmountPaid: s.actualAmountPaid ? Number(s.actualAmountPaid) : null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error listing shipments");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/shipments", async (req, res): Promise<void> => {
  try {
    const parsed = CreateShipmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [shipment] = await db
      .insert(shipmentsTable)
      .values({
        shipmentDate: String(parsed.data.shipmentDate),
        externalId: parsed.data.externalId ?? null,
        operationCode: parsed.data.operationCode ?? null,
        originCode: parsed.data.originCode ?? null,
        destinationCode: parsed.data.destinationCode ?? null,
        routeCode: parsed.data.routeCode ?? null,
        vehicleType: parsed.data.vehicleType ?? null,
        vehicleId: parsed.data.vehicleId ?? null,
        distanceKm: parsed.data.distanceKm?.toString() ?? null,
        weightKg: parsed.data.weightKg?.toString() ?? null,
        deliveriesCount: parsed.data.deliveriesCount ?? null,
        waitingTimeHours: parsed.data.waitingTimeHours?.toString() ?? null,
        actualAmountPaid: parsed.data.actualAmountPaid?.toString() ?? null,
      })
      .returning();

    res.status(201).json({
      ...shipment,
      distanceKm: shipment.distanceKm ? Number(shipment.distanceKm) : null,
      weightKg: shipment.weightKg ? Number(shipment.weightKg) : null,
      waitingTimeHours: shipment.waitingTimeHours
        ? Number(shipment.waitingTimeHours)
        : null,
      actualAmountPaid: shipment.actualAmountPaid
        ? Number(shipment.actualAmountPaid)
        : null,
    });
  } catch (err) {
    req.log.error({ err }, "Error creating shipment");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/shipments/stats", async (_req, res): Promise<void> => {
  try {
    const [totals] = await db
      .select({
        totalShipments: count(),
        totalAmountPaid: sum(shipmentsTable.actualAmountPaid),
        avgDistanceKm: avg(shipmentsTable.distanceKm),
      })
      .from(shipmentsTable);

    // Group by vehicle type
    const byVehicle = await db
      .select({
        vehicleType: shipmentsTable.vehicleType,
        cnt: count(),
        total: sum(shipmentsTable.actualAmountPaid),
      })
      .from(shipmentsTable)
      .groupBy(shipmentsTable.vehicleType);

    // Group by operation
    const byOp = await db
      .select({
        operationCode: shipmentsTable.operationCode,
        cnt: count(),
        total: sum(shipmentsTable.actualAmountPaid),
      })
      .from(shipmentsTable)
      .groupBy(shipmentsTable.operationCode);

    res.json({
      totalShipments: totals.totalShipments,
      totalAmountPaid: totals.totalAmountPaid ? Number(totals.totalAmountPaid) : null,
      avgDistanceKm: totals.avgDistanceKm ? Number(totals.avgDistanceKm) : null,
      byVehicleType: byVehicle.map((v) => ({
        vehicleType: v.vehicleType ?? "Desconhecido",
        count: v.cnt,
        totalAmount: v.total ? Number(v.total) : null,
      })),
      byOperation: byOp.map((o) => ({
        operationCode: o.operationCode ?? "Desconhecida",
        count: o.cnt,
        totalAmount: o.total ? Number(o.total) : null,
      })),
    });
  } catch (err) {
    _req.log.error({ err }, "Error fetching shipment stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
