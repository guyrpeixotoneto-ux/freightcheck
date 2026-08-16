-- Cobertura de dados — o esperado, e o denominador do observado.
--
-- Duas tabelas, e nada mais. O diagnóstico que precedeu esta migration mediu o
-- export real (2 arquivos, 9 vigências, 124.632 fatos) e encontrou quase tudo
-- o que a cobertura precisa já modelado: presença de valor é `fact.is_null =
-- false`, ausência declarada é `fact.is_null = true` com `null_reason`,
-- presença no layout é `snapshot_attribute.present_in_layout`, e a vigência, a
-- família, o canal e o escopo são colunas de `snapshot`. Recriar qualquer uma
-- dessas coisas seria abrir uma segunda verdade sobre o mesmo fato.
--
-- O que não existia:
--
--   1. **O esperado.** Nenhuma coluna dizia "este atributo deveria existir".
--      Sem ela, cobertura só consegue ser "o que veio" — a pergunta que a tela
--      de Importações já responde.
--   2. **O denominador por equipamento.** `snapshot.entity_count` é o total da
--      vigência. "Quantos cavalos tem esta vigência" custava
--      `count(DISTINCT entity_id)` sobre a fact table: 208 ms com 124 mil
--      fatos, e a fact table é justamente a que vai para milhões.
--
-- Nada aqui altera coluna existente, apaga dado ou mexe em vigência fechada. As
-- duas tabelas nascem vazias; `snapshot_entity_type` é preenchida ao final por
-- um backfill exato, lido dos próprios fatos.

-- ---------------------------------------------------------------------------
-- 1. O agregado de uma entrega, por equipamento
-- ---------------------------------------------------------------------------
--
-- Por que uma tabela e não uma coluna em `snapshot`: o gatilho
-- `snapshot_immutable` da 0001 congela a vigência quando ela fecha e enumera,
-- nome por nome, as colunas que a transição CLOSED -> SUPERSEDED pode mexer. O
-- backfill de uma coluna nova em `snapshot` esbarraria nele para toda vigência
-- já fechada — que são todas —, e desligar o gatilho para preencher uma coluna
-- de conveniência trocaria a garantia central do produto por uma leitura mais
-- curta.
CREATE TABLE IF NOT EXISTS "snapshot_entity_type" (
	"snapshot_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_count" integer DEFAULT 0 NOT NULL,
	"attribute_count" integer DEFAULT 0 NOT NULL,
	"fact_count" integer DEFAULT 0 NOT NULL,
	"value_count" integer DEFAULT 0 NOT NULL,
	"null_count" integer DEFAULT 0 NOT NULL,
	"inherited_fact_count" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint

DO $reentrante$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'snapshot_entity_type'
       AND c.conname = 'snapshot_entity_type_snapshot_id_snapshot_id_fk'
  ) THEN
    ALTER TABLE "snapshot_entity_type"
      ADD CONSTRAINT "snapshot_entity_type_snapshot_id_snapshot_id_fk"
      FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshot"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_entity_type_uq"
  ON "snapshot_entity_type" USING btree ("snapshot_id","entity_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_entity_type_type_idx"
  ON "snapshot_entity_type" USING btree ("entity_type");--> statement-breakpoint

COMMENT ON TABLE "snapshot_entity_type" IS
  'Agregado de uma entrega por equipamento: o denominador da matriz de cobertura. Escrito na promoção, enquanto a vigência ainda é DRAFT.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. O esperado, e só o esperado que alguém afirmou
-- ---------------------------------------------------------------------------
--
-- `origin` só admite CONTRATO e CURADORIA, e `status` só admite CONFIRMADO e
-- DISPENSADO. A ausência de um valor INFERIDO é a decisão de projeto mais
-- importante deste arquivo: um atributo que apareceu nas oito vigências
-- anteriores para as mesmas 144 entidades é evidência forte, e evidência forte
-- não é declaração. O esperado inferido é recalculado a cada leitura sobre o
-- histórico de `snapshot_attribute` e chega à tela marcado como inferido.
-- Gravá-lo aqui o tornaria, em uma migration ou duas, indistinguível de
-- contrato — que é exatamente como uma estatística vira verdade sem que
-- ninguém tenha decidido.
--
-- Os CHECKs de `rationale` e `actor` existem porque `NOT NULL` cobre o nulo e
-- nada mais: string vazia satisfaz a obrigatoriedade e não explica nada, e uma
-- decisão de cobertura sem dono e sem motivo não é auditável.
CREATE TABLE IF NOT EXISTS "coverage_expectation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" text DEFAULT 'FREIGHTEC' NOT NULL,
	"dataset_family" text NOT NULL,
	"canal" text,
	"scope_key" text,
	"entity_type" text NOT NULL,
	"attribute_code" text NOT NULL,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"criticality" text DEFAULT 'RELEVANTE' NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"succeeded_by_attribute_code" text,
	"rationale" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coverage_expectation_uq" UNIQUE NULLS NOT DISTINCT("source_system","dataset_family","canal","scope_key","entity_type","attribute_code","effective_from"),
	CONSTRAINT "coverage_expectation_origin_ck" CHECK ("coverage_expectation"."origin" IN ('CONTRATO', 'CURADORIA')),
	CONSTRAINT "coverage_expectation_status_ck" CHECK ("coverage_expectation"."status" IN ('CONFIRMADO', 'DISPENSADO')),
	CONSTRAINT "coverage_expectation_criticality_ck" CHECK ("coverage_expectation"."criticality" IN ('CRITICO', 'RELEVANTE', 'INFORMATIVO')),
	CONSTRAINT "coverage_expectation_rationale_ck" CHECK (btrim("coverage_expectation"."rationale") <> ''),
	CONSTRAINT "coverage_expectation_actor_ck" CHECK (btrim("coverage_expectation"."actor") <> ''),
	CONSTRAINT "coverage_expectation_sucessor_ck" CHECK ("coverage_expectation"."succeeded_by_attribute_code" IS NULL OR "coverage_expectation"."effective_until" IS NOT NULL)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "coverage_expectation_lookup_idx"
  ON "coverage_expectation" USING btree ("dataset_family","entity_type","attribute_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coverage_expectation_attribute_idx"
  ON "coverage_expectation" USING btree ("attribute_code");--> statement-breakpoint

COMMENT ON TABLE "coverage_expectation" IS
  'O que deveria existir, e toda decisão humana sobre cobertura. Guarda apenas contrato e curadoria; expectativa inferida do histórico é recalculada na leitura e nunca gravada.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. O índice do "não aplicável"
-- ---------------------------------------------------------------------------
--
-- Cobertura tem de distinguir quatro coisas que o resto do mundo confunde:
-- ausência, nulo, zero e não aplicável. As três primeiras já se leem de
-- `snapshot_attribute` e de `fact.is_null`; a quarta exige olhar `null_reason`,
-- e é a única pergunta da matriz que desce ao fato.
--
-- Parcial de propósito. `NOT_APPLICABLE` só entra num fato por regra de
-- sentinela confirmada por uma pessoa (ver `sentinel_rule`), então este índice
-- cobre a fatia rara: no export real medido são **zero** linhas entre 124.632
-- fatos, contra 9.360 EMPTY e 2.602 VALUE_MISSING. Um índice cheio sobre
-- `null_reason` custaria o tamanho da fact table para responder a mesma
-- pergunta.
--
-- Fica só no SQL, como `fact_inherited_idx` da 0017: o `schema.ts` não modela
-- índice parcial, e o SQL é a autoridade sobre ele (ver docs/MIGRATIONS.md).
CREATE INDEX IF NOT EXISTS "fact_nao_aplicavel_idx"
  ON "fact" USING btree ("snapshot_id", "attribute_id")
  WHERE "null_reason" = 'NOT_APPLICABLE';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Backfill do agregado, para as vigências que já existem
-- ---------------------------------------------------------------------------
--
-- Exato, não estimado: as contagens saem dos próprios fatos, agrupadas pelo
-- tipo da entidade. `ON CONFLICT DO NOTHING` torna o comando inócuo quando o
-- backfill já rodou — a fila de migrations atravessa bancos que já a contêm, e
-- é isso que a reentrância exige aqui.
--
-- Escreve para **toda** vigência, inclusive as SUPERSEDED: a matriz de
-- cobertura só lê as ativas, mas o histórico de uma lacuna precisa poder
-- responder "o que a revisão anterior tinha" sem varrer a fact table.
INSERT INTO "snapshot_entity_type" (
  snapshot_id, entity_type, entity_count, attribute_count,
  fact_count, value_count, null_count, inherited_fact_count
)
SELECT f.snapshot_id,
       e.entity_type,
       count(DISTINCT f.entity_id)::int,
       count(DISTINCT f.attribute_id)::int,
       count(*)::int,
       count(*) FILTER (WHERE NOT f.is_null)::int,
       count(*) FILTER (WHERE f.is_null)::int,
       count(*) FILTER (WHERE f.inherited_from_snapshot_id IS NOT NULL)::int
  FROM "fact" f
  JOIN "entity" e ON e.id = f.entity_id
 GROUP BY f.snapshot_id, e.entity_type
    ON CONFLICT (snapshot_id, entity_type) DO NOTHING;
