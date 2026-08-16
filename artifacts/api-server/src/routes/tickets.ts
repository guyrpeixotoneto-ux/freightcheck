import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter, type Response } from "express";
import { codigoDoPostgres, db } from "@workspace/db";
import { faltaSchema, responderSchemaAusente } from "../lib/schema-ausente";
import {
  ensureImportStorageDir,
  markTicketImportFailed,
  readTicketImport,
  receiveTicketFile,
} from "@workspace/ingest";
import {
  getTicket,
  getTicketClassification,
  getTicketImport,
  getTicketTotals,
  getTicketsByParameter,
  latestTicketImport,
  listTicketImports,
  listTicketChanges,
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

/**
 * A falha, separando o que é defeito do que é banco desatualizado.
 *
 * "Internal server error" foi o que estas rotas responderam a um export perfeito
 * num banco onde faltavam as migrations de chamados — nas duas pontas, a do
 * upload e a da listagem. A frase manda procurar no arquivo, que estava certo.
 * O status também muda: 503 é indisponibilidade temporária deste ambiente, e
 * não erro do pedido.
 */
async function responderFalha(res: Response, err: unknown): Promise<void> {
  if (faltaOSchemaDeChamados(err)) {
    await responderSchemaAusente(
      res,
      "Este banco ainda não tem onde guardar chamados: falta pelo menos uma " +
        "das migrations que criam esse schema (0012_chamados, " +
        "0013_chamados_por_parametro, 0014_chamados_formato_real). Não é o seu " +
        "arquivo — nada chegou a ser gravado, e nada se perdeu.",
    );
    return;
  }
  res.status(500).json({ error: "Internal server error" });
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
    limit: num("limit"),
    offset: num("offset"),
  };
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
  try {
    res.json(await listTicketImports(db));
  } catch (err) {
    req.log.error({ err }, "Error listing ticket imports");
    await responderFalha(res, err);
  }
});

router.post("/ticket-imports", async (req, res): Promise<void> => {
  const decoded = decodeTicketUpload(req.body);
  if (!decoded.ok) {
    res.status(400).json({ error: decoded.error });
    return;
  }

  try {
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
  } catch (err) {
    req.log.error({ err }, "Error receiving ticket import");
    await responderFalha(res, err);
  }
});

router.get("/ticket-imports/:id", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de envio inválido." });
    return;
  }
  try {
    const run = await getTicketImport(db, req.params.id);
    if (!run) {
      res.status(404).json({ error: "Envio de chamados não encontrado." });
      return;
    }
    res.json(run);
  } catch (err) {
    req.log.error({ err }, "Error loading ticket import");
    await responderFalha(res, err);
  }
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
  try {
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
        total: 0,
        rows: [],
      });
      return;
    }

    const filters = parseTicketFilters(req.query as Record<string, unknown>);
    const [changes, totals, byParameter, imports] = await Promise.all([
      listTicketChanges(db, run.id, filters),
      getTicketTotals(db, run.id),
      getTicketsByParameter(db, run.id),
      listTicketImports(db),
    ]);

    res.json({ import: run, imports, totals, byParameter, ...changes });
  } catch (err) {
    req.log.error({ err }, "Error listing tickets");
    await responderFalha(res, err);
  }
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
  try {
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

    res.json({ import: run, ...(await getTicketClassification(db, run.id)) });
  } catch (err) {
    req.log.error({ err }, "Error classifying tickets");
    await responderFalha(res, err);
  }
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
  try {
    const ticket = await getTicket(db, req.params.id);
    if (!ticket) {
      res.status(404).json({ error: "Chamado não encontrado." });
      return;
    }
    res.json(ticket);
  } catch (err) {
    req.log.error({ err }, "Error loading ticket");
    await responderFalha(res, err);
  }
});

export default router;
