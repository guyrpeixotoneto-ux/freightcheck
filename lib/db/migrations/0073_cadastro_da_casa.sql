-- ---------------------------------------------------------------------------
-- O CADASTRO DA CASA — departamento, cargo e negócio como cadastro próprio.
-- ---------------------------------------------------------------------------
--
-- As três telas viviam em `pages/telas-em-preparo.ts` dizendo a mesma frase: o
-- nome é o que a célula disser, e duas grafias do mesmo nome são duas coisas
-- para o motor. `nome_canonico` é a resposta — sem acento, sem caixa e sem
-- espaço dobrado, com índice único —, e `nome` guarda a grafia que a pessoa
-- escolheu. O porquê de cada decisão está em `lib/db/src/schema/cadastro.ts`.
--
-- As três tabelas nascem vazias e nenhuma importação as popula: um export que
-- traz `Motorista` numa célula é evidência de que alguém escreveu isso, não de
-- que o cargo existe na casa. É o mesmo desenho da unidade canônica.
--
-- `app_user.cargo_id` e `app_user.unidade_id` são a lotação de uma conta, por
-- referência e não por texto. Nulas em toda conta que já existe, e é o certo: a
-- pessoa entra no produto antes de alguém dizer o que ela faz e onde, e a lista
-- de Usuários a mostra num grupo "Sem cargo" em vez de a esconder. Nenhum
-- backfill adivinha cargo a partir de nome de e-mail ou de planilha — seria o
-- mesmo palpite que este cadastro existe para acabar.
--
-- `ON DELETE RESTRICT` em todas as referências: apagar um cargo com gente
-- lotada nele, ou um departamento com filhos, deixaria linha apontando para o
-- que não existe. Quem quiser apagar move o que está pendurado antes, e a rota
-- recusa antes do banco, com o número na frase.
--
-- Reentrante como as anteriores: cada objeto é primeiro procurado, e a
-- migration pode rodar duas vezes sobre o mesmo banco sem falhar. É também o
-- que permite ao `up` do bridge levantar estes mesmos statements do disco em
-- vez de reescrevê-los (ver `lib/db/src/bridge.ts`).
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
