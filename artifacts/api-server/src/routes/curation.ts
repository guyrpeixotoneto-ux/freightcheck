import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { db, erroDoPostgres } from "@workspace/db";
import {
  interpretarFormula,
  rascunharDefinicao,
  sugerirSemantica,
} from "@workspace/assistant";
import { faltaSchema, responderSchemaAusente } from "../lib/schema-ausente";
import {
  aplicarPreenchimento,
  definirClasseDeCusto,
  moverCategoriaParaFamilia,
  confirmAttribute,
  conferirPreenchimento,
  criarCategoria,
  criarSignificado,
  getAttributeDetail,
  getCurationQueue,
  getCurationSummary,
  getTaxonomyTree,
  listarCategorias,
  listarSignificados,
  listTaxonomyNodes,
  montarLinhas,
  runProposalPass,
  saveMeaning,
  seedSignificados,
  seedTaxonomy,
  type AtributoDoModelo,
  type ConferenciaDoModelo,
} from "@workspace/curation";
import { contentDisposition } from "./book";
import { agoraEmBrasilia } from "../lib/planilha-impacto";
import {
  lerModeloDeAtributos,
  montarModeloDeAtributos,
} from "../lib/planilha-de-atributos";
import { decodeUpload } from "./imports";

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
  "0002_curation_layer, 0005_versioned_semantics, 0022_significado e " +
  "0028_significado_economico";

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

/**
 * A planilha de atributos — as três rotas do round-trip.
 *
 * `modelo.xlsx` sai preenchida com o que a base já sabe, `previa` diz o que
 * mudaria e `aplicar` grava. A prévia é obrigatória por costume da tela, não
 * por regra do servidor: `aplicar` **relê e reconfere o arquivo**, e não aceita
 * um diff calculado pelo cliente. Um cliente que mandasse a lista de mudanças
 * pronta poderia gravar o que quisesse em qualquer atributo sem passar pela
 * conferência — e a conferência é onde mora a recusa a criar coluna.
 */
async function atributosDoModelo(): Promise<AtributoDoModelo[]> {
  const fila = await getCurationQueue(db, { includeConfirmed: true });
  return fila.map((item) => ({
    code: item.code,
    sourceName: item.sourceName,
    entityType: item.entityType,
    semanticsStatus: item.semanticsStatus,
    displayName: item.displayName,
    definition: item.definition,
    taxonomyCode: item.taxonomyCode,
  }));
}

/** O catálogo como as duas colunas de Categoria DRE o leem. */
async function catalogosDoModelo() {
  const categorias = await listarCategorias(db);
  return {
    categorias: categorias.map((c) => ({
      code: c.code,
      caminho: c.caminho,
      sintetico: c.sintetico,
      analitico: c.analitico,
    })),
  };
}

/** Ler o upload e conferi-lo contra a base. Não grava nada. */
async function conferirUpload(
  body: unknown,
): Promise<
  { ok: true; conferencia: ConferenciaDoModelo } | { ok: false; erro: string }
> {
  const upload = decodeUpload(body);
  if (!upload.ok) return { ok: false, erro: upload.error };

  const leitura = lerModeloDeAtributos(upload.value.bytes);
  if (!leitura.ok) return { ok: false, erro: leitura.erro };

  const [atributos, catalogos] = await Promise.all([
    atributosDoModelo(),
    catalogosDoModelo(),
  ]);

  return {
    ok: true,
    conferencia: conferirPreenchimento(leitura.linhas, atributos, catalogos),
  };
}

router.get("/curation/atributos/modelo.xlsx", async (req, res, next): Promise<void> => {
  try {
    const [atributos, catalogos] = await Promise.all([
      atributosDoModelo(),
      catalogosDoModelo(),
    ]);

    if (atributos.length === 0) {
      res.status(404).json({
        error:
          "Nenhum atributo importado ainda — não há o que descrever. Importe a planilha do Freightec primeiro.",
      });
      return;
    }

    const bytes = await montarModeloDeAtributos({
      linhas: montarLinhas(atributos, catalogos),
      ...catalogos,
      geradoPor: req.user!.email,
      geradoEm: agoraEmBrasilia(new Date()),
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Content-Disposition", contentDisposition("curadoria-atributos.xlsx"));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(bytes);
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "O modelo de atributos não pôde ser montado neste banco.",
    );
  }
});

router.post("/curation/atributos/modelo/previa", async (req, res, next): Promise<void> => {
  try {
    const conferido = await conferirUpload(req.body);
    if (!conferido.ok) {
      res.status(400).json({ error: conferido.erro });
      return;
    }
    res.json(conferido.conferencia);
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "A planilha de atributos não pôde ser conferida neste banco.",
    );
  }
});

router.post("/curation/atributos/modelo/aplicar", async (req, res, next): Promise<void> => {
  try {
    const conferido = await conferirUpload(req.body);
    if (!conferido.ok) {
      res.status(400).json({ error: conferido.erro });
      return;
    }

    // Quem assina é a sessão, como em toda escrita de curadoria. Aqui isso
    // importa mais do que de costume: o arquivo passou por gente que não tem
    // login, e o histórico tem de registrar quem o trouxe para dentro.
    const resultado = await aplicarPreenchimento(db, {
      linhas: conferido.conferencia.linhas,
      actor: req.user!.email,
    });
    res.json({ ...resultado, conferencia: conferido.conferencia.resumo });
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "A planilha de atributos não pôde ser aplicada neste banco.",
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
    const {
      meaningCode,
      unit,
      periodicity,
      aggregation,
      isMonetary,
      taxonomyCode,
      reason,
    } = req.body ?? {};

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

    /*
      `meaningCode` é o caminho da tela, e quando ele vem os campos técnicos do
      corpo não são repassados. Não é economia de digitação: `confirmAttribute`
      já ignora os três quando há significado, e mandá-los mesmo assim deixaria
      no código a aparência de que o cliente tem voto sobre eles. A rota diz o
      que a autoridade decide.

      `periodicity` continua indo junto, e só ela: é a resposta à pergunta que a
      tela faz quando o significado deixa o período em aberto.
    */
    await confirmAttribute(db, {
      code: req.params.code,
      ...(meaningCode
        ? { meaningCode, periodicity }
        : { unit, periodicity, aggregation, isMonetary }),
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
  async (req, res, next): Promise<void> => {
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
      /*
        `interpretarFormula` não lança — o que cair aqui é falha de banco, e
        não uma regra de negócio para o curador ler. Segue pelo mesmo caminho
        das outras: esta rota lê o atributo pelo `getAttributeDetail`, que
        passa pela fila e portanto pela `attribute.definition` — é uma das que
        morrem primeiro num banco divergente.
      */
      await responderFalha(
        req,
        res,
        next,
        err,
        "A fórmula deste atributo não pôde ser lida neste banco.",
      );
    }
  },
);

/**
 * Escrever o rascunho de "O que é" a partir do nome gerencial. Não grava nada.
 *
 * POST pelo mesmo motivo da leitura da fórmula: o nome vai no corpo, porque a
 * tela pede o rascunho do que está digitado **agora**. Quem acabou de batizar a
 * coluna ainda não salvou — e é justamente nesse instante que o rascunho vale,
 * enquanto a pessoa tem o significado na cabeça e só falta escrevê-lo.
 *
 * O corpo é opcional: sem ele, rascunha-se a partir do nome guardado. É o
 * caminho de quem abre um atributo que outra pessoa batizou.
 */
router.post(
  "/curation/attributes/:code/definicao/rascunho",
  async (req, res, next): Promise<void> => {
    try {
      const detail = await getAttributeDetail(db, req.params.code);
      if (!detail) {
        res.status(404).json({ error: "Atributo não encontrado" });
        return;
      }

      const nome =
        typeof req.body?.displayName === "string"
          ? req.body.displayName
          : (detail.displayName ?? "");
      const formula =
        typeof req.body?.calculationBasis === "string"
          ? req.body.calculationBasis
          : (detail.calculationBasis ?? "");

      res.json(
        await rascunharDefinicao({
          nome,
          nomeDeOrigem: detail.sourceName,
          formula,
          unidade: detail.unit,
          periodicidade: detail.periodicity,
          entidade: detail.entityType,
          tipoDeDado: detail.dataType,
          taxonomia: detail.taxonomyName,
          // O cabeçalho da planilha é outra pista do que a coluna é, e ele
          // costuma diferir do código: `Vida_Comb` na primeira linha, `
          // vidaCombustivel` no código gerado pela importação.
          cabecalho: detail.samples.find((s) => s.columnHeader)?.columnHeader ?? null,
          /*
            Só o formato dos valores, e só dos que existem. Amostra nula não
            diz nada sobre a natureza da coluna e ocuparia uma das seis vagas
            com a palavra "ausente".
          */
          exemplos: detail.samples
            .filter((s) => !s.isNull && s.value !== null)
            .map((s) => String(s.value)),
        }),
      );
    } catch (err) {
      /*
        `rascunharDefinicao` não lança — o que cair aqui é falha de banco, e não
        uma regra de negócio para o curador ler. Mesmo caminho da leitura da
        fórmula: esta rota lê o atributo pelo `getAttributeDetail`, que passa
        pela fila e portanto pela `attribute.definition`.
      */
      await responderFalha(
        req,
        res,
        next,
        err,
        "O rascunho deste atributo não pôde ser escrito neste banco.",
      );
    }
  },
);

/**
 * Propor unidade, periodicidade, agregação e montante a partir dos valores
 * importados. Não grava nada.
 *
 * POST, e não GET, pela mesma razão das outras duas rotas de IA desta tela: o
 * pedido parte do que a pessoa está vendo. Aqui o corpo é opcional e serve para
 * um caso só — quem já digitou nome ou fórmula no card "Significado" e ainda não
 * salvou, e cujo texto é justamente a melhor pista que existe sobre a coluna.
 *
 * A evidência principal não vem do corpo e não poderia vir: são os valores
 * importados, o texto original das células e o comportamento da soma entre
 * vigências. Isso o servidor lê do banco, e é a única coisa nesta tela que a
 * pessoa não digitou.
 */
router.post(
  "/curation/attributes/:code/semantica/sugestao",
  async (req, res, next): Promise<void> => {
    try {
      const detail = await getAttributeDetail(db, req.params.code);
      if (!detail) {
        res.status(404).json({ error: "Atributo não encontrado" });
        return;
      }

      const nome =
        typeof req.body?.displayName === "string"
          ? req.body.displayName
          : (detail.displayName ?? "");
      const formula =
        typeof req.body?.calculationBasis === "string"
          ? req.body.calculationBasis
          : (detail.calculationBasis ?? "");
      const definicao =
        typeof req.body?.definition === "string"
          ? req.body.definition
          : (detail.definition ?? "");

      res.json(
        await sugerirSemantica({
          codigo: detail.code,
          nomeDeOrigem: detail.sourceName,
          nome,
          // O cabeçalho da planilha é outra pista do que a coluna é, e ele
          // costuma diferir do código: `Vida_Comb` na primeira linha,
          // `vidaCombustivel` no código gerado pela importação.
          cabecalho: detail.samples.find((s) => s.columnHeader)?.columnHeader ?? null,
          entidade: detail.entityType,
          tipoDeDado: detail.dataType,
          definicao,
          formula,
          taxonomia: detail.taxonomyName,
          valores: detail.valueCount,
          ausentes: detail.nullCount,
          amostras: detail.samples.map((s) => ({
            vigencia: s.snapshotLabel,
            valor: s.isNull ? null : (s.value ?? null),
            original: s.originalValue,
            tipoDeOrigem: s.originalType,
          })),
          historico: detail.history.map((h) => ({
            vigencia: h.snapshotLabel,
            soma: h.sum,
            quantidade: h.count,
          })),
        }),
      );
    } catch (err) {
      /*
        `sugerirSemantica` não lança — o que cair aqui é falha de banco, e não
        uma regra de negócio para o curador ler. Mesmo caminho das outras duas
        rotas de IA: esta lê o atributo pelo `getAttributeDetail`, que passa pela
        fila e portanto pela `attribute.definition`.
      */
      await responderFalha(
        req,
        res,
        next,
        err,
        "A semântica deste atributo não pôde ser sugerida neste banco.",
      );
    }
  },
);

/**
 * O cadastro de significados econômicos, e a criação inline.
 *
 * ---------------------------------------------------------------------------
 * Por que a criação é POST e não um efeito de digitar
 * ---------------------------------------------------------------------------
 * O combobox da tela busca localmente enquanto a pessoa escreve e só chama esta
 * rota quando ela clica em `+ Criar "…"`. É o item 5.7 do pedido, e o desenho
 * da API o sustenta em vez de confiar na tela: não existe endpoint que crie
 * como efeito de uma busca.
 *
 * ---------------------------------------------------------------------------
 * "Já existe" não é erro
 * ---------------------------------------------------------------------------
 * Pedir para criar algo que já está cadastrado responde **200** com o que
 * existe, e não 409. A tela seleciona o encontrado e segue; quem clicou queria
 * ter aquilo escolhido no campo, e essa é a intenção que a resposta atende. Um
 * 409 obrigaria a tela a fazer uma segunda chamada para descobrir o quê.
 *
 * Rótulo que a autoridade não traduz responde **422**, que é o que ele é: o
 * pedido não pode ser atendido como veio, e a mensagem ensina o formato.
 */
router.get("/curation/significados", async (req, res, next): Promise<void> => {
  try {
    res.json(await listarSignificados(db));
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "O cadastro de significados não pôde ser lido neste banco.",
    );
  }
});

router.post("/curation/significados", async (req, res, next): Promise<void> => {
  try {
    const label = typeof req.body?.label === "string" ? req.body.label : "";
    if (!label.trim()) {
      res.status(400).json({ error: "Informe o significado a cadastrar (label)." });
      return;
    }

    // Mesma regra da confirmação: quem assina é a sessão. Um cadastro que passa
    // a decidir se uma coluna vira dinheiro não pode ter autor digitado.
    const resultado = await criarSignificado(db, { label, actor: req.user!.email });
    if (resultado.desfecho === "NAO_ENTENDIDO") {
      res.status(422).json({ error: resultado.mensagem, proximos: resultado.proximos });
      return;
    }
    res.status(resultado.desfecho === "CRIADO" ? 201 : 200).json(resultado);
  } catch (err) {
    if (faltaOSchemaDaCuradoria(err)) {
      await responderFalha(
        req,
        res,
        next,
        err,
        "O significado não pôde ser cadastrado neste banco.",
      );
      return;
    }
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Meaning creation refused");
    res.status(422).json({ error: message });
  }
});

/**
 * As categorias em linguagem de negócio — e a criação inline delas.
 *
 * Separada de `/curation/taxonomy` de propósito, e não por duplicação: aquela
 * devolve a árvore com `kind`, `path` e `depth`, que é o que a tela de
 * taxonomia mostra. Esta devolve `Custo Variável › Manutenção` e a classe de
 * custo, que é o que a tela de confirmação precisa — e nada mais, porque
 * qualquer campo a mais nesta resposta é jargão reaparecendo na tela que o
 * pedido mandou tirar.
 */
router.get("/curation/categorias", async (req, res, next): Promise<void> => {
  try {
    res.json(await listarCategorias(db));
  } catch (err) {
    await responderFalha(
      req,
      res,
      next,
      err,
      "As categorias não puderam ser lidas neste banco.",
    );
  }
});

router.post("/curation/categorias", async (req, res, next): Promise<void> => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!name.trim()) {
      res.status(400).json({ error: "Informe o nome da categoria (name)." });
      return;
    }
    const resultado = await criarCategoria(db, { name, actor: req.user!.email });
    res.status(resultado.desfecho === "CRIADO" ? 201 : 200).json(resultado);
  } catch (err) {
    if (faltaOSchemaDaCuradoria(err)) {
      await responderFalha(
        req,
        res,
        next,
        err,
        "A categoria não pôde ser cadastrada neste banco.",
      );
      return;
    }
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    req.log.warn({ err }, "Category creation refused");
    res.status(422).json({ error: message });
  }
});

/**
 * Classificar uma categoria em custo fixo, variável ou "não é custo".
 *
 * PATCH e não POST: o recurso já existe, e o que muda é onde ele mora. E é o
 * verbo que deixa claro que a chamada não cria categoria nenhuma — quem cria é
 * `POST /curation/categorias`, e misturar os dois numa rota só faria um erro de
 * digitação no código virar categoria nova em vez de recusa.
 *
 * A justificativa vai no corpo e é obrigatória; o responsável vem da sessão,
 * como em toda decisão deste produto que mexe em dinheiro.
 */
router.patch(
  "/curation/categorias/:code/familia",
  async (req, res, next): Promise<void> => {
    try {
      const { familia, reason } = req.body ?? {};
      if (!familia) {
        res.status(400).json({ error: "Informe a família (familia)." });
        return;
      }
      if (!reason) {
        res.status(400).json({
          error: "Mover uma categoria exige uma justificativa (reason).",
        });
        return;
      }

      res.json(
        await moverCategoriaParaFamilia(db, {
          code: req.params.code,
          familia,
          actor: req.user!.email,
          reason,
        }),
      );
    } catch (err) {
      if (faltaOSchemaDaCuradoria(err)) {
        await responderFalha(
          req,
          res,
          next,
          err,
          "A família desta categoria não pôde ser gravada neste banco.",
        );
        return;
      }
      // Recusas de regra de negócio — classe inexistente, nó que é uma classe,
      // justificativa em branco — com a frase escrita para quem está na tela.
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      req.log.warn({ err }, "Category classification refused");
      res.status(422).json({ error: message });
    }
  },
);

/**
 * A classe de custo — do atributo, e não da categoria.
 *
 * A rota irmã acima move uma categoria de família e responde *o que ela é*.
 * Esta responde *como este valor se comporta*, e é por atributo porque a mesma
 * natureza tem classes diferentes conforme o contexto: `Pessoal e encargos` é
 * fixo no cavalo e variável no trecho. Ver `definirClasseDeCusto`.
 */
router.patch(
  "/curation/attributes/:code/classe-de-custo",
  async (req, res, next): Promise<void> => {
    try {
      const { classe, reason } = req.body ?? {};
      if (!classe) {
        res.status(400).json({ error: "Informe a classe (classe)." });
        return;
      }
      if (!reason) {
        res.status(400).json({
          error: "Definir a classe de custo exige uma justificativa (reason).",
        });
        return;
      }

      res.json(
        await definirClasseDeCusto(db, {
          code: req.params.code,
          classe,
          actor: req.user!.email,
          reason,
        }),
      );
    } catch (err) {
      if (faltaOSchemaDaCuradoria(err)) {
        await responderFalha(
          req,
          res,
          next,
          err,
          "A classe de custo deste atributo não pôde ser gravada neste banco.",
        );
        return;
      }
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      req.log.warn({ err }, "Cost class refused");
      res.status(422).json({ error: message });
    }
  },
);

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
    // A migration já grava o catálogo no escopo global; esta chamada é a
    // idempotente que cobre um banco vindo de antes dela e um escopo novo.
    await seedSignificados(db, actor);
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
