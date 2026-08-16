import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  confirmAttribute,
  getAttributeDetail,
  getCurationQueue,
  getCurationSummary,
  getTaxonomyTree,
  listTaxonomyNodes,
  renameAttribute,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";

/**
 * Curation API (F2).
 *
 * The only endpoint that can confirm semantics is POST /curation/attributes/
 * :code/confirm, and it requires an actor and a reason. Everything else reads.
 */
const router: IRouter = Router();

router.get("/curation/summary", async (req, res): Promise<void> => {
  try {
    res.json(await getCurationSummary(db));
  } catch (err) {
    req.log.error({ err }, "Error building curation summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/curation/queue", async (req, res): Promise<void> => {
  try {
    const includeConfirmed = req.query.includeConfirmed === "true";
    res.json(await getCurationQueue(db, { includeConfirmed }));
  } catch (err) {
    req.log.error({ err }, "Error building curation queue");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/curation/attributes/:code", async (req, res): Promise<void> => {
  try {
    const detail = await getAttributeDetail(db, req.params.code);
    if (!detail) {
      res.status(404).json({ error: "Atributo não encontrado" });
      return;
    }
    res.json(detail);
  } catch (err) {
    req.log.error({ err }, "Error loading attribute detail");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/curation/attributes/:code/confirm", async (req, res): Promise<void> => {
  try {
    const { unit, periodicity, aggregation, isMonetary, taxonomyCode, displayName, reason } =
      req.body ?? {};

    /**
     * O responsável é quem está logado, e não o que o corpo do pedido diz.
     *
     * Antes disto o `actor` era um campo de texto na tela: sustentava "alguém
     * digitou este nome", nunca "esta pessoa confirmou". Como toda rota exige
     * sessão, aqui ele sempre existe.
     */
    const actor = req.user!.email;

    if (!reason) {
      res.status(400).json({
        error: "Confirmar exige uma justificativa (reason).",
      });
      return;
    }

    await confirmAttribute(db, {
      code: req.params.code,
      unit,
      periodicity,
      aggregation,
      isMonetary,
      taxonomyCode,
      displayName,
      actor,
      reason,
    });
    res.json(await getAttributeDetail(db, req.params.code));
  } catch (err) {
    // These are business-rule refusals — a missing periodicity on a monetary
    // attribute, for instance — and the message is written to be read by the
    // curator, so it is surfaced rather than swallowed into a 500.
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Curation confirmation refused");
    res.status(422).json({ error: message });
  }
});

/**
 * Só o nome de leitura. Separado do confirm porque batizar um atributo não diz
 * nada sobre a semântica dele — e quem ainda não sabe se aquilo é mensal não
 * deveria precisar afirmar que sabe para poder dar um nome legível à coluna.
 */
router.post("/curation/attributes/:code/rename", async (req, res): Promise<void> => {
  try {
    const { displayName, reason } = req.body ?? {};

    if (!reason) {
      res.status(400).json({ error: "Renomear exige uma justificativa (reason)." });
      return;
    }

    await renameAttribute(db, {
      code: req.params.code,
      displayName: displayName ?? null,
      actor: req.user!.email,
      reason,
    });
    res.json(await getAttributeDetail(db, req.params.code));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Curation rename refused");
    res.status(422).json({ error: message });
  }
});

router.get("/curation/taxonomy", async (req, res): Promise<void> => {
  try {
    const flat = req.query.flat === "true";
    res.json(flat ? await listTaxonomyNodes(db) : await getTaxonomyTree(db));
  } catch (err) {
    req.log.error({ err }, "Error loading taxonomy");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/curation/proposal-pass", async (req, res): Promise<void> => {
  try {
    const actor = req.user?.email ?? "api:proposal-pass";
    await seedTaxonomy(db, actor);
    res.json(await runProposalPass(db, actor));
  } catch (err) {
    req.log.error({ err }, "Error running proposal pass");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
