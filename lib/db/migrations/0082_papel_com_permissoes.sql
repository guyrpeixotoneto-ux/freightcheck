-- ---------------------------------------------------------------------------
-- PAPEL — o acesso deixa de ser cadastrado conta a conta.
-- ---------------------------------------------------------------------------
--
-- Até aqui havia dois papéis, escritos no código como texto em
-- `app_user.role`: ADMIN e OPERADOR. Eles respondem uma pergunta — quem
-- gerencia contas — e nenhuma outra. O que a pessoa alcança, módulo a módulo,
-- é a tabela `permissao_de_modulo` (`0074`), e ela é **por pessoa**: criar a
-- décima conta de conferente é repetir trinta decisões e errar uma em
-- silêncio, porque não há com o que comparar.
--
-- Esta migration transforma o papel em cadastro: uma tabela de papéis, cada um
-- com a sua lista de restrições, e uma coluna em `app_user` apontando para ele.
--
-- ---------------------------------------------------------------------------
-- Vínculo, e não carimbo
-- ---------------------------------------------------------------------------
--
-- A conta aponta para o papel; ela não copia os valores dele. Mudar o papel
-- muda o acesso de todo mundo que o usa, na mesma hora. Um modelo que copiasse
-- na criação envelheceria calado: no dia em que a Curadoria saísse do alcance
-- dos conferentes, alguém teria de abrir as dez contas — e a décima primeira,
-- criada na semana seguinte, nasceria com o acesso antigo.
--
-- A leitura fica com duas camadas, nesta ordem:
--
--   1. a exceção da pessoa (`permissao_de_modulo`), quando existe;
--   2. o papel dela (`papel_permissao`), quando existe;
--   3. EDITAR — o padrão que concede, o mesmo de sempre.
--
-- A exceção vence o papel porque ela é a decisão mais recente e mais informada:
-- quem abre Permissões e mexe num módulo de alguém está decidindo o caso
-- daquela pessoa, sabendo do papel. O contrário faria a tela de Permissões
-- mostrar uma decisão que não vale.
--
-- ---------------------------------------------------------------------------
-- Por que `app_user.role` continua existindo
-- ---------------------------------------------------------------------------
--
-- Porque ele é lido em dezenas de pontos do servidor — `somenteAdmin`, a guarda
-- do último administrador, a recusa de tirar Configurações de quem administra —
-- e trocar todos por uma junção nova seria trocar o portão do produto inteiro
-- numa migration de cadastro. Ele passa a ser **derivado**: quem troca o papel
-- de uma conta, e quem troca o `gerencia_contas` de um papel, reescreve o
-- `role` de quem aquilo alcança, na mesma transação (`lib/papeis.ts`, no
-- api-server). A decisão mora no papel; `role` é a leitura barata dela.
--
-- ---------------------------------------------------------------------------
-- O que a semeadura garante
-- ---------------------------------------------------------------------------
--
-- Os dois papéis que já existiam nascem aqui — `Operador` e `Administrador` —,
-- marcados como do sistema (não se apagam, não se renomeiam), e toda conta
-- passa a apontar para o papel que corresponde ao `role` que ela já tinha.
-- Nenhuma conta muda de acesso nesta migration: os dois papéis semeados nascem
-- **sem nenhuma linha** em `papel_permissao`, e papel sem linha concede tudo,
-- que é exatamente o que `permissao_de_modulo` já dizia sobre o silêncio.
--
-- Reentrante: tudo é `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`, e o backfill
-- só toca em quem ainda está com `papel_id` nulo.
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
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "papel_id" uuid;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_papel_id_papel_id_fk') THEN
		ALTER TABLE "app_user" ADD CONSTRAINT "app_user_papel_id_papel_id_fk"
			FOREIGN KEY ("papel_id") REFERENCES "public"."papel"("id") ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_user_papel_idx" ON "app_user" USING btree ("papel_id");--> statement-breakpoint
-- Os dois que já existiam, agora com linha. `sistema` os protege da exclusão e
-- da renomeação; as permissões deles são editáveis como as de qualquer outro,
-- e é isso que faz o cadastro valer para quem nunca criar um papel novo.
INSERT INTO "papel" ("nome", "descricao", "gerencia_contas", "sistema")
VALUES
	('Operador', 'Usa o produto: audita, confere e fecha. Não gerencia contas.', false, true),
	('Administrador', 'Usa o produto e gerencia contas: cria, desativa, redefine senha e muda papel.', true, true)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Ninguém muda de acesso: cada conta cai no papel do `role` que ela já tinha, e
-- os dois papéis nascem sem restrição nenhuma.
UPDATE "app_user" SET "papel_id" = (SELECT "id" FROM "papel" WHERE lower("nome") = 'administrador')
WHERE "papel_id" IS NULL AND "role" = 'ADMIN';--> statement-breakpoint
UPDATE "app_user" SET "papel_id" = (SELECT "id" FROM "papel" WHERE lower("nome") = 'operador')
WHERE "papel_id" IS NULL;
