-- ---------------------------------------------------------------------------
-- O REGISTRO DA NORMALIZAÇÃO DO NOME GERENCIAL — e nenhuma linha de dado.
-- ---------------------------------------------------------------------------
--
-- `attribute.display_name` é apelido de leitura: o nome que quem opera dá à
-- coluna, quando `valorPisCofins` não é o que se fala numa reunião. A promoção
-- criava a coluna com `display_name = source_name`, e um campo que nasce
-- preenchido com a resposta errada é pior do que um campo vazio, porque parece
-- respondido — na tela de curadoria o card exibia `periodoFiname ·
-- periodoFiname`. Isso foi corrigido no `promote`: daqui para a frente a coluna
-- nasce com o campo nulo, e as telas caem no nome de origem, como sempre
-- souberam fazer.
--
-- ---------------------------------------------------------------------------
-- Por que esta migration NÃO limpa o legado
-- ---------------------------------------------------------------------------
--
-- A limpeza precisaria distinguir a cópia que a máquina escreveu de um nome que
-- uma pessoa salvou à mão — e que pode, por coincidência banal, ser idêntico ao
-- nome de origem. Pelo valor as duas linhas são iguais. O que as separaria é o
-- rastro: `saveMeaning` é o único caminho de escrita humana em `display_name` e
-- grava um `curation_event` com `field = 'display_name'` na mesma transação.
--
-- Esse rastro é sólido para tudo que este repositório consegue auditar — dentro
-- de toda a história do git, `saveMeaning` sempre escreveu o evento. Só que o
-- primeiro commit já traz **81 migrations** e o registro de semânticas cita
-- confirmações de 10/08/2026, três semanas antes dele: o produto rodou em
-- produção antes de existir esta história. O que se passou naquele período não
-- é auditável daqui, e "não há evento" pode significar tanto "a máquina
-- escreveu" quanto "uma pessoa escreveu antes de o log existir".
--
-- Uma migration não é o lugar de apostar nessa diferença. Ela roda sozinha, no
-- deploy, sem ninguém olhando e sem chance de conferir o banco antes — e o que
-- ela apagaria é curadoria, que não se reimporta. Então ela não apaga nada: o
-- legado fica inteiro, e a normalização vira uma rotina explícita, com
-- preflight somente-leitura contra o banco de verdade, aplicação assinada e
-- volta atrás exata. Ver `normalizarNomeGerencial`, em
-- `lib/curation/src/nome-gerencial.ts`.
--
-- ---------------------------------------------------------------------------
-- O que esta tabela guarda
-- ---------------------------------------------------------------------------
--
-- Uma linha por coluna cujo Nome Gerencial a rotina apagou, com o valor
-- apagado. É o que torna o rollback exato: restaurar lê daqui e alcança
-- exatamente o conjunto que foi tocado — nem uma linha a mais. A volta atrás
-- ingênua (`SET display_name = source_name WHERE display_name IS NULL`) atinge
-- também o que já era nulo por direito e todo atributo criado sob a regra nova,
-- que nasce nulo de propósito: ela não desfaz a normalização, reinstala o
-- defeito num conjunto maior.
--
-- Sem chave estrangeira para `attribute`, pela mesma razão de
-- `import_deletion`: excluir uma importação pode levar a coluna embora, e uma
-- FK faria essa exclusão falhar por causa de uma linha de auditoria. O código
-- do atributo fica gravado como texto para a linha continuar legível quando o
-- id que ela nomeia já não existir.
--
-- DDL pura: nenhum `UPDATE`, nenhum `INSERT`, nenhum backfill. Aplicar esta
-- migration não muda uma única linha de dado em lugar nenhum.

CREATE TABLE IF NOT EXISTS "nome_gerencial_normalizado" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attribute_id" uuid NOT NULL,
	"attribute_code" text NOT NULL,
	"source_name" text NOT NULL,
	"display_name_antes" text NOT NULL,
	"normalizado_por" text NOT NULL,
	"normalizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"restaurado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nome_gerencial_normalizado_attribute_idx" ON "nome_gerencial_normalizado" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nome_gerencial_normalizado_em_idx" ON "nome_gerencial_normalizado" USING btree ("normalizado_em");
