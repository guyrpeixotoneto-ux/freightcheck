DO $reentrante$
DECLARE
  faltando text;
BEGIN
  IF to_regtype('"public"."import_run_status"') IS NULL THEN
CREATE TYPE "public"."import_run_status" AS ENUM('PENDING', 'READING', 'STAGED', 'PREVIEWED', 'PROMOTING', 'PROMOTED', 'FAILED', 'ABORTED', 'SKIPPED_DUPLICATE');
  ELSE
    -- Existe. Exige-se que os valores desta migration estejam lá; um
    -- valor a mais não é conflito (a 0015 acrescenta dois a import_run_status).
    SELECT string_agg(v, ', ') INTO faltando
      FROM unnest(ARRAY['PENDING', 'READING', 'STAGED', 'PREVIEWED', 'PROMOTING', 'PROMOTED', 'FAILED', 'ABORTED', 'SKIPPED_DUPLICATE']) v
     WHERE v <> ALL (SELECT e.enumlabel::text FROM pg_enum e
                      WHERE e.enumtypid = '"public"."import_run_status"'::regtype);
    IF faltando IS NOT NULL THEN
      RAISE EXCEPTION
        E'O tipo import_run_status já existe sem os valores que esta migration declara: %.\n\nSubstituí-lo mudaria o significado de colunas que já têm dado. Confira de onde ele veio e alinhe-o. Nada foi alterado.',
        faltando USING ERRCODE = 'data_exception';
    END IF;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
DECLARE
  faltando text;
BEGIN
  IF to_regtype('"public"."issue_severity"') IS NULL THEN
CREATE TYPE "public"."issue_severity" AS ENUM('ERROR', 'WARNING', 'INFO');
  ELSE
    -- Existe. Exige-se que os valores desta migration estejam lá; um
    -- valor a mais não é conflito (a 0015 acrescenta dois a import_run_status).
    SELECT string_agg(v, ', ') INTO faltando
      FROM unnest(ARRAY['ERROR', 'WARNING', 'INFO']) v
     WHERE v <> ALL (SELECT e.enumlabel::text FROM pg_enum e
                      WHERE e.enumtypid = '"public"."issue_severity"'::regtype);
    IF faltando IS NOT NULL THEN
      RAISE EXCEPTION
        E'O tipo issue_severity já existe sem os valores que esta migration declara: %.\n\nSubstituí-lo mudaria o significado de colunas que já têm dado. Confira de onde ele veio e alinhe-o. Nada foi alterado.',
        faltando USING ERRCODE = 'data_exception';
    END IF;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
DECLARE
  faltando text;
BEGIN
  IF to_regtype('"public"."mapping_status"') IS NULL THEN
CREATE TYPE "public"."mapping_status" AS ENUM('MAPPED', 'NEW', 'AMBIGUOUS', 'IGNORED');
  ELSE
    -- Existe. Exige-se que os valores desta migration estejam lá; um
    -- valor a mais não é conflito (a 0015 acrescenta dois a import_run_status).
    SELECT string_agg(v, ', ') INTO faltando
      FROM unnest(ARRAY['MAPPED', 'NEW', 'AMBIGUOUS', 'IGNORED']) v
     WHERE v <> ALL (SELECT e.enumlabel::text FROM pg_enum e
                      WHERE e.enumtypid = '"public"."mapping_status"'::regtype);
    IF faltando IS NOT NULL THEN
      RAISE EXCEPTION
        E'O tipo mapping_status já existe sem os valores que esta migration declara: %.\n\nSubstituí-lo mudaria o significado de colunas que já têm dado. Confira de onde ele veio e alinhe-o. Nada foi alterado.',
        faltando USING ERRCODE = 'data_exception';
    END IF;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
DECLARE
  faltando text;
BEGIN
  IF to_regtype('"public"."semantics_status"') IS NULL THEN
CREATE TYPE "public"."semantics_status" AS ENUM('CONFIRMED', 'PRESUMED', 'UNKNOWN');
  ELSE
    -- Existe. Exige-se que os valores desta migration estejam lá; um
    -- valor a mais não é conflito (a 0015 acrescenta dois a import_run_status).
    SELECT string_agg(v, ', ') INTO faltando
      FROM unnest(ARRAY['CONFIRMED', 'PRESUMED', 'UNKNOWN']) v
     WHERE v <> ALL (SELECT e.enumlabel::text FROM pg_enum e
                      WHERE e.enumtypid = '"public"."semantics_status"'::regtype);
    IF faltando IS NOT NULL THEN
      RAISE EXCEPTION
        E'O tipo semantics_status já existe sem os valores que esta migration declara: %.\n\nSubstituí-lo mudaria o significado de colunas que já têm dado. Confira de onde ele veio e alinhe-o. Nada foi alterado.',
        faltando USING ERRCODE = 'data_exception';
    END IF;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
DECLARE
  faltando text;
BEGIN
  IF to_regtype('"public"."sheet_role"') IS NULL THEN
CREATE TYPE "public"."sheet_role" AS ENUM('SOURCE', 'PIVOT', 'UNKNOWN');
  ELSE
    -- Existe. Exige-se que os valores desta migration estejam lá; um
    -- valor a mais não é conflito (a 0015 acrescenta dois a import_run_status).
    SELECT string_agg(v, ', ') INTO faltando
      FROM unnest(ARRAY['SOURCE', 'PIVOT', 'UNKNOWN']) v
     WHERE v <> ALL (SELECT e.enumlabel::text FROM pg_enum e
                      WHERE e.enumtypid = '"public"."sheet_role"'::regtype);
    IF faltando IS NOT NULL THEN
      RAISE EXCEPTION
        E'O tipo sheet_role já existe sem os valores que esta migration declara: %.\n\nSubstituí-lo mudaria o significado de colunas que já têm dado. Confira de onde ele veio e alinhe-o. Nada foi alterado.',
        faltando USING ERRCODE = 'data_exception';
    END IF;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
DECLARE
  faltando text;
BEGIN
  IF to_regtype('"public"."snapshot_status"') IS NULL THEN
CREATE TYPE "public"."snapshot_status" AS ENUM('DRAFT', 'CLOSED', 'SUPERSEDED');
  ELSE
    -- Existe. Exige-se que os valores desta migration estejam lá; um
    -- valor a mais não é conflito (a 0015 acrescenta dois a import_run_status).
    SELECT string_agg(v, ', ') INTO faltando
      FROM unnest(ARRAY['DRAFT', 'CLOSED', 'SUPERSEDED']) v
     WHERE v <> ALL (SELECT e.enumlabel::text FROM pg_enum e
                      WHERE e.enumtypid = '"public"."snapshot_status"'::regtype);
    IF faltando IS NOT NULL THEN
      RAISE EXCEPTION
        E'O tipo snapshot_status já existe sem os valores que esta migration declara: %.\n\nSubstituí-lo mudaria o significado de colunas que já têm dado. Confira de onde ele veio e alinhe-o. Nada foi alterado.',
        faltando USING ERRCODE = 'data_exception';
    END IF;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
DECLARE
  faltando text;
BEGIN
  IF to_regtype('"public"."staged_fact_status"') IS NULL THEN
CREATE TYPE "public"."staged_fact_status" AS ENUM('VALID', 'WARNING', 'REJECTED');
  ELSE
    -- Existe. Exige-se que os valores desta migration estejam lá; um
    -- valor a mais não é conflito (a 0015 acrescenta dois a import_run_status).
    SELECT string_agg(v, ', ') INTO faltando
      FROM unnest(ARRAY['VALID', 'WARNING', 'REJECTED']) v
     WHERE v <> ALL (SELECT e.enumlabel::text FROM pg_enum e
                      WHERE e.enumtypid = '"public"."staged_fact_status"'::regtype);
    IF faltando IS NOT NULL THEN
      RAISE EXCEPTION
        E'O tipo staged_fact_status já existe sem os valores que esta migration declara: %.\n\nSubstituí-lo mudaria o significado de colunas que já têm dado. Confira de onde ele veio e alinhe-o. Nada foi alterado.',
        faltando USING ERRCODE = 'data_exception';
    END IF;
  END IF;
END $reentrante$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_file_id" uuid NOT NULL,
	"status" "import_run_status" DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"triggered_by" text,
	"raw_sheet_count" integer DEFAULT 0 NOT NULL,
	"raw_row_count" integer DEFAULT 0 NOT NULL,
	"raw_cell_count" integer DEFAULT 0 NOT NULL,
	"staged_fact_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"snapshot_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_cell" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"raw_row_id" bigint NOT NULL,
	"column_index" integer NOT NULL,
	"column_letter" text NOT NULL,
	"column_header" text,
	"raw_value" text,
	"source_type" text NOT NULL,
	"formatted_text" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_row" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"raw_sheet_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"is_header" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_sheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" uuid NOT NULL,
	"sheet_name" text NOT NULL,
	"sheet_index" integer NOT NULL,
	"row_count" integer NOT NULL,
	"column_count" integer NOT NULL,
	"role" "sheet_role" NOT NULL,
	"role_reason" text NOT NULL,
	"header_row_index" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"mime_type" text,
	"storage_path" text NOT NULL,
	"source_system" text DEFAULT 'FREIGHTEC' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attribute_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"source_name" text NOT NULL,
	"source_sheet" text NOT NULL,
	"match_confidence" numeric(5, 4),
	"first_seen_import_run_id" uuid,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attribute" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"source_name" text NOT NULL,
	"display_name" text,
	"entity_type" text NOT NULL,
	"data_type" text NOT NULL,
	"unit" text,
	"periodicity" text,
	"aggregation" text,
	"semantics_status" "semantics_status" DEFAULT 'UNKNOWN' NOT NULL,
	"is_monetary" boolean,
	"first_seen_import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_identifier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"identifier_type" text NOT NULL,
	"identifier_value" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"is_current" boolean DEFAULT true NOT NULL,
	"source_import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"first_seen_import_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fact" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value_numeric" numeric(18, 6),
	"value_text" text,
	"value_boolean" boolean,
	"value_date" date,
	"value_hash" text NOT NULL,
	"is_null" boolean DEFAULT false NOT NULL,
	"null_reason" text,
	"raw_cell_id" bigint NOT NULL,
	CONSTRAINT "fact_exactly_one_value" CHECK ((
        (CASE WHEN "fact"."value_numeric" IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN "fact"."value_text"    IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN "fact"."value_boolean" IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN "fact"."value_date"    IS NOT NULL THEN 1 ELSE 0 END)
        = CASE WHEN "fact"."is_null" THEN 0 ELSE 1 END
      )),
	CONSTRAINT "fact_null_reason_requires_null" CHECK (("fact"."is_null" = true AND "fact"."null_reason" IS NOT NULL)
          OR ("fact"."is_null" = false AND "fact"."null_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scope" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshot_attribute" (
	"snapshot_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"source_sheet" text NOT NULL,
	"column_index" integer NOT NULL,
	"present_in_layout" boolean DEFAULT true NOT NULL,
	"value_count" integer DEFAULT 0 NOT NULL,
	"null_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshot_scope" (
	"snapshot_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_file_id" uuid NOT NULL,
	"import_run_id" uuid NOT NULL,
	"source_system" text DEFAULT 'FREIGHTEC' NOT NULL,
	"source_label" text NOT NULL,
	"effective_date" date NOT NULL,
	"scope_hash" text NOT NULL,
	"entity_type_set" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"supersedes_snapshot_id" uuid,
	"status" "snapshot_status" DEFAULT 'DRAFT' NOT NULL,
	"closed_at" timestamp with time zone,
	"entity_count" integer DEFAULT 0 NOT NULL,
	"fact_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "column_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" uuid NOT NULL,
	"raw_sheet_id" uuid NOT NULL,
	"column_index" integer NOT NULL,
	"column_header" text NOT NULL,
	"target_attribute_id" uuid,
	"status" "mapping_status" NOT NULL,
	"resolved_data_type" text,
	"confidence" numeric(5, 4),
	"note" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sentinel_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attribute_code" text,
	"raw_value" text NOT NULL,
	"null_reason" text NOT NULL,
	"note" text,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staged_fact" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_run_id" uuid NOT NULL,
	"raw_cell_id" bigint NOT NULL,
	"snapshot_label" text NOT NULL,
	"entity_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"attribute_code" text NOT NULL,
	"value_numeric" numeric(18, 6),
	"value_text" text,
	"value_boolean" boolean,
	"value_date" date,
	"value_hash" text NOT NULL,
	"is_null" boolean DEFAULT false NOT NULL,
	"null_reason" text,
	"status" "staged_fact_status" DEFAULT 'VALID' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "validation_issue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"import_run_id" uuid NOT NULL,
	"raw_sheet_id" uuid,
	"raw_row_id" bigint,
	"raw_cell_id" bigint,
	"severity" "issue_severity" NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'import_run_source_file_id_source_file_id_fk'
                   AND conrelid = '"import_run"'::regclass) THEN
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_source_file_id_source_file_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_file"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'raw_cell_raw_row_id_raw_row_id_fk'
                   AND conrelid = '"raw_cell"'::regclass) THEN
ALTER TABLE "raw_cell" ADD CONSTRAINT "raw_cell_raw_row_id_raw_row_id_fk" FOREIGN KEY ("raw_row_id") REFERENCES "public"."raw_row"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'raw_row_raw_sheet_id_raw_sheet_id_fk'
                   AND conrelid = '"raw_row"'::regclass) THEN
ALTER TABLE "raw_row" ADD CONSTRAINT "raw_row_raw_sheet_id_raw_sheet_id_fk" FOREIGN KEY ("raw_sheet_id") REFERENCES "public"."raw_sheet"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'raw_sheet_import_run_id_import_run_id_fk'
                   AND conrelid = '"raw_sheet"'::regclass) THEN
ALTER TABLE "raw_sheet" ADD CONSTRAINT "raw_sheet_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_alias_attribute_id_attribute_id_fk'
                   AND conrelid = '"attribute_alias"'::regclass) THEN
ALTER TABLE "attribute_alias" ADD CONSTRAINT "attribute_alias_attribute_id_attribute_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_alias_first_seen_import_run_id_import_run_id_fk'
                   AND conrelid = '"attribute_alias"'::regclass) THEN
ALTER TABLE "attribute_alias" ADD CONSTRAINT "attribute_alias_first_seen_import_run_id_import_run_id_fk" FOREIGN KEY ("first_seen_import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'attribute_first_seen_import_run_id_import_run_id_fk'
                   AND conrelid = '"attribute"'::regclass) THEN
ALTER TABLE "attribute" ADD CONSTRAINT "attribute_first_seen_import_run_id_import_run_id_fk" FOREIGN KEY ("first_seen_import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'entity_identifier_entity_id_entity_id_fk'
                   AND conrelid = '"entity_identifier"'::regclass) THEN
ALTER TABLE "entity_identifier" ADD CONSTRAINT "entity_identifier_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'entity_identifier_source_import_run_id_import_run_id_fk'
                   AND conrelid = '"entity_identifier"'::regclass) THEN
ALTER TABLE "entity_identifier" ADD CONSTRAINT "entity_identifier_source_import_run_id_import_run_id_fk" FOREIGN KEY ("source_import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'entity_first_seen_import_run_id_import_run_id_fk'
                   AND conrelid = '"entity"'::regclass) THEN
ALTER TABLE "entity" ADD CONSTRAINT "entity_first_seen_import_run_id_import_run_id_fk" FOREIGN KEY ("first_seen_import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fact_snapshot_id_snapshot_id_fk'
                   AND conrelid = '"fact"'::regclass) THEN
ALTER TABLE "fact" ADD CONSTRAINT "fact_snapshot_id_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshot"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fact_entity_id_entity_id_fk'
                   AND conrelid = '"fact"'::regclass) THEN
ALTER TABLE "fact" ADD CONSTRAINT "fact_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fact_attribute_id_attribute_id_fk'
                   AND conrelid = '"fact"'::regclass) THEN
ALTER TABLE "fact" ADD CONSTRAINT "fact_attribute_id_attribute_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'fact_raw_cell_id_raw_cell_id_fk'
                   AND conrelid = '"fact"'::regclass) THEN
ALTER TABLE "fact" ADD CONSTRAINT "fact_raw_cell_id_raw_cell_id_fk" FOREIGN KEY ("raw_cell_id") REFERENCES "public"."raw_cell"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'snapshot_attribute_snapshot_id_snapshot_id_fk'
                   AND conrelid = '"snapshot_attribute"'::regclass) THEN
ALTER TABLE "snapshot_attribute" ADD CONSTRAINT "snapshot_attribute_snapshot_id_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshot"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'snapshot_attribute_attribute_id_attribute_id_fk'
                   AND conrelid = '"snapshot_attribute"'::regclass) THEN
ALTER TABLE "snapshot_attribute" ADD CONSTRAINT "snapshot_attribute_attribute_id_attribute_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attribute"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'snapshot_scope_snapshot_id_snapshot_id_fk'
                   AND conrelid = '"snapshot_scope"'::regclass) THEN
ALTER TABLE "snapshot_scope" ADD CONSTRAINT "snapshot_scope_snapshot_id_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshot"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'snapshot_scope_scope_id_scope_id_fk'
                   AND conrelid = '"snapshot_scope"'::regclass) THEN
ALTER TABLE "snapshot_scope" ADD CONSTRAINT "snapshot_scope_scope_id_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scope"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'snapshot_source_file_id_source_file_id_fk'
                   AND conrelid = '"snapshot"'::regclass) THEN
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_source_file_id_source_file_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_file"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'snapshot_import_run_id_import_run_id_fk'
                   AND conrelid = '"snapshot"'::regclass) THEN
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'column_mapping_import_run_id_import_run_id_fk'
                   AND conrelid = '"column_mapping"'::regclass) THEN
ALTER TABLE "column_mapping" ADD CONSTRAINT "column_mapping_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'column_mapping_raw_sheet_id_raw_sheet_id_fk'
                   AND conrelid = '"column_mapping"'::regclass) THEN
ALTER TABLE "column_mapping" ADD CONSTRAINT "column_mapping_raw_sheet_id_raw_sheet_id_fk" FOREIGN KEY ("raw_sheet_id") REFERENCES "public"."raw_sheet"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'column_mapping_target_attribute_id_attribute_id_fk'
                   AND conrelid = '"column_mapping"'::regclass) THEN
ALTER TABLE "column_mapping" ADD CONSTRAINT "column_mapping_target_attribute_id_attribute_id_fk" FOREIGN KEY ("target_attribute_id") REFERENCES "public"."attribute"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'staged_fact_import_run_id_import_run_id_fk'
                   AND conrelid = '"staged_fact"'::regclass) THEN
ALTER TABLE "staged_fact" ADD CONSTRAINT "staged_fact_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'staged_fact_raw_cell_id_raw_cell_id_fk'
                   AND conrelid = '"staged_fact"'::regclass) THEN
ALTER TABLE "staged_fact" ADD CONSTRAINT "staged_fact_raw_cell_id_raw_cell_id_fk" FOREIGN KEY ("raw_cell_id") REFERENCES "public"."raw_cell"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'validation_issue_import_run_id_import_run_id_fk'
                   AND conrelid = '"validation_issue"'::regclass) THEN
ALTER TABLE "validation_issue" ADD CONSTRAINT "validation_issue_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'validation_issue_raw_sheet_id_raw_sheet_id_fk'
                   AND conrelid = '"validation_issue"'::regclass) THEN
ALTER TABLE "validation_issue" ADD CONSTRAINT "validation_issue_raw_sheet_id_raw_sheet_id_fk" FOREIGN KEY ("raw_sheet_id") REFERENCES "public"."raw_sheet"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'validation_issue_raw_row_id_raw_row_id_fk'
                   AND conrelid = '"validation_issue"'::regclass) THEN
ALTER TABLE "validation_issue" ADD CONSTRAINT "validation_issue_raw_row_id_raw_row_id_fk" FOREIGN KEY ("raw_row_id") REFERENCES "public"."raw_row"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'validation_issue_raw_cell_id_raw_cell_id_fk'
                   AND conrelid = '"validation_issue"'::regclass) THEN
ALTER TABLE "validation_issue" ADD CONSTRAINT "validation_issue_raw_cell_id_raw_cell_id_fk" FOREIGN KEY ("raw_cell_id") REFERENCES "public"."raw_cell"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_run_source_file_idx" ON "import_run" USING btree ("source_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_cell_row_column_uq" ON "raw_cell" USING btree ("raw_row_id","column_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_cell_row_idx" ON "raw_cell" USING btree ("raw_row_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_row_sheet_index_uq" ON "raw_row" USING btree ("raw_sheet_id","row_index");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_sheet_run_index_uq" ON "raw_sheet" USING btree ("import_run_id","sheet_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_sheet_run_idx" ON "raw_sheet" USING btree ("import_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "source_file_sha256_uq" ON "source_file" USING btree ("content_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attribute_alias_source_uq" ON "attribute_alias" USING btree ("source_name","source_sheet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribute_alias_attribute_idx" ON "attribute_alias" USING btree ("attribute_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attribute_code_uq" ON "attribute" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribute_entity_type_idx" ON "attribute" USING btree ("entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_identifier_current_uq" ON "entity_identifier" USING btree ("identifier_type","identifier_value") WHERE "entity_identifier"."is_current";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_identifier_lookup_idx" ON "entity_identifier" USING btree ("identifier_type","identifier_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_identifier_entity_idx" ON "entity_identifier" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_type_idx" ON "entity" USING btree ("entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fact_grain_uq" ON "fact" USING btree ("snapshot_id","entity_id","attribute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fact_snapshot_attribute_idx" ON "fact" USING btree ("snapshot_id","attribute_id","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fact_snapshot_entity_idx" ON "fact" USING btree ("snapshot_id","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fact_entity_attribute_idx" ON "fact" USING btree ("entity_id","attribute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fact_raw_cell_idx" ON "fact" USING btree ("raw_cell_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scope_type_code_uq" ON "scope" USING btree ("scope_type","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_attribute_uq" ON "snapshot_attribute" USING btree ("snapshot_id","attribute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_attribute_snapshot_idx" ON "snapshot_attribute" USING btree ("snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_scope_uq" ON "snapshot_scope" USING btree ("snapshot_id","scope_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_scope_snapshot_idx" ON "snapshot_scope" USING btree ("snapshot_id");--> statement-breakpoint
-- Os dois índices da chave de negócio antiga, criados **só se a coluna que eles
-- indexam ainda existir**.
--
-- A `0016` derruba os dois e a `0022` derruba a `scope_hash`. A fila é
-- reentrante por projeto — é o que destrava um banco cujo registro se perdeu, e
-- é o que `registro-perdido.test.ts` prova —, então esta migration precisa
-- atravessar um banco que já foi até o fim. Com a coluna fora, o
-- `IF NOT EXISTS` não basta: ele confere o **índice**, que de fato não existe
-- mais, e a criação então falha em `42703` na coluna, levando a fila junto.
--
-- Conferir a coluna é o mesmo princípio que o resto do arquivo aplica — cada
-- migration confere antes de criar —, um nível mais fundo. Num banco novo os
-- dois índices nascem normalmente e a `0016` os derruba na sequência.
DO $reentrante$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name   = 'snapshot'
                AND column_name  = 'scope_hash') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_business_key_uq" ON "snapshot" USING btree ("source_system","source_label","scope_hash","entity_type_set","revision");
    CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_business_key_live_uq" ON "snapshot" USING btree ("source_system","source_label","scope_hash","entity_type_set") WHERE "snapshot"."status" <> 'SUPERSEDED';
  END IF;
END $reentrante$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_effective_date_idx" ON "snapshot" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_import_run_idx" ON "snapshot" USING btree ("import_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "column_mapping_sheet_column_uq" ON "column_mapping" USING btree ("raw_sheet_id","column_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "column_mapping_run_idx" ON "column_mapping" USING btree ("import_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sentinel_rule_scope_uq" ON "sentinel_rule" USING btree ("attribute_code","raw_value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sentinel_rule_value_idx" ON "sentinel_rule" USING btree ("raw_value");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staged_fact_grain_uq" ON "staged_fact" USING btree ("import_run_id","snapshot_label","entity_type","entity_key","attribute_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staged_fact_run_idx" ON "staged_fact" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staged_fact_run_label_idx" ON "staged_fact" USING btree ("import_run_id","snapshot_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_issue_run_idx" ON "validation_issue" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "validation_issue_run_code_idx" ON "validation_issue" USING btree ("import_run_id","code");