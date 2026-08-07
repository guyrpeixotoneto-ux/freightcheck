import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  snapshotsTable,
  diffItemsTable,
  snapshotDiffsTable,
  alertsTable,
  shipmentsTable,
  importJobsTable,
} from "@workspace/db";
import { eq, desc, isNull, count, sum, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  try {
    const [snapshotCountResult] = await db
      .select({ count: count() })
      .from(snapshotsTable);

    const [currentSnapshot] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.isCurrent, true))
      .limit(1);

    const [lastImport] = await db
      .select({ importedAt: importJobsTable.importedAt })
      .from(importJobsTable)
      .orderBy(desc(importJobsTable.importedAt))
      .limit(1);

    // Count changes in the latest diff
    const [latestDiff] = await db
      .select()
      .from(snapshotDiffsTable)
      .where(eq(snapshotDiffsTable.status, "DONE"))
      .orderBy(desc(snapshotDiffsTable.generatedAt))
      .limit(1);

    const recentChangesCount = latestDiff
      ? latestDiff.totalAdded + latestDiff.totalRemoved + latestDiff.totalChanged
      : 0;

    const [unreadAlerts] = await db
      .select({ count: count() })
      .from(alertsTable)
      .where(and(eq(alertsTable.isRead, false), eq(alertsTable.isDismissed, false)));

    const [shipmentCount] = await db
      .select({ count: count() })
      .from(shipmentsTable);

    res.json({
      snapshotCount: snapshotCountResult.count,
      currentSnapshot: currentSnapshot ?? null,
      lastImportAt: lastImport?.importedAt ?? null,
      recentChangesCount,
      estimatedMonthlyImpact: latestDiff?.estimatedMonthlyImpact
        ? Number(latestDiff.estimatedMonthlyImpact)
        : null,
      unreadAlertsCount: unreadAlerts.count,
      shipmentCount: shipmentCount.count,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching dashboard summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dashboard/recent-changes", async (req, res): Promise<void> => {
  try {
    const limit = Number(req.query.limit) || 10;

    const [latestDiff] = await db
      .select()
      .from(snapshotDiffsTable)
      .where(eq(snapshotDiffsTable.status, "DONE"))
      .orderBy(desc(snapshotDiffsTable.generatedAt))
      .limit(1);

    if (!latestDiff) {
      res.json([]);
      return;
    }

    // Get snapshots for labels
    const [snapA] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, latestDiff.snapshotAId));
    const [snapB] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, latestDiff.snapshotBId));

    const items = await db
      .select()
      .from(diffItemsTable)
      .where(eq(diffItemsTable.diffId, latestDiff.id))
      .orderBy(desc(diffItemsTable.estimatedMonthlyImpact))
      .limit(limit);

    const result = items.map((item) => ({
      ...item,
      valueBefore: item.valueBefore ? Number(item.valueBefore) : null,
      valueAfter: item.valueAfter ? Number(item.valueAfter) : null,
      deltaAbsolute: item.deltaAbsolute ? Number(item.deltaAbsolute) : null,
      deltaPercent: item.deltaPercent ? Number(item.deltaPercent) : null,
      estimatedMonthlyImpact: item.estimatedMonthlyImpact
        ? Number(item.estimatedMonthlyImpact)
        : null,
      snapshotALabel: snapA?.label ?? null,
      snapshotBLabel: snapB?.label ?? null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error fetching recent changes");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
