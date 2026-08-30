-- ---------------------------------------------------------------------------
-- BUSCA ATIVA — a terceira direção, e a única em que nós ligamos primeiro.
-- ---------------------------------------------------------------------------
--
-- A `0084` abriu a porta para quem chega: um sistema de fora empurra o arquivo
-- ou lê o nosso histórico, com chave. Esta migration abre o caminho inverso —
-- numa agenda, este servidor chama um endereço do fornecedor, traz a planilha e
-- a entrega ao pipeline de Importações, que para no preview como sempre.
--
-- Duas tabelas: `integracao_busca` é a configuração (vive anos, é editada),
-- `integracao_execucao` é o histórico (só cresce, nunca é editado). É a mesma
-- divisão de `integracao` e `integracao_chamada`.
--
-- ---------------------------------------------------------------------------
-- A credencial do outro lado é cifrada, e não hasheada
-- ---------------------------------------------------------------------------
--
-- É a assimetria central deste módulo, e a razão de existir uma coluna que
-- guarda segredo reversível num banco onde nenhuma outra guarda:
--
--   · a **nossa** chave a gente só confere — hash basta, e é irreversível de
--     propósito (`integracao_chave.hash`, na `0084`);
--   · a **deles** a gente precisa apresentar a cada busca — então tem de voltar
--     ao valor original, e o que protege é a cifra.
--
-- AES-256-GCM, com a chave mestra **fora do banco** (`INTEGRACOES_CHAVE_MESTRA`
-- no ambiente). Sem ela, nenhuma busca com credencial é cadastrada nem
-- executada — o produto diz isso em voz alta em vez de inventar um padrão, que
-- é o que tornaria a coluna teatro. Ver `lib/integrations/src/cofre.ts`.
--
-- ---------------------------------------------------------------------------
-- `proxima_em` é relógio e trava ao mesmo tempo
-- ---------------------------------------------------------------------------
--
-- Este serviço escala horizontalmente, e uma agenda ingênua daria uma chamada
-- por instância — o fornecedor receberia três vezes o mesmo pedido a cada
-- janela. Quem executa toma a linha vencida com `FOR UPDATE SKIP LOCKED` e
-- empurra este carimbo dentro da mesma transação: a segunda instância não
-- enxerga a linha, e não há segunda chamada. Sem uma tabela de lock, sem
-- eleição de líder, e sem depender de haver só um processo.
--
-- O piso de 15 minutos está no `CHECK` e não só no código que grava, pela mesma
-- razão do `CHECK` de `integracao_chamada.resultado`: um `UPDATE` num psql não
-- pode transformar esta agenda num gerador de tráfego contra um terceiro.
--
-- Nada aqui mexe em tabela existente.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "integracao_busca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integracao_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"url" text NOT NULL,
	"metodo" text DEFAULT 'GET' NOT NULL,
	"cabecalhos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"corpo" text,
	"forma" text DEFAULT 'NENHUMA' NOT NULL,
	"cabecalho_da_credencial" text,
	"credencial_cifrada" text,
	"tipo_declarado" text,
	"intervalo_minutos" integer NOT NULL,
	"proxima_em" timestamp with time zone DEFAULT now() NOT NULL,
	"pausada_em" timestamp with time zone,
	"pausada_por" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criada_por" text NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integracao_execucao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"busca_id" uuid NOT NULL,
	"integracao_id" uuid NOT NULL,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"disparo" text DEFAULT 'AGENDA' NOT NULL,
	"resultado" text NOT NULL,
	"status_http" integer,
	"duracao_ms" integer NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"motivo" text,
	"import_run_id" uuid
);--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_busca_integracao_id_integracao_id_fk'
	) THEN
		ALTER TABLE "integracao_busca" ADD CONSTRAINT "integracao_busca_integracao_id_integracao_id_fk"
			FOREIGN KEY ("integracao_id") REFERENCES "public"."integracao"("id") ON DELETE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_execucao_busca_id_integracao_busca_id_fk'
	) THEN
		ALTER TABLE "integracao_execucao" ADD CONSTRAINT "integracao_execucao_busca_id_integracao_busca_id_fk"
			FOREIGN KEY ("busca_id") REFERENCES "public"."integracao_busca"("id") ON DELETE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_execucao_integracao_id_integracao_id_fk'
	) THEN
		ALTER TABLE "integracao_execucao" ADD CONSTRAINT "integracao_execucao_integracao_id_integracao_id_fk"
			FOREIGN KEY ("integracao_id") REFERENCES "public"."integracao"("id") ON DELETE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_busca_forma_ck'
	) THEN
		ALTER TABLE "integracao_busca" ADD CONSTRAINT "integracao_busca_forma_ck"
			CHECK ("integracao_busca"."forma" IN ('NENHUMA', 'BEARER', 'CABECALHO'));
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_busca_metodo_ck'
	) THEN
		ALTER TABLE "integracao_busca" ADD CONSTRAINT "integracao_busca_metodo_ck"
			CHECK ("integracao_busca"."metodo" IN ('GET', 'POST'));
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_busca_intervalo_ck'
	) THEN
		ALTER TABLE "integracao_busca" ADD CONSTRAINT "integracao_busca_intervalo_ck"
			CHECK ("integracao_busca"."intervalo_minutos" >= 15);
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_execucao_resultado_ck'
	) THEN
		ALTER TABLE "integracao_execucao" ADD CONSTRAINT "integracao_execucao_resultado_ck"
			CHECK ("integracao_execucao"."resultado" IN ('OK', 'SEM_NOVIDADE', 'RECUSADA', 'FALHA'));
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_execucao_disparo_ck'
	) THEN
		ALTER TABLE "integracao_execucao" ADD CONSTRAINT "integracao_execucao_disparo_ck"
			CHECK ("integracao_execucao"."disparo" IN ('AGENDA', 'MAO'));
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integracao_busca_integracao_idx" ON "integracao_busca" USING btree ("integracao_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integracao_busca_proxima_idx" ON "integracao_busca" USING btree ("proxima_em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integracao_execucao_busca_em_idx" ON "integracao_execucao" USING btree ("busca_id","em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integracao_execucao_integracao_idx" ON "integracao_execucao" USING btree ("integracao_id");
