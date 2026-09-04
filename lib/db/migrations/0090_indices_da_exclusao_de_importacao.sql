-- ---------------------------------------------------------------------------
-- OS ÍNDICES QUE A EXCLUSÃO DE IMPORTAÇÃO PEDE — e nenhuma linha de dado.
-- ---------------------------------------------------------------------------
--
-- A prévia de exclusão ("o que sairia se eu apagar este arquivo?") precisa
-- responder duas perguntas sobre cada equipamento e cada coluna que a
-- importação tocou: "sobra fato de outra importação?" e "sobra alteração de
-- outra comparação?". A segunda não tinha índice que servisse.
--
-- `change_entity_idx` e `change_attribute_idx` existem, mas com `change_set_id`
-- na frente: eles servem à leitura das telas de comparação — "as alterações
-- deste conjunto, por equipamento" —, em que o conjunto é conhecido. A
-- exclusão pergunta sem saber o conjunto, justamente porque o que ela quer
-- saber é se existe alteração em *qualquer outro*. Para essa pergunta um
-- índice ancorado no `change_set_id` não é aproveitável, e o banco caía em
-- varredura da tabela `change` inteira — 1,1 milhão de linhas lidas, com hash
-- vazando para disco, para responder sobre 2.000 equipamentos.
--
-- Os dois `first_seen_import_run_id` são o outro lado da mesma consulta: eles
-- é que tornam barato o passo que nomeia os candidatos (quem esta importação
-- criou), e sem eles a inversão da consulta em `orphanEntityIds` trocaria uma
-- varredura por outra.
--
-- ---------------------------------------------------------------------------
-- Sobre o bloqueio
-- ---------------------------------------------------------------------------
--
-- A fila de migrations deste repositório roda uma transação por migration
-- (ver `migrate.ts`), e `CREATE INDEX CONCURRENTLY` não pode rodar dentro de
-- transação. Então estes são `CREATE INDEX` comuns: cada um segura um
-- ShareLock na tabela enquanto constrói, o que barra escrita — não leitura —
-- pelo tempo da construção. É o mesmo custo de toda migration de índice deste
-- schema, e ele recai sobre a importação, que é operação de janela, não sobre
-- as telas.
--
-- `IF NOT EXISTS` em todos: um banco onde alguém já criou o índice à mão para
-- apagar o incêndio não pode ver a fila inteira travar por isso.

CREATE INDEX IF NOT EXISTS "change_entity_only_idx" ON "change" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_attribute_only_idx" ON "change" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_first_seen_idx" ON "entity" USING btree ("first_seen_import_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribute_first_seen_idx" ON "attribute" USING btree ("first_seen_import_run_id");
