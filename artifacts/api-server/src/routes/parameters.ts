import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { parametersTable, snapshotsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateParameterBody,
  ListParametersQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/parameters", async (req, res): Promise<void> => {
  try {
    const query = ListParametersQueryParams.safeParse(req.query);
    const conditions = [];

    if (query.success) {
      if (query.data.snapshotId) {
        conditions.push(eq(parametersTable.snapshotId, query.data.snapshotId));
      }
      if (query.data.category) {
        conditions.push(eq(parametersTable.category, query.data.category));
      }
      if (query.data.parameterKey) {
        conditions.push(eq(parametersTable.parameterKey, query.data.parameterKey));
      }
    }

    const params = await db
      .select()
      .from(parametersTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(parametersTable.category, parametersTable.parameterName);

    const result = params.map((p) => ({
      ...p,
      valueNumeric: p.valueNumeric ? Number(p.valueNumeric) : null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error listing parameters");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/parameters", async (req, res): Promise<void> => {
  try {
    const parsed = CreateParameterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [param] = await db
      .insert(parametersTable)
      .values({
        snapshotId: parsed.data.snapshotId,
        parameterKey: parsed.data.parameterKey,
        parameterName: parsed.data.parameterName,
        category: parsed.data.category,
        dataType: parsed.data.dataType,
        unit: parsed.data.unit ?? null,
        valueNumeric: parsed.data.valueNumeric?.toString() ?? null,
        valueText: parsed.data.valueText ?? null,
        effectiveFrom: String(parsed.data.effectiveFrom),
        effectiveUntil: parsed.data.effectiveUntil ? String(parsed.data.effectiveUntil) : null,
        source: parsed.data.source ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning();

    // Update parameterCount on snapshot
    await db
      .select()
      .from(parametersTable)
      .where(eq(parametersTable.snapshotId, parsed.data.snapshotId))
      .then(async (all) => {
        await db
          .update(snapshotsTable)
          .set({ parameterCount: all.length })
          .where(eq(snapshotsTable.id, parsed.data.snapshotId));
      });

    res.status(201).json({
      ...param,
      valueNumeric: param.valueNumeric ? Number(param.valueNumeric) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Error creating parameter");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
