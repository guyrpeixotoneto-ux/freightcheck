-- Chamados — o segundo caminho pelo qual a remuneração muda.
--
-- Até aqui este banco só sabia de uma coisa: o estado do cadastro num dia, na
-- planilha de vigência, e a diferença entre duas delas. Isso responde "o que a
-- Ambev mexeu", e não responde "o que nós pedimos e o que voltou". A segunda
-- pergunta vive nos chamados do Freightech, e é dela que estas duas tabelas
-- tratam.
--
-- **Por que não reaproveitam `import_run` e `change`.** `import_run` é a
-- máquina de estados da planilha, com as triggers de imutabilidade da `0001`
-- amarradas nela; um chamado não gera RAW, não gera fato e não gera vigência,
-- então a metade daqueles estados seria degrau que ninguém sobe. E `change` é,
-- por definição, uma diferença apurada entre duas vigências fechadas, com as
-- duas pontas rastreáveis até a célula. Um chamado tem um pedido e uma
-- resposta, ambos declarados pela própria fonte, sem contraprova. Se as duas
-- coisas dividissem tabela, a soma de impacto da tela deixaria de fechar com a
-- comparação — que é a propriedade que este produto existe para preservar.
--
-- Nenhuma trigger de imutabilidade aqui, e isso é escolha e não esquecimento:
-- um export de chamados não é evidência de remuneração paga, é o registro de
-- um atendimento. Reimportar um export corrigido tem de ser possível sem
-- ritual. O que se mantém é a regra de nunca descartar em silêncio — a linha
-- original de cada chamado fica inteira em `ticket.payload`.

DO $reentrante$
DECLARE
  faltando text;
BEGIN
  IF to_regtype('"public"."ticket_import_status"') IS NULL THEN
CREATE TYPE "public"."ticket_import_status" AS ENUM('PENDING', 'READING', 'READ', 'FAILED', 'SKIPPED_DUPLICATE');
  ELSE
    -- Existe. Exige-se que os valores desta migration estejam lá; um
    -- valor a mais não é conflito (a 0015 acrescenta dois a import_run_status).
    SELECT string_agg(v, ', ') INTO faltando
      FROM unnest(ARRAY['PENDING', 'READING', 'READ', 'FAILED', 'SKIPPED_DUPLICATE']) v
     WHERE v <> ALL (SELECT e.enumlabel::text FROM pg_enum e
                      WHERE e.enumtypid = '"public"."ticket_import_status"'::regtype);
    IF faltando IS NOT NULL THEN
      RAISE EXCEPTION
        E'O tipo ticket_import_status já existe sem os valores que esta migration declara: %.\n\nSubstituí-lo mudaria o significado de colunas que já têm dado. Confira de onde ele veio e alinhe-o. Nada foi alterado.',
        faltando USING ERRCODE = 'data_exception';
    END IF;
  END IF;
END $reentrante$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O envio
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ticket_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"storage_path" text,
	"source_system" text DEFAULT 'FREIGHTEC' NOT NULL,
	"status" "public"."ticket_import_status" DEFAULT 'PENDING' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" text,
	"finished_at" timestamp with time zone,
	"row_count" integer DEFAULT 0 NOT NULL,
	"ticket_count" integer DEFAULT 0 NOT NULL,
	"ignored_row_count" integer DEFAULT 0 NOT NULL,
	"column_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unmapped_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_reason" text
);
--> statement-breakpoint

-- O sha não é UNIQUE de propósito: uma duplicata recusada também vira linha
-- aqui, com status SKIPPED_DUPLICATE e o motivo escrito. Recusar não é
-- esquecer — a mesma regra de `import_run`.
CREATE INDEX IF NOT EXISTS "ticket_import_sha256_idx" ON "ticket_import" USING btree ("content_sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_import_received_idx" ON "ticket_import" USING btree ("received_at");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O chamado
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ticket" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_import_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"status_raw" text,
	"status_bucket" text DEFAULT 'DESCONHECIDO' NOT NULL,
	"parameter_label" text,
	"attribute_code" text,
	"entity_label" text,
	"entity_type" text,
	"requested_value_raw" text,
	"requested_value_numeric" numeric(18, 6),
	"applied_value_raw" text,
	"applied_value_numeric" numeric(18, 6),
	"impact_amount" numeric(18, 6),
	"impact_confidence" text DEFAULT 'NOT_CALCULABLE' NOT NULL,
	"impact_reason" text,
	"requested_by" text,
	"subject" text,
	"source_row_index" integer NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint

DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'ticket_ticket_import_id_ticket_import_id_fk'
                   AND conrelid = '"ticket"'::regclass) THEN
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_ticket_import_id_ticket_import_id_fk" FOREIGN KEY ("ticket_import_id") REFERENCES "public"."ticket_import"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint

-- Uma linha do arquivo entra uma vez só. É o que torna a leitura repetível
-- sem virar duplicação quando ela é retomada depois de uma queda no meio.
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_import_row_uq" ON "ticket" USING btree ("ticket_import_id","source_row_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_import_idx" ON "ticket" USING btree ("ticket_import_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_external_id_idx" ON "ticket" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_status_bucket_idx" ON "ticket" USING btree ("status_bucket");--> statement-breakpoint
-- Só existe enquanto `ticket` carregar parâmetro: a `0013` derruba a coluna e
-- este índice junto. Num banco que já passou por lá — e é o caso de qualquer
-- banco que reencontre esta fila sem registro —, a coluna não está mais lá, e
-- criar o índice sobre ela falharia com `42703`, travando tudo o que vem
-- depois. A condição é sobre a coluna, e não sobre o índice: é ela que decide
-- se este objeto ainda faz sentido.
DO $reentrante$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'ticket'
                AND column_name = 'attribute_code') THEN
CREATE INDEX IF NOT EXISTS "ticket_attribute_idx" ON "ticket" USING btree ("attribute_code");
  END IF;
END $reentrante$;
