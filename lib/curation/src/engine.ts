import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
  factTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  snapshotTable,
  taxonomyNodeTable,
} from "@workspace/db";
import {
  detectPeriodicityConflicts,
  proposeSemantics,
  type Aggregation,
  type AttributeEvidence,
  type PairRatioStats,
  type PeriodicityConflict,
  type Periodicity,
  type Unit,
} from "./semantics";

/**
 * The curation engine.
 *
 * It reads facts, proposes meaning, and records every edit it makes as a
 * CURATION_CHANGE. What it cannot do — structurally, not by policy — is
 * confirm anything: the `attribute_confirmed_requires_actor` constraint
 * rejects a CONFIRMED row that carries no human confirmer.
 */

/** Snapshot used for the magnitude figures. The most recent live one. */
async function latestSnapshotId(db: Database): Promise<string | null> {
  const [snapshot] = await db
    .select({ id: snapshotTable.id })
    .from(snapshotTable)
    .where(sql`${snapshotTable.status} <> 'SUPERSEDED'`)
    .orderBy(desc(snapshotTable.effectiveDate))
    .limit(1);
  return snapshot?.id ?? null;
}

/**
 * Gather what the data itself says about each attribute.
 *
 * `latestSum` is a raw, unaudited sum used only to order the queue by
 * magnitude. It is never presented as an audited amount — the semantics that
 * would make it one are exactly what is still missing.
 */
export async function gatherEvidence(db: Database): Promise<AttributeEvidence[]> {
  const snapshotId = await latestSnapshotId(db);

  const rows = await db
    .select({
      code: attributeTable.code,
      sourceName: attributeTable.sourceName,
      entityType: attributeTable.entityType,
      dataType: attributeTable.dataType,
      valueCount: sql<number>`count(*) FILTER (WHERE NOT ${factTable.isNull})`.mapWith(Number),
      nullCount: sql<number>`count(*) FILTER (WHERE ${factTable.isNull})`.mapWith(Number),
      distinctCount: sql<number>`count(DISTINCT ${factTable.valueHash})`.mapWith(Number),
      min: sql<string | null>`min(${factTable.valueNumeric})`,
      max: sql<string | null>`max(${factTable.valueNumeric})`,
      mean: sql<string | null>`avg(${factTable.valueNumeric})`,
      zeroCount: sql<number>`count(*) FILTER (WHERE ${factTable.valueNumeric} = 0)`.mapWith(Number),
      negativeCount: sql<number>`count(*) FILTER (WHERE ${factTable.valueNumeric} < 0)`.mapWith(Number),
      latestSum: snapshotId
        ? sql<string | null>`sum(${factTable.valueNumeric}) FILTER (WHERE ${factTable.snapshotId} = ${snapshotId})`
        : sql<string | null>`NULL`,
    })
    .from(attributeTable)
    .leftJoin(factTable, eq(factTable.attributeId, attributeTable.id))
    .groupBy(
      attributeTable.code,
      attributeTable.sourceName,
      attributeTable.entityType,
      attributeTable.dataType,
    );

  const num = (v: string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({
    code: r.code,
    sourceName: r.sourceName,
    entityType: r.entityType,
    dataType: r.dataType,
    valueCount: r.valueCount,
    nullCount: r.nullCount,
    distinctCount: r.distinctCount,
    min: num(r.min),
    max: num(r.max),
    mean: num(r.mean),
    latestSum: num(r.latestSum),
    zeroCount: r.zeroCount,
    negativeCount: r.negativeCount,
  }));
}

/**
 * Per-asset ratio between each `X_mensal` column and its `X` counterpart, in
 * the latest snapshot.
 *
 * This is what tells homonymy from a real periodicity contradiction. Comparing
 * the fleet totals cannot: two unrelated columns can add up to any ratio at
 * all, while the same quantity measured twice tracks asset by asset.
 */
export async function gatherPairRatios(
  db: Database,
): Promise<Map<string, PairRatioStats>> {
  const snapshotId = await latestSnapshotId(db);
  if (!snapshotId) return new Map();

  const { rows } = await db.execute<{
    monthly_code: string;
    sample_size: string;
    mean_ratio: string;
    stddev_ratio: string | null;
    min_ratio: string;
    max_ratio: string;
  }>(sql`
    WITH paired AS (
      SELECT monthly.code AS monthly_code,
             f_month.value_numeric / f_base.value_numeric AS ratio
        FROM attribute monthly
        JOIN attribute base
          ON base.code = left(monthly.code, length(monthly.code) - length('_mensal'))
        JOIN fact f_month
          ON f_month.attribute_id = monthly.id
         AND f_month.snapshot_id = ${snapshotId}
         AND NOT f_month.is_null
        JOIN fact f_base
          ON f_base.attribute_id = base.id
         AND f_base.snapshot_id = ${snapshotId}
         AND f_base.entity_id = f_month.entity_id
         AND NOT f_base.is_null
       WHERE monthly.code LIKE '%\\_mensal'
         AND f_base.value_numeric <> 0
         AND f_month.value_numeric IS NOT NULL
    )
    SELECT monthly_code,
           count(*)        AS sample_size,
           avg(ratio)      AS mean_ratio,
           stddev(ratio)   AS stddev_ratio,
           min(ratio)      AS min_ratio,
           max(ratio)      AS max_ratio
      FROM paired
     GROUP BY monthly_code
  `);

  const stats = new Map<string, PairRatioStats>();
  for (const row of rows) {
    stats.set(row.monthly_code, {
      sampleSize: Number(row.sample_size),
      meanRatio: Number(row.mean_ratio),
      stddevRatio: Number(row.stddev_ratio ?? 0),
      minRatio: Number(row.min_ratio),
      maxRatio: Number(row.max_ratio),
    });
  }
  return stats;
}

export interface ProposeResult {
  examined: number;
  proposed: number;
  leftUnknown: number;
  conflicts: PeriodicityConflict[];
  blockedByConflict: string[];
}

/**
 * Run the proposal pass over every attribute that is not already CONFIRMED.
 *
 * Attributes caught in a periodicity conflict are deliberately left UNKNOWN
 * even where a unit could be proposed: presenting a tidy proposal for a column
 * whose own name contradicts its values would invite exactly the wrong
 * confirmation.
 */
export async function runProposalPass(
  db: Database,
  actor: string,
): Promise<ProposeResult> {
  const evidence = await gatherEvidence(db);
  const ratios = await gatherPairRatios(db);
  const conflicts = detectPeriodicityConflicts(evidence, ratios);
  // Only a genuine contradiction withholds a proposal. Two different
  // quantities that merely share a name prefix are reported and then curated
  // normally — blocking them would punish the curator for the source's naming.
  const blocked = new Set<string>();
  for (const conflict of conflicts.filter((c) => c.blocks)) {
    blocked.add(conflict.annualCode);
    blocked.add(conflict.monthlyCode);
  }

  const nodes = await db.select().from(taxonomyNodeTable);
  const nodeByCode = new Map(nodes.map((n) => [n.code, n]));

  const attributes = await db
    .select()
    .from(attributeTable)
    .where(sql`${attributeTable.semanticsStatus} <> 'CONFIRMED'`);
  const byCode = new Map(attributes.map((a) => [a.code, a]));

  let proposed = 0;
  let leftUnknown = 0;

  for (const item of evidence) {
    const attribute = byCode.get(item.code);
    if (!attribute) continue;

    const proposal = proposeSemantics(item);
    const conflict = conflicts.find(
      (c) => c.blocks && (c.annualCode === item.code || c.monthlyCode === item.code),
    );

    const node = nodeByCode.get(proposal.taxonomyCode) ?? nodeByCode.get("nao_classificado");

    const nextStatus = conflict ? "UNKNOWN" : proposal.status;
    const note = conflicts.find(
      (c) => !c.blocks && (c.annualCode === item.code || c.monthlyCode === item.code),
    );
    const rationale = conflict
      ? `CONFLITO DE PERIODICIDADE. ${conflict.message} Proposta suspensa: ${proposal.rationale}`
      : note
        ? `ATENÇÃO — NOMES HOMÔNIMOS. ${note.message} ${proposal.rationale}`
        : proposal.rationale;

    const changes: { field: string; before: string | null; after: string | null }[] = [];
    const record = (field: string, before: unknown, after: unknown) => {
      const b = before === null || before === undefined ? null : String(before);
      const a = after === null || after === undefined ? null : String(after);
      if (b !== a) changes.push({ field, before: b, after: a });
    };

    record("unit", attribute.unit, conflict ? null : proposal.unit);
    record("aggregation", attribute.aggregation, conflict ? null : proposal.aggregation);
    record("is_monetary", attribute.isMonetary, conflict ? null : proposal.isMonetary);
    record("taxonomy_node_id", attribute.taxonomyNodeId, node?.id ?? null);
    record("semantics_status", attribute.semanticsStatus, nextStatus);

    if (changes.length === 0) {
      if (attribute.semanticsStatus === "UNKNOWN") leftUnknown++;
      continue;
    }

    await db
      .update(attributeTable)
      .set({
        unit: conflict ? null : proposal.unit,
        // Periodicity is never proposed. It is the one field only a human can
        // fill, and the one the export's naming actively misleads about.
        periodicity: attribute.periodicity,
        aggregation: conflict ? null : proposal.aggregation,
        isMonetary: conflict ? null : proposal.isMonetary,
        taxonomyNodeId: node?.id ?? null,
        semanticsStatus: nextStatus,
        semanticsRationale: rationale,
      })
      .where(eq(attributeTable.id, attribute.id));

    await db.insert(curationEventTable).values(
      changes.map((c) => ({
        targetKind: "ATTRIBUTE",
        targetId: attribute.id,
        targetLabel: attribute.code,
        field: c.field,
        valueBefore: c.before,
        valueAfter: c.after,
        actor,
        reason: rationale,
      })),
    );

    if (nextStatus === "PRESUMED") proposed++;
    else leftUnknown++;
  }

  return {
    examined: evidence.length,
    proposed,
    leftUnknown,
    conflicts,
    blockedByConflict: [...blocked].sort(),
  };
}

export interface ConfirmInput {
  code: string;
  unit?: Unit | null;
  periodicity?: Periodicity | null;
  aggregation?: Aggregation | null;
  isMonetary?: boolean | null;
  taxonomyCode?: string;
  displayName?: string;
  actor: string;
  reason: string;
}

/**
 * Promote an attribute to CONFIRMED.
 *
 * The only path to CONFIRMED in the whole codebase. Every guard below is
 * duplicated as a database constraint — this function produces a readable
 * error, the constraint makes the rule unavoidable.
 */
export async function confirmAttribute(
  db: Database,
  input: ConfirmInput,
): Promise<void> {
  if (!input.actor?.trim()) {
    throw new Error("A confirmação exige um responsável identificado.");
  }
  if (!input.reason?.trim()) {
    throw new Error(
      "A confirmação exige uma justificativa — é o que um revisor vai querer ler depois.",
    );
  }

  const [attribute] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, input.code));
  if (!attribute) throw new Error(`Atributo "${input.code}" não encontrado.`);

  const unit = input.unit !== undefined ? input.unit : attribute.unit;
  const periodicity =
    input.periodicity !== undefined ? input.periodicity : attribute.periodicity;
  const aggregation =
    input.aggregation !== undefined ? input.aggregation : attribute.aggregation;
  const isMonetary =
    input.isMonetary !== undefined ? input.isMonetary : attribute.isMonetary;

  if (isMonetary === true && (!unit || !periodicity || !aggregation)) {
    throw new Error(
      `"${input.code}" é monetário: unidade, periodicidade e forma de agregação precisam estar definidas antes de confirmar. ` +
        `Sem isso, somar este atributo é adivinhação.`,
    );
  }

  let taxonomyNodeId = attribute.taxonomyNodeId;
  if (input.taxonomyCode) {
    const [node] = await db
      .select()
      .from(taxonomyNodeTable)
      .where(eq(taxonomyNodeTable.code, input.taxonomyCode));
    if (!node) throw new Error(`Nó de taxonomia "${input.taxonomyCode}" não existe.`);
    taxonomyNodeId = node.id;
  }

  const changes: { field: string; before: string | null; after: string | null }[] = [];
  const record = (field: string, before: unknown, after: unknown) => {
    const b = before === null || before === undefined ? null : String(before);
    const a = after === null || after === undefined ? null : String(after);
    if (b !== a) changes.push({ field, before: b, after: a });
  };
  record("unit", attribute.unit, unit);
  record("periodicity", attribute.periodicity, periodicity);
  record("aggregation", attribute.aggregation, aggregation);
  record("is_monetary", attribute.isMonetary, isMonetary);
  record("taxonomy_node_id", attribute.taxonomyNodeId, taxonomyNodeId);
  record("display_name", attribute.displayName, input.displayName ?? attribute.displayName);
  record("semantics_status", attribute.semanticsStatus, "CONFIRMED");

  await db.transaction(async (tx) => {
    await tx
      .update(attributeTable)
      .set({
        unit,
        periodicity,
        aggregation,
        isMonetary,
        taxonomyNodeId,
        displayName: input.displayName ?? attribute.displayName,
        semanticsStatus: "CONFIRMED",
        semanticsRationale: input.reason,
        confirmedBy: input.actor,
        confirmedAt: new Date(),
      })
      .where(eq(attributeTable.id, attribute.id));

    if (changes.length > 0) {
      await tx.insert(curationEventTable).values(
        changes.map((c) => ({
          targetKind: "ATTRIBUTE",
          targetId: attribute.id,
          targetLabel: attribute.code,
          field: c.field,
          valueBefore: c.before,
          valueAfter: c.after,
          actor: input.actor,
          reason: input.reason,
        })),
      );
    }
  });
}

export interface QueueItem {
  code: string;
  sourceName: string;
  displayName: string | null;
  entityType: string;
  dataType: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  semanticsRationale: string | null;
  /** What a curator wrote this column is. Independent of `semanticsStatus`. */
  definition: string | null;
  /** How the source produces it, from the version in force. */
  calculationBasis: string | null;
  taxonomyPath: string | null;
  taxonomyName: string | null;
  costClass: string | null;
  valueCount: number;
  nullCount: number;
  /** Raw unaudited sum over the latest snapshot. Ordering only, never a result. */
  magnitude: number | null;
}

/**
 * The work queue, ordered by how much is riding on each answer.
 *
 * Ordering is by raw magnitude, which is honest for prioritising and useless
 * as a result: an attribute whose periodicity is unknown might be a monthly
 * figure or an annual one, and until that is settled the number means nothing.
 * The UI labels it accordingly.
 */
export async function getCurationQueue(
  db: Database,
  options: { includeConfirmed?: boolean } = {},
): Promise<QueueItem[]> {
  const evidence = await gatherEvidence(db);
  const evidenceByCode = new Map(evidence.map((e) => [e.code, e]));

  const rows = await db
    .select({
      code: attributeTable.code,
      sourceName: attributeTable.sourceName,
      displayName: attributeTable.displayName,
      entityType: attributeTable.entityType,
      dataType: attributeTable.dataType,
      unit: attributeTable.unit,
      periodicity: attributeTable.periodicity,
      aggregation: attributeTable.aggregation,
      isMonetary: attributeTable.isMonetary,
      semanticsStatus: attributeTable.semanticsStatus,
      semanticsRationale: attributeTable.semanticsRationale,
      definition: attributeTable.definition,
      calculationBasis: attributeSemanticsTable.calculationBasis,
      taxonomyPath: taxonomyNodeTable.path,
      taxonomyName: taxonomyNodeTable.name,
      costClass: taxonomyNodeTable.costClass,
    })
    .from(attributeTable)
    .leftJoin(
      taxonomyNodeTable,
      eq(attributeTable.taxonomyNodeId, taxonomyNodeTable.id),
    )
    // The version in force, for its `calculation_basis`. Left-joined and
    // filtered on `effective_until IS NULL` inside the join: an attribute with
    // no version yet must still appear in the queue — it is precisely the one
    // nobody has looked at.
    .leftJoin(
      attributeSemanticsTable,
      and(
        eq(attributeSemanticsTable.attributeId, attributeTable.id),
        isNull(attributeSemanticsTable.effectiveUntil),
      ),
    )
    .where(
      options.includeConfirmed
        ? sql`true`
        : sql`${attributeTable.semanticsStatus} <> 'CONFIRMED'`,
    );

  const items: QueueItem[] = rows.map((r) => {
    const e = evidenceByCode.get(r.code);
    return {
      ...r,
      valueCount: e?.valueCount ?? 0,
      nullCount: e?.nullCount ?? 0,
      magnitude: e?.latestSum ?? null,
    };
  });

  // Monetary first, then by magnitude: the ~20 attributes that carry the money
  // rise to the top, which is where the curator's time is worth most.
  return items.sort((a, b) => {
    const aMoney = a.isMonetary === true ? 1 : 0;
    const bMoney = b.isMonetary === true ? 1 : 0;
    if (aMoney !== bMoney) return bMoney - aMoney;
    return Math.abs(b.magnitude ?? 0) - Math.abs(a.magnitude ?? 0);
  });
}

export interface AttributeDetail extends QueueItem {
  /** Real values with full provenance, so a decision is made against evidence. */
  samples: {
    snapshotLabel: string;
    effectiveDate: string;
    plate: string | null;
    value: string | null;
    isNull: boolean;
    nullReason: string | null;
    sheet: string;
    row: number;
    column: string;
    columnHeader: string | null;
    originalValue: string | null;
    originalType: string;
  }[];
  /** Value across vigências, for the shape of the series. */
  history: { snapshotLabel: string; effectiveDate: string; sum: number | null; count: number }[];
  events: {
    field: string;
    valueBefore: string | null;
    valueAfter: string | null;
    actor: string;
    reason: string | null;
    createdAt: Date;
  }[];
}

export async function getAttributeDetail(
  db: Database,
  code: string,
): Promise<AttributeDetail | null> {
  const [queueItem] = await getCurationQueue(db, { includeConfirmed: true }).then((q) =>
    q.filter((i) => i.code === code),
  );
  if (!queueItem) return null;

  const [attribute] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, code));

  const samples = await db
    .select({
      snapshotLabel: snapshotTable.sourceLabel,
      effectiveDate: snapshotTable.effectiveDate,
      value: factTable.valueNumeric,
      valueText: factTable.valueText,
      isNull: factTable.isNull,
      nullReason: factTable.nullReason,
      sheet: rawSheetTable.sheetName,
      row: rawRowTable.rowIndex,
      column: rawCellTable.columnLetter,
      columnHeader: rawCellTable.columnHeader,
      originalValue: rawCellTable.rawValue,
      originalType: rawCellTable.sourceType,
    })
    .from(factTable)
    .innerJoin(snapshotTable, eq(factTable.snapshotId, snapshotTable.id))
    .innerJoin(rawCellTable, eq(factTable.rawCellId, rawCellTable.id))
    .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
    .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
    .where(eq(factTable.attributeId, attribute.id))
    .orderBy(desc(snapshotTable.effectiveDate))
    .limit(12);

  const history = await db
    .select({
      snapshotLabel: snapshotTable.sourceLabel,
      effectiveDate: snapshotTable.effectiveDate,
      sum: sql<string | null>`sum(${factTable.valueNumeric})`,
      count: sql<number>`count(*) FILTER (WHERE NOT ${factTable.isNull})`.mapWith(Number),
    })
    .from(factTable)
    .innerJoin(snapshotTable, eq(factTable.snapshotId, snapshotTable.id))
    .where(eq(factTable.attributeId, attribute.id))
    .groupBy(snapshotTable.sourceLabel, snapshotTable.effectiveDate)
    .orderBy(snapshotTable.effectiveDate);

  const events = await db
    .select({
      field: curationEventTable.field,
      valueBefore: curationEventTable.valueBefore,
      valueAfter: curationEventTable.valueAfter,
      actor: curationEventTable.actor,
      reason: curationEventTable.reason,
      createdAt: curationEventTable.createdAt,
    })
    .from(curationEventTable)
    .where(
      and(
        eq(curationEventTable.targetKind, "ATTRIBUTE"),
        eq(curationEventTable.targetId, attribute.id),
      ),
    )
    .orderBy(desc(curationEventTable.createdAt))
    .limit(50);

  return {
    ...queueItem,
    samples: samples.map((s) => ({
      snapshotLabel: s.snapshotLabel,
      effectiveDate: s.effectiveDate,
      plate: null,
      value: s.value ?? s.valueText,
      isNull: s.isNull,
      nullReason: s.nullReason,
      sheet: s.sheet,
      row: s.row,
      column: s.column,
      columnHeader: s.columnHeader,
      originalValue: s.originalValue,
      originalType: s.originalType,
    })),
    history: history.map((h) => ({
      snapshotLabel: h.snapshotLabel,
      effectiveDate: h.effectiveDate,
      sum: h.sum === null ? null : Number(h.sum),
      count: h.count,
    })),
    events,
  };
}

/** Counts for the curation dashboard header. */
export async function getCurationSummary(db: Database) {
  const rows = await db
    .select({
      status: attributeTable.semanticsStatus,
      count: sql<number>`count(*)`.mapWith(Number),
      monetary: sql<number>`count(*) FILTER (WHERE ${attributeTable.isMonetary})`.mapWith(Number),
    })
    .from(attributeTable)
    .groupBy(attributeTable.semanticsStatus)
    // Deterministic order: a grouped result has none by default, and a caller
    // that reads "the first row" would otherwise get a different answer per
    // request.
    .orderBy(attributeTable.semanticsStatus);

  const [unclassified] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(attributeTable)
    .leftJoin(taxonomyNodeTable, eq(attributeTable.taxonomyNodeId, taxonomyNodeTable.id))
    .where(
      sql`${taxonomyNodeTable.id} IS NULL OR ${taxonomyNodeTable.code} = 'nao_classificado'`,
    );

  return {
    byStatus: rows,
    unclassified: unclassified?.count ?? 0,
  };
}
