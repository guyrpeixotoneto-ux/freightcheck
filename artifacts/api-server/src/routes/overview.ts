import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { importRunTable, stagedFactTable } from "@workspace/db";
import {
  captureRaw,
  getImportRunSheets,
  getImportRunSnapshots,
  listImportRuns,
  preview,
  promote,
  receiveFile,
  stage,
} from "@workspace/ingest";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { getOverview } from "@workspace/comparison";

/**
 * Read-only views over what the system already holds: the panel, the import
 * history, and the sheets behind a given run.
 *
 * Nothing here forecasts or annualises. These pages exist so the locked menu
 * items could be opened honestly rather than merely unlocked.
 */
const router: IRouter = Router();

router.get("/overview", async (req, res): Promise<void> => {
  try {
    res.json(await getOverview(db));
  } catch (err) {
    req.log.error({ err }, "Error building overview");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/imports", async (req, res): Promise<void> => {
  try {
    res.json(await listImportRuns(db));
  } catch (err) {
    req.log.error({ err }, "Error listing imports");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/imports/:id", async (req, res): Promise<void> => {
  try {
    const [sheets, snapshots] = await Promise.all([
      getImportRunSheets(db, req.params.id),
      getImportRunSnapshots(db, req.params.id),
    ]);
    res.json({ sheets, snapshots });
  } catch (err) {
    req.log.error({ err }, "Error loading import run");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Upload, then process in the background.
 *
 * Capturing 43k cells, staging and previewing takes about seven seconds for
 * one of these workbooks. Holding an HTTP connection open that long is asking
 * a proxy to cut it: the first version did exactly that and the browser got an
 * empty body, which surfaced as "Unexpected end of JSON input" — a message
 * that says nothing about what actually happened.
 *
 * So the request returns as soon as the bytes are safely in RAW, and the rest
 * runs detached. The client polls the run's status, which the pipeline already
 * maintained. Nothing reaches the canonical layer either way: promotion stays
 * a separate, deliberate call.
 */
router.post(
  "/imports",
  express.raw({ type: "application/octet-stream", limit: "80mb" }),
  async (req, res): Promise<void> => {
    try {
      const raw = req.get("x-filename");
      const filename = raw ? decodeURIComponent(raw) : "upload.xlsx";
      if (!filename.toLowerCase().endsWith(".xlsx")) {
        res.status(415).json({
          error: `"${filename}" não é .xlsx. O Freightec entrega planilhas Excel.`,
        });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "Arquivo vazio ou não recebido." });
        return;
      }

      const scratch = mkdtempSync(path.join(tmpdir(), "freightcheck-"));
      const filePath = path.join(scratch, `${randomUUID()}.xlsx`);
      writeFileSync(filePath, req.body);

      const received = await receiveFile(db, {
        filePath,
        filename,
        receivedBy: "upload",
      });

      if (received.isDuplicate) {
        res.status(409).json({
          error:
            `Este arquivo já foi importado — o conteúdo tem o mesmo SHA-256 de um envio ` +
            `anterior. Reenviar o mesmo conteúdo não gera vigência nova.`,
          duplicate: true,
        });
        return;
      }

      // Answer now; keep working after.
      res.json({ importRunId: received.importRunId, filename, status: "RECEIVED" });

      void (async () => {
        try {
          await captureRaw(db, received.importRunId);
          await stage(db, received.importRunId);
          await preview(db, received.importRunId);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Erro desconhecido";
          req.log.error({ err }, "Background import failed");
          await db
            .update(importRunTable)
            .set({ status: "FAILED", failureReason: message })
            .where(eq(importRunTable.id, received.importRunId));
        }
      })();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      req.log.error({ err }, "Error receiving upload");
      if (!res.headersSent) res.status(422).json({ error: message });
    }
  },
);

/** Where a run is, and its preview once there is one. */
router.get("/imports/:id/status", async (req, res): Promise<void> => {
  try {
    const [run] = await db
      .select()
      .from(importRunTable)
      .where(eq(importRunTable.id, req.params.id));
    if (!run) {
      res.status(404).json({ error: "Importação não encontrada." });
      return;
    }

    const snapshots =
      run.status === "PREVIEWED" || run.status === "PROMOTED"
        ? await getImportRunSnapshotLabels(db, run.id)
        : [];

    res.json({
      importRunId: run.id,
      status: run.status,
      failureReason: run.failureReason,
      sheets: run.rawSheetCount,
      rawCells: run.rawCellCount,
      facts: run.stagedFactCount,
      snapshots: run.snapshotCount,
      errors: run.errorCount,
      warnings: run.warningCount,
      labels: snapshots,
    });
  } catch (err) {
    req.log.error({ err }, "Error reading import status");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Promote a previewed run, then bring curation up to date with it.
 *
 * A new file can carry columns nobody has classified yet, so the taxonomy and
 * the proposal pass run right after — otherwise the first thing the user would
 * see is a screen full of unclassified attributes.
 */
router.post("/imports/:id/promote", async (req, res): Promise<void> => {
  try {
    const result = await promote(db, req.params.id, {
      onExistingSnapshot: req.body?.onExistingSnapshot ?? "REJECT",
    });

    await seedTaxonomy(db, "upload");
    const proposal = await runProposalPass(db, "engine:proposal-pass");
    const confirmations = await applyConfirmations(db);
    const versions = await backfillSemantics(db);

    res.json({ ...result, proposal, confirmations, versions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Promotion refused");
    res.status(422).json({ error: message });
  }
});

/** Vigência labels a run has staged, for the preview card. */
async function getImportRunSnapshotLabels(
  database: typeof db,
  importRunId: string,
): Promise<string[]> {
  const rows = await database
    .selectDistinct({ label: stagedFactTable.snapshotLabel })
    .from(stagedFactTable)
    .where(eq(stagedFactTable.importRunId, importRunId))
    .orderBy(stagedFactTable.snapshotLabel);
  return rows.map((r) => r.label);
}

export default router;
