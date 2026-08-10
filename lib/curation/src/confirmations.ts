import { eq } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { attributeTable } from "@workspace/db";
import { confirmAttribute } from "./engine";
import type { Aggregation, Periodicity, Unit } from "./semantics";

/**
 * Confirmed semantics, as a versioned artefact.
 *
 * A confirmation is knowledge about the domain that a person supplied. Keeping
 * it only in a database would make it invisible to review and lost on a
 * rebuild; keeping it here makes it diffable, attributable and replayable into
 * any fresh environment.
 *
 * This registry does not weaken the human-confirmation rule — every entry
 * records who decided and on what basis, and applying it goes through the same
 * {@link confirmAttribute} guards as the screen does. Adding a line here is
 * itself the human act, reviewable in a pull request.
 *
 * Do not add an entry you were not told. An unconfirmed attribute staying
 * UNKNOWN is the system working; a guess recorded here as fact is not.
 */
export interface ConfirmedSemantics {
  code: string;
  unit: Unit | null;
  periodicity: Periodicity | null;
  aggregation: Aggregation;
  isMonetary: boolean;
  taxonomyCode?: string;
  /** The person who decided. Never a system identifier. */
  confirmedBy: string;
  /** What the decision was based on — the thing a reviewer will want. */
  basis: string;
}

export const CONFIRMED_SEMANTICS: ConfirmedSemantics[] = [
  {
    code: "carreta.custo_fixo",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Confirmado pelo transportador em 10/08/2026: custoFixo é um valor mensal por implemento.",
  },
  {
    code: "carreta.icms",
    unit: "PERCENT",
    // A rate has no periodicity — it is not an amount accruing over time.
    periodicity: null,
    aggregation: "NONE",
    isMonetary: false,
    taxonomyCode: "cf_seguros_tributos",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Confirmado pelo transportador em 10/08/2026: a coluna icms é alíquota, não valor. " +
      "O montante correspondente é valorIcms. Consistente com a faixa observada (0 a 12).",
  },
  {
    code: "carreta.pis_cofins",
    unit: "PERCENT",
    periodicity: null,
    aggregation: "NONE",
    isMonetary: false,
    taxonomyCode: "cf_seguros_tributos",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Confirmado pelo transportador em 10/08/2026: a coluna pisCofins é alíquota, não valor. " +
      "O montante correspondente é valorPisCofins. Consistente com a faixa observada (0 a 9,3).",
  },
];

export interface ApplyConfirmationsResult {
  applied: string[];
  unchanged: string[];
  missing: string[];
}

/**
 * Replay the registry into a database. Idempotent: an attribute already
 * carrying exactly these semantics is left alone, so re-running writes no
 * events and does not restamp the confirmation date.
 */
export async function applyConfirmations(
  db: Database,
  registry: ConfirmedSemantics[] = CONFIRMED_SEMANTICS,
): Promise<ApplyConfirmationsResult> {
  const applied: string[] = [];
  const unchanged: string[] = [];
  const missing: string[] = [];

  for (const entry of registry) {
    const [attribute] = await db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, entry.code));

    if (!attribute) {
      missing.push(entry.code);
      continue;
    }

    const alreadyMatches =
      attribute.semanticsStatus === "CONFIRMED" &&
      attribute.unit === entry.unit &&
      attribute.periodicity === entry.periodicity &&
      attribute.aggregation === entry.aggregation &&
      attribute.isMonetary === entry.isMonetary &&
      attribute.confirmedBy === entry.confirmedBy;

    if (alreadyMatches) {
      unchanged.push(entry.code);
      continue;
    }

    await confirmAttribute(db, {
      code: entry.code,
      unit: entry.unit,
      periodicity: entry.periodicity,
      aggregation: entry.aggregation,
      isMonetary: entry.isMonetary,
      taxonomyCode: entry.taxonomyCode,
      actor: entry.confirmedBy,
      reason: entry.basis,
    });
    applied.push(entry.code);
  }

  return { applied, unchanged, missing };
}
