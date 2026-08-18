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
-- A coluna física **não** é renomeada, e a decisão custou três tentativas.
--
-- Renomear `calculated_impact_by_periodicity` para `impacto_bruto_by_periodicity`
-- era mais bonito e quebrou três propriedades que este repositório protege:
--
--   1. a reentrância da `0004`, que a criou com `ADD COLUMN IF NOT EXISTS` — o
--      nome antigo ficava livre e ela o recriava numa reaplicação da fila;
--   2. a adoção da `0004`, que passa a não ter nenhum objeto seu de pé para
--      provar que rodou (`registro-perdido.test.ts`);
--   3. a paridade com Production, que está parada na `0012` e tem a coluna com o
--      nome antigo — o `bridge down` sabe **remover** coluna, não desrenomear
--      (`bridge.test.ts`).
--
-- O que a renomeação comprava era obrigar todo consumidor a se declarar, e isso
-- já vem de graça no `@workspace/db`: a coluna é lida como
-- `impactoBrutoByPeriodicity` no schema do drizzle, com o nome físico antigo
-- entre aspas. Trocar o nome do campo quebra a compilação de quem ainda lê o
-- campo velho — que era o objetivo — sem mexer numa fila de migrations que
-- outras três propriedades atravessam.

-- A verdade financeira oficial: as regras de composição e de escopo de
-- conjunto aplicadas, por ativo. É o que toda tela, cartão, consolidado e
-- exportação publica.
ALTER TABLE "change_set"
  ADD COLUMN IF NOT EXISTS "impacto_oficial_by_periodicity" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

-- O rastro da dedução: explicação, não valor. Os subtotais intermediários
-- moram aqui dentro em vez de virarem colunas próprias — R$ 28.511,24 foi
-- publicado por meses como impacto líquido e não é, e uma coluna ao lado das
-- outras duas seria um convite a lê-lo como "impacto" de novo.
ALTER TABLE "change_set"
  ADD COLUMN IF NOT EXISTS "deducao_rastro" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

-- Contagem, não dinheiro: quantas alterações saíram da soma por dupla contagem.
ALTER TABLE "change_set"
  ADD COLUMN IF NOT EXISTS "mudancas_fora_do_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Marca as comparações já gravadas como pendentes de recálculo em vez de
-- copiar o bruto para o oficial. Copiar publicaria o número inflado sob o nome
-- novo — trocaria a mentira de lugar. `status = 'STALE'` faz a leitura recalcular.
-- `impacto_oficial_by_periodicity = '{}'` é a condição que torna isto
-- reentrante **e** correto: só marca quem ainda não tem oficial calculado.
-- Sem ela, uma segunda passada devolveria a STALE comparações já recalculadas.
UPDATE "change_set"
   SET "status" = 'STALE'
 WHERE "status" = 'DONE'
   AND "calculated_impact_by_periodicity" <> '{}'::jsonb
   AND "impacto_oficial_by_periodicity" = '{}'::jsonb;
