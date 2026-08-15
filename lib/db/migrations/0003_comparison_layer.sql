CREATE TABLE IF NOT EXISTS "change_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_a_id" uuid NOT NULL,
	"snapshot_b_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"value_changes" integer DEFAULT 0 NOT NULL,
	"entities_added" integer DEFAULT 0 NOT NULL,
	"entities_removed" integer DEFAULT 0 NOT NULL,
	"attributes_added" integer DEFAULT 0 NOT NULL,
	"attributes_removed" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"inconclusive" integer DEFAULT 0 NOT NULL,
	"calculated_impact" numeric(18, 6),
	"impact_not_calculable" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"computed_by" text,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"change_set_id" uuid NOT NULL,
	"category" text NOT NULL,
	"change_type" text NOT NULL,
	"nature" text,
	"entity_id" uuid,
	"attribute_id" uuid,
	"fact_a_id" bigint,
	"fact_b_id" bigint,
	"value_before" text,
	"value_after" text,
	"numeric_before" numeric(18, 6),
	"numeric_after" numeric(18, 6),
	"is_null_before" boolean,
	"is_null_after" boolean,
	"null_reason_before" text,
	"null_reason_after" text,
	"delta_absolute" numeric(18, 6),
	"delta_percent" numeric(12, 6),
	"comparability" text NOT NULL,
	"inconclusive_reason" text,
	"impact_confidence" text NOT NULL,
	"impact_amount" numeric(18, 6),
	"impact_periodicity" text,
	"impact_reason" text,
	"cost_class" text,
	"taxonomy_path" text,
	"taxonomy_name" text,
	"semantics_status" text,
	"attribute_code" text,
	"attribute_name" text,
	"entity_label" text,
	"entity_type" text
);
--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'change_set_snapshot_a_id_snapshot_id_fk'
                   AND conrelid = '"change_set"'::regclass) THEN
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_snapshot_a_id_snapshot_id_fk" FOREIGN KEY ("snapshot_a_id") REFERENCES "public"."snapshot"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'change_set_snapshot_b_id_snapshot_id_fk'
                   AND conrelid = '"change_set"'::regclass) THEN
ALTER TABLE "change_set" ADD CONSTRAINT "change_set_snapshot_b_id_snapshot_id_fk" FOREIGN KEY ("snapshot_b_id") REFERENCES "public"."snapshot"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'change_change_set_id_change_set_id_fk'
                   AND conrelid = '"change"'::regclass) THEN
ALTER TABLE "change" ADD CONSTRAINT "change_change_set_id_change_set_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_set"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'change_entity_id_entity_id_fk'
                   AND conrelid = '"change"'::regclass) THEN
ALTER TABLE "change" ADD CONSTRAINT "change_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'change_attribute_id_attribute_id_fk'
                   AND conrelid = '"change"'::regclass) THEN
ALTER TABLE "change" ADD CONSTRAINT "change_attribute_id_attribute_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'change_fact_a_id_fact_id_fk'
                   AND conrelid = '"change"'::regclass) THEN
ALTER TABLE "change" ADD CONSTRAINT "change_fact_a_id_fact_id_fk" FOREIGN KEY ("fact_a_id") REFERENCES "public"."fact"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'change_fact_b_id_fact_id_fk'
                   AND conrelid = '"change"'::regclass) THEN
ALTER TABLE "change" ADD CONSTRAINT "change_fact_b_id_fact_id_fk" FOREIGN KEY ("fact_b_id") REFERENCES "public"."fact"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "change_set_pair_uq" ON "change_set" USING btree ("snapshot_a_id","snapshot_b_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_set_b_idx" ON "change_set" USING btree ("snapshot_b_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_set_idx" ON "change" USING btree ("change_set_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_materiality_idx" ON "change" USING btree ("change_set_id","impact_amount");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_attribute_idx" ON "change" USING btree ("change_set_id","attribute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_entity_idx" ON "change" USING btree ("change_set_id","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_type_idx" ON "change" USING btree ("change_set_id","change_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_cost_class_idx" ON "change" USING btree ("change_set_id","cost_class");--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'taxonomy_node_parent_id_taxonomy_node_id_fk'
                   AND conrelid = '"taxonomy_node"'::regclass) THEN
ALTER TABLE "taxonomy_node" ADD CONSTRAINT "taxonomy_node_parent_id_taxonomy_node_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."taxonomy_node"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;