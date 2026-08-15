CREATE TABLE IF NOT EXISTS "attribute_semantics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"unit" text,
	"periodicity" text,
	"aggregation" text,
	"is_monetary" boolean,
	"taxonomy_node_id" uuid,
	"calculation_basis" text,
	"semantics_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"rationale" text,
	"change_origin" text DEFAULT 'INITIAL' NOT NULL,
	"supersede_reason" text,
	"evidence_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change" ADD COLUMN IF NOT EXISTS "semantics_version_a" integer;--> statement-breakpoint
ALTER TABLE "change" ADD COLUMN IF NOT EXISTS "semantics_version_b" integer;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_semantics_attribute_id_attribute_id_fk'
                   AND conrelid = '"attribute_semantics"'::regclass) THEN
ALTER TABLE "attribute_semantics" ADD CONSTRAINT "attribute_semantics_attribute_id_attribute_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_semantics_taxonomy_node_id_taxonomy_node_id_fk'
                   AND conrelid = '"attribute_semantics"'::regclass) THEN
ALTER TABLE "attribute_semantics" ADD CONSTRAINT "attribute_semantics_taxonomy_node_id_taxonomy_node_id_fk" FOREIGN KEY ("taxonomy_node_id") REFERENCES "public"."taxonomy_node"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_semantics_evidence_snapshot_id_snapshot_id_fk'
                   AND conrelid = '"attribute_semantics"'::regclass) THEN
ALTER TABLE "attribute_semantics" ADD CONSTRAINT "attribute_semantics_evidence_snapshot_id_snapshot_id_fk" FOREIGN KEY ("evidence_snapshot_id") REFERENCES "public"."snapshot"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attribute_semantics_version_uq" ON "attribute_semantics" USING btree ("attribute_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attribute_semantics_current_uq" ON "attribute_semantics" USING btree ("attribute_id") WHERE "attribute_semantics"."effective_until" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribute_semantics_attribute_idx" ON "attribute_semantics" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribute_semantics_window_idx" ON "attribute_semantics" USING btree ("effective_from","effective_until");--> statement-breakpoint

-- Two versions of one attribute can never claim the same day.
-- Without this, `resolveSemantics` would have to pick between two truths.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_semantics_no_overlap'
                   AND conrelid = '"attribute_semantics"'::regclass) THEN
ALTER TABLE "attribute_semantics"
  ADD CONSTRAINT "attribute_semantics_no_overlap"
  EXCLUDE USING gist (
    attribute_id WITH =,
    daterange(effective_from, effective_until, '[)') WITH &&
  );
  END IF;
END $reentrante$;
--> statement-breakpoint

-- The same two rules that guard `attribute`, now guarding every version of it.
-- A confirmation is a human act whichever row carries it.
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_semantics_confirmed_requires_actor'
                   AND conrelid = '"attribute_semantics"'::regclass) THEN
ALTER TABLE "attribute_semantics"
  ADD CONSTRAINT "attribute_semantics_confirmed_requires_actor"
  CHECK (
    (semantics_status <> 'CONFIRMED')
    OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  );
  END IF;
END $reentrante$;
--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_semantics_confirmed_monetary_is_complete'
                   AND conrelid = '"attribute_semantics"'::regclass) THEN
ALTER TABLE "attribute_semantics"
  ADD CONSTRAINT "attribute_semantics_confirmed_monetary_is_complete"
  CHECK (
    (semantics_status <> 'CONFIRMED')
    OR (is_monetary IS NOT TRUE)
    OR (unit IS NOT NULL AND periodicity IS NOT NULL AND aggregation IS NOT NULL)
  );
  END IF;
END $reentrante$;
--> statement-breakpoint

-- A version that starts after it ends is not a version.
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_semantics_window_is_ordered'
                   AND conrelid = '"attribute_semantics"'::regclass) THEN
ALTER TABLE "attribute_semantics"
  ADD CONSTRAINT "attribute_semantics_window_is_ordered"
  CHECK (effective_until IS NULL OR effective_from < effective_until);
  END IF;
END $reentrante$;
--> statement-breakpoint
ALTER TABLE "change_set"
  ADD COLUMN IF NOT EXISTS "semantics_changes" integer DEFAULT 0 NOT NULL;
