-- ---------------------------------------------------------------------------
-- Uma identidade de escopo, e não duas.
-- ---------------------------------------------------------------------------
--
-- `snapshot.scope_hash` é o hash dos códigos de escopo **como vieram no
-- arquivo**. A `0015` o substituiu por `canonical_scope`, normalizado, e a
-- `0016` derrubou os dois únicos índices que o usavam. Desde então ele é
-- escrito em toda promoção e lido por **uma** consulta — a que monta a lista de
-- hashes legados que `resolveContext` ainda aceitava.
--
-- Aceitar duas grafias para a mesma pergunta é a dívida que esta migration
-- encerra. Enquanto ela existir, "qual é o escopo desta vigência?" tem duas
-- respostas certas, e é assim que um módulo volta a discordar dos outros sobre
-- o que existe.
--
-- **A ordem aqui é a razão de ser do arquivo.** A tradução do estado das
-- conversas só é possível enquanto a coluna existe: é ela que liga o hash cru
-- que uma conversa guardou à chave canônica que ela passa a usar. Traduzir
-- depois de derrubar seria impossível, e derrubar sem traduzir quebraria toda
-- conversa aberta antes desta linha.

-- ---------------------------------------------------------------------------
-- 1. As conversas em andamento
-- ---------------------------------------------------------------------------
--
-- `assistant_conversation.state` guarda o recorte em que a conversa está, e o
-- orquestrador o passa a `resolveContext` na pergunta seguinte. Uma conversa
-- aberta antes da `0015` guardou o hash cru; a partir do commit que acompanha
-- esta migration, esse valor deixa de ser aceito e a conversa pararia de
-- responder — sem erro visível, com uma recusa de contexto que quem perguntou
-- não tem como associar a nada que fez.
--
-- A tradução é pela própria `snapshot`: o hash cru identifica as vigências que
-- o produziram, e delas sai o escopo canônico.
-- A tradução vai dentro de um `DO` **porque a fila é reentrante**.
--
-- `runMigrations` pode reexecutar uma migration já aplicada — é a propriedade
-- que destrava um banco cujo registro se perdeu, e há prova dela em
-- `registro-e-hash` e `registro-perdido`. Na segunda passada a coluna já não
-- existe, e um `UPDATE` que a cite falharia com `42703` levando a fila junto.
-- A guarda é pela existência da coluna, e não por `IF NOT EXISTS` em cima do
-- efeito: o que precisa ser condicional aqui é **poder ler** o valor antigo.
DO $traduz$
BEGIN
  IF EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'snapshot'
          AND column_name  = 'scope_hash'
     ) THEN
    EXECUTE $sql$
      UPDATE "assistant_conversation" c
         SET "state" = jsonb_set(c."state", '{scopeHash}', to_jsonb(t."canonica"))
        FROM (
          SELECT DISTINCT
                 s."scope_hash" AS legado,
                 encode(sha256(convert_to(
                   freightcheck_serialize_scope(s."canonical_scope"), 'UTF8')), 'hex')
                   AS canonica
            FROM "snapshot" s
        ) t
       WHERE c."state" IS NOT NULL
         AND c."state" ? 'scopeHash'
         AND c."state"->>'scopeHash' = t."legado"
         AND c."state"->>'scopeHash' <> t."canonica"
    $sql$;
  END IF;
END
$traduz$;--> statement-breakpoint

-- O hash órfão — o que não casa com vigência nenhuma, porque a importação que
-- o produziu foi excluída — vira `null`, e não fica como está.
--
-- `null` é "sem recorte", e o orquestrador o trata como "resolva o mais
-- recente e diga qual escolheu". Deixar o valor antigo seria pior de um jeito
-- específico: a conversa continuaria carregando um endereço que não existe, e
-- a recusa apareceria mais tarde, longe daqui, como se fosse defeito da
-- pergunta que a pessoa acabou de fazer.
UPDATE "assistant_conversation" c
   SET "state" = jsonb_set(c."state", '{scopeHash}', 'null'::jsonb)
 WHERE c."state" IS NOT NULL
   AND c."state" ? 'scopeHash'
   AND c."state"->>'scopeHash' IS NOT NULL
   AND NOT EXISTS (
         SELECT 1
           FROM "snapshot" s
          WHERE encode(sha256(convert_to(
                  freightcheck_serialize_scope(s."canonical_scope"), 'UTF8')), 'hex')
                = c."state"->>'scopeHash');--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. A coluna
-- ---------------------------------------------------------------------------
--
-- `IF EXISTS` pela reentrância; `RESTRICT` e não `CASCADE`, como toda remoção
-- deste schema: se algo ainda
-- depender dela, a migration tem de cair aqui e nomear o dependente — não
-- levá-lo junto em silêncio. Os dois índices que a usavam saíram na `0016`, e
-- é por isso que este `DROP` não tem nada para derrubar além da coluna.
ALTER TABLE "snapshot" DROP COLUMN IF EXISTS "scope_hash" RESTRICT;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. As duas funções que ainda citavam a coluna
-- ---------------------------------------------------------------------------
--
-- **Este é o achado que o levantamento não tinha.** A varredura que precedeu
-- esta migration leu TypeScript e encontrou um leitor da coluna. Ela não leu
-- PL/pgSQL, e por isso não viu que duas funções do próprio banco a citam — e
-- `DROP COLUMN ... RESTRICT` não as protege: o Postgres não rastreia dependência
-- de coluna dentro de corpo de função. A coluna cai sem reclamação, e o erro
-- aparece depois, em runtime, na forma `record "new" has no field "scope_hash"`.
--
-- No caso do gatilho de imutabilidade isso não é um detalhe: ele roda em **todo
-- UPDATE** de vigência não-DRAFT, o que inclui a transição CLOSED → SUPERSEDED
-- que toda revisão nova faz. Sem esta seção, a `0022` derrubaria a coluna e
-- quebraria a promoção inteira — silenciosamente até o primeiro arquivo chegar.
--
-- As duas são redefinidas, e nenhuma delas ganha compatibilidade:
--
-- `freightcheck_snapshot_is_immutable` comparava `NEW.scope_hash = OLD.scope_hash`
-- entre as colunas que uma transição legítima não pode alterar. A coluna não
-- existe mais, logo não há o que ela possa alterar: as duas linhas saem, e a
-- guarda continua conferindo todas as outras. Não é afrouxamento — é uma
-- coluna a menos no universo do que se pode mexer.
--
-- `freightcheck_correct_entity_type` usava `scope_hash` para detectar colisão de
-- chave de negócio ao renomear um tipo de equipamento. A chave de negócio
-- passou a ser a identidade canônica na `0016`; a comparação passa a ser por
-- `canonical_scope`, que é a mesma pergunta feita à autoridade certa.

CREATE OR REPLACE FUNCTION freightcheck_snapshot_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' OR freightcheck_purge_em_curso() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION
      'Snapshot % is % and cannot be deleted', OLD.id, OLD.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;                       -- still being assembled
  END IF;

  -- SUPERSEDED -> CLOSED, e só durante uma exclusão: a revisão que superou
  -- esta está sendo apagada agora.
  IF freightcheck_purge_em_curso()
     AND OLD.status              = 'SUPERSEDED'
     AND NEW.status              = 'CLOSED'
     AND NEW.id                  = OLD.id
     AND NEW.source_file_id      = OLD.source_file_id
     AND NEW.import_run_id       = OLD.import_run_id
     AND NEW.source_system       = OLD.source_system
     AND NEW.source_label        = OLD.source_label
     AND NEW.effective_date      = OLD.effective_date
     AND NEW.entity_type_set     = OLD.entity_type_set
     AND NEW.revision            = OLD.revision
     AND NEW.entity_count        = OLD.entity_count
     AND NEW.fact_count          = OLD.fact_count
  THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION
      'Snapshot % is SUPERSEDED and is terminal', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- OLD.status = 'CLOSED': allow only the supersede transition.
  IF NEW.status = 'SUPERSEDED'
     AND NEW.id                = OLD.id
     AND NEW.source_file_id    = OLD.source_file_id
     AND NEW.import_run_id     = OLD.import_run_id
     AND NEW.source_system     = OLD.source_system
     AND NEW.source_label      = OLD.source_label
     AND NEW.effective_date    = OLD.effective_date
     AND NEW.entity_type_set   = OLD.entity_type_set
     AND NEW.revision          = OLD.revision
     AND NEW.entity_count      = OLD.entity_count
     AND NEW.fact_count        = OLD.fact_count
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Snapshot % is CLOSED and immutable; only CLOSED -> SUPERSEDED is allowed',
    OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

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
      SELECT id, source_system, source_label, canonical_scope, entity_type_set,
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
              AND s2.canonical_scope = v_snap.canonical_scope
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
