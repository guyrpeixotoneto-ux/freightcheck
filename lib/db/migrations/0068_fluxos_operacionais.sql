-- ---------------------------------------------------------------------------
-- Fluxos Operacionais — o mapa dos processos, como dado.
-- ---------------------------------------------------------------------------
--
-- Seis tabelas novas e **nenhuma alteração em nada que já existe**. Este módulo
-- não toca em coluna, índice ou constraint de tabela anterior; a única
-- referência para fora é `fluxo_operacional.empresa_id → unidade.id`, que é
-- leitura da autoridade que a 0049 criou.
--
-- O porquê de cada decisão está em `lib/db/src/schema/fluxo.ts`, por extenso.
-- Em uma linha: o motor é genérico — nenhuma coluna abaixo sabe o que é um CTe
-- —, e "Emissão de CTe até Recebimento" é uma linha de `fluxo_operacional` com
-- dezesseis de `fluxo_etapa`, não um caso especial de nada.
--
-- ---------------------------------------------------------------------------
-- As chaves compostas, que são a metade importante
-- ---------------------------------------------------------------------------
--
-- `empresa_id` se repete nas cinco tabelas filhas para que exista
-- `(fluxo_id, empresa_id) → fluxo_operacional(id, empresa_id)`. Com essa chave,
-- gravar uma etapa da empresa A dentro de um fluxo da empresa B é recusado pelo
-- banco — não por um `if` que a próxima rota pode esquecer de escrever. As duas
-- pontas de `fluxo_conexao` referenciam `(etapa_id, fluxo_id)` pela mesma razão:
-- ligar etapas de fluxos diferentes deixa de ser possível de expressar.
--
-- ---------------------------------------------------------------------------
-- Reentrância
-- ---------------------------------------------------------------------------
--
-- Como a 0015, a 0048 e a 0049: cada objeto é primeiro procurado. Se existir
-- como esperado, é adotado; nada é derrubado nem "consertado" sozinho. É o que
-- mantém esta migration aplicável sobre um banco em que a proposta de diff do
-- Publishing já tenha criado parte das tabelas.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "fluxo_operacional" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"descricao" text,
	"objetivo" text,
	"categoria" text NOT NULL,
	"status" text DEFAULT 'RASCUNHO' NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL,
	"dono" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criado_por" text,
	"atualizado_por" text,
	CONSTRAINT "fluxo_operacional_id_empresa_uq" UNIQUE("id","empresa_id"),
	CONSTRAINT "fluxo_operacional_nome_nao_vazio" CHECK (length(btrim("fluxo_operacional"."nome")) > 0),
	CONSTRAINT "fluxo_operacional_slug_nao_vazio" CHECK (length(btrim("fluxo_operacional"."slug")) > 0),
	CONSTRAINT "fluxo_operacional_versao_positiva" CHECK ("fluxo_operacional"."versao" >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fluxo_etapa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"fluxo_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"tipo" text DEFAULT 'PROCESSO' NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"responsavel" text,
	"area" text,
	"objetivo" text,
	"sistema_principal" text,
	"regras" text,
	"observacoes" text,
	"status" text DEFAULT 'ATIVO' NOT NULL,
	"pos_x" integer DEFAULT 0 NOT NULL,
	"pos_y" integer DEFAULT 0 NOT NULL,
	"chave_monitoramento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fluxo_etapa_id_fluxo_uq" UNIQUE("id","fluxo_id"),
	CONSTRAINT "fluxo_etapa_nome_nao_vazio" CHECK (length(btrim("fluxo_etapa"."nome")) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fluxo_conexao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"fluxo_id" uuid NOT NULL,
	"origem_etapa_id" uuid NOT NULL,
	"destino_etapa_id" uuid NOT NULL,
	"tipo" text DEFAULT 'SEQUENCIA' NOT NULL,
	"rotulo" text,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fluxo_conexao_sem_laco" CHECK ("fluxo_conexao"."origem_etapa_id" <> "fluxo_conexao"."destino_etapa_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fluxo_etapa_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"fluxo_id" uuid NOT NULL,
	"etapa_id" uuid NOT NULL,
	"especie" text NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"obrigatorio" boolean,
	"link" text,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fluxo_etapa_item_nome_nao_vazio" CHECK (length(btrim("fluxo_etapa_item"."nome")) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fluxo_etapa_indicador" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"fluxo_id" uuid NOT NULL,
	"etapa_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"unidade" text,
	"sentido" text DEFAULT 'NEUTRO' NOT NULL,
	"origem" text,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fluxo_etapa_indicador_nome_nao_vazio" CHECK (length(btrim("fluxo_etapa_indicador"."nome")) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fluxo_etapa_acao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"fluxo_id" uuid NOT NULL,
	"etapa_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text,
	"rota" text NOT NULL,
	"parametros" jsonb,
	"icone" text,
	"ordem" integer DEFAULT 0 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fluxo_etapa_acao_titulo_nao_vazio" CHECK (length(btrim("fluxo_etapa_acao"."titulo")) > 0),
	CONSTRAINT "fluxo_etapa_acao_rota_interna" CHECK ("fluxo_etapa_acao"."rota" ~ '^/')
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_operacional_empresa_id_unidade_id_fk') THEN
		ALTER TABLE "fluxo_operacional"
			ADD CONSTRAINT "fluxo_operacional_empresa_id_unidade_id_fk"
			FOREIGN KEY ("empresa_id") REFERENCES "public"."unidade"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_fluxo_empresa_fk') THEN
		ALTER TABLE "fluxo_etapa"
			ADD CONSTRAINT "fluxo_etapa_fluxo_empresa_fk"
			FOREIGN KEY ("fluxo_id","empresa_id") REFERENCES "public"."fluxo_operacional"("id","empresa_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_conexao_fluxo_empresa_fk') THEN
		ALTER TABLE "fluxo_conexao"
			ADD CONSTRAINT "fluxo_conexao_fluxo_empresa_fk"
			FOREIGN KEY ("fluxo_id","empresa_id") REFERENCES "public"."fluxo_operacional"("id","empresa_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_conexao_origem_fk') THEN
		ALTER TABLE "fluxo_conexao"
			ADD CONSTRAINT "fluxo_conexao_origem_fk"
			FOREIGN KEY ("origem_etapa_id","fluxo_id") REFERENCES "public"."fluxo_etapa"("id","fluxo_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_conexao_destino_fk') THEN
		ALTER TABLE "fluxo_conexao"
			ADD CONSTRAINT "fluxo_conexao_destino_fk"
			FOREIGN KEY ("destino_etapa_id","fluxo_id") REFERENCES "public"."fluxo_etapa"("id","fluxo_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_item_etapa_fk') THEN
		ALTER TABLE "fluxo_etapa_item"
			ADD CONSTRAINT "fluxo_etapa_item_etapa_fk"
			FOREIGN KEY ("etapa_id","fluxo_id") REFERENCES "public"."fluxo_etapa"("id","fluxo_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_item_fluxo_empresa_fk') THEN
		ALTER TABLE "fluxo_etapa_item"
			ADD CONSTRAINT "fluxo_etapa_item_fluxo_empresa_fk"
			FOREIGN KEY ("fluxo_id","empresa_id") REFERENCES "public"."fluxo_operacional"("id","empresa_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_indicador_etapa_fk') THEN
		ALTER TABLE "fluxo_etapa_indicador"
			ADD CONSTRAINT "fluxo_etapa_indicador_etapa_fk"
			FOREIGN KEY ("etapa_id","fluxo_id") REFERENCES "public"."fluxo_etapa"("id","fluxo_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_indicador_fluxo_empresa_fk') THEN
		ALTER TABLE "fluxo_etapa_indicador"
			ADD CONSTRAINT "fluxo_etapa_indicador_fluxo_empresa_fk"
			FOREIGN KEY ("fluxo_id","empresa_id") REFERENCES "public"."fluxo_operacional"("id","empresa_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_acao_etapa_fk') THEN
		ALTER TABLE "fluxo_etapa_acao"
			ADD CONSTRAINT "fluxo_etapa_acao_etapa_fk"
			FOREIGN KEY ("etapa_id","fluxo_id") REFERENCES "public"."fluxo_etapa"("id","fluxo_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_acao_fluxo_empresa_fk') THEN
		ALTER TABLE "fluxo_etapa_acao"
			ADD CONSTRAINT "fluxo_etapa_acao_fluxo_empresa_fk"
			FOREIGN KEY ("fluxo_id","empresa_id") REFERENCES "public"."fluxo_operacional"("id","empresa_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fluxo_operacional_empresa_slug_uq" ON "fluxo_operacional" USING btree ("empresa_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_operacional_empresa_idx" ON "fluxo_operacional" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_fluxo_idx" ON "fluxo_etapa" USING btree ("fluxo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_empresa_idx" ON "fluxo_etapa" USING btree ("empresa_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fluxo_conexao_par_uq" ON "fluxo_conexao" USING btree ("origem_etapa_id","destino_etapa_id","tipo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_conexao_fluxo_idx" ON "fluxo_conexao" USING btree ("fluxo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_item_etapa_idx" ON "fluxo_etapa_item" USING btree ("etapa_id","especie");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_item_especie_idx" ON "fluxo_etapa_item" USING btree ("empresa_id","especie");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_indicador_etapa_idx" ON "fluxo_etapa_indicador" USING btree ("etapa_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_acao_etapa_idx" ON "fluxo_etapa_acao" USING btree ("etapa_id");
