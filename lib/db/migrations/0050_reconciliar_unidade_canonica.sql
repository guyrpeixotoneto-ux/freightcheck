-- Reconciliar o que a 0049 cria e o bridge remove.
--
-- É o mesmo buraco da `0024`, da `0027`, da `0029` e da `0034`, e ele não fecha
-- sozinho: `bridgeDown` remove objetos que as migrations criam e **não toca no
-- registro**; `runMigrations()` pula toda migration cujo carimbo já está
-- registrado. Depois de um `down` sem `up`, só o `up` devolveria aqueles
-- objetos — a fila estruturalmente não consegue, e `migrate` responderia "nada
-- a aplicar" sobre um banco divergente.
--
-- A `0049` acrescentou a tabela `unidade` e as duas colunas `unidade_id` que a
-- referenciam, e as três saem no `down` porque o contrato com o Publishing é
-- "seis ADD COLUMN e nada mais". Sem esta migration a lista do bridge teria
-- crescido em silêncio, que é exatamente o que `reconciliacao-bridge.test.ts`
-- existe para impedir.
--
-- Uma migration nova, e não uma edição da `0049`, pelo motivo de sempre nesta
-- fila: a decisão de rodar é pelo carimbo, nunca pelo conteúdo.
--
-- **Só estrutura, e aqui isso tem um significado forte.** Esta migration repõe
-- a tabela *vazia* e as colunas *nulas*. Ela não repõe cadastro nenhum, e não
-- teria como: uma unidade canônica é um ato de quem opera — nome e CNPJ
-- digitados e conferidos —, e não há consulta que a reconstrua a partir do
-- acervo nem das competências. É por isso que `unidade` entra em
-- `TABELAS_REMOVIDAS` com pré-condição de **vazia**: o `down` recusa descer
-- sobre um banco que já tenha cadastro, e esta reconciliação existe para o caso
-- em que ele desceu porque não havia nada a perder.
ALTER TABLE "fechamento_competencia" DROP CONSTRAINT IF EXISTS "fechamento_competencia_unidade_id_unidade_id_fk";--> statement-breakpoint

ALTER TABLE "remuneracao_unidade" DROP CONSTRAINT IF EXISTS "remuneracao_unidade_unidade_id_unidade_id_fk";--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "unidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unidade_cnpj_canonico" CHECK ("unidade"."cnpj" ~ '^[0-9]{14}$')
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "unidade_cnpj_uq" ON "unidade" USING btree ("cnpj");--> statement-breakpoint

ALTER TABLE "fechamento_competencia" ADD COLUMN IF NOT EXISTS "unidade_id" uuid;--> statement-breakpoint

ALTER TABLE "remuneracao_unidade" ADD COLUMN IF NOT EXISTS "unidade_id" uuid;--> statement-breakpoint

ALTER TABLE "fechamento_competencia"
	ADD CONSTRAINT "fechamento_competencia_unidade_id_unidade_id_fk"
	FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id")
	ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "remuneracao_unidade"
	ADD CONSTRAINT "remuneracao_unidade_unidade_id_unidade_id_fk"
	FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id")
	ON DELETE no action ON UPDATE no action;
