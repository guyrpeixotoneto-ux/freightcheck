-- ---------------------------------------------------------------------------
-- Justificativa: a regra, e não só a frase.
--
-- Até aqui justificar era escrever `texto` — uma frase livre que dizia por que
-- o valor mudou. A frase explica **aquela** alteração e morre ali: a próxima
-- vez que o mesmo atributo mudar, quem justifica começa do zero, e ninguém
-- consegue perguntar "esta alteração seguiu a regra que já estava escrita?"
-- porque não havia regra escrita em lugar nenhum.
--
-- O formulário passa a perguntar quatro coisas: como o valor se calcula
-- (`formula`), sob que condição ele pode mudar (`regra`), se esta alteração
-- seguiu essa condição (`conforme`) e, quando não seguiu, por quê e com o
-- aval de quem (`motivo_excecao`, `responsavel_aprovacao`).
--
-- `texto` continua existindo e continua NOT NULL: é o resumo legível que as
-- telas com espaço para uma linha só mostram — a tabela do FINAME, a fila do
-- painel, o export de Chamados. Quem grava pelo formulário novo o deriva dos
-- campos abaixo; quem gravou antes dele tem só a frase.
--
-- Todas as colunas são anuláveis, e é deliberado: as justificativas anteriores
-- a esta migration não têm regra nenhuma, e preencher uma para elas seria
-- afirmar uma decisão que ninguém tomou.
-- ---------------------------------------------------------------------------

ALTER TABLE "justificativa" ADD COLUMN IF NOT EXISTS "formula" text;--> statement-breakpoint
ALTER TABLE "justificativa" ADD COLUMN IF NOT EXISTS "regra" text;--> statement-breakpoint
ALTER TABLE "justificativa" ADD COLUMN IF NOT EXISTS "conforme" boolean;--> statement-breakpoint
ALTER TABLE "justificativa" ADD COLUMN IF NOT EXISTS "motivo_excecao" text;--> statement-breakpoint
ALTER TABLE "justificativa" ADD COLUMN IF NOT EXISTS "responsavel_aprovacao" text;
