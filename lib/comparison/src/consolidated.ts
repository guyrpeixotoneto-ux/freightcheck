import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { snapshotTable } from "@workspace/db";
import { computeChangeSet, findPreviousSnapshot } from "./engine";
import { getChangeSetForPair } from "./query";

/**
 * The consolidated view — a projection, not an entity.
 *
 * Carretas and cavalos are ingested, snapshotted and compared as independent
 * series, and nothing here changes that: no series waits for the other, and no
 * "complete vigência" is invented in the database. What this module does is
 * read the series that exist for a given period and add them up for the
 * business question "what happened to the fleet".
 *
 * Two rules keep the sum honest:
 *
 * 1. **Impacts are added within a periodicity, never across.** R$/mês and
 *    R$/ano are different quantities in one series and stay different in ten.
 * 2. **A missing series is named, never assumed to be zero.** If only carretas
 *    arrived for a period, the analysis is shown in full and labelled partial,
 *    saying which series is absent. Absence of data is not data.
 */

export interface SeriesAtPeriod {
  entityTypeSet: string;
  snapshotId: string;
  sourceLabel: string;
  /** The comparison against this series' own previous vigência. */
  changeSetId: string | null;
  previousLabel: string | null;
  /** Null when this is the first vigência of the series. */
  reason: string | null;
}

export interface ConsolidatedView {
  period: string;
  /** Series that delivered a vigência for this period. */
  present: SeriesAtPeriod[];
  /**
   * Series known to the system that did not deliver for this period. Named so
   * the reader knows exactly what the consolidated figure is missing.
   */
  missing: string[];
  complete: boolean;
  totals: {
    valueChanges: number;
    entitiesAdded: number;
    entitiesRemoved: number;
    attributesAdded: number;
    attributesRemoved: number;
    unchanged: number;
    inconclusive: number;
    impactNotCalculable: number;
  };
  /** Summed per periodicity, across the series present. Never one number. */
  impactByPeriodicity: Record<string, number>;
  /** The change sets behind the numbers, for the listing to read. */
  changeSetIds: string[];
}

/** Every period on record, with which series delivered for it. */
export async function listPeriods(db: Database) {
  const { rows } = await db.execute<{
    effective_date: string;
    series: string[];
  }>(sql`
    SELECT effective_date::text AS effective_date,
           array_agg(DISTINCT entity_type_set ORDER BY entity_type_set) AS series
      FROM snapshot
     WHERE status <> 'SUPERSEDED'
     GROUP BY effective_date
     ORDER BY effective_date DESC
  `);
  return rows;
}

/**
 * Series the system knows about.
 *
 * Derived from what has actually been delivered, never declared. A series is
 * "expected" for a period only because it existed before — which is evidence,
 * not an assumption about what the Ambev owes.
 */
export async function knownSeries(db: Database): Promise<string[]> {
  const { rows } = await db.execute<{ entity_type_set: string }>(sql`
    SELECT DISTINCT entity_type_set
      FROM snapshot
     WHERE status <> 'SUPERSEDED'
     ORDER BY entity_type_set
  `);
  return rows.map((r) => r.entity_type_set);
}

export async function getConsolidated(
  db: Database,
  period?: string,
): Promise<ConsolidatedView | null> {
  const periods = await listPeriods(db);
  if (periods.length === 0) return null;

  const target = period
    ? periods.find((p) => p.effective_date === period)
    : periods[0];
  if (!target) return null;

  const all = await knownSeries(db);
  const snapshots = await db
    .select({
      id: snapshotTable.id,
      entityTypeSet: snapshotTable.entityTypeSet,
      sourceLabel: snapshotTable.sourceLabel,
    })
    .from(snapshotTable)
    .where(
      sql`${snapshotTable.effectiveDate}::text = ${target.effective_date}
          AND ${snapshotTable.status} <> 'SUPERSEDED'`,
    )
    .orderBy(snapshotTable.entityTypeSet);

  const present: SeriesAtPeriod[] = [];
  const totals = {
    valueChanges: 0,
    entitiesAdded: 0,
    entitiesRemoved: 0,
    attributesAdded: 0,
    attributesRemoved: 0,
    unchanged: 0,
    inconclusive: 0,
    impactNotCalculable: 0,
  };
  const impactByPeriodicity: Record<string, number> = {};
  const changeSetIds: string[] = [];

  for (const snapshot of snapshots) {
    // Each series compares against its own previous vigência. A series that
    // skipped a period compares against whatever it last delivered, which is
    // the truthful comparison for that series.
    const previousId = await findPreviousSnapshot(db, snapshot.id);
    if (!previousId) {
      present.push({
        entityTypeSet: snapshot.entityTypeSet,
        snapshotId: snapshot.id,
        sourceLabel: snapshot.sourceLabel,
        changeSetId: null,
        previousLabel: null,
        reason: "Primeira vigência desta série; não há anterior com que comparar.",
      });
      continue;
    }

    const existing = await getChangeSetForPair(db, previousId, snapshot.id);
    const set =
      existing ??
      (await computeChangeSet(db, previousId, snapshot.id, {
        computedBy: "api:consolidated",
      }).then(() => getChangeSetForPair(db, previousId, snapshot.id)));
    if (!set) continue;

    const [previous] = await db
      .select({ sourceLabel: snapshotTable.sourceLabel })
      .from(snapshotTable)
      .where(sql`${snapshotTable.id} = ${previousId}`);

    present.push({
      entityTypeSet: snapshot.entityTypeSet,
      snapshotId: snapshot.id,
      sourceLabel: snapshot.sourceLabel,
      changeSetId: set.id,
      previousLabel: previous?.sourceLabel ?? null,
      reason: null,
    });
    changeSetIds.push(set.id);

    totals.valueChanges += set.valueChanges;
    totals.entitiesAdded += set.entitiesAdded;
    totals.entitiesRemoved += set.entitiesRemoved;
    totals.attributesAdded += set.attributesAdded;
    totals.attributesRemoved += set.attributesRemoved;
    totals.unchanged += set.unchanged;
    totals.inconclusive += set.inconclusive;
    totals.impactNotCalculable += set.impactNotCalculable;

    for (const [periodicity, amount] of Object.entries(
      set.calculatedImpactByPeriodicity ?? {},
    )) {
      impactByPeriodicity[periodicity] =
        (impactByPeriodicity[periodicity] ?? 0) + Number(amount);
    }
  }

  const presentTypes = new Set(present.map((p) => p.entityTypeSet));
  const missing = all.filter((s) => !presentTypes.has(s));

  return {
    period: target.effective_date,
    present,
    missing,
    complete: missing.length === 0,
    totals,
    impactByPeriodicity: Object.fromEntries(
      Object.entries(impactByPeriodicity).map(([k, v]) => [k, Number(v.toFixed(6))]),
    ),
    changeSetIds,
  };
}
