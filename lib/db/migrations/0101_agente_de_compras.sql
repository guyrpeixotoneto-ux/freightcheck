-- ---------------------------------------------------------------------------
-- Agente de Compras: a cotação que o acervo não tem.
--
-- O FreightCheck importa remuneração — o que a Ambev paga por um ativo, por
-- vigência, coluna a coluna. Ele nunca importou nota de compra, fornecedor ou
-- proposta comercial, e foi por isso que a tela Remunerado se recusou desde o
-- primeiro dia a dizer "pode comprar": o pedido não estava no banco.
--
-- Estas duas tabelas são o outro lado dessa frase, e elas não cruzam a
-- fronteira do acervo. Nada aqui vira fato canônico, entra em vigência,
-- participa de comparação ou de reconvergência: não há `snapshot_id`, não há
-- `entity_id`. O que elas guardam é o que quem compra digitou — para que
-- "quanto eu deveria pagar por isso?" possa ser respondida duas vezes com o
-- mesmo número, e para que o painel consiga contar as cotações à espera em vez
-- de inventar a contagem.
--
-- `compra_cotacao` guarda a proposta. Ela **não** guarda o veredito: se o
-- preço cabe no teto é conta do motor econômico, refeita a cada leitura sobre a
-- vigência corrente. Gravar o veredito o congelaria contra uma remuneração que
-- muda de vigência em vigência, e a tela mostraria "aprovada" para uma compra
-- que a vigência de hoje já não cobre. `situacao` é outra coisa: é onde a
-- cotação está no fluxo de quem compra, e quem a move é a pessoa.
--
-- `compra_premissa` guarda o que o export não traz e a conta precisa — vida
-- útil e unidades por ativo. Dezoito meses ou trinta e seis mudam o teto pela
-- metade, e o export traz a medida do pneu, não o ciclo de troca. Sem linha
-- aqui o motor usa a estimativa do catálogo e marca a resposta como de
-- confiabilidade baixa; com linha, o mesmo número passa a ser confirmado.
--
-- `item` é texto sem CHECK, como o vocabulário de `fluxo_etapa`: o catálogo de
-- compras é código (`lib/compras/src/catalogo.ts`), se lê inteiro e ganha um
-- produto com uma linha. Um CHECK aqui cobraria uma migration por produto novo.
-- O que tem CHECK é estrutura: preço positivo, quantidade positiva, situação
-- dentro das quatro, e margem dentro de (0,1) — uma margem de 120% produziria
-- teto negativo, e um teto negativo reprova toda compra com cara de conta.
-- ---------------------------------------------------------------------------

-- **Esta migration é reentrante**, como as outras que criam tabela neste
-- repositório (ver `0084` e `0089`). Rodá-la de novo sobre um banco que já a
-- tem não faz nada e não falha — é a propriedade que destrava um banco cujo
-- registro em `drizzle.__drizzle_migrations` se perdeu, e que
-- `registro-perdido.test.ts` confere migration a migration. `CREATE TABLE` sem
-- `IF NOT EXISTS` quebraria essa recuperação na última linha da fila.

CREATE TABLE IF NOT EXISTS "compra_cotacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item" text NOT NULL,
	"descricao" text,
	"fornecedor" text NOT NULL,
	"preco_unitario" numeric(14, 2) NOT NULL,
	"quantidade" integer,
	"operacao" text,
	"unidade" text,
	"situacao" text DEFAULT 'AGUARDANDO' NOT NULL,
	"evidencia" text,
	"valida_ate" timestamp with time zone,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "compra_cotacao_preco_ck" CHECK ("compra_cotacao"."preco_unitario" > 0),
	CONSTRAINT "compra_cotacao_quantidade_ck" CHECK ("compra_cotacao"."quantidade" IS NULL OR "compra_cotacao"."quantidade" > 0),
	CONSTRAINT "compra_cotacao_situacao_ck" CHECK ("compra_cotacao"."situacao" IN ('AGUARDANDO', 'EM_NEGOCIACAO', 'APROVADA', 'RECUSADA'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compra_premissa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item" text NOT NULL,
	"operacao" text,
	"vida_util_meses" integer,
	"unidades_por_ativo" integer,
	"margem_alvo" numeric(5, 4),
	"margem_minima" numeric(5, 4),
	"justificativa" text,
	"atualizado_por" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compra_premissa_vida_ck" CHECK ("compra_premissa"."vida_util_meses" IS NULL OR "compra_premissa"."vida_util_meses" > 0),
	CONSTRAINT "compra_premissa_unidades_ck" CHECK ("compra_premissa"."unidades_por_ativo" IS NULL OR "compra_premissa"."unidades_por_ativo" > 0),
	CONSTRAINT "compra_premissa_margem_alvo_ck" CHECK ("compra_premissa"."margem_alvo" IS NULL OR ("compra_premissa"."margem_alvo" > 0 AND "compra_premissa"."margem_alvo" < 1)),
	CONSTRAINT "compra_premissa_margem_minima_ck" CHECK ("compra_premissa"."margem_minima" IS NULL OR ("compra_premissa"."margem_minima" > 0 AND "compra_premissa"."margem_minima" < 1))
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'compra_cotacao_owner_id_app_user_id_fk'
	) THEN
		ALTER TABLE "compra_cotacao" ADD CONSTRAINT "compra_cotacao_owner_id_app_user_id_fk"
			FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'compra_premissa_atualizado_por_app_user_id_fk'
	) THEN
		ALTER TABLE "compra_premissa" ADD CONSTRAINT "compra_premissa_atualizado_por_app_user_id_fk"
			FOREIGN KEY ("atualizado_por") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compra_cotacao_item_idx" ON "compra_cotacao" USING btree ("item","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compra_cotacao_owner_idx" ON "compra_cotacao" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "compra_premissa_item_operacao_uq" ON "compra_premissa" USING btree ("item",COALESCE("operacao", ''));
