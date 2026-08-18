-- Papéis mínimos: ADMIN gerencia contas, OPERADOR audita.
--
-- A ausência de papéis deixava qualquer conta redefinir a senha de qualquer
-- outra — tomada de conta a um clique, num produto cujo valor é o "quem fez".
-- Dois papéis bastam para fechar isso; hierarquia por tela continua não
-- existindo, e a tela diz o que cada papel pode.
--
-- **A coluna nasce na forma final, num comando só, de propósito.** A
-- reconvergência da partida repõe coluna ausente pelo `ADD COLUMN` da fila,
-- verbatim — um ADD nullable seguido de ALTERs deixaria o reparo repor uma
-- coluna sem NOT NULL e sem default, silenciosamente diferente da original.
-- O default é OPERADOR (fail-closed: um INSERT que esqueça o papel não
-- fabrica um administrador), e no Postgres o ADD com default não reescreve a
-- tabela.

ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'OPERADOR' NOT NULL;--> statement-breakpoint

-- O backfill: as contas anteriores ao papel viram ADMIN — era o que todas já
-- podiam, e rebaixar alguém é decisão de administrador, não efeito colateral
-- de migration. A sentinela é "não existe nenhum ADMIN": é o que distingue a
-- primeira passada (contas pré-papel, nenhum ADMIN ainda) de uma reaplicação
-- sobre banco completo (sempre há ADMIN — a guarda do último admin impede o
-- estado sem nenhum), onde promover operadores seria escalada por rerun.
UPDATE "app_user"
   SET "role" = 'ADMIN'
 WHERE "role" = 'OPERADOR'
   AND NOT EXISTS (SELECT 1 FROM "app_user" WHERE "role" = 'ADMIN');--> statement-breakpoint

-- O CHECK no padrão da 0023: DROP IF EXISTS + ADD é o par reentrante que a
-- reconvergência consegue levantar inteiro.
ALTER TABLE "app_user" DROP CONSTRAINT IF EXISTS "app_user_role_ck";--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_role_ck" CHECK ("role" IN ('ADMIN', 'OPERADOR'));--> statement-breakpoint

COMMENT ON COLUMN "app_user"."role" IS
  'ADMIN gerencia contas (criar, desativar, redefinir senha, mudar papel); OPERADOR usa o produto. Backfill: contas pré-0037 viram ADMIN.';
