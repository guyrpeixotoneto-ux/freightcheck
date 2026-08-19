-- Reconciliar o que a 0037 cria e o bridge remove.
--
-- O mesmo buraco da `0024`, `0027`, `0029` e `0034`: `bridgeDown` remove
-- objetos que as migrations criam sem tocar no registro, e a fila pula toda
-- migration já registrada — depois de um `down` sem `up`, só esta migration
-- devolve a coluna. Ver o cabeçalho da `0034`.
--
-- Os comandos são os da `0037`, byte a byte — inclusive o backfill pela
-- sentinela: `app_user.role` é decisão de gente, e um Development que passou
-- por down sem up precisa voltar ao estado pós-migration (contas pré-papel
-- viram ADMIN), nunca ficar sem papel ou com todo mundo OPERADOR.

ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'OPERADOR' NOT NULL;--> statement-breakpoint

UPDATE "app_user"
   SET "role" = 'ADMIN'
 WHERE "role" = 'OPERADOR'
   AND NOT EXISTS (SELECT 1 FROM "app_user" WHERE "role" = 'ADMIN');--> statement-breakpoint

ALTER TABLE "app_user" DROP CONSTRAINT IF EXISTS "app_user_role_ck";--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_role_ck" CHECK ("role" IN ('ADMIN', 'OPERADOR'));
