-- ---------------------------------------------------------------------------
-- Permissão por módulo — o que cada pessoa alcança, e quem decidiu isso.
-- ---------------------------------------------------------------------------
--
-- Duas tabelas novas e **nenhuma alteração em nada que já existe**. A única
-- referência para fora é `app_user(id)`, nas duas.
--
-- O porquê de cada decisão está em `lib/db/src/schema/permissao.ts`, por
-- extenso. A que importa para quem lê uma migration: **a tabela é esparsa e o
-- vazio concede**. Nenhuma linha é criada aqui, e nenhuma conta perde acesso ao
-- aplicar isto — a ausência de linha continua valendo o que valia antes desta
-- migration existir, que é edição em tudo. Permissão neste produto é o que se
-- tira, uma decisão de cada vez, com autor e carimbo.
--
-- Reentrância como nas anteriores: cada objeto é primeiro procurado, e a
-- migration pode rodar duas vezes sobre o mesmo banco sem falhar.

CREATE TABLE IF NOT EXISTS "permissao_de_modulo" (
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "modulo" text NOT NULL,
  "nivel" text NOT NULL,
  "definido_em" timestamp with time zone NOT NULL DEFAULT now(),
  "definido_por" text NOT NULL,
  CONSTRAINT "permissao_de_modulo_pk" PRIMARY KEY ("user_id", "modulo"),
  CONSTRAINT "permissao_de_modulo_nivel_check"
    CHECK ("nivel" IN ('EDITAR', 'VISUALIZAR', 'SEM_ACESSO'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permissao_de_modulo_user_idx"
  ON "permissao_de_modulo" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissao_de_modulo_evento" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "modulo" text NOT NULL,
  "nivel_anterior" text,
  "nivel" text NOT NULL,
  "em" timestamp with time zone NOT NULL DEFAULT now(),
  "por" text NOT NULL,
  CONSTRAINT "permissao_de_modulo_evento_nivel_check"
    CHECK ("nivel" IN ('EDITAR', 'VISUALIZAR', 'SEM_ACESSO'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permissao_de_modulo_evento_user_idx"
  ON "permissao_de_modulo_evento" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permissao_de_modulo_evento_em_idx"
  ON "permissao_de_modulo_evento" ("em");
