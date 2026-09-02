-- Reconciliar os três índices que o bridge tira das tabelas que ficam.
--
-- ---------------------------------------------------------------------------
-- O buraco que esta migration fecha — o mesmo da `0024`, um item novo
-- ---------------------------------------------------------------------------
-- `bridgeDown` remove objetos que as migrations criam e **não toca no registro
-- de migrations**; `runMigrations` pula toda migration cujo `when` já está no
-- registro. Some-se: depois de um `down`, só o `up` devolve aqueles objetos — a
-- fila estruturalmente não consegue. Um `up` que não rode (deploy interrompido,
-- sessão perdida, esquecimento) deixa o banco divergente para sempre, com
-- `migrate` respondendo "nada a aplicar" e `/healthz` respondendo SAUDAVEL.
--
-- Foi assim que `attribute.definition` se perdeu em 16/08/2026. A `0024` fechou
-- o buraco para o que existia até ela; cada objeto criado **depois** dela e que
-- entre na lista do bridge precisa da sua própria reconciliação. É o que
-- `reconciliacao-bridge.test.ts` cobra, item por item.
--
-- ---------------------------------------------------------------------------
-- Por que só três índices, e nenhuma coluna
-- ---------------------------------------------------------------------------
-- A `0087` cria cinco tabelas, dez colunas, doze índices e quatro funções. Quase
-- nada disso passa por aqui, e a razão de cada ausência é diferente:
--
--   * **As dez colunas não saem no `down`.** São aditivas e nulas, então estão
--     na `ALLOWLIST` do bridge: o Publishing pode criá-las em Production sem
--     mudar nada que se meça, e por isso o `down` as mantém. O que a fila não
--     precisa devolver, esta migration não devolve.
--   * **Nove dos doze índices vivem nas cinco tabelas que o `down` derruba**, e
--     caem com elas. Quem as recria é o `bridge:up`, com o DDL da própria
--     `0087` — nunca uma segunda escrita da mesma definição.
--   * **As quatro funções** também são do `up`, pelo mesmo motivo.
--
-- Sobram os três índices que ficam em `ticket` e `ticket_import` — tabelas que o
-- `down` **não** derruba. Eles precisam sair por nome (o Publishing não modela
-- índice, e um que sobrasse apareceria no diff residual), e precisam voltar por
-- aqui, porque um banco que passou pelo `down` sem `up` já tem a `0087` no
-- registro e não a roda de novo.
--
-- ---------------------------------------------------------------------------
-- O que ela faz, e o que ela deliberadamente não faz
-- ---------------------------------------------------------------------------
-- Cria os três índices se não existirem. Só isso. Não escreve dado, não apaga
-- nada, não refaz o backfill da `0087` — reconciliação é estrutura, e um
-- `UPDATE` aqui rodaria em todo banco em dia por causa de um que não está.
--
-- O guarda de coluna existe porque a ordem entre `down` e fila não é garantida:
-- num banco onde a `0087` foi registrada e as colunas não chegaram (o mesmo
-- estado que esta migration existe para consertar, levado ao extremo), um
-- `CREATE INDEX` sobre coluna ausente estoura e trava a fila inteira. Sem a
-- coluna, o índice não faz falta; com ela, ele volta.

DO $reconciliar$
BEGIN
  -- A junção do diff do monitoramento: os chamados de um envio, pelo número.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ticket'
                AND column_name = 'external_id') THEN
    CREATE INDEX IF NOT EXISTS "ticket_import_external_idx"
      ON "ticket" USING btree ("ticket_import_id","external_id");
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ticket'
                AND column_name = 'unidade_raw') THEN
    CREATE INDEX IF NOT EXISTS "ticket_unidade_idx"
      ON "ticket" USING btree ("unidade_raw");
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ticket_import'
                AND column_name = 'serie') THEN
    CREATE INDEX IF NOT EXISTS "ticket_import_serie_idx"
      ON "ticket_import" USING btree ("serie","received_at");
  END IF;
END $reconciliar$;
