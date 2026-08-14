import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import * as XLSX from "xlsx";
import { eq, and, sql } from "drizzle-orm";
import {
  type Database,
  attributeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { excelSerialToDate, isPlausibleDateSerial } from "./excel-dates";
import { foldText, slugifyColumn } from "./workbook";

/**
 * Ler um export de chamados.
 *
 * A planilha de vigência é um cadastro com grão conhecido — uma linha por
 * ativo, colunas que já vimos antes — e por isso o pipeline dela pode exigir
 * `vigencia` e `placa` e recusar o que não tiver. O export de chamados não tem
 * essa sorte: cada fila do Freightech exporta com um recorte de colunas
 * diferente, e a mesma coisa se chama "Nº do chamado" numa e "Number" noutra.
 *
 * A resposta a isso não é adivinhar melhor em silêncio. É mapear o que se
 * reconhece, **escrever por que** se reconheceu, listar o que sobrou sem
 * destino, e guardar a linha inteira do arquivo em `payload` — de modo que um
 * mapeamento errado seja corrigível depois sem o arquivo original na mão.
 */

// ---------------------------------------------------------------------------
// Mapeamento de colunas
// ---------------------------------------------------------------------------

/** Os campos que sabemos preencher a partir de um export de chamados. */
export type TicketField =
  | "externalId"
  | "openedAt"
  | "closedAt"
  | "statusRaw"
  | "parameterLabel"
  | "entityLabel"
  | "entityType"
  | "requestedValueRaw"
  | "appliedValueRaw"
  | "requestedBy"
  | "subject";

/**
 * Os nomes por que cada campo já apareceu, em forma dobrada.
 *
 * A ordem das chaves é a ordem de disputa: quando dois campos aceitariam o
 * mesmo cabeçalho por aproximação, o primeiro daqui fica com ele. Por isso
 * `externalId` vem antes de tudo (é a coluna que não pode faltar) e `subject`
 * vem por último (é o campo mais vago, e o que menos custa perder).
 */
const ALIASES: Record<TicketField, string[]> = {
  externalId: [
    "chamado",
    "numero do chamado",
    "n do chamado",
    "no do chamado",
    "num chamado",
    "numero chamado",
    "codigo do chamado",
    "id do chamado",
    "protocolo",
    "ticket",
    "number",
    "incident",
  ],
  openedAt: [
    "abertura",
    "data de abertura",
    "data abertura",
    "aberto em",
    "criado em",
    "data de criacao",
    "opened",
    "opened at",
    "created",
    "created on",
  ],
  closedAt: [
    "fechamento",
    "data de fechamento",
    "data fechamento",
    "encerrado em",
    "fechado em",
    "conclusao",
    "data de conclusao",
    "resolvido em",
    "closed",
    "closed at",
    "resolved",
  ],
  statusRaw: ["status", "situacao", "estado do chamado", "state", "andamento"],
  parameterLabel: [
    "parametro",
    "atributo",
    "campo",
    "variavel",
    "coluna",
    "item alterado",
    "parametro alterado",
  ],
  entityLabel: ["placa", "equipamento", "ativo", "veiculo", "frota"],
  entityType: [
    "tipo de equipamento",
    "tipo do equipamento",
    "tipo de ativo",
    "tipo do ativo",
    "tipo de veiculo",
  ],
  requestedValueRaw: [
    "valor pedido",
    "valor solicitado",
    "valor requisitado",
    "valor pleiteado",
    "valor proposto",
    "solicitado",
    "pedido",
  ],
  appliedValueRaw: [
    "valor aplicado",
    "valor atendido",
    "valor aprovado",
    "valor concedido",
    "valor deferido",
    "valor final",
    "aplicado",
    "atendido",
  ],
  requestedBy: [
    "solicitante",
    "requisitante",
    "aberto por",
    "responsavel",
    "usuario",
    "opened by",
    "requester",
  ],
  subject: [
    "assunto",
    "descricao",
    "titulo",
    "resumo",
    "observacao",
    "observacoes",
    "justificativa",
    "short description",
    "description",
  ],
};

const FIELDS = Object.keys(ALIASES) as TicketField[];

/**
 * Um cabeçalho dobrado para comparação.
 *
 * `foldText` tira os acentos, e isso não basta aqui: "Nº do chamado" é como
 * meio Brasil escreve essa coluna, e o indicador ordinal (`º`, `°`) não é uma
 * letra acentuada — sobrevive à decomposição e faz o cabeçalho mais comum de
 * todos deixar de casar com qualquer nome conhecido. O ponto de "N. do
 * chamado" some pelo mesmo motivo.
 */
function foldHeader(header: string): string {
  return foldText(header)
    .replace(/[º°]/g, "o")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Como um campo foi ligado a uma coluna — vai para a tela, não para o log. */
export interface ColumnBinding {
  /** O cabeçalho como estava escrito no arquivo. */
  header: string;
  /** Índice da coluna, 0-based. */
  index: number;
  /** `exato` quando o cabeçalho é um dos nomes conhecidos; `aproximado` quando o contém. */
  match: "exato" | "aproximado";
  reason: string;
}

export interface ColumnPlan {
  bindings: Partial<Record<TicketField, ColumnBinding>>;
  /** Cabeçalhos que nenhum campo reclamou. Continuam inteiros em `payload`. */
  unmapped: string[];
}

/**
 * Decidir que coluna é que campo, em duas passadas.
 *
 * A primeira passada só aceita igualdade: "Status" é `statusRaw` sem discussão.
 * A segunda aceita conter — "Data de abertura do chamado" contém "abertura" —,
 * e é onde os enganos moram, então cada ligação carrega a frase que a
 * justifica. Uma coluna já tomada não é disputada de novo: sem isso, um arquivo
 * com "Valor pedido" e "Valor aplicado" veria os dois casarem com `pedido` e
 * `aplicado` ao mesmo tempo por aproximação, e o segundo campo ficaria vazio
 * apontando para a coluna do primeiro.
 */
export function planTicketColumns(headers: (string | null)[]): ColumnPlan {
  const bindings: Partial<Record<TicketField, ColumnBinding>> = {};
  const taken = new Set<number>();

  const candidates = headers
    .map((header, index) => ({
      header,
      index,
      folded: header ? foldHeader(header) : "",
    }))
    .filter((c): c is { header: string; index: number; folded: string } =>
      Boolean(c.header && c.folded),
    );

  for (const field of FIELDS) {
    const hit = candidates.find(
      (c) => !taken.has(c.index) && ALIASES[field].includes(c.folded),
    );
    if (!hit) continue;
    bindings[field] = {
      header: hit.header,
      index: hit.index,
      match: "exato",
      reason: `o cabeçalho "${hit.header}" é exatamente um dos nomes conhecidos deste campo`,
    };
    taken.add(hit.index);
  }

  for (const field of FIELDS) {
    if (bindings[field]) continue;
    let found: { c: (typeof candidates)[number]; alias: string } | undefined;
    for (const c of candidates) {
      if (taken.has(c.index)) continue;
      // O alias mais longo primeiro: "valor aplicado" antes de "aplicado",
      // para o cabeçalho casar com o nome mais específico que o descreve.
      const alias = [...ALIASES[field]]
        .sort((a, b) => b.length - a.length)
        .find((a) => c.folded.includes(a));
      if (alias) {
        found = { c, alias };
        break;
      }
    }
    if (!found) continue;
    bindings[field] = {
      header: found.c.header,
      index: found.c.index,
      match: "aproximado",
      reason: `o cabeçalho "${found.c.header}" contém "${found.alias}"`,
    };
    taken.add(found.c.index);
  }

  return {
    bindings,
    unmapped: candidates.filter((c) => !taken.has(c.index)).map((c) => c.header),
  };
}

// ---------------------------------------------------------------------------
// Leitura de valores
// ---------------------------------------------------------------------------

/**
 * Texto para número, sem inventar zero.
 *
 * Um export de chamados escreve dinheiro de todos os jeitos: `R$ 1.234,56`,
 * `1234.56`, `(120,00)` para negativo, e `sob análise` para "ainda não tem
 * valor". Só o que é inequivocamente numérico vira número; o resto volta
 * `null` e continua legível em `*_raw`, porque "sob análise" virando `0` seria
 * exatamente o erro que este produto existe para pegar.
 *
 * **O separador decimal.** Com vírgula e ponto presentes, o que aparece por
 * último é o decimal (`1.234,56` e `1,234.56` são a mesma quantia). Com um só
 * dos dois, ele é decimal — exceto quando é um ponto seguido de exatamente
 * três dígitos (`1.234`), que numa fonte brasileira é milhar.
 */
export function parseTicketNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;

  let text = raw.trim();
  if (text === "") return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text
    .replace(/ /g, " ")
    .replace(/^R\$\s*/i, "")
    .replace(/\s*(BRL|reais)$/i, "")
    .trim();

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }

  // Qualquer coisa fora de dígitos e separadores é texto, não número.
  if (!/^[\d.,]+$/.test(text)) return null;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    normalized = text.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    // Vírgula é decimal aqui. Várias vírgulas só acontecem em milhar à
    // americana (`1,234,567`), e aí nenhuma delas é decimal.
    normalized =
      text.split(",").length > 2
        ? text.split(",").join("")
        : text.replace(",", ".");
  } else if (lastDot >= 0) {
    const parts = text.split(".");
    const isThousands =
      parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    normalized = isThousands ? parts.join("") : text;
  } else {
    normalized = text;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** `dd/mm/aaaa`, ISO, ou o serial do Excel. O que não for nenhum dos três volta null. */
export function parseTicketDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number") {
    return isPlausibleDateSerial(raw) ? excelSerialToDate(raw) : null;
  }
  if (typeof raw !== "string") return null;

  const text = raw.trim();
  if (text === "") return null;

  const br = text.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (br) {
    const [, d, m, y, hh = "0", mm = "0", ss = "0"] = br;
    const date = new Date(
      Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = text.match(/^\d{4}-\d{2}-\d{2}([ T].*)?$/);
  if (iso) {
    const date = new Date(text.includes("T") ? text : text.replace(" ", "T") + "Z");
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/** As caixas em que a tela agrupa os status que a fonte inventa. */
export const STATUS_BUCKETS = [
  "ABERTO",
  "EM_ANDAMENTO",
  "ATENDIDO",
  "RECUSADO",
  "CANCELADO",
  "DESCONHECIDO",
] as const;

export type StatusBucket = (typeof STATUS_BUCKETS)[number];

/**
 * O status escrito, dobrado numa caixa.
 *
 * A ordem de teste não é decorativa: "não atendido" e "cancelado" precisam ser
 * decididos antes de `ATENDIDO`, senão a negação vira o oposto do que diz. O
 * texto original nunca é substituído — fica em `status_raw`, e é ele que a
 * tabela mostra.
 */
export function normalizeStatus(raw: unknown): StatusBucket {
  if (typeof raw !== "string") return "DESCONHECIDO";
  const s = foldText(raw);
  if (s === "") return "DESCONHECIDO";

  const has = (...words: string[]) => words.some((w) => s.includes(w));

  // Negações primeiro: "nao atendido" não é atendido.
  if (/\bnao\b/.test(s) && has("atendido", "aprovado", "aplicado", "deferido")) {
    return "RECUSADO";
  }
  if (has("cancelad", "canceled", "cancelled")) return "CANCELADO";
  if (has("recusad", "negad", "rejeitad", "rejected", "indeferid", "reprovad")) {
    return "RECUSADO";
  }
  if (
    has(
      "atendido",
      "concluid",
      "resolvid",
      "finalizad",
      "encerrad",
      "fechado",
      "closed",
      "aprovad",
      "deferid",
      "aplicad",
      "completo",
    )
  ) {
    return "ATENDIDO";
  }
  if (has("andamento", "atendimento", "analise", "progress", "processand", "tratativa")) {
    return "EM_ANDAMENTO";
  }
  if (has("aberto", "abertura", "novo", "new", "open", "pendente", "aguardand", "fila")) {
    return "ABERTO";
  }
  return "DESCONHECIDO";
}

/** Impacto de um chamado: o que voltou menos o que se pediu. */
export interface TicketImpact {
  amount: number | null;
  confidence: "CALCULATED" | "NOT_CALCULABLE";
  reason: string;
}

/**
 * A mesma porta que a aba Planilha usa, com a régua deste lado.
 *
 * O impacto de um chamado é `aplicado − pedido`: negativo quer dizer que voltou
 * menos do que se pediu. Ele só é apurado quando o chamado **já foi atendido**
 * — enquanto está em andamento o valor aplicado ainda pode mudar, e um número
 * que muda sozinho na tela é pior do que nenhum. O motivo da recusa é sempre
 * escrito, porque "não calculável" sem explicação é o mesmo que esconder.
 */
export function computeTicketImpact(
  requested: number | null,
  applied: number | null,
  bucket: StatusBucket,
  requestedRaw: string | null,
  appliedRaw: string | null,
): TicketImpact {
  if (requested === null) {
    return {
      amount: null,
      confidence: "NOT_CALCULABLE",
      reason:
        requestedRaw && requestedRaw.trim() !== ""
          ? `o valor pedido ("${requestedRaw}") não é um número`
          : "o arquivo não trouxe valor pedido para este chamado",
    };
  }
  if (applied === null) {
    return {
      amount: null,
      confidence: "NOT_CALCULABLE",
      reason:
        appliedRaw && appliedRaw.trim() !== ""
          ? `o valor aplicado ("${appliedRaw}") não é um número`
          : "o arquivo não trouxe valor aplicado para este chamado",
    };
  }
  if (bucket !== "ATENDIDO") {
    return {
      amount: null,
      confidence: "NOT_CALCULABLE",
      reason:
        "o chamado ainda não foi atendido; enquanto isso o valor aplicado pode mudar",
    };
  }
  return {
    amount: applied - requested,
    confidence: "CALCULATED",
    reason: "aplicado menos pedido, com o chamado já atendido",
  };
}

// ---------------------------------------------------------------------------
// Leitura do arquivo
// ---------------------------------------------------------------------------

export interface TicketSheet {
  sheetName: string;
  headers: (string | null)[];
  /** Uma entrada por linha de dados, com o índice físico 1-based. */
  rows: { rowIndex: number; cells: unknown[] }[];
}

/**
 * O conteúdo do arquivo, pelo caminho que preserva os acentos.
 *
 * Um `.xlsx` é um zip e entra como bytes: ali uma data é uma data no próprio
 * formato, sem ambiguidade, e um número é um número.
 *
 * Um `.csv` é texto, e por isso entra por outro caminho — dois defeitos moram
 * nessa diferença, e os dois produzem número errado com cara de certo:
 *
 * 1. **Codificação.** Entregue como bytes, o leitor adivinha e erra para o
 *    lado legado: "Relatório" vira "RelatÃ³rio". Não é cosmético — os nomes de
 *    coluna são casados por texto, e um cabeçalho com acento corrompido deixa
 *    de ser reconhecido. Daí a decodificação explícita, UTF-8 com recuo para
 *    latin1 quando o arquivo não é UTF-8 válido.
 *
 * 2. **Adivinhação de tipo.** `01/07/2026` é 1º de julho em qualquer export
 *    brasileiro, e o leitor o converte para 7 de janeiro — enquanto deixa
 *    `20/07/2026` como texto, porque 20 não pode ser mês. O mesmo vale para
 *    `1.500,50`, que ele lê como um e meio. Por isso `raw: true`: o texto
 *    chega como texto, e quem o interpreta é `parseTicketDate` e
 *    `parseTicketNumber`, que sabem em que país estamos.
 */
function loadWorkbook(filePath: string): XLSX.WorkBook {
  const bytes = readFileSync(filePath);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    return XLSX.read(bytes, { type: "buffer", cellDates: true });
  }

  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // U+FFFD é o que o decodificador põe no lugar do byte que não soube ler:
  // sinal de que o arquivo não era UTF-8, e aí latin1 é o outro palpite
  // razoável para um export brasileiro.
  if (text.includes("�")) {
    text = new TextDecoder("latin1").decode(bytes);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  return XLSX.read(text, { type: "string", raw: true });
}

/**
 * A aba de chamados do arquivo, com a linha de cabeçalho encontrada.
 *
 * `.xlsx` e `.csv` entram pelo mesmo leitor — um export de fila costuma vir em
 * CSV, e recusá-lo obrigaria quem opera a abrir e salvar de novo no Excel só
 * para nos agradar.
 *
 * **Achar o cabeçalho.** Ele não está fixado na primeira linha: os exports do
 * Freightech começam com o título do relatório e a data de extração. Mas a
 * primeira linha que *mencione* um chamado também não serve — o título
 * "Relatório de chamados" menciona, e tomá-lo por cabeçalho faz o arquivo
 * inteiro virar dado sob nomes de coluna que não existem. Vence a linha que
 * reconhece **mais campos**, entre as que têm ao menos duas colunas
 * preenchidas e uma delas identificando o chamado. Um casamento exato vale
 * mais que dez aproximados, para que um arquivo bem formado nunca seja
 * derrotado por uma linha de ruído mais comprida.
 */
export function readTicketWorkbook(filePath: string): TicketSheet {
  const workbook = loadWorkbook(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("O arquivo não tem nenhuma aba legível.");
  }
  // `blankrows: true` é o que mantém o índice do array igual à linha física do
  // arquivo. Com ele desligado uma linha em branco no meio encurta a grade, e
  // todo `source_row_index` gravado depois dela aponta para a linha errada —
  // logo o número que a tela mostra como "linha N do arquivo, como veio".
  // As linhas vazias saem depois, já com o índice certo em mãos.
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    blankrows: true,
    defval: null,
    raw: true,
  });

  const HEADER_SEARCH_DEPTH = 15;
  const headersOf = (cells: unknown[]) =>
    cells.map((c) => (typeof c === "string" && c.trim() !== "" ? c.trim() : null));

  let headerRow = -1;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, HEADER_SEARCH_DEPTH); i++) {
    const headers = headersOf(grid[i] ?? []);
    // Uma coluna só não é cabeçalho: é o título do relatório, e é justamente
    // ele que costuma conter a palavra "chamados".
    if (headers.filter(Boolean).length < 2) continue;

    const plan = planTicketColumns(headers);
    if (!plan.bindings.externalId) continue;

    const score =
      Object.keys(plan.bindings).length +
      (plan.bindings.externalId.match === "exato" ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      headerRow = i;
    }
  }
  if (headerRow === -1) {
    throw new Error(
      'Não achei a coluna do número do chamado neste arquivo. O export precisa ter uma coluna chamada "Chamado", "Nº do chamado", "Protocolo" ou equivalente — é ela que identifica cada linha.',
    );
  }

  const headers = headersOf(grid[headerRow] ?? []);

  const rows = grid
    .slice(headerRow + 1)
    .map((cells, offset) => ({
      rowIndex: headerRow + offset + 2, // 1-based, cabeçalho já contado
      cells: cells ?? [],
    }))
    .filter((r) => r.cells.some((c) => c !== null && String(c).trim() !== ""));

  return { sheetName, headers, rows };
}

// ---------------------------------------------------------------------------
// Receber e ler
// ---------------------------------------------------------------------------

export interface ReceiveTicketResult {
  ticketImportId: string;
  isDuplicate: boolean;
  contentSha256: string;
}

export interface ReceiveTicketOptions {
  filePath: string;
  filename?: string;
  receivedBy?: string;
  /** Reprocessar um conteúdo já recebido. O padrão recusa. */
  allowReprocess?: boolean;
}

/**
 * Registrar o arquivo e abrir a leitura.
 *
 * A duplicata é recusada, e a recusa é gravada: uma tentativa é um evento que
 * vale registrar, e a tela de importações mostra as duas coisas. A regra é a
 * mesma de `receiveFile` — só a leitura por trás é que é outra.
 */
export async function receiveTicketFile(
  db: Database,
  options: ReceiveTicketOptions,
): Promise<ReceiveTicketResult> {
  const bytes = readFileSync(options.filePath);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = options.filename ?? options.filePath.split("/").pop()!;

  const [existing] = await db
    .select({ id: ticketImportTable.id })
    .from(ticketImportTable)
    .where(
      and(
        eq(ticketImportTable.contentSha256, contentSha256),
        eq(ticketImportTable.status, "READ"),
      ),
    );

  const isDuplicate = Boolean(existing) && !options.allowReprocess;

  const [created] = await db
    .insert(ticketImportTable)
    .values({
      filename,
      contentSha256,
      byteSize: statSync(options.filePath).size,
      storagePath: options.filePath,
      receivedBy: options.receivedBy ?? null,
      status: isDuplicate ? "SKIPPED_DUPLICATE" : "PENDING",
      finishedAt: isDuplicate ? new Date() : null,
      failureReason: isDuplicate
        ? `Este arquivo de chamados já havia sido lido (sha256 ${contentSha256.slice(0, 16)}…). Nada foi reprocessado: o conteúdo é idêntico, byte a byte, ao de um envio anterior.`
        : null,
    })
    .returning();

  return { ticketImportId: created.id, isDuplicate, contentSha256 };
}

export interface ReadTicketsResult {
  ticketImportId: string;
  rowCount: number;
  ticketCount: number;
  ignoredRowCount: number;
  unmappedColumns: string[];
  columnMapping: Partial<Record<TicketField, ColumnBinding>>;
}

/**
 * Ler o arquivo recebido e gravar um chamado por linha.
 *
 * É o passo inteiro: não há staging nem promoção, porque não há decisão humana
 * no meio — nada aqui entra na camada canônica nem soma com a comparação de
 * vigências. O que existe é a conta de conservação: `row_count` linhas
 * entraram, `ticket_count` viraram chamado, `ignored_row_count` não tinham
 * número e ficaram de fora. As três aparecem na tela; a soma tem de fechar.
 */
export async function readTicketImport(
  db: Database,
  ticketImportId: string,
): Promise<ReadTicketsResult> {
  const [run] = await db
    .select()
    .from(ticketImportTable)
    .where(eq(ticketImportTable.id, ticketImportId));
  if (!run) throw new Error(`Envio de chamados ${ticketImportId} não encontrado.`);
  if (!run.storagePath) {
    throw new Error(
      `O arquivo de ${run.filename} não está mais em disco; não há o que reler.`,
    );
  }

  await db
    .update(ticketImportTable)
    .set({ status: "READING" })
    .where(eq(ticketImportTable.id, ticketImportId));

  const sheet = readTicketWorkbook(run.storagePath);
  const plan = planTicketColumns(sheet.headers);
  if (!plan.bindings.externalId) {
    throw new Error(
      "Achei o cabeçalho mas não a coluna do número do chamado. Sem ela não há como identificar cada linha.",
    );
  }

  const codes = await resolveAttributeCodes(db);
  const at = (cells: unknown[], field: TicketField): unknown => {
    const binding = plan.bindings[field];
    return binding ? (cells[binding.index] ?? null) : null;
  };
  const text = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const s = value instanceof Date ? value.toISOString() : String(value).trim();
    return s === "" ? null : s;
  };

  const values: (typeof ticketTable.$inferInsert)[] = [];
  let ignored = 0;

  for (const row of sheet.rows) {
    const externalId = text(at(row.cells, "externalId"));
    if (!externalId) {
      // Linha sem número de chamado não é chamado. Fica contada, e a linha
      // continua no arquivo — nunca some sem aparecer numa conta.
      ignored++;
      continue;
    }

    const requestedRaw = text(at(row.cells, "requestedValueRaw"));
    const appliedRaw = text(at(row.cells, "appliedValueRaw"));
    const requested = parseTicketNumber(at(row.cells, "requestedValueRaw"));
    const applied = parseTicketNumber(at(row.cells, "appliedValueRaw"));
    const statusRaw = text(at(row.cells, "statusRaw"));
    const bucket = normalizeStatus(statusRaw);
    const impact = computeTicketImpact(
      requested,
      applied,
      bucket,
      requestedRaw,
      appliedRaw,
    );
    const parameterLabel = text(at(row.cells, "parameterLabel"));

    const payload: Record<string, unknown> = {};
    sheet.headers.forEach((header, index) => {
      if (!header) return;
      const cell = row.cells[index];
      payload[header] =
        cell instanceof Date ? cell.toISOString() : (cell ?? null);
    });

    values.push({
      ticketImportId,
      externalId,
      openedAt: parseTicketDate(at(row.cells, "openedAt")),
      closedAt: parseTicketDate(at(row.cells, "closedAt")),
      statusRaw,
      statusBucket: bucket,
      parameterLabel,
      attributeCode: parameterLabel ? matchAttributeCode(codes, parameterLabel) : null,
      entityLabel: text(at(row.cells, "entityLabel")),
      entityType: text(at(row.cells, "entityType")),
      requestedValueRaw: requestedRaw,
      requestedValueNumeric: requested === null ? null : String(requested),
      appliedValueRaw: appliedRaw,
      appliedValueNumeric: applied === null ? null : String(applied),
      impactAmount: impact.amount === null ? null : String(impact.amount),
      impactConfidence: impact.confidence,
      impactReason: impact.reason,
      requestedBy: text(at(row.cells, "requestedBy")),
      subject: text(at(row.cells, "subject")),
      sourceRowIndex: row.rowIndex,
      payload,
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db
      .insert(ticketTable)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoNothing();
  }

  await db
    .update(ticketImportTable)
    .set({
      status: "READ",
      finishedAt: new Date(),
      rowCount: sheet.rows.length,
      ticketCount: values.length,
      ignoredRowCount: ignored,
      columnMapping: plan.bindings,
      unmappedColumns: plan.unmapped,
    })
    .where(eq(ticketImportTable.id, ticketImportId));

  return {
    ticketImportId,
    rowCount: sheet.rows.length,
    ticketCount: values.length,
    ignoredRowCount: ignored,
    unmappedColumns: plan.unmapped,
    columnMapping: plan.bindings,
  };
}

/** Marca o envio como falho, com o motivo à vista de quem opera. */
export async function markTicketImportFailed(
  db: Database,
  ticketImportId: string,
  reason: string,
): Promise<void> {
  await db
    .update(ticketImportTable)
    .set({ status: "FAILED", finishedAt: new Date(), failureReason: reason })
    .where(eq(ticketImportTable.id, ticketImportId));
}

// ---------------------------------------------------------------------------
// Ligação com o dicionário
// ---------------------------------------------------------------------------

/**
 * O dicionário de atributos, indexado pelas formas em que um chamado o citaria.
 *
 * A ligação é uma conveniência de navegação — permite à tela dizer "este
 * chamado fala do mesmo parâmetro daquela alteração" —, e por isso ela falha
 * para `null` em silêncio em vez de recusar a linha. Um chamado sobre um
 * parâmetro que ainda não está no dicionário continua sendo um chamado.
 */
async function resolveAttributeCodes(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({
      code: attributeTable.code,
      sourceName: attributeTable.sourceName,
      displayName: attributeTable.displayName,
    })
    .from(attributeTable);

  const index = new Map<string, string>();
  for (const row of rows) {
    for (const name of [row.sourceName, row.displayName]) {
      if (!name) continue;
      const key = slugifyColumn(name);
      if (key && !index.has(key)) index.set(key, row.code);
    }
    // O próprio código sem o prefixo do equipamento: "cavalo.pneu" também é
    // citado como "pneu" num chamado.
    const bare = row.code.includes(".") ? row.code.split(".").slice(1).join(".") : row.code;
    if (bare && !index.has(bare)) index.set(bare, row.code);
  }
  return index;
}

function matchAttributeCode(index: Map<string, string>, label: string): string | null {
  return index.get(slugifyColumn(label)) ?? null;
}
