import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

/**
 * Resolving an attribute's cost class.
 *
 * The audit found the one structural gap in the model: `cost_class` is
 * declared on the CLASS nodes (`custo_fixo`, `custo_variavel`) and inherited by
 * everything below, but every attribute is assigned to a GROUP node. A plain
 * `attribute -> taxonomy_node` join therefore returns NULL for all 138
 * attributes, and question 6 ("custo fixo, variável ou outro?") cannot be
 * answered from it.
 *
 * No migration is needed to close it: `taxonomy_node.path` is already
 * materialised, so the nearest ancestor that declares a class is the longest
 * path that is a prefix of mine. That is a single lateral join, no recursion.
 */

/**
 * The inheritance itself, as a joinable fragment.
 *
 * Three queries need it now — the two below and the panorama's — and the rule
 * they share is not a formatting detail: "the nearest ancestor that declares a
 * class" is the whole answer to *is this fixed or variable*, and a second copy
 * of it would be a second answer waiting to drift from this one.
 *
 * The contract is one identifier: the outer query must expose the attribute's
 * own taxonomy node as `node`. The join adds `inherited.cost_class`.
 */
export const INHERITED_COST_CLASS_JOIN = sql`
      LEFT JOIN LATERAL (
        SELECT ancestor.cost_class
          FROM taxonomy_node ancestor
         WHERE node.path IS NOT NULL
           AND ancestor.cost_class IS NOT NULL
           AND (node.path = ancestor.path OR node.path LIKE ancestor.path || '/%')
         ORDER BY length(ancestor.path) DESC
         LIMIT 1
      ) AS inherited ON true`;

export interface AttributeClassification {
  /** Which semantics version this describes. Null before any versioning. */
  semanticsVersion?: number | null;
  calculationBasis?: string | null;
  attributeId: string;
  attributeCode: string;
  attributeName: string;
  entityType: string;
  dataType: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  /** FIXO | VARIAVEL | null — resolved through inheritance. */
  costClass: string | null;
  taxonomyPath: string | null;
  taxonomyName: string | null;
}

/**
 * Classifications as they stood on a given date, resolved from
 * `attribute_semantics`.
 *
 * The date is the vigência's, not today's: comparing Dez/2025 against Jan/2026
 * must use what those columns meant then, even if the meaning has since
 * changed. Falls back to the attribute's current projection for anything with
 * no version covering that date, so a database that never ran the backfill
 * behaves exactly as before.
 */
export async function loadAttributeClassificationsAt(
  db: Database,
  date: string,
): Promise<Map<string, AttributeClassification>> {
  const current = await loadAttributeClassifications(db);

  const { rows } = await db.execute<{
    attribute_id: string;
    version: number;
    unit: string | null;
    periodicity: string | null;
    aggregation: string | null;
    is_monetary: boolean | null;
    calculation_basis: string | null;
    semantics_status: string;
    cost_class: string | null;
    path: string | null;
    name: string | null;
  }>(sql`
    SELECT v.attribute_id,
           v.version,
           v.unit,
           v.periodicity,
           v.aggregation,
           v.is_monetary,
           v.calculation_basis,
           v.semantics_status,
           inherited.cost_class,
           node.path,
           node.name
      FROM attribute_semantics v
      LEFT JOIN taxonomy_node node ON node.id = v.taxonomy_node_id
      ${INHERITED_COST_CLASS_JOIN}
     WHERE v.effective_from <= ${date}::date
       AND (v.effective_until IS NULL OR ${date}::date < v.effective_until)
  `);

  const resolved = new Map(current);
  for (const row of rows) {
    const base = current.get(row.attribute_id);
    if (!base) continue;
    resolved.set(row.attribute_id, {
      ...base,
      semanticsVersion: row.version,
      unit: row.unit,
      periodicity: row.periodicity,
      aggregation: row.aggregation,
      isMonetary: row.is_monetary,
      calculationBasis: row.calculation_basis,
      semanticsStatus: row.semantics_status,
      costClass: row.cost_class,
      taxonomyPath: row.path,
      taxonomyName: row.name,
    });
  }
  return resolved;
}

export async function loadAttributeClassifications(
  db: Database,
): Promise<Map<string, AttributeClassification>> {
  const { rows } = await db.execute<{
    id: string;
    code: string;
    display_name: string | null;
    source_name: string;
    entity_type: string;
    data_type: string;
    unit: string | null;
    periodicity: string | null;
    aggregation: string | null;
    is_monetary: boolean | null;
    semantics_status: string;
    cost_class: string | null;
    path: string | null;
    name: string | null;
  }>(sql`
    SELECT a.id,
           a.code,
           a.display_name,
           a.source_name,
           a.entity_type,
           a.data_type,
           a.unit,
           a.periodicity,
           a.aggregation,
           a.is_monetary,
           a.semantics_status::text AS semantics_status,
           inherited.cost_class,
           node.path,
           node.name
      FROM attribute a
      LEFT JOIN taxonomy_node node ON node.id = a.taxonomy_node_id
      ${INHERITED_COST_CLASS_JOIN}
  `);

  const map = new Map<string, AttributeClassification>();
  for (const row of rows) {
    map.set(row.id, {
      attributeId: row.id,
      attributeCode: row.code,
      attributeName: row.display_name ?? row.source_name,
      entityType: row.entity_type,
      dataType: row.data_type,
      unit: row.unit,
      periodicity: row.periodicity,
      aggregation: row.aggregation,
      isMonetary: row.is_monetary,
      semanticsStatus: row.semantics_status,
      costClass: row.cost_class,
      taxonomyPath: row.path,
      taxonomyName: row.name,
    });
  }
  return map;
}
