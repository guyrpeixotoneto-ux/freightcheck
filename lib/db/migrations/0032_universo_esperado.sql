-- O universo esperado deixa de ser o arquivo que chegou.
--
-- Duas mudanças, e as duas servem à mesma correção: a cobertura media a
-- completude do **export recebido** e chamava isso de cobertura de dados. As
-- duas pontas desse erro eram simétricas — o que nunca chegou era invisível, e
-- o denominador saía do próprio arquivo.
--
-- ---------------------------------------------------------------------------
-- 1. `coverage_expectation.origin` passa a admitir `CATALOGO`
-- ---------------------------------------------------------------------------
-- O esperado declarado vinha de uma fonte só: o plano da DRE, que cita **10**
-- códigos de atributo. Todo o resto saía de inferência sobre o que já havia
-- chegado — e inferência sobre o que chegou não alcança o que nunca chegou.
--
-- `CATALOGO` é a terceira declaração, ao lado de `CONTRATO` e `CURADORIA`: as
-- três planilhas de atributos que a curadoria mantém em `docs/`, agora
-- alcançáveis por código em `lib/curation/src/catalogo-declarado.ts`. São 250
-- atributos para os três tipos de linha — e 110 deles são de trecho, que tem
-- catálogo inteiro e nenhum arquivo.
--
-- O CHECK é ampliado e não removido. Um `origin` de texto livre é como a
-- fronteira entre declaração e inferência morre: bastaria alguém gravar
-- `HISTORICO` ali para uma estatística virar linha no banco, indistinguível de
-- contrato dois commits depois. A lista fechada é a regra escrita onde ela não
-- pode ser contornada, e ampliá-la é — de propósito — um arquivo que alguém
-- revisa.
--
-- Nenhuma linha é escrita aqui: a semeadura é idempotente (`semearContrato`,
-- com `ON CONFLICT DO NOTHING`) e roda na partida do servidor e no fim de cada
-- importação, de modo que o universo novo entra pelo caminho normal sem que
-- esta migration precise conhecer os 250 atributos.
--
-- ---------------------------------------------------------------------------
-- 2. `entity_expectation` — o esperado no grão da entidade
-- ---------------------------------------------------------------------------
-- O denominador de entidades era `snapshot_entity_type.entity_count`, isto é,
-- quantos equipamentos **chegaram**. Um denominador tirado do próprio arquivo
-- não acusa falta: dez carretas que somem levam numerador e denominador
-- juntos, e o percentual não se mexe. Medido no export real, nove carretas e
-- dois cavalos desaparecem a partir de Mai/26 e a cobertura seguia em 100%.
--
-- A lista de quem deveria estar lá sai da continuidade da própria série, e essa
-- parte **não** mora aqui: "apareceu antes e sumiu agora" é inferência,
-- recalculada a cada leitura em `lib/coverage/src/frota.ts`, exatamente como o
-- esperado inferido dos atributos. O que mora aqui é só declaração:
--
--   * `status = 'BAIXA'`     — saiu da frota em `effective_from`. A ausência
--     deixa de contar. É a **única** saída do mecanismo, e ela precisa existir
--     porque `entity_identifier` nunca fecha janela: a importação só escreve
--     `is_current = true`, então "todo equipamento já visto" inclui todo
--     caminhão já vendido. Sem este registro, cada venda viraria lacuna eterna.
--   * `status = 'ESPERADA'`  — deveria aparecer nesta janela, mesmo que nunca
--     tenha aparecido. É o caminho para declarar um roster antes do primeiro
--     arquivo — o caso do trecho.
--
-- `rationale` e `actor` são `NOT NULL` com CHECK de não-vazio pela mesma razão
-- de `coverage_expectation`: uma baixa sem dono e sem motivo apaga uma lacuna e
-- não deixa rastro de quem a apagou.

CREATE TABLE IF NOT EXISTS "entity_expectation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_system" text DEFAULT 'FREIGHTEC' NOT NULL,
	"dataset_family" text NOT NULL,
	"canal" text,
	"scope_key" text,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"status" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"rationale" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_expectation_uq" UNIQUE NULLS NOT DISTINCT("source_system","dataset_family","canal","scope_key","entity_type","entity_id","effective_from"),
	CONSTRAINT "entity_expectation_origin_ck" CHECK ("entity_expectation"."origin" IN ('CONTRATO', 'CURADORIA')),
	CONSTRAINT "entity_expectation_status_ck" CHECK ("entity_expectation"."status" IN ('ESPERADA', 'BAIXA')),
	CONSTRAINT "entity_expectation_rationale_ck" CHECK (btrim("entity_expectation"."rationale") <> ''),
	CONSTRAINT "entity_expectation_actor_ck" CHECK (btrim("entity_expectation"."actor") <> '')
);
--> statement-breakpoint
ALTER TABLE "coverage_expectation" DROP CONSTRAINT IF EXISTS "coverage_expectation_origin_ck";--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'entity_expectation'
       AND c.conname = 'entity_expectation_entity_id_entity_id_fk'
  ) THEN
    ALTER TABLE "entity_expectation"
      ADD CONSTRAINT "entity_expectation_entity_id_entity_id_fk"
      FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_expectation_recorte_idx" ON "entity_expectation" USING btree ("dataset_family","entity_type","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_expectation_entity_idx" ON "entity_expectation" USING btree ("entity_id");--> statement-breakpoint
ALTER TABLE "coverage_expectation" ADD CONSTRAINT "coverage_expectation_origin_ck" CHECK ("coverage_expectation"."origin" IN ('CONTRATO', 'CATALOGO', 'CURADORIA'));