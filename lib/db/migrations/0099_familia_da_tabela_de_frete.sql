-- ===========================================================================
-- A TABELA DE FRETE GANHA IDENTIDADE PRÓPRIA
-- ===========================================================================
-- `TRECHO` não tinha entrada no mapa de famílias e caía no padrão inclusivo,
-- que é a família do equipamento. Como a identidade de uma vigência é
-- (sistema, família, canal, data, escopo), a tabela de frete de uma unidade e o
-- export de equipamento da MESMA data e do MESMO canal eram a mesma vigência: o
-- segundo arquivo a chegar não abria vigência — entrava como revisão do
-- primeiro, herdava os fatos dele, e a cobertura gravada virava `CAVALO+TRECHO`.
--
-- O efeito foi medido na Auditoria de Km Rodado: dois meses da mesma unidade com
-- coberturas diferentes, que `engine.ts` recusa comparar entre si. A fusão está
-- reproduzida pelo pipeline real em `lib/ingest/src/__tests__/fusao-de-cobertura.test.ts`.
--
-- `datasetFamilyFor` já foi corrigida no TypeScript, e isso basta para o que
-- **entrar daqui para frente**. Esta migration trata do que já entrou.
--
-- ---------------------------------------------------------------------------
-- O que o reparo faz, e o que ele recusa fazer
-- ---------------------------------------------------------------------------
-- Para cada vigência que carrega TRECHO, em qualquer status:
--
--   * cobertura EXATAMENTE `TRECHO` — é uma tabela de frete inteira, na família
--     errada. Ela **muda de família**, e nada mais. A chave canônica é coluna
--     gerada e se recalcula sozinha.
--
--   * cobertura com TRECHO **e** outros tipos — é uma vigência fundida. Ela é
--     **separada**: nasce uma vigência de trecho com os fatos de trecho, e a
--     original perde TRECHO da cobertura e fica só com o equipamento.
--
-- **A revisão da vigência nova é a mesma da vigência de onde ela saiu.** Não
-- começa em 1: uma cadeia onde o trecho chegou na revisão 2 produz uma vigência
-- de trecho cuja primeira revisão é 2, e isso é verdade — foi ali que o
-- documento entrou no acervo. Renumerar seria mais bonito e exigiria mexer em
-- número que outra linha já cita; manter é o que garante, sem nenhuma conta, que
-- duas revisões da mesma chave nova nunca colidem no índice único.
--
-- **O passado não é apagado.** As revisões SUPERSEDED são reparadas do mesmo
-- jeito e continuam SUPERSEDED; `snapshot_merge` fica como está, porque ele
-- registra o que de fato aconteceu naquele dia — inclusive a fusão que este
-- reparo desfaz.
--
-- **O que ele não faz:** não reimporta, não recalcula `change_set` e não mexe em
-- RAW. Uma comparação gravada que apontava para a vigência fundida continua
-- existindo e continua verdadeira sobre o que ela comparou; a próxima é
-- calculada sobre as vigências separadas.
--
-- ---------------------------------------------------------------------------
-- Por que a trava de imutabilidade sai do caminho, e como ela volta
-- ---------------------------------------------------------------------------
-- Uma vigência CLOSED é imutável, e os fatos dela também — é a espinha da
-- história de auditoria, e não um detalhe. Aqui ela é suspensa pelo mesmo
-- caminho da `0009` (`freightcheck_correct_entity_type`), que corrigiu a
-- identidade de um equipamento pela mesma razão: o dado gravado está errado por
-- causa de uma regra que já foi corrigida, e reimportar não resolve.
--
-- `ALTER TABLE ... DISABLE TRIGGER` e não `session_replication_role`: a `0093`
-- documenta por que o segundo não serve. A reposição está no caminho de erro
-- também, de modo que a trava volta mesmo se algo estourar no meio — e como
-- cada migration roda na sua própria transação, um erro desfaz tudo junto.
-- ===========================================================================

-- `IF NOT EXISTS` porque a fila é reaplicada sobre bases que já têm o schema e
-- perderam o registro (`registro-perdido`, `canonical-identity-migration`): sem
-- ele, a adoção morre em "relation already exists" na 0099.
CREATE TABLE IF NOT EXISTS "reparo_familia_do_trecho" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vigencias_movidas" integer DEFAULT 0 NOT NULL,
	"vigencias_separadas" integer DEFAULT 0 NOT NULL,
	"vigencias_criadas" integer DEFAULT 0 NOT NULL,
	"fatos_movidos" integer DEFAULT 0 NOT NULL,
	"ignoradas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aplicado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_separar_familia_do_trecho()
RETURNS uuid AS $$
DECLARE
  v_snap            RECORD;
  v_nova            uuid;
  v_novo_set        text;
  v_movidas         integer := 0;
  v_separadas       integer := 0;
  v_criadas         integer := 0;
  v_fatos           integer := 0;
  v_n               integer;
  v_ignoradas       jsonb := '[]'::jsonb;
  v_anterior        uuid;
  v_chave_anterior  text := NULL;
  v_id              uuid;
  v_import_run      uuid;
  v_source_file     uuid;
BEGIN
  BEGIN
    EXECUTE 'ALTER TABLE snapshot DISABLE TRIGGER snapshot_immutable';
    EXECUTE 'ALTER TABLE fact DISABLE TRIGGER fact_immutable';

    /*
      A ordem é (chave canônica antiga, revisão), e ela importa: dentro de uma
      mesma cadeia, a vigência de trecho de uma revisão sucede a da revisão
      anterior, e `supersedes_snapshot_id` só pode ser preenchido se a anterior
      já tiver sido criada.
    */
    FOR v_snap IN
      SELECT s.id, s.entity_type_set, s.status, s.revision, s.canonical_snapshot_key,
             s.source_file_id, s.import_run_id, s.source_system, s.source_label,
             s.effective_date, s.scope_hash, s.canal, s.canonical_scope
        FROM snapshot s
       WHERE 'TRECHO' = ANY(string_to_array(s.entity_type_set, '+'))
         AND s.dataset_family <> 'TABELA_DE_FRETE'
       ORDER BY s.canonical_snapshot_key, s.revision
    LOOP
      -- Cadeia nova: a sucessão recomeça.
      IF v_chave_anterior IS DISTINCT FROM v_snap.canonical_snapshot_key THEN
        v_anterior := NULL;
        v_chave_anterior := v_snap.canonical_snapshot_key;
      END IF;

      IF v_snap.entity_type_set = 'TRECHO' THEN
        -- ---------------------------------------------------------------
        -- Caso 1: a vigência inteira é de trecho. Só muda de família.
        -- ---------------------------------------------------------------
        UPDATE snapshot
           SET dataset_family = 'TABELA_DE_FRETE',
               supersedes_snapshot_id = COALESCE(v_anterior, supersedes_snapshot_id)
         WHERE id = v_snap.id;
        v_movidas := v_movidas + 1;
        v_anterior := v_snap.id;
        CONTINUE;
      END IF;

      -- -----------------------------------------------------------------
      -- Caso 2: vigência fundida. Separa.
      -- -----------------------------------------------------------------
      SELECT string_agg(t, '+' ORDER BY t)
        INTO v_novo_set
        FROM unnest(string_to_array(v_snap.entity_type_set, '+')) AS t
       WHERE t <> 'TRECHO';

      IF v_novo_set IS NULL OR v_novo_set = '' THEN
        -- Não deveria acontecer (o caso 1 já cobriu), mas separar uma vigência
        -- deixando a original sem cobertura nenhuma seria pior do que não tocar.
        v_ignoradas := v_ignoradas || jsonb_build_object(
          'snapshotId', v_snap.id,
          'sourceLabel', v_snap.source_label,
          'entityTypeSet', v_snap.entity_type_set,
          'motivo', 'Separar deixaria a vigência de origem sem cobertura.'
        );
        CONTINUE;
      END IF;

      /*
        De qual importação veio o trecho.

        `fact.origin_import_run_id` acompanha o fato e não é reescrito pela
        herança, então ele diz qual arquivo trouxe o trecho — que quase nunca é
        o `import_run_id` da vigência fundida (esse é o do equipamento). A
        vigência nova tem de apontar para o arquivo que de fato a produziu, ou a
        ocultação de uma importação deixaria de alcançar os fatos dela.
      */
      SELECT f.origin_import_run_id
        INTO v_import_run
        FROM fact f
        JOIN entity e ON e.id = f.entity_id
       WHERE f.snapshot_id = v_snap.id
         AND e.entity_type = 'TRECHO'
         AND f.origin_import_run_id IS NOT NULL
       GROUP BY f.origin_import_run_id
       ORDER BY count(*) DESC
       LIMIT 1;

      v_import_run := COALESCE(v_import_run, v_snap.import_run_id);
      SELECT ir.source_file_id INTO v_source_file
        FROM import_run ir WHERE ir.id = v_import_run;
      v_source_file := COALESCE(v_source_file, v_snap.source_file_id);

      INSERT INTO snapshot (
        source_file_id, import_run_id, source_system, source_label,
        effective_date, scope_hash, entity_type_set, dataset_family, canal,
        canonical_scope, revision, supersedes_snapshot_id, status,
        closed_at, entity_count, fact_count, canonical_payload_hash
      ) VALUES (
        v_source_file, v_import_run, v_snap.source_system, v_snap.source_label,
        v_snap.effective_date, v_snap.scope_hash, 'TRECHO', 'TABELA_DE_FRETE',
        v_snap.canal, v_snap.canonical_scope, v_snap.revision, v_anterior,
        'DRAFT', now(), 0, 0,
        -- O hash cobria os dois documentos juntos e não descreve nenhum dos
        -- dois agora. Nulo é valor suportado: sem ele, a comparação de
        -- conteúdo é feita contra os fatos do próprio snapshot.
        NULL
      ) RETURNING id INTO v_nova;

      -- Os fatos de trecho mudam de vigência. Os de equipamento ficam.
      UPDATE fact f
         SET snapshot_id = v_nova
        FROM entity e
       WHERE e.id = f.entity_id
         AND f.snapshot_id = v_snap.id
         AND e.entity_type = 'TRECHO';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_fatos := v_fatos + v_n;

      -- Os satélites acompanham: escopo é copiado (vale para as duas), e o que
      -- é por tipo é movido.
      INSERT INTO snapshot_scope (snapshot_id, scope_id)
        SELECT v_nova, ss.scope_id FROM snapshot_scope ss
         WHERE ss.snapshot_id = v_snap.id
        ON CONFLICT DO NOTHING;

      /*
        O layout declarado da vigência: quais colunas do arquivo entraram, em
        que aba e em que posição. Vai junto com o documento a que pertence —
        o atributo diz de que tipo é (`attribute.entity_type`), e as colunas de
        trecho descrevem a tabela de frete, não o export de equipamento. Sem
        isto, a Cobertura leria a vigência de trecho como se ela não declarasse
        coluna nenhuma.
      */
      UPDATE snapshot_attribute sa
         SET snapshot_id = v_nova
        FROM attribute a
       WHERE a.id = sa.attribute_id
         AND sa.snapshot_id = v_snap.id
         AND a.entity_type = 'TRECHO';

      UPDATE snapshot_entity_type SET snapshot_id = v_nova
       WHERE snapshot_id = v_snap.id AND entity_type = 'TRECHO';

      UPDATE snapshot_presenca SET snapshot_id = v_nova
       WHERE snapshot_id = v_snap.id AND entity_type = 'TRECHO';

      -- As contagens das duas pontas, recontadas dos fatos que sobraram em cada.
      UPDATE snapshot s
         SET entity_type_set = v_novo_set,
             canonical_payload_hash = NULL,
             fact_count = (SELECT count(*) FROM fact WHERE snapshot_id = s.id),
             entity_count = (SELECT count(DISTINCT entity_id) FROM fact WHERE snapshot_id = s.id)
       WHERE s.id = v_snap.id;

      UPDATE snapshot s
         SET status = v_snap.status,
             fact_count = (SELECT count(*) FROM fact WHERE snapshot_id = s.id),
             entity_count = (SELECT count(DISTINCT entity_id) FROM fact WHERE snapshot_id = s.id)
       WHERE s.id = v_nova;

      v_separadas := v_separadas + 1;
      v_criadas := v_criadas + 1;
      v_anterior := v_nova;
    END LOOP;

    EXECUTE 'ALTER TABLE fact ENABLE TRIGGER fact_immutable';
    EXECUTE 'ALTER TABLE snapshot ENABLE TRIGGER snapshot_immutable';
  EXCEPTION WHEN OTHERS THEN
    -- A trava volta ao lugar mesmo quando algo dá errado no meio.
    EXECUTE 'ALTER TABLE fact ENABLE TRIGGER fact_immutable';
    EXECUTE 'ALTER TABLE snapshot ENABLE TRIGGER snapshot_immutable';
    RAISE;
  END;

  INSERT INTO reparo_familia_do_trecho (
    vigencias_movidas, vigencias_separadas, vigencias_criadas, fatos_movidos, ignoradas
  ) VALUES (
    v_movidas, v_separadas, v_criadas, v_fatos, v_ignoradas
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- O reparo roda agora, e é idempotente: a segunda execução não encontra
-- nenhuma vigência com TRECHO fora da família da tabela de frete e grava uma
-- linha de zeros. Rodar junto com a migration é o que impede um deploy de
-- deixar o acervo em desacordo com o código que acabou de subir.
SELECT freightcheck_separar_familia_do_trecho();
