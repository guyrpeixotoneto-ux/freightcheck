-- Falhas, gargalos e informações — três colunas onde havia uma de observações.
--
-- `observacoes` era o depósito da etapa: cabia ali o erro que costuma acontecer,
-- a fila que atrasa, a instrução que quem executa precisa saber, e a frase de
-- "a validar". Tudo junto num texto só, o processo inteiro fica **legível** e
-- **inconsultável**: não há como perguntar quais são as principais falhas do
-- processo, onde estão os maiores gargalos, ou quais etapas concentram mais
-- problemas, porque as três coisas são a mesma coluna.
--
-- São dimensões diferentes de um processo, e a separação é o que as torna
-- somáveis:
--
--   falhas      — erros, retrabalhos, desvios, o que pode dar errado aqui;
--   gargalos    — esperas, filas, dependências, limitação de capacidade;
--   informacoes — contexto, particularidades, instruções complementares.
--
-- ---------------------------------------------------------------------------
-- O que acontece com o que já está escrito
-- ---------------------------------------------------------------------------
--
-- Nada é apagado, e nada é sobrescrito. A coluna `observacoes` **continua
-- existindo com o conteúdo que tem** — este arquivo não a remove, não a
-- esvazia e não a renomeia. O que ele faz é **copiar** o texto para
-- `informacoes`, que é a das três dimensões que aceita qualquer coisa: um texto
-- livre e antigo pode conter falha, gargalo e contexto misturados, e adivinhar
-- em qual das três cada frase cai seria inventar uma classificação que ninguém
-- fez. Quem abrir a etapa vê o texto onde sempre esteve, com um título honesto,
-- e recorta dali para "Falhas" e "Gargalos" quando quiser.
--
-- A cópia é condicionada a `informacoes` estar vazia. É o que torna esta
-- migration repetível sem estragar nada: rodar de novo depois de alguém já ter
-- reescrito as informações da etapa não desfaz a reescrita.
--
-- `IF NOT EXISTS` pela mesma razão da `0069`: o diff do Publishing pode ter
-- criado as colunas antes de a fila chegar aqui, e sem ele a migration morre com
-- 42701 num banco que já está exatamente onde ela queria deixá-lo.
ALTER TABLE "fluxo_etapa" ADD COLUMN IF NOT EXISTS "falhas" text;
--> statement-breakpoint
ALTER TABLE "fluxo_etapa" ADD COLUMN IF NOT EXISTS "gargalos" text;
--> statement-breakpoint
ALTER TABLE "fluxo_etapa" ADD COLUMN IF NOT EXISTS "informacoes" text;
--> statement-breakpoint
UPDATE "fluxo_etapa"
   SET "informacoes" = "observacoes"
 WHERE "observacoes" IS NOT NULL
   AND btrim("observacoes") <> ''
   AND ("informacoes" IS NULL OR btrim("informacoes") = '');
