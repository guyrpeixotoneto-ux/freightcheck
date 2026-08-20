-- A unidade que ainda não importou nada — a planilha deixa de esperar arquivo
-- para existir.
--
-- **A parede que isto derruba.** Uma unidade, neste produto, sempre nasceu de
-- um `snapshot`: `listContexts` agrupa o acervo por `(scope_hash, canal)`, e
-- quem nunca mandou export não existia em tela nenhuma. Na Auditoria isso está
-- certo — lá a pergunta é o que os arquivos sustentam, e uma unidade sem
-- arquivo não sustenta nada. No Fechamento é uma parede: a quinzena é de
-- várias unidades, a aba de Excel chega antes do export com frequência, e a
-- unidade que só tem planilha não tinha onde ser digitada. Não por recusa do
-- produto — por não haver linha para clicar.
--
-- **O que entra aqui é identidade, e não número.** Nome, código, tipo de
-- operação e a quinzena em que se começou a preencher. Os números continuam em
-- `remuneracao_planilha`, que já vive por escopo e vigência sem depender de
-- acervo, e continuam saindo da tela marcados como `INFORMADO`, com autor e
-- data. Nada aqui vira medição, e nada aqui apaga medição.
--
-- **O `scope_hash` é calculado, e é isso que impede a unidade duplicada.** Ele
-- sai do mesmo `hashScopeSet` da importação — `sha256` dos descritores
-- `TIPO:código` ordenados. Registrar CAMAÇARI com o código que o export também
-- carrega produz **o mesmo** hash que o import produzirá: no dia em que o
-- arquivo chegar, ele cai na unidade que já estava lá, com a planilha digitada
-- no lugar certo. É por isso que o código é obrigatório na escrita. Derivar o
-- hash do nome seria mais cômodo hoje e faria as duas nunca se encontrarem —
-- e o conserto seria manual, meses depois, por quem não escreveu nenhuma das
-- duas.
--
-- **O acervo vence, e a linha daqui não é apagada por isso.** Havendo snapshot
-- para o mesmo par (escopo, canal), `contextosDoModulo` ignora esta linha e usa
-- o contexto do acervo. Ela fica: quem registrou e quando é a única
-- procedência que a unidade teve enquanto não havia arquivo, e apagá-la
-- reescreveria a história para dizer que ela sempre veio de um export.
--
-- **Sem backfill.** Não há nada anterior a converter: toda unidade que existe
-- hoje veio do acervo, e é lá que ela continua nascendo. Criar linhas aqui a
-- partir dos contextos existentes duplicaria cada unidade em duas origens e
-- afirmaria que alguém as registrou à mão, o que ninguém fez.
--
-- **`canal` é `''` e não `NULL`**, pela razão da `0045`: a chave da unidade é
-- (escopo, canal), e no Postgres dois `NULL` não colidem num índice único.
--
-- O DDL é o que `drizzle-kit generate` produziu do schema, com `IF NOT EXISTS`
-- como o da `0039`, o da `0043`, o da `0044` e o da `0045`, pela mesma razão: a
-- adoção de um banco que já os tem não pode travar a fila.

CREATE TABLE IF NOT EXISTS "remuneracao_unidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_hash" text NOT NULL,
	"scope_type" text DEFAULT 'UNIDADE' NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"canal" text DEFAULT '' NOT NULL,
	"vigencia_inicial" date NOT NULL,
	"autor_id" uuid,
	"autor_nome" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remuneracao_unidade_unica" ON "remuneracao_unidade" USING btree ("scope_hash","canal");
