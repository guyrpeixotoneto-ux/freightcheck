-- Reconciliar o que a 0032 cria e o bridge remove.
--
-- É o mesmo buraco da `0024`, da `0027` e da `0029`, e ele não fecha sozinho:
-- `bridgeDown` remove objetos que as migrations criam e **não toca no
-- registro**; `runMigrations()` pula toda migration cujo carimbo já está
-- registrado. Depois de um `down` sem `up`, só o `up` devolveria aquelas
-- colunas — a fila estruturalmente não consegue, e `migrate` responderia "nada
-- a aplicar" sobre um banco divergente.
--
-- A `0032` acrescentou três colunas a `change_set`, e as três saem no `down`
-- porque o contrato com o Publishing é "seis ADD COLUMN e nada mais". Sem esta
-- migration a lista do bridge teria crescido em silêncio, que é exatamente o
-- que `reconciliacao-bridge.test.ts` existe para impedir.
--
-- Uma migration nova, e não uma edição da `0029`, pelo motivo de sempre nesta
-- fila: a `0029` já está registrada em todo banco que a aplicou, e reescrevê-la
-- não a faz rodar de novo em nenhum deles — a decisão de rodar é pelo carimbo,
-- nunca pelo conteúdo.
--
-- Só estrutura. O conteúdo destas colunas é dado derivado: quem recompuser a
-- comparação as reescreve, e a `0032` já marca como `STALE` o que precisa disso.
ALTER TABLE "change_set" ADD COLUMN IF NOT EXISTS "impacto_oficial_by_periodicity" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "change_set" ADD COLUMN IF NOT EXISTS "deducao_rastro" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "change_set" ADD COLUMN IF NOT EXISTS "mudancas_fora_do_total" integer DEFAULT 0 NOT NULL;
