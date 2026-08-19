-- Fechamento de remuneração — a competência, seus documentos e a conta.
--
-- O ambiente Fechamento existia como estrutura de telas e catálogo de etapas,
-- sem uma única tabela: toda tela dizia, honestamente, "o banco ainda não
-- sustenta este número". Esta migration é o que passa a sustentá-los.
--
-- O modelo está descrito em `lib/db/src/schema/fechamento.ts`, e as cinco
-- fontes que ele consome em `docs/FONTES-FECHAMENTO-QUINZENAL.md`. Três
-- decisões que o SQL abaixo materializa e que merecem estar à vista:
--
--   1. **Tabelas próprias, fora do canônico.** O canônico é (vigência,
--      entidade, atributo, valor) — o retrato do que a Ambev contratou. O
--      fechamento é sobre o que aconteceu: 23 mil CT-es de uma quinzena, 949
--      viagens, 56 dias de disponibilidade. São eventos datados, não atributos
--      de um ativo. Forçá-los no canônico exigiria uma entidade sintética por
--      CT-e e quebraria a garantia de que toda entidade de lá é um equipamento
--      que a Ambev remunera.
--
--   2. **Cinco tabelas de linha, não uma polimórfica.** A tabela única com
--      `jsonb` de payload seria menor de escrever e impossível de conferir:
--      soma sobre campo dentro de JSON não usa índice e o banco deixa de
--      garantir o tipo. As cinco fontes têm grãos genuinamente diferentes.
--
--   3. **A apuração é gravada, não recalculada.** Ela é função pura dos
--      documentos e poderia ser refeita a cada leitura. É gravada assim mesmo
--      porque o que foi aprovado precisa continuar sendo o que se vê: com
--      recálculo, trocar um documento mudaria retroativamente o número que
--      alguém aprovou, e a aprovação deixaria de significar algo.
--
-- Nada aqui altera tabela existente. Todas nascem vazias.

-- ---------------------------------------------------------------------------
-- 1. A competência
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "fechamento_competencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chave" text NOT NULL,
	"ano" integer NOT NULL,
	"mes" integer NOT NULL,
	"quinzena" integer NOT NULL,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"unidade_codigo" text NOT NULL,
	"unidade_nome" text,
	"transportadora_codigo" text NOT NULL,
	"transportadora_nome" text,
	"estado" text DEFAULT 'ABERTA' NOT NULL,
	"aberta_por" uuid,
	"aberta_em" timestamp with time zone DEFAULT now() NOT NULL,
	"apurada_em" timestamp with time zone,
	"encerrada_por" uuid,
	"encerrada_em" timestamp with time zone,
	"motivo_da_reabertura" text,
	CONSTRAINT "fechamento_competencia_quinzena" CHECK ("quinzena" in (1, 2)),
	CONSTRAINT "fechamento_competencia_mes" CHECK ("mes" between 1 and 12),
	CONSTRAINT "fechamento_competencia_estado" CHECK ("estado" in ('ABERTA', 'EM_APURACAO', 'APURADA', 'APROVADA', 'ENCERRADA'))
);--> statement-breakpoint

-- Uma quinzena de um CDD com uma transportadora é **um** fechamento. Dois seria
-- o começo de duas verdades sobre o mesmo dinheiro.
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_competencia_unica" ON "fechamento_competencia" ("unidade_codigo","transportadora_codigo","chave");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_competencia_por_periodo" ON "fechamento_competencia" ("ano","mes","quinzena");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Os documentos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "fechamento_documento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competencia_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"nome_do_arquivo" text NOT NULL,
	"sha256" text NOT NULL,
	"tamanho_em_bytes" integer NOT NULL,
	"caminho" text,
	"linhas_lidas" integer DEFAULT 0 NOT NULL,
	"recusas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vigente" boolean DEFAULT true NOT NULL,
	"enviado_por" uuid,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fechamento_documento_tipo" CHECK ("tipo" in ('OPERACAO', 'CTE', 'DISPONIBILIDADE', 'REQUISICOES', 'CONCILIACAO'))
);--> statement-breakpoint

DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_documento_competencia_fk') THEN
		ALTER TABLE "fechamento_documento"
			ADD CONSTRAINT "fechamento_documento_competencia_fk"
			FOREIGN KEY ("competencia_id") REFERENCES "fechamento_competencia"("id") ON DELETE CASCADE;
	END IF;
END
$reentrante$;--> statement-breakpoint

-- O mesmo arquivo não entra duas vezes na mesma competência: o SHA-256 do
-- conteúdo é a defesa contra a exportação reenviada, que dobraria a conta.
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_documento_sem_repeticao" ON "fechamento_documento" ("competencia_id","sha256");--> statement-breakpoint
-- Uma exportação corrigida substitui a anterior; as duas ficam, e `vigente`
-- diz qual delas a apuração usa.
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_documento_vigente_unico" ON "fechamento_documento" ("competencia_id","tipo") WHERE "vigente";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_documento_por_competencia" ON "fechamento_documento" ("competencia_id","tipo");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. As linhas normalizadas — uma tabela por fonte
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "fechamento_viagem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"linha_no_arquivo" integer NOT NULL,
	"dia" date NOT NULL,
	"canal" text NOT NULL,
	"frota" text NOT NULL,
	"placa" text,
	"mapa" text,
	"entregas" integer DEFAULT 0 NOT NULL,
	"caixas_carregadas" numeric(14, 2) DEFAULT '0' NOT NULL,
	"caixas_entregues" numeric(14, 2) DEFAULT '0' NOT NULL,
	"valor_frete" numeric(14, 2) DEFAULT '0' NOT NULL,
	"percentual_de_imposto" numeric(8, 4),
	"valor_de_imposto" numeric(14, 2) DEFAULT '0' NOT NULL,
	"valor_faturado" numeric(14, 2) DEFAULT '0' NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fechamento_cte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"linha_no_arquivo" integer NOT NULL,
	"dia" date,
	"vbz" integer NOT NULL,
	"verba_nome" text NOT NULL,
	"verba_natureza" text NOT NULL,
	"canal" text NOT NULL,
	"numero" text,
	"documento" text,
	"valor_cte" numeric(14, 2) NOT NULL,
	"valor_frete" numeric(14, 2) DEFAULT '0' NOT NULL,
	"icms" numeric(14, 2) DEFAULT '0' NOT NULL,
	"pis" numeric(14, 2) DEFAULT '0' NOT NULL,
	"cofins" numeric(14, 2) DEFAULT '0' NOT NULL,
	"imposto" numeric(14, 2) DEFAULT '0' NOT NULL,
	"controle" text
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fechamento_requisicao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"linha_no_arquivo" integer NOT NULL,
	"numero" text NOT NULL,
	"quinzena_de_pagamento" date,
	"canal" text NOT NULL,
	"vbz" integer NOT NULL,
	"verba_nome" text NOT NULL,
	"tipo_de_despesa_codigo" text,
	"tipo_de_despesa_nome" text,
	"descricao" text,
	"status" text NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	"solicitante" text,
	"aprovador_regional" text,
	"aprovador_ac" text,
	"enviada_em" date,
	"decidida_em" date
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fechamento_disponibilidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"linha_no_arquivo" integer NOT NULL,
	"tipo_de_frota" text NOT NULL,
	"dia" date NOT NULL,
	"canal" text NOT NULL,
	"frota_total" integer DEFAULT 0 NOT NULL,
	"contratada" numeric(12, 2) DEFAULT '0' NOT NULL,
	"real_primeira_viagem" numeric(12, 2) DEFAULT '0' NOT NULL,
	"real_segunda_viagem" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gap_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gap_da_cia" numeric(12, 2) DEFAULT '0' NOT NULL,
	"gap_da_transportadora" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"desconto_custo_fixo" numeric(14, 2) DEFAULT '0' NOT NULL,
	"desconto_equipe" numeric(14, 2) DEFAULT '0' NOT NULL,
	"desconto_indiretos" numeric(14, 2) DEFAULT '0' NOT NULL,
	"desconto_fator_ajudante" numeric(14, 2) DEFAULT '0' NOT NULL,
	"desconto_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"percentual_de_utilizacao" numeric(8, 4),
	"percentual_de_disponibilidade" numeric(8, 4)
);--> statement-breakpoint

-- As duas colunas do relatório viram duas colunas aqui, e as duas são
-- anuláveis de propósito: muitas linhas trazem um número só, e qual das
-- colunas ele ocupa é o dado. Um `0` onde o relatório não trouxe nada apagaria
-- a distinção entre "não veio" e "veio zerado".
CREATE TABLE IF NOT EXISTS "fechamento_conciliacao_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"linha_no_arquivo" integer NOT NULL,
	"secao" text NOT NULL,
	"bloco" text,
	"rubrica" text NOT NULL,
	"conciliado" text,
	"emitido" numeric(14, 2),
	"calculado" numeric(14, 2)
);--> statement-breakpoint

DO $reentrante$
DECLARE
	tabela text;
BEGIN
	FOREACH tabela IN ARRAY ARRAY[
		'fechamento_viagem',
		'fechamento_cte',
		'fechamento_requisicao',
		'fechamento_disponibilidade',
		'fechamento_conciliacao_item'
	] LOOP
		IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tabela || '_documento_fk') THEN
			EXECUTE format(
				'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (documento_id) REFERENCES fechamento_documento(id) ON DELETE CASCADE',
				tabela, tabela || '_documento_fk');
		END IF;
		IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tabela || '_competencia_fk') THEN
			EXECUTE format(
				'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (competencia_id) REFERENCES fechamento_competencia(id) ON DELETE CASCADE',
				tabela, tabela || '_competencia_fk');
		END IF;
	END LOOP;
END
$reentrante$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fechamento_viagem_por_competencia" ON "fechamento_viagem" ("competencia_id","dia","canal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_viagem_por_documento" ON "fechamento_viagem" ("documento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_cte_por_verba" ON "fechamento_cte" ("competencia_id","vbz");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_cte_por_documento" ON "fechamento_cte" ("documento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_requisicao_por_verba" ON "fechamento_requisicao" ("competencia_id","vbz");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_requisicao_por_documento" ON "fechamento_requisicao" ("documento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_disponibilidade_por_dia" ON "fechamento_disponibilidade" ("competencia_id","dia");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_disponibilidade_por_documento" ON "fechamento_disponibilidade" ("documento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_conciliacao_item_por_secao" ON "fechamento_conciliacao_item" ("competencia_id","secao");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_conciliacao_item_por_documento" ON "fechamento_conciliacao_item" ("documento_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. A conta apurada
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "fechamento_apuracao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competencia_id" uuid NOT NULL,
	"rodada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"rodada_por" uuid,
	"vigente" boolean DEFAULT true NOT NULL,
	"fontes_presentes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fontes_ausentes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aliquotas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"carga_fiscal" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_emitido" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total_esperado" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total_nao_conferido" numeric(16, 2) DEFAULT '0' NOT NULL,
	"total_diferenca" numeric(16, 2) DEFAULT '0' NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fechamento_apuracao_verba" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"apuracao_id" uuid NOT NULL,
	"vbz" integer NOT NULL,
	"canal" text NOT NULL,
	"verba_nome" text NOT NULL,
	"verba_natureza" text NOT NULL,
	"emitido" numeric(16, 2) DEFAULT '0' NOT NULL,
	"base_emitida" numeric(16, 2) DEFAULT '0' NOT NULL,
	"documentos" integer DEFAULT 0 NOT NULL,
	"esperado" numeric(16, 2),
	"diferenca" numeric(16, 2),
	"memoria" jsonb DEFAULT '[]'::jsonb NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fechamento_divergencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"apuracao_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"canal" text NOT NULL,
	"titulo" text NOT NULL,
	"valor" numeric(16, 2) DEFAULT '0' NOT NULL,
	"onde" text NOT NULL,
	"sentido" text NOT NULL,
	"desfecho" text DEFAULT 'ABERTA' NOT NULL,
	"desfecho_por" uuid,
	"desfecho_em" timestamp with time zone,
	"desfecho_nota" text,
	CONSTRAINT "fechamento_divergencia_sentido" CHECK ("sentido" in ('A_RECEBER', 'A_PAGAR', 'INFORMATIVO')),
	CONSTRAINT "fechamento_divergencia_desfecho" CHECK ("desfecho" in ('ABERTA', 'EM_CONTESTACAO', 'ACEITA', 'RESOLVIDA'))
);--> statement-breakpoint

DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_apuracao_competencia_fk') THEN
		ALTER TABLE "fechamento_apuracao"
			ADD CONSTRAINT "fechamento_apuracao_competencia_fk"
			FOREIGN KEY ("competencia_id") REFERENCES "fechamento_competencia"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_apuracao_verba_apuracao_fk') THEN
		ALTER TABLE "fechamento_apuracao_verba"
			ADD CONSTRAINT "fechamento_apuracao_verba_apuracao_fk"
			FOREIGN KEY ("apuracao_id") REFERENCES "fechamento_apuracao"("id") ON DELETE CASCADE;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_divergencia_apuracao_fk') THEN
		ALTER TABLE "fechamento_divergencia"
			ADD CONSTRAINT "fechamento_divergencia_apuracao_fk"
			FOREIGN KEY ("apuracao_id") REFERENCES "fechamento_apuracao"("id") ON DELETE CASCADE;
	END IF;
END
$reentrante$;--> statement-breakpoint

-- Uma apuração vigente por competência. Rodar de novo cria linha nova e
-- despromove a anterior; o histórico é o que responde "o que mudou desde que
-- eu aprovei".
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_apuracao_vigente_unica" ON "fechamento_apuracao" ("competencia_id") WHERE "vigente";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_apuracao_por_competencia" ON "fechamento_apuracao" ("competencia_id","rodada_em");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_apuracao_verba_unica" ON "fechamento_apuracao_verba" ("apuracao_id","vbz");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_divergencia_por_apuracao" ON "fechamento_divergencia" ("apuracao_id","desfecho");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. A competência encerrada congela
-- ---------------------------------------------------------------------------
--
-- Sem o gatilho, "encerrada" seria uma etiqueta: nada impediria um documento
-- novo de entrar numa competência fechada e mudar, em silêncio, a conta que
-- alguém já cobrou. Reabrir é um ato — muda o estado, com autor e motivo — e
-- só depois de reaberta a competência volta a aceitar escrita.
CREATE OR REPLACE FUNCTION fechamento_recusar_escrita_em_encerrada()
RETURNS trigger AS $gatilho$
DECLARE
	estado_atual text;
	competencia constant uuid := COALESCE(NEW.competencia_id, OLD.competencia_id);
BEGIN
	SELECT estado INTO estado_atual FROM fechamento_competencia WHERE id = competencia;
	IF estado_atual = 'ENCERRADA' THEN
		RAISE EXCEPTION
			'A competência % está encerrada: reabra-a, com autor e motivo, antes de alterar %.',
			competencia, TG_TABLE_NAME
			USING ERRCODE = 'raise_exception';
	END IF;
	RETURN COALESCE(NEW, OLD);
END
$gatilho$ LANGUAGE plpgsql;--> statement-breakpoint

DO $reentrante$
DECLARE
	tabela text;
BEGIN
	FOREACH tabela IN ARRAY ARRAY[
		'fechamento_documento',
		'fechamento_viagem',
		'fechamento_cte',
		'fechamento_requisicao',
		'fechamento_disponibilidade',
		'fechamento_conciliacao_item',
		'fechamento_apuracao'
	] LOOP
		EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', tabela || '_congelada', tabela);
		EXECUTE format(
			'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I
			 FOR EACH ROW EXECUTE FUNCTION fechamento_recusar_escrita_em_encerrada()',
			tabela || '_congelada', tabela);
	END LOOP;
END
$reentrante$;
