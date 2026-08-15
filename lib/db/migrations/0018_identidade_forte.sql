-- ---------------------------------------------------------------------------
-- As constraints da identidade nos bancos que já passaram pela 0015.
-- ---------------------------------------------------------------------------
--
-- A `0015` ganhou a validação explícita do backfill e as quatro constraints que
-- fecham identidade vazia — `canal` e `dataset_family` em branco,
-- `canonical_scope` fora da forma canônica ou `[]`. Um banco que ainda não a
-- aplicou recebe tudo por lá.
--
-- Um banco que **já** a aplicou, não: o registro é por carimbo, e uma migration
-- aplicada não roda de novo. Sem esta aqui, desenvolvimento e produção ficariam
-- com conjuntos diferentes de constraints — a deriva de schema que este projeto
-- inteiro existe para não ter.
--
-- Por isso ela é escrita para os dois casos: onde a `0015` nova já criou as
-- constraints, esta não faz nada; onde a `0015` antiga passou, ela completa. A
-- validação roda dos dois jeitos, porque nenhuma inspeção de schema prova que o
-- dado está são.

-- ---------------------------------------------------------------------------
-- 1. A validação, de novo e nos mesmos termos da 0015
-- ---------------------------------------------------------------------------
-- Uma constraint entra validando as linhas que já existem: sem este passo, a
-- primeira notícia de uma vigência inválida seria um `check constraint ... is
-- violated by some row`, que não diz qual linha nem por quê.
DO $$
DECLARE
  problemas text;
  quantas   integer;
BEGIN
  WITH todas AS (
    SELECT s."id", s."source_label",
      CASE
        WHEN s."dataset_family" IS NULL THEN 'dataset_family nulo'
        WHEN btrim(s."dataset_family") = '' THEN 'dataset_family vazio ou só espaço'
        WHEN s."canal" IS NULL THEN 'canal nulo'
        WHEN btrim(s."canal") = '' THEN 'canal vazio — o rótulo não produz canal nenhum depois de normalizado'
        WHEN s."canonical_scope" IS NULL THEN 'canonical_scope nulo'
        WHEN jsonb_typeof(s."canonical_scope") <> 'array' THEN 'canonical_scope não é um array JSON'
        WHEN s."canonical_scope" <> freightcheck_canonical_scope(s."canonical_scope") THEN 'canonical_scope fora da forma canônica'
        WHEN jsonb_array_length(s."canonical_scope") = 0 THEN 'sem escopo — a vigência não diz de quem é a remuneração, e duas unidades diferentes teriam a mesma identidade'
      END AS motivo
      FROM "snapshot" s
  ),
  invalidas AS (SELECT * FROM todas WHERE motivo IS NOT NULL)
  SELECT
    (SELECT count(*) FROM invalidas),
    (SELECT string_agg(
              format('id=%s rótulo=%L motivo=%s', "id", "source_label", motivo),
              E'\n  ' ORDER BY "source_label", "id")
       FROM (SELECT * FROM invalidas ORDER BY "source_label", "id" LIMIT 50) x)
    INTO quantas, problemas;

  IF quantas > 0 THEN
    RAISE EXCEPTION
      E'A identidade canônica não fecha para % vigência(s):\n  %\n\nNada foi alterado. Corrija a origem — o rótulo (`source_label`) e o escopo (`snapshot_scope`) são de onde a identidade se deriva — e rode de novo.',
      quantas, problemas
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. As constraints, adotadas ou criadas
-- ---------------------------------------------------------------------------
-- O mesmo bloco da `0015`, com o mesmo critério: existindo com a definição
-- esperada, adota; existindo com outra, aborta nomeando a diferença.
DO $$
DECLARE
  esperado record;
  atual    text;
  norm     text;
BEGIN
  FOR esperado IN
    SELECT * FROM (VALUES
      ('snapshot_canonical_scope_ck',
       'CHECK ((canonical_scope = freightcheck_canonical_scope(canonical_scope)))'),
      ('snapshot_canal_nao_vazio_ck',
       'CHECK ((btrim(canal) <> ''''::text))'),
      ('snapshot_dataset_family_nao_vazio_ck',
       'CHECK ((btrim(dataset_family) <> ''''::text))'),
      ('snapshot_canonical_scope_nao_vazio_ck',
       'CHECK ((jsonb_array_length(canonical_scope) > 0))')
    ) AS v(nome, definicao)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO atual
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = 'snapshot' AND c.conname = esperado.nome;

    IF atual IS NULL THEN
      EXECUTE format(
        'ALTER TABLE "snapshot" ADD CONSTRAINT %I %s', esperado.nome, esperado.definicao);
      RAISE NOTICE 'Constraint % criada.', esperado.nome;
    ELSE
      norm := replace(replace(replace(lower(atual), ' ', ''), '"', ''), '::text', '');
      IF norm <> replace(replace(replace(lower(esperado.definicao), ' ', ''), '"', ''), '::text', '') THEN
        RAISE EXCEPTION
          E'A constraint % já existe em "snapshot" com outra definição.\n  encontrada: %\n  esperada:   %\n\nEsta migration não substitui constraint que ela não escreveu. Confira de onde veio, remova-a ou alinhe-a, e rode de novo. Nada foi alterado.',
          esperado.nome, atual, esperado.definicao
          USING ERRCODE = 'data_exception';
      END IF;
    END IF;
  END LOOP;
END $$;
