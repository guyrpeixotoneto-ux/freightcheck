import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  importRunTable,
  rawSheetTable,
  snapshotTable,
  sourceFileTable,
  stagedFactTable,
} from "@workspace/db";
import { parseVigenciaLabel } from "./vigencia";

/**
 * Import history, read-only.
 *
 * What a person wants to know here is whether a file arrived, what came out of
 * it, and what the pipeline complained about — with the SHA-256 in view,
 * because that is what makes "we already have this file" a fact rather than an
 * opinion.
 *
 * The counters come from `import_run` itself, written by the pipeline as it
 * ran. Recomputing them from RAW would be both slower and less honest: what
 * matters is what that run actually produced, not what a query says today.
 */

export interface ImportRunSummary {
  importRunId: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  triggeredBy: string | null;
  failureReason: string | null;
  filename: string;
  byteSize: number;
  contentSha256: string;
  receivedAt: Date;
  receivedBy: string | null;
  sheets: number;
  rawRows: number;
  rawCells: number;
  stagedFacts: number;
  snapshots: number;
  errors: number;
  warnings: number;
  /** Vigências this run produced, oldest first. */
  labels: string[];
}

/**
 * The one shape of "a run, as a person reads it".
 *
 * List and detail answer the same question about a different number of runs,
 * so they select the same columns. Two copies of this projection would drift,
 * and the drift would show up as a card whose numbers change when you open it.
 */
function selectRunSummary(db: Database) {
  return db
    .select({
      importRunId: importRunTable.id,
      status: importRunTable.status,
      startedAt: importRunTable.startedAt,
      finishedAt: importRunTable.finishedAt,
      triggeredBy: importRunTable.triggeredBy,
      failureReason: importRunTable.failureReason,
      sheets: importRunTable.rawSheetCount,
      rawRows: importRunTable.rawRowCount,
      rawCells: importRunTable.rawCellCount,
      stagedFacts: importRunTable.stagedFactCount,
      snapshots: importRunTable.snapshotCount,
      errors: importRunTable.errorCount,
      warnings: importRunTable.warningCount,
      filename: sourceFileTable.filename,
      byteSize: sourceFileTable.byteSize,
      contentSha256: sourceFileTable.contentSha256,
      receivedAt: sourceFileTable.receivedAt,
      receivedBy: sourceFileTable.receivedBy,
      labels: sql<string[]>`
        coalesce(
          array(
            SELECT s.source_label FROM snapshot s
             WHERE s.import_run_id = ${importRunTable.id}
             ORDER BY s.effective_date
          ),
          '{}'
        )`,
    })
    .from(importRunTable)
    .innerJoin(sourceFileTable, eq(sourceFileTable.id, importRunTable.sourceFileId));
}

export async function listImportRuns(db: Database): Promise<ImportRunSummary[]> {
  return selectRunSummary(db).orderBy(desc(importRunTable.startedAt));
}

/** One run, or null when no run carries that id. */
export async function getImportRun(
  db: Database,
  importRunId: string,
): Promise<ImportRunSummary | null> {
  const [run] = await selectRunSummary(db).where(
    eq(importRunTable.id, importRunId),
  );
  return run ?? null;
}

/**
 * What a run has produced so far — the answer to a poll while it is running.
 *
 * `labels` comes from the staged facts, not from `snapshot`: before promotion
 * no snapshot exists, and a screen that read the snapshot count would show
 * zero vigências for a file that in fact carries nine. After promotion the
 * staged rows are still there, so the same query keeps telling the truth.
 */
export interface ImportRunStatus {
  importRunId: string;
  status: string;
  /** Qual arquivo é este: dois envios de uma vez são dois cartões iguais sem ele. */
  filename: string;
  failureReason: string | null;
  sheets: number;
  rawCells: number;
  facts: number;
  snapshots: number;
  errors: number;
  warnings: number;
  labels: string[];
}

export async function getImportRunStatus(
  db: Database,
  importRunId: string,
): Promise<ImportRunStatus | null> {
  const [run] = await db
    .select({
      id: importRunTable.id,
      status: importRunTable.status,
      failureReason: importRunTable.failureReason,
      rawSheetCount: importRunTable.rawSheetCount,
      rawCellCount: importRunTable.rawCellCount,
      stagedFactCount: importRunTable.stagedFactCount,
      snapshotCount: importRunTable.snapshotCount,
      errorCount: importRunTable.errorCount,
      warningCount: importRunTable.warningCount,
      filename: sourceFileTable.filename,
    })
    .from(importRunTable)
    .innerJoin(sourceFileTable, eq(sourceFileTable.id, importRunTable.sourceFileId))
    .where(eq(importRunTable.id, importRunId));
  if (!run) return null;

  const staged = await db
    .selectDistinct({ label: stagedFactTable.snapshotLabel })
    .from(stagedFactTable)
    .where(eq(stagedFactTable.importRunId, importRunId));

  const labels = staged
    .map((row) => row.label)
    // Ordenar por data, e não pelo texto: EMPURRADA_2_12_2025 vem antes de
    // EMPURRADA_2_1_2026 no calendário e depois dele no alfabeto.
    .sort((a, b) =>
      (parseVigenciaLabel(a).effectiveDate ?? a).localeCompare(
        parseVigenciaLabel(b).effectiveDate ?? b,
      ),
    );

  return {
    importRunId: run.id,
    status: run.status,
    filename: run.filename,
    failureReason: run.failureReason,
    sheets: run.rawSheetCount,
    rawCells: run.rawCellCount,
    facts: run.stagedFactCount,
    snapshots: run.snapshotCount,
    errors: run.errorCount,
    warnings: run.warningCount,
    labels,
  };
}

/** Sheets of one run, with the reason each was or was not treated as a source. */
export async function getImportRunSheets(db: Database, importRunId: string) {
  return db
    .select({
      sheetName: rawSheetTable.sheetName,
      role: rawSheetTable.role,
      roleReason: rawSheetTable.roleReason,
      rowCount: rawSheetTable.rowCount,
      columnCount: rawSheetTable.columnCount,
      headerRowIndex: rawSheetTable.headerRowIndex,
    })
    .from(rawSheetTable)
    .where(eq(rawSheetTable.importRunId, importRunId))
    .orderBy(rawSheetTable.sheetIndex);
}

/** Vigências of one run, for the detail view. */
export async function getImportRunSnapshots(db: Database, importRunId: string) {
  return db
    .select({
      id: snapshotTable.id,
      sourceLabel: snapshotTable.sourceLabel,
      effectiveDate: snapshotTable.effectiveDate,
      entityCount: snapshotTable.entityCount,
      factCount: snapshotTable.factCount,
      status: snapshotTable.status,
      revision: snapshotTable.revision,
    })
    .from(snapshotTable)
    .where(eq(snapshotTable.importRunId, importRunId))
    .orderBy(snapshotTable.effectiveDate);
}
