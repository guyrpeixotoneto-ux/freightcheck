-- A verdade financeira, em três leituras nomeadas.
--
-- `calculated_impact_by_periodicity` era o total **bruto**: o `engine.ts` o
-- acumulava dentro do laço que descobre as alterações, antes de existir o
-- índice "que atributos mudaram em cada ativo", e por isso não aplicava
-- nenhuma regra de dupla contagem. O nome não dizia isso, e seis consumidores
-- o publicaram como "Impacto apurado" — em agosto/2026, R$ 39.936,28/mês onde
-- o dinheiro real era R$ 16.594,55/mês.
--
-- A coluna é **renomeada**, e não mantida com um campo novo ao lado, de
-- propósito: renomear quebra a compilação de todo consumidor que ainda a lê, e
-- obriga cada um a declarar qual das três leituras quer. Um campo novo ao lado
-- deixaria os seis publicando o número inflado, em silêncio, que é exatamente
-- o defeito que esta migração fecha.
ALTER TABLE "change_set"
  RENAME COLUMN "calculated_impact_by_periodicity" TO "impacto_bruto_by_periodicity";--> statement-breakpoint

-- A verdade financeira oficial: as regras de composição e de escopo de
-- conjunto aplicadas, por ativo. É o que toda tela, cartão, consolidado e
-- exportação publica.
ALTER TABLE "change_set"
  ADD COLUMN "impacto_oficial_by_periodicity" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

-- O rastro da dedução: explicação, não valor. Os subtotais intermediários
-- moram aqui dentro em vez de virarem colunas próprias — R$ 28.511,24 foi
-- publicado por meses como impacto líquido e não é, e uma coluna ao lado das
-- outras duas seria um convite a lê-lo como "impacto" de novo.
ALTER TABLE "change_set"
  ADD COLUMN "deducao_rastro" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

-- Contagem, não dinheiro: quantas alterações saíram da soma por dupla contagem.
ALTER TABLE "change_set"
  ADD COLUMN "mudancas_fora_do_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Marca as comparações já gravadas como pendentes de recálculo em vez de
-- copiar o bruto para o oficial. Copiar publicaria o número inflado sob o nome
-- novo — trocaria a mentira de lugar. `status = 'STALE'` faz a leitura recalcular.
UPDATE "change_set"
   SET "status" = 'STALE'
 WHERE "status" = 'DONE'
   AND "impacto_bruto_by_periodicity" <> '{}'::jsonb;
