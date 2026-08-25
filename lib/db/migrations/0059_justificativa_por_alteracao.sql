-- Plano de Ação — Justificativas passa a ser por alteração, não por placa.
--
-- A `0058` chaveava a justificativa em `entity_label`: uma placa com três
-- alterações na mesma comparação só podia receber um texto "guarda-chuva"
-- cobrindo as três. Isso não dá pro gestor justificar cada mudança pelo que
-- ela é — só pela placa em que aconteceu. `change_id` é a chave de verdade
-- agora; `entity_label`/`entity_type` continuam denormalizados (copiados de
-- `change` no insert) para a tela listar sem join, do mesmo jeito que
-- `change` já denormaliza os dela a partir de `entity`.
--
-- Sem backfill: uma justificativa antiga não sabe a qual alteração dentro da
-- placa ela se referia — quando a placa tinha mais de uma —, e inventar essa
-- ligação seria pior que perder a linha. A feature acabou de subir (`0058`
-- é a migration anterior) e ainda não tem uso em produção para preservar;
-- apagar aqui é limpeza de uma tabela nova, não descarte de histórico real.
--
-- Reentrante como as demais.
DELETE FROM "justificativa";
--> statement-breakpoint
ALTER TABLE "justificativa" ADD COLUMN IF NOT EXISTS "change_id" bigint;
--> statement-breakpoint
ALTER TABLE "justificativa" ALTER COLUMN "change_id" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'justificativa_change_id_fk'
  ) THEN
    ALTER TABLE "justificativa"
      ADD CONSTRAINT "justificativa_change_id_fk"
      FOREIGN KEY ("change_id") REFERENCES "change"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "justificativa_entity_label_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "justificativa_change_id_idx" ON "justificativa" USING btree ("change_id");
