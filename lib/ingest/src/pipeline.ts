import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  aplicarConfirmacoesCanonicas,
  garantirSemanticaInicial,
  garantirClasseDeCustoPadrao,
  garantirTaxonomiaCanonica,
  attributeAliasTable,
  attributeTable,
  columnMappingTable,
  entityIdentifierTable,
  entityTable,
  factTable,
  importDecisionTable,
  importRunTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  scopeTable,
  sentinelRuleTable,
  snapshotAttributeTable,
  snapshotEntityTypeTable,
  snapshotMergeTable,
  snapshotScopeTable,
  snapshotTable,
  sourceFileTable,
  stagedFactTable,
  validationIssueTable,
} from "@workspace/db";
import {
  columnLetter,
  deriveEntityType,
  foldText,
  readCell,
  readWorkbook,
  sheetRange,
  slugifyColumn,
  type SheetPlan,
} from "./workbook";
import {
  classifyEntityType,
  conferirDeclaracao,
  novasIdentidades,
  type IdentityDecision,
  type KnownEntityType,
} from "./identity";
import { parseVigenciaLabel } from "./vigencia";
import {
  canonicalPayloadHash,
  canonicalScopeOf,
  canonicalSnapshotKey,
  datasetFamilyOfSet,
  missingRequiredScopeTypes,
  normalizeChannel,
  normalizeIdentifier,
  type CanonicalFact,
  type ScopeEntry,
} from "./canonical-identity";
import { typeCell, type SentinelRule, type SourceCell } from "./values";
import {
  COLUNA_DE_VIGENCIA,
  COLUNAS_IDENTIFICADORAS,
  identificadorNoCabecalho,
  tipoDeImportacao,
  type DefinicaoDeTipo,
} from "./tipos";

/**
 * F1 — ingestion.
 *
 * The pipeline is deliberately five explicit steps rather than one call:
 * receive, capture RAW, stage, preview, promote. A human decision sits
 * between preview and promote, and promote is the only step that touches the
 * canonical layer — inside a single transaction.
 */

/**
 * As colunas que viram estrutura em vez de fato.
 *
 * A vigência é de todo tipo; o identificador é **do** tipo — placa no cavalo e
 * na carreta, `chaveTrecho` no trecho —, e por isso ele vem de `tipos.ts`, onde
 * mora junto do tipo a que pertence. Ver a nota de `COLUNA_DE_GRAO_UNIVERSAL`
 * em `workbook.ts` para o que a regra antiga custava.
 */
const GRAIN_COLUMNS = {
  vigencia: COLUNA_DE_VIGENCIA,
} as const;

const IDENTIFICADORES_FOLDED = new Set(
  COLUNAS_IDENTIFICADORAS.map((coluna) => coluna.folded),
);

/** Organisational scope carried by every source row. */
const SCOPE_COLUMNS: Record<string, { scopeType: string; nameColumn?: string }> =
  {
    "unidade - cnpj": { scopeType: "UNIDADE", nameColumn: "unidade - nome" },
    "operador - cnpj": { scopeType: "OPERADOR", nameColumn: "operador - nome" },
    "unidade - regional": { scopeType: "REGIONAL" },
  };

/**
 * Values that look like "not applicable" but have no confirmed rule yet.
 * Their only effect is a warning: blanking them without confirmation would
 * quietly change every average computed downstream.
 */
const SUSPECTED_SENTINELS = ["-1"];

/**
 * Os problemas que impedem promover, por código.
 *
 * A lista é curta de propósito. Um ERRO de leitura — linha sem placa, rótulo de
 * vigência ilegível — recusa aquela linha e deixa o resto entrar, que é o
 * comportamento que o produto sempre teve e que mantém um arquivo de 40 mil
 * células útil quando três linhas estão sujas. O que entra aqui é só o que não
 * tem resposta certa possível.
 */
const BLOQUEIAM_PROMOCAO = new Set([
  "ENTIDADE_DUPLICADA_CONFLITANTE",
  "TIPO_DIVERGE_DA_DECLARACAO",
]);

/**
 * O motivo que fica gravado quando a pré-visualização recusa a promoção.
 *
 * Era uma frase fixa, escrita para o único impedimento que existia: a mesma
 * entidade duas vezes na mesma vigência com valores diferentes. Com a
 * conferência do tipo declarado passaram a ser dois, e repetir a frase da
 * duplicidade em cima de uma divergência de tipo mandaria corrigir o que não
 * está errado. Cada impedimento escreve o seu, e o da divergência sai do
 * próprio problema — `sample` é a mensagem que a staging gravou.
 */
function motivoDoImpedimento(
  impeditivas: { code: string; count: number; sample: string }[],
): string {
  const frases = impeditivas.map((issue) => {
    if (issue.code === "ENTIDADE_DUPLICADA_CONFLITANTE") {
      return (
        `${issue.count} ${issue.count === 1 ? "conflito impede" : "conflitos impedem"} esta importação: ` +
        `a mesma entidade aparece mais de uma vez na mesma vigência com valores diferentes. ` +
        `Corrija a origem e envie o arquivo de novo.`
      );
    }
    if (issue.code === "TIPO_DIVERGE_DA_DECLARACAO") {
      return (
        `${issue.sample} Nada foi importado: envie o arquivo pela aba do tipo certo, ` +
        `ou confira se este é mesmo o arquivo que você queria enviar.`
      );
    }
    return issue.sample;
  });
  return frases.join(" ");
}

/** Postgres caps a statement at 65535 bound parameters. */
const INSERT_CHUNK = 1_000;

async function insertChunked<T extends Record<string, unknown>>(
  db: Database,
  table: Parameters<Database["insert"]>[0],
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    await db
      .insert(table)
      .values(rows.slice(i, i + INSERT_CHUNK) as never)
      .execute();
  }
}

async function insertChunkedReturning<
  T extends Record<string, unknown>,
  R extends Record<string, unknown>,
>(
  db: Database,
  table: Parameters<Database["insert"]>[0],
  rows: T[],
  returning: R,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const batch = await db
      .insert(table)
      .values(rows.slice(i, i + INSERT_CHUNK) as never)
      .returning(returning as never);
    out.push(...(batch as Record<string, unknown>[]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Step 1 — receive
// ---------------------------------------------------------------------------

export interface ReceiveResult {
  sourceFileId: string;
  importRunId: string;
  /** True when these exact bytes were already received before. */
  isDuplicate: boolean;
  contentSha256: string;
}

export interface ReceiveOptions {
  filePath: string;
  filename?: string;
  receivedBy?: string;
  /**
   * Re-derive from a file already on record. The default refuses, so an
   * accidental re-upload can never duplicate anything.
   */
  allowReprocess?: boolean;
  /**
   * O tipo que quem envia declarou — a aba da tela em que ele escolheu enviar.
   *
   * Opcional, e o que ele muda é a *conferência*, não a dedução: a staging
   * continua classificando cada aba pelo conteúdo dela, e compara as duas
   * respostas. Ausente, tudo se passa como antes. Ver {@link conferirDeclaracao}.
   */
  declaredType?: string | null;
}

/**
 * A declaração conferida antes de qualquer coisa acontecer.
 *
 * Duas recusas, e as duas antes de gravar: um código que não é tipo nenhum
 * (cliente desatualizado, endereço montado à mão) e um tipo que o pipeline
 * ainda não sabe ingerir — o QLP de hoje. A segunda é a que importa, e o motivo
 * dela é longo de propósito: aceitar o arquivo o faria entrar e não produzir
 * fato nenhum, com zero erro e zero aviso, que foi exatamente o que aconteceu
 * com a primeira planilha de trecho.
 */
export function exigirTipoDeclarado(declaredType: string): DefinicaoDeTipo {
  const tipo = tipoDeImportacao(declaredType);
  if (tipo === null) {
    throw new Error(
      `"${declaredType}" não é um tipo de importação conhecido. Escolha uma das abas da tela de Importações.`,
    );
  }
  if (tipo.aindaNaoEntra !== null) {
    throw new Error(`${tipo.rotulo} ainda não pode ser importado. ${tipo.aindaNaoEntra}`);
  }
  return tipo;
}

/**
 * Register a file and open a processing attempt.
 *
 * SHA-256 is the first line of idempotency defence; the snapshot business key
 * (see {@link promote}) is the second, and catches the case where the same
 * vigência arrives inside a differently-encoded file.
 */
export async function receiveFile(
  db: Database,
  options: ReceiveOptions,
): Promise<ReceiveResult> {
  // Antes de ler os bytes: um tipo recusado não deve deixar rastro de arquivo.
  const declarado =
    options.declaredType == null || options.declaredType.trim() === ""
      ? null
      : exigirTipoDeclarado(options.declaredType);

  const bytes = readFileSync(options.filePath);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = options.filename ?? options.filePath.split("/").pop()!;

  // Tentar gravar primeiro, e deduzir a duplicata de *não ter gravado*.
  //
  // Antes eram um SELECT e um INSERT separados, sem transação. Dois envios
  // simultâneos do mesmo arquivo liam "não existe" os dois, os dois inseriam, e
  // o perdedor recebia 23505 do índice único — que ninguém tratava, e virava
  // 500. O banco nunca duplicou a linha; o que estava errado era a resposta.
  //
  // `ON CONFLICT DO NOTHING` faz o próprio banco decidir quem ganha, num
  // comando só: quem gravou recebe a linha de volta, quem não gravou recebe
  // nada e relê. Não há janela entre verificar e gravar, porque não há
  // verificação.
  const [created] = await db
    .insert(sourceFileTable)
    .values({
      filename,
      contentSha256,
      byteSize: statSync(options.filePath).size,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      storagePath: options.filePath,
      receivedBy: options.receivedBy ?? null,
    })
    .onConflictDoNothing({ target: sourceFileTable.contentSha256 })
    .returning();

  let sourceFileId: string;
  let isDuplicate: boolean;

  if (created) {
    sourceFileId = created.id;
    isDuplicate = false;
  } else {
    const [existing] = await db
      .select()
      .from(sourceFileTable)
      .where(eq(sourceFileTable.contentSha256, contentSha256));
    if (!existing) {
      // Não gravou e não encontra: o conflito foi com outra coisa que não o
      // sha, e engolir isso como "duplicata" esconderia um defeito real.
      throw new Error(
        `Não foi possível registrar o arquivo ${filename} (sha256 ${contentSha256.slice(0, 16)}…): a gravação foi recusada e nenhum registro anterior com esse conteúdo existe.`,
      );
    }
    sourceFileId = existing.id;
    isDuplicate = true;
  }

  // The attempt is recorded either way: a refused duplicate is an event worth
  // keeping, not a silent no-op.
  const [run] = await db
    .insert(importRunTable)
    .values({
      sourceFileId,
      status: isDuplicate && !options.allowReprocess ? "SKIPPED_DUPLICATE" : "PENDING",
      triggeredBy: options.receivedBy ?? null,
      failureReason:
        isDuplicate && !options.allowReprocess
          ? // Este texto vai direto para a tela de Importações, então é escrito
            // para quem opera, não para quem depura. O sha abreviado é o mesmo
            // que o card exibe, para o operador conseguir casar os dois.
            `Este arquivo já havia sido recebido (sha256 ${contentSha256.slice(0, 16)}…). Nada foi reprocessado: o conteúdo é idêntico, byte a byte, ao de uma importação anterior.`
          : null,
      finishedAt:
        isDuplicate && !options.allowReprocess ? new Date() : null,
      declaredType: declarado?.code ?? null,
    })
    .returning();

  await db.insert(importDecisionTable).values({
    importRunId: run.id,
    decisao: isDuplicate && !options.allowReprocess ? "DUPLICATA_DE_ARQUIVO" : "RECEBIDO",
    motivo:
      isDuplicate && !options.allowReprocess
        ? `Arquivo idêntico, byte a byte, a um já recebido (sha256 ${contentSha256.slice(0, 16)}…). Nada foi reprocessado.`
        : `Arquivo recebido e registrado (sha256 ${contentSha256.slice(0, 16)}…).`,
    filename,
    contentSha256,
  });

  return { sourceFileId, importRunId: run.id, isDuplicate, contentSha256 };
}

// ---------------------------------------------------------------------------
// Step 2 — capture RAW
// ---------------------------------------------------------------------------

export interface CaptureRawResult {
  sheets: number;
  rows: number;
  cells: number;
  plans: SheetPlan[];
}

/**
 * Copy the workbook into the RAW layer, cell by cell.
 *
 * Pivot sheets are captured too — they are part of the evidence — but their
 * `role` keeps them out of the fact stream. For source sheets every column in
 * the header range is materialised even when the row has no cell there, so
 * that "the column exists and this asset has no value" (VALUE_MISSING) stays
 * distinguishable from "the column was never in the layout" and remains
 * traceable to a real coordinate.
 */
export async function captureRaw(
  db: Database,
  importRunId: string,
): Promise<CaptureRawResult> {
  const run = await requireRun(db, importRunId, ["PENDING"]);
  const [file] = await db
    .select()
    .from(sourceFileTable)
    .where(eq(sourceFileTable.id, run.sourceFileId));

  await db
    .update(importRunTable)
    .set({ status: "READING" })
    .where(eq(importRunTable.id, importRunId));

  const { sheets: plans, workbook } = readWorkbook(file.storagePath);

  let totalRows = 0;
  let totalCells = 0;

  for (const plan of plans) {
    const [sheetRow] = await db
      .insert(rawSheetTable)
      .values({
        importRunId,
        sheetName: plan.name,
        sheetIndex: plan.index,
        rowCount: plan.rowCount,
        columnCount: plan.columnCount,
        role: plan.role,
        roleReason: plan.roleReason,
        headerRowIndex: plan.headerRowIndex,
      })
      .returning();

    const sheet = workbook.Sheets[plan.name];
    const range = sheetRange(sheet);
    if (!range) continue;

    const rowsToInsert: { rawSheetId: string; rowIndex: number; isHeader: boolean }[] =
      [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      rowsToInsert.push({
        rawSheetId: sheetRow.id,
        rowIndex: r + 1,
        isHeader: plan.role === "SOURCE" && r === range.s.r,
      });
    }

    const insertedRows = (await insertChunkedReturning(
      db,
      rawRowTable,
      rowsToInsert,
      { id: rawRowTable.id, rowIndex: rawRowTable.rowIndex },
    )) as { id: number; rowIndex: number }[];
    const rowIdByIndex = new Map(insertedRows.map((r) => [r.rowIndex, r.id]));
    totalRows += insertedRows.length;

    const cells: {
      rawRowId: number;
      columnIndex: number;
      columnLetter: string;
      columnHeader: string | null;
      rawValue: string | null;
      sourceType: string;
      formattedText: string | null;
    }[] = [];

    for (let r = range.s.r; r <= range.e.r; r++) {
      const rawRowId = rowIdByIndex.get(r + 1)!;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = readCell(sheet, r, c);
        const header = plan.headers[c - range.s.c] ?? null;
        // Pivot sheets: keep only cells that actually exist.
        if (cell.type === "z" && plan.role !== "SOURCE") continue;
        cells.push({
          rawRowId,
          columnIndex: c,
          columnLetter: columnLetter(c),
          columnHeader: header,
          rawValue:
            cell.value === undefined || cell.value === null
              ? null
              : cell.value instanceof Date
                ? cell.value.toISOString()
                : String(cell.value),
          sourceType: cell.type,
          formattedText: cell.formatted ?? null,
        });
      }
    }

    await insertChunked(db, rawCellTable, cells);
    totalCells += cells.length;
  }

  await db
    .update(importRunTable)
    .set({
      rawSheetCount: plans.length,
      rawRowCount: totalRows,
      rawCellCount: totalCells,
    })
    .where(eq(importRunTable.id, importRunId));

  return { sheets: plans.length, rows: totalRows, cells: totalCells, plans };
}

// ---------------------------------------------------------------------------
// Step 3 — stage
// ---------------------------------------------------------------------------

export interface StageResult {
  stagedFacts: number;
  errors: number;
  warnings: number;
  rowsRejected: number;
  snapshotLabels: string[];
  /** Como a identidade de cada aba foi decidida, e com que evidência. */
  identities: SheetIdentity[];
}

export interface SheetIdentity {
  sheetName: string;
  decision: IdentityDecision;
}

/**
 * O dicionário como o classificador precisa dele: um tipo, as colunas dele.
 *
 * `carreta.chassi` vira `CARRETA` + `chassi`. Só o sufixo entra na comparação,
 * porque é ele que descreve o equipamento; o prefixo *é* a identidade e usá-lo
 * na conta seria pressupor a resposta.
 */
export async function tiposConhecidos(db: Database): Promise<KnownEntityType[]> {
  const linhas = await db
    .select({ entityType: attributeTable.entityType, code: attributeTable.code })
    .from(attributeTable);

  const porTipo = new Map<string, Set<string>>();
  for (const linha of linhas) {
    const ponto = linha.code.indexOf(".");
    const slug = ponto >= 0 ? linha.code.slice(ponto + 1) : linha.code;
    const bucket = porTipo.get(linha.entityType) ?? new Set<string>();
    bucket.add(slug);
    porTipo.set(linha.entityType, bucket);
  }

  return [...porTipo.entries()]
    .map(([entityType, columns]) => ({ entityType, columns }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType));
}

interface PendingIssue {
  importRunId: string;
  rawSheetId?: string;
  rawRowId?: number;
  rawCellId?: number;
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  detail?: unknown;
}

/**
 * Type and validate every source cell, keyed by the source's own vocabulary.
 *
 * Nothing is dropped quietly: an unreadable value becomes a typed null with a
 * reason plus a validation issue, and a row missing its grain keys is rejected
 * loudly.
 */
export async function stage(
  db: Database,
  importRunId: string,
): Promise<StageResult> {
  await requireRun(db, importRunId, ["READING"]);

  const sentinelRules: SentinelRule[] = (
    await db.select().from(sentinelRuleTable)
  ).map((r) => ({
    attributeCode: r.attributeCode,
    rawValue: r.rawValue,
    nullReason: r.nullReason,
  }));

  const sheets = await db
    .select()
    .from(rawSheetTable)
    .where(
      and(
        eq(rawSheetTable.importRunId, importRunId),
        eq(rawSheetTable.role, "SOURCE"),
      ),
    );

  /*
    O tipo que quem enviou declarou, quando declarou.

    Lido uma vez para a importação inteira, como o dicionário: a declaração é
    do arquivo, e vale igual para todas as abas dele.
  */
  const [runDeclarado] = await db
    .select({ declaredType: importRunTable.declaredType })
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  const declarado = tipoDeImportacao(runDeclarado?.declaredType ?? null);

  const knownAliases = await db.select().from(attributeAliasTable);
  const aliasKey = (sourceName: string, sheetName: string) =>
    `${sheetName} ${sourceName}`;
  const aliasIndex = new Map(
    knownAliases.map((a) => [aliasKey(a.sourceName, a.sourceSheet), a]),
  );

  /*
    O dicionário que já existe, para a identidade sair do conteúdo da aba.

    Lido uma vez para a importação inteira: são dezenas de linhas, e a decisão
    de cada aba precisa da mesma foto — duas abas do mesmo arquivo não podem
    ser classificadas contra dicionários diferentes.
  */
  const conhecidos = await tiposConhecidos(db);

  const issues: PendingIssue[] = [];
  const stagedRows: Record<string, unknown>[] = [];
  const labels = new Set<string>();
  const identidades: SheetIdentity[] = [];
  let rowsRejected = 0;

  for (const sheet of sheets) {
    const rows = await db
      .select()
      .from(rawRowTable)
      .where(eq(rawRowTable.rawSheetId, sheet.id))
      .orderBy(rawRowTable.rowIndex);
    if (rows.length === 0) continue;

    const rowIds = rows.map((r) => r.id);
    const cells: (typeof rawCellTable.$inferSelect)[] = [];
    for (let i = 0; i < rowIds.length; i += 500) {
      const chunk = await db
        .select()
        .from(rawCellTable)
        .where(inArray(rawCellTable.rawRowId, rowIds.slice(i, i + 500)));
      cells.push(...chunk);
    }

    const cellsByRow = new Map<number, Map<number, typeof rawCellTable.$inferSelect>>();
    for (const cell of cells) {
      let bucket = cellsByRow.get(cell.rawRowId);
      if (!bucket) {
        bucket = new Map();
        cellsByRow.set(cell.rawRowId, bucket);
      }
      bucket.set(cell.columnIndex, cell);
    }

    const headerRow = rows.find((r) => r.isHeader);
    if (!headerRow) continue;
    const headerCells = cellsByRow.get(headerRow.id) ?? new Map();

    /*
      Que equipamento é esta aba — decidido pelas colunas dela.

      A decisão desceu para depois da leitura do cabeçalho de propósito: antes
      ela era a primeira linha do laço, tomada com o nome da aba na mão e mais
      nada, e é exatamente essa ordem que fazia `Modelo_Carreta` virar um
      equipamento novo. O nome continua servindo, mas de desempate — e quando
      nem ele tem respaldo no dicionário, a decisão fica pendente em vez de
      criar identidade em silêncio. Ver `identity.ts`.
    */
    const slugsDaAba = [...headerCells.values()]
      .map((cell) => (cell.rawValue ?? "").trim())
      .filter((header) => header !== "")
      .map((header) => slugifyColumn(header));

    const deduzida = classifyEntityType(sheet.sheetName, slugsDaAba, conhecidos);

    /*
      A declaração, conferida contra o que a aba traz.

      Sem declaração, a decisão é a dedução de sempre. Com ela, a conferência é
      quem responde — e ela nunca troca o tipo em silêncio: ou a declaração se
      sustenta e vira a identidade, ou a divergência vira um ERRO impeditivo e
      a aba continua descrita pelo que ela de fato é, para a pré-visualização
      poder mostrar o arquivo que chegou.
    */
    const identificadorDaAba = identificadorNoCabecalho(
      [...headerCells.values()]
        .map((cell) => (cell.rawValue ?? "").trim())
        .filter((header) => header !== "")
        .map((header) => foldText(header)),
    );
    const conferida =
      declarado === null
        ? null
        : conferirDeclaracao(declarado, deduzida, identificadorDaAba, sheet.sheetName);

    const decisao = conferida?.decision ?? deduzida;
    const entityType = conferida?.entityType ?? deduzida.entityType;
    identidades.push({ sheetName: sheet.sheetName, decision: decisao });

    if (conferida?.divergencia) {
      issues.push({
        importRunId,
        rawSheetId: sheet.id,
        severity: "ERROR",
        code: "TIPO_DIVERGE_DA_DECLARACAO",
        message: conferida.divergencia,
        detail: {
          declarado: declarado?.code,
          conteudo: deduzida.entityType,
          identificadorDaAba: identificadorDaAba?.sourceName ?? null,
          scores: deduzida.scores.slice(0, 4),
        },
      });
    }

    issues.push({
      importRunId,
      rawSheetId: sheet.id,
      severity: decisao.isNew ? "WARNING" : "INFO",
      code: decisao.isNew
        ? "NEW_EQUIPMENT_IDENTITY"
        : decisao.source === "DECLARADO"
          ? "IDENTITY_FROM_DECLARATION"
          : decisao.source === "DICIONARIO"
            ? "IDENTITY_FROM_COLUMNS"
            : "IDENTITY_FROM_SHEET_NAME",
      message: `Aba "${sheet.sheetName}" tratada como ${entityType}. ${decisao.reason}`,
      detail: {
        entityType,
        source: decisao.source,
        isNew: decisao.isNew,
        scores: decisao.scores.slice(0, 4),
      },
    });

    // --- column mapping -----------------------------------------------------
    const columns: {
      columnIndex: number;
      header: string;
      folded: string;
      attributeCode: string;
      role: "GRAIN" | "FACT";
    }[] = [];
    const slugSeen = new Map<string, string>();
    const mappingRows: Record<string, unknown>[] = [];

    for (const [columnIndex, cell] of headerCells) {
      const header = (cell.rawValue ?? "").trim();
      if (header === "") continue;
      const folded = foldText(header);
      const slug = slugifyColumn(header);
      const attributeCode = `${entityType.toLowerCase()}.${slug}`;

      const isGrain =
        folded === GRAIN_COLUMNS.vigencia || IDENTIFICADORES_FOLDED.has(folded);

      const previousHeader = slugSeen.get(slug);
      if (previousHeader !== undefined) {
        issues.push({
          importRunId,
          rawSheetId: sheet.id,
          rawCellId: cell.id,
          severity: "ERROR",
          code: "AMBIGUOUS_COLUMN_SLUG",
          message: `Columns "${previousHeader}" and "${header}" both normalise to "${slug}" in sheet "${sheet.sheetName}". Refusing to merge them.`,
          detail: { slug, headers: [previousHeader, header] },
        });
        mappingRows.push({
          importRunId,
          rawSheetId: sheet.id,
          columnIndex,
          columnHeader: header,
          status: "AMBIGUOUS",
          note: `Collides with column "${previousHeader}".`,
        });
        continue;
      }
      slugSeen.set(slug, header);

      if (isGrain) {
        mappingRows.push({
          importRunId,
          rawSheetId: sheet.id,
          columnIndex,
          columnHeader: header,
          status: "IGNORED",
          note:
            folded === GRAIN_COLUMNS.vigencia
              ? "Coluna de grão: vira a vigência (source_label + effective_date), não um fato."
              : `Coluna de grão: vira o identificador da linha (${header}), não um fato.`,
        });
        columns.push({ columnIndex, header, folded, attributeCode, role: "GRAIN" });
        continue;
      }

      const alias = aliasIndex.get(aliasKey(header, sheet.sheetName));
      mappingRows.push({
        importRunId,
        rawSheetId: sheet.id,
        columnIndex,
        columnHeader: header,
        targetAttributeId: alias?.attributeId ?? null,
        status: alias ? "MAPPED" : "NEW",
        note: alias
          ? null
          : "First time this column is seen; a new attribute will be created with semantics UNKNOWN.",
      });
      if (!alias) {
        issues.push({
          importRunId,
          rawSheetId: sheet.id,
          rawCellId: cell.id,
          severity: "INFO",
          code: "NEW_ATTRIBUTE",
          message: `New column "${header}" in sheet "${sheet.sheetName}" -> attribute "${attributeCode}" (semantics UNKNOWN until curated).`,
        });
      }
      columns.push({ columnIndex, header, folded, attributeCode, role: "FACT" });
    }

    await insertChunked(db, columnMappingTable, mappingRows as never[]);

    const vigenciaColumn = columns.find((c) => c.folded === GRAIN_COLUMNS.vigencia);
    /*
      Qual coluna identifica a linha desta aba.

      Não é sempre a placa: o trecho se identifica por `chaveTrecho`, e é por
      isso que a busca é pelo conjunto de identificadores conhecidos e não por
      um nome fixo. `workbook.ts` já garantiu que existe uma — uma aba sem
      identificador não teria virado SOURCE —, e o `continue` fica de guarda
      para o caso de RAW ter sido capturado por uma versão anterior do leitor.
    */
    const identificadorColumn = columns.find((c) => IDENTIFICADORES_FOLDED.has(c.folded));
    if (!vigenciaColumn || !identificadorColumn) continue;

    // --- rows ---------------------------------------------------------------
    for (const row of rows) {
      if (row.isHeader) continue;
      const bucket = cellsByRow.get(row.id);
      if (!bucket) continue;

      const rawLabel = (bucket.get(vigenciaColumn.columnIndex)?.rawValue ?? "").trim();
      const rawChave = (bucket.get(identificadorColumn.columnIndex)?.rawValue ?? "").trim();

      // A completely blank row is structural padding, not a rejection.
      const hasAnyValue = [...bucket.values()].some(
        (c) => c.rawValue !== null && c.rawValue.trim() !== "",
      );
      if (!hasAnyValue) continue;

      // Uma placa que só tem pontuação (`---`) não identifica veículo nenhum:
      // ela normaliza para vazio, e vazio não é chave. Recusar aqui é o mesmo
      // tratamento que a placa em branco já recebia.
      if (rawLabel === "" || rawChave === "" || normalizeIdentifier(rawChave) === "") {
        rowsRejected++;
        issues.push({
          importRunId,
          rawSheetId: sheet.id,
          rawRowId: row.id,
          severity: "ERROR",
          code: "ROW_MISSING_GRAIN_KEY",
          message: `A linha ${row.rowIndex} de "${sheet.sheetName}" está sem ${rawLabel === "" ? "Vigencia" : identificadorColumn.header}; recusada.`,
          detail: {
            vigencia: rawLabel,
            identificador: identificadorColumn.header,
            valor: rawChave,
          },
        });
        continue;
      }

      const vigencia = parseVigenciaLabel(rawLabel);
      if (!vigencia.effectiveDate) {
        rowsRejected++;
        issues.push({
          importRunId,
          rawSheetId: sheet.id,
          rawRowId: row.id,
          severity: "ERROR",
          code: "UNPARSEABLE_VIGENCIA_LABEL",
          message: `Row ${row.rowIndex} of "${sheet.sheetName}": cannot derive a date from vigência label "${rawLabel}" (${vigencia.failureCode}); rejected rather than guessed.`,
          detail: { label: rawLabel, failureCode: vigencia.failureCode },
        });
        continue;
      }

      labels.add(vigencia.label);

      for (const column of columns) {
        if (column.role !== "FACT") continue;
        const cell = bucket.get(column.columnIndex);
        const source: SourceCell = cell
          ? {
              type: cell.sourceType as SourceCell["type"],
              value: decodeRawValue(cell.sourceType, cell.rawValue),
              formatted: cell.formattedText ?? undefined,
            }
          : { type: "z", value: undefined };

        const typed = typeCell(source, {
          attributeCode: column.attributeCode,
          columnHeader: column.header,
          sentinelRules,
          suspectedSentinelValues: SUSPECTED_SENTINELS,
        });

        for (const warning of typed.warnings) {
          issues.push({
            importRunId,
            rawSheetId: sheet.id,
            rawRowId: row.id,
            rawCellId: cell?.id,
            severity: "WARNING",
            code: warning.code,
            message: warning.message,
            detail: { attributeCode: column.attributeCode },
          });
        }

        if (!cell) {
          // Cannot stage a fact without a cell to point at. Should not happen
          // for source sheets (every coordinate is materialised) — if it does,
          // it is a reader bug and must be visible.
          issues.push({
            importRunId,
            rawSheetId: sheet.id,
            rawRowId: row.id,
            severity: "ERROR",
            code: "MISSING_RAW_CELL",
            message: `No RAW cell captured for column "${column.header}" at row ${row.rowIndex}; fact not staged.`,
          });
          continue;
        }

        stagedRows.push({
          importRunId,
          rawCellId: cell.id,
          snapshotLabel: vigencia.label,
          entityKey: normalizeIdentifier(rawChave),
          entityKeyRaw: rawChave,
          entityType,
          attributeCode: column.attributeCode,
          valueNumeric: typed.valueNumeric,
          valueText: typed.valueText,
          valueBoolean: typed.valueBoolean,
          valueDate: typed.valueDate,
          valueHash: typed.valueHash,
          isNull: typed.isNull,
          nullReason: typed.nullReason,
          status: typed.warnings.length > 0 ? "WARNING" : "VALID",
        });
      }
    }
  }

  // One column, more than one type across the run. The source is internally
  // inconsistent about what the column holds, which is a curation task rather
  // than something the reader may quietly normalise away.
  const typesByAttribute = new Map<string, Set<string>>();
  for (const row of stagedRows) {
    if (row.isNull) continue;
    const code = row.attributeCode as string;
    let bucket = typesByAttribute.get(code);
    if (!bucket) {
      bucket = new Set();
      typesByAttribute.set(code, bucket);
    }
    if (row.valueNumeric !== null) bucket.add("NUMERIC");
    else if (row.valueBoolean !== null) bucket.add("BOOLEAN");
    else if (row.valueDate !== null) bucket.add("DATE");
    else if (row.valueText !== null) bucket.add("TEXT");
  }
  for (const [code, types] of typesByAttribute) {
    if (types.size <= 1) continue;
    issues.push({
      importRunId,
      severity: "WARNING",
      code: "MIXED_TYPE_COLUMN",
      message: `Attribute "${code}" arrives as ${[...types].sort().join(" and ")} within the same import; stored per value and typed MIXED pending curation.`,
      detail: { attributeCode: code, types: [...types].sort() },
    });
  }

  // ---------------------------------------------------------------------
  // A mesma entidade duas vezes dentro da mesma importação
  // ---------------------------------------------------------------------
  // Depois de normalizar a placa, `ABC-1D23` e `ABC1D23` são a mesma linha
  // lógica — e a planilha pode trazer as duas. O índice único da staging as
  // recusaria com um 23505 cru, que chegava à tela como erro técnico.
  //
  // Aqui a decisão é explícita e não é "a primeira" nem "a última": se as duas
  // ocorrências **concordam** depois de normalizadas, elas são consolidadas
  // numa só e isso vira registro de auditoria; se **discordam**, é conflito de
  // dado, e o import não pode escolher em silêncio qual valor vale.
  const porGrao = new Map<string, Record<string, unknown>[]>();
  for (const row of stagedRows) {
    const grao = [
      row.snapshotLabel,
      row.entityType,
      row.entityKey,
      row.attributeCode,
    ].join("\u001f");
    const bucket = porGrao.get(grao);
    if (bucket) bucket.push(row);
    else porGrao.set(grao, [row]);
  }

  const consolidados: Record<string, unknown>[] = [];
  const conflitos = new Map<string, Set<string>>();
  let consolidacoes = 0;
  for (const [grao, ocorrencias] of porGrao) {
    if (ocorrencias.length === 1) {
      consolidados.push(ocorrencias[0]);
      continue;
    }
    const valores = new Set(
      ocorrencias.map((o) =>
        canonicalPayloadHash([
          {
            entityType: o.entityType as string,
            entityKey: o.entityKey as string,
            attributeCode: o.attributeCode as string,
            valueNumeric: o.valueNumeric as string | null,
            valueText: o.valueText as string | null,
            valueBoolean: o.valueBoolean as boolean | null,
            valueDate: o.valueDate as string | null,
            isNull: o.isNull as boolean | null,
          },
        ]),
      ),
    );
    consolidados.push(ocorrencias[0]);
    if (valores.size === 1) {
      consolidacoes++;
      continue;
    }
    const [label, entityType, entityKey] = grao.split("\u001f");
    const chave = [label, entityType, entityKey].join("\u001f");
    let atributos = conflitos.get(chave);
    if (!atributos) {
      atributos = new Set();
      conflitos.set(chave, atributos);
    }
    atributos.add(ocorrencias[0].attributeCode as string);
  }

  if (consolidacoes > 0) {
    issues.push({
      importRunId,
      severity: "INFO",
      code: "ENTIDADE_DUPLICADA_CONSOLIDADA",
      message: `${consolidacoes} valores apareceram mais de uma vez para a mesma entidade e atributo, com o mesmo conteúdo depois de normalizado; foram consolidados numa ocorrência.`,
      detail: { ocorrencias: consolidacoes },
    });
  }

  for (const [chave, atributos] of conflitos) {
    const [label, entityType, entityKey] = chave.split("\u001f");
    issues.push({
      importRunId,
      severity: "ERROR",
      code: "ENTIDADE_DUPLICADA_CONFLITANTE",
      message:
        `A ${entityType.toLowerCase()} de placa ${entityKey} aparece mais de uma vez na vigência ${label} com valores diferentes em ${[...atributos].sort().join(", ")}. ` +
        `Duas linhas para o mesmo veículo, discordando, não têm resposta certa: corrija a origem e envie de novo.`,
      detail: { vigencia: label, entityType, placa: entityKey, atributos: [...atributos].sort() },
    });
  }

  await insertChunked(db, stagedFactTable, consolidados as never[]);
  await insertChunked(
    db,
    validationIssueTable,
    issues.map((i) => ({
      importRunId: i.importRunId,
      rawSheetId: i.rawSheetId ?? null,
      rawRowId: i.rawRowId ?? null,
      rawCellId: i.rawCellId ?? null,
      severity: i.severity,
      code: i.code,
      message: i.message,
      detail: i.detail ?? null,
    })) as never[],
  );

  const errors = issues.filter((i) => i.severity === "ERROR").length;
  const warnings = issues.filter((i) => i.severity === "WARNING").length;

  await db
    .update(importRunTable)
    .set({
      status: "STAGED",
      stagedFactCount: consolidados.length,
      errorCount: errors,
      warningCount: warnings,
    })
    .where(eq(importRunTable.id, importRunId));

  return {
    stagedFacts: consolidados.length,
    errors,
    warnings,
    rowsRejected,
    snapshotLabels: [...labels].sort(),
    identities: identidades,
  };
}

/**
 * RAW stores every value as text. Rebuild the shape the reader saw so that
 * typing decisions are made once, in {@link typeCell}, rather than twice.
 */
function decodeRawValue(sourceType: string, rawValue: string | null): unknown {
  if (rawValue === null) return undefined;
  switch (sourceType) {
    case "n":
      return Number(rawValue);
    case "b":
      return rawValue === "true" || rawValue === "TRUE" || rawValue === "1";
    case "d": {
      const parsed = new Date(rawValue);
      return Number.isNaN(parsed.getTime()) ? rawValue : parsed;
    }
    default:
      return rawValue;
  }
}

/**
 * One derivation, not two.
 *
 * This used to be a second copy of the rule in `workbook.ts`, and the copies
 * drifted the moment the sheet naming changed: fixing one left staging still
 * producing MODELOCARRETA. A rule that decides an asset's identity gets to
 * live in exactly one place.
 */
function deriveEntityTypeFromSheet(sheetName: string): string {
  return deriveEntityType(sheetName).entityType;
}

// ---------------------------------------------------------------------------
// Step 4 — preview
// ---------------------------------------------------------------------------

export interface PreviewReport {
  importRunId: string;
  sourceFilename: string;
  contentSha256: string;
  sheets: {
    name: string;
    role: string;
    roleReason: string;
    rows: number;
    columns: number;
  }[];
  snapshots: {
    label: string;
    effectiveDate: string;
    entityTypes: string[];
    entityCount: number;
    factCount: number;
  }[];
  totals: {
    rawSheets: number;
    rawRows: number;
    rawCells: number;
    stagedFacts: number;
    entities: number;
    errors: number;
    warnings: number;
  };
  issuesByCode: { code: string; severity: string; count: number; sample: string }[];
  /** Nulls broken down by reason — absence is never collapsed into one bucket. */
  nullsByReason: { reason: string; count: number }[];
  /** True economic zeros, kept separate from every kind of absence. */
  zeroCount: number;
  blockingErrors: number;
  /**
   * Equipamentos que esta importação criaria e o dicionário não conhece.
   *
   * Vazio no caso comum. Preenchido, a promoção recusa até que estes nomes
   * sejam declarados — é a única coisa nesta tela que exige uma decisão, e não
   * apenas uma leitura.
   */
  pendingIdentities: string[];
}

/**
 * Build the report a human reads before anything reaches the canonical layer.
 * Promotion refuses to run until this step has produced a report.
 */
export async function preview(
  db: Database,
  importRunId: string,
): Promise<PreviewReport> {
  const run = await requireRun(db, importRunId, ["STAGED", "PREVIEWED"]);
  const [file] = await db
    .select()
    .from(sourceFileTable)
    .where(eq(sourceFileTable.id, run.sourceFileId));

  const sheets = await db
    .select()
    .from(rawSheetTable)
    .where(eq(rawSheetTable.importRunId, importRunId))
    .orderBy(rawSheetTable.sheetIndex);

  const perLabel = await db
    .select({
      label: stagedFactTable.snapshotLabel,
      entityType: stagedFactTable.entityType,
      entities: sql<number>`count(distinct ${stagedFactTable.entityKey})`.mapWith(Number),
      facts: sql<number>`count(*)`.mapWith(Number),
    })
    .from(stagedFactTable)
    .where(eq(stagedFactTable.importRunId, importRunId))
    .groupBy(stagedFactTable.snapshotLabel, stagedFactTable.entityType);

  const snapshotMap = new Map<
    string,
    { entityTypes: Set<string>; entityCount: number; factCount: number }
  >();
  for (const row of perLabel) {
    let entry = snapshotMap.get(row.label);
    if (!entry) {
      entry = { entityTypes: new Set(), entityCount: 0, factCount: 0 };
      snapshotMap.set(row.label, entry);
    }
    entry.entityTypes.add(row.entityType);
    entry.entityCount += row.entities;
    entry.factCount += row.facts;
  }

  const snapshots = [...snapshotMap.entries()]
    .map(([label, v]) => ({
      label,
      effectiveDate: parseVigenciaLabel(label).effectiveDate ?? "",
      entityTypes: [...v.entityTypes].sort(),
      entityCount: v.entityCount,
      factCount: v.factCount,
    }))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  const issueRows = await db
    .select({
      code: validationIssueTable.code,
      severity: validationIssueTable.severity,
      count: sql<number>`count(*)`.mapWith(Number),
      sample: sql<string>`min(${validationIssueTable.message})`,
    })
    .from(validationIssueTable)
    .where(eq(validationIssueTable.importRunId, importRunId))
    .groupBy(validationIssueTable.code, validationIssueTable.severity);

  const nullRows = await db
    .select({
      reason: stagedFactTable.nullReason,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(stagedFactTable)
    .where(
      and(
        eq(stagedFactTable.importRunId, importRunId),
        eq(stagedFactTable.isNull, true),
      ),
    )
    .groupBy(stagedFactTable.nullReason);

  const [zeroRow] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(stagedFactTable)
    .where(
      and(
        eq(stagedFactTable.importRunId, importRunId),
        eq(stagedFactTable.isNull, false),
        eq(stagedFactTable.valueNumeric, "0"),
      ),
    );

  const [entityRow] = await db
    .select({
      count: sql<number>`count(distinct (${stagedFactTable.entityType} || ':' || ${stagedFactTable.entityKey}))`.mapWith(
        Number,
      ),
    })
    .from(stagedFactTable)
    .where(eq(stagedFactTable.importRunId, importRunId));

  const blockingErrors = issueRows
    .filter((i) => i.severity === "ERROR")
    .reduce((sum, i) => sum + i.count, 0);

  /*
    Nem todo ERRO impede promover: linha sem chave é linha recusada, e o resto do
    arquivo continua válido — foi sempre assim. O que impede são os dois casos em
    que não existe resposta certa a escolher:

    - a mesma entidade aparecendo duas vezes na mesma vigência com valores que
      discordam — escolher um dos dois em silêncio seria inventar o número;
    - o tipo declarado no envio discordando do que a aba traz — aceitar seria
      gravar como cavalo o que é carreta porque alguém clicou na aba errada.
  */
  const impeditivas = issueRows.filter(
    (i) => i.severity === "ERROR" && BLOQUEIAM_PROMOCAO.has(i.code),
  );
  const impeditivos = impeditivas.reduce((sum, i) => sum + i.count, 0);

  if (run.status === "STAGED") {
    await db
      .update(importRunTable)
      .set(
        impeditivos > 0
          ? {
              status: "VALIDATION_ERROR",
              finishedAt: new Date(),
              failureReason: motivoDoImpedimento(impeditivas),
            }
          : { status: "PREVIEWED" },
      )
      .where(eq(importRunTable.id, importRunId));
  }

  return {
    importRunId,
    sourceFilename: file.filename,
    contentSha256: file.contentSha256,
    sheets: sheets.map((s) => ({
      name: s.sheetName,
      role: s.role,
      roleReason: s.roleReason,
      rows: s.rowCount,
      columns: s.columnCount,
    })),
    snapshots,
    totals: {
      rawSheets: run.rawSheetCount,
      rawRows: run.rawRowCount,
      rawCells: run.rawCellCount,
      stagedFacts: run.stagedFactCount,
      entities: entityRow?.count ?? 0,
      errors: run.errorCount,
      warnings: run.warningCount,
    },
    issuesByCode: issueRows
      .map((i) => ({
        code: i.code,
        severity: i.severity,
        count: i.count,
        sample: i.sample,
      }))
      .sort((a, b) => b.count - a.count),
    nullsByReason: nullRows
      .map((n) => ({ reason: n.reason ?? "(unset)", count: n.count }))
      .sort((a, b) => b.count - a.count),
    zeroCount: zeroRow?.count ?? 0,
    blockingErrors,
    pendingIdentities: await identidadesPendentes(db, importRunId),
  };
}

// ---------------------------------------------------------------------------
// Step 5 — promote
// ---------------------------------------------------------------------------

export interface PromoteOptions {
  /**
   * FAIL          — refuse when the business key already exists (default).
   * NEW_REVISION  — supersede the live snapshot and write revision N+1.
   */
  onExistingSnapshot?: "FAIL" | "NEW_REVISION";
  promotedBy?: string;
  /**
   * Os equipamentos novos que quem promove **declara** estar criando.
   *
   * Uma identidade nova é o começo de uma frota paralela: foi assim que 80
   * carretas passaram a existir duas vezes, com dados certos e identidade
   * errada, sem que nada falhasse. Criar equipamento continua permitido — a
   * Ambev pode passar a entregar bitrem amanhã —, mas deixa de ser efeito
   * colateral de um nome de aba e passa a ser declaração de quem promove.
   *
   * A exigência só vale quando o dicionário já conhece algum equipamento: num
   * banco virgem não existe identidade paralela possível, e travar a primeira
   * importação de todas seria travar o produto na partida. Aí a decisão vai
   * como aviso para a pré-visualização, que é lida antes de promover.
   */
  confirmNewEntityTypes?: string[];
}

export interface PromoteResult {
  snapshotIds: string[];
  snapshots: {
    id: string;
    label: string;
    effectiveDate: string;
    revision: number;
    entityCount: number;
    factCount: number;
  }[];
  entitiesCreated: number;
  attributesCreated: number;
  factsInserted: number;
  /**
   * A árvore da taxonomia depois desta promoção.
   *
   * `nosCriados` é zero em toda importação a partir da segunda — a estrutura é
   * garantida, não recriada —, e é isso que a idempotência significa aqui.
   */
  taxonomia: { nosCriados: number; nosExistentes: number };
  /**
   * O que o registro canônico de semânticas deixou aplicado nesta promoção.
   *
   * Sai na resposta da promoção porque uma aplicação silenciosa é
   * indistinguível de nenhuma aplicação — foi assim que a ausência dela passou
   * despercebida até a frota inteira aparecer sem remuneração apurada. Quem
   * promove recebe quantas colunas entraram confirmadas e, nomeadamente, o que
   * **não** entrou: o que diverge de uma confirmação humana e o que o tipo de
   * dado deste arquivo contradiz. Ver `aplicarConfirmacoesCanonicas`.
   */
  semanticasConfirmadas: {
    aplicadas: number;
    jaConfirmadas: number;
    divergentes: string[];
    incoerentes: string[];
  };
}

/**
 * Os equipamentos que esta importação criaria e o dicionário não conhece.
 *
 * Lido da staging, e não das abas: duas abas podem concordar em criar o mesmo
 * equipamento novo, e o que importa é o conjunto que vai ser escrito.
 *
 * **O tipo declarado no envio não é pendência.** A confirmação existe para que
 * criar equipamento deixe de ser efeito colateral de um nome de aba e passe a
 * ser declaração de quem promove — e quem escolheu a aba Trecho para enviar o
 * arquivo já fez essa declaração, antes de o leitor abrir a planilha. Cobrá-la
 * de novo na promoção seria fazer a mesma pergunta à mesma pessoa em duas
 * telas, e a segunda com menos contexto que a primeira. O que sustenta isso é a
 * conferência: uma declaração que divergisse do conteúdo não teria chegado até
 * aqui — ela vira ERRO impeditivo na pré-visualização.
 */
export async function identidadesPendentes(
  db: Database,
  importRunId: string,
): Promise<string[]> {
  const { rows } = await db.execute<{ entity_type: string }>(sql`
    SELECT DISTINCT entity_type FROM staged_fact WHERE import_run_id = ${importRunId}::uuid
  `);
  const conhecidos = await tiposConhecidos(db);
  // Banco virgem: não há identidade paralela possível, e a primeira
  // importação de todas não pode depender de uma declaração que ninguém
  // teria como fazer. O aviso da staging continua na pré-visualização.
  if (conhecidos.length === 0) return [];

  const [run] = await db
    .select({ declaredType: importRunTable.declaredType })
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  const declarado = tipoDeImportacao(run?.declaredType ?? null);

  return novasIdentidades(
    rows.map((r) => r.entity_type),
    conhecidos.map((c) => c.entityType),
  ).filter((tipo) => tipo !== declarado?.code);
}

/** A recusa, escrita para quem opera — e com a saída no próprio texto. */
async function recusarIdentidadeNaoDeclarada(
  db: Database,
  importRunId: string,
  confirmados: string[] | undefined,
): Promise<void> {
  const pendentes = await identidadesPendentes(db, importRunId);
  const declarados = new Set(confirmados ?? []);
  const faltando = pendentes.filter((t) => !declarados.has(t));
  if (faltando.length === 0) return;

  throw new Error(
    `Esta importação criaria ${faltando.length === 1 ? "um equipamento que o dicionário não conhece" : "equipamentos que o dicionário não conhece"}: ` +
      `${faltando.join(", ")}. Um equipamento novo é o começo de uma frota paralela — ` +
      `foi assim que a mesma carreta passou a existir duas vezes — então ele precisa ser ` +
      `declarado por quem promove, e não sair de um nome de aba. ` +
      `Se for equipamento novo mesmo, confirme ${faltando.join(", ")} na pré-visualização. ` +
      `Se for um equipamento que já existe com a aba nomeada de outro jeito, o lugar de ` +
      `olhar é a lista de colunas: ela não bateu com nenhum tipo conhecido.`,
  );
}

/**
 * A recusa de uma promoção, dita de um jeito que a tela consegue repetir.
 *
 * O pipeline recusava com `new Error(...)`, e a API traduzia pelo texto. Com
 * uma decisão nomeada, a tela sabe *qual* recusa foi sem ler a frase, e a
 * mesma decisão vai para `import_decision` — que é onde alguém procura, meses
 * depois, por que aquele arquivo não entrou.
 */
export class PromocaoRecusada extends Error {
  constructor(
    message: string,
    readonly decisao: string,
    /**
     * O estado em que o run fica.
     *
     * VALIDATION_ERROR quando o dado não fecha e reenviar é o caminho.
     * PREVIEWED quando a recusa é uma pergunta a quem opera — "já existe uma
     * versão ativa; quer registrar uma correção?" —, porque aí o run tem de
     * continuar aprovável.
     */
    readonly runStatus: "VALIDATION_ERROR" | "PREVIEWED",
    readonly detalhe: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PromocaoRecusada";
  }
}

/** Um fato canônico de um snapshot já gravado, na forma que o hash consome. */
async function fatosCanonicosDoSnapshot(
  tx: Database,
  snapshotId: string,
): Promise<(CanonicalFact & { entityId: string })[]> {
  const rows = await tx
    .select({
      entityId: factTable.entityId,
      entityType: entityTable.entityType,
      entityKey: entityIdentifierTable.identifierValue,
      attributeCode: attributeTable.code,
      valueNumeric: factTable.valueNumeric,
      valueText: factTable.valueText,
      valueBoolean: factTable.valueBoolean,
      valueDate: factTable.valueDate,
      isNull: factTable.isNull,
    })
    .from(factTable)
    .innerJoin(entityTable, eq(entityTable.id, factTable.entityId))
    .innerJoin(attributeTable, eq(attributeTable.id, factTable.attributeId))
    .leftJoin(
      entityIdentifierTable,
      and(
        eq(entityIdentifierTable.entityId, factTable.entityId),
        eq(entityIdentifierTable.identifierType, "PLACA"),
        eq(entityIdentifierTable.isCurrent, true),
      ),
    )
    .where(eq(factTable.snapshotId, snapshotId));

  return rows.map((r) => ({
    entityId: r.entityId,
    entityType: r.entityType,
    entityKey: r.entityKey ?? "",
    attributeCode: r.attributeCode,
    valueNumeric: r.valueNumeric,
    valueText: r.valueText,
    valueBoolean: r.valueBoolean,
    valueDate: r.valueDate,
    isNull: r.isNull,
  }));
}

/** Uma linha de auditoria da decisão tomada. */
async function registrarDecisao(
  db: Database,
  valores: typeof importDecisionTable.$inferInsert,
): Promise<void> {
  await db.insert(importDecisionTable).values(valores);
}

/**
 * Reler e travar o run dentro da transação.
 *
 * O `requireRun` antigo lia o estado **fora** da transação e o usava como
 * verdade lá dentro. Entre a leitura e o `UPDATE ... PROMOTING` havia uma
 * janela em que uma segunda promoção do mesmo run lia PREVIEWED também — e com
 * `NEW_REVISION` as duas gravavam, produzindo uma correção fantasma com os
 * mesmos fatos. `FOR UPDATE` fecha a janela: a segunda espera a primeira
 * terminar e então lê o estado que a primeira deixou.
 */
async function lockRun(
  tx: Database,
  importRunId: string,
  allowed: string[],
): Promise<typeof importRunTable.$inferSelect> {
  const { rows } = (await tx.execute(
    sql`SELECT * FROM ${importRunTable} WHERE ${importRunTable.id} = ${importRunId} FOR UPDATE`,
  )) as unknown as { rows: Record<string, unknown>[] };
  const row = rows[0];
  if (!row) throw new Error(`Import run ${importRunId} not found.`);
  const status = String(row.status);
  if (!allowed.includes(status)) {
    throw new Error(
      `Import run ${importRunId} is ${status}; this step requires ${allowed.join(" or ")}.`,
    );
  }
  return {
    ...(row as unknown as typeof importRunTable.$inferSelect),
    sourceFileId: String(row.source_file_id),
    status: status as typeof importRunTable.$inferSelect["status"],
  };
}

/**
 * Promover um run já conferido para a camada canônica, numa transação só.
 *
 * Tudo o que decide acontece aqui dentro, nesta ordem: travar o run, reler o
 * estado dele, resolver a identidade canônica de cada vigência, travar essa
 * identidade, olhar o que já está ativo, decidir, gravar. Nada é lido fora e
 * usado como verdade lá dentro.
 *
 * O que cada decisão significa:
 *
 *  - **Não existe vigência ativa** → revisão 1, com os fatos do arquivo.
 *  - **Existe e o dado normalizado é o mesmo** → `SKIPPED_DUPLICATE_DATA`.
 *    Nenhuma revisão é aberta: uma revisão que não muda nada é ruído de
 *    auditoria. É o que reconhece o mesmo XLSX reexportado com outros bytes.
 *  - **Existe e o arquivo traz componentes que ela não tem** (o cavalo depois
 *    da carreta) → revisão nova que **funde** os dois. É o fluxo normal de duas
 *    entregas, e é o que impede que a segunda entrega abra uma segunda vigência
 *    ativa.
 *  - **Existe e o arquivo reescreve componentes que ela já tem** → é correção,
 *    e correção é declarada: sem `NEW_REVISION` a promoção é recusada com
 *    `VIGENCIA_ATIVA_EXISTENTE` e o run continua aprovável.
 *
 * Em todos os casos, ao final existe **uma** vigência ativa para a identidade —
 * e o índice único do banco garante isso mesmo que este código erre.
 */
export async function promote(
  db: Database,
  importRunId: string,
  options: PromoteOptions = {},
): Promise<PromoteResult> {
  const mode = options.onExistingSnapshot ?? "FAIL";
  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database;

      // 1. travar e reler o run — dentro da transação, nunca fora
      const run = await lockRun(tx, importRunId, ["PREVIEWED"]);
      await recusarIdentidadeNaoDeclarada(tx, importRunId, options.confirmNewEntityTypes);

      await tx
        .update(importRunTable)
        .set({ status: "PROMOTING" })
        .where(eq(importRunTable.id, importRunId));

      const [file] = await tx
        .select()
        .from(sourceFileTable)
        .where(eq(sourceFileTable.id, run.sourceFileId));

      const staged = await tx
        .select()
        .from(stagedFactTable)
        .where(eq(stagedFactTable.importRunId, importRunId));

      const byLabel = new Map<string, typeof staged>();
      for (const fact of staged) {
        const bucket = byLabel.get(fact.snapshotLabel);
        if (bucket) bucket.push(fact);
        else byLabel.set(fact.snapshotLabel, [fact]);
      }

      const labels = [...byLabel.keys()].sort((a, b) => {
        const da = parseVigenciaLabel(a).effectiveDate ?? "";
        const db_ = parseVigenciaLabel(b).effectiveDate ?? "";
        return da.localeCompare(db_);
      });

      const dataTypeByCode = resolveDataTypes(staged);

      const attributeCache = new Map<string, string>();
      const entityCache = new Map<string, string>();
      const scopeCache = new Map<string, string>();
      let attributesCreated = 0;
      let entitiesCreated = 0;
      let factsInserted = 0;
      const result: PromoteResult["snapshots"] = [];
      const duplicadasPorDados: string[] = [];

      for (const label of labels) {
        const facts = byLabel.get(label)!;
        const vigencia = parseVigenciaLabel(label);
        const effectiveDate = vigencia.effectiveDate!;
        const entityTypes = [...new Set(facts.map((f) => f.entityType))].sort();
        const datasetFamily = datasetFamilyOfSet(entityTypes);
        // O conjunto de tipos da vigência gravada. Começa sendo o que o arquivo
        // trouxe e cresce com o que for herdado da revisão anterior — uma
        // revisão que carrega as carretas junto precisa *dizer* que cobre
        // carretas, ou as telas que listam as séries a partir daqui perdem uma
        // delas enquanto os fatos dela estão presentes.
        let tiposDaVigencia = entityTypes;
        const canal = normalizeChannel(vigencia.channel ?? label);

        // --- escopo -------------------------------------------------------
        const scopeIds = await resolveScopes(tx, facts, scopeCache);
        const scopeHash = hashScopeSet(scopeIds.descriptors);
        const canonicalScope = canonicalScopeOf(scopeIds.entries);

        const faltando = missingRequiredScopeTypes(canonicalScope);
        if (faltando.length > 0) {
          throw new PromocaoRecusada(
            `A vigência ${label} não declara ${faltando.join(", ")}, que é o que identifica de quem é a remuneração. ` +
              `Sem esse componente, duas unidades diferentes teriam a mesma identidade. Corrija a origem e envie o arquivo de novo.`,
            "ESCOPO_OBRIGATORIO_AUSENTE",
            "VALIDATION_ERROR",
            { label, faltando, escopoEncontrado: canonicalScope },
          );
        }

        const canonicalKey = canonicalSnapshotKey({
          sourceSystem: "FREIGHTEC",
          datasetFamily,
          channel: canal,
          effectiveDate,
          scope: canonicalScope,
        });

        // 2. travar a identidade de negócio.
        //
        // Advisory lock de transação, e não um mutex em memória: há mais de uma
        // instância do servidor, e um mutex por processo não vê a outra. Duas
        // promoções da mesma vigência serializam aqui; a segunda só olha o que
        // está ativo depois que a primeira comitou.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${canonicalKey}, 0))`,
        );

        // 3. o que já está ativo para esta identidade
        const [live] = await tx
          .select()
          .from(snapshotTable)
          .where(
            and(
              eq(snapshotTable.canonicalSnapshotKey, canonicalKey),
              sql`${snapshotTable.status} <> 'SUPERSEDED'`,
            ),
          );

        const incomingFacts: CanonicalFact[] = facts.map((f) => ({
          entityType: f.entityType,
          entityKey: f.entityKey,
          attributeCode: f.attributeCode,
          valueNumeric: f.valueNumeric,
          valueText: f.valueText,
          valueBoolean: f.valueBoolean,
          valueDate: f.valueDate,
          isNull: f.isNull,
        }));

        let revision = 1;
        let supersedes: string | null = null;
        let herdarDe: string | null = null;

        if (live) {
          const liveFacts = await fatosCanonicosDoSnapshot(tx, live.id);
          const tiposVivos = new Set(liveFacts.map((f) => f.entityType));
          const tiposEntrando = new Set(entityTypes);
          const preservados = liveFacts.filter((f) => !tiposEntrando.has(f.entityType));

          // O conteúdo que existiria depois de gravar: o que chega, mais o que
          // a vigência ativa já tinha e este arquivo não toca.
          const payloadResultante = canonicalPayloadHash([...incomingFacts, ...preservados]);
          const payloadVivo = canonicalPayloadHash(liveFacts);

          if (payloadResultante === payloadVivo) {
            duplicadasPorDados.push(label);
            await registrarDecisao(tx, {
              importRunId,
              decisao: "DUPLICATA_DE_DADOS",
              motivo:
                `O arquivo é diferente, mas os dados normalizados da vigência ${label} são iguais aos que já estão ativos ` +
                `(revisão ${live.revision}). Nenhuma revisão foi aberta e nada foi duplicado.`,
              filename: file?.filename ?? null,
              contentSha256: file?.contentSha256 ?? null,
              canonicalPayloadHash: payloadResultante,
              canonicalSnapshotKey: canonicalKey,
              sourceLabel: label,
              effectiveDate,
              canal,
              datasetFamily,
              canonicalScope,
              snapshotId: live.id,
              revisionEncontrada: live.revision,
            });
            continue;
          }

          const sobrepostos = [...tiposEntrando].filter((t) => tiposVivos.has(t));
          if (sobrepostos.length > 0 && mode !== "NEW_REVISION") {
            throw new PromocaoRecusada(
              `Já existe uma versão ativa da vigência ${label} para este escopo (revisão ${live.revision}), ` +
                `e este arquivo reescreve ${sobrepostos.join(", ")}. Para substituir os dados, registre uma correção.`,
              "VIGENCIA_ATIVA_EXISTENTE",
              "PREVIEWED",
              {
                label,
                revisionAtiva: live.revision,
                snapshotAtivo: live.id,
                tiposSobrepostos: sobrepostos,
              },
            );
          }

          revision = live.revision + 1;
          supersedes = live.id;
          herdarDe = live.id;
          tiposDaVigencia = [
            ...new Set([...entityTypes, ...preservados.map((f) => f.entityType)]),
          ].sort();

          // A anterior sai de cena **antes** de a nova entrar.
          //
          // O índice único que garante "uma ativa por identidade" é parcial —
          // `WHERE status <> 'SUPERSEDED'` — e DRAFT não é SUPERSEDED. Inserir
          // a revisão nova enquanto a anterior ainda está ativa esbarra no
          // próprio índice que protege a invariante. Aqui não há janela: as
          // duas escritas estão na mesma transação, e a identidade está travada
          // pelo advisory lock desde antes da leitura.
          await tx
            .update(snapshotTable)
            .set({ status: "SUPERSEDED" })
            .where(eq(snapshotTable.id, live.id));
        }

        const [snapshot] = await tx
          .insert(snapshotTable)
          .values({
            sourceFileId: run.sourceFileId,
            importRunId,
            sourceSystem: "FREIGHTEC",
            sourceLabel: label,
            effectiveDate,
            scopeHash,
            entityTypeSet: tiposDaVigencia.join("+"),
            datasetFamily,
            canal,
            canonicalScope,
            revision,
            supersedesSnapshotId: supersedes,
            status: "DRAFT",
          })
          .returning();

        if (scopeIds.ids.length > 0) {
          await tx
            .insert(snapshotScopeTable)
            .values(scopeIds.ids.map((scopeId) => ({ snapshotId: snapshot.id, scopeId })));
        }

        // --- atributos ----------------------------------------------------
        for (const code of new Set(facts.map((f) => f.attributeCode))) {
          if (attributeCache.has(code)) continue;
          const sample = facts.find((f) => f.attributeCode === code)!;
          const existing = await tx
            .select()
            .from(attributeTable)
            .where(eq(attributeTable.code, code));
          if (existing.length > 0) {
            attributeCache.set(code, existing[0].id);
            continue;
          }
          const sourceName = await sourceNameFor(tx, sample.rawCellId);
          const [created] = await tx
            .insert(attributeTable)
            .values({
              code,
              sourceName,
              displayName: sourceName,
              entityType: sample.entityType,
              dataType: dataTypeByCode.get(code) ?? "UNKNOWN",
              semanticsStatus: "UNKNOWN",
              firstSeenImportRunId: importRunId,
            })
            .returning();
          attributeCache.set(code, created.id);
          attributesCreated++;

          const sheetName = await sheetNameFor(tx, sample.rawCellId);
          await tx
            .insert(attributeAliasTable)
            .values({
              attributeId: created.id,
              sourceName,
              sourceSheet: sheetName,
              matchConfidence: "1.0000",
              firstSeenImportRunId: importRunId,
            })
            .onConflictDoNothing();
        }

        // --- entidades ------------------------------------------------------
        const entityKeys = new Map<string, { entityType: string; entityKey: string }>();
        for (const fact of facts) {
          entityKeys.set(`${fact.entityType}:${fact.entityKey}`, {
            entityType: fact.entityType,
            entityKey: fact.entityKey,
          });
        }

        for (const [cacheKey, info] of entityKeys) {
          if (entityCache.has(cacheKey)) continue;
          const [existing] = await tx
            .select({ entityId: entityIdentifierTable.entityId })
            .from(entityIdentifierTable)
            .where(
              and(
                eq(entityIdentifierTable.identifierType, "PLACA"),
                eq(entityIdentifierTable.identifierValue, info.entityKey),
                eq(entityIdentifierTable.isCurrent, true),
              ),
            );
          if (existing) {
            entityCache.set(cacheKey, existing.entityId);
            continue;
          }
          const [entity] = await tx
            .insert(entityTable)
            .values({
              entityType: info.entityType,
              firstSeenImportRunId: importRunId,
            })
            .returning();
          await tx.insert(entityIdentifierTable).values({
            entityId: entity.id,
            identifierType: "PLACA",
            identifierValue: info.entityKey,
            identifierValueRaw:
              facts.find(
                (f) => f.entityType === info.entityType && f.entityKey === info.entityKey,
              )?.entityKeyRaw ?? info.entityKey,
            effectiveFrom: effectiveDate,
            isCurrent: true,
            sourceImportRunId: importRunId,
          });
          entityCache.set(cacheKey, entity.id);
          entitiesCreated++;
        }

        await recordChassisIdentifiers(tx, facts, entityCache, effectiveDate, importRunId);

        // --- fatos ------------------------------------------------------------
        const factRows = facts.map((f) => ({
          snapshotId: snapshot.id,
          entityId: entityCache.get(`${f.entityType}:${f.entityKey}`)!,
          attributeId: attributeCache.get(f.attributeCode)!,
          valueNumeric: f.valueNumeric,
          valueText: f.valueText,
          valueBoolean: f.valueBoolean,
          valueDate: f.valueDate,
          valueHash: f.valueHash,
          isNull: f.isNull,
          nullReason: f.nullReason,
          rawCellId: f.rawCellId,
        }));
        await insertChunked(tx, factTable, factRows as never[]);
        factsInserted += factRows.length;

        // Os componentes que a revisão anterior tinha e este arquivo não toca
        // vêm junto. Sem isto, uma correção só de cavalos apagaria as carretas
        // da vigência — que é o preço que se pagaria por ter uma identidade só.
        let herdados = 0;
        if (herdarDe) {
          const tiposEntrando = entityTypes;
          const { rowCount } = (await tx.execute(sql`
            INSERT INTO ${factTable} (
              snapshot_id, entity_id, attribute_id, value_numeric, value_text,
              value_boolean, value_date, value_hash, is_null, null_reason, raw_cell_id,
              inherited_from_snapshot_id
            )
            SELECT ${snapshot.id}::uuid, f.entity_id, f.attribute_id, f.value_numeric, f.value_text,
                   f.value_boolean, f.value_date, f.value_hash, f.is_null, f.null_reason, f.raw_cell_id,
                   ${herdarDe}::uuid
              FROM ${factTable} f
              JOIN ${entityTable} e ON e.id = f.entity_id
             WHERE f.snapshot_id = ${herdarDe}::uuid
               AND e.entity_type <> ALL(${sql.raw(`ARRAY[${tiposEntrando.map((t) => `'${t.replace(/'/g, "''")}'`).join(",") || "NULL"}]::text[]`)})
          `)) as unknown as { rowCount: number };
          herdados = rowCount ?? 0;
          factsInserted += herdados;
        }

        // --- layout -----------------------------------------------------------
        const perAttribute = new Map<
          string,
          { valueCount: number; nullCount: number; rawCellId: number }
        >();
        for (const f of facts) {
          let entry = perAttribute.get(f.attributeCode);
          if (!entry) {
            entry = { valueCount: 0, nullCount: 0, rawCellId: f.rawCellId };
            perAttribute.set(f.attributeCode, entry);
          }
          if (f.isNull) entry.nullCount++;
          else entry.valueCount++;
        }
        const layoutRows = [];
        for (const [code, stats] of perAttribute) {
          const location = await cellLocation(tx, stats.rawCellId);
          layoutRows.push({
            snapshotId: snapshot.id,
            attributeId: attributeCache.get(code)!,
            sourceSheet: location.sheetName,
            columnIndex: location.columnIndex,
            presentInLayout: true,
            valueCount: stats.valueCount,
            nullCount: stats.nullCount,
          });
        }
        await insertChunked(tx, snapshotAttributeTable, layoutRows as never[]);

        // O layout dos componentes herdados vem **depois** do layout do arquivo:
        // o `NOT IN` só consegue excluir o que já está gravado, e invertendo a
        // ordem as duas inserções disputam o mesmo (snapshot, atributo).
        if (herdarDe) {
          await tx.execute(sql`
            INSERT INTO ${snapshotAttributeTable} (
              snapshot_id, attribute_id, source_sheet, column_index,
              present_in_layout, value_count, null_count
            )
            SELECT ${snapshot.id}::uuid, sa.attribute_id, sa.source_sheet, sa.column_index,
                   sa.present_in_layout, sa.value_count, sa.null_count
              FROM ${snapshotAttributeTable} sa
             WHERE sa.snapshot_id = ${herdarDe}::uuid
               AND sa.attribute_id NOT IN (
                 SELECT attribute_id FROM ${snapshotAttributeTable} WHERE snapshot_id = ${snapshot.id}::uuid
               )
          `);
        }

        // --- cobertura --------------------------------------------------------
        /*
          O agregado por equipamento, contado agora e não em leitura.

          É o denominador da matriz de Cobertura de dados: quantos cavalos e
          quantas carretas esta vigência tem, e quantos fatos de cada um vieram
          com valor, vieram vazios e vieram herdados. Perguntar isso depois
          custaria `count(DISTINCT entity_id)` sobre a fact table — 208 ms com
          124 mil fatos, medido no export real, sobre a tabela que é justamente
          a que cresce para milhões.

          Aqui é barato porque os fatos acabaram de ser escritos e a transação
          ainda os tem à mão, e é exato porque conta os fatos em vez de inferir
          a densidade do arquivo. Fica antes do `CLOSED` de propósito: depois
          dele o gatilho `fact_immutable` congela o que esta contagem lê.
        */
        await tx.execute(sql`
          INSERT INTO ${snapshotEntityTypeTable} (
            snapshot_id, entity_type, entity_count, attribute_count,
            fact_count, value_count, null_count, inherited_fact_count
          )
          SELECT ${snapshot.id}::uuid,
                 e.entity_type,
                 count(DISTINCT f.entity_id)::int,
                 count(DISTINCT f.attribute_id)::int,
                 count(*)::int,
                 count(*) FILTER (WHERE NOT f.is_null)::int,
                 count(*) FILTER (WHERE f.is_null)::int,
                 count(*) FILTER (WHERE f.inherited_from_snapshot_id IS NOT NULL)::int
            FROM ${factTable} f
            JOIN ${entityTable} e ON e.id = f.entity_id
           WHERE f.snapshot_id = ${snapshot.id}::uuid
           GROUP BY e.entity_type
              ON CONFLICT (snapshot_id, entity_type) DO NOTHING
        `);

        // --- fechar -----------------------------------------------------------
        const [contagem] = await tx
          .select({
            entidades: sql<number>`count(distinct ${factTable.entityId})`.mapWith(Number),
            fatos: sql<number>`count(*)`.mapWith(Number),
          })
          .from(factTable)
          .where(eq(factTable.snapshotId, snapshot.id));

        const payloadFinal = canonicalPayloadHash(
          await fatosCanonicosDoSnapshot(tx, snapshot.id),
        );

        await tx
          .update(snapshotTable)
          .set({
            status: "CLOSED",
            closedAt: new Date(),
            entityCount: contagem.entidades,
            factCount: contagem.fatos,
            canonicalPayloadHash: payloadFinal,
          })
          .where(eq(snapshotTable.id, snapshot.id));

        if (supersedes) {
          await tx.insert(snapshotMergeTable).values({
            snapshotId: snapshot.id,
            mergedFrom: [supersedes],
            revisoesOriginais: [revision - 1],
            canonicalSnapshotKey: canonicalKey,
            motivo:
              herdados > 0
                ? `Revisão ${revision} da vigência ${label}: o arquivo trouxe ${entityTypes.join("+")} e ${herdados} fatos dos componentes não tocados foram herdados da revisão ${revision - 1}.`
                : `Revisão ${revision} da vigência ${label}, substituindo a revisão ${revision - 1}.`,
          });
        }

        await registrarDecisao(tx, {
          importRunId,
          decisao: supersedes ? "REVISAO_CRIADA" : "PROMOVIDO",
          motivo: supersedes
            ? `Vigência ${label} gravada como revisão ${revision}; a revisão ${revision - 1} passou a SUPERSEDED.`
            : `Vigência ${label} gravada como revisão 1.`,
          filename: file?.filename ?? null,
          contentSha256: file?.contentSha256 ?? null,
          canonicalPayloadHash: payloadFinal,
          canonicalSnapshotKey: canonicalKey,
          sourceLabel: label,
          effectiveDate,
          canal,
          datasetFamily,
          canonicalScope,
          snapshotId: snapshot.id,
          revisionEncontrada: supersedes ? revision - 1 : null,
          revisionCriada: revision,
          detalhe: {
            entityTypeSet: tiposDaVigencia.join("+"),
            tiposDoArquivo: entityTypes,
            fatosHerdados: herdados,
          },
        });

        result.push({
          id: snapshot.id,
          label,
          effectiveDate,
          revision,
          entityCount: contagem.entidades,
          factCount: contagem.fatos,
        });
      }

      /*
        A versão 1 nasce junto do atributo, na mesma transação que o criou.

        Antes disto a semântica versionada de um atributo só existia se alguém
        rodasse `backfillSemantics` — um lote da curadoria que o `dev-seed` e os
        testes chamam, e que nenhum caminho de produção chama nunca. Medido num
        banco com o export real promovido: 138 atributos, 138 sem versão. A
        importação criava metade da verdade e a outra metade ficava esperando
        uma mão que não vinha.

        Aqui, e não junto do `INSERT` de cada atributo, por causa da data: a
        versão inicial cobre a série inteira, e o início da série só está
        completo depois que todas as vigências deste run entraram. Uma chamada
        por promoção também normaliza o começo quando o arquivo é retroativo.

        Não inventa semântica nenhuma: a versão copia o atributo, que acabou de
        nascer `UNKNOWN` e com tudo nulo. Ver `garantirSemanticaInicial`.
      */
      await garantirSemanticaInicial(tx as unknown as Database);

      /*
        A árvore da taxonomia, antes das confirmações — e a ordem é a correção.

        Os 22 nós são estrutura obrigatória: são os mesmos em toda base, e sem
        eles nada tem onde ser classificado. A confirmação canônica que vem
        logo abaixo **vincula** o atributo ao nó (`cf_financiamento`,
        `cf_depreciacao`…), e vincular exige que o nó já exista. Semear depois
        deixaria os 17 atributos do registro confirmados e sem nó, esperando
        uma segunda passada — que é exatamente o que se via no `dev-seed`, onde
        a árvore chega depois e as confirmações precisam ser reaplicadas.

        Medido em 17/08/2026, num banco vazio, importando pela mesma rota que a
        tela chama: zero nós depois da promoção. O único caminho de produção que
        semeava a árvore era um segundo handler de `POST /imports/:id/promote`,
        em `overview.ts`, que o Express nunca alcançava — `importsRouter` é
        montado antes e serve a rota. Aquele handler foi removido junto desta
        correção: um caminho aparente é pior que caminho nenhum, porque quem o
        lê conclui que a curadoria é atualizada a cada promoção.

        `runProposalPass` continua **fora**, e isto é fronteira, não esquecimento:
        propor semântica é inferência do motor, e a promoção só garante o que é
        verdade estrutural do produto.
      */
      const taxonomia = await garantirTaxonomiaCanonica(
        tx as unknown as Database,
        options.promotedBy ?? "import:promocao",
      );

      /*
        E o significado que já é conhecido, na mesma transação.

        A versão 1 nasce aqui desde a correção acima — e nascia dizendo "não
        sei" sobre colunas cujo significado já estava decidido e escrito. O
        registro de `CONFIRMED_SEMANTICS` existe desde 10/08/2026, com a
        medição de cada entrada ao lado; o que não existia era um caminho de
        produção que o aplicasse. Ele era chamado pelo `dev-seed`, pelo
        `curate-report` e pelos testes — nenhum dos três é por onde um arquivo
        da Ambev entra. Medido contra o export de agosto/2026: 62 cavalos com o
        FINAME no banco e 62 cards lendo "não apurado", porque o portão do
        motor exige semântica CONFIRMADA e ninguém a havia carimbado.

        Aqui, e não numa rota nem num script, pelo mesmo argumento que trouxe
        `garantirSemanticaInicial`: promover é o único ponto por onde todo
        arquivo passa. Aplicar depois, fora da transação, deixaria uma janela em
        que a frota inteira lê "não apurado" — e uma falha no meio deixaria a
        base com metade da verdade, que é o estado que este bloco existe para
        não produzir.

        Isto **não decide semântica nenhuma**: replica decisões que uma pessoa
        já tomou, e recusa-se a tocar em atributo que alguém confirmou de outro
        jeito. O que ela deixa de fora volta no resultado, nomeado.
      */
      const confirmacoes = await aplicarConfirmacoesCanonicas(
        tx as unknown as Database,
      );

      /*
        E a classe de custo dos que acabaram de ser classificados.

        Terceira garantia estrutural, na mesma transação e pelo mesmo motivo das
        duas de cima: um atributo confirmado sem classe de custo some das telas
        de custo fixo e variável e da DRE sem uma linha de erro. A passada de
        propostas não o alcança — ela só olha o que **não** está confirmado —, e
        `cavalo.ipva_licenciamento` nasce confirmado pelas confirmações
        canônicas.

        Preenche só o que está vazio: quem decidiu a classe tem valor gravado.
      */
      await garantirClasseDeCustoPadrao(tx as unknown as Database);

      // Um run em que **toda** vigência já existia idêntica não é uma promoção
      // vazia: é uma duplicata de dados, e o estado diz isso.
      const nadaEntrou = result.length === 0 && duplicadasPorDados.length > 0;
      await tx
        .update(importRunTable)
        .set({
          status: nadaEntrou ? "SKIPPED_DUPLICATE_DATA" : "PROMOTED",
          finishedAt: new Date(),
          snapshotCount: result.length,
          failureReason: nadaEntrou
            ? `O arquivo é diferente, mas os dados normalizados já estavam registrados (${duplicadasPorDados.join(", ")}). Nada foi duplicado.`
            : null,
        })
        .where(eq(importRunTable.id, importRunId));

      return {
        snapshotIds: result.map((s) => s.id),
        snapshots: result,
        entitiesCreated,
        attributesCreated,
        factsInserted,
        taxonomia: {
          nosCriados: taxonomia.created,
          nosExistentes: taxonomia.existing,
        },
        semanticasConfirmadas: {
          aplicadas: confirmacoes.applied.length,
          jaConfirmadas: confirmacoes.unchanged.length,
          divergentes: confirmacoes.divergentes,
          incoerentes: confirmacoes.incoerentes,
        },
      };
    });
  } catch (err) {
    // A transação voltou atrás — inclusive o estado do run. A decisão que
    // explica a recusa é gravada aqui fora, senão a recusa some junto e o
    // operador fica com uma tela que não diz nada.
    if (err instanceof PromocaoRecusada) {
      await db
        .update(importRunTable)
        .set({
          status: err.runStatus,
          failureReason: err.message,
          finishedAt: err.runStatus === "VALIDATION_ERROR" ? new Date() : null,
        })
        .where(eq(importRunTable.id, importRunId));
      await registrarDecisao(db, {
        importRunId,
        decisao: err.decisao,
        motivo: err.message,
        sourceLabel: (err.detalhe.label as string) ?? null,
        snapshotId: (err.detalhe.snapshotAtivo as string) ?? null,
        revisionEncontrada: (err.detalhe.revisionAtiva as number) ?? null,
        detalhe: err.detalhe,
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// failure
// ---------------------------------------------------------------------------

/**
 * Close a run that could not be read.
 *
 * A run left in READING or STAGED after the process gave up is worse than a
 * failed one: the screen keeps polling it forever, and the person waits for
 * something that is not coming. The reason travels to the card, so it is
 * stored as it will be read.
 */
export async function markRunFailed(
  db: Database,
  importRunId: string,
  reason: string,
): Promise<void> {
  await db
    .update(importRunTable)
    .set({ status: "FAILED", failureReason: reason, finishedAt: new Date() })
    .where(eq(importRunTable.id, importRunId));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function requireRun(
  db: Database,
  importRunId: string,
  allowed: string[],
): Promise<typeof importRunTable.$inferSelect> {
  const [run] = await db
    .select()
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  if (!run) throw new Error(`Import run ${importRunId} not found.`);
  if (!allowed.includes(run.status)) {
    throw new Error(
      `Import run ${importRunId} is ${run.status}; this step requires ${allowed.join(" or ")}.`,
    );
  }
  return run;
}

/**
 * Resolve each attribute's data type from *every* staged value in the run,
 * not just the first vigência.
 *
 * The real export needs this: `dataFimContrato` arrives date-formatted for 496
 * cavalos rows and as a bare serial for 62 others, in the same column of the
 * same sheet. Judging from one snapshot would label the attribute TEXT and
 * hide the inconsistency; judging from all of them reports MIXED, which is the
 * truth and a curation task.
 */
function resolveDataTypes(
  facts: {
    attributeCode: string;
    valueNumeric: string | null;
    valueText: string | null;
    valueBoolean: boolean | null;
    valueDate: string | null;
    isNull: boolean;
  }[],
): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const f of facts) {
    if (f.isNull) continue;
    let bucket = seen.get(f.attributeCode);
    if (!bucket) {
      bucket = new Set();
      seen.set(f.attributeCode, bucket);
    }
    if (f.valueNumeric !== null) bucket.add("NUMERIC");
    else if (f.valueBoolean !== null) bucket.add("BOOLEAN");
    else if (f.valueDate !== null) bucket.add("DATE");
    else if (f.valueText !== null) bucket.add("TEXT");
  }
  const resolved = new Map<string, string>();
  for (const [code, types] of seen) {
    resolved.set(code, types.size === 1 ? [...types][0] : "MIXED");
  }
  return resolved;
}

async function sourceNameFor(tx: Database, rawCellId: number): Promise<string> {
  const [cell] = await tx
    .select({ header: rawCellTable.columnHeader })
    .from(rawCellTable)
    .where(eq(rawCellTable.id, rawCellId));
  return cell?.header ?? "(unknown)";
}

async function sheetNameFor(tx: Database, rawCellId: number): Promise<string> {
  const [row] = await tx
    .select({ sheetName: rawSheetTable.sheetName })
    .from(rawCellTable)
    .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
    .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
    .where(eq(rawCellTable.id, rawCellId));
  return row?.sheetName ?? "(unknown)";
}

async function cellLocation(
  tx: Database,
  rawCellId: number,
): Promise<{ sheetName: string; columnIndex: number }> {
  const [row] = await tx
    .select({
      sheetName: rawSheetTable.sheetName,
      columnIndex: rawCellTable.columnIndex,
    })
    .from(rawCellTable)
    .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
    .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
    .where(eq(rawCellTable.id, rawCellId));
  return {
    sheetName: row?.sheetName ?? "(unknown)",
    columnIndex: row?.columnIndex ?? -1,
  };
}

async function resolveScopes(
  tx: Database,
  facts: (typeof stagedFactTable.$inferSelect)[],
  cache: Map<string, string>,
): Promise<{ ids: string[]; descriptors: string[]; entries: ScopeEntry[] }> {
  const wanted = new Map<string, { scopeType: string; code: string; name: string | null }>();

  for (const [foldedHeader, config] of Object.entries(SCOPE_COLUMNS)) {
    const slug = slugifyColumn(foldedHeader);
    const nameSlug = config.nameColumn ? slugifyColumn(config.nameColumn) : null;
    for (const fact of facts) {
      const suffix = fact.attributeCode.split(".").slice(1).join(".");
      if (suffix !== slug) continue;
      const code = (fact.valueText ?? fact.valueNumeric ?? "").trim();
      if (code === "") continue;
      const name =
        nameSlug === null
          ? null
          : (facts.find(
              (f) =>
                f.entityKey === fact.entityKey &&
                f.entityType === fact.entityType &&
                f.attributeCode.split(".").slice(1).join(".") === nameSlug,
            )?.valueText ?? null);
      wanted.set(`${config.scopeType}:${code}`, {
        scopeType: config.scopeType,
        code,
        name,
      });
    }
  }

  const ids: string[] = [];
  const descriptors: string[] = [];
  // As entradas saem daqui **antes** de virar hash: a identidade canônica
  // normaliza cada código (CNPJ sem máscara, com o zero da frente de volta), e
  // `descriptors` guarda o código como veio, que é o que `scope_hash` sempre
  // usou e o que os snapshots antigos têm gravado.
  const entries: ScopeEntry[] = [];
  for (const [key, info] of [...wanted.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    descriptors.push(key);
    entries.push({ scopeType: info.scopeType, code: info.code });
    const cached = cache.get(key);
    if (cached) {
      ids.push(cached);
      continue;
    }
    const [existing] = await tx
      .select()
      .from(scopeTable)
      .where(
        and(eq(scopeTable.scopeType, info.scopeType), eq(scopeTable.code, info.code)),
      );
    if (existing) {
      cache.set(key, existing.id);
      ids.push(existing.id);
      continue;
    }
    const [created] = await tx
      .insert(scopeTable)
      .values({ scopeType: info.scopeType, code: info.code, name: info.name })
      .returning();
    cache.set(key, created.id);
    ids.push(created.id);
  }

  return { ids, descriptors, entries };
}

/**
 * Deterministic fingerprint of a snapshot's scope set. Part of the business
 * key, so a Camaçari export can never collide with a Recife one.
 */
export function hashScopeSet(descriptors: string[]): string {
  const canonical = [...descriptors].sort().join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Attach CHASSI as a second identifier of the same permanent entity.
 *
 * A chassis already current for a *different* entity is a real-world data
 * problem: it is reported and skipped rather than silently overwriting either
 * side of the conflict.
 */
async function recordChassisIdentifiers(
  tx: Database,
  facts: (typeof stagedFactTable.$inferSelect)[],
  entityCache: Map<string, string>,
  effectiveDate: string,
  importRunId: string,
): Promise<void> {
  const chassisByEntity = new Map<string, string>();
  for (const fact of facts) {
    const suffix = fact.attributeCode.split(".").slice(1).join(".");
    if (suffix !== "chassi" || fact.isNull) continue;
    const value = (fact.valueText ?? "").trim();
    if (value === "") continue;
    chassisByEntity.set(`${fact.entityType}:${fact.entityKey}`, value);
  }

  for (const [cacheKey, chassis] of chassisByEntity) {
    const entityId = entityCache.get(cacheKey);
    if (!entityId) continue;
    const [existing] = await tx
      .select()
      .from(entityIdentifierTable)
      .where(
        and(
          eq(entityIdentifierTable.identifierType, "CHASSI"),
          eq(entityIdentifierTable.identifierValue, chassis),
          eq(entityIdentifierTable.isCurrent, true),
        ),
      );
    if (existing) {
      if (existing.entityId !== entityId) {
        await tx.insert(validationIssueTable).values({
          importRunId,
          severity: "ERROR",
          code: "ENTITY_IDENTIFIER_CONFLICT",
          message: `Chassis ${chassis} is already current for a different entity; identifier not attached.`,
          detail: { chassis, existingEntityId: existing.entityId, entityId },
        });
      }
      continue;
    }
    await tx.insert(entityIdentifierTable).values({
      entityId,
      identifierType: "CHASSI",
      identifierValue: chassis,
      effectiveFrom: effectiveDate,
      isCurrent: true,
      sourceImportRunId: importRunId,
    });
  }
}
