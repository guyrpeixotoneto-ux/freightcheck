/**
 * Excel serial-date arithmetic.
 *
 * The Freightec export delivers dates in two different shapes for two columns
 * that both hold dates (`data` arrives typed, `dataFimContrato` arrives as a
 * bare serial such as 46935.5). We therefore need the conversion explicitly,
 * and we need it tested — a silent off-by-one here would misdate an entire
 * contract history.
 */

/** Excel serial 25569 is 1970-01-01, the Unix epoch. */
const EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86_400_000;

/**
 * Lowest serial we are willing to read as a date (1990-01-01). Anything below
 * is far more likely to be a quantity than a date, and guessing is exactly
 * what this codebase must not do.
 */
export const PLAUSIBLE_DATE_SERIAL_MIN = 32_874;
/** Highest serial we treat as plausible (2100-01-01). */
export const PLAUSIBLE_DATE_SERIAL_MAX = 73_051;

/**
 * Convert an Excel serial number to a UTC Date.
 *
 * Reproduces Excel's 1900 leap-year bug: serials from 61 (1900-03-01) onward
 * are shifted by one day relative to a naive count, because Excel believes
 * 1900-02-29 existed. Serial 60 is that phantom day and has no real date.
 */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  if (serial === 60) return null; // Excel's phantom 1900-02-29
  // Serials below 60 predate the phantom day and need no correction.
  const corrected = serial < 60 ? serial + 1 : serial;
  const ms = Math.round((corrected - EPOCH_OFFSET_DAYS) * MS_PER_DAY);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `YYYY-MM-DD` in UTC. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Full ISO-8601 in UTC, milliseconds dropped when they are zero. */
export function toIsoDateTime(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, 19)}Z` : iso;
}

/** True when the instant carries a meaningful time-of-day component. */
export function hasTimeComponent(date: Date): boolean {
  return (
    date.getUTCHours() !== 0 ||
    date.getUTCMinutes() !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  );
}

/**
 * Whether a bare number *could* be a date serial. Used only to raise an
 * ambiguity warning — never to perform a conversion.
 */
export function isPlausibleDateSerial(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= PLAUSIBLE_DATE_SERIAL_MIN &&
    value <= PLAUSIBLE_DATE_SERIAL_MAX
  );
}
