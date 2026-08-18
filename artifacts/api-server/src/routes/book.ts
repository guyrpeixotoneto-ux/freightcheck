import { createHash } from "node:crypto";
import path from "node:path";
import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, bookEntryTable, codigoDoPostgres } from "@workspace/db";
import { faltaSchema } from "../lib/schema-ausente";
import { contextoDeSchema } from "../middlewares/contexto-de-schema";

/**
 * Book do Operador — a regra de cada bloco, escrita ou anexada.
 *
 * O que o export do Freightec não traz é a regra. Estas rotas são por onde ela
 * entra: quem opera abre o cartão do bloco e ou **escreve** a regra ali, ou
 * **anexa** o documento que a contém. A partir daí o FreightCheck tem o que
 * mostrar quando alguém perguntar em que se apoia uma linha de remuneração.
 *
 * **Os dois tipos dividem a mesma linha do tempo.** Escrever hoje e anexar o
 * contrato assinado no mês que vem é a sequência mais provável de todas, e ela
 * só se lê como sequência se as duas entradas estiverem na mesma numeração de
 * revisão. Ver `lib/db/src/schema/book.ts`.
 *
 * **Substituir não apaga.** `POST` sempre cria a revisão seguinte; não existe
 * `DELETE` nesta superfície e não é esquecimento. Uma auditoria de seis meses
 * atrás precisa da regra que valia naquele dia — apagar a anterior tornaria a
 * pergunta irrespondível.
 *
 * **A listagem nunca devolve conteúdo inteiro.** São 63 blocos: mandar cada PDF
 * — ou cada texto completo — junto do índice transformaria abrir a tela em
 * baixar o que ninguém pediu. O índice traz metadado e, no texto, as primeiras
 * linhas; o resto sai por `/history` e por `/content`.
 */
const router: IRouter = Router();

/**
 * O que este router — e mais ninguém — sabe dizer quando falta schema.
 *
 * A frase é a mesma de antes, e ela sai do mesmo lugar de sempre: o 503 com o
 * diagnóstico de `diagnosticar`. O que mudou é quem a entrega. Ela morava num
 * `responderFalha` chamado de dentro de quatro `try/catch`, e cada um daqueles
 * `catch` cobrava um preço: para dizer isto num banco divergente, eles
 * capturavam **tudo** — e o que não fosse falta de schema saía como
 * `{"error": "Internal server error"}`, sem `code` e sem `requestId`.
 *
 * Declarada aqui, ela chega ao mesmo lugar sem que nenhuma rota precise
 * capturar coisa alguma. Ver `middlewares/contexto-de-schema.ts`.
 */
router.use(
  "/book",
  contextoDeSchema(
    "O Book do Operador não tem onde guardar neste banco: a tabela que a " +
      "migration 0008_book_entries cria não existe aqui. Não é o seu " +
      "arquivo — nada chegou a ser gravado, e nada se perdeu.",
  ),
);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O teto de um documento, em bytes.
 *
 * `app.ts` aceita corpo de 64 MB, e o base64 infla o arquivo em um terço — 25
 * MB de PDF viram ~34 MB de JSON, com folga confortável. O limite existe aqui,
 * e não só lá, para que o excesso volte como uma frase sobre o arquivo em vez
 * do 413 do parser, que não diz qual é o tamanho aceito nem o que fazer.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * O teto de uma entrada de texto, em caracteres.
 *
 * Cinquenta mil é cerca de vinte páginas — folgado para uma regra escrita à
 * mão, e apertado o bastante para deixar claro que um manual inteiro colado
 * aqui deveria ser o PDF anexado, onde ele fica com a formatação, as tabelas e
 * a assinatura que o texto puro perde.
 */
export const MAX_TEXT_CHARS = 50_000;

/** Quantos caracteres do texto a listagem mostra sem que ninguém peça. */
const PREVIEW_CHARS = 400;

/**
 * O que se aceita como documento de um bloco, e como se confere.
 *
 * A lista é curta de propósito. Estes blocos recebem manual, contrato, planilha
 * de apoio e print de tela — não código, não arquivo executável, não HTML (que
 * o navegador executaria se algum dia alguém servisse isto inline).
 *
 * `assinatura` são os primeiros bytes que o formato obriga. Ela existe porque a
 * extensão é só o que o cliente disse: um `.pdf` que na verdade é outra coisa
 * passaria pela extensão e só apareceria como arquivo corrompido no computador
 * de quem baixasse, longe demais da causa. Onde o formato não tem assinatura —
 * texto puro — não há o que conferir, e a lista diz isso com `null` em vez de
 * fingir uma checagem.
 */
interface TipoAceito {
  mime: string;
  assinatura: number[][] | null;
}

const ZIP = [0x50, 0x4b]; // .docx/.xlsx/.pptx são zip
const OLE = [0xd0, 0xcf, 0x11, 0xe0]; // .doc/.xls/.ppt são OLE2

export const TIPOS_ACEITOS: Record<string, TipoAceito> = {
  ".pdf": { mime: "application/pdf", assinatura: [[0x25, 0x50, 0x44, 0x46]] },
  ".docx": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    assinatura: [ZIP],
  },
  ".xlsx": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    assinatura: [ZIP],
  },
  ".pptx": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    assinatura: [ZIP],
  },
  ".doc": { mime: "application/msword", assinatura: [OLE] },
  ".xls": { mime: "application/vnd.ms-excel", assinatura: [OLE] },
  ".ppt": { mime: "application/vnd.ms-powerpoint", assinatura: [OLE] },
  ".png": {
    mime: "image/png",
    assinatura: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  ".jpg": { mime: "image/jpeg", assinatura: [[0xff, 0xd8, 0xff]] },
  ".jpeg": { mime: "image/jpeg", assinatura: [[0xff, 0xd8, 0xff]] },
  ".csv": { mime: "text/csv", assinatura: null },
  ".txt": { mime: "text/plain", assinatura: null },
  ".md": { mime: "text/markdown", assinatura: null },
};

const EXTENSOES_ACEITAS = Object.keys(TIPOS_ACEITOS).join(", ");

interface Bloco {
  blockKey: string;
  blockCategory: string;
  blockTitle: string;
}

export type DecodedBookEntry = Bloco & {
  note: string | null;
  mimeType: string;
  byteSize: number;
  contentSha256: string;
} & (
    | { kind: "DOCUMENTO"; filename: string; content: Buffer; bodyText: null }
    | { kind: "TEXTO"; filename: null; content: null; bodyText: string }
  );

export type BookDecodeResult =
  | { ok: true; value: DecodedBookEntry }
  | { ok: false; error: string };

/**
 * O corpo do envio, conferido antes de qualquer coisa tocar o banco.
 *
 * Mesma postura de `decodeUpload` em `imports.ts`, e pelo mesmo motivo: cada
 * recusa aqui evita que um erro apareça mais longe da causa, com uma mensagem
 * que não ajuda quem enviou.
 */
export function decodeBookEntry(body: unknown): BookDecodeResult {
  if (typeof body !== "object" || body === null) {
    return {
      ok: false,
      error: 'Envie um JSON com kind ("DOCUMENTO" ou "TEXTO") e o bloco.',
    };
  }
  const corpo = body as Record<string, unknown>;

  const bloco = lerBloco(corpo);
  if (!bloco.ok) return bloco;

  const note = lerNota(corpo.note);
  if (!note.ok) return note;

  if (corpo.kind === "DOCUMENTO") {
    return decodeDocumento(bloco.value, note.value, corpo);
  }
  if (corpo.kind === "TEXTO") {
    return decodeTexto(bloco.value, note.value, corpo);
  }
  return {
    ok: false,
    error:
      'kind precisa ser "DOCUMENTO" (arquivo anexado) ou "TEXTO" (regra escrita aqui).',
  };
}

function lerBloco(
  corpo: Record<string, unknown>,
): { ok: true; value: Bloco } | { ok: false; error: string } {
  const { blockKey, blockCategory, blockTitle } = corpo;

  if (typeof blockKey !== "string" || blockKey.trim() === "") {
    return { ok: false, error: "blockKey é obrigatório." };
  }
  if (typeof blockCategory !== "string" || blockCategory.trim() === "") {
    return { ok: false, error: "blockCategory é obrigatório." };
  }
  if (typeof blockTitle !== "string" || blockTitle.trim() === "") {
    return { ok: false, error: "blockTitle é obrigatório." };
  }

  return {
    ok: true,
    value: {
      blockKey: blockKey.trim(),
      blockCategory: blockCategory.trim(),
      blockTitle: blockTitle.trim(),
    },
  };
}

function lerNota(
  note: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (note !== undefined && note !== null && typeof note !== "string") {
    return { ok: false, error: "note, quando enviada, precisa ser texto." };
  }
  return {
    ok: true,
    value: typeof note === "string" && note.trim() !== "" ? note.trim() : null,
  };
}

function decodeDocumento(
  bloco: Bloco,
  note: string | null,
  corpo: Record<string, unknown>,
): BookDecodeResult {
  const { filename, contentBase64 } = corpo;

  if (typeof filename !== "string" || filename.trim() === "") {
    return { ok: false, error: "filename é obrigatório num DOCUMENTO." };
  }

  // basename: o nome vem do cliente e é gravado como veio. Um "../" dentro dele
  // nunca chega a tocar em caminho nenhum — os bytes vão para o banco —, mas
  // também não precisa existir no registro.
  const safeName = path.basename(filename.trim());
  const extensao = path.extname(safeName).toLowerCase();
  const tipo = TIPOS_ACEITOS[extensao];
  if (!tipo) {
    return {
      ok: false,
      error: extensao
        ? `Não aceitamos "${extensao}" como documento de bloco. Os formatos aceitos são: ${EXTENSOES_ACEITAS}.`
        : `"${safeName}" está sem extensão, então não dá para saber o que é. Os formatos aceitos são: ${EXTENSOES_ACEITAS}.`,
    };
  }

  if (typeof contentBase64 !== "string" || contentBase64.trim() === "") {
    return { ok: false, error: "contentBase64 é obrigatório num DOCUMENTO." };
  }
  const encoded = contentBase64.trim();
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(encoded)) {
    return { ok: false, error: "contentBase64 não está em base64 válido." };
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length === 0) {
    return { ok: false, error: "O arquivo chegou vazio." };
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: `"${safeName}" tem ${formatarBytes(bytes.length)} e o limite é ${formatarBytes(MAX_DOCUMENT_BYTES)} por documento.`,
    };
  }

  if (tipo.assinatura && !tipo.assinatura.some((a) => comecaCom(bytes, a))) {
    return {
      ok: false,
      error: `"${safeName}" não é um ${extensao} de verdade: o conteúdo não começa como esse formato. Confira se o arquivo não foi renomeado.`,
    };
  }

  return {
    ok: true,
    value: {
      ...bloco,
      kind: "DOCUMENTO",
      filename: safeName,
      content: bytes,
      bodyText: null,
      mimeType: tipo.mime,
      byteSize: bytes.length,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      note,
    },
  };
}

function decodeTexto(
  bloco: Bloco,
  note: string | null,
  corpo: Record<string, unknown>,
): BookDecodeResult {
  const { bodyText } = corpo;

  if (typeof bodyText !== "string") {
    return { ok: false, error: "bodyText é obrigatório num TEXTO." };
  }
  /*
    Só as pontas são aparadas. Recuo e linha em branco no meio são estrutura de
    markdown — reindentar aqui reescreveria a regra de alguém em silêncio, que é
    exatamente o que este produto não faz com dado que recebe.
  */
  const texto = bodyText.replace(/^\s+|\s+$/g, "");
  if (texto === "") {
    return {
      ok: false,
      error: "O texto chegou vazio. Escreva a regra ou anexe um documento.",
    };
  }
  if (texto.length > MAX_TEXT_CHARS) {
    return {
      ok: false,
      error: `O texto tem ${texto.length.toLocaleString("pt-BR")} caracteres e o limite é ${MAX_TEXT_CHARS.toLocaleString("pt-BR")}. Acima disso, anexe o documento: ele preserva tabelas, formatação e assinatura, que o texto puro perde.`,
    };
  }

  const bytes = Buffer.from(texto, "utf8");
  return {
    ok: true,
    value: {
      ...bloco,
      kind: "TEXTO",
      filename: null,
      content: null,
      bodyText: texto,
      mimeType: "text/markdown",
      byteSize: bytes.length,
      contentSha256: createHash("sha256").update(bytes).digest("hex"),
      note,
    },
  };
}

function comecaCom(bytes: Buffer, assinatura: number[]): boolean {
  if (bytes.length < assinatura.length) return false;
  return assinatura.every((byte, indice) => bytes[indice] === byte);
}

export function formatarBytes(total: number): string {
  if (total < 1024) return `${total} B`;
  if (total < 1024 * 1024) return `${Math.round(total / 1024)} KB`;
  return `${(total / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * O nome com que um TEXTO é baixado.
 *
 * Uma entrada escrita não tem nome de arquivo, e baixar "download" sem
 * extensão obrigaria quem recebe a adivinhar o que é. O título do bloco é o
 * nome que essa pessoa reconhece; a barra e os dois-pontos saem porque o
 * sistema de arquivos dela não os aceita.
 */
export function nomeDeTexto(blockTitle: string, revision: number): string {
  const base = blockTitle.replace(/[\\/:*?"<>|]/g, "-").trim() || "bloco";
  return `${base} — revisão ${revision}.md`;
}

/**
 * O `Content-Disposition` de um nome que pode ter acento.
 *
 * O parâmetro `filename` só carrega ASCII; "Remuneração.pdf" viraria lixo ou
 * seria truncado no primeiro byte alto. O `filename*` da RFC 5987 leva o nome
 * inteiro, e o `filename` continua ali como reserva para quem não a implementa
 * — com os caracteres problemáticos trocados, nunca removidos em silêncio.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** O metadado. `content` e `body_text` ficam de fora de propósito. */
const METADADO = {
  id: bookEntryTable.id,
  blockKey: bookEntryTable.blockKey,
  blockCategory: bookEntryTable.blockCategory,
  blockTitle: bookEntryTable.blockTitle,
  kind: bookEntryTable.kind,
  revision: bookEntryTable.revision,
  filename: bookEntryTable.filename,
  mimeType: bookEntryTable.mimeType,
  byteSize: bookEntryTable.byteSize,
  contentSha256: bookEntryTable.contentSha256,
  note: bookEntryTable.note,
  createdBy: bookEntryTable.createdBy,
  createdAt: bookEntryTable.createdAt,
} as const;

/**
 * As primeiras linhas de um TEXTO, e se sobrou coisa depois delas.
 *
 * O corte é por caracteres e não por palavras porque a garantia que importa é
 * a do tamanho da resposta; `bodyTruncated` é o que impede a tela de exibir
 * meia frase como se fosse a regra inteira.
 */
const PREVIEW = {
  bodyPreview: sql<
    string | null
  >`left(${bookEntryTable.bodyText}, ${PREVIEW_CHARS})`,
  bodyTruncated: sql<boolean>`coalesce(length(${bookEntryTable.bodyText}) > ${PREVIEW_CHARS}, false)`,
} as const;

/**
 * A entrada vigente de cada bloco — a de maior revisão.
 *
 * `DISTINCT ON` faz isso numa varredura só. A alternativa comum (subconsulta
 * com `max(revision)` e junção de volta) lê a tabela duas vezes e é mais fácil
 * de errar quando o critério de desempate muda.
 */
router.get("/book/entries", async (req, res): Promise<void> => {
  const linhas = await db
    .selectDistinctOn([bookEntryTable.blockKey], {
      ...METADADO,
      ...PREVIEW,
      revisions: sql<number>`count(*) over (partition by ${bookEntryTable.blockKey})::int`,
    })
    .from(bookEntryTable)
    .orderBy(bookEntryTable.blockKey, desc(bookEntryTable.revision));

  res.json(linhas);
});

/**
 * Todas as revisões de um bloco, da mais nova para a mais velha, com o texto
 * inteiro de cada uma.
 *
 * `blockKey` vem na query e não no caminho porque a chave é
 * `"Categoria::Título"` — dois-pontos e acentos dentro de um segmento de URL
 * funcionam, mas atravessam proxies e logs com um número desnecessário de
 * chances de errar a decodificação.
 */
router.get("/book/entries/history", async (req, res): Promise<void> => {
  const blockKey = req.query.blockKey;
  if (typeof blockKey !== "string" || blockKey.trim() === "") {
    res.status(400).json({ error: "blockKey é obrigatório." });
    return;
  }

  const linhas = await db
    .select({ ...METADADO, bodyText: bookEntryTable.bodyText })
    .from(bookEntryTable)
    .where(eq(bookEntryTable.blockKey, blockKey.trim()))
    .orderBy(desc(bookEntryTable.revision));

  res.json(linhas);
});

router.post("/book/entries", async (req, res, next): Promise<void> => {
  const decoded = decodeBookEntry(req.body);
  if (!decoded.ok) {
    res.status(400).json({ error: decoded.error });
    return;
  }

  const entrada = decoded.value;

  try {
    const [atual] = await db
      .select({
        revision: bookEntryTable.revision,
        kind: bookEntryTable.kind,
        contentSha256: bookEntryTable.contentSha256,
        filename: bookEntryTable.filename,
      })
      .from(bookEntryTable)
      .where(eq(bookEntryTable.blockKey, entrada.blockKey))
      .orderBy(desc(bookEntryTable.revision))
      .limit(1);

    /*
      Reenviar exatamente o mesmo conteúdo não cria revisão.

      Sem isto, clicar duas vezes em Salvar produziria a revisão 2 idêntica à 1 —
      e o histórico do bloco passaria a sugerir que a regra mudou num dia em que
      ela não mudou. É a mesma defesa que `source_file` faz pelo sha256, pela
      mesma razão: o histórico só vale se cada linha dele significar alguma
      coisa. O tipo entra na comparação porque um texto e um arquivo com os
      mesmos bytes ainda são duas entradas diferentes.
    */
    if (
      atual &&
      atual.kind === entrada.kind &&
      atual.contentSha256 === entrada.contentSha256
    ) {
      res.status(200).json({
        unchanged: true,
        revision: atual.revision,
        message:
          entrada.kind === "DOCUMENTO"
            ? `Este arquivo é byte a byte igual ao que já está no bloco (revisão ${atual.revision}, "${atual.filename}"). Nada foi gravado.`
            : `O texto está igual ao da revisão ${atual.revision}. Nada foi gravado.`,
      });
      return;
    }

    const [gravado] = await db
      .insert(bookEntryTable)
      .values({
        blockKey: entrada.blockKey,
        blockCategory: entrada.blockCategory,
        blockTitle: entrada.blockTitle,
        kind: entrada.kind,
        revision: (atual?.revision ?? 0) + 1,
        filename: entrada.filename,
        content: entrada.content,
        bodyText: entrada.bodyText,
        mimeType: entrada.mimeType,
        byteSize: entrada.byteSize,
        contentSha256: entrada.contentSha256,
        note: entrada.note,
        createdBy: req.user!.email,
      })
      .returning(METADADO);

    req.log.info(
      {
        blockKey: entrada.blockKey,
        kind: entrada.kind,
        revision: gravado.revision,
      },
      "Book entry stored",
    );
    res.status(201).json(gravado);
  } catch (err) {
    /*
      23505 é o índice único de (block_key, revision): dois envios ao mesmo
      bloco no mesmo instante calcularam a mesma "próxima" revisão e o segundo
      perdeu. Um 500 aqui esconderia que reenviar resolve.
    */
    if (isUniqueViolation(err)) {
      req.log.warn(
        { blockKey: entrada.blockKey },
        "Concurrent book entry write",
      );
      res.status(409).json({
        error:
          "Outro envio para este bloco entrou no mesmo instante. Recarregue o bloco e envie de novo — nada foi perdido.",
      });
      return;
    }
    next(err);
  }
});

/**
 * O conteúdo, para baixar — arquivo ou texto.
 *
 * Os dois saem por aqui e sempre como anexo. Um TEXTO baixa como `.md` com o
 * nome do bloco: quem pede o conteúdo quer o arquivo, e não interessa a essa
 * pessoa que de um lado ele estava em `bytea` e do outro em `text`.
 */
router.get("/book/entries/:id/content", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "id inválido." });
    return;
  }

  const [entrada] = await db
    .select({
      kind: bookEntryTable.kind,
      blockTitle: bookEntryTable.blockTitle,
      revision: bookEntryTable.revision,
      filename: bookEntryTable.filename,
      mimeType: bookEntryTable.mimeType,
      content: bookEntryTable.content,
      bodyText: bookEntryTable.bodyText,
    })
    .from(bookEntryTable)
    .where(eq(bookEntryTable.id, id))
    .limit(1);

  if (!entrada) {
    res.status(404).json({ error: "Entrada não encontrada." });
    return;
  }

  /*
    O CHECK do banco garante que DOCUMENTO tem `content` e TEXTO tem
    `body_text`. O `??` existe para o TypeScript, que não lê constraint — e
    um Buffer vazio aqui seria um arquivo de 0 byte, não uma exceção
    silenciosa.
  */
  const bytes =
    entrada.kind === "DOCUMENTO"
      ? (entrada.content ?? Buffer.alloc(0))
      : Buffer.from(entrada.bodyText ?? "", "utf8");

  const nome =
    entrada.kind === "DOCUMENTO"
      ? (entrada.filename ?? "documento")
      : nomeDeTexto(entrada.blockTitle, entrada.revision);

  res.setHeader("Content-Type", entrada.mimeType);
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("Content-Disposition", contentDisposition(nome));
  /*
    O conteúdo vem de quem usa o sistema, e o tipo é deduzido da extensão que
    essa pessoa deu. `nosniff` impede o navegador de decidir por conta própria
    que aquilo é outra coisa — e a resposta sai sempre como anexo, nunca
    renderizada nesta origem.
  */
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
});

function isUniqueViolation(err: unknown): boolean {
  return codigoDoPostgres(err) === "23505";
}

/**
 * O erro que diz "a tabela deste recurso não existe neste banco".
 *
 * `42P01` é relação inexistente e `42704` é objeto inexistente — o segundo pega
 * o `book_entry_kind`, que é um tipo e não uma tabela. Os dois significam a
 * mesma coisa aqui: a migration `0008_book_entries` não rodou neste banco.
 *
 * A lista mora em `lib/schema-ausente.ts`, junto da resposta que ela decide.
 * Este nome fica porque é o vocabulário desta rota, e porque é por ele que os
 * testes perguntam.
 */
export function faltaOSchemaDoBook(err: unknown): boolean {
  return faltaSchema(err);
}

export default router;
