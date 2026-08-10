CREATE TABLE "taxonomy_node" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"cost_class" text,
	"path" text NOT NULL,
	"depth" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curation_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_category" text DEFAULT 'CURATION_CHANGE' NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_label" text NOT NULL,
	"field" text NOT NULL,
	"value_before" text,
	"value_after" text,
	"actor" text NOT NULL,
	"reason" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attribute" ADD COLUMN "taxonomy_node_id" uuid;--> statement-breakpoint
ALTER TABLE "attribute" ADD COLUMN "semantics_rationale" text;--> statement-breakpoint
ALTER TABLE "attribute" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "attribute" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomy_node_path_uq" ON "taxonomy_node" USING btree ("path");--> statement-breakpoint
CREATE UNIQUE INDEX "taxonomy_node_code_uq" ON "taxonomy_node" USING btree ("code");--> statement-breakpoint
CREATE INDEX "taxonomy_node_parent_idx" ON "taxonomy_node" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "curation_event_target_idx" ON "curation_event" USING btree ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX "curation_event_created_idx" ON "curation_event" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "curation_event_label_idx" ON "curation_event" USING btree ("target_label");--> statement-breakpoint
ALTER TABLE "attribute" ADD CONSTRAINT "attribute_taxonomy_node_id_taxonomy_node_id_fk" FOREIGN KEY ("taxonomy_node_id") REFERENCES "public"."taxonomy_node"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Self-referential hierarchy: a node's parent must be a real node.
ALTER TABLE "taxonomy_node"
  ADD CONSTRAINT "taxonomy_node_parent_id_fk"
  FOREIGN KEY ("parent_id") REFERENCES "public"."taxonomy_node"("id");
--> statement-breakpoint

-- A CONFIRMED attribute is a human act, structurally.
--
-- This is the guard that keeps the import pipeline — and any future AI
-- assistance — from ever promoting semantics on its own: CONFIRMED without an
-- attributed confirmer is rejected by the database, whatever wrote the row.
-- The financial engine in F4 will only read CONFIRMED attributes, so this
-- constraint is what ultimately protects every number the product displays.
ALTER TABLE "attribute"
  ADD CONSTRAINT "attribute_confirmed_requires_actor"
  CHECK (
    (semantics_status <> 'CONFIRMED')
    OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
  );
--> statement-breakpoint

-- A monetary attribute cannot be CONFIRMED while we still cannot say what its
-- numbers mean. Without unit, periodicity and aggregation, summing it is
-- guesswork — exactly the ipvaLicenciamentoMensal trap.
ALTER TABLE "attribute"
  ADD CONSTRAINT "attribute_confirmed_monetary_is_complete"
  CHECK (
    (semantics_status <> 'CONFIRMED')
    OR (is_monetary IS NOT TRUE)
    OR (unit IS NOT NULL AND periodicity IS NOT NULL AND aggregation IS NOT NULL)
  );
