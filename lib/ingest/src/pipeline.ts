import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeAliasTable,
  attributeTable,
  columnMappingTable,
  entityIdentifierTable,
  entityTable,
  factTable,
  importRunTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  scopeTable,
  sentinelRuleTable,
  snapshotAttributeTable,
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
import { parseVigenciaLabel } from "./vigencia";
import { typeCell, type SentinelRule, type SourceCell } from "./values";

/**
 * F1 — ingestion.
 *
 * The pipeline is deliberately five explicit steps rather than one call:
 * receive, capture RAW, stage, preview, promote. A human decision sits
 * between preview and promote, and promote is the only step that touches the
 * canonical layer — inside a single transaction.
 */

/** Columns that become structure rather than facts. */
const GRAIN_COLUMNS = {
  vigencia: "vigencia",
  placa: "placa",
} as const;

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
  const bytes = readFileSync(options.filePath);
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = options.filename ?? options.filePath.split("/").pop()!;

  const [existing] = await db
    .select()
    .from(sourceFileTable)
    .where(eq(sourceFileTable.contentSha256, contentSha256));

  const isDuplicate = Boolean(existing);
  let sourceFileId: string;

  if (existing) {
    sourceFileId = existing.id;
  } else {
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
      .returning();
    sourceFileId = created.id;
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
    })
    .returning();

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

  const knownAliases = await db.select().from(attributeAliasTable);
  const aliasKey = (sourceName: string, sheetName: string) =>
    `${sheetName} ${sourceName}`;
  const aliasIndex = new Map(
    knownAliases.map((a) => [aliasKey(a.sourceName, a.sourceSheet), a]),
  );

  const issues: PendingIssue[] = [];
  const stagedRows: Record<string, unknown>[] = [];
  const labels = new Set<string>();
  let rowsRejected = 0;

  for (const sheet of sheets) {
    const entityType = deriveEntityTypeFromSheet(sheet.sheetName);
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
        folded === GRAIN_COLUMNS.vigencia || folded === GRAIN_COLUMNS.placa;

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
              ? "Grain column: becomes the snapshot (source_label + effective_date), not a fact."
              : "Grain column: becomes the entity identifier (PLACA), not a fact.",
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
    const placaColumn = columns.find((c) => c.folded === GRAIN_COLUMNS.placa);
    if (!vigenciaColumn || !placaColumn) continue;

    // --- rows ---------------------------------------------------------------
    for (const row of rows) {
      if (row.isHeader) continue;
      const bucket = cellsByRow.get(row.id);
      if (!bucket) continue;

      const rawLabel = (bucket.get(vigenciaColumn.columnIndex)?.rawValue ?? "").trim();
      const rawPlaca = (bucket.get(placaColumn.columnIndex)?.rawValue ?? "").trim();

      // A completely blank row is structural padding, not a rejection.
      const hasAnyValue = [...bucket.values()].some(
        (c) => c.rawValue !== null && c.rawValue.trim() !== "",
      );
      if (!hasAnyValue) continue;

      if (rawLabel === "" || rawPlaca === "") {
        rowsRejected++;
        issues.push({
          importRunId,
          rawSheetId: sheet.id,
          rawRowId: row.id,
          severity: "ERROR",
          code: "ROW_MISSING_GRAIN_KEY",
          message: `Row ${row.rowIndex} of "${sheet.sheetName}" is missing ${rawLabel === "" ? "Vigencia" : "Placa"}; rejected.`,
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
          entityKey: rawPlaca,
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

  await insertChunked(db, stagedFactTable, stagedRows as never[]);
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
      stagedFactCount: stagedRows.length,
      errorCount: errors,
      warningCount: warnings,
    })
    .where(eq(importRunTable.id, importRunId));

  return {
    stagedFacts: stagedRows.length,
    errors,
    warnings,
    rowsRejected,
    snapshotLabels: [...labels].sort(),
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

  if (run.status === "STAGED") {
    await db
      .update(importRunTable)
      .set({ status: "PREVIEWED" })
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
}

/**
 * Promote a previewed run into the canonical layer, in one transaction.
 *
 * Everything or nothing: a failure anywhere leaves the canonical layer exactly
 * as it was. Facts are written while the snapshot is still DRAFT and the
 * snapshot is closed last — after which the database itself refuses further
 * writes to it.
 */
export async function promote(
  db: Database,
  importRunId: string,
  options: PromoteOptions = {},
): Promise<PromoteResult> {
  const run = await requireRun(db, importRunId, ["PREVIEWED"]);
  const mode = options.onExistingSnapshot ?? "FAIL";

  return db.transaction(async (tx) => {
    await tx
      .update(importRunTable)
      .set({ status: "PROMOTING" })
      .where(eq(importRunTable.id, importRunId));

    const staged = await tx
      .select()
      .from(stagedFactTable)
      .where(eq(stagedFactTable.importRunId, importRunId));

    // Group by vigência label — one snapshot per label, spanning every entity
    // type present in that vigência.
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

    // Resolved once, from the whole run — see resolveDataTypes.
    const dataTypeByCode = resolveDataTypes(staged);

    const attributeCache = new Map<string, string>();
    const entityCache = new Map<string, string>();
    const scopeCache = new Map<string, string>();
    let attributesCreated = 0;
    let entitiesCreated = 0;
    let factsInserted = 0;
    const result: PromoteResult["snapshots"] = [];

    for (const label of labels) {
      const facts = byLabel.get(label)!;
      const effectiveDate = parseVigenciaLabel(label).effectiveDate!;
      const entityTypes = [...new Set(facts.map((f) => f.entityType))].sort();
      const entityTypeSet = entityTypes.join("+");

      // --- scope ----------------------------------------------------------
      const scopeIds = await resolveScopes(tx, facts, scopeCache);
      const scopeHash = hashScopeSet(scopeIds.descriptors);

      // --- business key ----------------------------------------------------
      const [live] = await tx
        .select()
        .from(snapshotTable)
        .where(
          and(
            eq(snapshotTable.sourceSystem, "FREIGHTEC"),
            eq(snapshotTable.sourceLabel, label),
            eq(snapshotTable.scopeHash, scopeHash),
            eq(snapshotTable.entityTypeSet, entityTypeSet),
            sql`${snapshotTable.status} <> 'SUPERSEDED'`,
          ),
        );

      let revision = 1;
      let supersedes: string | null = null;
      if (live) {
        if (mode === "FAIL") {
          throw new Error(
            `Snapshot already exists for business key ` +
              `(FREIGHTEC, ${label}, scope ${scopeHash.slice(0, 8)}, ${entityTypeSet}) ` +
              `as revision ${live.revision}. Re-import the same vigência with ` +
              `onExistingSnapshot: "NEW_REVISION" to record a correction.`,
          );
        }
        revision = live.revision + 1;
        supersedes = live.id;
        // CLOSED -> SUPERSEDED is the only mutation a closed snapshot accepts.
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
          entityTypeSet,
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

      // --- attributes -------------------------------------------------------
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
            // Semantics start UNKNOWN by construction. Nothing here may enter
            // a financial aggregation until a human confirms it in F2.
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

      // --- entities ---------------------------------------------------------
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
          effectiveFrom: effectiveDate,
          isCurrent: true,
          sourceImportRunId: importRunId,
        });
        entityCache.set(cacheKey, entity.id);
        entitiesCreated++;
      }

      // Chassis: a second identifier for the same permanent entity id.
      await recordChassisIdentifiers(
        tx,
        facts,
        entityCache,
        effectiveDate,
        importRunId,
      );

      // --- facts ------------------------------------------------------------
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
      await insertChunked(tx as unknown as Database, factTable, factRows as never[]);
      factsInserted += factRows.length;

      // --- layout record ----------------------------------------------------
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
      await insertChunked(
        tx as unknown as Database,
        snapshotAttributeTable,
        layoutRows as never[],
      );

      // --- close ------------------------------------------------------------
      const entityCount = entityKeys.size;
      await tx
        .update(snapshotTable)
        .set({
          status: "CLOSED",
          closedAt: new Date(),
          entityCount,
          factCount: factRows.length,
        })
        .where(eq(snapshotTable.id, snapshot.id));

      result.push({
        id: snapshot.id,
        label,
        effectiveDate,
        revision,
        entityCount,
        factCount: factRows.length,
      });
    }

    await tx
      .update(importRunTable)
      .set({
        status: "PROMOTED",
        finishedAt: new Date(),
        snapshotCount: result.length,
      })
      .where(eq(importRunTable.id, importRunId));

    return {
      snapshotIds: result.map((s) => s.id),
      snapshots: result,
      entitiesCreated,
      attributesCreated,
      factsInserted,
    };
  });
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
): Promise<{ ids: string[]; descriptors: string[] }> {
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
  for (const [key, info] of [...wanted.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    descriptors.push(key);
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

  return { ids, descriptors };
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
