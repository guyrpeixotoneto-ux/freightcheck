-- ---------------------------------------------------------------------------
-- MÓDULOS UNIVERSAIS — a instalação diz que partes do produto ela usa.
-- ---------------------------------------------------------------------------
--
-- Havia duas camadas de acesso, e as duas respondem a mesma pergunta sobre
-- pessoas: `permissao_de_modulo` (`0071`) decide por conta, `papel_permissao`
-- (`0082`) decide por grupo de contas. Nenhuma responde a pergunta da casa:
-- **esta instalação usa esta parte do produto?**
--
-- Uma casa que não trabalha com Processos, QLP e Frota hoje tem de tirar as
-- três de cada papel — e a decisão envelhece calada, porque o papel criado na
-- semana seguinte nasce com as três de volta no menu. Esta migration cria a
-- camada que falta: uma lista curta de chaves desligadas **para todo mundo**.
--
-- ---------------------------------------------------------------------------
-- Ela só tira, e fica acima das outras duas
-- ---------------------------------------------------------------------------
--
-- Não há nível aqui: a chave está ligada ou desligada. Desligada, todo mundo
-- recebe SEM_ACESSO nela, qualquer que seja o papel ou a exceção — é o que faz
-- "não aparece para ninguém" ser verdade sem depender de ninguém ter revisado
-- papel nenhum. Ligada, esta tabela não diz nada, e a leitura continua sendo a
-- de sempre:
--
--   1. desligado universalmente → SEM_ACESSO, e acabou;
--   2. a exceção da pessoa, quando existe;
--   3. o papel dela, quando existe;
--   4. EDITAR — o padrão que concede.
--
-- Dar três níveis a esta camada a faria competir com as outras duas pela mesma
-- resposta; com dois estados, ela responde uma pergunta que nenhuma das duas
-- fazia e não muda a resposta de nenhuma pergunta que elas já respondiam.
--
-- ---------------------------------------------------------------------------
-- A chave é a mesma, e a seção não tem chave própria
-- ---------------------------------------------------------------------------
--
-- O endereço do item no menu (`/fluxos`, `/qlp`), ou `@` mais o id do ambiente
-- — as mesmas chaves das outras duas tabelas. Desligar a seção "Processos" é
-- desligar os módulos dela; a seção some sozinha do menu quando fica vazia. Uma
-- chave de seção seria um quarto tipo de chave que o portão de escrita do
-- servidor não saberia ler.
--
-- ---------------------------------------------------------------------------
-- O que a migration muda no dia em que roda: nada
-- ---------------------------------------------------------------------------
--
-- As duas tabelas nascem vazias, e vazio quer dizer "tudo ligado" — o mesmo
-- silêncio que concede nas outras duas. Reentrante: tudo é `IF NOT EXISTS`.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "modulo_universal" (
	"chave" text PRIMARY KEY NOT NULL,
	"desligado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"desligado_por" text NOT NULL,
	"motivo" text
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "modulo_universal_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chave" text NOT NULL,
	"ligado" boolean NOT NULL,
	"motivo" text,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"por" text NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "modulo_universal_chave_idx" ON "modulo_universal" USING btree ("chave");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "modulo_universal_evento_chave_idx" ON "modulo_universal_evento" USING btree ("chave");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "modulo_universal_evento_em_idx" ON "modulo_universal_evento" USING btree ("em");
