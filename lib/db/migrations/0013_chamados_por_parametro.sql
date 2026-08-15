-- Um chamado mexe em vários parâmetros — e a `0012` só sabia guardar um.
--
-- O export de chamados do Freightech vem no mesmo formato largo da planilha de
-- vigência: uma linha por chamado, e dezenas de colunas de parâmetro de
-- remuneração ao lado, preenchidas só onde aquele chamado mexeu. A `0012`
-- modelou o chamado como se ele carregasse um parâmetro só — `parameter_label`,
-- `requested_value`, `applied_value` em `ticket` —, o que obrigaria a leitura a
-- escolher um deles por linha. Um chamado que altera oito parâmetros perderia
-- sete, em silêncio, e a tela mostraria um total que nenhuma conta sustenta.
--
-- A correção é desdobrar a linha larga: `ticket` continua sendo o chamado —
-- quem abriu, quando, em que situação, sobre que ativo — e `ticket_change`
-- passa a ser uma linha por parâmetro que veio preenchido. É o mesmo grão de
-- `change` na aba Planilha, o que é justamente o ponto: as duas abas listam a
-- mesma unidade (um parâmetro que mudou), medida por réguas diferentes.
--
-- **De onde vem o "antes".** Aqui está a diferença que `before_source` guarda.
-- O arquivo pode trazer o valor anterior ao lado do novo, em colunas aos pares
-- ("Pedágio (antes)" e "Pedágio (novo)"); aí o antes é do próprio documento.
-- Quando ele traz só o valor novo — o caso comum —, o antes é buscado na
-- vigência em vigor para aquela placa e aquele parâmetro. São procedências com
-- força de prova diferente, e juntá-las na mesma coluna sem marcar qual é qual
-- daria a um valor inferido a mesma cara de um declarado. Este produto não faz
-- isso em lugar nenhum, e não vai começar aqui.
--
-- As colunas removidas de `ticket` não têm dado a preservar: a `0012` entrou
-- agora e nenhum arquivo real chegou a ser lido sob aquele formato. Um envio
-- que porventura tenha entrado precisa ser reimportado — o que já era
-- necessário de todo modo, porque a leitura antiga teria descartado os demais
-- parâmetros de cada linha.

-- ---------------------------------------------------------------------------
-- `ticket` deixa de carregar parâmetro
-- ---------------------------------------------------------------------------
ALTER TABLE "ticket" DROP COLUMN IF EXISTS "parameter_label";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN IF EXISTS "attribute_code";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN IF EXISTS "requested_value_raw";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN IF EXISTS "requested_value_numeric";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN IF EXISTS "applied_value_raw";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN IF EXISTS "applied_value_numeric";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN IF EXISTS "impact_amount";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN IF EXISTS "impact_confidence";--> statement-breakpoint
ALTER TABLE "ticket" DROP COLUMN IF EXISTS "impact_reason";--> statement-breakpoint

DROP INDEX IF EXISTS "ticket_attribute_idx";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reentrância
-- ---------------------------------------------------------------------------
-- O diff automático do Publishing propõe exatamente esta migration como DDL
-- cru: derrubar as nove colunas de parâmetro de `ticket` e acrescentar
-- `changed_parameter_count`. Aceitar aquela proposta muda o schema sem
-- registrar nada em `drizzle.__drizzle_migrations` — e então esta migration
-- rodaria em cima do resultado e morreria em `duplicate_column`, levando junto
-- tudo o que vem depois dela. A fila ficaria travada, que é o defeito que a
-- adoção do `runMigrations` já teve de resolver uma vez.
--
-- Daqui em diante cada objeto é conferido antes de criado. O que já estiver lá
-- com a definição esperada é adotado; o que estiver lá com outro tipo aborta,
-- nomeando a diferença.
DO $$
DECLARE
  achado text;
BEGIN
  SELECT string_agg(format('%s.%s é %s, esperado %s', t.tabela, t.coluna, c.data_type, t.tipo), E'\n  ')
    INTO achado
    FROM (VALUES
      ('ticket', 'changed_parameter_count', 'integer'),
      ('ticket_import', 'parameter_columns', 'jsonb')
    ) AS t(tabela, coluna, tipo)
    JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = t.tabela
     AND c.column_name = t.coluna
   WHERE c.data_type <> t.tipo;

  IF achado IS NOT NULL THEN
    RAISE EXCEPTION
      E'Colunas dos chamados já existem com outro tipo:\n  %\n\nEsta migration não converte tipo de coluna que já tem dado. Confira de onde vieram e alinhe-as ou remova-as. Nada foi alterado.',
      achado
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- Nasce nullable: a contagem verdadeira só existe depois que `ticket_change`
-- existir, adiante. Um `DEFAULT 0 NOT NULL` aqui gravaria zero como se fosse
-- resposta, e zero parâmetro alterado é uma afirmação, não um preenchimento.
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "changed_parameter_count" integer;--> statement-breakpoint

-- Quais colunas do arquivo foram lidas como parâmetro de remuneração. No
-- formato largo elas são a maioria, e quem confere o import precisa vê-las
-- nomeadas — "reconheci 47 parâmetros" sem dizer quais é um número sem lastro.
ALTER TABLE "ticket_import" ADD COLUMN IF NOT EXISTS "parameter_columns" jsonb;--> statement-breakpoint
DO $$
BEGIN
  UPDATE "ticket_import" SET "parameter_columns" = '[]'::jsonb WHERE "parameter_columns" IS NULL;
  ALTER TABLE "ticket_import" ALTER COLUMN "parameter_columns" SET DEFAULT '[]'::jsonb;
  ALTER TABLE "ticket_import" ALTER COLUMN "parameter_columns" SET NOT NULL;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Uma linha por parâmetro mexido
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ticket_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"ticket_import_id" uuid NOT NULL,
	"parameter_label" text NOT NULL,
	"attribute_code" text,
	"entity_label" text,
	"entity_type" text,
	"value_before_raw" text,
	"value_before_numeric" numeric(18, 6),
	"value_after_raw" text,
	"value_after_numeric" numeric(18, 6),
	"before_source" text DEFAULT 'AUSENTE' NOT NULL,
	"before_reference" text,
	"delta_absolute" numeric(18, 6),
	"delta_percent" numeric(12, 6),
	"impact_amount" numeric(18, 6),
	"impact_confidence" text DEFAULT 'NOT_CALCULABLE' NOT NULL,
	"impact_reason" text,
	"source_column_index" integer NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_change_ticket_id_ticket_id_fk') THEN
    ALTER TABLE "ticket_change" ADD CONSTRAINT "ticket_change_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_change_ticket_import_id_ticket_import_id_fk') THEN
    ALTER TABLE "ticket_change" ADD CONSTRAINT "ticket_change_ticket_import_id_ticket_import_id_fk" FOREIGN KEY ("ticket_import_id") REFERENCES "public"."ticket_import"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

-- Um parâmetro entra uma vez por chamado. É o que torna a leitura repetível
-- sem duplicar quando ela é retomada depois de uma queda no meio.
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_change_grain_uq" ON "ticket_change" USING btree ("ticket_id","parameter_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_change_import_idx" ON "ticket_change" USING btree ("ticket_import_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_change_ticket_idx" ON "ticket_change" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_change_attribute_idx" ON "ticket_change" USING btree ("attribute_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_change_parameter_idx" ON "ticket_change" USING btree ("parameter_label");;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A contagem, derivada de `ticket_change`
-- ---------------------------------------------------------------------------
-- Agora que a tabela existe, `changed_parameter_count` pode dizer a verdade em
-- vez de repetir um default. Num banco que acabou de chegar aqui ela é zero
-- para todo mundo, porque nenhum chamado foi relido ainda — e zero contado é
-- diferente de zero suposto.
DO $$
BEGIN
  UPDATE "ticket" t
     SET "changed_parameter_count" =
         (SELECT count(*) FROM "ticket_change" tc WHERE tc."ticket_id" = t."id")
   WHERE t."changed_parameter_count" IS NULL;
  ALTER TABLE "ticket" ALTER COLUMN "changed_parameter_count" SET DEFAULT 0;
  ALTER TABLE "ticket" ALTER COLUMN "changed_parameter_count" SET NOT NULL;
END $$;
