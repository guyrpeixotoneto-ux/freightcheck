import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  changeSetTable,
  changeTable,
  snapshotTable,
} from "@workspace/db";
import {
  loadAttributeClassifications,
  type AttributeClassification,
} from "./classification";
import { assessImpact } from "./impact";

/**
 * The comparison engine.
 *
 * Three axes, kept apart because conflating them hides both:
 *   SOURCE_CHANGE  — a value the Ambev sent changed, on an asset present in both
 *   FLEET_CHANGE   — an asset entered or left the fleet
 *   LAYOUT_CHANGE  — a column appeared in or vanished from the export
 *
 * Matching is always by `(entity_id, attribute_id)` — stable semantic identity,
 * never row position. A plate that moves from row 374 to row 436 between
 * exports is the same asset, and the engine says so.
 */

export interface ComputeOptions {
  computedBy?: string;
  /** Recompute even when a set already exists for this pair. */
  force?: boolean;
}

export interface ChangeSetSummary {
  id: string;
  snapshotAId: string;
  snapshotBId: string;
  snapshotALabel: string;
  snapshotBLabel: string;
  valueChanges: number;
  entitiesAdded: number;
  entitiesRemoved: number;
  attributesAdded: number;
  attributesRemoved: number;
  unchanged: number;
  inconclusive: number;
  calculatedImpact: number | null;
  impactNotCalculable: number;
}

/**
 * The snapshot a given one should be compared against: the most recent live
 * snapshot, of the same source, scope and entity coverage, that precedes it.
 *
 * Superseded revisions are excluded on purpose — comparing against a snapshot
 * that has itself been replaced would report differences that no longer stand.
 */
export async function findPreviousSnapshot(
  db: Database,
  snapshotId: string,
): Promise<string | null> {
  const [target] = await db
    .select()
    .from(snapshotTable)
    .where(eq(snapshotTable.id, snapshotId));
  if (!target) throw new Error(`Snapshot ${snapshotId} não encontrado.`);

  const [previous] = await db
    .select({ id: snapshotTable.id })
    .from(snapshotTable)
    .where(
      and(
        eq(snapshotTable.sourceSystem, target.sourceSystem),
        eq(snapshotTable.scopeHash, target.scopeHash),
        eq(snapshotTable.entityTypeSet, target.entityTypeSet),
        sql`${snapshotTable.status} <> 'SUPERSEDED'`,
        sql`${snapshotTable.effectiveDate} < ${target.effectiveDate}`,
      ),
    )
    .orderBy(desc(snapshotTable.effectiveDate))
    .limit(1);

  return previous?.id ?? null;
}

interface PairedFact extends Record<string, unknown> {
  entity_id: string;
  attribute_id: string;
  entity_label: string | null;
  fact_a_id: number | null;
  fact_b_id: number | null;
  a_numeric: string | null;
  a_text: string | null;
  a_boolean: boolean | null;
  a_date: string | null;
  a_is_null: boolean | null;
  a_null_reason: string | null;
  b_numeric: string | null;
  b_text: string | null;
  b_boolean: boolean | null;
  b_date: string | null;
  b_is_null: boolean | null;
  b_null_reason: string | null;
}

/**
 * Compare two snapshots and persist the result.
 *
 * Idempotent by construction: a change set for a pair is dropped and rebuilt,
 * so recomputing never accumulates. Comparing a snapshot with an identical
 * twin — the same vigência re-imported as a new revision — yields zero
 * changes, which is the property that keeps a re-import from inventing news.
 */
export async function computeChangeSet(
  db: Database,
  snapshotAId: string,
  snapshotBId: string,
  options: ComputeOptions = {},
): Promise<ChangeSetSummary> {
  const [a] = await db.select().from(snapshotTable).where(eq(snapshotTable.id, snapshotAId));
  const [b] = await db.select().from(snapshotTable).where(eq(snapshotTable.id, snapshotBId));
  if (!a) throw new Error(`Snapshot A (${snapshotAId}) não encontrado.`);
  if (!b) throw new Error(`Snapshot B (${snapshotBId}) não encontrado.`);
  if (a.id === b.id) throw new Error("Um snapshot não se compara consigo mesmo.");

  // Comparing across different scopes or different equipment coverage would
  // produce differences that mean nothing — every asset would look added or
  // removed. Refuse rather than emit noise.
  if (a.scopeHash !== b.scopeHash) {
    throw new Error(
      `Escopos diferentes: "${a.sourceLabel}" e "${b.sourceLabel}" cobrem unidades/operadores distintos e não são comparáveis.`,
    );
  }
  if (a.entityTypeSet !== b.entityTypeSet) {
    throw new Error(
      `Coberturas diferentes: "${a.sourceLabel}" cobre ${a.entityTypeSet} e "${b.sourceLabel}" cobre ${b.entityTypeSet}.`,
    );
  }

  const existing = await db
    .select()
    .from(changeSetTable)
    .where(
      and(
        eq(changeSetTable.snapshotAId, snapshotAId),
        eq(changeSetTable.snapshotBId, snapshotBId),
      ),
    );
  if (existing.length > 0 && !options.force) {
    return toSummary(existing[0], a.sourceLabel, b.sourceLabel);
  }

  const classifications = await loadAttributeClassifications(db);

  return db.transaction(async (tx) => {
    if (existing.length > 0) {
      // Derived data: replaced wholesale rather than patched.
      await tx.delete(changeSetTable).where(eq(changeSetTable.id, existing[0].id));
    }

    const [set] = await tx
      .insert(changeSetTable)
      .values({
        snapshotAId,
        snapshotBId,
        status: "PENDING",
        computedBy: options.computedBy ?? null,
      })
      .returning();

    const rows: (typeof changeTable.$inferInsert)[] = [];
    let unchanged = 0;
    let inconclusive = 0;
    let calculatedImpact = 0;
    let hasCalculated = false;
    let impactNotCalculable = 0;

    // ---------------------------------------------------------------------
    // Axis 1 — values, on assets present in both snapshots
    // ---------------------------------------------------------------------
    const { rows: paired } = await tx.execute<PairedFact>(sql`
      WITH fa AS (
        SELECT f.*, i.identifier_value AS entity_label
          FROM fact f
          LEFT JOIN entity_identifier i
            ON i.entity_id = f.entity_id
           AND i.identifier_type = 'PLACA'
           AND i.is_current
         WHERE f.snapshot_id = ${snapshotAId}
      ),
      fb AS (
        SELECT f.*, i.identifier_value AS entity_label
          FROM fact f
          LEFT JOIN entity_identifier i
            ON i.entity_id = f.entity_id
           AND i.identifier_type = 'PLACA'
           AND i.is_current
         WHERE f.snapshot_id = ${snapshotBId}
      )
      SELECT COALESCE(fa.entity_id, fb.entity_id)       AS entity_id,
             COALESCE(fa.attribute_id, fb.attribute_id) AS attribute_id,
             COALESCE(fa.entity_label, fb.entity_label) AS entity_label,
             fa.id AS fact_a_id, fb.id AS fact_b_id,
             fa.value_numeric AS a_numeric, fa.value_text AS a_text,
             fa.value_boolean AS a_boolean, fa.value_date::text AS a_date,
             fa.is_null AS a_is_null, fa.null_reason AS a_null_reason,
             fb.value_numeric AS b_numeric, fb.value_text AS b_text,
             fb.value_boolean AS b_boolean, fb.value_date::text AS b_date,
             fb.is_null AS b_is_null, fb.null_reason AS b_null_reason
        FROM fa
        FULL OUTER JOIN fb
          ON fb.entity_id = fa.entity_id
         AND fb.attribute_id = fa.attribute_id
    `);

    for (const row of paired) {
      const classification = classifications.get(row.attribute_id);
      if (!classification) continue;

      // An asset present on only one side is a fleet movement, reported once
      // on its own axis below — not as ~70 value changes.
      if (row.fact_a_id === null || row.fact_b_id === null) continue;

      const before = describeSide(row, "a");
      const after = describeSide(row, "b");

      if (before.hash === after.hash) {
        unchanged++;
        continue;
      }

      const verdict = classifyChange(before, after, classification);
      if (verdict.comparability === "INCONCLUSIVE") inconclusive++;

      const impact = assessImpact({
        classification,
        numericBefore: before.numeric,
        numericAfter: after.numeric,
        comparable: verdict.comparability === "COMPARABLE",
      });
      if (impact.confidence === "CALCULATED" && impact.amount !== null) {
        calculatedImpact += impact.amount;
        hasCalculated = true;
      } else {
        impactNotCalculable++;
      }

      rows.push({
        changeSetId: set.id,
        category: "SOURCE_CHANGE",
        changeType: "VALUE_CHANGED",
        nature: verdict.nature,
        entityId: row.entity_id,
        attributeId: row.attribute_id,
        factAId: row.fact_a_id,
        factBId: row.fact_b_id,
        valueBefore: before.display,
        valueAfter: after.display,
        numericBefore: before.numeric === null ? null : String(before.numeric),
        numericAfter: after.numeric === null ? null : String(after.numeric),
        isNullBefore: before.isNull,
        isNullAfter: after.isNull,
        nullReasonBefore: before.nullReason,
        nullReasonAfter: after.nullReason,
        deltaAbsolute: verdict.delta === null ? null : String(verdict.delta),
        deltaPercent: verdict.deltaPercent === null ? null : String(verdict.deltaPercent),
        comparability: verdict.comparability,
        inconclusiveReason: verdict.inconclusiveReason,
        impactConfidence: impact.confidence,
        impactAmount: impact.amount === null ? null : String(impact.amount),
        impactPeriodicity: impact.periodicity,
        impactReason: impact.reason,
        ...classificationColumns(classification),
        entityLabel: row.entity_label,
      });
    }

    // ---------------------------------------------------------------------
    // Axis 2 — fleet movement
    // ---------------------------------------------------------------------
    const { rows: fleet } = await tx.execute<{
      entity_id: string;
      entity_label: string | null;
      entity_type: string;
      direction: string;
    }>(sql`
      WITH ea AS (SELECT DISTINCT entity_id FROM fact WHERE snapshot_id = ${snapshotAId}),
           eb AS (SELECT DISTINCT entity_id FROM fact WHERE snapshot_id = ${snapshotBId})
      SELECT COALESCE(ea.entity_id, eb.entity_id) AS entity_id,
             i.identifier_value AS entity_label,
             e.entity_type,
             CASE WHEN ea.entity_id IS NULL THEN 'ADDED' ELSE 'REMOVED' END AS direction
        FROM ea
        FULL OUTER JOIN eb ON eb.entity_id = ea.entity_id
        JOIN entity e ON e.id = COALESCE(ea.entity_id, eb.entity_id)
        LEFT JOIN entity_identifier i
          ON i.entity_id = e.id AND i.identifier_type = 'PLACA' AND i.is_current
       WHERE ea.entity_id IS NULL OR eb.entity_id IS NULL
    `);

    let entitiesAdded = 0;
    let entitiesRemoved = 0;
    for (const row of fleet) {
      if (row.direction === "ADDED") entitiesAdded++;
      else entitiesRemoved++;
      impactNotCalculable++;
      rows.push({
        changeSetId: set.id,
        category: "FLEET_CHANGE",
        changeType: row.direction === "ADDED" ? "ENTITY_ADDED" : "ENTITY_REMOVED",
        nature: row.direction === "ADDED" ? "APPEARED" : "DISAPPEARED",
        entityId: row.entity_id,
        valueBefore: row.direction === "ADDED" ? null : "presente",
        valueAfter: row.direction === "ADDED" ? "presente" : null,
        comparability: "COMPARABLE",
        impactConfidence: "NOT_CALCULABLE",
        impactReason:
          "Entrada e saída de ativo mudam a base da frota. O valor disso depende de " +
          "quais atributos são somáveis, o que ainda depende de curadoria.",
        entityLabel: row.entity_label,
        entityType: row.entity_type,
      });
    }

    // ---------------------------------------------------------------------
    // Axis 3 — layout: a column that appeared or vanished
    // ---------------------------------------------------------------------
    const { rows: layout } = await tx.execute<{
      attribute_id: string;
      direction: string;
    }>(sql`
      WITH la AS (SELECT attribute_id FROM snapshot_attribute WHERE snapshot_id = ${snapshotAId}),
           lb AS (SELECT attribute_id FROM snapshot_attribute WHERE snapshot_id = ${snapshotBId})
      SELECT COALESCE(la.attribute_id, lb.attribute_id) AS attribute_id,
             CASE WHEN la.attribute_id IS NULL THEN 'ADDED' ELSE 'REMOVED' END AS direction
        FROM la
        FULL OUTER JOIN lb ON lb.attribute_id = la.attribute_id
       WHERE la.attribute_id IS NULL OR lb.attribute_id IS NULL
    `);

    let attributesAdded = 0;
    let attributesRemoved = 0;
    for (const row of layout) {
      const classification = classifications.get(row.attribute_id);
      if (row.direction === "ADDED") attributesAdded++;
      else attributesRemoved++;
      impactNotCalculable++;
      rows.push({
        changeSetId: set.id,
        category: "LAYOUT_CHANGE",
        changeType: row.direction === "ADDED" ? "ATTRIBUTE_ADDED" : "ATTRIBUTE_REMOVED",
        nature: row.direction === "ADDED" ? "APPEARED" : "DISAPPEARED",
        attributeId: row.attribute_id,
        valueBefore: row.direction === "ADDED" ? null : "no layout",
        valueAfter: row.direction === "ADDED" ? "no layout" : null,
        comparability: "COMPARABLE",
        impactConfidence: "NOT_CALCULABLE",
        impactReason:
          row.direction === "ADDED"
            ? "Coluna nova: não há valor anterior com que comparar."
            : "Coluna deixou de vir no export: não há valor novo com que comparar.",
        ...(classification ? classificationColumns(classification) : {}),
      });
    }

    for (let i = 0; i < rows.length; i += 1000) {
      await tx.insert(changeTable).values(rows.slice(i, i + 1000));
    }

    const [updated] = await tx
      .update(changeSetTable)
      .set({
        status: "DONE",
        valueChanges: rows.filter((r) => r.category === "SOURCE_CHANGE").length,
        entitiesAdded,
        entitiesRemoved,
        attributesAdded,
        attributesRemoved,
        unchanged,
        inconclusive,
        calculatedImpact: hasCalculated ? String(calculatedImpact) : null,
        impactNotCalculable,
      })
      .where(eq(changeSetTable.id, set.id))
      .returning();

    return toSummary(updated, a.sourceLabel, b.sourceLabel);
  });
}

function classificationColumns(c: AttributeClassification) {
  return {
    costClass: c.costClass,
    taxonomyPath: c.taxonomyPath,
    taxonomyName: c.taxonomyName,
    semanticsStatus: c.semanticsStatus,
    attributeCode: c.attributeCode,
    attributeName: c.attributeName,
    entityType: c.entityType,
  };
}

interface Side {
  numeric: number | null;
  text: string | null;
  boolean: boolean | null;
  date: string | null;
  isNull: boolean;
  nullReason: string | null;
  display: string | null;
  /** Exact tuple identity, independent of any stored hash. */
  hash: string;
}

/**
 * Read one side of the pair from typed columns rather than from the stored
 * `value_hash`.
 *
 * The stored hash is produced by the importer, so two snapshots read by
 * different parser versions could hash equal values differently. Comparing the
 * typed tuple is immune to that, and costs nothing extra given the join.
 */
function describeSide(row: PairedFact, side: "a" | "b"): Side {
  const numericRaw = side === "a" ? row.a_numeric : row.b_numeric;
  const text = side === "a" ? row.a_text : row.b_text;
  const bool = side === "a" ? row.a_boolean : row.b_boolean;
  const date = side === "a" ? row.a_date : row.b_date;
  const isNull = (side === "a" ? row.a_is_null : row.b_is_null) ?? false;
  const nullReason = side === "a" ? row.a_null_reason : row.b_null_reason;
  const numeric = numericRaw === null ? null : Number(numericRaw);

  let display: string | null = null;
  let hash: string;
  if (isNull) {
    display = null;
    hash = `0:${nullReason ?? "?"}`;
  } else if (numeric !== null) {
    display = trimNumber(numeric);
    hash = `n:${display}`;
  } else if (bool !== null) {
    display = bool ? "true" : "false";
    hash = `b:${display}`;
  } else if (date !== null) {
    display = date;
    hash = `d:${date}`;
  } else {
    display = text;
    hash = `s:${text ?? ""}`;
  }

  return { numeric, text, boolean: bool, date, isNull, nullReason, display, hash };
}

function trimNumber(value: number): string {
  const fixed = value.toFixed(6);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

interface ChangeVerdict {
  nature: string;
  delta: number | null;
  deltaPercent: number | null;
  comparability: "COMPARABLE" | "INCONCLUSIVE";
  inconclusiveReason: string | null;
}

/**
 * What kind of change this is, and whether the two sides can honestly be held
 * against each other.
 *
 * "Inconclusive" is a first-class outcome, not a failure: a column the source
 * types inconsistently, or a value that appears where none existed, genuinely
 * cannot yield a variation, and saying so beats printing a number.
 */
export function classifyChange(
  before: Side,
  after: Side,
  classification: AttributeClassification,
): ChangeVerdict {
  // Appearing or disappearing values: real, reportable, but no variation.
  if (before.isNull !== after.isNull) {
    return {
      nature: before.isNull ? "APPEARED" : "DISAPPEARED",
      delta: null,
      deltaPercent: null,
      comparability: "INCONCLUSIVE",
      inconclusiveReason: before.isNull
        ? `Antes não havia valor (${before.nullReason}); agora há. Não existe variação a calcular.`
        : `Antes havia valor; agora não há (${after.nullReason}). Não existe variação a calcular.`,
    };
  }

  // Both absent, but for different reasons — the source changed its mind about
  // *why* the value is missing, which is worth reporting and not a variation.
  if (before.isNull && after.isNull) {
    return {
      nature: "NULL_REASON",
      delta: null,
      deltaPercent: null,
      comparability: "INCONCLUSIVE",
      inconclusiveReason: `O motivo da ausência mudou: ${before.nullReason} → ${after.nullReason}.`,
    };
  }

  if (classification.dataType === "MIXED") {
    return {
      nature: "TEXT",
      delta: null,
      deltaPercent: null,
      comparability: "INCONCLUSIVE",
      inconclusiveReason:
        "A fonte entrega esta coluna com mais de um tipo no mesmo import; " +
        "comparar os dois lados como se fossem da mesma natureza seria arriscado.",
    };
  }

  if (before.numeric !== null && after.numeric !== null) {
    const delta = after.numeric - before.numeric;
    const deltaPercent =
      before.numeric === 0 ? null : (delta / Math.abs(before.numeric)) * 100;
    const nature =
      after.numeric === 0 && before.numeric !== 0
        ? "ZEROING"
        : before.numeric === 0 && after.numeric !== 0
          ? "FROM_ZERO"
          : "NUMERIC";
    return {
      nature,
      delta,
      deltaPercent,
      comparability: "COMPARABLE",
      inconclusiveReason: null,
    };
  }

  if (before.boolean !== null && after.boolean !== null) {
    return {
      nature: "BOOLEAN",
      delta: null,
      deltaPercent: null,
      comparability: "COMPARABLE",
      inconclusiveReason: null,
    };
  }

  if (before.date !== null && after.date !== null) {
    return {
      nature: "DATE",
      delta: null,
      deltaPercent: null,
      comparability: "COMPARABLE",
      inconclusiveReason: null,
    };
  }

  if (before.text !== null && after.text !== null) {
    return {
      nature: "TEXT",
      delta: null,
      deltaPercent: null,
      comparability: "COMPARABLE",
      inconclusiveReason: null,
    };
  }

  // The two sides landed in different typed columns: the source changed the
  // shape of this value, which is exactly the kind of thing not to smooth over.
  return {
    nature: "TYPE_CHANGE",
    delta: null,
    deltaPercent: null,
    comparability: "INCONCLUSIVE",
    inconclusiveReason:
      "O tipo do valor mudou entre os dois snapshots; não dá para comparar as duas naturezas com segurança.",
  };
}

function toSummary(
  set: typeof changeSetTable.$inferSelect,
  labelA: string,
  labelB: string,
): ChangeSetSummary {
  return {
    id: set.id,
    snapshotAId: set.snapshotAId,
    snapshotBId: set.snapshotBId,
    snapshotALabel: labelA,
    snapshotBLabel: labelB,
    valueChanges: set.valueChanges,
    entitiesAdded: set.entitiesAdded,
    entitiesRemoved: set.entitiesRemoved,
    attributesAdded: set.attributesAdded,
    attributesRemoved: set.attributesRemoved,
    unchanged: set.unchanged,
    inconclusive: set.inconclusive,
    calculatedImpact:
      set.calculatedImpact === null ? null : Number(set.calculatedImpact),
    impactNotCalculable: set.impactNotCalculable,
  };
}
