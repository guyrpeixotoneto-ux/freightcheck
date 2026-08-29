-- ---------------------------------------------------------------------------
-- Reconciliar o que a 0073 cria e o bridge remove.
-- ---------------------------------------------------------------------------
--
-- É o mesmo buraco da `0024`, da `0027`, da `0029`, da `0034`, da `0038`, da
-- `0041`, da `0050`, da `0052`, da `0063` e da `0066`, e ele não fecha sozinho:
-- `bridgeDown` remove objetos que as migrations criam e **não toca no
-- registro**; `runMigrations()` pula toda migration cujo carimbo já está
-- registrado. Depois de um `down` sem `up`, só o `up` devolveria aqueles
-- objetos — a fila estruturalmente não consegue, e `migrate` responderia "nada
-- a aplicar" sobre um banco divergente.
--
-- Por isso a reconciliação é sempre **a última da fila**, e por isso toda
-- migration que crie objeto removido pelo `down` depois dela abre um buraco
-- novo. A `0073` é exatamente esse caso: três tabelas em `TABELAS_REMOVIDAS` e
-- duas colunas em `COLUNAS_REMOVIDAS`, criadas depois da `0066`.
--
-- O que passou a sair no `down`, e por quê:
--
--   * `cargo`, `departamento` e `negocio` (0073) — módulo novo, que Production
--     não conhece até a fila rodar lá; até então toda tabela dele é uma que a
--     proposta do Publishing proporia criar;
--   * `app_user.cargo_id` e `app_user.unidade_id` (0073) — as FKs de uma tabela
--     que **sobrevive** ao `down` para duas que não sobrevivem. Elas têm de sair
--     antes das tabelas, e é o `RESTRICT` que impõe essa ordem.
--
-- Uma migration nova, e não uma edição da `0073`, pelo motivo de sempre nesta
-- fila: a `0073` já está registrada em todo banco que a aplicou, e reescrevê-la
-- não a faz rodar de novo em nenhum deles — a decisão de rodar é pelo carimbo,
-- nunca pelo conteúdo.
--
-- Num banco íntegro esta migration é um não-evento: cada comando é idempotente
-- por construção. Ela **não** repõe dado: as tabelas voltam vazias, como o
-- `down` as exige antes de derrubá-las, e as duas colunas voltam nulas. O que
-- se perde num `down` sem `up` é o vínculo de lotação, refeito na tela de
-- Usuários, que é um ato explícito.
--
-- A ordem é mãe antes de filha — o inverso do `down` —, e as colunas de
-- `app_user` só depois de `cargo` existir de novo.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. As três tabelas do cadastro, na definição da `0073`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "departamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"nome_canonico" text NOT NULL,
	"pai_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_por" text,
	CONSTRAINT "departamento_nome_canonico_nao_vazio" CHECK (length("departamento"."nome_canonico") > 0)
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'departamento_pai_id_departamento_id_fk'
	) THEN
		ALTER TABLE "departamento" ADD CONSTRAINT "departamento_pai_id_departamento_id_fk"
			FOREIGN KEY ("pai_id") REFERENCES "public"."departamento"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "departamento_nome_canonico_uq" ON "departamento" USING btree ("nome_canonico");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "departamento_pai_idx" ON "departamento" USING btree ("pai_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cargo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"nome_canonico" text NOT NULL,
	"departamento_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_por" text,
	CONSTRAINT "cargo_nome_canonico_nao_vazio" CHECK (length("cargo"."nome_canonico") > 0)
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'cargo_departamento_id_departamento_id_fk'
	) THEN
		ALTER TABLE "cargo" ADD CONSTRAINT "cargo_departamento_id_departamento_id_fk"
			FOREIGN KEY ("departamento_id") REFERENCES "public"."departamento"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cargo_nome_canonico_uq" ON "cargo" USING btree ("nome_canonico");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cargo_departamento_idx" ON "cargo" USING btree ("departamento_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "negocio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"nome_canonico" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_por" text,
	CONSTRAINT "negocio_nome_canonico_nao_vazio" CHECK (length("negocio"."nome_canonico") > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "negocio_nome_canonico_uq" ON "negocio" USING btree ("nome_canonico");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. A lotação da conta — as duas colunas, as duas FKs e os dois índices.
-- ---------------------------------------------------------------------------
--
-- `unidade` não é reposta aqui: ela é da `0049` e a `0050` já a reconcilia. O
-- que falta é apenas a FK que sai desta tabela para lá.
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "cargo_id" uuid;
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "unidade_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'app_user_cargo_id_cargo_id_fk'
	) THEN
		ALTER TABLE "app_user" ADD CONSTRAINT "app_user_cargo_id_cargo_id_fk"
			FOREIGN KEY ("cargo_id") REFERENCES "public"."cargo"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'app_user_unidade_id_unidade_id_fk'
	) THEN
		ALTER TABLE "app_user" ADD CONSTRAINT "app_user_unidade_id_unidade_id_fk"
			FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_user_cargo_idx" ON "app_user" USING btree ("cargo_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_user_unidade_idx" ON "app_user" USING btree ("unidade_id");
