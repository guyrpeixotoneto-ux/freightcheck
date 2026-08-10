import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  backfillSemantics,
  correctSemantics,
  getSemanticsHistory,
  listVersionedAttributes,
  recordSourceSemanticsChange,
} from "@workspace/curation";

/**
 * Curadoria de Versões.
 *
 * Two endpoints, never one with a mode flag: recording a change the Freightec
 * made and correcting a misreading of our own have opposite consequences, and
 * a shared entry point is where that distinction goes to die.
 */
const router: IRouter = Router();

router.get("/curation/versions", async (req, res): Promise<void> => {
  try {
    res.json(await listVersionedAttributes(db));
  } catch (err) {
    req.log.error({ err }, "Error listing versioned attributes");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/curation/versions/:code", async (req, res): Promise<void> => {
  try {
    const history = await getSemanticsHistory(db, req.params.code);
    if (history.length === 0) {
      res.status(404).json({ error: "Atributo sem semântica registrada." });
      return;
    }
    res.json(history);
  } catch (err) {
    req.log.error({ err }, "Error loading semantics history");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** A Freightec mudou a regra a partir de uma vigência. Vira alteração. */
router.post("/curation/versions/:code/source-change", async (req, res): Promise<void> => {
  try {
    const version = await recordSourceSemanticsChange(db, {
      code: req.params.code,
      ...req.body,
    });
    res.json(version);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Source semantics change refused");
    res.status(422).json({ error: message });
  }
});

/** Nós entendemos errado. Corrige o trecho inteiro e não vira alteração. */
router.post("/curation/versions/:code/correction", async (req, res): Promise<void> => {
  try {
    const version = await correctSemantics(db, {
      code: req.params.code,
      ...req.body,
    });
    res.json(version);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Semantics correction refused");
    res.status(422).json({ error: message });
  }
});

router.post("/curation/versions/backfill", async (req, res): Promise<void> => {
  try {
    res.json(await backfillSemantics(db));
  } catch (err) {
    req.log.error({ err }, "Error backfilling semantics");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
