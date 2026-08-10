import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import type { CellType, SourceCell } from "./values";

/**
 * Reading the workbook without deciding anything we cannot justify.
 *
 * Two judgements happen here, and both are recorded with their reason so a
 * reviewer can disagree later: which sheets are fact sources, and what each
 * column is called.
 */

/** Columns a source sheet must have for the grain (vigência, asset) to exist. */
const REQUIRED_KEY_COLUMNS = ["vigencia", "placa"];

export interface SheetPlan {
  name: string;
  index: number;
  role: "SOURCE" | "PIVOT" | "UNKNOWN";
  roleReason: string;
  /** 1-based physical row holding the headers, when there is one. */
  headerRowIndex: number | null;
  rowCount: number;
  columnCount: number;
  /** Header text per column index, verbatim. */
  headers: (string | null)[];
  /** Derived entity type for SOURCE sheets, e.g. "CAVALO". */
  entityType: string | null;
  entityTypeReason: string | null;
}

export interface ReadWorkbook {
  sheets: SheetPlan[];
  workbook: XLSX.WorkBook;
}

/** Strip accents and fold to a comparison-friendly form. */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Internal slug for a column name. The original text is always preserved
 * alongside it in `attribute.source_name` and `raw_cell.column_header`.
 *
 * The export mixes camelCase (`ipvaLicenciamento`) with spaced headers
 * (`Unidade - CNPJ`), so word boundaries are recovered before folding —
 * otherwise every camelCase column collapses into an unreadable run of
 * letters, and two genuinely different columns can end up sharing a slug.
 */
export function slugifyColumn(header: string): string {
  const spaced = header
    // lower/digit followed by upper: "ipvaLicenciamento" -> "ipva Licenciamento"
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // acronym followed by a word: "TJLPValor" -> "TJLP Valor"
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return foldText(spaced)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

/**
 * Words a sheet name carries to describe the *document*, not the equipment.
 *
 * Deliberately not a list of equipment types: the type stays open, so a third
 * kind of asset needs no change here. What is enumerated is only the packaging
 * vocabulary — "Modelo_Carreta" and "carretas" name the same thing, and the
 * first word is about the file, not the asset.
 */
const DOCUMENT_WORDS = new Set([
  "modelo",
  "modelos",
  "base",
  "dado",
  "dados",
  "analise",
  "relatorio",
  "planilha",
  "tabela",
  "lista",
  "aba",
  "sheet",
  "export",
]);

/**
 * Entity type from a source sheet name.
 *
 * The first version took the sheet name to *be* the type, which held while the
 * Ambev shipped one workbook with sheets called `carretas` and `cavalos`. When
 * the same data arrived split into `Modelo_Carreta` and `Modelo_Cavalo`, it
 * derived `MODELOCARRETA` — a second, parallel identity for assets already in
 * the system, with 65 duplicate attributes hanging off it. The data was right
 * and the identity was wrong, which is the worse of the two failures.
 *
 * So the name is now read as a phrase: split it, drop the words that describe
 * the document, and singularise what is left. The equipment vocabulary itself
 * stays open.
 */
export function deriveEntityType(sheetName: string): {
  entityType: string;
  reason: string;
} {
  const tokens = foldText(sheetName)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const meaningful = tokens.filter((token) => !DOCUMENT_WORDS.has(token));
  // If every token described the document, the name has nothing else to give;
  // keep it whole rather than invent a type.
  const kept = meaningful.length > 0 ? meaningful : tokens;
  const joined = kept.join("");
  const singular = joined.endsWith("s") ? joined.slice(0, -1) : joined;

  const dropped = tokens.filter((token) => !kept.includes(token));
  const reason =
    `Derivado do nome da aba "${sheetName}": acentos removidos, ` +
    (dropped.length > 0
      ? `descartado o que descreve o documento (${dropped.join(", ")}), `
      : "") +
    `plural removido e maiúsculas aplicadas.`;

  return { entityType: singular.toUpperCase(), reason };
}

function cellRef(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row, c: col });
}

/** Read a cell exactly as the file delivers it, including its own type. */
export function readCell(
  sheet: XLSX.WorkSheet,
  row: number,
  col: number,
): SourceCell {
  const raw = sheet[cellRef(row, col)] as XLSX.CellObject | undefined;
  if (!raw || raw.t === undefined) return { type: "z", value: undefined };
  return {
    type: raw.t as CellType,
    value: raw.v,
    formatted: raw.w,
  };
}

function headerTextAt(sheet: XLSX.WorkSheet, row: number, col: number): string | null {
  const cell = readCell(sheet, row, col);
  if (cell.type === "z" || cell.value === undefined || cell.value === null) return null;
  const text = String(cell.value).trim();
  return text === "" ? null : text;
}

/**
 * Classify a sheet by its own shape, not by its name.
 *
 * A fact source has a real header row carrying the grain columns. The pivot
 * tables in this workbook start with blank rows and "Rótulos de Coluna"
 * captions, so they fail on both counts — and the reason is written down.
 */
function planSheet(
  workbook: XLSX.WorkBook,
  name: string,
  index: number,
): SheetPlan {
  const sheet = workbook.Sheets[name];
  const ref = sheet?.["!ref"];
  if (!sheet || !ref) {
    return {
      name,
      index,
      role: "UNKNOWN",
      roleReason: "Sheet has no cell range; nothing to read.",
      headerRowIndex: null,
      rowCount: 0,
      columnCount: 0,
      headers: [],
      entityType: null,
      entityTypeReason: null,
    };
  }

  const range = XLSX.utils.decode_range(ref);
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;

  const headers: (string | null)[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    headers.push(headerTextAt(sheet, range.s.r, c));
  }

  const filled = headers.filter((h) => h !== null).length;
  const fillRatio = columnCount === 0 ? 0 : filled / columnCount;
  const folded = headers.map((h) => (h === null ? "" : foldText(h)));
  const missingKeys = REQUIRED_KEY_COLUMNS.filter((k) => !folded.includes(k));

  if (missingKeys.length > 0) {
    return {
      name,
      index,
      role: "PIVOT",
      roleReason: `First row lacks the grain column(s) ${missingKeys.join(", ")}; treated as a derived/pivot sheet and excluded from canonical facts.`,
      headerRowIndex: null,
      rowCount,
      columnCount,
      headers,
      entityType: null,
      entityTypeReason: null,
    };
  }

  if (fillRatio < 0.8) {
    return {
      name,
      index,
      role: "UNKNOWN",
      roleReason: `First row carries the grain columns but only ${(fillRatio * 100).toFixed(0)}% of headers are populated; refusing to guess the layout.`,
      headerRowIndex: null,
      rowCount,
      columnCount,
      headers,
      entityType: null,
      entityTypeReason: null,
    };
  }

  const { entityType, reason } = deriveEntityType(name);
  return {
    name,
    index,
    role: "SOURCE",
    roleReason: `First row carries ${REQUIRED_KEY_COLUMNS.join(" + ")} and ${(fillRatio * 100).toFixed(0)}% populated headers.`,
    headerRowIndex: range.s.r + 1,
    rowCount,
    columnCount,
    headers,
    entityType,
    entityTypeReason: reason,
  };
}

/**
 * `cellDates: true` lets the file state its own opinion about which cells are
 * dates: a date-formatted cell arrives as type `d`, an unformatted serial
 * stays `n`. That disagreement is information we want, not noise to smooth
 * over — see AMBIGUOUS_DATE_SERIAL.
 */
export function readWorkbook(filePath: string): ReadWorkbook {
  // Read the bytes ourselves rather than using XLSX.readFile: the ESM build of
  // SheetJS only exposes readFile once an fs shim is registered, so this keeps
  // the reader working identically under tsx, vitest and the bundled server.
  const workbook = XLSX.read(readFileSync(filePath), {
    type: "buffer",
    cellDates: true,
    cellNF: true,
    cellText: true,
    dense: false,
  });
  const sheets = workbook.SheetNames.map((name, index) =>
    planSheet(workbook, name, index),
  );
  return { sheets, workbook };
}

export function sheetRange(sheet: XLSX.WorkSheet): XLSX.Range | null {
  const ref = sheet?.["!ref"];
  return ref ? XLSX.utils.decode_range(ref) : null;
}

export function columnLetter(index: number): string {
  return XLSX.utils.encode_col(index);
}
