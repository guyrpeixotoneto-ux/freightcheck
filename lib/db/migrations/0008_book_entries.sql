DO $reentrante$
DECLARE
  faltando text;
BEGIN
  IF to_regtype('"public"."book_entry_kind"') IS NULL THEN
CREATE TYPE "public"."book_entry_kind" AS ENUM('DOCUMENTO', 'TEXTO');
  ELSE
    -- Existe. Exige-se que os valores desta migration estejam lá; um
    -- valor a mais não é conflito (a 0015 acrescenta dois a import_run_status).
    SELECT string_agg(v, ', ') INTO faltando
      FROM unnest(ARRAY['DOCUMENTO', 'TEXTO']) v
     WHERE v <> ALL (SELECT e.enumlabel::text FROM pg_enum e
                      WHERE e.enumtypid = '"public"."book_entry_kind"'::regtype);
    IF faltando IS NOT NULL THEN
      RAISE EXCEPTION
        E'O tipo book_entry_kind já existe sem os valores que esta migration declara: %.\n\nSubstituí-lo mudaria o significado de colunas que já têm dado. Confira de onde ele veio e alinhe-o. Nada foi alterado.',
        faltando USING ERRCODE = 'data_exception';
    END IF;
  END IF;
END $reentrante$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "book_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_key" text NOT NULL,
	"block_category" text NOT NULL,
	"block_title" text NOT NULL,
	"kind" "book_entry_kind" NOT NULL,
	"revision" integer NOT NULL,
	"filename" text,
	"content" "bytea",
	"body_text" text,
	"mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"content_sha256" text NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "book_entry_block_revision_uq" ON "book_entry" USING btree ("block_key","revision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_entry_block_idx" ON "book_entry" USING btree ("block_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_entry_created_idx" ON "book_entry" USING btree ("created_at");--> statement-breakpoint
/*
 * Qual coluna vale em qual tipo, garantido pelo banco.
 *
 * `filename`, `content` e `body_text` são anuláveis porque nenhum dos dois
 * tipos usa as do outro. Sem estes CHECKs, um INSERT com `kind = 'TEXTO'` e
 * `content` preenchido entraria — e a tela mostraria um botão de download que
 * baixa o que ninguém anexou, ou um texto vazio onde havia um contrato. É a
 * mesma escolha de `0001_immutability_guards`: a invariante mora no banco, não
 * na boa vontade de quem escreve o INSERT.
 */
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'book_entry_documento_ck'
                   AND conrelid = '"book_entry"'::regclass) THEN
ALTER TABLE "book_entry" ADD CONSTRAINT "book_entry_documento_ck" CHECK (
	"kind" <> 'DOCUMENTO' OR ("filename" IS NOT NULL AND "content" IS NOT NULL AND "body_text" IS NULL)
);
  END IF;
END $reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'book_entry_texto_ck'
                   AND conrelid = '"book_entry"'::regclass) THEN
ALTER TABLE "book_entry" ADD CONSTRAINT "book_entry_texto_ck" CHECK (
	"kind" <> 'TEXTO' OR ("body_text" IS NOT NULL AND "filename" IS NULL AND "content" IS NULL)
);
  END IF;
END $reentrante$;--> statement-breakpoint
/*
 * Revisão começa em 1 e sobe. Um zero ou um negativo aqui inverteria a ordem
 * do histórico sem que nada mais reclamasse.
 */
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'book_entry_revision_ck'
                   AND conrelid = '"book_entry"'::regclass) THEN
ALTER TABLE "book_entry" ADD CONSTRAINT "book_entry_revision_ck" CHECK ("revision" >= 1);
  END IF;
END $reentrante$;
