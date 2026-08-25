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
 * `attributeCode` is `${entityType}.${slug}` (see `pipeline.ts`); only the
 * slug says what kind of field this is.
 */
function fieldSlug(attributeCode: string): string {
  const dot = attributeCode.lastIndexOf(".");
  return dot === -1 ? attributeCode : attributeCode.slice(dot + 1);
}

/**
 * Columns whose *name* declares them a date, via `slugifyColumn` — e.g.
 * `dataFimContrato` becomes `data_fim_contrato`. Only these get a bare number
 * auto-converted into a date: converting anything with a temporal-*sounding*
 * header (see `AMBIGUOUS_DATE_SERIAL` below) would risk turning a price or a
 * plate into a date the moment it happens to fall in the plausible range.
 */
const KNOWN_DATE_FIELD_SLUGS = new Set([
  "data",
  "data_fim_contrato",
  "data_inicio_contrato",
  "vigencia",
  "competencia",
]);

function isKnownDateField(attributeCode: string): boolean {
  return KNOWN_DATE_FIELD_SLUGS.has(fieldSlug(attributeCode));
}

/**
 * A bare number written as text — "44805", "44805.5", "44805,5" — the shape
 * a text-typed cell uses for what is really an Excel serial. A real date
 * string such as "01/09/2022" or "2022-09-01" does not match this and falls
 * through to ordinary text handling, unchanged.
 */
function parseNumericSerialText(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+([.,]\d+)?$/.test(trimmed)) return null;
  const num = Number(trimmed.replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

/**
 * A date-only result for a field whose domain is a date, not an instant —
 * `data`, `dataFimContrato` and friends. The fractional day (time of day) on
 * an Excel serial is dropped rather than kept as a timestamp: these columns
 * exist to say *which day*, and `2022-09-01T12:00:00Z` reading back as
 * `2022-08-31` or `2022-09-02` under a reader's timezone is exactly the
 * failure date-only storage exists to prevent.
 */
function dateOnlyResult(date: Date): Omit<TypedValue, "warnings"> {
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
  };
}

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
      message:
        `A célula da coluna "${options.columnHeader}" traz um erro do Excel ` +
        `(${String(cell.value)}); o valor entrou como vazio, marcado como inválido.`,
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
        message:
          `A data na coluna "${options.columnHeader}" não pôde ser lida ` +
          `(${rawText}); o valor entrou como vazio, marcado como inválido.`,
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
        message:
          `A coluna "${options.columnHeader}" traz data com horário (${iso}); ` +
          `o valor foi guardado completo, como texto, para o horário não se perder.`,
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
        message:
          `O número na coluna "${options.columnHeader}" não é um número válido ` +
          `(${rawText}); o valor entrou como vazio, marcado como inválido.`,
      });
      return { ...nullValue(NullReason.INVALID), warnings };
    }
    // The column's own name says it holds a date (e.g. `dataFimContrato`),
    // and the file just didn't format the cell as one — a bare serial like
    // 46935.5. Convert it: this is the one case where a number becomes a
    // date without a human confirming it first.
    if (isKnownDateField(attributeCode) && isPlausibleDateSerial(num)) {
      const asDate = excelSerialToDate(num);
      if (asDate) {
        return { ...dateOnlyResult(asDate), warnings };
      }
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
          `A coluna "${options.columnHeader}" traz ${num}, que pode ser uma data ` +
          `do Excel${asDate ? ` (${toIsoDateTime(asDate)})` : ""}, mas o arquivo ` +
          `não a formatou como data. Guardado como número até a curadoria decidir.`,
      });
    }
    if (options.suspectedSentinelValues?.includes(rawText.trim())) {
      warnings.push({
        code: "SUSPECTED_SENTINEL",
        message:
          `A coluna "${options.columnHeader}" traz ${rawText}, que pode significar ` +
          `"não se aplica". Guardado como número: só uma regra confirmada na ` +
          `curadoria pode tratá-lo como ausência.`,
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

  // Text — but a known date column can still deliver its serial as a string,
  // e.g. a CSV-derived import writing "44805,5" or "44805.5" instead of a
  // typed cell. Only a plain numeric literal qualifies; a real date string
  // like "01/09/2022" or "2022-09-01" fails the numeric-literal check and
  // falls through to ordinary text handling below, unchanged.
  if (cell.type === "s" && isKnownDateField(attributeCode)) {
    const serial = parseNumericSerialText(rawText);
    if (serial !== null && isPlausibleDateSerial(serial)) {
      const asDate = excelSerialToDate(serial);
      if (asDate) {
        return { ...dateOnlyResult(asDate), warnings };
      }
    }
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
