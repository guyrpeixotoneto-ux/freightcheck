-- ---------------------------------------------------------------------------
-- INTEGRAÇÕES — a terceira porta do produto, e o registro de quem passa por ela.
-- ---------------------------------------------------------------------------
--
-- Até esta migration o FreightCheck tinha duas portas: a pessoa que sobe uma
-- planilha em Importações, e a pessoa com sessão aberta que lê uma tela. A
-- terceira é a API — um sistema chamando outro, sem ninguém olhando na hora.
--
-- Uma porta sem porteiro não é porta; e um porteiro que não anota quem passou
-- responde "quem escreveu isso no acervo?" com silêncio. Por isso são três
-- tabelas, e não uma:
--
--   integracao          quem é o sistema do outro lado
--   integracao_chave    a credencial dele — várias, para poder trocar sem parar
--   integracao_chamada  o que ele fez, chamada a chamada
--
-- O porquê de cada decisão está por extenso em `lib/db/src/schema/integracao.ts`
-- e em `docs/INTEGRACOES.md`. Três coisas valem repetir aqui, porque são as que
-- alguém precisaria saber antes de alterar este arquivo:
--
-- **A chave não está no banco.** `hash` é o SHA-256 dela e `prefixo` é a parte
-- pública. Um dump deste banco não vira acesso à API, e uma chave perdida não
-- se recupera: emite-se outra.
--
-- **Revogar e desativar não apagam.** São carimbos de data, e a linha fica. O
-- histórico de uma chave revogada é exatamente o que se quer ler no dia em que
-- ela foi revogada por suspeita.
--
-- **`integracao_chamada.import_run_id` não tem chave estrangeira.** Excluir uma
-- importação é ato previsto do produto; uma FK faria a exclusão levar junto o
-- registro de que uma integração a criou, ou impediria a exclusão por causa de
-- uma linha de log. Referência fraca é a escolha certa aqui, e está escrita
-- para não parecer esquecimento.
--
-- Nada nesta migration mexe em tabela existente: são três tabelas novas, um
-- schema que ninguém lia ontem. O `IF NOT EXISTS` em tudo mantém a fila
-- reentrante, como no resto dela.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "integracao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"sistema" text NOT NULL,
	"descricao" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criada_por" text NOT NULL,
	"desativada_em" timestamp with time zone,
	"desativada_por" text
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integracao_chave" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integracao_id" uuid NOT NULL,
	"prefixo" text NOT NULL,
	"hash" text NOT NULL,
	"escopos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"apelido" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"criada_por" text NOT NULL,
	"ultima_chamada_em" timestamp with time zone,
	"revogada_em" timestamp with time zone,
	"revogada_por" text
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integracao_chamada" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integracao_id" uuid NOT NULL,
	"chave_id" uuid NOT NULL,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"metodo" text NOT NULL,
	"caminho" text NOT NULL,
	"status" integer NOT NULL,
	"duracao_ms" integer NOT NULL,
	"resultado" text NOT NULL,
	"motivo" text,
	"bytes" integer DEFAULT 0 NOT NULL,
	"request_id" text,
	"import_run_id" uuid
);--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_chave_integracao_id_integracao_id_fk'
	) THEN
		ALTER TABLE "integracao_chave" ADD CONSTRAINT "integracao_chave_integracao_id_integracao_id_fk"
			FOREIGN KEY ("integracao_id") REFERENCES "public"."integracao"("id") ON DELETE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_chamada_integracao_id_integracao_id_fk'
	) THEN
		ALTER TABLE "integracao_chamada" ADD CONSTRAINT "integracao_chamada_integracao_id_integracao_id_fk"
			FOREIGN KEY ("integracao_id") REFERENCES "public"."integracao"("id") ON DELETE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_chamada_chave_id_integracao_chave_id_fk'
	) THEN
		ALTER TABLE "integracao_chamada" ADD CONSTRAINT "integracao_chamada_chave_id_integracao_chave_id_fk"
			FOREIGN KEY ("chave_id") REFERENCES "public"."integracao_chave"("id") ON DELETE cascade;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'integracao_chamada_resultado_ck'
	) THEN
		ALTER TABLE "integracao_chamada" ADD CONSTRAINT "integracao_chamada_resultado_ck"
			CHECK ("integracao_chamada"."resultado" IN ('OK', 'RECUSADA', 'FALHA'));
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integracao_nome_uq" ON "integracao" USING btree ("nome");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integracao_criada_idx" ON "integracao" USING btree ("criada_em");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integracao_chave_hash_uq" ON "integracao_chave" USING btree ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integracao_chave_prefixo_uq" ON "integracao_chave" USING btree ("prefixo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integracao_chave_integracao_idx" ON "integracao_chave" USING btree ("integracao_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integracao_chamada_integracao_em_idx" ON "integracao_chamada" USING btree ("integracao_id","em");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integracao_chamada_chave_idx" ON "integracao_chamada" USING btree ("chave_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integracao_chamada_em_idx" ON "integracao_chamada" USING btree ("em");
