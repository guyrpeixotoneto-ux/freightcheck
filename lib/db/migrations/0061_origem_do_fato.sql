-- ---------------------------------------------------------------------------
-- A origem de um fato sobrevive à herança.
-- ---------------------------------------------------------------------------
--
-- `snapshot.import_run_id` é um valor só por vigência, e é o da **última**
-- revisão que a tocou. Quando uma revisão parcial herda os componentes que o
-- arquivo não toca (ver `0017`), os fatos herdados passam a viver sob o
-- `import_run_id` dessa revisão nova, embora tenham nascido em outro arquivo.
--
-- Ocultar uma importação (`0060`) filtrava por `snapshot.import_run_id`, e por
-- isso não alcançava esses fatos: o filtro perguntava quem é o dono da
-- vigência, não de onde veio o dado. O caso medido é o do produto: importa-se
-- `Empurrada_Cavalo`, depois `Empurrada_Carreta` revisa a mesma vigência e
-- herda os fatos de cavalo; ocultar `Empurrada_Cavalo` não escondia nada,
-- porque a vigência já pertencia à outra importação.
--
-- A informação nunca se perdeu — `fact.raw_cell_id` do fato herdado continua
-- apontando para a célula **original**, e a cadeia
-- `raw_cell → raw_row → raw_sheet → import_run` sempre respondeu a origem
-- verdadeira. O que faltava era ela estar ao alcance de um filtro barato: são
-- três junções sobre a maior tabela do sistema, em toda leitura de fato.
--
-- Esta migration materializa essa cadeia numa coluna. Ela não inventa dado
-- nenhum: o backfill é a própria cadeia, e a validação abaixo prova que a
-- coluna e a cadeia dizem a mesma coisa para toda linha.
ALTER TABLE "fact" ADD COLUMN IF NOT EXISTS "origin_import_run_id" uuid;--> statement-breakpoint

COMMENT ON COLUMN "fact"."origin_import_run_id" IS
  'A importação que trouxe este fato, e não a que o carregou adiante numa revisão. Materializa a cadeia raw_cell → raw_row → raw_sheet → import_run.';--> statement-breakpoint

-- O gatilho de imutabilidade sai de cena durante o backfill, e volta depois.
--
-- `fact_immutable` (`0001`) recusa UPDATE em fato de vigência que não seja
-- DRAFT — que é a esmagadora maioria, e é a proteção que faz "nunca sobrescrever
-- silenciosamente" ser estrutural. Ela não está sendo afrouxada aqui: o que este
-- UPDATE escreve é uma coluna nova, derivada da cadeia que já existia, e nenhum
-- valor de fato é tocado. Mesmo procedimento e mesma justificativa da `0016`.
ALTER TABLE "fact" DISABLE TRIGGER "fact_immutable";--> statement-breakpoint

-- O backfill, inócuo em quem já o tem.
--
-- `WHERE origin_import_run_id IS NULL` é o que torna a migration repetível
-- sobre um banco que já a atravessou — a regra de `docs/MIGRATIONS.md`: um
-- `UPDATE` de conversão roda de novo e não faz nada quando o dado já está
-- convertido.
UPDATE "fact" f
   SET "origin_import_run_id" = rs."import_run_id"
  FROM "raw_cell" rc
  JOIN "raw_row" rr ON rr."id" = rc."raw_row_id"
  JOIN "raw_sheet" rs ON rs."id" = rr."raw_sheet_id"
 WHERE rc."id" = f."raw_cell_id"
   AND f."origin_import_run_id" IS NULL;--> statement-breakpoint

ALTER TABLE "fact" ENABLE TRIGGER "fact_immutable";--> statement-breakpoint

-- A validação, antes de tornar a coluna obrigatória.
--
-- `SET NOT NULL` provaria só que ninguém ficou nulo. O que precisa ser provado
-- é mais forte: que a coluna **concorda com a cadeia** em toda linha. Uma
-- divergência aqui significaria que a materialização mente, e uma coluna que
-- mente sobre origem é pior do que não ter coluna nenhuma — o filtro de
-- ocultação passaria a esconder o fato errado, ou a deixar passar o certo.
--
-- Como em `0015`, a migration para e **nomeia as linhas** em vez de consertar
-- o que não entende.
DO $$
DECLARE
  divergentes integer;
  orfaos      integer;
  amostra     text;
BEGIN
  SELECT count(*) INTO orfaos FROM "fact" WHERE "origin_import_run_id" IS NULL;

  SELECT count(*), string_agg(x.amostra, E'\n  ')
    INTO divergentes, amostra
    FROM (
      SELECT format('fato=%s origem_gravada=%s origem_da_cadeia=%s',
                    f."id", f."origin_import_run_id", rs."import_run_id") AS amostra
        FROM "fact" f
        JOIN "raw_cell" rc ON rc."id" = f."raw_cell_id"
        JOIN "raw_row" rr ON rr."id" = rc."raw_row_id"
        JOIN "raw_sheet" rs ON rs."id" = rr."raw_sheet_id"
       WHERE f."origin_import_run_id" IS DISTINCT FROM rs."import_run_id"
       LIMIT 50
    ) x;

  IF orfaos > 0 THEN
    RAISE EXCEPTION
      E'% fato(s) ficaram sem origem depois do backfill.\n\nTodo fato aponta para uma célula (`raw_cell_id` é NOT NULL) e toda célula pertence a uma importação, então isto não deveria ser possível. Nada foi alterado além do backfill; investigue a cadeia raw_cell → raw_row → raw_sheet antes de rodar de novo.',
      orfaos
      USING ERRCODE = 'data_exception';
  END IF;

  IF divergentes > 0 THEN
    RAISE EXCEPTION
      E'A origem gravada não bate com a cadeia em % fato(s):\n  %\n\nNada foi tornado obrigatório. A coluna só vale se concordar com a cadeia em toda linha.',
      divergentes, amostra
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

-- O índice pelo caminho de leitura: o filtro de ocultação entra por ele em
-- toda consulta de fato. Não é parcial — diferente de `import_run_hidden_at_idx`
-- (`0060`), que indexa só os runs ocultos, aqui a coluna é consultada para
-- todo fato, e a seletividade útil é por run.
CREATE INDEX IF NOT EXISTS "fact_origin_import_run_idx"
  ON "fact" USING btree ("origin_import_run_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Onde a regra mora, e por que ela mora num lugar só.
-- ---------------------------------------------------------------------------
--
-- "Fato cuja origem foi ocultada não é considerado" precisa valer em toda
-- leitura de fato — são setenta e tantas, em treze pacotes. Escrever o
-- predicado em cada uma seria pedir que setenta e tantos lugares concordem
-- para sempre, e a primeira consulta nova a esquecê-lo voltaria a mostrar o
-- que foi escondido, sem nada apontando o erro.
--
-- A view é a definição única. Quem lê fato lê `fato_visivel`; quem precisa da
-- tabela inteira — a escrita, a exclusão, o balanço de massa e as ferramentas
-- de proveniência, que existem justamente para enxergar o que está oculto —
-- continua em `fact`, e a diferença fica visível no próprio texto da consulta.
--
-- **A ocultação continua sendo por importação, não por vigência.** Um snapshot
-- cujo `import_run_id` está oculto some pelo filtro de `0060`, que segue valendo
-- e não é substituído por este. O que esta view acrescenta é o caso que aquele
-- não alcança: o fato herdado, que vive num snapshot visível e nasceu num
-- arquivo oculto.
DROP VIEW IF EXISTS "fato_visivel";--> statement-breakpoint

CREATE VIEW "fato_visivel" AS
  SELECT f.*
    FROM "fact" f
   WHERE NOT EXISTS (
     SELECT 1 FROM "import_run" ir
      WHERE ir."id" = f."origin_import_run_id"
        AND ir."hidden_at" IS NOT NULL
   );--> statement-breakpoint

COMMENT ON VIEW "fato_visivel" IS
  'Os fatos que contam. Exclui os que nasceram numa importação oculta, inclusive os herdados por uma revisão posterior visível. Toda leitura de fato passa por aqui; `fact` cru é para escrita, exclusão, balanço de massa e proveniência.';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A alteração segue os fatos que ela compara.
-- ---------------------------------------------------------------------------
--
-- `change_set` é cache persistente: uma comparação viva por par de vigências,
-- calculada uma vez e relida daí em diante. Ocultar uma importação depois disso
-- não a recalcula — e não deve recalcular. Refazer um `change_set` é `DELETE` e
-- reinserção, e `justificativa` pende de `change` por `ON DELETE CASCADE`: o
-- recomputo apagaria texto escrito por pessoa. Ocultar é reversível por
-- definição, e não pode destruir nada de passagem.
--
-- Então a alteração também é filtrada na leitura, pelos fatos que ela cita. Uma
-- alteração que compara um valor que deixou de contar não descreve mais nada —
-- e volta inteira, com as justificativas intactas, quando a importação reaparece.
--
-- `fact_a_id` e `fact_b_id` são nulos nos eixos de entidade e de atributo
-- (entrou, saiu), e nulo aqui não esconde: o `NOT EXISTS` só alcança a linha que
-- existe e nasceu oculta.
DROP VIEW IF EXISTS "alteracao_visivel";--> statement-breakpoint

CREATE VIEW "alteracao_visivel" AS
  SELECT c.*
    FROM "change" c
   WHERE NOT EXISTS (
     SELECT 1
       FROM "fact" f
       JOIN "import_run" ir ON ir."id" = f."origin_import_run_id"
      WHERE f."id" IN (c."fact_a_id", c."fact_b_id")
        AND ir."hidden_at" IS NOT NULL
   );--> statement-breakpoint

COMMENT ON VIEW "alteracao_visivel" IS
  'As alterações que contam. Exclui as que citam um fato nascido em importação oculta — sem recalcular nem apagar o `change_set` gravado, que volta inteiro quando a importação reaparece.';
