-- Reconciliar o que a 0064 e a 0065 criam e o bridge remove.
--
-- É o mesmo buraco da `0024`, da `0027`, da `0029`, da `0034`, da `0038`, da
-- `0041`, da `0050`, da `0052` e da `0063`, e ele não fecha sozinho:
-- `bridgeDown` remove objetos que as migrations criam e **não toca no
-- registro**; `runMigrations()` pula toda migration cujo carimbo já está
-- registrado. Depois de um `down` sem `up`, só o `up` devolveria aqueles
-- objetos — a fila estruturalmente não consegue, e `migrate` responderia "nada
-- a aplicar" sobre um banco divergente.
--
-- O que passou a sair no `down`, e por quê:
--
--   * `change.economic_direction` e `change.economic_effect` (0064) — nuláveis
--     e sem default, que é a forma que a allowlist do bridge aceita, e mesmo
--     assim saem, pelo motivo que a `0023` já registrou: a allowlist é uma
--     lista fechada conferida por tipo, e não um lugar onde coluna nova cabe.
--
-- `alteracao_visivel` já saía no `down` desde a `0061` e volta aqui com a
-- definição da `0065` — não com a da `0061`. É essa a diferença que este
-- arquivo existe para não deixar em aberto: o `up` levantava o `CREATE VIEW`
-- da `0061`, anterior ao filtro NEUTRAL, e um banco que passasse por
-- `down`/`up` ficava com a view antiga enquanto um banco novo nascia com a
-- nova. As duas se chamam `alteracao_visivel` e contam coisas diferentes.
--
-- Uma migration nova, e não uma edição da `0063`, pelo motivo de sempre nesta
-- fila: a `0063` já está registrada em todo banco que a aplicou, e reescrevê-la
-- não a faz rodar de novo em nenhum deles — a decisão de rodar é pelo carimbo,
-- nunca pelo conteúdo.
--
-- Num banco íntegro esta migration é um não-evento: cada comando é idempotente
-- por construção e a view é recriada idêntica.

-- ---------------------------------------------------------------------------
-- 1. As duas colunas da direção econômica em `change`, da `0064`.
-- ---------------------------------------------------------------------------
--
-- Nuláveis e sem backfill, exatamente como a `0064` as criou: change-sets
-- anteriores ficam com `NULL`, que o Radar já trata como "não classificado" —
-- o mesmo estado de quem nunca foi curado, e não "não conta".
ALTER TABLE "change" ADD COLUMN IF NOT EXISTS "economic_direction" text;--> statement-breakpoint
ALTER TABLE "change" ADD COLUMN IF NOT EXISTS "economic_effect" text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `alteracao_visivel`, na definição da `0065`.
-- ---------------------------------------------------------------------------
--
-- O `DROP` antes do `CREATE` é o que torna esta migration repetível: um banco
-- que já tem a view morreria em `relation already exists`. O `RESTRICT` fica
-- implícito (é o padrão) e é o que se quer — nada deve depender dela.
DROP VIEW IF EXISTS "alteracao_visivel";--> statement-breakpoint

CREATE VIEW "alteracao_visivel" AS
  SELECT c.*
    FROM "change" c
   WHERE (c."fact_a_id" IS NULL OR c."fact_a_id" NOT IN (SELECT id FROM "fato_oculto"))
     AND (c."fact_b_id" IS NULL OR c."fact_b_id" NOT IN (SELECT id FROM "fato_oculto"))
     AND c."economic_direction" IS DISTINCT FROM 'NEUTRAL';--> statement-breakpoint

COMMENT ON VIEW "alteracao_visivel" IS
  'As alterações que contam. Exclui as que citam um fato nascido em importação oculta e as classificadas NEUTRAL (cadastro/identificação, sem grandeza econômica) — sem recalcular nem apagar o `change_set` gravado, nem a linha em `change`, que continuam completos para histórico e proveniência.';
