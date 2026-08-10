import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { Router, type IRouter } from "express";
import { db } from "@workspace/db";
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
 * Upload and preview, in one call — but never promote.
 *
 * The file is read, captured into RAW, staged and previewed; nothing reaches
 * the canonical layer until someone looks at the preview and says so. That gate
 * exists in the pipeline and the screen honours it rather than working around
 * it.
 *
 * The body is the raw bytes (application/octet-stream) with the name in a
 * header, which avoids a multipart dependency for a form with one field.
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
        res.status(400).json({ error: "Arquivo vazio." });
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
            `Este arquivo já foi importado — o conteúdo tem o mesmo SHA-256 de um envio anterior. ` +
            `Reenviar o mesmo conteúdo não gera vigência nova.`,
          duplicate: true,
        });
        return;
      }

      await captureRaw(db, received.importRunId);
      const staged = await stage(db, received.importRunId);
      const report = await preview(db, received.importRunId);

      res.json({ importRunId: received.importRunId, filename, staged, report });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      req.log.error({ err }, "Error importing upload");
      res.status(422).json({ error: message });
    }
  },
);

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

export default router;
