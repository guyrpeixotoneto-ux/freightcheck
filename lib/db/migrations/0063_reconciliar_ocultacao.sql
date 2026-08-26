-- Reconciliar o que a 0056–0062 criam e o bridge remove.
--
-- É o mesmo buraco da `0024`, da `0027`, da `0029`, da `0034`, da `0038`, da
-- `0041`, da `0050` e da `0052`, e ele não fecha sozinho: `bridgeDown` remove
-- objetos que as migrations criam e **não toca no registro**; `runMigrations()`
-- pula toda migration cujo carimbo já está registrado. Depois de um `down` sem
-- `up`, só o `up` devolveria aqueles objetos — a fila estruturalmente não
-- consegue, e `migrate` responderia "nada a aplicar" sobre um banco divergente.
--
-- Sete migrations passaram sem que a lista do bridge crescesse junto, e o
-- resultado foi um `down` que abortava contra chaves estrangeiras que ninguém
-- havia declarado. Ao declará-las, a fronteira do bridge cresceu — e é esta
-- migration que põe o outro lado dela no lugar, que é o que
-- `reconciliacao-bridge.test.ts` exige de toda entrada nova.
--
-- Uma migration nova, e não uma edição das anteriores, pelo motivo de sempre
-- nesta fila: a decisão de rodar é pelo carimbo, nunca pelo conteúdo.
--
-- **Só estrutura, com uma exceção declarada** — o backfill de
-- `fact.origin_import_run_id`, que não é transformação de dado do usuário e sim
-- a única forma de a coluna poder ser trancada de novo. É o mesmo caso do
-- backfill de `app_user.role` na `0038`.

-- ---------------------------------------------------------------------------
-- A `0062` — as duas medidas do progresso da leitura.
-- ---------------------------------------------------------------------------
--
-- Saem no `down` por serem `NOT NULL` com default, forma que a allowlist não
-- aceita. Voltam com o próprio default: zero é a resposta certa para uma leitura
-- que terminou antes de a medida existir.
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "progress_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "progress_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A `0060` — o índice parcial dos runs ocultos.
-- ---------------------------------------------------------------------------
--
-- As três colunas da ocultação ficam de pé no `down` (são anuláveis e sem
-- default, a forma que a allowlist aceita); só o índice sai.
CREATE INDEX IF NOT EXISTS "import_run_hidden_at_idx" ON "import_run" USING btree ("id") WHERE "hidden_at" IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A `0061` — a origem do fato, e as três views que a leem.
-- ---------------------------------------------------------------------------
--
-- A coluna volta pelo caminho da própria `0061`: nula, backfill pela cadeia
-- `raw_cell → raw_row → raw_sheet`, e só então `SET NOT NULL`. Repor a coluna
-- anulável e parar aí devolveria um schema diferente do que a fila produz.
ALTER TABLE "fact" ADD COLUMN IF NOT EXISTS "origin_import_run_id" uuid;--> statement-breakpoint

ALTER TABLE "fact" DISABLE TRIGGER "fact_immutable";--> statement-breakpoint

-- `WHERE origin_import_run_id IS NULL` é o que torna este `UPDATE` repetível
-- sobre um banco que já o atravessou — a regra de `docs/MIGRATIONS.md`.
UPDATE "fact" f
   SET "origin_import_run_id" = rs."import_run_id"
  FROM "raw_cell" rc
  JOIN "raw_row" rr ON rr."id" = rc."raw_row_id"
  JOIN "raw_sheet" rs ON rs."id" = rr."raw_sheet_id"
 WHERE rc."id" = f."raw_cell_id"
   AND f."origin_import_run_id" IS NULL;--> statement-breakpoint

ALTER TABLE "fact" ENABLE TRIGGER "fact_immutable";--> statement-breakpoint

-- Nenhum órfão, ou não se tranca. A `0061` faz a mesma conferência antes do
-- `SET NOT NULL`, e pela mesma razão: uma coluna obrigatória que só é
-- obrigatória porque ninguém olhou não prova nada.
DO $$
DECLARE
  orfaos bigint;
BEGIN
  SELECT count(*) INTO orfaos FROM "fact" WHERE "origin_import_run_id" IS NULL;
  IF orfaos > 0 THEN
    RAISE EXCEPTION
      E'% fato(s) sem origem depois do backfill.\nNada foi tornado obrigatório.',
      orfaos
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "fact" ALTER COLUMN "origin_import_run_id" SET NOT NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fact_origin_import_run_id_import_run_id_fk'
  ) THEN
    ALTER TABLE "fact"
      ADD CONSTRAINT "fact_origin_import_run_id_import_run_id_fk"
      FOREIGN KEY ("origin_import_run_id") REFERENCES "import_run"("id");
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fact_origin_import_run_idx"
  ON "fact" USING btree ("origin_import_run_id");--> statement-breakpoint

-- As três views, na ordem que o `RESTRICT` aceita: a leitora cai primeiro,
-- depois a lida; para criar, o inverso. `alteracao_visivel` lê `fato_oculto`.
DROP VIEW IF EXISTS "alteracao_visivel";--> statement-breakpoint
DROP VIEW IF EXISTS "fato_oculto";--> statement-breakpoint
DROP VIEW IF EXISTS "fato_visivel";--> statement-breakpoint

CREATE VIEW "fato_visivel" AS
  SELECT f.*
    FROM "fact" f
   WHERE f."origin_import_run_id" NOT IN (
     SELECT ir."id" FROM "import_run" ir WHERE ir."hidden_at" IS NOT NULL
   );--> statement-breakpoint

CREATE VIEW "fato_oculto" AS
  SELECT f."id"
    FROM "fact" f
    JOIN "import_run" ir ON ir."id" = f."origin_import_run_id"
   WHERE ir."hidden_at" IS NOT NULL;--> statement-breakpoint

CREATE VIEW "alteracao_visivel" AS
  SELECT c.*
    FROM "change" c
   WHERE (c."fact_a_id" IS NULL OR c."fact_a_id" NOT IN (SELECT id FROM "fato_oculto"))
     AND (c."fact_b_id" IS NULL OR c."fact_b_id" NOT IN (SELECT id FROM "fato_oculto"));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A `0056`, a `0057` e a `0058`/`0059` — as três tabelas novas.
-- ---------------------------------------------------------------------------
--
-- Entram em `TABELAS_REMOVIDAS` com pré-condição de **vazia**, e é por isso que
-- esta migration as repõe vazias: o `down` recusa descer sobre um banco que
-- tenha frota, total de pagamento ou justificativa gravados, e esta
-- reconciliação existe para o caso em que ele desceu porque não havia nada a
-- perder.
--
-- Ordem invertida em relação ao `down`: lá as filhas saem primeiro, aqui as
-- mães já existem e as FKs entram depois das tabelas.
CREATE TABLE IF NOT EXISTS "fechamento_frota_promax" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"linha_no_arquivo" integer NOT NULL,
	"situacao" text NOT NULL,
	"unidade" text NOT NULL,
	"placa" text NOT NULL,
	"modelo" text NOT NULL,
	"categoria" text,
	CONSTRAINT "fechamento_frota_promax_situacao" CHECK ("fechamento_frota_promax"."situacao" in ('ATIVA', 'INATIVA'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fechamento_pagamento_total" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"canal" text NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	CONSTRAINT "fechamento_pagamento_total_canal" CHECK ("fechamento_pagamento_total"."canal" in ('ROTA', 'AS'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "justificativa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_set_id" uuid NOT NULL,
	"entity_label" text NOT NULL,
	"entity_type" text,
	"texto" text NOT NULL,
	"criado_por" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"change_id" bigint NOT NULL
);
--> statement-breakpoint

ALTER TABLE "fechamento_frota_promax" DROP CONSTRAINT IF EXISTS "fechamento_frota_promax_documento_fk";--> statement-breakpoint
ALTER TABLE "fechamento_frota_promax" ADD CONSTRAINT "fechamento_frota_promax_documento_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."fechamento_documento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamento_frota_promax" DROP CONSTRAINT IF EXISTS "fechamento_frota_promax_competencia_fk";--> statement-breakpoint
ALTER TABLE "fechamento_frota_promax" ADD CONSTRAINT "fechamento_frota_promax_competencia_fk" FOREIGN KEY ("competencia_id") REFERENCES "public"."fechamento_competencia"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamento_pagamento_total" DROP CONSTRAINT IF EXISTS "fechamento_pagamento_total_documento_fk";--> statement-breakpoint
ALTER TABLE "fechamento_pagamento_total" ADD CONSTRAINT "fechamento_pagamento_total_documento_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."fechamento_documento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamento_pagamento_total" DROP CONSTRAINT IF EXISTS "fechamento_pagamento_total_competencia_fk";--> statement-breakpoint
ALTER TABLE "fechamento_pagamento_total" ADD CONSTRAINT "fechamento_pagamento_total_competencia_fk" FOREIGN KEY ("competencia_id") REFERENCES "public"."fechamento_competencia"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'justificativa_change_set_id_fk'
  ) THEN
    ALTER TABLE "justificativa"
      ADD CONSTRAINT "justificativa_change_set_id_fk"
      FOREIGN KEY ("change_set_id") REFERENCES "change_set"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'justificativa_change_id_fk'
  ) THEN
    ALTER TABLE "justificativa"
      ADD CONSTRAINT "justificativa_change_id_fk"
      FOREIGN KEY ("change_id") REFERENCES "change"("id") ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fechamento_frota_promax_por_competencia" ON "fechamento_frota_promax" USING btree ("competencia_id","situacao");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_frota_promax_por_documento" ON "fechamento_frota_promax" USING btree ("documento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_pagamento_total_por_competencia" ON "fechamento_pagamento_total" USING btree ("competencia_id","canal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_pagamento_total_por_documento" ON "fechamento_pagamento_total" USING btree ("documento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "justificativa_change_set_idx" ON "justificativa" USING btree ("change_set_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "justificativa_change_id_idx" ON "justificativa" USING btree ("change_id");--> statement-breakpoint

-- Os dois gatilhos de competência congelada, no molde reentrante da `0039`.
DO $reentrante$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'fechamento_frota_promax_congelada'
  ) THEN
    CREATE TRIGGER "fechamento_frota_promax_congelada"
      BEFORE INSERT OR UPDATE OR DELETE ON "fechamento_frota_promax"
      FOR EACH ROW EXECUTE FUNCTION fechamento_recusar_escrita_em_encerrada();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'fechamento_pagamento_total_congelada'
  ) THEN
    CREATE TRIGGER "fechamento_pagamento_total_congelada"
      BEFORE INSERT OR UPDATE OR DELETE ON "fechamento_pagamento_total"
      FOR EACH ROW EXECUTE FUNCTION fechamento_recusar_escrita_em_encerrada();
  END IF;
END $reentrante$;
