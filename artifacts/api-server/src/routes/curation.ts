import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { db, erroDoPostgres } from "@workspace/db";
import { faltaSchema, responderSchemaAusente } from "../lib/schema-ausente";
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

/**
 * As migrations que criam o que esta tela lê.
 *
 * São três, e é isso que torna a Curadoria diferente do Book (uma migration) e
 * de Chamados (três seguidas): as colunas desta tela foram acrescentadas ao
 * longo de todo o produto, e a última — `attribute.definition`, da
 * `0022_significado` — é lida **só** pela fila e pelo detalhe. Nem o resumo,
 * nem a taxonomia, nem nenhuma outra tela a tocam.
 *
 * Essa assimetria é o que faz esta rota merecer um diagnóstico próprio: num
 * banco onde a 0022 consta como aplicada e não deixou a coluna, os cartões de
 * cima somam certo, a taxonomia carrega, e só a fila responde erro. Quem olha
 * a tela vê um produto quase inteiro funcionando e um pedaço quebrado — que é
 * a forma mais cara de esconder uma divergência de schema.
 */
const SCHEMA_DA_CURADORIA =
  "0002_curation_layer, 0005_versioned_semantics e 0022_significado";

/**
 * O erro é "falta schema", e não defeito do pedido?
 *
 * A lista de SQLSTATEs mora em `lib/schema-ausente.ts`, junto da resposta que
 * ela decide. Este nome fica porque é o vocabulário desta rota, e porque é por
 * ele que os testes perguntam — mesma convenção de `faltaOSchemaDoBook` e
 * `faltaOSchemaDeChamados`.
 */
export function faltaOSchemaDaCuradoria(err: unknown): boolean {
  return faltaSchema(err);
}

/**
 * A falha, separando banco divergente de defeito de código.
 *
 * `{"error": "Internal server error"}` era o que estas sete rotas respondiam a
 * qualquer coisa que desse errado: a mesma frase para uma coluna que falta,
 * para o banco fora do ar e para um defeito nosso. Nada nela liga o que se lê
 * na tela à linha no log, e foi exatamente essa constante que o
 * `middlewares/contrato-json.ts` passou a substituir no resto da API — só que
 * o `try/catch` daqui respondia antes, e o contrato nunca via o erro.
 *
 * Agora há dois desfechos, e cada um manda olhar para um lugar diferente:
 *
 * 1. **Falta schema** → 503 com o diagnóstico de `diagnosticar`, a mesma
 *    autoridade que responde ao `/healthz`. É o caso que o `/healthz` sozinho
 *    não enxerga: pela contagem de migrations está tudo em dia, e mesmo assim
 *    um objeto que elas criam não está lá (`SCHEMA_DIVERGENTE`).
 * 2. **Qualquer outra coisa** → segue para o contrato JSON, que responde 500
 *    com `code`, `requestId` e — fora de produção — o detalhe da exceção.
 *
 * O log sai uma vez só: aqui quando a resposta é 503, porque
 * `responderSchemaAusente` não loga; no contrato quando é 500, porque lá o
 * `requestId` já acompanha a linha.
 */
async function responderFalha(
  req: Request,
  res: Response,
  next: NextFunction,
  err: unknown,
  contexto: string,
): Promise<void> {
  if (!faltaOSchemaDaCuradoria(err)) {
    next(err);
    return;
  }

  req.log?.error({ err }, contexto);
  /*
    O SQLSTATE atravessa e a mensagem do driver não — mesma regra do
    `/healthz`. O código separa "falta a tabela" (42P01) de "falta a coluna"
    (42703), que é a diferença entre uma migration que nunca rodou e uma que
    consta como aplicada e não deixou tudo o que promete; a mensagem carrega
    host, usuário e o trecho que falhou, e vai só para o log.
  */
  const codigo = erroDoPostgres(err)?.code;
  await responderSchemaAusente(
    res,
    `${contexto} O que esta tela lê vem de ${SCHEMA_DA_CURADORIA}` +
      `${codigo ? `, e o banco recusou com SQLSTATE ${codigo}` : ""}. ` +
      "Nada foi gravado por esta chamada, e nenhuma semântica já confirmada " +
      "foi tocada.",
  );
}

router.get("/curation/summary", async (req, res, next): Promise<void> => {
  try {
    res.json(await getCurationSummary(db));
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "O resumo da curadoria não pôde ser contado neste banco.",
    );
  }
});

router.get("/curation/queue", async (req, res, next): Promise<void> => {
  try {
    const includeConfirmed = req.query.includeConfirmed === "true";
    res.json(await getCurationQueue(db, { includeConfirmed }));
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "A fila de curadoria não pôde ser lida neste banco.",
    );
  }
});

router.get("/curation/attributes/:code", async (req, res, next): Promise<void> => {
  try {
    const detail = await getAttributeDetail(db, req.params.code);
    if (!detail) {
      res.status(404).json({ error: "Atributo não encontrado" });
      return;
    }
    res.json(detail);
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "Os valores reais deste atributo não puderam ser lidos neste banco.",
    );
  }
});

router.post("/curation/attributes/:code/confirm", async (req, res, next): Promise<void> => {
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
    /*
      Falta schema não é recusa de regra de negócio, e precisa sair antes.

      O 422 abaixo devolve a mensagem da exceção como se fosse uma frase
      escrita para o curador — o que, num banco divergente, faz a tela dizer
      `column attribute.definition does not exist` no lugar onde ela explica
      que falta periodicidade. O curador lê aquilo como erro do que ele
      preencheu, e não há nada que ele possa preencher que resolva.
    */
    if (faltaOSchemaDaCuradoria(err)) {
      await responderFalha(
        req,
        res,
        next,
        err,
        "A confirmação não pôde ser gravada neste banco.",
      );
      return;
    }
    // These are business-rule refusals — a missing periodicity on a monetary
    // attribute, for instance — and the message is written to be read by the
    // curator, so it is surfaced rather than swallowed into a 500.
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Curation confirmation refused");
    res.status(422).json({ error: message });
  }
});

router.patch("/curation/attributes/:code/meaning", async (req, res, next): Promise<void> => {
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
    /*
      Mesmo motivo do `/confirm`, e aqui o caso é ainda mais direto: a coluna
      que esta rota escreve é justamente a que a `0022_significado` cria. Num
      banco onde essa migration consta aplicada e não deixou a coluna, é esta
      rota que morre ao gravar — e sem esta guarda ela responde 422 com o texto
      do Postgres, mandando o curador reescrever um significado que estava
      certo.
    */
    if (faltaOSchemaDaCuradoria(err)) {
      await responderFalha(
        req,
        res,
        next,
        err,
        "O significado não pôde ser gravado neste banco.",
      );
      return;
    }
    // Refusals here are business rules with messages written for the curator
    // ("nothing to write", "no versioned semantics yet"), so they are surfaced
    // rather than swallowed into a 500 — same treatment as /confirm.
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Meaning update refused");
    res.status(422).json({ error: message });
  }
});

router.get("/curation/taxonomy", async (req, res, next): Promise<void> => {
  try {
    const flat = req.query.flat === "true";
    res.json(flat ? await listTaxonomyNodes(db) : await getTaxonomyTree(db));
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "A taxonomia não pôde ser lida neste banco.",
    );
  }
});

router.post("/curation/proposal-pass", async (req, res, next): Promise<void> => {
  try {
    const actor = req.user?.email ?? "api:proposal-pass";
    await seedTaxonomy(db, actor);
    res.json(await runProposalPass(db, actor));
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "A passada de proposta não pôde rodar neste banco.",
    );
  }
});

export default router;
