import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { alertsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { UpdateAlertBody, UpdateAlertParams, ListAlertsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/alerts", async (req, res): Promise<void> => {
  try {
    const query = ListAlertsQueryParams.safeParse(req.query);
    const conditions = [eq(alertsTable.isDismissed, false)];

    if (query.success) {
      if (query.data.isRead !== undefined) {
        conditions.push(eq(alertsTable.isRead, query.data.isRead));
      }
      if (query.data.severity) {
        conditions.push(eq(alertsTable.severity, query.data.severity));
      }
    }

    const alerts = await db
      .select()
      .from(alertsTable)
      .where(and(...conditions))
      .orderBy(desc(alertsTable.createdAt));

    const result = alerts.map((a) => ({
      ...a,
      estimatedImpact: a.estimatedImpact ? Number(a.estimatedImpact) : null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Error listing alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/alerts/:id", async (req, res): Promise<void> => {
  try {
    const params = UpdateAlertParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpdateAlertBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.isRead !== undefined) updateData.isRead = parsed.data.isRead;
    if (parsed.data.isDismissed !== undefined) updateData.isDismissed = parsed.data.isDismissed;

    const [alert] = await db
      .update(alertsTable)
      .set(updateData)
      .where(eq(alertsTable.id, params.data.id))
      .returning();

    if (!alert) {
      res.status(404).json({ error: "Alerta não encontrado" });
      return;
    }

    res.json({
      ...alert,
      estimatedImpact: alert.estimatedImpact ? Number(alert.estimatedImpact) : null,
    });
  } catch (err) {
    req.log.error({ err }, "Error updating alert");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
