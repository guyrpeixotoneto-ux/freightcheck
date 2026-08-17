-- O significado econômico vira cadastro, e os campos técnicos viram derivação.
--
-- ---------------------------------------------------------------------------
-- O que esta migration muda de conceito
-- ---------------------------------------------------------------------------
-- Até aqui a tela de curadoria pedia quatro respostas técnicas por coluna —
-- unidade, periodicidade, agregação e "entra em somas" — e as quatro iam para
-- o banco como a pessoa as digitou. Três delas nunca foram perguntas: são
-- consequências da primeira coisa que alguém sabe sobre a coluna, que é o que
-- ela representa economicamente. Quem sabe que `manutencaoReaisKm` vale
-- R$ 0,38 por quilômetro rodado já disse, com isso, que a unidade é uma razão
-- monetária, que não há periodicidade, que a soma entre veículos não produz
-- grandeza nenhuma e que aquilo não é montante.
--
-- `semantic_meaning` é o cadastro dessas afirmações econômicas. `attribute` e
-- `attribute_semantics` ganham um ponteiro para ela.
--
-- ---------------------------------------------------------------------------
-- O que esta migration deliberadamente NÃO faz
-- ---------------------------------------------------------------------------
-- **Não apaga campo técnico nenhum.** `unit`, `periodicity`, `aggregation` e
-- `is_monetary` continuam nas duas tabelas, continuam preenchidos e continuam
-- sendo o que a composição, a comparação, o impacto, o cockpit e a DRE leem.
-- Nenhum número muda por causa deste arquivo. O que muda é quem os escreve:
-- daqui para a frente é a autoridade semântica que os deriva do significado,
-- e não uma pessoa escolhendo quatro valores num formulário.
--
-- **Não exige o ponteiro.** `meaning_id` é anulável nas duas tabelas. Os 138
-- atributos deste export foram curados no vocabulário antigo; obrigá-los a ter
-- significado cadastrado transformaria uma mudança de tela numa perda de
-- curadoria. O backfill no fim deste arquivo preenche o que dá para preencher,
-- pela leitura de volta, e o que não der continua legível pelos quatro campos.
--
-- **Não inventa período.** Um montante em BRL sem periodicidade vira
-- `montante_veiculo` — "R$ por veículo" —, que é o significado que diz
-- exatamente isto: é dinheiro, é somável, e ninguém disse de que período. É a
-- verdade daquela linha, e a tela pede o período quando alguém for confirmá-la.

-- ---------------------------------------------------------------------------
-- Tudo reentrante, e não por capricho
-- ---------------------------------------------------------------------------
-- `runMigrations()` reexecuta uma migration cujo carimbo sumiu do registro — é
-- a propriedade que destrava um banco com o registro perdido, e o `bridge-up`
-- levanta estes statements do disco para restaurar Development. Um
-- `CREATE TABLE` sem `IF NOT EXISTS` transforma essa recuperação num erro de
-- "relation already exists". Vale para a tabela, para as colunas, para os
-- índices, para as chaves estrangeiras e para as constraints.
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
);
--> statement-breakpoint
ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "meaning_id" uuid;--> statement-breakpoint
ALTER TABLE "taxonomy_node" ADD COLUMN IF NOT EXISTS "created_by" text;--> statement-breakpoint
ALTER TABLE "attribute_semantics" ADD COLUMN IF NOT EXISTS "meaning_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "semantic_meaning_code_uq" ON "semantic_meaning" USING btree ("scope_type","scope_code","code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "semantic_meaning_label_uq" ON "semantic_meaning" USING btree ("scope_type","scope_code","normalized_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "semantic_meaning_scope_idx" ON "semantic_meaning" USING btree ("scope_type","scope_code");--> statement-breakpoint
DO $reentrante$
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
END $reentrante$;--> statement-breakpoint
DO $reentrante$
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
END $reentrante$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O catálogo inicial
-- ---------------------------------------------------------------------------
-- Estas quinze linhas são a redação em SQL de `SIGNIFICADOS_PADRAO` e
-- `derivarSemantica`, em lib/curation/src/significado.ts. A função é a fonte;
-- isto é a cópia — e a cópia não pode divergir: um teste de arquitetura relê
-- todas as linhas com `is_seed`, aplica a autoridade a cada uma e compara os
-- sete campos derivados, do mesmo jeito que o teste da 0023 confere a
-- constraint contra `coerenciaDaSemantica`.
--
-- Estão aqui, e não só na função de seed em TypeScript, pelo motivo que a 0025
-- documenta: "rodem o backfill" é a instrução que ninguém executa. Uma
-- migration roda uma vez, sozinha, em todo banco que venha a existir — e sem o
-- catálogo a tela nova abre com a lista vazia.
--
-- `created_by = 'system:catalogo-inicial'` é honesto: ninguém decidiu estas
-- quinze numa tela. As que a operação cadastrar terão o e-mail de quem as
-- cadastrou, e a tela não deixa criar sem sessão.
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

-- ---------------------------------------------------------------------------
-- A coerência passa a valer para toda taxa, e não só para as três conhecidas
-- ---------------------------------------------------------------------------
-- A 0023 escreveu `unit IN ('KM_L','BRL_KM','PERCENT')` porque eram as três
-- razões que existiam. Com o significado derivando a unidade, a operação passa
-- a criar as suas: `R$ por litro` produz `BRL_LITRO`, `R$ por viagem` produz
-- `BRL_VIAGEM`, e amanhã `BRL_PALLET`. Uma lista fechada aceitaria como somável
-- toda razão cuja base ninguém tivesse previsto — e "somável" aqui quer dizer
-- `R$ 0,42/litro × 100 cavalos = R$ 42/litro` chegando a uma tela de dinheiro.
--
-- A regra passa a ser o prefixo: `BRL` é o montante e se soma; `BRL_` alguma
-- coisa é reais **por** aquilo, e não se soma. `KM_L` e `PERCENT` continuam
-- nomeados porque não seguem o padrão. É a mesma expressão de `ehRazao`, em
-- lib/curation/src/agregacao.ts, e o teste de equivalência que já existe
-- continua conferindo as duas combinação por combinação.
--
-- Nenhuma linha existente viola a regra nova: as três unidades antigas já
-- estavam cobertas, e não há nenhuma outra `BRL\_%` em banco algum antes desta
-- migration — ela é que cria a primeira.
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

-- O cadastro obedece à mesma regra que a projeção e a versão obedecem.
--
-- Sem isto, um significado incoerente cadastrado por uma tela seria gravável
-- aqui e só explodiria na confirmação seguinte, longe de quem o criou. A
-- terceira cópia da mesma invariante é barata e fecha a única porta que a
-- criação inline abriu.
ALTER TABLE "semantic_meaning" DROP CONSTRAINT IF EXISTS "semantic_meaning_semantica_coerente";--> statement-breakpoint
ALTER TABLE "semantic_meaning" ADD CONSTRAINT "semantic_meaning_semantica_coerente" CHECK (
  ("aggregation" IS NULL OR "aggregation" IN ('SUM', 'AVG', 'NONE'))
  AND NOT (("unit" = 'KM_L' OR "unit" = 'PERCENT' OR "unit" LIKE 'BRL\_%')
           AND "aggregation" = 'SUM')
  AND NOT ("is_monetary" IS TRUE AND "unit" IS NOT NULL AND "unit" <> 'BRL')
);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O passado, lido de volta
-- ---------------------------------------------------------------------------
-- A leitura de volta é `significadoPara`, escrita aqui em CASE. Ela não afirma
-- nada de novo: o significado é *deduzido* dos quatro campos que já estavam
-- gravados, e por isso não há como ela contradizer uma confirmação existente.
-- Um atributo sem unidade — a maioria da fila, que ninguém curou — fica com
-- `meaning_id` nulo, que é a verdade.
--
-- Num banco recém-migrado (todo teste, todo ambiente novo) as duas instruções
-- casam zero linhas: não há atributo ainda. Elas existem para o banco que já
-- tem os 138.
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
