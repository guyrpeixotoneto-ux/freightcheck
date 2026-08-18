import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { classificarFalha } from "../lib/classificar-falha";
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
  res.json(await listVersionedAttributes(db));
});

router.get("/curation/versions/:code", async (req, res): Promise<void> => {
  const history = await getSemanticsHistory(db, req.params.code);
  if (history.length === 0) {
    res.status(404).json({ error: "Atributo sem semântica registrada." });
    return;
  }
  res.json(history);
});

/** A Freightec mudou a regra a partir de uma vigência. Vira alteração. */
router.post("/curation/versions/:code/source-change", async (req, res, next): Promise<void> => {
  try {
    const version = await recordSourceSemanticsChange(db, {
      code: req.params.code,
      ...req.body,
      // Depois do corpo, de propósito: quem assina é a sessão, não o payload.
      actor: req.user!.email,
    });
    res.json(version);
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Source semantics change refused");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/** Nós entendemos errado. Corrige o trecho inteiro e não vira alteração. */
router.post("/curation/versions/:code/correction", async (req, res, next): Promise<void> => {
  try {
    const version = await correctSemantics(db, {
      code: req.params.code,
      ...req.body,
      actor: req.user!.email,
    });
    res.json(version);
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Semantics correction refused");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

router.post("/curation/versions/backfill", async (req, res): Promise<void> => {
  res.json(await backfillSemantics(db));
});

export default router;
