/**
 * Vigência labels.
 *
 * The source calls a vigência `EMPURRADA_D_M_YYYY`. The label is the source's
 * own identifier and is stored verbatim; the calendar date is *derived* from
 * it and stored in a separate column. Conflating the two would make the
 * business key depend on our parsing, which is exactly backwards.
 */

const LABEL_PATTERN = /^EMPURRADA_(\d{1,2})_(\d{1,2})_(\d{4})$/;

export interface VigenciaParseResult {
  /** The label exactly as it appeared. */
  label: string;
  /** `YYYY-MM-DD`, or null when the label does not match a known shape. */
  effectiveDate: string | null;
  /** Machine-readable reason when parsing failed. */
  failureCode?: "UNRECOGNISED_FORMAT" | "IMPOSSIBLE_DATE";
}

/**
 * Derive the effective date from a vigência label.
 *
 * Returns `effectiveDate: null` for anything unrecognised. The caller raises a
 * validation issue and rejects the rows; it never invents a date.
 */
export function parseVigenciaLabel(rawLabel: string): VigenciaParseResult {
  const label = rawLabel.trim();
  const match = LABEL_PATTERN.exec(label);
  if (!match) {
    return { label, effectiveDate: null, failureCode: "UNRECOGNISED_FORMAT" };
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { label, effectiveDate: null, failureCode: "IMPOSSIBLE_DATE" };
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31/02 and friends, which Date would silently roll over.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { label, effectiveDate: null, failureCode: "IMPOSSIBLE_DATE" };
  }

  return { label, effectiveDate: date.toISOString().slice(0, 10) };
}
