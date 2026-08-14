import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  bigserial,
  boolean,
  numeric,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { issueSeverity, mappingStatus, stagedFactStatus } from "./enums";
import { importRunTable, rawCellTable, rawRowTable, rawSheetTable } from "./raw";
import { attributeTable } from "./canonical";

/**
 * STAGING layer — typed, validated, and disposable.
 *
 * Everything here is derived from RAW and can be thrown away and rebuilt.
 * What it must never do is hide a problem: a cell the parser could not read
 * confidently produces a `validation_issue`, not a silent NULL.
 */

/** One spreadsheet column resolved (or not) to a canonical attribute. */
export const columnMappingTable = pgTable(
  "column_mapping",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id),
    rawSheetId: uuid("raw_sheet_id")
      .notNull()
      .references(() => rawSheetTable.id),
    columnIndex: integer("column_index").notNull(),
    columnHeader: text("column_header").notNull(),
    targetAttributeId: uuid("target_attribute_id").references(
      () => attributeTable.id,
    ),
    status: mappingStatus("status").notNull(),
    /** Type the reader inferred from the column's own values. */
    resolvedDataType: text("resolved_data_type"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    note: text("note"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("column_mapping_sheet_column_uq").on(
      t.rawSheetId,
      t.columnIndex,
    ),
    index("column_mapping_run_idx").on(t.importRunId),
    index("column_mapping_attribute_idx").on(t.targetAttributeId),
  ],
);

/**
 * A typed candidate fact, still keyed by the source's own vocabulary
 * (vigência label, plate, column name) rather than by canonical ids.
 */
export const stagedFactTable = pgTable(
  "staged_fact",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id),
    rawCellId: bigint("raw_cell_id", { mode: "number" })
      .notNull()
      .references(() => rawCellTable.id),

    /** Business keys as they appear in the file. */
    snapshotLabel: text("snapshot_label").notNull(),
    /**
   * A placa **normalizada** — sem hífen, sem espaço, em caixa alta.
   *
   * `ABC-1D23`, `abc1d23` e ` ABC 1D23 ` são o mesmo veículo e não podem virar
   * duas entidades. O valor como veio escrito fica em `entityKeyRaw`.
   */
  entityKey: text("entity_key").notNull(),
  /** A placa exatamente como estava na célula. Evidência, não identidade. */
  entityKeyRaw: text("entity_key_raw"),
    entityType: text("entity_type").notNull(),
    attributeCode: text("attribute_code").notNull(),

    valueNumeric: numeric("value_numeric", { precision: 18, scale: 6 }),
    valueText: text("value_text"),
    valueBoolean: boolean("value_boolean"),
    valueDate: date("value_date", { mode: "string" }),
    valueHash: text("value_hash").notNull(),
    isNull: boolean("is_null").notNull().default(false),
    nullReason: text("null_reason"),

    status: stagedFactStatus("status").notNull().default("VALID"),
  },
  (t) => [
    uniqueIndex("staged_fact_grain_uq").on(
      t.importRunId,
      t.snapshotLabel,
      t.entityType,
      t.entityKey,
      t.attributeCode,
    ),
    index("staged_fact_run_idx").on(t.importRunId),
    /* Conferida a cada célula RAW apagada — ver o comentário em `fact`. */
    index("staged_fact_raw_cell_idx").on(t.rawCellId),
    index("staged_fact_run_label_idx").on(t.importRunId, t.snapshotLabel),
  ],
);

/**
 * Anything the reader could not do confidently. Visible in the preview,
 * never swallowed.
 */
export const validationIssueTable = pgTable(
  "validation_issue",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id),
    rawSheetId: uuid("raw_sheet_id").references(() => rawSheetTable.id),
    rawRowId: bigint("raw_row_id", { mode: "number" }).references(
      () => rawRowTable.id,
    ),
    rawCellId: bigint("raw_cell_id", { mode: "number" }).references(
      () => rawCellTable.id,
    ),
    severity: issueSeverity("severity").notNull(),
    /** Stable machine code, e.g. AMBIGUOUS_DATE_SERIAL. */
    code: text("code").notNull(),
    message: text("message").notNull(),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("validation_issue_run_idx").on(t.importRunId),
    /* As três ligações com RAW, pelo mesmo motivo. */
    index("validation_issue_sheet_idx").on(t.rawSheetId),
    index("validation_issue_row_idx").on(t.rawRowId),
    index("validation_issue_cell_idx").on(t.rawCellId),
    index("validation_issue_run_code_idx").on(t.importRunId, t.code),
  ],
);

/**
 * Confirmed sentinel values — and only confirmed ones.
 *
 * The importer applies a rule from this table and nothing else. A suspicious
 * value with no rule (a lone `-1` in a percentage column) is stored as the
 * number it is and raises SUSPECTED_SENTINEL for a human to adjudicate.
 * Guessing here would quietly corrupt every average downstream.
 */
export const sentinelRuleTable = pgTable(
  "sentinel_rule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** NULL = applies to every attribute; otherwise scoped to one. */
    attributeCode: text("attribute_code"),
    /** Raw textual value that means "absent", e.g. "-1". */
    rawValue: text("raw_value").notNull(),
    /** What the absence means: SENTINEL | NOT_APPLICABLE | INVALID | ... */
    nullReason: text("null_reason").notNull(),
    note: text("note"),
    confirmedBy: text("confirmed_by").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sentinel_rule_scope_uq").on(t.attributeCode, t.rawValue),
    index("sentinel_rule_value_idx").on(t.rawValue),
  ],
);
