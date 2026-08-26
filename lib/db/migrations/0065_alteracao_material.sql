-- `alteracao_visivel` passa a excluir também as alterações NEUTRAL.
--
-- `economic_direction` já é snapshotado em `change` desde a 0064 — o Radar de
-- Trechos já o lê para separar "alteração material" (o valor mede grandeza
-- econômica) de cadastro puro (`trecho.origem`, `trecho.destino`,
-- `unidade_nome`, `operador_nome`, `chave_trecho`, `observacao` e o resto da
-- lista NEUTRAL de `direcao-economica-trecho.ts`). O mesmo cadastro existe em
-- CAVALO e CARRETA — placa, chassi, nome de operador — e nenhuma tela fora do
-- Radar filtrava por ele: o Dashboard, o Resumo executivo, o Painel de
-- Unidades, a Linha do Tempo e o Acompanhamento contavam uma troca de
-- operador ou uma correção de grafia de destino como se fosse a mesma coisa
-- que um reajuste de tarifa — inflando "alterações" com ruído que nunca vira
-- dinheiro nem muda o veredito de nada.
--
-- A view já é o lugar certo: o seu próprio comentário diz "as alterações que
-- contam", e todo leitor que soma ou agrupa "quantas alterações" — em vez de
-- listar cada uma — já passa por aqui. `change` cru continua com a linha
-- inteira, sem filtro nenhum: histórico, auditoria e proveniência (a
-- Planilha de Alterações, `getChangeProvenance`, o Radar) leem a tabela
-- direto e continuam vendo cada troca de cadastro, exatamente como hoje.
--
-- `IS DISTINCT FROM 'NEUTRAL'` para não perder change-sets antigos: a 0064
-- não fez backfill de propósito, e `economic_direction = NULL` continua
-- significando "não classificado" — o mesmo estado de quem nunca foi curado,
-- e não "não conta". Só a curadoria explícita como NEUTRAL sai da soma.

DROP VIEW IF EXISTS "alteracao_visivel";--> statement-breakpoint

CREATE VIEW "alteracao_visivel" AS
  SELECT c.*
    FROM "change" c
   WHERE (c."fact_a_id" IS NULL OR c."fact_a_id" NOT IN (SELECT id FROM "fato_oculto"))
     AND (c."fact_b_id" IS NULL OR c."fact_b_id" NOT IN (SELECT id FROM "fato_oculto"))
     AND c."economic_direction" IS DISTINCT FROM 'NEUTRAL';--> statement-breakpoint

COMMENT ON VIEW "alteracao_visivel" IS
  'As alterações que contam. Exclui as que citam um fato nascido em importação oculta e as classificadas NEUTRAL (cadastro/identificação, sem grandeza econômica) — sem recalcular nem apagar o `change_set` gravado, nem a linha em `change`, que continuam completos para histórico e proveniência.';
