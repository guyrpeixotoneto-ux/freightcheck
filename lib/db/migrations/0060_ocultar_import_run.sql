-- Ocultar um import_run inteiro dos agregados, sem apagar nada.
--
-- Diferente de `import_deletion` (0010), isto é reversível: o usuário
-- importou os dados de um arquivo (ex.: Cavalo), quer trabalhar agora em
-- outro (Carreta) sem ver os fatos do primeiro em nenhuma tela — dashboard,
-- comparativo, cobertura, DRE — e depois voltar a mostrá-los.
--
-- Não pode viver em `snapshot`: uma vez CLOSED, o trigger
-- `snapshot_immutable` só permite a transição para SUPERSEDED, então
-- qualquer outra coluna nova em `snapshot` seria imutável e inútil aqui. Fica
-- em `import_run`, que não tem essa trava, e cada consulta de agregado passa
-- a excluir os fatos cujo `import_run_id` aponta para um run oculto.
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "hidden_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "hidden_by" text;
--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "hidden_reason" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_run_hidden_at_idx" ON "import_run" USING btree ("id") WHERE "hidden_at" IS NOT NULL;
