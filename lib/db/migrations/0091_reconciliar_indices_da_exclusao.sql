-- Reconciliar os quatro índices que o bridge tira das tabelas que ficam.
--
-- ---------------------------------------------------------------------------
-- O buraco que esta migration fecha — o mesmo da `0024` e da `0088`
-- ---------------------------------------------------------------------------
-- `bridgeDown` remove objetos que as migrations criam e **não toca no registro
-- de migrations**; `runMigrations` pula toda migration cujo `when` já está no
-- registro. Some-se: depois de um `down`, só o `up` devolve aqueles objetos — a
-- fila estruturalmente não consegue. Um `up` que não rode (deploy interrompido,
-- sessão perdida, esquecimento) deixa o banco divergente para sempre, com
-- `migrate` respondendo "nada a aplicar" e `/healthz` respondendo SAUDAVEL.
--
-- A `0024` fechou o buraco para o que existia até ela; cada objeto criado
-- **depois** dela e que entre na lista do bridge precisa da sua própria
-- reconciliação. É o que `reconciliacao-bridge.test.ts` cobra, item por item, e
-- é por isso que a reconciliação é sempre a última da fila: o que vale é ela
-- ser uma migration que o registro ainda não contém.
--
-- ---------------------------------------------------------------------------
-- O que se perde enquanto eles não voltam, e o que não se perde
-- ---------------------------------------------------------------------------
-- Nada de dado, e nada de regra: os quatro são índices comuns, sem unicidade e
-- sem constraint pendurada. O banco aceita exatamente o mesmo com ou sem eles.
--
-- O que se perde é desempenho, e num lugar específico: sem
-- `change_entity_only_idx`, a prévia de exclusão volta a varrer a tabela
-- `change` inteira para responder sobre os equipamentos de uma importação — que
-- é o defeito que a `0090` existe para corrigir. Um índice ausente aqui não
-- quebra tela nenhuma; ele deixa a tela lenta de novo, em silêncio, que é
-- justamente o tipo de regressão que ninguém liga a um deploy.
--
-- `IF NOT EXISTS` em todos: no caminho normal — sem `down` nenhum — a `0090` já
-- os criou, e esta migration não faz nada.

CREATE INDEX IF NOT EXISTS "change_entity_only_idx" ON "change" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_attribute_only_idx" ON "change" USING btree ("attribute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_first_seen_idx" ON "entity" USING btree ("first_seen_import_run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribute_first_seen_idx" ON "attribute" USING btree ("first_seen_import_run_id");
