import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { interpretarFormula } from "@workspace/assistant";
import {
  confirmAttribute,
  getAttributeDetail,
  getCurationQueue,
  getCurationSummary,
  getTaxonomyTree,
  listTaxonomyNodes,
  runProposalPass,
  saveMeaning,
  seedTaxonomy,
} from "@workspace/curation";

/**
 * Curation API (F2).
 *
 * The only endpoint that can confirm semantics is POST /curation/attributes/
 * :code/confirm, and it requires an actor and a reason.
 *
 * PATCH /curation/attributes/:code/meaning writes what a column is called and
 * what it means, and nothing else. It is
 * deliberately cheaper — no reason, no required fields, no status change — and
 * that asymmetry is the feature: describing a column and vouching for its
 * arithmetic are different acts, and welding them together is why the curation
 * queue filled up with attributes nobody had written a word about.
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
    const { unit, periodicity, aggregation, isMonetary, taxonomyCode, reason } =
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

router.patch("/curation/attributes/:code/meaning", async (req, res): Promise<void> => {
  try {
    const { definition, calculationBasis, displayName } = req.body ?? {};

    // Same rule as the confirmation: the signature comes from the session, not
    // from the body. A name typed into a form never proved anything.
    const result = await saveMeaning(db, {
      code: req.params.code,
      definition,
      calculationBasis,
      displayName,
      actor: req.user!.email,
    });
    res.json(result);
  } catch (err) {
    // Refusals here are business rules with messages written for the curator
    // ("nothing to write", "no versioned semantics yet"), so they are surfaced
    // rather than swallowed into a 500 — same treatment as /confirm.
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Meaning update refused");
    res.status(422).json({ error: message });
  }
});

/**
 * Ler a fórmula de cálculo em voz alta. Não grava nada.
 *
 * POST, e não GET, porque a fórmula vai no corpo: a tela pede a leitura do que
 * está digitado **agora**, antes de salvar. Exigir o salvamento primeiro faria
 * a leitura depender de um ato que ela não deveria custar — e, num atributo sem
 * semântica versionada, a base de cálculo nem chega a poder ser gravada.
 *
 * O corpo é opcional: sem ele, lê-se o que está guardado. É o caminho de quem
 * abre um atributo que outra pessoa preencheu.
 */
router.post(
  "/curation/attributes/:code/formula/leitura",
  async (req, res): Promise<void> => {
    try {
      const detail = await getAttributeDetail(db, req.params.code);
      if (!detail) {
        res.status(404).json({ error: "Atributo não encontrado" });
        return;
      }

      const formula =
        typeof req.body?.calculationBasis === "string"
          ? req.body.calculationBasis
          : (detail.calculationBasis ?? "");

      res.json(
        await interpretarFormula({
          formula,
          // O nome de leitura, pelas mesmas regras das telas: apelido quando
          // existe, literal da planilha quando não.
          nome: detail.displayName ?? detail.sourceName,
          definicao: detail.definition,
          unidade: detail.unit,
          periodicidade: detail.periodicity,
        }),
      );
    } catch (err) {
      // `interpretarFormula` não lança — o que cair aqui é falha de banco, e
      // essa é 500 mesmo, não uma regra de negócio para o curador ler.
      req.log.error({ err }, "Error interpreting calculation formula");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

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
