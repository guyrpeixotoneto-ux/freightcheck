-- Reconciliar o que a 0051 cria e o bridge remove.
--
-- É o mesmo buraco da `0024`, da `0027`, da `0029`, da `0034` e da `0050`, e ele
-- não fecha sozinho: `bridgeDown` remove objetos que as migrations criam e **não
-- toca no registro**; `runMigrations()` pula toda migration cujo carimbo já está
-- registrado. Depois de um `down` sem `up`, só o `up` devolveria aqueles objetos
-- — a fila estruturalmente não consegue, e `migrate` responderia "nada a
-- aplicar" sobre um banco divergente.
--
-- A `0051` acrescentou as três tabelas da referência de conferência, e as três
-- saem no `down` porque o contrato com o Publishing é "as colunas da allowlist e
-- nada mais". Sem esta migration a lista do bridge teria crescido em silêncio,
-- que é exatamente o que `reconciliacao-bridge.test.ts` existe para impedir.
--
-- Uma migration nova, e não uma edição da `0051`, pelo motivo de sempre nesta
-- fila: a decisão de rodar é pelo carimbo, nunca pelo conteúdo.
--
-- **Só estrutura, e aqui isso tem um significado forte.** Esta migration repõe
-- as três tabelas *vazias*. Ela não repõe referência nenhuma, e não teria como:
-- uma referência é um arquivo que alguém anexou e um mês que alguém **declarou**
-- pertencer a ele — o `.xlsb` não carrega identidade legível, que é justamente a
-- razão de a associação ser declarada. É por isso que as três entram em
-- `TABELAS_REMOVIDAS` com pré-condição de **vazia**: o `down` recusa descer
-- sobre um banco que já tenha conferência, e esta reconciliação existe para o
-- caso em que ele desceu porque não havia nada a perder.
--
-- **Ordem invertida em relação ao `down`.** Lá as filhas saem primeiro e
-- `unidade` por último; aqui a mãe existe antes da filha, e as FKs entram
-- depois das três tabelas.
ALTER TABLE IF EXISTS "fechamento_referencia_conteudo" DROP CONSTRAINT IF EXISTS "fechamento_referencia_conteudo_referencia_fk";--> statement-breakpoint

ALTER TABLE IF EXISTS "fechamento_referencia_linha" DROP CONSTRAINT IF EXISTS "fechamento_referencia_linha_referencia_fk";--> statement-breakpoint

ALTER TABLE IF EXISTS "fechamento_referencia" DROP CONSTRAINT IF EXISTS "fechamento_referencia_unidade_id_unidade_id_fk";--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fechamento_referencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unidade_codigo" text NOT NULL,
	"transportadora_codigo" text NOT NULL,
	"tipo_de_operacao" text NOT NULL,
	"ano" integer NOT NULL,
	"mes" integer NOT NULL,
	"unidade_id" uuid,
	"nome_do_arquivo" text NOT NULL,
	"sha256" text NOT NULL,
	"tamanho_em_bytes" integer NOT NULL,
	"versao" integer NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"anexada_por" uuid,
	"anexada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fechamento_referencia_mes" CHECK ("fechamento_referencia"."mes" between 1 and 12),
	CONSTRAINT "fechamento_referencia_versao" CHECK ("fechamento_referencia"."versao" >= 1)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fechamento_referencia_conteudo" (
	"referencia_id" uuid PRIMARY KEY NOT NULL,
	"conteudo" "bytea" NOT NULL,
	"bytes_originais" integer NOT NULL,
	"guardado_em" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "fechamento_referencia_linha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referencia_id" uuid NOT NULL,
	"quinzena" integer NOT NULL,
	"chave" text NOT NULL,
	"celula" text NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	CONSTRAINT "fechamento_referencia_linha_quinzena" CHECK ("fechamento_referencia_linha"."quinzena" in (1, 2))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_referencia_linha_unica" ON "fechamento_referencia_linha" USING btree ("referencia_id","quinzena","chave");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_referencia_ativa_unica" ON "fechamento_referencia" USING btree ("unidade_codigo","transportadora_codigo","tipo_de_operacao","ano","mes") WHERE "fechamento_referencia"."ativa";--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_referencia_versao_unica" ON "fechamento_referencia" USING btree ("unidade_codigo","transportadora_codigo","tipo_de_operacao","ano","mes","versao");--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_referencia_sem_repeticao" ON "fechamento_referencia" USING btree ("unidade_codigo","transportadora_codigo","tipo_de_operacao","ano","mes","sha256");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fechamento_referencia_por_mes" ON "fechamento_referencia" USING btree ("unidade_codigo","transportadora_codigo","tipo_de_operacao","ano","mes");--> statement-breakpoint

ALTER TABLE "fechamento_referencia_conteudo"
	ADD CONSTRAINT "fechamento_referencia_conteudo_referencia_fk"
	FOREIGN KEY ("referencia_id") REFERENCES "public"."fechamento_referencia"("id")
	ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "fechamento_referencia_linha"
	ADD CONSTRAINT "fechamento_referencia_linha_referencia_fk"
	FOREIGN KEY ("referencia_id") REFERENCES "public"."fechamento_referencia"("id")
	ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "fechamento_referencia"
	ADD CONSTRAINT "fechamento_referencia_unidade_id_unidade_id_fk"
	FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id")
	ON DELETE no action ON UPDATE no action;
