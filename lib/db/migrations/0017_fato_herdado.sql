-- ---------------------------------------------------------------------------
-- Um fato que veio da revisão anterior, e não deste arquivo.
-- ---------------------------------------------------------------------------
--
-- Quando um arquivo parcial corrige uma vigência — só os cavalos, digamos —, a
-- revisão nova precisa carregar junto os componentes que ele não toca, senão as
-- carretas daquela vigência desapareceriam. Esses fatos são legítimos e são
-- parte do snapshot, mas **não nasceram deste arquivo**.
--
-- Sem essa distinção, o balanço de massa passa a contar como "promovido por
-- esta importação" um fato cuja célula de origem está em outra, e a invariante
-- "uma célula, um fato" deixa de fechar — não porque algo se perdeu, mas porque
-- a conta somava duas coisas diferentes. A coluna é o que permite somar cada
-- uma no lugar certo.
--
-- Nulo é o caso normal: o fato veio da célula que `raw_cell_id` aponta.
--
-- A conferência antes da criação é a mesma da `0014` e da `0015`, e existe pelo
-- mesmo motivo: esta coluna está no diff que o Publishing calcula comparando
-- Development com Production, e portanto pode chegar aqui criada por fora. Se
-- vier com outro tipo, `ADD COLUMN IF NOT EXISTS` a aceita em silêncio — ele
-- confere o nome, não a definição — e o erro só apareceria adiante, no índice
-- ou numa junção que não casa. Era a única coluna do schema sem esta guarda.
DO $$
DECLARE
  achado text;
BEGIN
  SELECT format('fact.inherited_from_snapshot_id é %s, esperado uuid', c.data_type)
    INTO achado
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'fact'
     AND c.column_name = 'inherited_from_snapshot_id'
     AND c.data_type <> 'uuid';

  IF achado IS NOT NULL THEN
    RAISE EXCEPTION
      E'%\n\nA coluna já existe com outro tipo, e esta migration não converte tipo de coluna que já tem dado. Confira de onde ela veio e alinhe-a. Nada foi alterado.',
      achado
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "fact" ADD COLUMN IF NOT EXISTS "inherited_from_snapshot_id" uuid;--> statement-breakpoint

COMMENT ON COLUMN "fact"."inherited_from_snapshot_id" IS
  'A revisão de onde este fato foi herdado, quando ele não nasceu do arquivo desta importação. Nulo no caso normal.';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fact_inherited_idx" ON "fact" USING btree ("inherited_from_snapshot_id")
  WHERE "inherited_from_snapshot_id" IS NOT NULL;
