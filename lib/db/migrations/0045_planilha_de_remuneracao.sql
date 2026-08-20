-- A planilha de remuneração como alguém a preencheu — o cadastro deixa de ser
-- só leitura do acervo.
--
-- **O que isto destrava.** O cadastro tem trinta linhas e o acervo da Auditoria
-- sustenta onze. As outras dezenove não esperam arquivo nenhum: esperam uma
-- decisão de negócio que ninguém registrou — qual conjunto de colunas forma
-- "Remuneração Fixa - Frota Fixa Ativa", qual valor de turno marca a rota
-- noturna, o que separa van de cavalo no export de equipamento. Enquanto essa
-- decisão não existe, o número existe: está digitado na aba de Excel que a
-- transportadora manda todo mês. Sem esta tabela ele fica fora do produto, e
-- fora do produto ninguém o confere.
--
-- **Isto não é uma segunda verdade sobre a frota**, que é o que
-- `lib/remuneracao/src/index.ts` recusava ao dizer que o módulo não tinha
-- tabela própria. O que entra aqui é o que a **planilha declara**, e sai da
-- tela marcado como tal: estado `INFORMADO`, com o nome de quem digitou e a
-- data, nunca `APURADO`. Onde o acervo também responde, o valor continua sendo
-- o medido e o declarado vira conferência ao lado dele — a diferença entre os
-- dois é o achado, e é ela que este produto existe para mostrar. Um número
-- digitado nunca apaga um número medido.
--
-- **`canal` é `''` e não `NULL`** para a série sem canal. A unidade é o par
-- (escopo, canal); no Postgres dois `NULL` não colidem num índice único, e a
-- unicidade que impede duas linhas para a mesma célula da planilha não valeria
-- justamente para as séries sem canal, que são a maioria. É o mesmo
-- `channel ?? ""` que `chaveDoAlvo` já usa para juntar leitura e unidade.
--
-- **Sem backfill**, ao contrário da `0044`: não há nada anterior a converter —
-- nenhuma planilha foi informada antes desta migration, e inventar linhas a
-- partir do que o acervo mede seria carimbar como "informado por alguém" o que
-- ninguém informou.
--
-- **Sem gatilho de congelamento**, pela razão da `fechamento_parte`: isto não é
-- conteúdo de competência. O encerramento congela a conta que se cobrou; a
-- planilha da vigência seguinte continua preenchível.
--
-- O DDL é o que `drizzle-kit generate` produziu do schema, com `IF NOT EXISTS`
-- como o da `0039`, o da `0043` e o da `0044`, pela mesma razão: a adoção de um
-- banco que já os tem não pode travar a fila.

CREATE TABLE IF NOT EXISTS "remuneracao_planilha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_hash" text NOT NULL,
	"canal" text DEFAULT '' NOT NULL,
	"effective_date" date NOT NULL,
	"chave" text NOT NULL,
	"valor" numeric NOT NULL,
	"observacao" text,
	"autor_id" uuid,
	"autor_nome" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remuneracao_planilha_unica" ON "remuneracao_planilha" USING btree ("scope_hash","canal","effective_date","chave");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remuneracao_planilha_por_vigencia" ON "remuneracao_planilha" USING btree ("scope_hash","canal","effective_date");
