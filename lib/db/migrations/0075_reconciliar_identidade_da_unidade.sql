-- ---------------------------------------------------------------------------
-- A identidade da unidade passa a ter duas formas: o CNPJ ou o código gerencial.
-- ---------------------------------------------------------------------------
--
-- A `0049` fez do CNPJ a identidade da unidade canônica, e fez bem: era ele que
-- acabava com as quatro representações independentes da mesma unidade. O que
-- ela fez junto, e não precisava, foi torná-lo **obrigatório**.
--
-- A exigência não produz cadastro melhor onde o documento não existe: produz
-- cadastro nenhum. A unidade que ainda não tem CNPJ próprio, a que fatura sob o
-- de outra e a que a operação inteira chama de `081-0443` continuavam vivendo
-- como texto livre em `fechamento_competencia.unidade_codigo` e em
-- `remuneracao_unidade.codigo` — exatamente o estado que a `0049` veio encerrar
-- —, ou entravam com um documento inventado para vencer a validação, que é
-- pior: identidade errada é o defeito que a tabela existe para não ter.
--
-- O que **continua** valendo é a regra que sempre importou, e o `check`
-- `unidade_tem_identidade` é ela por escrito: cada unidade tem uma identidade e
-- cada identidade tem uma unidade. Os dois campos são únicos, e ao menos um tem
-- de estar preenchido.
--
-- ---------------------------------------------------------------------------
-- O que esta migration NÃO faz
-- ---------------------------------------------------------------------------
--
-- **Não popula `codigo_gerencial` a partir de nada.** Nem de `unidade_codigo`,
-- nem de `remuneracao_unidade.codigo`, nem de `fechamento_parte`. Um código de
-- fonte é o que aquela fonte escreveu; o código gerencial é o que alguém
-- **afirma** ser o nome curto da unidade. Derivar um do outro faria o acervo
-- criar identidade sozinho, que é o desenho que a `0049` desfaz.
--
-- **Não afrouxa o CNPJ de quem já o tem.** A coluna deixa de ser `NOT NULL` e
-- continua checada: ou são catorze dígitos, ou é `NULL`. Nenhuma linha
-- existente muda — todas têm CNPJ, e continuam tendo.
--
-- **Não troca o índice único por um parcial.** No Postgres cada `NULL` é
-- distinto para efeito de unicidade, então `unidade_cnpj_uq` já faz o certo
-- sobre a coluna nullable: quantas unidades sem CNPJ forem precisas, e nunca
-- duas com o mesmo CNPJ.
--
-- ---------------------------------------------------------------------------
-- Por que ela é uma `_reconciliar_`, e por que é a última da fila
-- ---------------------------------------------------------------------------
--
-- `bridgeDown` derruba a tabela `unidade` inteira (ela está em
-- `TABELAS_REMOVIDAS`, com pré-condição de vazia) e **não toca no registro**;
-- `runMigrations()` pula toda migration cujo carimbo já esteja registrado.
-- Quem repõe a tabela depois de um `down` sem `up` é a `0050`, que a recria na
-- forma da `0049` — CNPJ `NOT NULL` e sem código gerencial. Uma migration
-- comum aqui abriria o buraco de sempre: a forma nova ficaria irrecuperável
-- pela fila, porque a `0075` já constaria como aplicada.
--
-- Por isso ela reconcilia em vez de só alterar: cada objeto é primeiro
-- procurado, a tabela é criada na forma **de hoje** se não existir, e rodar
-- duas vezes sobre um banco saudável não muda nada — que é o que
-- `reconciliacao-bridge.test.ts` exige de toda migration deste nome.
-- ---------------------------------------------------------------------------

-- 1. A tabela na forma de hoje, para o banco que a perdeu no `down`.
CREATE TABLE IF NOT EXISTS "unidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text,
	"codigo_gerencial" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 2. E, para o banco que a tem na forma da `0049`, a diferença entre as duas.
ALTER TABLE "unidade" ADD COLUMN IF NOT EXISTS "codigo_gerencial" text;--> statement-breakpoint
ALTER TABLE "unidade" ALTER COLUMN "cnpj" DROP NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "unidade_cnpj_uq" ON "unidade" USING btree ("cnpj");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unidade_codigo_gerencial_uq" ON "unidade" USING btree ("codigo_gerencial");--> statement-breakpoint

/*
	Os três `check`, cada um procurado antes de ser criado — `ADD CONSTRAINT`
	não tem `IF NOT EXISTS`, e é isto que faz a migration rodar duas vezes sem
	reclamar. O `unidade_cnpj_canonico` é derrubado e refeito porque a regra
	dele mudou: a versão da `0049` recusa `NULL`.
*/
ALTER TABLE "unidade" DROP CONSTRAINT IF EXISTS "unidade_cnpj_canonico";--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unidade_cnpj_canonico') THEN
		ALTER TABLE "unidade" ADD CONSTRAINT "unidade_cnpj_canonico"
			CHECK ("unidade"."cnpj" IS NULL OR "unidade"."cnpj" ~ '^[0-9]{14}$');
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unidade_codigo_gerencial_normalizado') THEN
		ALTER TABLE "unidade" ADD CONSTRAINT "unidade_codigo_gerencial_normalizado"
			CHECK ("unidade"."codigo_gerencial" IS NULL OR "unidade"."codigo_gerencial" ~ '^[^[:space:]](.*[^[:space:]])?$');
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unidade_tem_identidade') THEN
		ALTER TABLE "unidade" ADD CONSTRAINT "unidade_tem_identidade"
			CHECK ("unidade"."cnpj" IS NOT NULL OR "unidade"."codigo_gerencial" IS NOT NULL);
	END IF;
END $$;
