import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
  snapshotTable,
  taxonomyNodeTable,
} from "@workspace/db";

/**
 * Versioned semantics.
 *
 * The rule that shapes everything here: a new version and a correction are
 * different events with opposite consequences.
 *
 * - The source changed the meaning from a vigência onward → a new version,
 *   the old one preserved, and news for the Alterações screen.
 * - We understood it wrong → the existing version is amended for its whole
 *   stretch, recorded in `curation_event`, and reported to nobody as a change
 *   the Ambev made.
 *
 * Getting that backwards would have the product announce a contract change
 * that never happened, which is the worst thing it could do.
 */

export interface SemanticsVersion {
  id: string;
  attributeId: string;
  version: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  taxonomyNodeId: string | null;
  calculationBasis: string | null;
  semanticsStatus: string;
  confirmedBy: string | null;
  rationale: string | null;
  changeOrigin: string;
  supersedeReason: string | null;
}

/** The earliest vigência on record — where version 1 of everything begins. */
async function seriesStart(db: Database): Promise<string> {
  const [row] = await db
    .select({ date: snapshotTable.effectiveDate })
    .from(snapshotTable)
    .orderBy(asc(snapshotTable.effectiveDate))
    .limit(1);
  // No vigências yet: any date works as long as it precedes everything.
  return row?.date ?? "1970-01-01";
}

export interface BackfillResult {
  created: number;
  existing: number;
  from: string;
}

/**
 * Give every attribute a version 1 covering the whole series.
 *
 * Idempotent, and the reason existing comparisons keep their numbers: with one
 * version per attribute both sides of any comparison resolve to it, nothing is
 * flagged incompatible, and no SEMANTICS_CHANGE is emitted.
 */
export async function backfillSemantics(db: Database): Promise<BackfillResult> {
  const from = await seriesStart(db);
  const attributes = await db.select().from(attributeTable);

  let created = 0;
  let existing = 0;

  for (const attribute of attributes) {
    const [already] = await db
      .select({ id: attributeSemanticsTable.id })
      .from(attributeSemanticsTable)
      .where(eq(attributeSemanticsTable.attributeId, attribute.id))
      .limit(1);
    if (already) {
      existing++;
      continue;
    }

    await db.insert(attributeSemanticsTable).values({
      attributeId: attribute.id,
      version: 1,
      effectiveFrom: from,
      effectiveUntil: null,
      unit: attribute.unit,
      periodicity: attribute.periodicity,
      aggregation: attribute.aggregation,
      isMonetary: attribute.isMonetary,
      taxonomyNodeId: attribute.taxonomyNodeId,
      calculationBasis: null,
      semanticsStatus: attribute.semanticsStatus,
      confirmedBy: attribute.confirmedBy,
      confirmedAt: attribute.confirmedAt,
      rationale: attribute.semanticsRationale,
      changeOrigin: "INITIAL",
    });
    created++;
  }

  return { created, existing, from };
}

/**
 * The semantics in force for every attribute on a given date.
 *
 * Keyed by attribute id. An attribute with no version covering that date is
 * absent from the map rather than defaulted — the caller decides what to do
 * with "we have no idea what this meant back then".
 */
export async function resolveSemanticsAt(
  db: Database,
  date: string,
): Promise<Map<string, SemanticsVersion>> {
  const rows = await db
    .select()
    .from(attributeSemanticsTable)
    .where(
      sql`${attributeSemanticsTable.effectiveFrom} <= ${date}
          AND (${attributeSemanticsTable.effectiveUntil} IS NULL
               OR ${date} < ${attributeSemanticsTable.effectiveUntil})`,
    );

  const map = new Map<string, SemanticsVersion>();
  for (const row of rows) map.set(row.attributeId, row as SemanticsVersion);
  return map;
}

export interface VersionedAttributeRow extends Record<string, unknown> {
  code: string;
  sourceName: string;
  entityType: string;
  versions: number;
  currentStatus: string;
  currentPeriodicity: string | null;
  currentUnit: string | null;
  isMonetary: boolean | null;
  calculationBasis: string | null;
  /** True when the source has changed this column's meaning at least once. */
  hasSourceChange: boolean;
}

/** Attributes with their version count — the list the versions screen opens on. */
export async function listVersionedAttributes(
  db: Database,
): Promise<VersionedAttributeRow[]> {
  const { rows } = await db.execute<VersionedAttributeRow>(sql`
    SELECT a.code,
           a.source_name              AS "sourceName",
           a.entity_type              AS "entityType",
           count(v.id)::int           AS versions,
           a.semantics_status::text   AS "currentStatus",
           a.periodicity::text        AS "currentPeriodicity",
           a.unit::text               AS "currentUnit",
           a.is_monetary              AS "isMonetary",
           max(v.calculation_basis) FILTER (WHERE v.effective_until IS NULL)
                                      AS "calculationBasis",
           bool_or(v.change_origin = 'SOURCE_SEMANTICS_CHANGE') AS "hasSourceChange"
      FROM attribute a
      LEFT JOIN attribute_semantics v ON v.attribute_id = a.id
     GROUP BY a.id, a.code, a.source_name, a.entity_type,
              a.semantics_status, a.periodicity, a.unit, a.is_monetary
     ORDER BY bool_or(v.change_origin = 'SOURCE_SEMANTICS_CHANGE') DESC,
              count(v.id) DESC,
              a.code
  `);
  return rows;
}

/** Every version of one attribute, oldest first. */
export async function getSemanticsHistory(
  db: Database,
  code: string,
): Promise<SemanticsVersion[]> {
  const [attribute] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, code));
  if (!attribute) return [];

  return db
    .select()
    .from(attributeSemanticsTable)
    .where(eq(attributeSemanticsTable.attributeId, attribute.id))
    .orderBy(asc(attributeSemanticsTable.version)) as Promise<SemanticsVersion[]>;
}

export interface SemanticsFields {
  unit?: string | null;
  periodicity?: string | null;
  aggregation?: string | null;
  isMonetary?: boolean | null;
  taxonomyCode?: string | null;
  calculationBasis?: string | null;
}

async function resolveTaxonomyNodeId(
  db: Database,
  taxonomyCode: string | null | undefined,
  fallback: string | null,
): Promise<string | null> {
  if (taxonomyCode === undefined) return fallback;
  if (taxonomyCode === null) return null;
  const [node] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, taxonomyCode));
  if (!node) throw new Error(`Nó de taxonomia "${taxonomyCode}" não existe.`);
  return node.id;
}

/** Copy the current version into `attribute`, which is its projection. */
async function projectCurrentVersion(db: Database, attributeId: string) {
  const [current] = await db
    .select()
    .from(attributeSemanticsTable)
    .where(
      and(
        eq(attributeSemanticsTable.attributeId, attributeId),
        isNull(attributeSemanticsTable.effectiveUntil),
      ),
    );
  if (!current) return;

  await db
    .update(attributeTable)
    .set({
      unit: current.unit as never,
      periodicity: current.periodicity as never,
      aggregation: current.aggregation as never,
      isMonetary: current.isMonetary,
      taxonomyNodeId: current.taxonomyNodeId,
      semanticsStatus: current.semanticsStatus as never,
      semanticsRationale: current.rationale,
      confirmedBy: current.confirmedBy,
      confirmedAt: current.confirmedAt,
    })
    .where(eq(attributeTable.id, attributeId));
}

export interface SourceChangeInput extends SemanticsFields {
  code: string;
  /** The vigência from which the new meaning applies. */
  effectiveFrom: string;
  actor: string;
  reason: string;
  evidenceSnapshotId?: string;
  status?: "PRESUMED" | "CONFIRMED";
}

/**
 * The source changed what a column means, from a vigência onward.
 *
 * Closes the version in force on the day before and opens a new one. The old
 * meaning is never rewritten, because it was true for its stretch.
 */
export async function recordSourceSemanticsChange(
  db: Database,
  input: SourceChangeInput,
): Promise<SemanticsVersion> {
  if (!input.actor?.trim()) throw new Error("Exige um responsável identificado.");
  if (!input.reason?.trim()) throw new Error("Exige uma justificativa.");

  const [attribute] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, input.code));
  if (!attribute) throw new Error(`Atributo "${input.code}" não encontrado.`);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(attributeSemanticsTable)
      .where(
        and(
          eq(attributeSemanticsTable.attributeId, attribute.id),
          isNull(attributeSemanticsTable.effectiveUntil),
        ),
      );
    if (!current) {
      throw new Error(
        `"${input.code}" ainda não tem semântica registrada; rode o backfill antes.`,
      );
    }
    if (input.effectiveFrom <= current.effectiveFrom) {
      throw new Error(
        `A nova semântica começaria em ${input.effectiveFrom}, antes ou junto do início da versão ` +
          `em vigor (${current.effectiveFrom}). Uma mudança da fonte só vale daí em diante; ` +
          `se o entendimento anterior estava errado, isso é correção, não mudança.`,
      );
    }

    const status = input.status ?? "PRESUMED";
    const isMonetary =
      input.isMonetary !== undefined ? input.isMonetary : current.isMonetary;
    const unit = input.unit !== undefined ? input.unit : current.unit;
    const periodicity =
      input.periodicity !== undefined ? input.periodicity : current.periodicity;
    const aggregation =
      input.aggregation !== undefined ? input.aggregation : current.aggregation;

    if (status === "CONFIRMED" && isMonetary === true) {
      if (!unit || !periodicity || !aggregation) {
        throw new Error(
          `"${input.code}" é monetário: unidade, periodicidade e agregação precisam estar definidas para confirmar.`,
        );
      }
    }

    await tx
      .update(attributeSemanticsTable)
      .set({ effectiveUntil: input.effectiveFrom })
      .where(eq(attributeSemanticsTable.id, current.id));

    const [next] = await tx
      .insert(attributeSemanticsTable)
      .values({
        attributeId: attribute.id,
        version: current.version + 1,
        effectiveFrom: input.effectiveFrom,
        effectiveUntil: null,
        unit,
        periodicity,
        aggregation,
        isMonetary,
        taxonomyNodeId: await resolveTaxonomyNodeId(
          tx as unknown as Database,
          input.taxonomyCode,
          current.taxonomyNodeId,
        ),
        calculationBasis:
          input.calculationBasis !== undefined
            ? input.calculationBasis
            : current.calculationBasis,
        semanticsStatus: status,
        confirmedBy: status === "CONFIRMED" ? input.actor : null,
        confirmedAt: status === "CONFIRMED" ? new Date() : null,
        rationale: input.reason,
        changeOrigin: "SOURCE_SEMANTICS_CHANGE",
        supersedeReason: input.reason,
        evidenceSnapshotId: input.evidenceSnapshotId ?? null,
      })
      .returning();

    // Recorded as curation because *we* wrote the row. That the row describes
    // a change the Ambev made is what `change_origin` says, and what the
    // comparison engine reads to emit a SEMANTICS_CHANGE.
    await tx.insert(curationEventTable).values({
      targetKind: "ATTRIBUTE_SEMANTICS",
      targetId: next.id,
      targetLabel: attribute.code,
      field: "version",
      valueBefore: String(current.version),
      valueAfter: String(next.version),
      actor: input.actor,
      reason: input.reason,
      detail: {
        effectiveFrom: input.effectiveFrom,
        changeOrigin: "SOURCE_SEMANTICS_CHANGE",
      },
    });

    await projectCurrentVersion(tx as unknown as Database, attribute.id);
    return next as SemanticsVersion;
  });
}

export interface CorrectionInput extends SemanticsFields {
  code: string;
  /** Which version to amend. Defaults to the one in force. */
  version?: number;
  actor: string;
  reason: string;
  status?: "PRESUMED" | "CONFIRMED";
}

/**
 * We got it wrong. Amend the version, for the whole stretch it covers.
 *
 * A correction never splits the timeline: if the meaning genuinely changed on
 * a date, that is the source changing, not us being wrong, and
 * {@link recordSourceSemanticsChange} is the operation for it.
 */
export async function correctSemantics(
  db: Database,
  input: CorrectionInput,
): Promise<SemanticsVersion> {
  if (!input.actor?.trim()) throw new Error("Exige um responsável identificado.");
  if (!input.reason?.trim()) throw new Error("Exige uma justificativa.");

  const [attribute] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, input.code));
  if (!attribute) throw new Error(`Atributo "${input.code}" não encontrado.`);

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(attributeSemanticsTable)
      .where(
        input.version !== undefined
          ? and(
              eq(attributeSemanticsTable.attributeId, attribute.id),
              eq(attributeSemanticsTable.version, input.version),
            )
          : and(
              eq(attributeSemanticsTable.attributeId, attribute.id),
              isNull(attributeSemanticsTable.effectiveUntil),
            ),
      );
    if (!target) throw new Error(`Versão não encontrada para "${input.code}".`);

    const status = input.status ?? target.semanticsStatus;
    const unit = input.unit !== undefined ? input.unit : target.unit;
    const periodicity =
      input.periodicity !== undefined ? input.periodicity : target.periodicity;
    const aggregation =
      input.aggregation !== undefined ? input.aggregation : target.aggregation;
    const isMonetary =
      input.isMonetary !== undefined ? input.isMonetary : target.isMonetary;

    if (status === "CONFIRMED" && isMonetary === true) {
      if (!unit || !periodicity || !aggregation) {
        throw new Error(
          `"${input.code}" é monetário: unidade, periodicidade e agregação precisam estar definidas para confirmar.`,
        );
      }
    }

    const changes: { field: string; before: string | null; after: string | null }[] = [];
    const record = (field: string, before: unknown, after: unknown) => {
      const b = before === null || before === undefined ? null : String(before);
      const a = after === null || after === undefined ? null : String(after);
      if (b !== a) changes.push({ field, before: b, after: a });
    };
    record("unit", target.unit, unit);
    record("periodicity", target.periodicity, periodicity);
    record("aggregation", target.aggregation, aggregation);
    record("is_monetary", target.isMonetary, isMonetary);
    record("calculation_basis", target.calculationBasis, input.calculationBasis);
    record("semantics_status", target.semanticsStatus, status);

    const [updated] = await tx
      .update(attributeSemanticsTable)
      .set({
        unit,
        periodicity,
        aggregation,
        isMonetary,
        taxonomyNodeId: await resolveTaxonomyNodeId(
          tx as unknown as Database,
          input.taxonomyCode,
          target.taxonomyNodeId,
        ),
        calculationBasis:
          input.calculationBasis !== undefined
            ? input.calculationBasis
            : target.calculationBasis,
        semanticsStatus: status,
        confirmedBy: status === "CONFIRMED" ? input.actor : target.confirmedBy,
        confirmedAt: status === "CONFIRMED" ? new Date() : target.confirmedAt,
        rationale: input.reason,
        // The origin of the version is *not* rewritten: a version born of a
        // source change stays that, even after we fix a detail of it.
      })
      .where(eq(attributeSemanticsTable.id, target.id))
      .returning();

    if (changes.length > 0) {
      await tx.insert(curationEventTable).values(
        changes.map((c) => ({
          targetKind: "ATTRIBUTE_SEMANTICS",
          targetId: target.id,
          targetLabel: attribute.code,
          field: c.field,
          valueBefore: c.before,
          valueAfter: c.after,
          actor: input.actor,
          reason: input.reason,
          detail: { changeOrigin: "CURATION_CORRECTION", version: target.version },
        })),
      );
    }

    await projectCurrentVersion(tx as unknown as Database, attribute.id);
    return updated as SemanticsVersion;
  });
}
