-- O arquivo importado deixa de ser descartado depois de lido.
--
-- **O defeito que isto fecha.** `fechamento_documento.caminho` existe desde a
-- `0039` com a promessa de que "a evidência pode ser reaberta", e nunca foi
-- preenchida: a rota de upload decodifica o base64, lê, grava os fatos
-- derivados e joga fora os bytes. Quando uma importação de 03.08.20 produziu
-- catorze descontos e nenhuma verba, não havia como saber por quê — nem o
-- arquivo, nem as linhas recusadas existiam em lugar nenhum. Pedir o `.txt` de
-- volta a quem enviou é confessar que o sistema não guarda o que recebeu.
--
-- **Tabela à parte, e não uma coluna em `fechamento_documento`.** Listar
-- documentos é a operação mais comum da tela; um `bytea` de megabytes na mesma
-- linha faria toda listagem carregar o TOAST sem precisar dele.
--
-- **Comprimido, com o tamanho original ao lado.** Os relatórios são texto de
-- largura fixa e comprimem cerca de dez para um — o 03.08.15 de uma quinzena
-- tem vinte e três mil linhas. `bytes_originais`, com o `sha256` que o
-- documento já guarda, torna a descompressão verificável: quem lê confere que
-- recuperou exatamente o que entrou.
--
-- **`on delete cascade` pelo documento**, que já cascateia da competência.
-- Descartar o que foi importado tem de levar o arquivo junto, ou o descarte
-- seria parcial e o disco cresceria para sempre.
--
-- **Sem backfill, e desta vez a ausência dói.** Os documentos importados antes
-- desta migration não têm conteúdo e não terão: os bytes não existem mais. Para
-- eles, reabrir continua exigindo o arquivo de quem enviou — o que é exatamente
-- o custo que esta tabela existe para não repetir.
--
-- A chave estrangeira entra no `DO $reentrante$` da `0043`, pela mesma razão: o
-- `bridge-up` aplica o statement isolado, e um `ADD CONSTRAINT` cru falharia na
-- segunda passagem.
--
-- `IF NOT EXISTS` como a `0039`, a `0043`, a `0044` e a `0045`, pela mesma
-- razão: a adoção de um banco que já a tem não pode travar a fila.

CREATE TABLE IF NOT EXISTS "fechamento_documento_conteudo" (
	"documento_id" uuid PRIMARY KEY NOT NULL,
	"conteudo" "bytea" NOT NULL,
	"bytes_originais" integer NOT NULL,
	"guardado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_documento_conteudo_documento_fk') THEN
		ALTER TABLE "fechamento_documento_conteudo"
			ADD CONSTRAINT "fechamento_documento_conteudo_documento_fk"
			FOREIGN KEY ("documento_id") REFERENCES "fechamento_documento"("id") ON DELETE CASCADE;
	END IF;
END
$reentrante$;