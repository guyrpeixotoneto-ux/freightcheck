import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { attributeTable, snapshotTable, taxonomyNodeTable } from "./canonical";

/**
 * Semantics with a history.
 *
 * `attribute.unit`, `.periodicity` and friends answer "what does this column
 * mean *now*". That was enough while meaning was assumed constant, and it is
 * not: the Ambev changed how `ipvaLicenciamento` was calculated twice inside
 * nine vigências — from a per-vehicle figure to a flat 1,000% of the invoice
 * value, then to something else again — without changing unit or periodicity.
 * With one row per attribute there is nowhere to put that.
 *
 * A version is a meaning that held over a stretch of the *source's* timeline.
 * `attribute` keeps the current one as a projection, so everything written
 * against it goes on working.
 *
 * Three decisions, taken as recommended in docs/PROPOSTA-SEMANTICA-VERSIONADA.md:
 *
 * 1. `calculation_basis` exists, because the IPVA case is unrepresentable
 *    without it and it already cost a R$ 720 mil misreading.
 * 2. Validity is by date, matching `snapshot.effective_date`, so a version and
 *    a vigência line up without a join.
 * 3. A curation correction rewrites the version it applies to, for its whole
 *    stretch. Correcting "from a date onward" is not a correction — it is the
 *    source having changed, and gets a new version.
 */
export const attributeSemanticsTable = pgTable(
  "attribute_semantics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributeTable.id),
    version: integer("version").notNull(),

    /** Inclusive. Aligns with `snapshot.effective_date`. */
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    /** Exclusive. Null means this is the version in force. */
    effectiveUntil: date("effective_until", { mode: "string" }),

    unit: text("unit"),
    periodicity: text("periodicity"),
    aggregation: text("aggregation"),
    isMonetary: boolean("is_monetary"),
    taxonomyNodeId: uuid("taxonomy_node_id").references(() => taxonomyNodeTable.id),

    /**
     * How the source produces the number, when that is known and can change
     * independently of unit and periodicity.
     *
     * The case that forced this column: `cavalo.ipvaLicenciamento` was a real
     * per-vehicle IPVA in Dez/2025, exactly 1,000% of the invoice value from
     * Jan to Jun/2026, and a third rule from Jul/2026 — always BRL, always
     * annual, always summable. Free text: the vocabulary of calculation rules
     * is the Ambev's, not ours.
     */
    calculationBasis: text("calculation_basis"),

    /**
     * What the column meant over this stretch. Versioned for the same reason
     * `calculation_basis` is: when the Ambev changes what a column holds, the
     * old definition was true for its own vigências and must survive to be
     * read next to the numbers it described.
     */
    definition: text("definition"),

    /**
     * The economic reading of this stretch — see `attribute.economic_*`.
     *
     * Versioned for the same reason `definition` is: when the source changes
     * what a column carries, the previous reading stays true for its own
     * vigências. A direction kept only on the projection would let August's
     * curation silently rewrite December's interpretation.
     */
    economicDirection: text("economic_direction"),
    economicEffect: text("economic_effect"),

    semanticsStatus: text("semantics_status").notNull().default("UNKNOWN"),
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    rationale: text("rationale"),

    /**
     * INITIAL — backfilled, or the first meaning we ever recorded.
     * SOURCE_SEMANTICS_CHANGE — the Ambev changed the meaning from a date on.
     *   This is news, and surfaces as a SEMANTICS_CHANGE in Alterações.
     * CURATION_CORRECTION — we were wrong; the meaning never changed. Amends
     *   the version in place and is never reported as a source change.
     */
    changeOrigin: text("change_origin").notNull().default("INITIAL"),
    supersedeReason: text("supersede_reason"),
    /** The vigência whose data evidenced the change, when there is one. */
    evidenceSnapshotId: uuid("evidence_snapshot_id").references(() => snapshotTable.id),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("attribute_semantics_version_uq").on(t.attributeId, t.version),
    /** At most one version in force per attribute. */
    uniqueIndex("attribute_semantics_current_uq")
      .on(t.attributeId)
      .where(sql`${t.effectiveUntil} IS NULL`),
    index("attribute_semantics_attribute_idx").on(t.attributeId),
    /* A vigência que serviu de evidência pode ser excluída; o ponteiro é
       procurado por ela. */
    index("attribute_semantics_evidence_idx").on(t.evidenceSnapshotId),
    index("attribute_semantics_window_idx").on(t.effectiveFrom, t.effectiveUntil),
  ],
);
