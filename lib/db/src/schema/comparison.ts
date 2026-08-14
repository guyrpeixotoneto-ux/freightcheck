import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  bigserial,
  boolean,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { attributeTable, entityTable, factTable, snapshotTable } from "./canonical";

/**
 * COMPARISON — derived, and deliberately replaceable.
 *
 * Everything here is recomputed from the canonical layer. If the algorithm
 * improves, a change set is dropped and rebuilt; what can never be rebuilt is
 * the RAW evidence, which is why that layer is the one under a trigger.
 *
 * The categories are kept apart on purpose (see docs/ARQUITETURA.md §6):
 * a change the Ambev made and a change we made must never be presented as the
 * same kind of event.
 */

export const changeSetTable = pgTable(
  "change_set",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotAId: uuid("snapshot_a_id")
      .notNull()
      .references(() => snapshotTable.id),
    snapshotBId: uuid("snapshot_b_id")
      .notNull()
      .references(() => snapshotTable.id),
    status: text("status").notNull().default("PENDING"),

    /** Counts, by axis. */
    valueChanges: integer("value_changes").notNull().default(0),
    entitiesAdded: integer("entities_added").notNull().default(0),
    entitiesRemoved: integer("entities_removed").notNull().default(0),
    attributesAdded: integer("attributes_added").notNull().default(0),
    attributesRemoved: integer("attributes_removed").notNull().default(0),
    unchanged: integer("unchanged").notNull().default(0),
    /** Changes we could not compare with confidence. Never hidden. */
    inconclusive: integer("inconclusive").notNull().default(0),
    /** Columns whose meaning the source changed between the two vigências. */
    semanticsChanges: integer("semantics_changes").notNull().default(0),

    /**
     * Calculated impact, **broken down by periodicity** — e.g.
     * `{"MENSAL": -87808.57, "ANUAL": -735312.15}`.
     *
     * Deliberately not a single number. A monthly figure and an annual one do
     * not add up, and a scalar total would silently claim they do: this table
     * once reported "R$ -757.009,57" for a set that was really R$ -735 mil per
     * year plus R$ -88 mil per month. Annualising the two into a comparable
     * figure is F4's job, and it needs its own confirmed rules.
     *
     * Empty object while nothing is calculable, which is the honest state
     * until semantics are confirmed.
     */
    calculatedImpactByPeriodicity: jsonb("calculated_impact_by_periodicity")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    /** How many changes carry no calculable impact, and therefore sit outside the sum. */
    impactNotCalculable: integer("impact_not_calculable").notNull().default(0),

    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    computedBy: text("computed_by"),
    failureReason: text("failure_reason"),
  },
  (t) => [
    /** One live comparison per ordered pair; recomputing replaces it. */
    uniqueIndex("change_set_pair_uq").on(t.snapshotAId, t.snapshotBId),
    index("change_set_b_idx").on(t.snapshotBId),
  ],
);

export const changeTable = pgTable(
  "change",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    changeSetId: uuid("change_set_id")
      .notNull()
      .references(() => changeSetTable.id, { onDelete: "cascade" }),

    /** SOURCE_CHANGE | FLEET_CHANGE | LAYOUT_CHANGE — never CURATION_CHANGE. */
    category: text("category").notNull(),
    /** VALUE_CHANGED | ENTITY_ADDED | ENTITY_REMOVED | ATTRIBUTE_ADDED | ATTRIBUTE_REMOVED */
    changeType: text("change_type").notNull(),
    /**
     * What kind of change it is: NUMERIC | TEXT | BOOLEAN | DATE | APPEARED |
     * DISAPPEARED | ZEROING | NULL_REASON. Free text so new natures need no
     * migration.
     */
    nature: text("nature"),

    entityId: uuid("entity_id").references(() => entityTable.id),
    attributeId: uuid("attribute_id").references(() => attributeTable.id),

    /** The two sides, by fact. Facts are immutable, so these never drift. */
    factAId: bigint("fact_a_id", { mode: "number" }).references(() => factTable.id),
    factBId: bigint("fact_b_id", { mode: "number" }).references(() => factTable.id),

    /** Display values, denormalised so a listing needs no joins. */
    valueBefore: text("value_before"),
    valueAfter: text("value_after"),
    numericBefore: numeric("numeric_before", { precision: 18, scale: 6 }),
    numericAfter: numeric("numeric_after", { precision: 18, scale: 6 }),
    isNullBefore: boolean("is_null_before"),
    isNullAfter: boolean("is_null_after"),
    nullReasonBefore: text("null_reason_before"),
    nullReasonAfter: text("null_reason_after"),

    deltaAbsolute: numeric("delta_absolute", { precision: 18, scale: 6 }),
    deltaPercent: numeric("delta_percent", { precision: 12, scale: 6 }),

    /**
     * COMPARABLE — the two sides can be held against each other.
     * INCONCLUSIVE — they cannot, and the reason says why. Never silently
     * dropped, never silently treated as equal.
     */
    comparability: text("comparability").notNull(),
    inconclusiveReason: text("inconclusive_reason"),

    /** CALCULATED | ESTIMATED | NOT_CALCULABLE — see docs/ARQUITETURA.md §7. */
    impactConfidence: text("impact_confidence").notNull(),
    impactAmount: numeric("impact_amount", { precision: 18, scale: 6 }),
    /** Periodicity the impact is expressed in. Never annualised here. */
    impactPeriodicity: text("impact_periodicity"),
    impactReason: text("impact_reason"),

    /**
     * Classification as it stood when this set was computed. Snapshotted so a
     * later reclassification cannot silently rewrite a past comparison — and
     * so the difference between the two is visible if anyone looks.
     */
    costClass: text("cost_class"),
    taxonomyPath: text("taxonomy_path"),
    taxonomyName: text("taxonomy_name"),
    semanticsStatus: text("semantics_status"),

    /**
     * Which semantics version applied on each side.
     *
     * Null while an attribute has only ever had one. When they differ, the
     * comparison had to decide whether the two values were even comparable —
     * see `comparability`.
     */
    semanticsVersionA: integer("semantics_version_a"),
    semanticsVersionB: integer("semantics_version_b"),

    /** Denormalised for the listing and for filtering. */
    attributeCode: text("attribute_code"),
    attributeName: text("attribute_name"),
    entityLabel: text("entity_label"),
    entityType: text("entity_type"),
  },
  (t) => [
    index("change_set_idx").on(t.changeSetId),
    /* Os dois lados por fato: é o que uma exclusão de importação confere para
       cada fato que apaga. Sem eles, varredura por linha. */
    index("change_fact_a_idx").on(t.factAId),
    index("change_fact_b_idx").on(t.factBId),
    /** The default listing: by materiality, within a set. */
    index("change_materiality_idx").on(t.changeSetId, t.impactAmount),
    index("change_attribute_idx").on(t.changeSetId, t.attributeId),
    index("change_entity_idx").on(t.changeSetId, t.entityId),
    index("change_type_idx").on(t.changeSetId, t.changeType),
    index("change_cost_class_idx").on(t.changeSetId, t.costClass),
  ],
);
