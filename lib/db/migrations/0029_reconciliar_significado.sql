-- Reconciliar o que a 0028 cria e o bridge remove.
--
-- ---------------------------------------------------------------------------
-- O buraco, na versão curta
-- ---------------------------------------------------------------------------
-- É o mesmo da `0024`, e ele não fecha sozinho: `bridgeDown` remove objetos que
-- as migrations criam e **não toca no registro**; `runMigrations()` pula toda
-- migration cujo carimbo já está registrado. Depois de um `down` sem `up`, só o
-- `up` devolve aqueles objetos — a fila estruturalmente não consegue, e
-- `migrate` responde "nada a aplicar" sobre um banco divergente.
--
-- A `0024` fechou isso para as onze colunas e os seis índices que existiam
-- naquele dia. A `0028` acrescentou uma tabela, três colunas, três índices,
-- duas chaves estrangeiras, uma constraint e um catálogo — e todos saem no
-- `down`, porque o contrato com o Publishing é "seis ADD COLUMN e nada mais".
-- Sem esta migration, a lista do bridge teria crescido em silêncio, que é
-- exatamente o que `reconciliacao-bridge.test.ts` existe para impedir.
--
-- ---------------------------------------------------------------------------
-- Por que uma migration nova, e não editar a 0024
-- ---------------------------------------------------------------------------
-- Porque a `0024` já está registrada em todo banco que a aplicou, e reescrevê-la
-- não a faz rodar de novo em nenhum deles — a decisão de rodar é pelo carimbo,
-- nunca pelo conteúdo. Uma migration com carimbo próprio roda uma vez, sozinha,
-- em todos.
--
-- Cada família de objetos reconcilia a si mesma, e é assim que o teste exige:
-- toda entrada de `COLUNAS_REMOVIDAS` tem de aparecer em **alguma** migration
-- cujo nome case `_reconciliar_`, e nenhuma delas precisa copiar o conteúdo da
-- anterior. Esta é a terceira — depois da `0024` e da `0027` —, e a regra que
-- as três seguem é a mesma: a reconciliação tem de ser a última da fila, então
-- toda coluna criada depois de uma delas precisa da seguinte.
--
-- ---------------------------------------------------------------------------
-- Em banco saudável isto é no-op
-- ---------------------------------------------------------------------------
-- Todo comando é `IF NOT EXISTS`, `DROP … IF EXISTS` antes do `ADD`, ou
-- `ON CONFLICT DO NOTHING`. Num banco em dia custa uma varredura de catálogo e
-- não escreve nada. O que ele **não** faz é inventar semântica: o backfill do
-- fim é a mesma leitura de volta da `0028`, que deduz o ponteiro dos quatro
-- campos técnicos que nunca saíram do banco.

CREATE TABLE IF NOT EXISTS "semantic_meaning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" text DEFAULT 'GLOBAL' NOT NULL,
	"scope_code" text DEFAULT '*' NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"normalized_label" text NOT NULL,
	"forma" text NOT NULL,
	"base" text,
	"unit" text,
	"periodicity" text,
	"aggregation" text,
	"is_monetary" boolean,
	"currency" text,
	"value_kind" text NOT NULL,
	"denominator" text,
	"is_seed" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "semantic_meaning_code_uq" ON "semantic_meaning" USING btree ("scope_type","scope_code","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "semantic_meaning_label_uq" ON "semantic_meaning" USING btree ("scope_type","scope_code","normalized_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "semantic_meaning_scope_idx" ON "semantic_meaning" USING btree ("scope_type","scope_code");--> statement-breakpoint

ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "meaning_id" uuid;--> statement-breakpoint
ALTER TABLE "attribute_semantics" ADD COLUMN IF NOT EXISTS "meaning_id" uuid;--> statement-breakpoint
ALTER TABLE "taxonomy_node" ADD COLUMN IF NOT EXISTS "created_by" text;--> statement-breakpoint

DO $reconciliar$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'attribute'
       AND c.conname = 'attribute_meaning_id_semantic_meaning_id_fk'
  ) THEN
    ALTER TABLE "attribute" ADD CONSTRAINT "attribute_meaning_id_semantic_meaning_id_fk"
      FOREIGN KEY ("meaning_id") REFERENCES "public"."semantic_meaning"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $reconciliar$;--> statement-breakpoint

DO $reconciliar$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'attribute_semantics'
       AND c.conname = 'attribute_semantics_meaning_id_semantic_meaning_id_fk'
  ) THEN
    ALTER TABLE "attribute_semantics" ADD CONSTRAINT "attribute_semantics_meaning_id_semantic_meaning_id_fk"
      FOREIGN KEY ("meaning_id") REFERENCES "public"."semantic_meaning"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $reconciliar$;--> statement-breakpoint

-- O catálogo inicial, idêntico ao da `0028`. `ON CONFLICT DO NOTHING` faz dele
-- um no-op no banco que já o tem, e o repõe inteiro no que perdeu a tabela.
INSERT INTO "semantic_meaning" (
  "scope_type", "scope_code", "code", "label", "normalized_label",
  "forma", "base", "unit", "periodicity", "aggregation", "is_monetary",
  "currency", "value_kind", "denominator", "is_seed", "created_by"
) VALUES
  ('GLOBAL','*','montante_mes','R$ por mês','r$ por mes','MONTANTE','MES','BRL','MENSAL','SUM',true,'BRL','AMOUNT',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','montante_ano','R$ por ano','r$ por ano','MONTANTE','ANO','BRL','ANUAL','SUM',true,'BRL','AMOUNT',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','montante_aquisicao','Valor total em R$','valor total em r$','MONTANTE','AQUISICAO','BRL','PONTUAL','SUM',true,'BRL','AMOUNT',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','montante_veiculo','R$ por veículo','r$ por veiculo','MONTANTE','VEICULO','BRL',NULL,'SUM',true,'BRL','AMOUNT',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','taxa_km','R$ por km','r$ por km','TAXA','KM','BRL_KM',NULL,'NONE',false,'BRL','RATE','KM',true,'system:catalogo-inicial'),
  ('GLOBAL','*','taxa_litro','R$ por litro','r$ por litro','TAXA','LITRO','BRL_LITRO',NULL,'NONE',false,'BRL','RATE','LITRO',true,'system:catalogo-inicial'),
  ('GLOBAL','*','taxa_viagem','R$ por viagem','r$ por viagem','TAXA','VIAGEM','BRL_VIAGEM',NULL,'NONE',false,'BRL','RATE','VIAGEM',true,'system:catalogo-inicial'),
  ('GLOBAL','*','proporcao','Percentual','percentual','PROPORCAO',NULL,'PERCENT',NULL,'NONE',false,NULL,'RATIO',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','consumo','Quilômetros por litro','quilometros por litro','CONSUMO',NULL,'KM_L',NULL,'NONE',false,NULL,'RATIO','LITRO',true,'system:catalogo-inicial'),
  ('GLOBAL','*','grandeza_qtd','Quantidade','quantidade','GRANDEZA','QTD','QTD',NULL,'AVG',false,NULL,'QUANTITY',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','grandeza_km','Quilômetros','quilometros','GRANDEZA','KM','KM',NULL,'AVG',false,NULL,'QUANTITY',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','grandeza_litro','Litros','litros','GRANDEZA','LITRO','LITROS',NULL,'AVG',false,NULL,'QUANTITY',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','grandeza_mes','Meses','meses','GRANDEZA','MES','MESES',NULL,'AVG',false,NULL,'QUANTITY',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','descritor_ano_calendario','Ano de calendário','ano de calendario','DESCRITOR','ANO_CALENDARIO','ANO',NULL,'NONE',false,NULL,'DESCRIPTOR',NULL,true,'system:catalogo-inicial'),
  ('GLOBAL','*','descritor','Texto descritivo','texto descritivo','DESCRITOR',NULL,NULL,NULL,'NONE',false,NULL,'DESCRIPTOR',NULL,true,'system:catalogo-inicial')
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- As três coerências, na redação que a `0028` estabeleceu: razão é o prefixo
-- `BRL_`, e não uma lista de três unidades. Repor a versão antiga aqui
-- aceitaria `R$ por litro` declarado somável.
ALTER TABLE "attribute" DROP CONSTRAINT IF EXISTS "attribute_semantica_coerente";--> statement-breakpoint
ALTER TABLE "attribute" ADD CONSTRAINT "attribute_semantica_coerente" CHECK (
  ("aggregation" IS NULL OR "aggregation" IN ('SUM', 'AVG', 'NONE'))
  AND NOT ("data_type" IN ('TEXT', 'BOOLEAN', 'DATE', 'MIXED', 'UNKNOWN')
           AND "aggregation" IS NOT NULL AND "aggregation" <> 'NONE')
  AND NOT (("unit" = 'KM_L' OR "unit" = 'PERCENT' OR "unit" LIKE 'BRL\_%')
           AND "aggregation" = 'SUM')
  AND NOT ("is_monetary" IS TRUE AND "unit" IS NOT NULL AND "unit" <> 'BRL')
);--> statement-breakpoint

ALTER TABLE "attribute_semantics" DROP CONSTRAINT IF EXISTS "attribute_semantics_semantica_coerente";--> statement-breakpoint
ALTER TABLE "attribute_semantics" ADD CONSTRAINT "attribute_semantics_semantica_coerente" CHECK (
  ("aggregation" IS NULL OR "aggregation" IN ('SUM', 'AVG', 'NONE'))
  AND NOT (("unit" = 'KM_L' OR "unit" = 'PERCENT' OR "unit" LIKE 'BRL\_%')
           AND "aggregation" = 'SUM')
  AND NOT ("is_monetary" IS TRUE AND "unit" IS NOT NULL AND "unit" <> 'BRL')
);--> statement-breakpoint

ALTER TABLE "semantic_meaning" DROP CONSTRAINT IF EXISTS "semantic_meaning_semantica_coerente";--> statement-breakpoint
ALTER TABLE "semantic_meaning" ADD CONSTRAINT "semantic_meaning_semantica_coerente" CHECK (
  ("aggregation" IS NULL OR "aggregation" IN ('SUM', 'AVG', 'NONE'))
  AND NOT (("unit" = 'KM_L' OR "unit" = 'PERCENT' OR "unit" LIKE 'BRL\_%')
           AND "aggregation" = 'SUM')
  AND NOT ("is_monetary" IS TRUE AND "unit" IS NOT NULL AND "unit" <> 'BRL')
);--> statement-breakpoint

-- A leitura de volta, de novo. Só preenche o que está nulo: um ponteiro que
-- alguém confirmou na tela nunca é reescrito por dedução.
UPDATE "attribute" a
   SET "meaning_id" = m."id"
  FROM "semantic_meaning" m
 WHERE m."scope_type" = 'GLOBAL' AND m."scope_code" = '*'
   AND a."meaning_id" IS NULL
   AND m."code" = CASE
     WHEN a."unit" = 'BRL' OR (a."is_monetary" IS TRUE AND a."unit" IS NULL) THEN
       CASE a."periodicity"
         WHEN 'MENSAL'  THEN 'montante_mes'
         WHEN 'ANUAL'   THEN 'montante_ano'
         WHEN 'PONTUAL' THEN 'montante_aquisicao'
         ELSE 'montante_veiculo'
       END
     WHEN a."unit" = 'KM_L'    THEN 'consumo'
     WHEN a."unit" = 'PERCENT' THEN 'proporcao'
     WHEN a."unit" LIKE 'BRL\_%' THEN 'taxa_' || lower(substring(a."unit" from 5))
     WHEN a."unit" = 'ANO'     THEN 'descritor_ano_calendario'
     WHEN a."unit" = 'KM'      THEN 'grandeza_km'
     WHEN a."unit" = 'LITROS'  THEN 'grandeza_litro'
     WHEN a."unit" = 'MESES'   THEN 'grandeza_mes'
     WHEN a."unit" = 'QTD'     THEN 'grandeza_qtd'
     ELSE NULL
   END;--> statement-breakpoint

UPDATE "attribute_semantics" v
   SET "meaning_id" = m."id"
  FROM "semantic_meaning" m
 WHERE m."scope_type" = 'GLOBAL' AND m."scope_code" = '*'
   AND v."meaning_id" IS NULL
   AND m."code" = CASE
     WHEN v."unit" = 'BRL' OR (v."is_monetary" IS TRUE AND v."unit" IS NULL) THEN
       CASE v."periodicity"
         WHEN 'MENSAL'  THEN 'montante_mes'
         WHEN 'ANUAL'   THEN 'montante_ano'
         WHEN 'PONTUAL' THEN 'montante_aquisicao'
         ELSE 'montante_veiculo'
       END
     WHEN v."unit" = 'KM_L'    THEN 'consumo'
     WHEN v."unit" = 'PERCENT' THEN 'proporcao'
     WHEN v."unit" LIKE 'BRL\_%' THEN 'taxa_' || lower(substring(v."unit" from 5))
     WHEN v."unit" = 'ANO'     THEN 'descritor_ano_calendario'
     WHEN v."unit" = 'KM'      THEN 'grandeza_km'
     WHEN v."unit" = 'LITROS'  THEN 'grandeza_litro'
     WHEN v."unit" = 'MESES'   THEN 'grandeza_mes'
     WHEN v."unit" = 'QTD'     THEN 'grandeza_qtd'
     ELSE NULL
   END;
