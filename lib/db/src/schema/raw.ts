import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  bigserial,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { importRunStatus, sheetRole } from "./enums";

/**
 * RAW layer — the documentary evidence.
 *
 * INVARIANT: every table in this file is append-only. UPDATE and DELETE are
 * blocked by database triggers (see migration `0001_raw_immutability`), not by
 * application convention. If the parser improves, we re-derive STAGING and
 * CANONICAL from RAW; RAW itself is never rewritten.
 */

/**
 * A file as received. Deduplicated by content hash.
 *
 * `source_file` is deliberately NOT the same thing as an import attempt, and
 * neither is the same thing as a snapshot: one file may be processed many
 * times (import_run) and may contain many vigências (snapshot).
 */
export const sourceFileTable = pgTable(
  "source_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    /** SHA-256 of the exact bytes received. First line of idempotency defence. */
    contentSha256: text("content_sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    mimeType: text("mime_type"),
    /** Where the untouched original is preserved. Never overwritten. */
    storagePath: text("storage_path").notNull(),
    sourceSystem: text("source_system").notNull().default("FREIGHTEC"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    receivedBy: text("received_by"),
  },
  (t) => [uniqueIndex("source_file_sha256_uq").on(t.contentSha256)],
);

/**
 * One attempt at processing one file. Failed attempts are kept: "nunca
 * descarte silenciosamente" applies to our own operations too.
 */
export const importRunTable = pgTable(
  "import_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFileTable.id),
    status: importRunStatus("status").notNull().default("PENDING"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    triggeredBy: text("triggered_by"),
    rawSheetCount: integer("raw_sheet_count").notNull().default(0),
    rawRowCount: integer("raw_row_count").notNull().default(0),
    rawCellCount: integer("raw_cell_count").notNull().default(0),
    stagedFactCount: integer("staged_fact_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    /** Populated on promotion; how many snapshots this run produced. */
    snapshotCount: integer("snapshot_count").notNull().default(0),
    failureReason: text("failure_reason"),
  },
  (t) => [index("import_run_source_file_idx").on(t.sourceFileId)],
);

/**
 * A worksheet inside the file. Pivot tables are captured in RAW like
 * everything else — they are evidence — but `role` keeps them out of the
 * canonical fact stream.
 */
export const rawSheetTable = pgTable(
  "raw_sheet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id),
    sheetName: text("sheet_name").notNull(),
    sheetIndex: integer("sheet_index").notNull(),
    rowCount: integer("row_count").notNull(),
    columnCount: integer("column_count").notNull(),
    role: sheetRole("role").notNull(),
    /** Why the classifier decided this role. Auditable, never a bare guess. */
    roleReason: text("role_reason").notNull(),
    headerRowIndex: integer("header_row_index"),
  },
  (t) => [
    uniqueIndex("raw_sheet_run_index_uq").on(t.importRunId, t.sheetIndex),
    index("raw_sheet_run_idx").on(t.importRunId),
  ],
);

export const rawRowTable = pgTable(
  "raw_row",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rawSheetId: uuid("raw_sheet_id")
      .notNull()
      .references(() => rawSheetTable.id),
    /** 1-based physical row number in the worksheet, as a human would count it. */
    rowIndex: integer("row_index").notNull(),
    isHeader: boolean("is_header").notNull().default(false),
  },
  (t) => [uniqueIndex("raw_row_sheet_index_uq").on(t.rawSheetId, t.rowIndex)],
);

/**
 * The end of the traceability chain. Every canonical number must be able to
 * point at exactly one of these rows.
 */
export const rawCellTable = pgTable(
  "raw_cell",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rawRowId: bigint("raw_row_id", { mode: "number" })
      .notNull()
      .references(() => rawRowTable.id),
    /** 0-based position, and the spreadsheet letter, so a human can find it. */
    columnIndex: integer("column_index").notNull(),
    columnLetter: text("column_letter").notNull(),
    /** Header text exactly as it appears in the file — never normalised. */
    columnHeader: text("column_header"),
    /** The value as text, always. Typing happens in STAGING, not here. */
    rawValue: text("raw_value"),
    /**
     * SheetJS cell type as delivered: n | s | b | d | e | z.
     * Kept because the file mixes representations for the same concept
     * (e.g. dates arriving both as `d` and as a bare `n` serial).
     */
    sourceType: text("source_type").notNull(),
    /** Excel's own formatted text, when present. Useful for date forensics. */
    formattedText: text("formatted_text"),
  },
  (t) => [
    uniqueIndex("raw_cell_row_column_uq").on(t.rawRowId, t.columnIndex),
    index("raw_cell_row_idx").on(t.rawRowId),
  ],
);
