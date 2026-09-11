-- ---------------------------------------------------------------------------
-- O REGISTRO DOS REPAROS DE DADO — uma tabela, e nenhum reparo dentro dela.
-- ---------------------------------------------------------------------------
--
-- Esta migration cria o **lugar** onde um reparo de dado diz que rodou. Ela não
-- repara nada, e a separação é o ponto: a fila é DDL versionado, aplicado numa
-- transação, cuja falha impede a partida; um reparo de dado lê regra de
-- aplicação, leva o tempo que o acervo exigir, e não pode derrubar o servidor
-- se falhar. Escrever o segundo dentro da primeira faria a fila passar a
-- depender de dado — a inversão que `drizzle-kit.config.ts` existe para impedir.
--
-- O primeiro reparo a usá-la é `0095_serie_indeterminada`, em
-- `lib/comparison/src/reparo-de-series.ts`, e ele roda depois da fila, na
-- partida do servidor.
--
-- ---------------------------------------------------------------------------
-- Por que registro, e não uma varredura a cada partida
-- ---------------------------------------------------------------------------
--
-- Este produto já tem varredura de partida — o censo do balanço (`0080`), a
-- presença das vigências (`0081`) — e ali ela é a forma certa: o alvo é "a linha
-- que ainda não tem o valor derivado", então cada passada encolhe a próxima até
-- não sobrar nada.
--
-- O reparo de série não encolhe até zero. O alvo é o envio com série nula, e nem
-- todo envio sai desse estado: um arquivo sem coluna `Unidade`, com nome que não
-- nomeia unidade nenhuma e sem ninguém para declarar continua legitimamente
-- indeterminado. Sem registro, ele seria reprocessado em toda partida, para
-- sempre, para chegar à mesma resposta — e o que se paga nisso não é o `SELECT`,
-- é o recálculo das comparações de todos os envios daquela série.
--
-- Com registro, o reparo é um evento datado: roda uma vez, deixa o saldo
-- escrito, e as partidas seguintes leem uma linha e seguem.
--
-- ---------------------------------------------------------------------------
-- O saldo fica gravado, e não só no log
-- ---------------------------------------------------------------------------
--
-- `encontrados`, `corrigidos`, `ignorados`, `falhas` e o `detalhe` por envio.
-- "Quantos este reparo mexeu, e em quais" é pergunta que alguém faz **depois**,
-- e um log de partida não a responde três deploys adiante. `ignorados` é
-- deliberadamente separado de `falhas`: o envio que continua indeterminado não
-- falhou — atribuí-lo a uma unidade por proximidade seria a única coisa pior do
-- que não repará-lo.
--
-- Tabela nova em `public`, então ela entra em `TABELAS_DESCARTAVEIS` no bridge e
-- não em `TABELAS_REMOVIDAS`: nada aqui é decisão de gente, e perder uma linha
-- faz o reparo rodar de novo — o que é inócuo por construção, porque ele só sai
-- do indeterminado para um nome e nunca toca numa série já estabelecida.

CREATE TABLE IF NOT EXISTS "reparo_de_dados" (
	"nome" text PRIMARY KEY NOT NULL,
	"aplicado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"encontrados" integer DEFAULT 0 NOT NULL,
	"corrigidos" integer DEFAULT 0 NOT NULL,
	"ignorados" integer DEFAULT 0 NOT NULL,
	"falhas" integer DEFAULT 0 NOT NULL,
	"detalhe" jsonb DEFAULT '[]'::jsonb NOT NULL
);
