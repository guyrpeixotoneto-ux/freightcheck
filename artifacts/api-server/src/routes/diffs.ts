import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  snapshotDiffsTable,
  diffItemsTable,
  parametersTable,
  snapshotsTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  CreateDiffBody,
  GetDiffParams,
  GetDiffItemsParams,
  GetDiffItemsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/diffs", async (_req, res): Promise<void> => {
  try {
    const diffs = await db
      .select()
      .from(snapshotDiffsTable)
      .orderBy(desc(snapshotDiffsTable.generatedAt));

    // Enrich with snapshot labels
    const enriched = await Promise.all(
      diffs.map(async (d) => {
        const [snapA] = await db
          .select({ label: snapshotsTable.label })
          .from(snapshotsTable)
          .where(eq(snapshotsTable.id, d.snapshotAId));
        const [snapB] = await db
          .select({ label: snapshotsTable.label })
          .from(snapshotsTable)
          .where(eq(snapshotsTable.id, d.snapshotBId));
        return {
          ...d,
          estimatedMonthlyImpact: d.estimatedMonthlyImpact
            ? Number(d.estimatedMonthlyImpact)
            : null,
          snapshotALabel: snapA?.label ?? null,
          snapshotBLabel: snapB?.label ?? null,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    _req.log.error({ err }, "Error listing diffs");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/diffs", async (req, res): Promise<void> => {
  try {
    const parsed = CreateDiffBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { snapshotAId, snapshotBId } = parsed.data;

    if (snapshotAId === snapshotBId) {
      res.status(400).json({ error: "Snapshots A e B devem ser diferentes" });
      return;
    }

    const [snapA] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, snapshotAId));
    const [snapB] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, snapshotBId));

    if (!snapA || !snapB) {
      res.status(400).json({ error: "Um ou ambos os snapshots não foram encontrados" });
      return;
    }

    // Create the diff record
    const [diff] = await db
      .insert(snapshotDiffsTable)
      .values({
        snapshotAId,
        snapshotBId,
        status: "PENDING",
        notes: parsed.data.notes ?? null,
      })
      .returning();

    // Get parameters for both snapshots
    const paramsA = await db
      .select()
      .from(parametersTable)
      .where(eq(parametersTable.snapshotId, snapshotAId));
    const paramsB = await db
      .select()
      .from(parametersTable)
      .where(eq(parametersTable.snapshotId, snapshotBId));

    const mapA = new Map(paramsA.map((p) => [p.parameterKey, p]));
    const mapB = new Map(paramsB.map((p) => [p.parameterKey, p]));
    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

    const diffItems = [];
    let totalAdded = 0;
    let totalRemoved = 0;
    let totalChanged = 0;
    let totalUnchanged = 0;
    let estimatedMonthlyImpact = 0;

    for (const key of allKeys) {
      const a = mapA.get(key);
      const b = mapB.get(key);

      if (!a && b) {
        totalAdded++;
        diffItems.push({
          diffId: diff.id,
          entityType: "PARAMETER",
          entityKey: key,
          entityName: b.parameterName,
          changeType: "ADDED",
          changeNature: "NEW_RULE",
          severity: "MEDIUM",
          valueBefore: null,
          valueAfter: b.valueNumeric ?? null,
          valueBeforeText: null,
          valueAfterText: b.valueText ?? null,
          deltaAbsolute: b.valueNumeric ? b.valueNumeric : null,
          deltaPercent: null,
          estimatedMonthlyImpact: null,
          unit: b.unit ?? null,
        });
      } else if (a && !b) {
        totalRemoved++;
        diffItems.push({
          diffId: diff.id,
          entityType: "PARAMETER",
          entityKey: key,
          entityName: a.parameterName,
          changeType: "REMOVED",
          changeNature: "REMOVED_RULE",
          severity: "HIGH",
          valueBefore: a.valueNumeric ?? null,
          valueAfter: null,
          valueBeforeText: a.valueText ?? null,
          valueAfterText: null,
          deltaAbsolute: a.valueNumeric ? `-${a.valueNumeric}` : null,
          deltaPercent: null,
          estimatedMonthlyImpact: null,
          unit: a.unit ?? null,
        });
      } else if (a && b) {
        const numA = a.valueNumeric ? Number(a.valueNumeric) : null;
        const numB = b.valueNumeric ? Number(b.valueNumeric) : null;
        const textChanged = a.valueText !== b.valueText;
        const numChanged = numA !== null && numB !== null && numA !== numB;

        if (!numChanged && !textChanged) {
          totalUnchanged++;
          diffItems.push({
            diffId: diff.id,
            entityType: "PARAMETER",
            entityKey: key,
            entityName: a.parameterName,
            changeType: "UNCHANGED",
            changeNature: null,
            severity: "UNKNOWN",
            valueBefore: a.valueNumeric ?? null,
            valueAfter: b.valueNumeric ?? null,
            valueBeforeText: a.valueText ?? null,
            valueAfterText: b.valueText ?? null,
            deltaAbsolute: "0",
            deltaPercent: "0",
            estimatedMonthlyImpact: null,
            unit: a.unit ?? null,
          });
        } else {
          totalChanged++;
          const delta = numA !== null && numB !== null ? numB - numA : null;
          const deltaPercent =
            numA !== null && numB !== null && numA !== 0
              ? ((numB - numA) / Math.abs(numA)) * 100
              : null;
          const severity = deltaPercent
            ? Math.abs(deltaPercent) >= 10
              ? "HIGH"
              : Math.abs(deltaPercent) >= 5
              ? "MEDIUM"
              : "LOW"
            : "UNKNOWN";

          diffItems.push({
            diffId: diff.id,
            entityType: "PARAMETER",
            entityKey: key,
            entityName: a.parameterName,
            changeType: "CHANGED",
            changeNature: "PRICE_CHANGE",
            severity,
            valueBefore: a.valueNumeric ?? null,
            valueAfter: b.valueNumeric ?? null,
            valueBeforeText: a.valueText ?? null,
            valueAfterText: b.valueText ?? null,
            deltaAbsolute: delta?.toString() ?? null,
            deltaPercent: deltaPercent?.toFixed(4) ?? null,
            estimatedMonthlyImpact: null,
            unit: a.unit ?? null,
          });
        }
      }
    }

    if (diffItems.length > 0) {
      await db.insert(diffItemsTable).values(diffItems);
    }

    const [updatedDiff] = await db
      .update(snapshotDiffsTable)
      .set({
        status: "DONE",
        totalAdded,
        totalRemoved,
        totalChanged,
        totalUnchanged,
        estimatedMonthlyImpact:
          estimatedMonthlyImpact !== 0 ? estimatedMonthlyImpact.toString() : null,
      })
      .where(eq(snapshotDiffsTable.id, diff.id))
      .returning();

    res.status(201).json({
      ...updatedDiff,
      estimatedMonthlyImpact: updatedDiff.estimatedMonthlyImpact
        ? Number(updatedDiff.estimatedMonthlyImpact)
        : null,
      snapshotALabel: snapA.label,
      snapshotBLabel: snapB.label,
    });
  } catch (err) {
    req.log.error({ err }, "Error creating diff");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/diffs/:id", async (req, res): Promise<void> => {
  try {
    const params = GetDiffParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [diff] = await db
      .select()
      .from(snapshotDiffsTable)
      .where(eq(snapshotDiffsTable.id, params.data.id));

    if (!diff) {
      res.status(404).json({ error: "Diff não encontrado" });
      return;
    }

    const [snapA] = await db
      .select({ label: snapshotsTable.label })
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, diff.snapshotAId));
    const [snapB] = await db
      .select({ label: snapshotsTable.label })
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, diff.snapshotBId));

    res.json({
      ...diff,
      estimatedMonthlyImpact: diff.estimatedMonthlyImpact
        ? Number(diff.estimatedMonthlyImpact)
        : null,
      snapshotALabel: snapA?.label ?? null,
      snapshotBLabel: snapB?.label ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching diff");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/diffs/:id/items", async (req, res): Promise<void> => {
  try {
    const params = GetDiffItemsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const queryParsed = GetDiffItemsQueryParams.safeParse(req.query);
    const conditions = [eq(diffItemsTable.diffId, params.data.id)];

    if (queryParsed.success) {
      if (queryParsed.data.changeType) {
        conditions.push(eq(diffItemsTable.changeType, queryParsed.data.changeType));
      }
      if (queryParsed.data.changeNature) {
        conditions.push(eq(diffItemsTable.changeNature, queryParsed.data.changeNature));
      }
      if (queryParsed.data.severity) {
        conditions.push(eq(diffItemsTable.severity, queryParsed.data.severity));
      }
    }

    // Get snapshot labels from parent diff
    const [diff] = await db
      .select()
      .from(snapshotDiffsTable)
      .where(eq(snapshotDiffsTable.id, params.data.id));
    const [snapA] = diff
      ? await db
          .select({ label: snapshotsTable.label })
          .from(snapshotsTable)
          .where(eq(snapshotsTable.id, diff.snapshotAId))
      : [undefined];
    const [snapB] = diff
      ? await db
          .select({ label: snapshotsTable.label })
          .from(snapshotsTable)
          .where(eq(snapshotsTable.id, diff.snapshotBId))
      : [undefined];

    const items = await db
      .select()
      .from(diffItemsTable)
      .where(and(...conditions))
      .orderBy(desc(diffItemsTable.estimatedMonthlyImpact));

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
    req.log.error({ err }, "Error fetching diff items");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
