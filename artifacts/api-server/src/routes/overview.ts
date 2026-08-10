import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { getImportRunSheets, getImportRunSnapshots, listImportRuns } from "@workspace/ingest";
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

export default router;
