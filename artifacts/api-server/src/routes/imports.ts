import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { importJobsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { CreateImportBody, GetImportParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/imports", async (_req, res): Promise<void> => {
  try {
    const imports = await db
      .select()
      .from(importJobsTable)
      .orderBy(desc(importJobsTable.importedAt));
    res.json(imports);
  } catch (err) {
    _req.log.error({ err }, "Error listing imports");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/imports", async (req, res): Promise<void> => {
  try {
    const parsed = CreateImportBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [importJob] = await db
      .insert(importJobsTable)
      .values({
        sourceType: parsed.data.sourceType,
        filename: parsed.data.filename ?? null,
        notes: parsed.data.notes ?? null,
        status: "PENDING",
      })
      .returning();

    res.status(201).json(importJob);
  } catch (err) {
    req.log.error({ err }, "Error creating import");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/imports/:id", async (req, res): Promise<void> => {
  try {
    const params = GetImportParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [importJob] = await db
      .select()
      .from(importJobsTable)
      .where(eq(importJobsTable.id, params.data.id));

    if (!importJob) {
      res.status(404).json({ error: "Importação não encontrada" });
      return;
    }

    res.json(importJob);
  } catch (err) {
    req.log.error({ err }, "Error fetching import");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
