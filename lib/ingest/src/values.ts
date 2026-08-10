import {
  excelSerialToDate,
  hasTimeComponent,
  isPlausibleDateSerial,
  toIsoDate,
  toIsoDateTime,
} from "./excel-dates";

/**
 * Turning a spreadsheet cell into a typed value — carefully.
 *
 * The rule that governs this file: absence has kinds, and they are not
 * interchangeable. A blank cell, a cell that never existed, a cell holding a
 * confirmed sentinel and a cell holding a true economic zero are four
 * different facts about the world, and the product's credibility depends on
 * keeping them apart.
 */

/** Kinds of absence. Free-form by design; new ones will surface over time. */
export const NullReason = {
  /** The column exists in the layout, but this row had no cell at all. */
  VALUE_MISSING: "VALUE_MISSING",
  /** A cell exists and is blank or holds an empty string. */
  EMPTY: "EMPTY",
  /** A value that a *confirmed* rule says means "absent". */
  SENTINEL: "SENTINEL",
  /** Present but unreadable as the column's resolved type. */
  INVALID: "INVALID",
} as const;

export type CellType = "n" | "s" | "b" | "d" | "e" | "z";

export interface SourceCell {
  /** SheetJS cell type, or `z` for a cell that does not exist. */
  type: CellType;
  value: unknown;
  /** Excel's formatted text, when available. */
  formatted?: string;
}

export interface TypedValue {
  valueNumeric: string | null;
  valueText: string | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  isNull: boolean;
  nullReason: string | null;
  /** Normalised representation; equality of hashes is equality of values. */
  valueHash: string;
  /** What the value actually turned out to be. */
  resolvedType: "NUMERIC" | "TEXT" | "BOOLEAN" | "DATE" | "TIMESTAMP" | "NULL";
  /** Non-fatal observations for the import report. */
  warnings: ValueWarning[];
}

export interface ValueWarning {
  code:
    | "AMBIGUOUS_DATE_SERIAL"
    | "DATE_WITH_TIME_COMPONENT"
    | "SUSPECTED_SENTINEL"
    | "ERROR_CELL";
  message: string;
}

/** A confirmed sentinel rule. Nothing else may blank a value. */
export interface SentinelRule {
  attributeCode: string | null;
  rawValue: string;
  nullReason: string;
}

export interface TypeCellOptions {
  attributeCode: string;
  columnHeader: string;
  /** Only *confirmed* rules reach here. Suspicions never blank a value. */
  sentinelRules: SentinelRule[];
  /**
   * Values that look like sentinels but have no confirmed rule. Presence here
   * raises a warning and nothing more — the number is stored as the number.
   */
  suspectedSentinelValues?: string[];
}

const NUMERIC_SCALE = 6;

/**
 * Render a number for NUMERIC(18,6) without float artefacts leaking in.
 * Trailing zeros are trimmed so the hash of 5.50 equals the hash of 5.5.
 */
export function toNumericString(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(NUMERIC_SCALE);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

function nullValue(reason: string): Omit<TypedValue, "warnings"> {
  return {
    valueNumeric: null,
    valueText: null,
    valueBoolean: null,
    valueDate: null,
    isNull: true,
    nullReason: reason,
    valueHash: `0:${reason}`,
    resolvedType: "NULL",
  };
}

function findSentinel(
  rules: SentinelRule[],
  attributeCode: string,
  rawValue: string,
): SentinelRule | undefined {
  return rules.find(
    (r) =>
      r.rawValue === rawValue &&
      (r.attributeCode === null || r.attributeCode === attributeCode),
  );
}

/**
 * Convert one cell into a typed value.
 *
 * Never throws: an unreadable cell becomes an INVALID null carrying a warning,
 * so the problem surfaces in the preview instead of aborting the import or,
 * worse, disappearing.
 */
export function typeCell(
  cell: SourceCell,
  options: TypeCellOptions,
): TypedValue {
  const warnings: ValueWarning[] = [];
  const { attributeCode, sentinelRules } = options;

  // A cell that does not exist at all.
  if (cell.type === "z" || cell.value === undefined || cell.value === null) {
    return { ...nullValue(NullReason.VALUE_MISSING), warnings };
  }

  if (cell.type === "e") {
    warnings.push({
      code: "ERROR_CELL",
      message: `Excel error value in column "${options.columnHeader}": ${String(cell.value)}`,
    });
    return { ...nullValue(NullReason.INVALID), warnings };
  }

  const rawText = cell.value instanceof Date ? cell.value.toISOString() : String(cell.value);

  // Confirmed sentinels are the only thing allowed to blank a present value.
  const sentinel = findSentinel(sentinelRules, attributeCode, rawText.trim());
  if (sentinel) {
    return { ...nullValue(sentinel.nullReason), warnings };
  }

  if (cell.type === "b") {
    const bool = Boolean(cell.value);
    return {
      valueNumeric: null,
      valueText: null,
      valueBoolean: bool,
      valueDate: null,
      isNull: false,
      nullReason: null,
      valueHash: `b:${bool}`,
      resolvedType: "BOOLEAN",
      warnings,
    };
  }

  if (cell.type === "d" || cell.value instanceof Date) {
    const date =
      cell.value instanceof Date ? cell.value : excelSerialToDate(Number(cell.value));
    if (!date) {
      warnings.push({
        code: "ERROR_CELL",
        message: `Unreadable date in column "${options.columnHeader}": ${rawText}`,
      });
      return { ...nullValue(NullReason.INVALID), warnings };
    }
    // A time component carries meaning here (12:00:00 vs 23:59:59 appear in
    // the same column), so truncating to a date would destroy information.
    // ISO-8601 text is lossless and still sorts correctly.
    if (hasTimeComponent(date)) {
      const iso = toIsoDateTime(date);
      warnings.push({
        code: "DATE_WITH_TIME_COMPONENT",
        message: `Column "${options.columnHeader}" carries a time component (${iso}); stored as ISO-8601 text to avoid truncation.`,
      });
      return {
        valueNumeric: null,
        valueText: iso,
        valueBoolean: null,
        valueDate: null,
        isNull: false,
        nullReason: null,
        valueHash: `t:${iso}`,
        resolvedType: "TIMESTAMP",
        warnings,
      };
    }
    const iso = toIsoDate(date);
    return {
      valueNumeric: null,
      valueText: null,
      valueBoolean: null,
      valueDate: iso,
      isNull: false,
      nullReason: null,
      valueHash: `d:${iso}`,
      resolvedType: "DATE",
      warnings,
    };
  }

  if (cell.type === "n") {
    const num = Number(cell.value);
    if (!Number.isFinite(num)) {
      warnings.push({
        code: "ERROR_CELL",
        message: `Non-finite number in column "${options.columnHeader}": ${rawText}`,
      });
      return { ...nullValue(NullReason.INVALID), warnings };
    }
    // Looks like it could be a date serial in a column named like a date, but
    // the file did not type it as one. Flag it; do not convert it.
    const headerLooksTemporal = /\b(data|date|dt)\b/i.test(
      options.columnHeader.replace(/([a-z])([A-Z])/g, "$1 $2"),
    );
    if (headerLooksTemporal && isPlausibleDateSerial(num)) {
      const asDate = excelSerialToDate(num);
      warnings.push({
        code: "AMBIGUOUS_DATE_SERIAL",
        message:
          `Column "${options.columnHeader}" holds ${num}, which is a plausible Excel date serial` +
          (asDate ? ` (${toIsoDateTime(asDate)})` : "") +
          ` but the file did not format it as a date. Stored as NUMERIC pending curation.`,
      });
    }
    if (options.suspectedSentinelValues?.includes(rawText.trim())) {
      warnings.push({
        code: "SUSPECTED_SENTINEL",
        message: `Column "${options.columnHeader}" holds ${rawText}, which may mean "not applicable". Stored as NUMERIC; needs a confirmed sentinel rule before it can be treated as absent.`,
      });
    }
    const numeric = toNumericString(num);
    return {
      valueNumeric: numeric,
      valueText: null,
      valueBoolean: null,
      valueDate: null,
      isNull: false,
      nullReason: null,
      valueHash: `n:${numeric}`,
      resolvedType: "NUMERIC",
      warnings,
    };
  }

  // Text.
  const text = rawText;
  if (text.trim() === "") {
    return { ...nullValue(NullReason.EMPTY), warnings };
  }
  return {
    valueNumeric: null,
    valueText: text,
    valueBoolean: null,
    valueDate: null,
    isNull: false,
    nullReason: null,
    valueHash: `s:${text}`,
    resolvedType: "TEXT",
    warnings,
  };
}
