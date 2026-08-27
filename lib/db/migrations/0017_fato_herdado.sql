-- ---------------------------------------------------------------------------
-- Um fato que veio da revisão anterior, e não deste arquivo.
-- ---------------------------------------------------------------------------
--
-- Quando um arquivo parcial corrige uma vigência — só os cavalos, digamos —, a
-- revisão nova precisa carregar junto os componentes que ele não toca, senão as
-- carretas daquela vigência desapareceriam. Esses fatos são legítimos e são
-- parte do snapshot, mas **não nasceram deste arquivo**.
--
-- Sem essa distinção, o Rastreio de Dados passa a contar como "promovido por
-- esta importação" um fato cuja célula de origem está em outra, e a invariante
-- "uma célula, um fato" deixa de fechar — não porque algo se perdeu, mas porque
-- a conta somava duas coisas diferentes. A coluna é o que permite somar cada
-- uma no lugar certo.
--
-- Nulo é o caso normal: o fato veio da célula que `raw_cell_id` aponta.
ALTER TABLE "fact" ADD COLUMN IF NOT EXISTS "inherited_from_snapshot_id" uuid;--> statement-breakpoint

COMMENT ON COLUMN "fact"."inherited_from_snapshot_id" IS
  'A revisão de onde este fato foi herdado, quando ele não nasceu do arquivo desta importação. Nulo no caso normal.';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fact_inherited_idx" ON "fact" USING btree ("inherited_from_snapshot_id")
  WHERE "inherited_from_snapshot_id" IS NOT NULL;
