CREATE TABLE IF NOT EXISTS "entity_type_correction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_entity_type" text NOT NULL,
	"to_entity_type" text NOT NULL,
	"attributes_renamed" integer DEFAULT 0 NOT NULL,
	"attributes_skipped" integer DEFAULT 0 NOT NULL,
	"entities_renamed" integer DEFAULT 0 NOT NULL,
	"snapshots_renamed" integer DEFAULT 0 NOT NULL,
	"snapshots_skipped" integer DEFAULT 0 NOT NULL,
	"changes_relabelled" integer DEFAULT 0 NOT NULL,
	"staged_facts_renamed" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_by" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Corrigir a identidade de um equipamento, sem reescrever o passado
-- ---------------------------------------------------------------------------
-- A regra que derivava o tipo do nome da aba tomava o nome inteiro como sendo
-- o tipo: `Modelo_Carreta` virava MODELOCARRETA, um equipamento paralelo ao
-- que já existia, com as mesmas colunas e os mesmos ativos. A regra foi
-- corrigida na ingestão, mas corrigir uma regra não reescreve o que já entrou
-- com ela — e reimportar também não resolve, porque o ativo é reconhecido pela
-- placa: a reimportação reaproveita a mesma linha de `entity`, com o tipo
-- errado ainda gravado nela.
--
-- Esta função move a identidade, e só a identidade:
--
--   * `attribute`  — o código (`modelocarreta.chassi` -> `carreta.chassi`) e o
--                    tipo. Os fatos apontam para o `attribute.id`, que não
--                    muda, então nenhum valor é tocado.
--   * `entity`     — o tipo do ativo. A placa e o histórico ficam onde estão.
--   * `change`     — as cópias desnormalizadas que a listagem lê.
--   * `staged_fact`— importações preparadas e ainda não promovidas, que senão
--                    voltariam a criar a identidade antiga na promoção.
--   * `snapshot`   — a cobertura declarada (`entity_type_set`), sem a qual o
--                    motor recusaria comparar a série corrigida com a próxima
--                    vigência, por "cobertura diferente".
--
-- Nenhum fato é lido, escrito ou movido. A trava de imutabilidade de `fact`
-- continua de pé o tempo todo; a de `snapshot` é suspensa por esta operação e
-- devolvida ao lugar antes de a função terminar, inclusive em caso de erro.
-- Suspendê-la é o ponto delicado desta migração e por isso ela é a única coisa
-- que a função faz fora do trivial: a trava existe para impedir edição
-- silenciosa de vigência fechada, e uma correção de identidade registrada em
-- `entity_type_correction`, com contagem e recusas, é o oposto de silenciosa.
--
-- O que não dá para mover, ela não move: uma coluna cujo código de destino já
-- existe teria de ser fundida com a outra, e fundir exigiria reapontar fatos
-- imutáveis. Nesses casos as duas ficam como estão e o par vai para `skipped`.
CREATE OR REPLACE FUNCTION freightcheck_correct_entity_type(
  p_from  text,
  p_to    text,
  p_actor text
) RETURNS uuid AS $$
DECLARE
  v_id             uuid;
  v_attr           record;
  v_snap           record;
  v_new_code       text;
  v_new_set        text;
  v_attrs_renamed  int   := 0;
  v_attrs_skipped  int   := 0;
  v_entities       int   := 0;
  v_snaps_renamed  int   := 0;
  v_snaps_skipped  int   := 0;
  v_changes        int   := 0;
  v_staged         int   := 0;
  v_skipped        jsonb := '[]'::jsonb;
  v_n              int;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = '' OR p_to = '' THEN
    RAISE EXCEPTION 'Correção de identidade exige tipo de origem e de destino';
  END IF;
  IF p_from = p_to THEN
    RAISE EXCEPTION 'Origem e destino são o mesmo tipo (%)', p_from;
  END IF;

  -- 1. O dicionário. Uma coluna por vez, porque cada uma pode colidir sozinha.
  FOR v_attr IN
    SELECT id, code FROM attribute WHERE entity_type = p_from ORDER BY code
  LOOP
    v_new_code := CASE
      WHEN position('.' IN v_attr.code) > 0
        THEN lower(p_to) || substr(v_attr.code, position('.' IN v_attr.code))
      ELSE lower(p_to) || '.' || v_attr.code
    END;

    IF EXISTS (SELECT 1 FROM attribute WHERE code = v_new_code) THEN
      v_attrs_skipped := v_attrs_skipped + 1;
      v_skipped := v_skipped || jsonb_build_object(
        'kind', 'attribute',
        'code', v_attr.code,
        'wouldBecome', v_new_code,
        'reason', 'Já existe uma coluna com o código de destino; fundir as duas '
                  || 'exigiria reapontar fatos imutáveis. As duas ficam como estão.'
      );
      CONTINUE;
    END IF;

    UPDATE attribute SET code = v_new_code, entity_type = p_to WHERE id = v_attr.id;
    UPDATE change SET attribute_code = v_new_code WHERE attribute_id = v_attr.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_changes := v_changes + v_n;
    v_attrs_renamed := v_attrs_renamed + 1;
  END LOOP;

  -- 2. Os ativos. Sem chave única por tipo: renomear não pode colidir.
  UPDATE entity SET entity_type = p_to WHERE entity_type = p_from;
  GET DIAGNOSTICS v_entities = ROW_COUNT;
  UPDATE change SET entity_type = p_to WHERE entity_type = p_from;

  -- 3. A staging ainda não promovida, que senão recriaria o tipo antigo.
  BEGIN
    UPDATE staged_fact
       SET entity_type = p_to,
           attribute_code = CASE
             WHEN position('.' IN attribute_code) > 0
               THEN lower(p_to) || substr(attribute_code, position('.' IN attribute_code))
             ELSE lower(p_to) || '.' || attribute_code
           END
     WHERE entity_type = p_from;
    GET DIAGNOSTICS v_staged = ROW_COUNT;
  EXCEPTION WHEN unique_violation THEN
    -- A mesma importação já tinha o grão do tipo de destino. Deixar a staging
    -- como está é seguro: ela é descartável e a importação pode ser refeita.
    v_staged := 0;
    v_skipped := v_skipped || jsonb_build_object(
      'kind', 'staged_fact',
      'reason', 'Uma importação preparada já tem o grão do tipo de destino; '
                || 'a staging ficou como estava e deve ser reimportada.'
    );
  END;

  -- 4. A cobertura declarada das vigências.
  BEGIN
    EXECUTE 'ALTER TABLE snapshot DISABLE TRIGGER snapshot_immutable';

    FOR v_snap IN
      SELECT id, source_system, source_label, scope_hash, entity_type_set,
             revision, status
        FROM snapshot
       WHERE p_from = ANY(string_to_array(entity_type_set, '+'))
       ORDER BY effective_date, source_label
    LOOP
      SELECT string_agg(DISTINCT CASE WHEN t = p_from THEN p_to ELSE t END, '+'
                        ORDER BY CASE WHEN t = p_from THEN p_to ELSE t END)
        INTO v_new_set
        FROM unnest(string_to_array(v_snap.entity_type_set, '+')) AS t;

      IF EXISTS (
           SELECT 1 FROM snapshot s2
            WHERE s2.id <> v_snap.id
              AND s2.source_system   = v_snap.source_system
              AND s2.source_label    = v_snap.source_label
              AND s2.scope_hash      = v_snap.scope_hash
              AND s2.entity_type_set = v_new_set
              AND (s2.revision = v_snap.revision
                   OR (s2.status <> 'SUPERSEDED' AND v_snap.status <> 'SUPERSEDED'))
         ) THEN
        v_snaps_skipped := v_snaps_skipped + 1;
        v_skipped := v_skipped || jsonb_build_object(
          'kind', 'snapshot',
          'sourceLabel', v_snap.source_label,
          'entityTypeSet', v_snap.entity_type_set,
          'wouldBecome', v_new_set,
          'reason', 'Já existe uma vigência com essa chave de negócio; renomear '
                    || 'esta faria duas vigências vivas para o mesmo arquivo.'
        );
        CONTINUE;
      END IF;

      UPDATE snapshot SET entity_type_set = v_new_set WHERE id = v_snap.id;
      v_snaps_renamed := v_snaps_renamed + 1;
    END LOOP;

    EXECUTE 'ALTER TABLE snapshot ENABLE TRIGGER snapshot_immutable';
  EXCEPTION WHEN OTHERS THEN
    -- A trava volta ao lugar mesmo quando algo dá errado no meio.
    EXECUTE 'ALTER TABLE snapshot ENABLE TRIGGER snapshot_immutable';
    RAISE;
  END;

  INSERT INTO entity_type_correction (
    from_entity_type, to_entity_type,
    attributes_renamed, attributes_skipped, entities_renamed,
    snapshots_renamed, snapshots_skipped, changes_relabelled,
    staged_facts_renamed, skipped, applied_by
  ) VALUES (
    p_from, p_to,
    v_attrs_renamed, v_attrs_skipped, v_entities,
    v_snaps_renamed, v_snaps_skipped, v_changes,
    v_staged, v_skipped, p_actor
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A correção do defeito observado: MODELO<EQUIPAMENTO> -> <EQUIPAMENTO>
-- ---------------------------------------------------------------------------
-- Só o prefixo `MODELO`, e só ele: é o que a entrega por equipamento da Ambev
-- produziu (`Modelo_Carreta`, `Modelo_Cavalo`) e o que se pode afirmar sem
-- adivinhar. As outras palavras de documento que a ingestão hoje descarta
-- (base, dados, análise…) nunca chegaram a produzir tipo neste banco; se um
-- dia aparecerem, `freightcheck_correct_entity_type` está aqui para ser
-- chamada com os dois nomes explícitos, em vez de um padrão que pode acertar
-- um equipamento cujo nome comece por uma delas.
--
-- Em banco novo isto não encontra nada e não faz nada.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT entity_type
      FROM (
        SELECT entity_type FROM attribute
        UNION
        SELECT entity_type FROM entity
      ) t
     WHERE entity_type ~ '^MODELO.{4,}$'
     ORDER BY 1
  LOOP
    PERFORM freightcheck_correct_entity_type(
      r.entity_type,
      substr(r.entity_type, 7),
      'migration:0009_entity_type_correction'
    );
  END LOOP;
END $$;
