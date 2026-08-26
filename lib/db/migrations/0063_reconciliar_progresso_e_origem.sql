-- Reconciliar o que a 0060, a 0061 e a 0062 criam e o bridge remove.
--
-- É o mesmo buraco da `0024`, da `0027`, da `0029`, da `0034`, da `0038`, da
-- `0041`, da `0050` e da `0052`, e ele não fecha sozinho: `bridgeDown` remove
-- objetos que as migrations criam e **não toca no registro**;
-- `runMigrations()` pula toda migration cujo carimbo já está registrado. Depois
-- de um `down` sem `up`, só o `up` devolveria aqueles objetos — a fila
-- estruturalmente não consegue, e `migrate` responderia "nada a aplicar" sobre
-- um banco divergente.
--
-- O que passou a sair no `down`, e por quê:
--
--   * `fact.origin_import_run_id` (0061) — `NOT NULL`, forma que a allowlist do
--     bridge não aceita. Com ela saem as três views que a leem.
--   * as três de `import_run` que medem o progresso da leitura (0062) — duas
--     são `NOT NULL DEFAULT 0`, e a terceira sai junto porque as três são um
--     valor só: a etapa sem o tamanho descreveria um andamento que ninguém
--     mediu.
--   * o índice parcial `import_run_hidden_at_idx` (0060) — as **colunas** de
--     ocultar ficam (são nuláveis e sem default, e entram na allowlist), mas o
--     índice não, porque o Publishing o proporia.
--
-- Uma migration nova, e não uma edição da `0052`, pelo motivo de sempre nesta
-- fila: a `0052` já está registrada em todo banco que a aplicou, e reescrevê-la
-- não a faz rodar de novo em nenhum deles — a decisão de rodar é pelo carimbo,
-- nunca pelo conteúdo.
--
-- Num banco íntegro esta migration é um não-evento: cada comando é idempotente
-- por construção, o backfill não encontra linha para converter e as views são
-- recriadas idênticas.

-- ---------------------------------------------------------------------------
-- 1. As três do progresso da leitura, da `0062`.
-- ---------------------------------------------------------------------------
--
-- `DEFAULT 0` com `NOT NULL` sobre tabela com dado dentro é barato desde o
-- Postgres 11 (nenhuma reescrita), e zero é a verdade sobre uma leitura que
-- não está acontecendo: nenhum trecho medido, nada percorrido.
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "progress_step" text;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "progress_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "progress_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. O índice parcial da ocultação, da `0060`.
-- ---------------------------------------------------------------------------
--
-- Ele é lido pelas views abaixo em toda leitura de fato — o conjunto das
-- importações ocultas, que quase sempre é vazio e nunca é grande.
CREATE INDEX IF NOT EXISTS "import_run_hidden_at_idx"
  ON "import_run" USING btree ("id")
  WHERE "hidden_at" IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. A origem do fato, da `0061` — com o mesmo backfill e a mesma conferência.
-- ---------------------------------------------------------------------------
--
-- Repô-la nulável seria repor outra coisa. A coluna é obrigatória porque todo
-- fato tem origem — `raw_cell_id` é NOT NULL e toda célula pertence a uma
-- importação —, e é essa garantia que faz o `NOT IN` das views não precisar
-- lidar com nulo. Um `ADD COLUMN` mais fraco trocaria uma coluna ausente por
-- uma coluna presente e errada, que é o que a `0023` já ensinou a não fazer.
ALTER TABLE "fact" ADD COLUMN IF NOT EXISTS "origin_import_run_id" uuid;--> statement-breakpoint

-- O gatilho de imutabilidade sai de cena durante o backfill e volta depois —
-- mesmo procedimento e mesma justificativa da `0061`: o que este UPDATE escreve
-- é uma coluna derivada da cadeia que já existia, e nenhum valor de fato é
-- tocado. A guarda existe porque este comando roda em bancos de qualquer
-- procedência, inclusive um que o bridge tenha deixado sem o gatilho.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'fact' AND t.tgname = 'fact_immutable'
  ) THEN
    ALTER TABLE "fact" DISABLE TRIGGER "fact_immutable";
  END IF;
END $$;--> statement-breakpoint

-- `WHERE origin_import_run_id IS NULL` é o que torna isto repetível: num banco
-- que já tem a coluna preenchida, o comando não encontra linha nenhuma.
UPDATE "fact" f
   SET "origin_import_run_id" = rs."import_run_id"
  FROM "raw_cell" rc
  JOIN "raw_row" rr ON rr."id" = rc."raw_row_id"
  JOIN "raw_sheet" rs ON rs."id" = rr."raw_sheet_id"
 WHERE rc."id" = f."raw_cell_id"
   AND f."origin_import_run_id" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'fact' AND t.tgname = 'fact_immutable'
  ) THEN
    ALTER TABLE "fact" ENABLE TRIGGER "fact_immutable";
  END IF;
END $$;--> statement-breakpoint

-- A mesma validação da `0061`, antes de tornar a coluna obrigatória: `SET NOT
-- NULL` provaria só que ninguém ficou nulo, e o que precisa ser provado é que a
-- coluna **concorda com a cadeia** em toda linha. Uma coluna que mente sobre
-- origem é pior do que não ter coluna nenhuma — o filtro de ocultação passaria
-- a esconder o fato errado.
DO $$
DECLARE
  divergentes integer;
  orfaos      integer;
BEGIN
  SELECT count(*) INTO orfaos FROM "fact" WHERE "origin_import_run_id" IS NULL;

  SELECT count(*) INTO divergentes
    FROM "fact" f
    JOIN "raw_cell" rc ON rc."id" = f."raw_cell_id"
    JOIN "raw_row" rr ON rr."id" = rc."raw_row_id"
    JOIN "raw_sheet" rs ON rs."id" = rr."raw_sheet_id"
   WHERE f."origin_import_run_id" IS DISTINCT FROM rs."import_run_id";

  IF orfaos > 0 THEN
    RAISE EXCEPTION
      E'% fato(s) ficaram sem origem depois do backfill da reconciliação.\n\nTodo fato aponta para uma célula (`raw_cell_id` é NOT NULL) e toda célula pertence a uma importação, então isto não deveria ser possível. Nada foi tornado obrigatório; investigue a cadeia raw_cell → raw_row → raw_sheet antes de rodar de novo.',
      orfaos
      USING ERRCODE = 'data_exception';
  END IF;

  IF divergentes > 0 THEN
    RAISE EXCEPTION
      E'A origem gravada não bate com a cadeia em % fato(s). Nada foi tornado obrigatório: a coluna só vale se concordar com a cadeia em toda linha.',
      divergentes
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

-- ---------------------------------------------------------------------------
-- 4. As três views, que caem junto com a coluna que elas leem.
-- ---------------------------------------------------------------------------
--
-- Elas não estão em `COLUNAS_REMOVIDAS` nem em índice nenhum, e é por isso que
-- precisam estar aqui: sem `fato_visivel` de pé, toda leitura de fato do
-- produto para — são setenta e tantas consultas em treze pacotes. Um banco que
-- passou por `down` sem `up` ficaria com o schema completo e o produto morto.
--
-- Os `DROP` vêm todos antes dos `CREATE`, e nesta ordem: `alteracao_visivel` lê
-- `fato_oculto`, então cai primeiro. É a mesma dependência que o `RESTRICT` do
-- bridge cobra.
DROP VIEW IF EXISTS "alteracao_visivel";--> statement-breakpoint
DROP VIEW IF EXISTS "fato_oculto";--> statement-breakpoint
DROP VIEW IF EXISTS "fato_visivel";--> statement-breakpoint

CREATE VIEW "fato_visivel" AS
  SELECT f.*
    FROM "fact" f
   WHERE f."origin_import_run_id" NOT IN (
     SELECT ir."id" FROM "import_run" ir WHERE ir."hidden_at" IS NOT NULL
   );--> statement-breakpoint

COMMENT ON VIEW "fato_visivel" IS
  'Os fatos que contam. Exclui os que nasceram numa importação oculta, inclusive os herdados por uma revisão posterior visível. Toda leitura de fato passa por aqui; `fact` cru é para escrita, exclusão, balanço de massa e proveniência.';--> statement-breakpoint

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

COMMENT ON VIEW "alteracao_visivel" IS
  'As alterações que contam. Exclui as que citam um fato nascido em importação oculta — sem recalcular nem apagar o `change_set` gravado, que volta inteiro quando a importação reaparece.';
