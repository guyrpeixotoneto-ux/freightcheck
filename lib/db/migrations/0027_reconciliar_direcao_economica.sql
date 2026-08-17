-- Reconciliar as quatro colunas da direção econômica.
--
-- ---------------------------------------------------------------------------
-- Por que uma segunda reconciliação
-- ---------------------------------------------------------------------------
-- A `0024_reconciliar_bridge` fechou o buraco descrito nela: depois de um
-- `bridge:down` sem `bridge:up`, a fila de migrations estruturalmente não
-- devolve o que o `down` removeu, porque o registro já dá por aplicadas as
-- migrations que criaram aqueles objetos. A saída foi uma migration nova, com
-- `when` que registro nenhum contém, repondo tudo com `IF NOT EXISTS`.
--
-- O que aquela solução não podia prever é o que veio **depois** dela. A
-- `0026_direcao_economica` cria quatro colunas que o `down` também remove, e
-- ela é posterior à `0024`: num banco que já rodou a fila inteira e sofreu um
-- `down` sem `up`, nada mais as devolve. O registro dá a `0026` por aplicada, e
-- ela é a única que as cria.
--
-- Ou seja: **a reconciliação precisa ser a última da fila**, e toda coluna
-- criada depois dela reabre o buraco. Esta é a segunda, e o teste
-- `reconciliacao-bridge` passa a exigir que exista sempre uma cobrindo o que o
-- `down` remove — de modo que a terceira, se fizer falta, falhe no commit em
-- vez de num banco de produção meses depois.
--
-- Em banco saudável ela é no-op: os quatro comandos são `IF NOT EXISTS`, e a
-- `0026` já os criou. Custa uma varredura de catálogo.
--
-- Nenhum backfill, nenhuma constraint, nenhum índice: as colunas nascem nulas
-- por desenho, e quem as preenche é a curadoria. Repor a coluna vazia é
-- exatamente repor o que o `down` levou.

ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "economic_direction" text;--> statement-breakpoint
ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "economic_effect" text;--> statement-breakpoint
ALTER TABLE "attribute_semantics" ADD COLUMN IF NOT EXISTS "economic_direction" text;--> statement-breakpoint
ALTER TABLE "attribute_semantics" ADD COLUMN IF NOT EXISTS "economic_effect" text;
