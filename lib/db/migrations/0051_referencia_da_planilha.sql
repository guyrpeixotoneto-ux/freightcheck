-- ---------------------------------------------------------------------------
-- A referência de conferência — a planilha entra para ser conferida, não somada
-- ---------------------------------------------------------------------------
--
-- O produto calcula o fechamento a partir de seis relatórios Promax e mostra o
-- devido ao lado do que o 03.08.20 demonstra. O que ele não tinha era a terceira
-- coluna: o que a `Fechamento_Remuneracao.xlsb` — a planilha que a operação
-- mantém — imprime no `RESUMO GERAL` daquele mês.
--
-- Existia um arnês de prova (`lib/fechamento/src/reconciliacao.ts`) que roda o
-- motor sobre os insumos **da própria planilha** e compara com os resultados
-- dela. Isso isola a fórmula e é ótimo para depurar, mas não responde à
-- pergunta de quem opera: *o meu fechamento, feito do meu cadastro e das minhas
-- importações, bate com a minha planilha?* Essa pergunta precisa dos dois lados
-- no mesmo lugar, e é o que estas três tabelas sustentam.
--
-- ---------------------------------------------------------------------------
-- O que esta migration NÃO faz
-- ---------------------------------------------------------------------------
--
-- **Não acrescenta um sétimo tipo a `fechamento_documento`.** Aquele `check`
-- lista seis fontes, todas insumos do cálculo, e é ele que mantém qualquer
-- outra coisa fora da conta. A planilha é o oposto de insumo: é o que está
-- sendo conferido. Tabela separada para que "isto entra na conta?" se responda
-- pelo nome da tabela e não pela leitura de mil linhas de aplicação.
--
-- **Não populariza nada.** As três tabelas nascem vazias e permanecem vazias
-- até alguém anexar um arquivo. Não há backfill: não existe planilha guardada
-- em lugar nenhum do acervo de onde derivá-las, e derivar seria inventar.
--
-- **Não adivinha a que mês um arquivo pertence.** O `.xlsb` não declara
-- unidade, CNPJ nem competência em nada que se leia dele — `lerCadastro` traz
-- só números, e a competência da amostra de teste é string escrita no código.
-- A associação é declarada por quem anexa, e o que fica no lugar de uma porta
-- falsa é procedência: `sha256`, arquivo, quem e quando, mostrados em toda
-- leitura. Uma heurística de "parece do mesmo mês" seria o
-- casamento-por-semelhança que a `0049` existe para aposentar.
--
-- **Não toca em `fechamento_competencia`, `fechamento_documento` nem em
-- qualquer tabela do cálculo.** Nenhuma coluna nova, nenhuma FK nova saindo
-- delas. A referência aponta para o mês pela mesma quíntupla que
-- `lerResumoDoMes` usa; o cálculo não tem por onde alcançá-la.
--
-- ---------------------------------------------------------------------------
-- Por que a referência é de mês e não de competência
-- ---------------------------------------------------------------------------
--
-- O `RESUMO GERAL` empilha a 1ª quinzena na coluna `AI` e a 2ª na `AJ`: um
-- arquivo carrega as duas. Guardá-la por competência obrigaria a subir o mesmo
-- `.xlsb` duas vezes e criaria duas verdades para o mesmo arquivo — duas
-- linhas, dois `sha256` iguais, e nenhuma regra dizendo qual vale se elas
-- divergissem. Aqui a chave é a quíntupla do mês e os bytes ficam uma vez só.
--
-- ---------------------------------------------------------------------------
-- Por que os números extraídos ficam no banco
-- ---------------------------------------------------------------------------
--
-- `fechamento_referencia_linha` guarda os catorze números por quinzena que o
-- `RESUMO GERAL` imprime, com o endereço da célula de onde cada um saiu. Não é
-- cache: a extração é **fail-closed** e pode recusar o arquivo, e recusar tem
-- de acontecer no anexo — na frente de quem escolheu o arquivo e pode trocá-lo
-- —, não na abertura do Resumo semanas depois. O que está na tabela já passou
-- pela porta.
--
-- ---------------------------------------------------------------------------
-- Reentrância
-- ---------------------------------------------------------------------------
--
-- O Publishing do Replit propõe um diff derivado do `schema.ts` e oferece
-- aplicá-lo; quem aceitar aquela proposta fica com parte e sem o resto. Como a
-- `0015`, a `0048` e a `0049`, cada objeto aqui é primeiro procurado: se
-- existir como esperado, é adotado; nada é derrubado ou "consertado" sozinho.
-- ---------------------------------------------------------------------------

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
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fechamento_referencia_conteudo" (
	"referencia_id" uuid PRIMARY KEY NOT NULL,
	"conteudo" "bytea" NOT NULL,
	"bytes_originais" integer NOT NULL,
	"guardado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fechamento_referencia_linha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referencia_id" uuid NOT NULL,
	"quinzena" integer NOT NULL,
	"chave" text NOT NULL,
	"celula" text NOT NULL,
	"valor" numeric(14, 2) NOT NULL,
	CONSTRAINT "fechamento_referencia_linha_quinzena" CHECK ("fechamento_referencia_linha"."quinzena" in (1, 2))
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		 WHERE conname = 'fechamento_referencia_conteudo_referencia_fk'
	) THEN
		ALTER TABLE "fechamento_referencia_conteudo"
			ADD CONSTRAINT "fechamento_referencia_conteudo_referencia_fk"
			FOREIGN KEY ("referencia_id") REFERENCES "public"."fechamento_referencia"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		 WHERE conname = 'fechamento_referencia_linha_referencia_fk'
	) THEN
		ALTER TABLE "fechamento_referencia_linha"
			ADD CONSTRAINT "fechamento_referencia_linha_referencia_fk"
			FOREIGN KEY ("referencia_id") REFERENCES "public"."fechamento_referencia"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		 WHERE conname = 'fechamento_referencia_unidade_id_unidade_id_fk'
	) THEN
		ALTER TABLE "fechamento_referencia"
			ADD CONSTRAINT "fechamento_referencia_unidade_id_unidade_id_fk"
			FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id")
			ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_referencia_linha_unica" ON "fechamento_referencia_linha" USING btree ("referencia_id","quinzena","chave");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_referencia_ativa_unica" ON "fechamento_referencia" USING btree ("unidade_codigo","transportadora_codigo","tipo_de_operacao","ano","mes") WHERE "fechamento_referencia"."ativa";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_referencia_versao_unica" ON "fechamento_referencia" USING btree ("unidade_codigo","transportadora_codigo","tipo_de_operacao","ano","mes","versao");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_referencia_sem_repeticao" ON "fechamento_referencia" USING btree ("unidade_codigo","transportadora_codigo","tipo_de_operacao","ano","mes","sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_referencia_por_mes" ON "fechamento_referencia" USING btree ("unidade_codigo","transportadora_codigo","tipo_de_operacao","ano","mes");
