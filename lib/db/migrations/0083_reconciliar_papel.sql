-- ---------------------------------------------------------------------------
-- Reconciliar o que a 0082 cria e o bridge remove.
-- ---------------------------------------------------------------------------
--
-- É o mesmo buraco da `0024`, da `0038`, da `0074` e das outras oito, e ele não
-- fecha sozinho: `bridgeDown` remove objetos que as migrations criam e **não
-- toca no registro**; `runMigrations()` pula toda migration cujo carimbo já
-- está registrado. Depois de um `down` sem `up`, só o `up` devolveria aqueles
-- objetos — a fila estruturalmente não consegue, e `migrate` responderia "nada
-- a aplicar" sobre um banco divergente.
--
-- Por isso a reconciliação é sempre **a última da fila**. A `0082` é o caso
-- novo: duas tabelas em `TABELAS_REMOVIDAS`, uma em `TABELAS_DERIVADAS` e uma
-- coluna em `COLUNAS_REMOVIDAS`, todas criadas depois da `0075`.
--
-- O que passou a sair no `down`, e por quê:
--
--   * `papel_permissao` e `papel_evento` (0082) — cadastro novo, que Production
--     não conhece até a fila rodar lá;
--   * `papel` (0082) — a mesma coisa, e ela nasce cheia: os dois papéis do
--     sistema são um `INSERT` da própria migration, e voltam aqui como voltam
--     no `up`;
--   * `app_user.papel_id` (0082) — a FK de uma tabela que **sobrevive** ao
--     `down` para uma que não sobrevive. Sai antes da tabela, e é o `RESTRICT`
--     que impõe essa ordem.
--
-- **Esta reconciliação repõe dado, e é uma exceção declarada.** As outras
-- devolvem estrutura vazia porque o `down` exige as tabelas vazias antes de
-- derrubá-las; aqui os dois papéis do sistema não são dado de ninguém — são o
-- catálogo que a `0082` semeia —, e sem eles `app_user.papel_id` voltaria nula
-- para todo mundo. Uma conta sem papel é uma conta cujo acesso não se lê, e é
-- exatamente o estado que nenhuma reconciliação pode deixar para trás. O
-- vínculo é reposto a partir de `role`, que não sai no `down`.
--
-- O que **não** volta: os papéis cadastrados na tela e as permissões deles. O
-- `down` recusa correr com qualquer um deles no banco (pré-condição "nenhum
-- papel cadastrado na tela"), então não há o que repor.
--
-- Num banco íntegro esta migration é um não-evento: cada comando é idempotente
-- por construção, e os dois `UPDATE` só tocam em quem está com `papel_id` nula.
--
-- A ordem é mãe antes de filha — o inverso do `down` —, e a coluna de
-- `app_user` só depois de `papel` existir de novo e estar semeada.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "papel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"gerencia_contas" boolean DEFAULT false NOT NULL,
	"sistema" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_por" text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "papel_nome_key" ON "papel" USING btree (lower("nome"));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "papel_permissao" (
	"papel_id" uuid NOT NULL,
	"chave" text NOT NULL,
	"nivel" text NOT NULL,
	"definido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"definido_por" text NOT NULL,
	CONSTRAINT "papel_permissao_papel_id_chave_pk" PRIMARY KEY("papel_id","chave"),
	CONSTRAINT "papel_permissao_nivel_check" CHECK ("nivel" IN ('EDITAR', 'VISUALIZAR', 'SEM_ACESSO'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "papel_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"papel_id" uuid NOT NULL,
	"chave" text,
	"tipo" text NOT NULL,
	"nivel_anterior" text,
	"nivel" text,
	"detalhe" text,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"por" text NOT NULL,
	CONSTRAINT "papel_evento_tipo_check" CHECK ("tipo" IN ('CRIADO', 'RENOMEADO', 'ADMINISTRACAO', 'PERMISSAO'))
);--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'papel_permissao_papel_id_papel_id_fk') THEN
		ALTER TABLE "papel_permissao" ADD CONSTRAINT "papel_permissao_papel_id_papel_id_fk"
			FOREIGN KEY ("papel_id") REFERENCES "public"."papel"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'papel_evento_papel_id_papel_id_fk') THEN
		ALTER TABLE "papel_evento" ADD CONSTRAINT "papel_evento_papel_id_papel_id_fk"
			FOREIGN KEY ("papel_id") REFERENCES "public"."papel"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "papel_permissao_papel_idx" ON "papel_permissao" USING btree ("papel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "papel_evento_papel_idx" ON "papel_evento" USING btree ("papel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "papel_evento_em_idx" ON "papel_evento" USING btree ("em");--> statement-breakpoint
INSERT INTO "papel" ("nome", "descricao", "gerencia_contas", "sistema")
VALUES
	('Operador', 'Usa o produto: audita, confere e fecha. Não gerencia contas.', false, true),
	('Administrador', 'Usa o produto e gerencia contas: cria, desativa, redefine senha e muda papel.', true, true)
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "papel_id" uuid;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_papel_id_papel_id_fk') THEN
		ALTER TABLE "app_user" ADD CONSTRAINT "app_user_papel_id_papel_id_fk"
			FOREIGN KEY ("papel_id") REFERENCES "public"."papel"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_user_papel_idx" ON "app_user" USING btree ("papel_id");--> statement-breakpoint
UPDATE "app_user" SET "papel_id" = (SELECT "id" FROM "papel" WHERE lower("nome") = 'administrador')
WHERE "papel_id" IS NULL AND "role" = 'ADMIN';--> statement-breakpoint
UPDATE "app_user" SET "papel_id" = (SELECT "id" FROM "papel" WHERE lower("nome") = 'operador')
WHERE "papel_id" IS NULL;
