import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { codigoDoPostgres, db } from "@workspace/db";
import { faltaSchema } from "../lib/schema-ausente";
import { contextoDeSchema } from "../middlewares/contexto-de-schema";
import {
  TicketImportDeletionRefused,
  deleteTicketImport,
  ensureImportStorageDir,
  listTicketImportDeletions,
  markTicketImportFailed,
  planTicketImportDeletion,
  readTicketImport,
  receiveTicketFile,
} from "@workspace/ingest";
import {
  getTicket,
  getTicketClassification,
  getTicketImport,
  getTicketTotals,
  getTicketVigencias,
  getTicketsByParameter,
  latestTicketImport,
  listTicketImports,
  listTicketChanges,
  processarEnvioDeChamados,
  recalcularSerie,
  lerEscopo,
  rotulosNaJanela,
  temEscopo,
  type EixoDeVigencias,
  type EscopoDeFrota,
  type TicketFilters,
} from "@workspace/comparison";

/**
 * Chamados — a aba irmã de Alterações.
 *
 * A planilha responde "o que a Ambev mexeu entre duas vigências"; o chamado
 * responde "o que nós pedimos e o que voltou". As duas superfícies são
 * deliberadamente separadas até aqui: nenhuma rota deste arquivo soma nada com
 * o impacto da comparação, e nenhuma rota de `changes.ts` lê um chamado. É o
 * que garante que a soma da tela continue fechando com a comparação.
 *
 * Ler o arquivo é o passo inteiro — não há preview nem promoção, porque não há
 * decisão humana no meio: um chamado lido não escreve fato canônico nenhum.
 */
const router: IRouter = Router();

/**
 * O que este router — e mais ninguém — sabe dizer quando falta schema.
 *
 * Mesma frase de sempre, entregue pelo mesmo 503 com diagnóstico. O que sai são
 * os oito `try/catch` que existiam só para chamá-la: para dizer isto num banco
 * atrasado, cada um precisava capturar tudo — e o que não fosse falta de schema
 * virava `{"error": "Internal server error"}`, a constante que mandava procurar
 * defeito num arquivo que estava certo. Ver `middlewares/contexto-de-schema.ts`.
 */
router.use(
  ["/ticket-imports", "/tickets", "/ticket-import-deletions"],
  contextoDeSchema(
    "Este banco ainda não tem onde guardar chamados: falta pelo menos uma " +
      "das migrations que criam esse schema (0012_chamados, " +
      "0013_chamados_por_parametro, 0014_chamados_formato_real). Não é o seu " +
      "arquivo — nada chegou a ser gravado, e nada se perdeu.",
  ),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_ACTOR = "upload";

/**
 * O banco deste ambiente ainda não tem onde guardar chamados?
 *
 * `42P01` é tabela que não existe, `42703` coluna que não existe, `42704` tipo
 * que não existe. Os três dizem a mesma coisa: falta migration, e não é
 * defeito do pedido.
 *
 * `42703` é o que mais aparece aqui, e é o mais traiçoeiro: a `0012` cria as
 * tabelas de chamados, e as `0013`/`0014` acrescentam colunas a elas. Num banco
 * parado na `0012` a tabela existe — então nada indica "falta migration" — e
 * toda consulta morre por causa de uma coluna.
 */
export function faltaOSchemaDeChamados(err: unknown): boolean {
  return faltaSchema(err);
}

export type DecodedTicketUpload = {
  filename: string;
  extension: ".xlsx" | ".csv";
  bytes: Buffer;
};

export type DecodeTicketResult =
  | { ok: true; value: DecodedTicketUpload }
  | { ok: false; error: string };

/**
 * O corpo do upload, conferido antes de virar arquivo em disco.
 *
 * Aceita `.csv` além de `.xlsx`, o que a rota de vigência não faz — e a
 * diferença é da fonte, não de rigor: a fila do Freightech exporta em CSV, e
 * recusá-lo obrigaria quem opera a abrir e salvar de novo no Excel só para nos
 * agradar. Por isso a assinatura "PK" só é exigida do `.xlsx`: um CSV é texto,
 * e cobrar dele o cabeçalho de um zip recusaria justamente o arquivo certo.
 */
export function decodeTicketUpload(body: unknown): DecodeTicketResult {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Envie um JSON com filename e contentBase64." };
  }
  const { filename, contentBase64 } = body as Record<string, unknown>;

  if (typeof filename !== "string" || filename.trim() === "") {
    return { ok: false, error: "filename é obrigatório." };
  }
  const safeName = path.basename(filename.trim());
  const lower = safeName.toLowerCase();
  const extension = lower.endsWith(".xlsx")
    ? (".xlsx" as const)
    : lower.endsWith(".csv")
      ? (".csv" as const)
      : null;
  if (!extension) {
    return {
      ok: false,
      error: `Só lemos .xlsx e .csv, e "${safeName}" não é nenhum dos dois. Exporte a fila de chamados do Freightech em um desses formatos.`,
    };
  }

  if (typeof contentBase64 !== "string" || contentBase64.trim() === "") {
    return { ok: false, error: "contentBase64 é obrigatório." };
  }
  const encoded = contentBase64.trim();
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(encoded)) {
    return { ok: false, error: "contentBase64 não está em base64 válido." };
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0) {
    return { ok: false, error: "O arquivo chegou vazio." };
  }
  if (extension === ".xlsx" && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) {
    return {
      ok: false,
      error: `"${safeName}" não é uma planilha do Excel: o conteúdo não começa como um arquivo .xlsx. Se o export saiu em texto, renomeie para .csv em vez de .xlsx.`,
    };
  }

  return { ok: true, value: { filename: safeName, extension, bytes } };
}

/**
 * As colunas por que a tabela deixa ordenar.
 *
 * A lista existe para que `sort` não seja texto de fora atravessando até o
 * `ORDER BY`: o que não estiver aqui simplesmente não é uma ordenação, e a
 * consulta volta para a ordem de casa — materialidade.
 */
const ORDENACOES = ["chamado", "tipo", "impacto", "situacao", "data"];

/**
 * O escopo de frota das telas 360°, quando elas pedem.
 *
 * Não precisa de chave de opt-in como a rota de Alterações: `entityType` nunca
 * foi filtro de chamado, e `placa` também não — o recorte por placa existia só
 * dentro do `search` livre, que casa com meio texto do chamado. Aqui os dois
 * nomes chegam sem ambiguidade, e o que eles recortam é a população: os cartões
 * do topo mudam com eles, o que nenhum filtro desta rota faz.
 */
function parseEscopoDeFrota(query: Record<string, unknown>): EscopoDeFrota {
  return lerEscopo({ entityType: query.entityType, plate: query.placa });
}

function parseTicketFilters(query: Record<string, unknown>): TicketFilters {
  const str = (key: string) =>
    typeof query[key] === "string" && query[key] !== ""
      ? (query[key] as string)
      : undefined;
  const num = (key: string) => {
    const value = str(key);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    statusBucket: str("statusBucket"),
    impactConfidence: str("impactConfidence"),
    attributeCode: str("attributeCode"),
    parameterLabel: str("parameterLabel"),
    beforeSource: str("beforeSource"),
    changeKind: str("changeKind"),
    subject: str("subject"),
    subjectMissing: str("subjectMissing") === "true",
    search: str("search"),
    onlyDivergent: str("onlyDivergent") === "true",
    minAbsImpact: num("minAbsImpact"),
    sort: ORDENACOES.includes(str("sort") ?? "") ? str("sort") : undefined,
    dir: str("dir") === "desc" ? "desc" : "asc",
    limit: num("limit"),
    offset: num("offset"),
  };
}

/**
 * O recorte De/Até que a query pede, sem resolver nada ainda.
 *
 * Escrito à parte de `parseTicketFilters` porque não é um filtro de linha: as
 * duas pontas são datas de vigência, e traduzi-las nos rótulos que o envio
 * contém depende do envio — o que só se sabe depois de escolhê-lo. É a mesma
 * separação que `parseContext` faz do outro lado, pela mesma razão.
 */
export function parseJanela(
  query: Record<string, unknown>,
): { de?: string; ate?: string } | null {
  const str = (chave: string) =>
    typeof query[chave] === "string" && query[chave] !== ""
      ? (query[chave] as string)
      : undefined;
  const de = str("de");
  const ate = str("ate");
  return de === undefined && ate === undefined ? null : { de, ate };
}

/**
 * O eixo como a tela o recebe: uma legenda por data, e não a lista de grafias.
 *
 * A lista inteira serve para filtrar (ver `EixoDeVigencias.rotulos`); o seletor
 * mostra um nome por opção, e mostrar dois faria uma diferença de escrita
 * parecer uma diferença de período.
 */
export function eixoParaTela(eixo: EixoDeVigencias) {
  return {
    disponiveis: eixo.disponiveis,
    rotulos: Object.fromEntries(
      eixo.disponiveis.map((d) => [d, eixo.rotulos[d]?.[0] ?? d]),
    ),
    semVigencia: eixo.semVigencia,
  };
}

/**
 * Quantas vigências o recorte de fato alcançou neste envio.
 *
 * Contado aqui e não na tela: quem recorta por um intervalo que este envio não
 * nomeia recebe zero, e uma tela que contasse por conta própria diria o tamanho
 * do intervalo escolhido em vez do que ele encontrou. Sem recorte, é o eixo
 * inteiro — o mesmo número dos dois lados, para que a tela não tenha de saber
 * se houve filtro.
 */
export function contarVigenciasNoRecorte(
  eixo: EixoDeVigencias,
  vigenciaLabels: string[] | null,
): number {
  if (vigenciaLabels === null) return eixo.disponiveis.length;
  const alcancados = new Set(vigenciaLabels);
  return eixo.disponiveis.filter((d) =>
    (eixo.rotulos[d] ?? []).some((r) => alcancados.has(r)),
  ).length;
}

/**
 * Ler o arquivo fora do ciclo da requisição.
 *
 * Mesma razão da importação de vigência: um export de fila com dezenas de
 * milhares de linhas estoura o tempo do proxy antes de responder. O cliente
 * recebe o id na hora e pergunta o estado por `/ticket-imports/:id`.
 */
async function readInBackground(
  ticketImportId: string,
  log: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    await readTicketImport(db, ticketImportId);
    /*
      Lido o arquivo, o Monitoramento compara este envio com o anterior da mesma
      série e recalcula o dia. Roda **aqui**, e não dentro de `readTicketImport`,
      porque `lib/comparison` já importa de `lib/ingest` e o caminho inverso
      fecharia um ciclo entre os dois pacotes — a rota é o lugar onde os dois já
      se encontram.

      Uma falha aqui não desfaz a leitura: o arquivo entrou, os chamados estão no
      banco, e a aba Chamados responde por eles. O que fica faltando é a
      comparação, que é derivada e volta com um recálculo. Marcar o envio como
      FAILED por causa disso apagaria dado bom por causa de conta refazível.
    */
    try {
      await processarEnvioDeChamados(db, ticketImportId);
    } catch (err) {
      log.error(
        { err, ticketImportId },
        "Ticket import read, but monitoring comparison failed",
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    log.error({ err, ticketImportId }, "Ticket import failed");
    try {
      await markTicketImportFailed(db, ticketImportId, message);
    } catch (markErr) {
      log.error({ err: markErr, ticketImportId }, "Could not mark ticket import as failed");
    }
  }
}

/** Os envios de chamados, o mais novo primeiro — os que falharam inclusive. */
router.get("/ticket-imports", async (req, res): Promise<void> => {
  res.json(await listTicketImports(db));
});

router.post("/ticket-imports", async (req, res): Promise<void> => {
  const decoded = decodeTicketUpload(req.body);
  if (!decoded.ok) {
    res.status(400).json({ error: decoded.error });
    return;
  }

  const { filename, extension, bytes } = decoded.value;
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const filePath = path.join(
    ensureImportStorageDir(),
    `chamados-${contentSha256}${extension}`,
  );
  writeFileSync(filePath, bytes);

  const received = await receiveTicketFile(db, {
    filePath,
    filename,
    receivedBy: req.user?.email ?? DEFAULT_ACTOR,
  });

  if (received.isDuplicate) {
    const run = await getTicketImport(db, received.ticketImportId);
    res.status(409).json({
      error:
        run?.failureReason ??
        `Este arquivo de chamados já havia sido lido (sha256 ${contentSha256.slice(0, 16)}…).`,
      ticketImportId: received.ticketImportId,
    });
    return;
  }

  res.status(202).json({
    ticketImportId: received.ticketImportId,
    contentSha256: received.contentSha256,
    status: "PENDING",
  });

  void readInBackground(received.ticketImportId, req.log);
});

router.get("/ticket-imports/:id", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de envio inválido." });
    return;
  }
  const run = await getTicketImport(db, req.params.id);
  if (!run) {
    res.status(404).json({ error: "Envio de chamados não encontrado." });
    return;
  }
  res.json(run);
});

/**
 * O que a exclusão tiraria, antes de tirar.
 *
 * A pergunta "tem certeza?" não é responsável por si só: quem está na tela não
 * tem como saber que aquele arquivo sustenta 1.218 chamados. Esta rota é o que
 * transforma a confirmação numa decisão — e é a mesma conta que a exclusão vai
 * fazer, escrita uma vez só em `planTicketImportDeletion`.
 */
router.get("/ticket-imports/:id/deletion", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de envio inválido." });
    return;
  }
  const plan = await planTicketImportDeletion(db, req.params.id);
  if (!plan) {
    res.status(404).json({ error: "Envio de chamados não encontrado." });
    return;
  }
  res.json(plan);
});

/**
 * Excluir um envio de chamados.
 *
 * Quem exclui é quem está logado, e o nome vai para `ticket_import_deletion`
 * junto com o que saiu — o registro sobrevive ao dado, que é a única forma de
 * "isto foi apagado" continuar sendo uma afirmação verificável depois.
 *
 * A recusa — um envio ainda sendo lido — volta como 409 com a frase inteira.
 * Não é erro do servidor: é a ordem em que as coisas podem ser desfeitas.
 */
router.delete("/ticket-imports/:id", async (req, res, next): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de envio inválido." });
    return;
  }
  try {
    const motivo =
      typeof req.body?.reason === "string" && req.body.reason.trim() !== ""
        ? req.body.reason.trim()
        : null;

    const result = await deleteTicketImport(db, req.params.id, {
      deletedBy: req.user?.email ?? DEFAULT_ACTOR,
      reason: motivo,
    });

    /*
      Tirar um envio muda o "anterior" de quem ficou.

      A cascata da `0087` já levou as movimentações que apontavam para ele, mas
      as comparações dos envios **seguintes** continuam gravadas contra uma base
      que não existe mais — e a régua mostraria dias inteiros errados até a
      próxima importação. `recalcularSerie` refaz a cadeia.

      A falha aqui não desfaz a exclusão: ela já foi aceita pelo banco e
      registrada em `ticket_import_deletion`, que é append-only. O que fica é
      uma camada derivada desatualizada — e derivada se refaz.
    */
    try {
      await recalcularSerie(db, result.serie);
    } catch (err) {
      req.log.error(
        { err, ticketImportId: req.params.id, serie: result.serie },
        "Ticket import deleted, but monitoring recompute failed",
      );
    }

    res.json(result);
  } catch (err) {
    if (err instanceof TicketImportDeletionRefused) {
      const naoEncontrado = err.message.includes("não encontrado");
      req.log.warn({ err, ticketImportId: req.params.id }, "Deletion refused");
      res.status(naoEncontrado ? 404 : 409).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/** O histórico das exclusões — o que já não está mais aqui, e por ordem de quem. */
router.get("/ticket-import-deletions", async (req, res): Promise<void> => {
  res.json(await listTicketImportDeletions(db));
});

/**
 * Os chamados do envio pedido — ou do último lido, quando nenhum é pedido.
 *
 * Sem envio nenhum a resposta é 200 com `import: null` e lista vazia, e não
 * 404: a aba abre antes de existir arquivo, e "ainda não importaram chamados"
 * é um estado do produto, não um erro do pedido. A tela precisa da diferença
 * para mostrar o convite a importar em vez de uma faixa vermelha.
 */
router.get("/tickets", async (req, res): Promise<void> => {
  const requested = typeof req.query.ticketImportId === "string"
    ? req.query.ticketImportId
    : undefined;
  if (requested !== undefined && !UUID.test(requested)) {
    res.status(400).json({ error: "Identificador de envio inválido." });
    return;
  }

  const run = requested
    ? await getTicketImport(db, requested)
    : await latestTicketImport(db);

  if (!run) {
    res.json({
      import: null,
      imports: await listTicketImports(db),
      totals: null,
      byParameter: [],
      vigencias: { disponiveis: [], rotulos: {}, semVigencia: 0 },
      janela: null,
      vigenciasNoRecorte: 0,
      total: 0,
      rows: [],
    });
    return;
  }

  /*
    Os dois recortes da população são resolvidos antes de tudo e atravessam as
    quatro leituras — nenhum dos dois é filtro de linha.

    O **escopo de frota** diz de que ativos a tela fala; o **recorte De/Até**
    diz de que período. Passar qualquer um deles só para a lista deixaria os
    cartões do topo respondendo pelo envio inteiro ao lado de um seletor
    dizendo "3 de 9 vigências" — dois números certos e a leitura errada, que é
    o defeito que este produto existe para pegar.
  */
  const eixo = await getTicketVigencias(db, run.id);
  const janela = parseJanela(req.query as Record<string, unknown>);
  const vigenciaLabels = rotulosNaJanela(eixo, janela);
  const escopo = parseEscopoDeFrota(req.query as Record<string, unknown>);

  const filters = {
    ...parseTicketFilters(req.query as Record<string, unknown>),
    vigenciaLabels,
  };
  const [changes, totals, byParameter, imports] = await Promise.all([
    listTicketChanges(db, run.id, filters, escopo),
    getTicketTotals(db, run.id, vigenciaLabels, escopo),
    getTicketsByParameter(db, run.id, vigenciaLabels, 15, escopo),
    listTicketImports(db),
  ]);

  // `escopo` volta na resposta pelo mesmo motivo que `entityType` volta em
  // Impacto: a tela precisa poder dizer que os 340 chamados abaixo são os do
  // cavalo, e não os 1.218 do arquivo.
  res.json({
    import: run,
    imports,
    totals,
    byParameter,
    ...(temEscopo(escopo) ? { escopo } : {}),
    vigencias: eixoParaTela(eixo),
    janela,
    vigenciasNoRecorte: contarVigenciasNoRecorte(eixo, vigenciaLabels),
    ...changes,
  });
});

/**
 * As alterações do envio dobradas por tipo de valor.
 *
 * Rota própria, e não mais um campo em `/tickets`: a visão por tipo é a segunda
 * das duas da aba, e quem fica no Resumo não deve pagar por uma agregação que
 * não vai ver. Sem filtro nenhum, de propósito — é a árvore do envio inteiro, e
 * quem quiser recortar clica numa folha, que devolve para `/tickets` com o
 * parâmetro e o assunto daquela folha.
 *
 * **Precisa vir antes de `/tickets/:id`.** O Express casa na ordem de registro,
 * e `classification` cairia no `:id`, que responderia 400 por não ser UUID.
 */
router.get("/tickets/classification", async (req, res): Promise<void> => {
  const requested =
    typeof req.query.ticketImportId === "string"
      ? req.query.ticketImportId
      : undefined;
  if (requested !== undefined && !UUID.test(requested)) {
    res.status(400).json({ error: "Identificador de envio inválido." });
    return;
  }

  const run = requested
    ? await getTicketImport(db, requested)
    : await latestTicketImport(db);

  // Mesma escolha de `/tickets`: sem envio é 200 com nada dentro, e não 404.
  // A aba abre antes de existir arquivo, e isso é um estado, não um erro.
  if (!run) {
    res.json({
      import: null,
      classes: [],
      changes: 0,
      overlap: 0,
      unclassified: 0,
    });
    return;
  }

  /*
    Sem filtro, como o cabeçalho diz — mas **com** escopo e **com** recorte,
    que são outra coisa. A árvore é do envio inteiro para quem abre por
    Alterações, e é a do equipamento para quem abre por Cavalo 360°: lá a
    população da tela é outra, e uma árvore da frota inteira dentro dela
    contaria o que a tela afirma não estar mostrando. O recorte De/Até é o
    mesmo da lista pela mesma razão — as duas visões são do mesmo arquivo, e
    uma árvore que somasse o envio inteiro ao lado de uma lista recortada
    faria as duas visões da mesma aba discordarem sobre o próprio assunto.
  */
  const escopo = parseEscopoDeFrota(req.query as Record<string, unknown>);
  const eixo = await getTicketVigencias(db, run.id);
  const vigenciaLabels = rotulosNaJanela(
    eixo,
    parseJanela(req.query as Record<string, unknown>),
  );

  res.json({
    import: run,
    ...(temEscopo(escopo) ? { escopo } : {}),
    ...(await getTicketClassification(db, run.id, vigenciaLabels, escopo)),
  });
});

/**
 * Um chamado inteiro: tudo o que ele mexeu, e a linha do arquivo como veio.
 *
 * É o equivalente de `/changes/:id/provenance` deste lado. A lista mostra uma
 * linha por parâmetro, e quem abre uma delas costuma querer a pergunta
 * inversa — *o que mais este chamado alterou?* —, que só esta rota responde.
 *
 * Fica numa rota própria porque a linha original é grande e quase ninguém a
 * abre: mandá-la junto com a lista faria toda abertura de tela pagar por isso.
 */
router.get("/tickets/:id", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de chamado inválido." });
    return;
  }
  const ticket = await getTicket(db, req.params.id);
  if (!ticket) {
    res.status(404).json({ error: "Chamado não encontrado." });
    return;
  }
  res.json(ticket);
});

export default router;
