-- ---------------------------------------------------------------------------
-- A invariante, imposta pelo banco.
-- ---------------------------------------------------------------------------
--
-- `0012` mediu; esta resolve e tranca. Ao final, é **estruturalmente
-- impossível** manter duas vigências ativas com a mesma identidade canônica.
--
-- O histórico não é apagado. Onde havia duas vigências ativas para a mesma
-- identidade — o caso real: um arquivo de carretas e um de cavalos entregues
-- para a mesma vigência, cada um virando uma identidade própria — as duas são
-- **fundidas numa revisão nova** que carrega os fatos de ambas, e as duas
-- originais passam a SUPERSEDED, inteiras, consultáveis, com a proveniência
-- registrada em `snapshot_merge`.
--
-- Fundir e não descartar é o ponto: descartar a mais antiga apagaria as
-- carretas daquela vigência. A fusão é a mesma operação que o `promote` passa a
-- fazer quando um arquivo parcial chega para uma vigência que já existe.

-- ---------------------------------------------------------------------------
-- 1. A proveniência da fusão
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "snapshot_merge" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  /**
   * A revisão criada pela fusão.
   *
   * `ON DELETE CASCADE` porque esta linha *descreve* aquela revisão: se a
   * importação que a criou for excluída, a revisão sai e a descrição dela
   * deixa de ter sujeito. A auditoria que não sai é `import_deletion`, que é
   * append-only e permanente.
   */
  "snapshot_id" uuid NOT NULL REFERENCES "snapshot"("id") ON DELETE CASCADE,
  /** As vigências que entraram nela, na ordem de precedência aplicada. */
  "merged_from" uuid[] NOT NULL,
  /** A revisão que cada origem tinha antes — a renumeração fica registrada. */
  "revisoes_originais" integer[] NOT NULL,
  /** O de-para completo da renumeração da identidade: {snapshot_id: {de, para}}. */
  "renumeracao" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "canonical_snapshot_key" text NOT NULL,
  "motivo" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

COMMENT ON TABLE "snapshot_merge" IS
  'Por que duas vigências ativas viraram uma. Cada linha responde "onde foram parar os dados da vigência X".';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. A fusão dos conflitos históricos
-- ---------------------------------------------------------------------------
-- Os índices antigos saem **antes** da fusão, e não depois.
--
-- Eles codificavam exatamente a definição de identidade que esta migration
-- substitui — rótulo literal, hash de escopo não normalizado e o conjunto de
-- tipos que por acaso veio no arquivo. Mantê-los não acrescenta proteção
-- nenhuma (a trava nova entra adiante, mais forte) e recusa a própria fusão: a
-- revisão fundida herda o rótulo e o `scope_hash` da origem mais recente, que
-- ainda está ativa no instante do INSERT, e `snapshot_business_key_live_uq`
-- barra as duas como se fossem a mesma vigência viva. Foi o que aconteceu no
-- caso de duas entregas com o mesmo conjunto de tipos e o rótulo escrito de
-- dois jeitos — `EMPURRADA_1_8_2026` e `EMPURRADA_01_8_2026` —, que é
-- justamente um dos casos que esta migration existe para resolver.
DROP INDEX IF EXISTS "snapshot_business_key_live_uq";--> statement-breakpoint
DROP INDEX IF EXISTS "snapshot_business_key_uq";--> statement-breakpoint

ALTER TABLE "snapshot" DISABLE TRIGGER "snapshot_immutable";--> statement-breakpoint
ALTER TABLE "fact" DISABLE TRIGGER "fact_immutable";--> statement-breakpoint

DO $$
DECLARE
  chave            text;
  origens          uuid[];
  revs             integer[];
  base             "snapshot"%ROWTYPE;
  nova_id          uuid;
  proxima_revisao  integer;
  tipos            text;
  n_entidades      integer;
  n_fatos          integer;
  renumeracao_mapa jsonb;
BEGIN
  FOR chave IN
    SELECT s."canonical_snapshot_key"
      FROM "snapshot" s
     WHERE s."status" <> 'SUPERSEDED'
     GROUP BY 1
    HAVING count(*) > 1
     ORDER BY 1
  LOOP
    -- Precedência: a mais recente ganha onde os fatos se sobrepõem. As mais
    -- antigas continuam contribuindo tudo o que a mais recente não tem.
    SELECT array_agg(s."id" ORDER BY s."created_at", s."revision", s."id"),
           array_agg(s."revision" ORDER BY s."created_at", s."revision", s."id")
      INTO origens, revs
      FROM "snapshot" s
     WHERE s."canonical_snapshot_key" = chave
       AND s."status" <> 'SUPERSEDED';

    SELECT * INTO base
      FROM "snapshot"
     WHERE "id" = origens[array_length(origens, 1)];

    SELECT coalesce(max("revision"), 0) + 1 INTO proxima_revisao
      FROM "snapshot"
     WHERE "canonical_snapshot_key" = chave;

    -- O conjunto de tipos da revisão fundida é a união dos conjuntos de origem.
    SELECT string_agg(DISTINCT t, '+' ORDER BY t) INTO tipos
      FROM "snapshot" s,
           unnest(string_to_array(s."entity_type_set", '+')) t
     WHERE s."id" = ANY(origens);

    INSERT INTO "snapshot" (
      "source_file_id", "import_run_id", "source_system", "source_label",
      "effective_date", "scope_hash", "entity_type_set", "revision",
      "supersedes_snapshot_id", "status",
      "dataset_family", "canal", "canonical_scope"
    ) VALUES (
      base."source_file_id", base."import_run_id", base."source_system", base."source_label",
      base."effective_date", base."scope_hash", tipos, proxima_revisao,
      base."id", 'DRAFT',
      base."dataset_family", base."canal", base."canonical_scope"
    ) RETURNING "id" INTO nova_id;

    INSERT INTO "snapshot_scope" ("snapshot_id", "scope_id")
    SELECT DISTINCT nova_id, ss."scope_id"
      FROM "snapshot_scope" ss
     WHERE ss."snapshot_id" = ANY(origens);

    -- Um fato por (entidade, atributo). `ordem` desempata pela precedência
    -- calculada acima: quanto mais recente a origem, maior a posição no array.
    INSERT INTO "fact" (
      "snapshot_id", "entity_id", "attribute_id", "value_numeric", "value_text",
      "value_boolean", "value_date", "value_hash", "is_null", "null_reason", "raw_cell_id"
    )
    SELECT DISTINCT ON (f."entity_id", f."attribute_id")
           nova_id, f."entity_id", f."attribute_id", f."value_numeric", f."value_text",
           f."value_boolean", f."value_date", f."value_hash", f."is_null", f."null_reason", f."raw_cell_id"
      FROM "fact" f
      JOIN unnest(origens) WITH ORDINALITY AS o(id, ordem) ON o.id = f."snapshot_id"
     ORDER BY f."entity_id", f."attribute_id", o.ordem DESC;

    INSERT INTO "snapshot_attribute" (
      "snapshot_id", "attribute_id", "source_sheet", "column_index",
      "present_in_layout", "value_count", "null_count"
    )
    SELECT DISTINCT ON (sa."attribute_id")
           nova_id, sa."attribute_id", sa."source_sheet", sa."column_index",
           sa."present_in_layout", sa."value_count", sa."null_count"
      FROM "snapshot_attribute" sa
      JOIN unnest(origens) WITH ORDINALITY AS o(id, ordem) ON o.id = sa."snapshot_id"
     ORDER BY sa."attribute_id", o.ordem DESC;

    SELECT count(DISTINCT "entity_id"), count(*) INTO n_entidades, n_fatos
      FROM "fact" WHERE "snapshot_id" = nova_id;

    UPDATE "snapshot"
       SET "status" = 'CLOSED', "closed_at" = now(),
           "entity_count" = n_entidades, "fact_count" = n_fatos
     WHERE "id" = nova_id;

    -- As origens saem de cena inteiras. Nada é apagado.
    UPDATE "snapshot" SET "status" = 'SUPERSEDED' WHERE "id" = ANY(origens);

    -- As origens eram revisões **paralelas**, todas de número 1, e um índice
    -- único por (identidade, revisão) não admite empate. A identidade inteira é
    -- renumerada de forma contígua na ordem cronológica, o que põe a revisão
    -- fundida por último e não deixa buraco nem empate. O de-para completo fica
    -- guardado — renumerar é mexer em registro de auditoria, e mexer sem deixar
    -- rastro seria pior do que o problema que isto resolve.
    WITH ordem AS (
      SELECT "id",
             "revision" AS de,
             row_number() OVER (ORDER BY "created_at", "id") AS para
        FROM "snapshot"
       WHERE "canonical_snapshot_key" = chave
    )
    SELECT jsonb_object_agg(o."id"::text, jsonb_build_object('de', o.de, 'para', o.para))
      INTO renumeracao_mapa
      FROM ordem o
     WHERE o.de IS DISTINCT FROM o.para::integer;

    WITH ordem AS (
      SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS para
        FROM "snapshot"
       WHERE "canonical_snapshot_key" = chave
    )
    UPDATE "snapshot" s
       SET "revision" = o.para
      FROM ordem o
     WHERE o."id" = s."id"
       AND s."revision" IS DISTINCT FROM o.para::integer;

    SELECT "revision" INTO proxima_revisao FROM "snapshot" WHERE "id" = nova_id;

    INSERT INTO "snapshot_merge" (
      "snapshot_id", "merged_from", "revisoes_originais", "renumeracao",
      "canonical_snapshot_key", "motivo"
    ) VALUES (
      nova_id, origens, revs, coalesce(renumeracao_mapa, '{}'::jsonb), chave,
      format(
        'Havia %s vigências ativas para a mesma identidade canônica, com conjuntos de tipos diferentes. Fundidas na revisão %s; as origens ficaram SUPERSEDED, inteiras, e as revisões da identidade foram renumeradas de forma contígua na ordem cronológica.',
        array_length(origens, 1), proxima_revisao
      )
    );

    RAISE NOTICE 'Fundidas % vigências ativas da identidade % na revisão % (% fatos).',
      array_length(origens, 1), left(chave, 12), proxima_revisao, n_fatos;
  END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE "fact" ENABLE TRIGGER "fact_immutable";--> statement-breakpoint
ALTER TABLE "snapshot" ENABLE TRIGGER "snapshot_immutable";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. A prova de que sobrou zero
-- ---------------------------------------------------------------------------
-- Se a fusão não deu conta de algum caso, a migration para aqui e diz qual.
-- Criar o índice adiante falharia de qualquer forma; falhar aqui nomeia a
-- identidade em vez de devolver "duplicate key value violates unique
-- constraint".
DO $$
DECLARE
  restante text;
BEGIN
  SELECT string_agg(format('%s (%s ativas, vigência %s)', left(canonical_snapshot_key, 12), ativos, effective_date), '; ')
    INTO restante
    FROM "freightcheck_snapshot_ativo_duplicado";
  IF restante IS NOT NULL THEN
    RAISE EXCEPTION
      'Ainda há identidades canônicas com mais de uma vigência ativa: %. Nada foi trancado; resolva-as e rode de novo.',
      restante
      USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. A trava
-- ---------------------------------------------------------------------------
-- No máximo uma vigência ativa por identidade canônica, e sem empate de
-- revisão dentro de uma identidade. Estas duas linhas são a garantia: elas não
-- dependem de nenhum caminho da aplicação estar correto.
--
-- Os dois índices estão no diff automático que o Publishing propõe, e por isso
-- podem já existir num banco que atravessou aquela proposta pela metade. Se
-- existirem com a definição esperada, são adotados; com qualquer outra
-- definição a migration para, porque um índice de identidade diferente do
-- declarado aqui tranca outra coisa — e "trancado" passaria a significar algo
-- que ninguém verificou.
DO $$
DECLARE
  esperado record;
  atual    text;
BEGIN
  FOR esperado IN
    SELECT * FROM (VALUES
      ('snapshot_canonical_live_uq',
       'CREATE UNIQUE INDEX snapshot_canonical_live_uq ON public.snapshot USING btree (canonical_snapshot_key) WHERE (status <> ''SUPERSEDED''::snapshot_status)',
       'CREATE UNIQUE INDEX "snapshot_canonical_live_uq" ON "snapshot" USING btree ("canonical_snapshot_key") WHERE "status" <> ''SUPERSEDED'''),
      ('snapshot_canonical_revision_uq',
       'CREATE UNIQUE INDEX snapshot_canonical_revision_uq ON public.snapshot USING btree (canonical_snapshot_key, revision)',
       'CREATE UNIQUE INDEX "snapshot_canonical_revision_uq" ON "snapshot" USING btree ("canonical_snapshot_key", "revision")')
    ) AS v(nome, definicao, criacao)
  LOOP
    SELECT pg_get_indexdef(i.indexrelid) INTO atual
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = esperado.nome;

    IF atual IS NULL THEN
      EXECUTE esperado.criacao;
    ELSIF replace(replace(lower(atual), ' ', ''), '"', '')
       <> replace(replace(lower(esperado.definicao), ' ', ''), '"', '') THEN
      RAISE EXCEPTION
        E'O índice % já existe com outra definição.\n  encontrada: %\n  esperada:   %\n\nNada foi trancado e nada foi alterado. Remova-o ou alinhe-o e rode de novo.',
        esperado.nome, atual, esperado.definicao
        USING ERRCODE = 'data_exception';
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Auditoria da decisão
-- ---------------------------------------------------------------------------
-- "Por que esse arquivo não entrou?" tem de ter resposta sem ler log. Uma linha
-- por decisão do pipeline, com tudo o que a sustentou.
CREATE TABLE IF NOT EXISTS "import_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_run_id" uuid NOT NULL REFERENCES "import_run"("id") ON DELETE CASCADE,
  /** RECEBIDO, DUPLICATA_DE_ARQUIVO, DUPLICATA_DE_DADOS, VIGENCIA_ATIVA_EXISTENTE,
      ESCOPO_OBRIGATORIO_AUSENTE, ENTIDADE_CONFLITANTE, PROMOVIDO, REVISAO_CRIADA. */
  "decisao" text NOT NULL,
  "motivo" text NOT NULL,
  "filename" text,
  "content_sha256" text,
  "canonical_payload_hash" text,
  "canonical_snapshot_key" text,
  "source_label" text,
  "effective_date" date,
  "canal" text,
  "dataset_family" text,
  "canonical_scope" jsonb,
  "snapshot_id" uuid,
  "revision_encontrada" integer,
  "revision_criada" integer,
  "detalhe" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX "import_decision_run_idx" ON "import_decision" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "import_decision_key_idx" ON "import_decision" USING btree ("canonical_snapshot_key");--> statement-breakpoint
CREATE INDEX "import_decision_sha_idx" ON "import_decision" USING btree ("content_sha256");--> statement-breakpoint
