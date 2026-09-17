-- ---------------------------------------------------------------------------
-- A DECISÃO DO REAL, APLICADA — o alcance medido e o desfecho gravado.
-- ---------------------------------------------------------------------------
--
-- A `0104` trouxe `financiamento_real_decisao`: quem decidiu, sobre que chave,
-- por quê e quando. O que ela não guarda é o que a decisão **moveu** — e as
-- duas perguntas que a auditoria faz seis meses depois são exatamente essas:
-- *que meses isto mudou* e *quando isto virou número na tela*.
--
-- ---------------------------------------------------------------------------
-- Por que o alcance é medido e guardado, e não consultado depois
-- ---------------------------------------------------------------------------
--
-- Porque a mesma consulta rodada hoje responde sobre o extrato de hoje.
-- "Classifiquei a RPO0J60 como CAVALO" não diz que meses ela alcançou; refazer
-- a conta em março de 2027, sobre um acervo que ganhou mais três releituras,
-- responderia outra coisa — e responderia com cara de verdade. `competencias`
-- e `lancamentos_afetados` são a fotografia do que estava pendente no instante
-- em que alguém decidiu, que é o único momento em que essa fotografia existe.
--
-- ---------------------------------------------------------------------------
-- Por que decidir e aplicar são duas colunas, e não uma
-- ---------------------------------------------------------------------------
--
-- Porque são dois atos, e um deles pode falhar sozinho. Decidir é dizer de que
-- tipo é o ativo; aplicar é abrir a revisão da vigência que passa a contá-lo —
-- os fatos de uma vigência ativa são imutáveis por gatilho (`0001`), então
-- aplicar **é** abrir revisão nova, nunca editar a que está de pé.
--
-- A tela faz as duas num clique. O histórico continua sabendo distinguir: uma
-- decisão registrada e não aplicada — porque outra leitura do arquivo estava
-- aberta, porque a revisão foi recusada — é um estado real da operação, e é o
-- que `aplicada_em IS NULL` descreve, sem inventar um desfecho que não houve.
--
-- ---------------------------------------------------------------------------
-- Aditivas e nulas, como todas as da allowlist
-- ---------------------------------------------------------------------------
--
-- Sem backfill, e a ausência dele é a informação: as decisões tomadas antes
-- desta migration não tiveram alcance medido e não passaram por aplicação
-- nenhuma. Preenchê-las em massa afirmaria o contrário sobre linhas em que
-- ninguém afirmou nada — a mesma recusa da `0099`, da `0101` e da `0104`.
--
-- `aplicacao_run_id` não tem FK de propósito. O run é da camada de importação e
-- pode ser excluído com ela; a decisão não vai junto, e sacrificar a decisão
-- para preservar um ponteiro inverteria a ordem de importância das duas — que é
-- justamente o corte que a `0104` fez ao separar as tabelas.
-- ---------------------------------------------------------------------------

ALTER TABLE "financiamento_real_decisao" ADD COLUMN IF NOT EXISTS "competencias" text[];--> statement-breakpoint
ALTER TABLE "financiamento_real_decisao" ADD COLUMN IF NOT EXISTS "lancamentos_afetados" integer;--> statement-breakpoint
ALTER TABLE "financiamento_real_decisao" ADD COLUMN IF NOT EXISTS "aplicada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financiamento_real_decisao" ADD COLUMN IF NOT EXISTS "aplicada_por" text;--> statement-breakpoint
ALTER TABLE "financiamento_real_decisao" ADD COLUMN IF NOT EXISTS "aplicacao_run_id" uuid;--> statement-breakpoint
ALTER TABLE "financiamento_real_decisao" ADD COLUMN IF NOT EXISTS "aplicacao_resultado" jsonb;
