import { sql } from "drizzle-orm";
import { chaveDeEscopoSql } from "@workspace/availability";
import type { Database } from "@workspace/db";
import { snapshotTable } from "@workspace/db";
import { computeChangeSet, findPreviousSnapshot } from "./engine";
import { getChangeSetForPair } from "./query";
import {
  contextFilter,
  resolveContext,
  seriesKey,
  type ContextInfo,
  type SeriesContext,
} from "./series";

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
  /**
   * A unidade e o canal a que tudo abaixo se refere.
   *
   * Existe para que escolher por padrão não seja escolher em silêncio: a
   * resposta diz de quem é o período que ela está descrevendo.
   */
  context: ContextInfo;
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

/**
 * Every period on record, with which series delivered for it.
 *
 * **Sempre dentro de um contexto.** Uma vigência de agosto da unidade A e uma
 * vigência de agosto da unidade B são dois períodos, não um: agrupar só por
 * data somaria as duas frotas num total que nenhuma das duas reconheceria.
 * Sem contexto, responde pelo mais recente — e quem chama tem a obrigação de
 * dizer qual escolheu (ver `resolveContext`).
 */
export async function listPeriods(db: Database, context?: SeriesContext) {
  const resolved = context ?? (await resolveContext(db));
  if (!resolved) return [];

  const { rows } = await db.execute<{
    effective_date: string;
    series: string[];
  }>(sql`
    -- Uma série é um **componente** da vigência, não o conjunto que ela cobre.
    -- Desde que CAVALO e CARRETA passaram a ser componentes de uma mesma
    -- identidade canônica, uma vigência completa guarda entity_type_set =
    -- "CARRETA+CAVALO"; ler isso como uma série faria as duas sumirem da tela e
    -- aparecer uma terceira, que não existe. O unnest devolve os componentes,
    -- que é o que a tela sempre mostrou.
    SELECT s.effective_date::text AS effective_date,
           array_agg(DISTINCT t ORDER BY t) AS series
      FROM snapshot s,
           unnest(string_to_array(s.entity_type_set, '+')) t
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", resolved)}
     GROUP BY s.effective_date
     ORDER BY s.effective_date DESC
  `);
  return rows;
}

/**
 * Series the system knows about, in one context.
 *
 * Derived from what has actually been delivered, never declared. A series is
 * "expected" for a period only because it existed before — which is evidence,
 * not an assumption about what the Ambev owes. And "before" is before *in this
 * unit and this channel*: a série que a unidade A entrega não é dívida da
 * unidade B.
 */
export async function knownSeries(
  db: Database,
  context?: SeriesContext,
): Promise<string[]> {
  const resolved = context ?? (await resolveContext(db));
  if (!resolved) return [];

  const { rows } = await db.execute<{ entity_type_set: string }>(sql`
    SELECT DISTINCT t AS entity_type_set
      FROM snapshot s,
           unnest(string_to_array(s.entity_type_set, '+')) t
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", resolved)}
     ORDER BY t
  `);
  return rows.map((r) => r.entity_type_set);
}

export interface BackfillComparisonsResult {
  computed: number;
  existing: number;
  series: number;
}

/**
 * Compare every consecutive pair, in every series, that has not been compared.
 *
 * Change sets used to be computed only when a screen asked for one, which meant
 * the Painel showed the impact of whichever transition someone happened to open
 * — and nothing was ever going to compute the rest. After an import, the
 * product's whole promise is "here is what changed", so the comparisons are
 * made then, not on demand.
 *
 * Idempotent: a pair already compared is left alone, so this can run after
 * every promotion without recomputing the series each time.
 */
export async function computeMissingChangeSets(
  db: Database,
  computedBy = "api:after-import",
): Promise<BackfillComparisonsResult> {
  const all = await db
    .select({
      id: snapshotTable.id,
      scopeHash: sql<string>`${chaveDeEscopoSql("snapshot")}`,
      canal: snapshotTable.canal,
      sourceLabel: snapshotTable.sourceLabel,
      entityTypeSet: snapshotTable.entityTypeSet,
      effectiveDate: snapshotTable.effectiveDate,
    })
    .from(snapshotTable)
    .where(sql`${snapshotTable.status} <> 'SUPERSEDED'`)
    .orderBy(snapshotTable.effectiveDate);

  // A chave inclui o canal: sem ele, a vigência de agosto do canal ROTA seria
  // comparada contra a de julho do canal EMPURRADA — mesma unidade, mesma
  // cobertura, remunerações diferentes.
  const series = new Map<string, typeof all>();
  for (const snapshot of all) {
    const key = seriesKey(
      snapshot.scopeHash,
      snapshot.canal,
      snapshot.entityTypeSet,
    );
    if (!series.has(key)) series.set(key, []);
    series.get(key)!.push(snapshot);
  }

  let computed = 0;
  let existing = 0;
  for (const group of series.values()) {
    for (let i = 1; i < group.length; i++) {
      const a = group[i - 1];
      const b = group[i];
      if (await getChangeSetForPair(db, a.id, b.id)) {
        existing++;
        continue;
      }
      await computeChangeSet(db, a.id, b.id, { computedBy });
      computed++;
    }
  }
  return { computed, existing, series: series.size };
}

export async function getConsolidated(
  db: Database,
  period?: string,
  requestedContext?: Partial<SeriesContext>,
): Promise<ConsolidatedView | null> {
  const context = await resolveContext(db, requestedContext);
  if (!context) return null;

  const periods = await listPeriods(db, context);
  if (periods.length === 0) return null;

  const target = period
    ? periods.find((p) => p.effective_date === period)
    : periods[0];
  if (!target) return null;

  const all = await knownSeries(db, context);
  const { rows: snapshots } = await db.execute<{
    id: string;
    entityTypeSet: string;
    sourceLabel: string;
  }>(sql`
    SELECT s.id::text AS id,
           s.entity_type_set AS "entityTypeSet",
           s.source_label    AS "sourceLabel"
      FROM snapshot s
     WHERE s.effective_date::text = ${target.effective_date}
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     ORDER BY s.entity_type_set
  `);

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
    // Uma vigência cobre mais de um equipamento desde que os dois passaram a ser
    // componentes da mesma identidade. A tela continua listando um por série;
    // os totais, abaixo, continuam somando **uma vez por comparação** — somá-los
    // por componente contaria a mesma alteração duas vezes.
    const componentes = snapshot.entityTypeSet
      .split("+")
      .filter((t) => t !== "")
      .sort();

    const anterior = await findPreviousSnapshot(db, snapshot.id);
    if (!anterior.encontrada) {
      for (const componente of componentes) {
        present.push({
          entityTypeSet: componente,
          snapshotId: snapshot.id,
          sourceLabel: snapshot.sourceLabel,
          changeSetId: null,
          previousLabel: null,
          // A frase vem da autoridade: "primeira da série" e "existe anterior
          // com outra cobertura" são coisas diferentes, e escrever a primeira
          // no lugar da segunda é o que a tela fazia.
          reason: anterior.frase,
        });
      }
      continue;
    }

    const previousId = anterior.vigencia.snapshotId;
    const existing = await getChangeSetForPair(db, previousId, snapshot.id);
    const set =
      existing ??
      (await computeChangeSet(db, previousId, snapshot.id, {
        computedBy: "api:consolidated",
      }).then(() => getChangeSetForPair(db, previousId, snapshot.id)));
    if (!set) continue;

    for (const componente of componentes) {
      present.push({
        entityTypeSet: componente,
        snapshotId: snapshot.id,
        sourceLabel: snapshot.sourceLabel,
        changeSetId: set.id,
        // O rótulo da anterior vem junto da resposta da autoridade; a consulta
        // que o buscava de novo era uma ida ao banco para reler o que já
        // estava em mãos.
        previousLabel: anterior.vigencia.sourceLabel,
        reason: null,
      });
    }
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
    context,
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
