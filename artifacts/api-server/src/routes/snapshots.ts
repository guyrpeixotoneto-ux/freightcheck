import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { snapshotsTable, parametersTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import {
  CreateSnapshotBody,
  UpdateSnapshotBody,
  GetSnapshotParams,
  UpdateSnapshotParams,
  GetSnapshotParametersParams,
  GetSnapshotParametersQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/snapshots", async (_req, res): Promise<void> => {
  try {
    const snapshots = await db
      .select()
      .from(snapshotsTable)
      .orderBy(desc(snapshotsTable.createdAt));
    res.json(snapshots);
  } catch (err) {
    _req.log.error({ err }, "Error listing snapshots");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/snapshots", async (req, res): Promise<void> => {
  try {
    const parsed = CreateSnapshotBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [snapshot] = await db
      .insert(snapshotsTable)
      .values({
        label: parsed.data.label,
        snapshotDate: String(parsed.data.snapshotDate),
        notes: parsed.data.notes ?? null,
      })
      .returning();
    res.status(201).json(snapshot);
  } catch (err) {
    req.log.error({ err }, "Error creating snapshot");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/snapshots/current", async (_req, res): Promise<void> => {
  try {
    const [snapshot] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.isCurrent, true))
      .limit(1);
    if (!snapshot) {
      res.status(404).json({ error: "Nenhum snapshot atual configurado" });
      return;
    }
    res.json(snapshot);
  } catch (err) {
    _req.log.error({ err }, "Error fetching current snapshot");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/snapshots/:id", async (req, res): Promise<void> => {
  try {
    const params = GetSnapshotParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [snapshot] = await db
      .select()
      .from(snapshotsTable)
      .where(eq(snapshotsTable.id, params.data.id));
    if (!snapshot) {
      res.status(404).json({ error: "Snapshot não encontrado" });
      return;
    }
    res.json(snapshot);
  } catch (err) {
    req.log.error({ err }, "Error fetching snapshot");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/snapshots/:id", async (req, res): Promise<void> => {
  try {
    const params = UpdateSnapshotParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateSnapshotBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // If setting isCurrent=true, clear all others first
    if (parsed.data.isCurrent === true) {
      await db
        .update(snapshotsTable)
        .set({ isCurrent: false })
        .where(eq(snapshotsTable.isCurrent, true));
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.label !== undefined) updateData.label = parsed.data.label;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.isCurrent !== undefined) updateData.isCurrent = parsed.data.isCurrent;
    if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

    const [snapshot] = await db
      .update(snapshotsTable)
      .set(updateData)
      .where(eq(snapshotsTable.id, params.data.id))
      .returning();

    if (!snapshot) {
      res.status(404).json({ error: "Snapshot não encontrado" });
      return;
    }
    res.json(snapshot);
  } catch (err) {
    req.log.error({ err }, "Error updating snapshot");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/snapshots/:id/parameters", async (req, res): Promise<void> => {
  try {
    const params = GetSnapshotParametersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const query = GetSnapshotParametersQueryParams.safeParse(req.query);

    const conditions = [eq(parametersTable.snapshotId, params.data.id)];
    if (query.success && query.data.category) {
      conditions.push(eq(parametersTable.category, query.data.category));
    }

    const parameters = await db
      .select()
      .from(parametersTable)
      .where(and(...conditions))
      .orderBy(parametersTable.category, parametersTable.parameterName);

    const result = parameters.map((p) => ({
      ...p,
      valueNumeric: p.valueNumeric ? Number(p.valueNumeric) : null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error fetching snapshot parameters");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
