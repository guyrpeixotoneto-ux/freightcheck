/**
 * Vigência labels.
 *
 * The source calls a vigência `<CANAL>_D_M_YYYY` — `EMPURRADA_1_8_2026` in
 * every file this product has received, `ROTA_1_8_2026` in the client's own
 * screens for another channel. The label is the source's own identifier and is
 * stored verbatim; what is *derived* from it — the calendar date, and the
 * channel — is kept apart. Conflating the two would make the business key
 * depend on our parsing, which is exactly backwards.
 *
 * The pattern accepted here used to be `^EMPURRADA_…$`, hard-coded to the only
 * channel we had ever seen. A vigência of any other channel was rejected whole,
 * with `UNRECOGNISED_FORMAT` — not because the shape was unknown, but because
 * the first word was. Widening it is strictly additive: every label accepted
 * before is still accepted, and still yields the same date.
 *
 * The channel is **not** persisted. `snapshot` is frozen by trigger once
 * CLOSED, so a new column could not be backfilled into the vigências already
 * imported; and with a single channel on record there is nothing yet for a
 * column to distinguish. Callers that need to keep two channels apart derive
 * it from the label — see `lib/comparison/src/series.ts`, which mirrors this
 * pattern in SQL and is held to it by a test.
 */

/**
 * `<CANAL>_<DIA>_<MÊS>_<ANO>`.
 *
 * The channel must start with a letter, so a label that is all numbers
 * (`1_8_2026`) stays unrecognised rather than being read as a channel called
 * "1". Underscores inside the channel are allowed — the three trailing numeric
 * groups are what anchor the split, not the first underscore.
 */
const LABEL_PATTERN = /^([A-Za-z][A-Za-z0-9_]*)_(\d{1,2})_(\d{1,2})_(\d{4})$/;

export interface VigenciaParseResult {
  /** The label exactly as it appeared. */
  label: string;
  /**
   * The channel/segment the vigência belongs to, e.g. `EMPURRADA`, `ROTA`.
   * Null when the label does not carry one in a shape we recognise.
   */
  channel: string | null;
  /** `YYYY-MM-DD`, or null when the label does not match a known shape. */
  effectiveDate: string | null;
  /** Machine-readable reason when parsing failed. */
  failureCode?: "UNRECOGNISED_FORMAT" | "IMPOSSIBLE_DATE";
}

/**
 * Derive the effective date and the channel from a vigência label.
 *
 * Returns `effectiveDate: null` for anything unrecognised. The caller raises a
 * validation issue and rejects the rows; it never invents a date.
 */
export function parseVigenciaLabel(rawLabel: string): VigenciaParseResult {
  const label = rawLabel.trim();
  const match = LABEL_PATTERN.exec(label);
  if (!match) {
    return {
      label,
      channel: null,
      effectiveDate: null,
      failureCode: "UNRECOGNISED_FORMAT",
    };
  }

  const channel = match[1];
  const day = Number(match[2]);
  const month = Number(match[3]);
  const year = Number(match[4]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    // The channel was read correctly; it is the date that is impossible. Both
    // facts are reported, because the caller's message names the label.
    return { label, channel, effectiveDate: null, failureCode: "IMPOSSIBLE_DATE" };
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31/02 and friends, which Date would silently roll over.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { label, channel, effectiveDate: null, failureCode: "IMPOSSIBLE_DATE" };
  }

  return { label, channel, effectiveDate: date.toISOString().slice(0, 10) };
}

/**
 * The partition a label belongs to when two channels share a unit and a date.
 *
 * Null for a label whose channel we cannot read — and null is a partition of
 * its own, shared by every such label. That is deliberate: labels the parser
 * does not understand must not each become their own series, or a set of
 * vigências with hand-written names would stop comparing against each other.
 */
export function channelOf(label: string): string | null {
  return parseVigenciaLabel(label).channel;
}
