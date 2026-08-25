-- Plano de Ação — Justificativas: por que o gestor deixou registrado que uma
-- placa mudou daquele jeito de uma vigência para a outra.
--
-- Uma linha por justificativa, não por placa: justificar de novo a mesma
-- placa na mesma comparação grava uma linha nova em vez de sobrescrever a
-- anterior, para que o histórico de quem disse o quê, e quando, não se perca.
-- A tela lê sempre a mais recente por placa.
--
-- Reaplicável de propósito: `IF NOT EXISTS` na tabela e nos índices, para que
-- reexecutar este arquivo não falhe se o registro de migrations se perder.
CREATE TABLE IF NOT EXISTS "justificativa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_set_id" uuid NOT NULL,
	"entity_label" text NOT NULL,
	"entity_type" text,
	"texto" text NOT NULL,
	"criado_por" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'justificativa_change_set_id_fk'
  ) THEN
    ALTER TABLE "justificativa"
      ADD CONSTRAINT "justificativa_change_set_id_fk"
      FOREIGN KEY ("change_set_id") REFERENCES "change_set"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "justificativa_change_set_idx" ON "justificativa" USING btree ("change_set_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "justificativa_entity_label_idx" ON "justificativa" USING btree ("entity_label");
