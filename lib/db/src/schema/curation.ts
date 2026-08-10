import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * CURATION — what *we* change, kept strictly apart from what the Ambev changes.
 *
 * Every edit to taxonomy, semantics, unit, aggregation or an alias binding is
 * recorded here as a CURATION_CHANGE. Nothing in this file ever touches a
 * `fact`, which is what guarantees a reclassification can never surface as if
 * the Ambev had altered the remuneration.
 *
 * This table is also the taxonomy's history: reclassifying an attribute writes
 * the before and after here rather than duplicating hierarchy nodes.
 */
export const curationEventTable = pgTable(
  "curation_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Always CURATION_CHANGE for now. The column exists because F3 will write
     * SOURCE_CHANGE and FLEET_CHANGE into its own tables, and every consumer
     * must be able to tell the three apart without inferring it from the table
     * it happened to read.
     */
    changeCategory: text("change_category").notNull().default("CURATION_CHANGE"),
    /** ATTRIBUTE | TAXONOMY_NODE | ATTRIBUTE_ALIAS | SENTINEL_RULE */
    targetKind: text("target_kind").notNull(),
    targetId: uuid("target_id").notNull(),
    /** Human-readable handle, e.g. "cavalo.ipva_licenciamento". */
    targetLabel: text("target_label").notNull(),
    /** Which field changed, e.g. "unit", "semantics_status". */
    field: text("field").notNull(),
    valueBefore: text("value_before"),
    valueAfter: text("value_after"),
    /** Who made the change. Never null — an unattributed edit is not auditable. */
    actor: text("actor").notNull(),
    /** Why. Required for confirmations; the evidence a reviewer will want. */
    reason: text("reason"),
    detail: jsonb("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("curation_event_target_idx").on(t.targetKind, t.targetId),
    index("curation_event_created_idx").on(t.createdAt),
    index("curation_event_label_idx").on(t.targetLabel),
  ],
);
