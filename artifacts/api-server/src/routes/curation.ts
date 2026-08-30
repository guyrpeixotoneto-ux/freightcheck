import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  rascunharDefinicao,
  sugerirFormula,
  sugerirSemantica,
} from "@workspace/assistant";
import { faltaSchema } from "../lib/schema-ausente";
import { classificarFalha } from "../lib/classificar-falha";
import { contextoDeSchema } from "../middlewares/contexto-de-schema";
import {
  aplicarPreenchimento,
  declararTipoDoValor,
  definirClasseDeCusto,
  definirDirecaoEconomica,
  moverCategoriaParaFamilia,
  confirmAttribute,
  conferirPreenchimento,
  criarCategoria,
  criarSignificado,
  criarSintetico,
  getAttributeDetail,
  getCurationQueue,
  getCurationSummary,
  getTaxonomyTree,
  listarCategorias,
  listarSignificados,
  listarSinteticos,
  listTaxonomyNodes,
  montarLinhas,
  normalizarEquipamento,
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
 * :code/confirm, and it requires an actor — the reason is optional.
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
 * São cinco, e é isso que torna a Curadoria diferente do Book (uma migration)
 * e de Chamados (três seguidas): as colunas desta tela foram acrescentadas ao
 * longo de todo o produto, e as duas últimas — `attribute.definition`, da
 * `0022_significado`, e `attribute.change_rule`, da `0054_regra_de_alteracao`
 * — são lidas **só** pela fila e pelo detalhe. Nem o resumo, nem a taxonomia,
 * nem nenhuma outra tela as tocam.
 *
 * Essa assimetria é o que faz esta rota merecer um diagnóstico próprio: num
 * banco onde a 0022 consta como aplicada e não deixou a coluna, os cartões de
 * cima somam certo, a taxonomia carrega, e só a fila responde erro. Quem olha
 * a tela vê um produto quase inteiro funcionando e um pedaço quebrado — que é
 * a forma mais cara de esconder uma divergência de schema.
 */
const SCHEMA_DA_CURADORIA =
  "0002_curation_layer, 0005_versioned_semantics, 0022_significado, " +
  "0028_significado_economico e 0054_regra_de_alteracao";

/**
 * A mesma frase de antes, declarada em vez de escrita dentro de um `catch`.
 *
 * Ela era composta por um `responderFalha` que sete rotas chamavam, e cada
 * chamada custava um `catch` que precisava capturar tudo para chegar até ela.
 * O 503 com diagnóstico continua saindo igual; o SQLSTATE é acrescentado pelo
 * contrato JSON, que é quem o tem em mãos na hora. Ver
 * `middlewares/contexto-de-schema.ts` e `middlewares/contrato-json.ts`.
 */
router.use(
  "/curation",
  contextoDeSchema(
    `A Curadoria não pôde ler ou gravar neste banco. O que esta tela lê vem ` +
      `de ${SCHEMA_DA_CURADORIA}. Nada foi gravado por esta chamada, e ` +
      `nenhuma semântica já confirmada foi tocada.`,
  ),
);

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

router.get("/curation/summary", async (req, res, next): Promise<void> => {
  res.json(await getCurationSummary(db));
});

router.get("/curation/queue", async (req, res, next): Promise<void> => {
  const includeConfirmed = req.query.includeConfirmed === "true";
  res.json(await getCurationQueue(db, { includeConfirmed }));
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
async function atributosDoModelo(
  equipamento: string | null = null,
): Promise<AtributoDoModelo[]> {
  const fila = await getCurationQueue(db, { includeConfirmed: true });
  const doRecorte =
    equipamento === null
      ? fila
      : fila.filter((item) => normalizarEquipamento(item.entityType) === equipamento);
  return doRecorte.map((item) => ({
    code: item.code,
    sourceName: item.sourceName,
    entityType: item.entityType,
    semanticsStatus: item.semanticsStatus,
    displayName: item.displayName,
    definition: item.definition,
    changeRule: item.changeRule,
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

/** `CARRETA` → `Carreta`, para caber numa frase em vez de gritar dentro dela. */
function comoSeEscreve(equipamento: string): string {
  return equipamento.charAt(0) + equipamento.slice(1).toLowerCase();
}

/**
 * O sufixo do nome do arquivo, quando o download é de um equipamento só.
 *
 * Sai só com letras e números porque vai dentro de um cabeçalho HTTP, e um tipo
 * de equipamento com acento ou barra é o tipo de coisa que chega de uma base
 * futura e não pode derrubar o download.
 */
function sufixoDoArquivo(equipamento: string): string {
  const limpo = equipamento
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return limpo === "" ? "" : `-${limpo}`;
}

/**
 * O modelo sai no recorte da aba aberta — `?equipamento=CARRETA` escreve só a
 * aba da carreta.
 *
 * O recorte é o do equipamento e **só** o dele: o modelo continua saindo com os
 * atributos já confirmados e sem o filtro de texto da tela, porque ele é o
 * arquivo de quem vai revisar a descrição de uma frota inteira no Excel, e não
 * um retrato da fila que estava na tela no momento do clique. Uma aba que marca
 * `Trecho 0` porque os de trecho já foram confirmados ainda baixa um arquivo
 * com eles dentro — e é o que quem clicou quer, senão teria clicado sabendo que
 * não há nada lá.
 *
 * Sem o parâmetro, o arquivo é o de sempre: uma aba por equipamento.
 */
router.get("/curation/atributos/modelo.xlsx", async (req, res, next): Promise<void> => {
  const equipamento = normalizarEquipamento(
    typeof req.query.equipamento === "string" ? req.query.equipamento : null,
  );

  const [atributos, catalogos] = await Promise.all([
    atributosDoModelo(equipamento),
    catalogosDoModelo(),
  ]);

  if (atributos.length === 0) {
    /*
      Duas frases porque são dois becos diferentes, e mandar a primeira para
      quem caiu no segundo manda a pessoa importar uma base que ela já
      importou. O recorte vazio é o caso comum: a tela mostra a aba mesmo
      quando ela está zerada, de propósito, então dá para clicar em baixar
      estando nela.
    */
    res.status(404).json({
      error:
        equipamento === null
          ? "Nenhum atributo importado ainda — não há o que descrever. Importe a planilha do Freightec primeiro."
          : `Nenhum atributo de ${comoSeEscreve(equipamento)} nesta base — não há o que descrever nesta aba. Troque de aba ou baixe por "Todos".`,
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
  res.setHeader(
    "Content-Disposition",
    /*
      O nome diz o recorte. Dois arquivos na pasta de downloads chamados
      `curadoria-atributos.xlsx`, um com a frota inteira e outro só com a
      carreta, viram `(1)` e uma dúvida na hora de reenviar.
    */
    contentDisposition(
      `curadoria-atributos${equipamento === null ? "" : sufixoDoArquivo(equipamento)}.xlsx`,
    ),
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
});

router.post("/curation/atributos/modelo/previa", async (req, res, next): Promise<void> => {
  const conferido = await conferirUpload(req.body);
  if (!conferido.ok) {
    res.status(400).json({ error: conferido.erro });
    return;
  }
  res.json(conferido.conferencia);
});

router.post("/curation/atributos/modelo/aplicar", async (req, res, next): Promise<void> => {
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
});

router.get("/curation/attributes/:code", async (req, res, next): Promise<void> => {
  const detail = await getAttributeDetail(db, req.params.code);
  if (!detail) {
    res.status(404).json({ error: "Atributo não encontrado" });
    return;
  }
  res.json(detail);
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
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
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
    const { definition, calculationBasis, changeRule, displayName } = req.body ?? {};

    // Same rule as the confirmation: the signature comes from the session, not
    // from the body. A name typed into a form never proved anything.
    const result = await saveMeaning(db, {
      code: req.params.code,
      definition,
      calculationBasis,
      changeRule,
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
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    // Refusals here are business rules with messages written for the curator
    // ("nothing to write", "no versioned semantics yet"), so they are surfaced
    // rather than swallowed into a 500 — same treatment as /confirm.
    req.log.warn({ err }, "Meaning update refused");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * Sugerir a fórmula de cálculo a partir do que a coluna é. Não grava nada.
 *
 * POST, e não GET, porque o nome e a descrição vão no corpo: a tela pede a
 * sugestão a partir do que está digitado **agora**. Quem acabou de batizar e
 * descrever a coluna ainda não salvou — e é justamente nesse instante que a
 * sugestão vale, enquanto a pessoa tem o significado na cabeça e só falta
 * escrever a conta. Exigir o salvamento primeiro faria a sugestão custar o ato
 * que ela existe para adiantar; e, num atributo sem semântica versionada, a
 * base de cálculo nem chega a poder ser gravada.
 *
 * O corpo é opcional: sem ele, sugere-se a partir do nome e da descrição
 * guardados. É o caminho de quem abre um atributo que outra pessoa preencheu.
 */
router.post(
  "/curation/attributes/:code/formula/sugestao",
  async (req, res, next): Promise<void> => {
    const detail = await getAttributeDetail(db, req.params.code);
    if (!detail) {
      res.status(404).json({ error: "Atributo não encontrado" });
      return;
    }

    const nome =
      typeof req.body?.displayName === "string"
        ? req.body.displayName
        : (detail.displayName ?? "");
    const definicao =
      typeof req.body?.definition === "string"
        ? req.body.definition
        : (detail.definition ?? "");

    res.json(
      await sugerirFormula({
        nome,
        nomeDeOrigem: detail.sourceName,
        definicao,
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
          Só o formato dos valores, e só dos que existem. É o que separa
          "valor fixo de tabela" de "conta que varia por veículo" — e amostra
          nula não diz nada sobre a conta, ocupando uma das vagas com a
          palavra "ausente".
        */
        exemplos: detail.samples
          .filter((s) => !s.isNull && s.value !== null)
          .map((s) => String(s.value)),
      }),
    );
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
  res.json(await listarSignificados(db));
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
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Meaning creation refused");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * As linhas sintéticas da DRE — e a criação inline delas.
 *
 * Lista própria, e não derivada de `/curation/categorias`: uma linha recém
 * criada ainda não tem categoria nenhuma dentro, e a tela que a derivasse das
 * categorias mostraria a criação sumindo no instante seguinte ao do clique.
 */
router.get("/curation/sinteticos", async (req, res, next): Promise<void> => {
  res.json(await listarSinteticos(db));
});

router.post("/curation/sinteticos", async (req, res, next): Promise<void> => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!name.trim()) {
      res.status(400).json({ error: "Informe o nome da linha da DRE (name)." });
      return;
    }
    const resultado = await criarSintetico(db, { name, actor: req.user!.email });
    res.status(resultado.desfecho === "CRIADO" ? 201 : 200).json(resultado);
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Synthetic DRE line creation refused");
    res.status(422).json({ error: desfecho.mensagem });
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
  res.json(await listarCategorias(db));
});

router.post("/curation/categorias", async (req, res, next): Promise<void> => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    if (!name.trim()) {
      res.status(400).json({ error: "Informe o nome da categoria (name)." });
      return;
    }
    /*
      `sintetico` é o código da linha da DRE escolhida na tela, e vai como
      pedido — o cadastro decide se atende. Ver `criarCategoria`: nas três
      casas da classificação ele é recusado em silêncio, porque criar lá
      dentro seria classificar sem autor nem justificativa.
    */
    const sintetico =
      typeof req.body?.sintetico === "string" ? req.body.sintetico : null;
    const resultado = await criarCategoria(db, {
      name,
      sintetico,
      actor: req.user!.email,
    });
    res.status(resultado.desfecho === "CRIADO" ? 201 : 200).json(resultado);
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Category creation refused");
    res.status(422).json({ error: desfecho.mensagem });
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
      const desfecho = classificarFalha(err);
      if (desfecho.tipo !== "REGRA") {
        next(err);
        return;
      }
      // Recusas de regra de negócio — classe inexistente, nó que é uma classe,
      // justificativa em branco — com a frase escrita para quem está na tela.
      req.log.warn({ err }, "Category classification refused");
    res.status(422).json({ error: desfecho.mensagem });
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
      res.json(
        await definirClasseDeCusto(db, {
          code: req.params.code,
          classe,
          actor: req.user!.email,
          reason,
        }),
      );
    } catch (err) {
      const desfecho = classificarFalha(err);
      if (desfecho.tipo !== "REGRA") {
        next(err);
        return;
      }
      req.log.warn({ err }, "Cost class refused");
      res.status(422).json({ error: desfecho.mensagem });
    }
  },
);

/**
 * O tipo do valor — `R$/km`, `Quilômetros`, `Texto descritivo`.
 *
 * É o mesmo significado econômico que a confirmação escolhe, e é de propósito:
 * ter dois cadastros de "que tipo de número é este" seria ter duas respostas
 * para a mesma pergunta. O que muda é o preço — aqui não há categoria da DRE,
 * não há assinatura de confirmação e `semantics_status` não se move. Declarar
 * o tipo é descrever a coluna; confirmá-la é vouchar pela aritmética dela.
 * Ver `declararTipoDoValor`.
 */
router.patch(
  "/curation/attributes/:code/tipo",
  async (req, res, next): Promise<void> => {
    try {
      const { meaningCode, reason } = req.body ?? {};
      if (!meaningCode) {
        res.status(400).json({ error: "Informe o tipo do valor (meaningCode)." });
        return;
      }
      res.json(
        await declararTipoDoValor(db, {
          code: req.params.code,
          meaningCode,
          actor: req.user!.email,
          reason,
        }),
      );
    } catch (err) {
      const desfecho = classificarFalha(err);
      if (desfecho.tipo !== "REGRA") {
        next(err);
        return;
      }
      req.log.warn({ err }, "Value type refused");
      res.status(422).json({ error: desfecho.mensagem });
    }
  },
);

/**
 * A direção econômica — para que lado o dinheiro anda quando o atributo anda.
 *
 * Rota irmã de `classe-de-custo`, mesmo molde: por atributo, não por
 * categoria, porque a mesma natureza pode ter direções diferentes conforme o
 * contexto. Ver `definirDirecaoEconomica`.
 */
router.patch(
  "/curation/attributes/:code/direcao-economica",
  async (req, res, next): Promise<void> => {
    try {
      const { direcao, efeito, reason } = req.body ?? {};
      if (!direcao) {
        res.status(400).json({ error: "Informe a direção (direcao)." });
        return;
      }
      res.json(
        await definirDirecaoEconomica(db, {
          code: req.params.code,
          direcao,
          efeito,
          actor: req.user!.email,
          reason,
        }),
      );
    } catch (err) {
      const desfecho = classificarFalha(err);
      if (desfecho.tipo !== "REGRA") {
        next(err);
        return;
      }
      req.log.warn({ err }, "Economic direction refused");
      res.status(422).json({ error: desfecho.mensagem });
    }
  },
);

router.get("/curation/taxonomy", async (req, res, next): Promise<void> => {
  const flat = req.query.flat === "true";
  res.json(flat ? await listTaxonomyNodes(db) : await getTaxonomyTree(db));
});

router.post("/curation/proposal-pass", async (req, res, next): Promise<void> => {
  const actor = req.user?.email ?? "api:proposal-pass";
  await seedTaxonomy(db, actor);
  // A migration já grava o catálogo no escopo global; esta chamada é a
  // idempotente que cobre um banco vindo de antes dela e um escopo novo.
  await seedSignificados(db, actor);
  res.json(await runProposalPass(db, actor));
});

export default router;
