import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  importRunTable,
  rawSheetTable,
  snapshotTable,
  sourceFileTable,
  stagedFactTable,
} from "@workspace/db";
import { identidadesPendentes } from "./pipeline";
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
  /**
   * O tipo declarado no envio — a aba da tela em que o arquivo foi escolhido.
   *
   * `null` em toda importação anterior à declaração, e nas que entram por CLI.
   */
  declaredType: string | null;
  /**
   * Os tipos que esta importação de fato produziu, lidos das vigências dela.
   *
   * Não é o mesmo que {@link declaredType}, e a diferença é o ponto: a
   * declaração é o que se disse antes de ler o arquivo; isto é o que saiu dele.
   * Uma importação promovida antes de a declaração existir tem só a segunda —
   * e é por ela que a aba do tipo recorta o histórico antigo.
   *
   * Vazio quando a importação não produziu vigência nenhuma. Isso não é um
   * detalhe de implementação: é a resposta honesta para o arquivo que entrou e
   * não virou nada, que antes ficava indistinguível de um arquivo cheio.
   */
  entityTypes: string[];
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
      declaredType: importRunTable.declaredType,
      /*
        Os tipos saem de `snapshot.entity_type_set`, que já está sendo lido
        aqui ao lado para os rótulos. A alternativa seria um DISTINCT sobre
        `staged_fact` — dezenas de milhares de linhas por importação, uma vez
        por cartão da lista — para responder a mesma pergunta.
      */
      entityTypes: sql<string[]>`
        coalesce(
          array(
            SELECT DISTINCT btrim(t)
              FROM snapshot s,
                   unnest(string_to_array(s.entity_type_set, '+')) AS t
             WHERE s.import_run_id = ${importRunTable.id}
               AND btrim(t) <> ''
             ORDER BY 1
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
  /** O tipo declarado no envio, para o cartão dizer por qual aba ele entrou. */
  declaredType: string | null;
  sheets: number;
  rawCells: number;
  facts: number;
  snapshots: number;
  errors: number;
  warnings: number;
  labels: string[];
  /**
   * Equipamentos que esta importação criaria e o dicionário não conhece.
   *
   * Vazio no caso comum. Preenchido, a promoção recusa até serem declarados —
   * a tela precisa saber disso enquanto ainda dá para decidir, e não descobrir
   * pela recusa depois do clique.
   */
  pendingIdentities: string[];
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
      declaredType: importRunTable.declaredType,
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
    declaredType: run.declaredType,
    sheets: run.rawSheetCount,
    rawCells: run.rawCellCount,
    facts: run.stagedFactCount,
    snapshots: run.snapshotCount,
    errors: run.errorCount,
    warnings: run.warningCount,
    labels,
    pendingIdentities: await identidadesPendentes(db, importRunId),
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
