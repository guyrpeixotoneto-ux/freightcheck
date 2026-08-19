-- ===========================================================================
-- PROVA DO ESTADO REAL — importação QLP Administrativo de 19/08/2026 06:44
-- ===========================================================================
-- SOMENTE LEITURA. Nenhum INSERT/UPDATE/DELETE/DDL. Nada é reprocessado,
-- excluído, aprovado ou alterado.
--
-- Uso:  psql "$DATABASE_URL" -f prova-qlp.sql
-- ===========================================================================

\pset pager off
\set ON_ERROR_STOP on
\timing off

BEGIN READ ONLY;   -- trava de segurança: a transação recusa qualquer escrita

-- ---------------------------------------------------------------------------
-- [1] O ARQUIVO E TODOS OS RUNS DELE
-- ---------------------------------------------------------------------------
-- NOTA DE SCHEMA: import_run NÃO tem `created_at` (é `started_at`) e NÃO tem
-- `dataset_family`. A família é coluna de `snapshot`, derivada do entity_type
-- durante o promote (datasetFamilyFor, lib/ingest/src/canonical-identity.ts:99).
-- Antes do promote não existe dataset_family em lugar nenhum para este arquivo
-- — o que já é, por si só, parte da prova.
\echo '=== [1] RUNS DO ARQUIVO QLP ADM ==='
SELECT ir.id                AS import_run_id,
       ir.status,
       ir.declared_type,
       ir.source_file_id,
       sf.filename,
       left(sf.content_sha256, 16) || '…' AS sha256,
       ir.started_at,
       ir.finished_at,
       ir.raw_sheet_count   AS abas,
       ir.raw_row_count     AS linhas_raw,
       ir.raw_cell_count    AS celulas_raw,
       ir.staged_fact_count AS fatos,
       ir.snapshot_count    AS vigencias,
       ir.error_count       AS erros,
       ir.warning_count     AS avisos,
       ir.failure_reason,
       ir.reprocess_of_run_id,
       ir.reprocess_reason,
       ir.triggered_by
  FROM import_run ir
  JOIN source_file sf ON sf.id = ir.source_file_id
 WHERE sf.filename ILIKE '%QLP%ADM%'
    OR ir.declared_type IN ('QLP_ADMINISTRATIVO', 'QLP_OPERACIONAL')
 ORDER BY ir.started_at DESC;

-- ---------------------------------------------------------------------------
-- [2] EXISTE LEITURA EM ABERTO DO MESMO ARQUIVO?
-- ---------------------------------------------------------------------------
-- Estes cinco estados são exatamente ESTADOS_POR_DECIDIR
-- (lib/ingest/src/pipeline.ts:566) e o índice parcial
-- import_run_leitura_aberta_uq. Qualquer linha aqui EXPLICA a recusa 409
-- "Já existe uma leitura em andamento" do reprocessamento.
\echo ''
\echo '=== [2] LEITURAS EM ABERTO (bloqueiam reprocessar) ==='
SELECT ir.id, ir.status, ir.started_at, sf.filename
  FROM import_run ir
  JOIN source_file sf ON sf.id = ir.source_file_id
 WHERE ir.status IN ('PENDING','READING','STAGED','PREVIEWED','PROMOTING')
   AND sf.id IN (SELECT sf2.id FROM source_file sf2
                  JOIN import_run ir2 ON ir2.source_file_id = sf2.id
                 WHERE sf2.filename ILIKE '%QLP%ADM%'
                    OR ir2.declared_type LIKE 'QLP%')
 ORDER BY ir.started_at DESC;

-- ---------------------------------------------------------------------------
-- [3] SNAPSHOTS CANÔNICOS ORIGINADOS DESSES RUNS
-- ---------------------------------------------------------------------------
-- Linha de snapshot só é escrita DENTRO de promote() (pipeline.ts:2956).
-- ZERO linhas aqui == promote() nunca rodou para este run  -> CASO A.
-- Linhas aqui, mas tela vazia                              -> CASO C.
\echo ''
\echo '=== [3] SNAPSHOTS DESSES RUNS (prova do promote) ==='
SELECT s.id AS snapshot_id,
       s.import_run_id,
       s.status,
       s.dataset_family,
       s.canal,
       s.effective_date,
       s.source_label,
       s.revision,
       s.entity_count,
       s.fact_count,
       s.scope_hash,
       s.created_at
  FROM snapshot s
 WHERE s.import_run_id IN (
         SELECT ir.id FROM import_run ir
           JOIN source_file sf ON sf.id = ir.source_file_id
          WHERE sf.filename ILIKE '%QLP%ADM%' OR ir.declared_type LIKE 'QLP%')
 ORDER BY s.created_at DESC;

-- ---------------------------------------------------------------------------
-- [4] O QUE A TELA ENXERGA — listContexts(QUADRO_DE_PESSOAL), literal
-- ---------------------------------------------------------------------------
-- Cópia fiel de lib/comparison/src/series.ts:180-191, com o filtro de família
-- que lib/qlp/src/contexto.ts:72 aplica. ZERO linhas == a tela mostra
-- "Nenhuma vigência de QLP Administrativo foi importada."
\echo ''
\echo '=== [4] listContexts(QUADRO_DE_PESSOAL) — a consulta da tela ==='
SELECT s.scope_hash,
       substring(s.source_label from '^([A-Za-z][A-Za-z0-9_]*)_[0-9]{1,2}_[0-9]{1,2}_[0-9]{4}$') AS canal,
       max(s.effective_date)::text AS latest_period,
       count(DISTINCT s.effective_date)::int AS periods,
       array_agg(DISTINCT s.effective_date::text ORDER BY s.effective_date::text) AS all_periods
  FROM snapshot s
 WHERE s.status <> 'SUPERSEDED'
   AND s.dataset_family = 'QUADRO_DE_PESSOAL'
 GROUP BY 1, 2
 ORDER BY max(s.effective_date) DESC, s.scope_hash, 2 NULLS LAST;

-- ---------------------------------------------------------------------------
-- [4b] Controle: TODAS as famílias presentes no canônico
-- ---------------------------------------------------------------------------
-- Se QUADRO_DE_PESSOAL não aparecer aqui mas o arquivo foi aprovado, o
-- entity_type gravado não foi QLP_* -> a família caiu no default
-- REMUNERACAO_EQUIPAMENTO (canonical-identity.ts:99-104) -> CASO C/E.
\echo ''
\echo '=== [4b] Famílias existentes no canônico (controle) ==='
SELECT s.dataset_family,
       s.status,
       count(*)                      AS snapshots,
       count(DISTINCT s.effective_date) AS vigencias,
       sum(s.fact_count)             AS fatos
  FROM snapshot s
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- ---------------------------------------------------------------------------
-- [5] O RASTRO COMPLETO: fact -> snapshot -> entity, com o WHERE da tela
-- ---------------------------------------------------------------------------
-- Reproduz lib/qlp/src/quadro.ts:200-212. Se [3] tem snapshot e isto vem
-- vazio, o filtro que mata é entity_type <> 'QLP_ADMINISTRATIVO'.
\echo ''
\echo '=== [5] Fatos visíveis à tela do QLP ADM ==='
SELECT s.effective_date,
       s.dataset_family,
       e.entity_type,
       count(DISTINCT e.id) AS entidades,
       count(*)             AS fatos
  FROM fact f
  JOIN snapshot s ON s.id = f.snapshot_id
  JOIN entity e   ON e.id = f.entity_id
  JOIN entity_identifier ei
    ON ei.entity_id = e.id AND ei.identifier_type = 'PLACA' AND ei.is_current
 WHERE s.status <> 'SUPERSEDED'
   AND s.dataset_family = 'QUADRO_DE_PESSOAL'
   AND e.entity_type = 'QLP_ADMINISTRATIVO'
 GROUP BY 1, 2, 3
 ORDER BY 1 DESC;

-- ---------------------------------------------------------------------------
-- [5b] Diagnóstico do filtro: entity_type das entidades desses runs
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== [5b] entity_type criado por esses runs ==='
SELECT e.entity_type,
       count(*) AS entidades,
       count(*) FILTER (WHERE ei.id IS NULL) AS sem_identificador_placa
  FROM entity e
  LEFT JOIN entity_identifier ei
    ON ei.entity_id = e.id AND ei.identifier_type = 'PLACA' AND ei.is_current
 WHERE e.first_seen_import_run_id IN (
         SELECT ir.id FROM import_run ir
           JOIN source_file sf ON sf.id = ir.source_file_id
          WHERE sf.filename ILIKE '%QLP%ADM%' OR ir.declared_type LIKE 'QLP%')
 GROUP BY 1
 ORDER BY 2 DESC;

-- ---------------------------------------------------------------------------
-- [6] APONTAMENTOS DA LEITURA (erros e avisos por código)
-- ---------------------------------------------------------------------------
\echo ''
\echo '=== [6] Apontamentos (validation_issue) ==='
SELECT vi.import_run_id,
       vi.severity,
       vi.code,
       count(*) AS ocorrencias,
       min(vi.message) AS exemplo
  FROM validation_issue vi
 WHERE vi.import_run_id IN (
         SELECT ir.id FROM import_run ir
           JOIN source_file sf ON sf.id = ir.source_file_id
          WHERE sf.filename ILIKE '%QLP%ADM%' OR ir.declared_type LIKE 'QLP%')
 GROUP BY 1, 2, 3
 ORDER BY 4 DESC;

-- ---------------------------------------------------------------------------
-- [7] FATOS EM STAGING (o leitor produziu algo, mesmo sem promote?)
-- ---------------------------------------------------------------------------
-- Separa CASO A (leitor produziu fatos, só falta aprovar) de
-- CASO D (leitor produziu 0 fatos — aprovar não adiantaria).
\echo ''
\echo '=== [7] Fatos em staging por run (separa A de D) ==='
SELECT sfact.import_run_id,
       sfact.entity_type,
       count(*)                            AS staged_facts,
       count(DISTINCT sfact.entity_key)    AS entidades_distintas,
       count(DISTINCT sfact.snapshot_label) AS rotulos_vigencia
  FROM staged_fact sfact
 WHERE sfact.import_run_id IN (
         SELECT ir.id FROM import_run ir
           JOIN source_file sf ON sf.id = ir.source_file_id
          WHERE sf.filename ILIKE '%QLP%ADM%' OR ir.declared_type LIKE 'QLP%')
 GROUP BY 1, 2
 ORDER BY 2 DESC;

COMMIT;
