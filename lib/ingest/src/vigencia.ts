/**
 * Vigência labels.
 *
 * The source calls a vigência `<CANAL>_<QUINZENA>_<MÊS>_<ANO>` —
 * `EMPURRADA_1_8_2026` in every file this product has received,
 * `ROTA_1_8_2026` in the client's own screens for another channel. The label is
 * the source's own identifier and is stored verbatim; what is *derived* from
 * it — the calendar date, and the channel — is kept apart. Conflating the two
 * would make the business key depend on our parsing, which is exactly
 * backwards.
 *
 * **The second field is the quinzena, not the day of the month.** This module
 * read it as a day for as long as it existed, and the reading survived because
 * it is indistinguishable from the truth in the only two values the field ever
 * takes: `EMPURRADA_1_8_2026` became `2026-08-01`, which is right by accident,
 * and `EMPURRADA_2_8_2026` became `2026-08-02`, which is wrong by a fortnight.
 * Nothing crashed — the dates still ordered correctly, and two vigências of the
 * same month still had two distinct dates — so the error showed up only in what
 * the screens *said*: the vigência selector wrote "agosto/2026 · dia 02" for a
 * fortnight that starts on the 16th, and `rotuloDaVigencia`
 * (`lib/comparison/src/labels.ts`) never reached its `1ª/2ª quinzena` branch,
 * because both dates landed in the first half of the calendar month and the
 * ordinal would have said "1ª quinzena" twice.
 *
 * So the quinzena maps to the day its period *begins*: 1 → the 1st, 2 → the
 * 16th. That is the same ruler `quinzenaDe` applies in the other direction, and
 * it is what lets every screen that already knows how to write a fortnight
 * write one, with no change of its own.
 *
 * The pattern accepted here used to be `^EMPURRADA_…$`, hard-coded to the only
 * channel we had ever seen. A vigência of any other channel was rejected whole,
 * with `UNRECOGNISED_FORMAT` — not because the shape was unknown, but because
 * the first word was. Widening it was strictly additive: every label accepted
 * before is still accepted.
 *
 * The channel is **not** persisted. `snapshot` is frozen by trigger once
 * CLOSED, so a new column could not be backfilled into the vigências already
 * imported; and with a single channel on record there is nothing yet for a
 * column to distinguish. Callers that need to keep two channels apart derive
 * it from the label — see `lib/comparison/src/series.ts`, which mirrors this
 * pattern in SQL and is held to it by a test.
 */

/**
 * `<CANAL>_<QUINZENA>_<MÊS>_<ANO>`.
 *
 * The channel must start with a letter, so a label that is all numbers
 * (`1_8_2026`) stays unrecognised rather than being read as a channel called
 * "1". Underscores inside the channel are allowed — the three trailing numeric
 * groups are what anchor the split, not the first underscore.
 *
 * The quinzena keeps `\d{1,2}` rather than `[12]`: `EMPURRADA_02_12_2025` is a
 * grafia the source has used, and a shape this module recognises but whose
 * quinzena is out of range is a different failure — and a different message —
 * from a label it cannot read at all.
 */
const LABEL_PATTERN = /^([A-Za-z][A-Za-z0-9_]*)_(\d{1,2})_(\d{1,2})_(\d{4})$/;

/** The day each quinzena begins. Mirrors `quinzenaDe`: 1..15 → 1, 16.. → 2. */
const DIA_INICIAL_DA_QUINZENA: Record<number, number> = { 1: 1, 2: 16 };

/**
 * `<CANAL>_MENSAL_<MÊS>_<ANO>` — a competência mensal do acervo Real.
 *
 * ---------------------------------------------------------------------------
 * Por que uma segunda gramática, e não a primeira com a quinzena vazia
 * ---------------------------------------------------------------------------
 * Porque a quinzena vazia não existe neste produto: `DIA_INICIAL_DA_QUINZENA`
 * mapeia 1 → dia 1, e um rótulo mensal que caísse no padrão de cima sairia com
 * `quinzena: 1` — indistinguível da primeira quinzena do mês. A data derivada é
 * a mesma (dia 1) nas duas leituras, e é justamente por ser a mesma que a
 * diferença precisa estar escrita em algum lugar que não seja a data.
 *
 * O acervo Real tem competência **mensal**: o extrato do financiamento fecha
 * por mês, e não por quinzena. Dizer "1ª quinzena de março" sobre ele seria
 * inventar uma alocação que o banco não fez — e a 2ª quinzena de março, que
 * ficaria vazia, faria a comparação enxergar um mês em que o financiamento
 * custou metade.
 *
 * A palavra é `MENSAL` e não um número por isso mesmo: nenhum rótulo aceito
 * antes desta linha muda de significado, porque `MENSAL` nunca casou com
 * `\d{1,2}`. A extensão é estritamente aditiva.
 */
const LABEL_PATTERN_MENSAL = /^([A-Za-z][A-Za-z0-9_]*)_MENSAL_(\d{1,2})_(\d{4})$/i;

/**
 * A granularidade do período que o rótulo nomeia.
 *
 * `QUINZENAL` é o acervo remunerado, que a fonte entrega quinzena a quinzena;
 * `MENSAL` é o realizado, que fecha por competência. Ela viaja junto do
 * resultado — e, adiante, junto do snapshot — porque a data sozinha não a
 * distingue: `2026-03-01` é o primeiro dia da 1ª quinzena de março **e** o
 * primeiro dia da competência março. Sem o campo, uma tela que somasse os dois
 * lados não teria como saber que está somando períodos diferentes.
 */
export type Granularidade = "QUINZENAL" | "MENSAL";

/** O rótulo de uma competência mensal, na grafia que `parseVigenciaLabel` lê. */
export function rotuloMensal(canal: string, mes: number, ano: number): string {
  return `${canal.trim().toUpperCase()}_MENSAL_${mes}_${ano}`;
}

export interface VigenciaParseResult {
  /** The label exactly as it appeared. */
  label: string;
  /**
   * The channel/segment the vigência belongs to, e.g. `EMPURRADA`, `ROTA`.
   * Null when the label does not carry one in a shape we recognise.
   */
  channel: string | null;
  /**
   * The quinzena the label names — 1 or 2. Null when the label does not carry
   * one in a shape we recognise.
   *
   * Comes out alongside the date because the date is a *derivation*: a caller
   * that wants to say "2ª quinzena" should not have to read the day back out
   * of `effectiveDate` and re-derive what the label said outright.
   */
  quinzena: 1 | 2 | null;
  /**
   * Que período o rótulo nomeia — quinzena ou competência mensal.
   *
   * `null` acompanha `effectiveDate: null`: um rótulo que não foi lido não tem
   * granularidade conhecida, e assumir a quinzenal por ser a mais comum seria
   * decidir por quem não foi entendido.
   */
  granularidade: Granularidade | null;
  /**
   * `YYYY-MM-DD` — the first day of the period the label names: o dia inicial
   * da quinzena, ou o dia 1 da competência mensal. Null when the label does not
   * match a known shape.
   */
  effectiveDate: string | null;
  /** Machine-readable reason when parsing failed. */
  failureCode?: "UNRECOGNISED_FORMAT" | "IMPOSSIBLE_QUINZENA" | "IMPOSSIBLE_DATE";
}

/**
 * Derive the effective date, the quinzena and the channel from a vigência
 * label.
 *
 * Returns `effectiveDate: null` for anything unrecognised. The caller raises a
 * validation issue and rejects the rows; it never invents a date.
 */
export function parseVigenciaLabel(rawLabel: string): VigenciaParseResult {
  const label = rawLabel.trim();

  /*
    O mensal é conferido primeiro porque é o mais específico dos dois: a palavra
    `MENSAL` não casa com o `\d{1,2}` do padrão quinzenal, de modo que a ordem
    não muda resultado nenhum — ela apenas deixa a leitura na ordem em que a
    gramática é escrita.
  */
  const mensal = LABEL_PATTERN_MENSAL.exec(label);
  if (mensal) {
    const canal = mensal[1];
    const mes = Number(mensal[2]);
    const ano = Number(mensal[3]);
    if (mes < 1 || mes > 12) {
      return {
        label,
        channel: canal,
        quinzena: null,
        granularidade: "MENSAL",
        effectiveDate: null,
        failureCode: "IMPOSSIBLE_DATE",
      };
    }
    /*
      A competência começa no dia 1, que todo mês tem — não há 31/02 a temer
      aqui. A quinzena sai `null` e é assim que tem de sair: a competência não
      nomeia uma das duas metades, e devolver 1 diria que ela nomeia a primeira.
    */
    const data = new Date(Date.UTC(ano, mes - 1, 1));
    return {
      label,
      channel: canal,
      quinzena: null,
      granularidade: "MENSAL",
      effectiveDate: data.toISOString().slice(0, 10),
    };
  }

  const match = LABEL_PATTERN.exec(label);
  if (!match) {
    return {
      label,
      channel: null,
      quinzena: null,
      granularidade: null,
      effectiveDate: null,
      failureCode: "UNRECOGNISED_FORMAT",
    };
  }

  const channel = match[1];
  const quinzena = Number(match[2]);
  const month = Number(match[3]);
  const year = Number(match[4]);

  const day = DIA_INICIAL_DA_QUINZENA[quinzena];
  if (day === undefined) {
    // The channel was read correctly; it is the quinzena that cannot exist. A
    // month has two, and a label naming a third is a file to be looked at — not
    // a date to be guessed at by rounding it to one of the two.
    return {
      label,
      channel,
      quinzena: null,
      granularidade: "QUINZENAL",
      effectiveDate: null,
      failureCode: "IMPOSSIBLE_QUINZENA",
    };
  }

  if (month < 1 || month > 12) {
    // The channel and the quinzena were read correctly; it is the month that is
    // impossible. All three facts are reported, because the caller's message
    // names the label.
    return {
      label,
      channel,
      quinzena: quinzena as 1 | 2,
      granularidade: "QUINZENAL",
      effectiveDate: null,
      failureCode: "IMPOSSIBLE_DATE",
    };
  }

  // Both quinzenas begin on a day every month has, so there is no 31/02 to
  // guard against here — the check stays because it costs nothing and would
  // catch the day table growing a value that does not.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return {
      label,
      channel,
      quinzena: quinzena as 1 | 2,
      granularidade: "QUINZENAL",
      effectiveDate: null,
      failureCode: "IMPOSSIBLE_DATE",
    };
  }

  return {
    label,
    channel,
    quinzena: quinzena as 1 | 2,
    granularidade: "QUINZENAL",
    effectiveDate: date.toISOString().slice(0, 10),
  };
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
