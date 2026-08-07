import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { simulationRunsTable, snapshotsTable, shipmentsTable } from "@workspace/db";
import { eq, desc, and, gte, lte, count } from "drizzle-orm";
import { CreateSimulationBody, GetSimulationParams } from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichSimulation(sim: typeof simulationRunsTable.$inferSelect) {
  const [snapA] = await db
    .select({ label: snapshotsTable.label })
    .from(snapshotsTable)
    .where(eq(snapshotsTable.id, sim.snapshotAId));
  const snapBLabel = sim.snapshotBId
    ? await db
        .select({ label: snapshotsTable.label })
        .from(snapshotsTable)
        .where(eq(snapshotsTable.id, sim.snapshotBId))
        .then(([r]) => r?.label ?? null)
    : null;

  return {
    ...sim,
    snapshotALabel: snapA?.label ?? null,
    snapshotBLabel: snapBLabel,
    totalAmountA: sim.totalAmountA ? Number(sim.totalAmountA) : null,
    totalAmountB: sim.totalAmountB ? Number(sim.totalAmountB) : null,
    totalDelta: sim.totalDelta ? Number(sim.totalDelta) : null,
    deltaPercent: sim.deltaPercent ? Number(sim.deltaPercent) : null,
    annualizedDelta: sim.annualizedDelta ? Number(sim.annualizedDelta) : null,
    completedAt: sim.completedAt ? sim.completedAt.toISOString() : null,
  };
}

router.get("/simulations", async (_req, res): Promise<void> => {
  try {
    const sims = await db
      .select()
      .from(simulationRunsTable)
      .orderBy(desc(simulationRunsTable.createdAt));

    const enriched = await Promise.all(sims.map(enrichSimulation));
    res.json(enriched);
  } catch (err) {
    _req.log.error({ err }, "Error listing simulations");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/simulations", async (req, res): Promise<void> => {
  try {
    const parsed = CreateSimulationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { label, snapshotAId, snapshotBId, dateFrom, dateUntil } = parsed.data;

    // Count shipments in period for context
    const [shipmentCount] = await db
      .select({ count: count() })
      .from(shipmentsTable)
      .where(
        and(
          gte(shipmentsTable.shipmentDate, String(dateFrom)),
          lte(shipmentsTable.shipmentDate, String(dateUntil))
        )
      );

    // For now: basic simulation using demo data
    // In future: apply actual rules per shipment
    const totalShipments = shipmentCount.count;
    const baseMonthlyRevenue = 4830000; // Demo reference
    const newMonthlyRevenue = snapshotBId ? 4611000 : baseMonthlyRevenue;
    const delta = newMonthlyRevenue - baseMonthlyRevenue;
    const deltaPercent = (delta / baseMonthlyRevenue) * 100;

    const [sim] = await db
      .insert(simulationRunsTable)
      .values({
        label,
        snapshotAId,
        snapshotBId: snapshotBId ?? null,
        dateFrom: String(dateFrom),
        dateUntil: String(dateUntil),
        status: "DONE",
        totalShipments,
        totalAmountA: baseMonthlyRevenue.toString(),
        totalAmountB: snapshotBId ? newMonthlyRevenue.toString() : null,
        totalDelta: snapshotBId ? delta.toString() : null,
        deltaPercent: snapshotBId ? deltaPercent.toFixed(4) : null,
        annualizedDelta: snapshotBId ? (delta * 12).toString() : null,
      })
      .returning();

    const enriched = await enrichSimulation(sim);
    res.status(201).json(enriched);
  } catch (err) {
    req.log.error({ err }, "Error creating simulation");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/simulations/:id", async (req, res): Promise<void> => {
  try {
    const params = GetSimulationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [sim] = await db
      .select()
      .from(simulationRunsTable)
      .where(eq(simulationRunsTable.id, params.data.id));

    if (!sim) {
      res.status(404).json({ error: "Simulação não encontrada" });
      return;
    }

    res.json(await enrichSimulation(sim));
  } catch (err) {
    req.log.error({ err }, "Error fetching simulation");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
