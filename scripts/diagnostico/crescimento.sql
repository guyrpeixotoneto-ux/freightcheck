-- ===========================================================================
-- CRESCIMENTO AO LONGO DO TEMPO — SOMENTE LEITURA
-- ===========================================================================
-- Responde "a que velocidade este banco cresce, e por quê" usando a única data
-- que as tabelas grandes têm: a de `import_run`. `fact`, `staged_fact`,
-- `raw_cell`, `raw_row` e `change` não têm coluna de data própria — a data
-- delas é a da importação que as criou, e é por ela que tudo aqui é medido.
--
-- Nenhuma linha escreve. Toda seção roda em transação `READ ONLY` própria.
--
-- CUSTO — leia antes de rodar:
--   Seções 1 a 5  : `import_run`, `source_file`, `import_deletion`. Tabelas de
--                   centenas de linhas, e as contagens de célula saem dos
--                   CONTADORES já gravados em `import_run` (`raw_cell_count`,
--                   `staged_fact_count`, `snapshot_count`). Não tocam em
--                   `raw_cell` nem em `fact`. Milissegundos.
--   Seção 6       : a conferência exata — varre `fact` e `staged_fact` inteiras
--                   (~275 mil linhas cada) agrupando por mês. Segundos, não
--                   milissegundos. Está por último e separada de propósito;
--                   as seções 1 a 5 já respondem a pergunta sem ela.
--
-- Uso:  ./scripts/diagnostico/ler-producao.sh scripts/diagnostico/crescimento.sql
-- ===========================================================================

\pset pager off
\timing off

SET statement_timeout = '120s';

BEGIN READ ONLY;

\echo ''
\echo '=== [1] VOLUME IMPORTADO POR MÊS ========================================'
-- Os contadores de `import_run`, somados por mês da importação. `raw_cell_count`
-- e `staged_fact_count` são gravados pelo pipeline quando o run termina, então
-- esta seção não lê uma única linha de `raw_cell` nem de `staged_fact`.
--
-- Conta só o que SOBREVIVEU: um run excluído sai de `import_run` junto com o
-- purge. O que foi excluído está na seção 4.
SELECT date_trunc('month', ir.started_at)::date          AS mes,
       count(*)                                          AS runs,
       count(*) FILTER (WHERE ir.status = 'PROMOTED')     AS promovidos,
       count(*) FILTER (WHERE ir.status = 'FAILED')       AS falhos,
       count(DISTINCT ir.source_file_id)                  AS arquivos_distintos,
       sum(ir.raw_cell_count)                             AS celulas_raw,
       sum(ir.staged_fact_count)                          AS staged,
       sum(ir.snapshot_count)                             AS snapshots,
       pg_size_pretty(sum(sf.byte_size))                  AS bytes_dos_arquivos
  FROM import_run ir
  JOIN source_file sf ON sf.id = ir.source_file_id
 GROUP BY 1
 ORDER BY 1;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '--- [1b] O acumulado, mês a mês — a curva que interessa -----------------'
SELECT mes,
       celulas_raw,
       sum(celulas_raw) OVER (ORDER BY mes) AS celulas_acumuladas,
       runs,
       sum(runs)        OVER (ORDER BY mes) AS runs_acumulados
  FROM (
    SELECT date_trunc('month', started_at)::date AS mes,
           sum(raw_cell_count)                   AS celulas_raw,
           count(*)                              AS runs
      FROM import_run
     GROUP BY 1
  ) m
 ORDER BY mes;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [2] QUANTOS RUNS POR ARQUIVO ========================================'
-- Um arquivo com muitos runs é releitura: cada run grava o conjunto COMPLETO de
-- células de novo. É o multiplicador de RAW, e o suspeito nº 1 de inchaço.
--
-- `source_file` é deduplicado por SHA-256, então "o mesmo arquivo" aqui quer
-- dizer os mesmos bytes — não o mesmo nome.
SELECT sf.filename,
       left(sf.content_sha256, 8)                         AS sha,
       pg_size_pretty(sf.byte_size)                       AS tamanho,
       count(ir.id)                                       AS runs,
       count(ir.id) FILTER (WHERE ir.status = 'PROMOTED') AS promovidos,
       count(ir.id) FILTER (WHERE ir.reprocess_of_run_id IS NOT NULL) AS reprocessamentos,
       sum(ir.raw_cell_count)                             AS celulas_somadas,
       min(ir.started_at)::date                           AS primeiro,
       max(ir.started_at)::date                           AS ultimo
  FROM source_file sf
  LEFT JOIN import_run ir ON ir.source_file_id = sf.id
 GROUP BY sf.id, sf.filename, sf.content_sha256, sf.byte_size
 ORDER BY count(ir.id) DESC, sum(ir.raw_cell_count) DESC NULLS LAST
 LIMIT 30;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '--- [2b] Resumo: quantos arquivos foram lidos mais de uma vez -----------'
SELECT runs_por_arquivo,
       count(*)              AS arquivos,
       sum(celulas)          AS celulas_envolvidas
  FROM (
    SELECT sf.id, count(ir.id) AS runs_por_arquivo, sum(ir.raw_cell_count) AS celulas
      FROM source_file sf
      LEFT JOIN import_run ir ON ir.source_file_id = sf.id
     GROUP BY sf.id
  ) t
 GROUP BY runs_por_arquivo
 ORDER BY runs_por_arquivo;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [3] ARQUIVOS QUE MAIS FORAM EXCLUÍDOS ==============================='
-- `import_deletion` é permanente por desenho: sobrevive ao purge que apaga o
-- run. É a única memória de quanto já entrou e saiu — e é ela que explica o
-- inchaço de índice, porque cada exclusão esvazia páginas de btree que não
-- voltam para o sistema.
SELECT filename,
       left(content_sha256, 8)                  AS sha,
       count(*)                                 AS exclusoes,
       min(deleted_at)::date                    AS primeira,
       max(deleted_at)::date                    AS ultima,
       sum(coalesce((removed->>'raw_cell')::bigint, 0))    AS celulas_removidas,
       sum(coalesce((removed->>'fact')::bigint, 0))        AS fatos_removidos,
       sum(coalesce((removed->>'staged_fact')::bigint, 0)) AS staged_removidos
  FROM import_deletion
 GROUP BY filename, content_sha256
 ORDER BY count(*) DESC, sum(coalesce((removed->>'raw_cell')::bigint, 0)) DESC
 LIMIT 30;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '--- [3b] Exclusões por mês, e o volume que saiu -------------------------'
SELECT date_trunc('month', deleted_at)::date              AS mes,
       count(*)                                           AS exclusoes,
       count(DISTINCT content_sha256)                     AS arquivos_distintos,
       sum(coalesce((removed->>'raw_cell')::bigint, 0))   AS celulas_removidas,
       sum(coalesce((removed->>'fact')::bigint, 0))       AS fatos_removidos,
       sum(coalesce((removed->>'staged_fact')::bigint,0)) AS staged_removidos
  FROM import_deletion
 GROUP BY 1
 ORDER BY 1;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '--- [3c] O balanço do churn: entrou x saiu ------------------------------'
-- Lado a lado, o que o acervo vivo tem e o que já passou por ele. A diferença
-- entre "removidas" e o que está vivo é a massa que abriu páginas de índice.
SELECT (SELECT sum(raw_cell_count) FROM import_run)                              AS celulas_vivas_contador,
       (SELECT sum(coalesce((removed->>'raw_cell')::bigint, 0)) FROM import_deletion)    AS celulas_ja_removidas,
       (SELECT sum(staged_fact_count) FROM import_run)                           AS staged_vivos_contador,
       (SELECT sum(coalesce((removed->>'staged_fact')::bigint, 0)) FROM import_deletion) AS staged_ja_removidos,
       (SELECT count(*) FROM import_run)                                         AS runs_vivos,
       (SELECT count(*) FROM import_deletion)                                    AS runs_excluidos;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '--- [3d] Quem excluiu, e com que motivo declarado -----------------------'
-- Sem e-mail nem nome completo: só o prefixo, para distinguir atores sem
-- publicar identidade. Um mesmo ator com dezenas de exclusões é padrão de uso,
-- não necessariamente problema — mas é o que explica a curva.
SELECT left(deleted_by, 3) || '…'          AS ator,
       count(*)                            AS exclusoes,
       count(*) FILTER (WHERE reason IS NOT NULL) AS com_motivo,
       min(deleted_at)::date               AS primeira,
       max(deleted_at)::date               AS ultima
  FROM import_deletion
 GROUP BY left(deleted_by, 3)
 ORDER BY count(*) DESC;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [4] JANELA DE VIDA DO ACERVO ========================================'
SELECT (SELECT min(started_at)::date  FROM import_run)     AS primeira_importacao,
       (SELECT max(started_at)::date  FROM import_run)     AS ultima_importacao,
       (SELECT max(started_at)::date - min(started_at)::date FROM import_run) AS dias_de_acervo,
       (SELECT count(*) FROM import_run)                   AS runs,
       round(
         (SELECT count(*) FROM import_run)::numeric
         / nullif((SELECT max(started_at)::date - min(started_at)::date FROM import_run), 0)
         * 30, 1)                                          AS runs_por_mes_medio;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [5] PROJEÇÃO GROSSEIRA =============================================='
-- Bytes por célula medidos no acervo atual, aplicados ao ritmo dos últimos 90
-- dias. É aritmética de guardanapo, e serve para uma pergunta só: em que ordem
-- de grandeza o limite de 100 GB entra no horizonte.
--
-- NÃO extrapola inchaço de índice: se os índices forem reconstruídos, o
-- `bytes_por_celula` cai junto e esta projeção passa a superestimar.
WITH acervo AS (
  SELECT sum(raw_cell_count)::numeric AS celulas FROM import_run
), ritmo AS (
  SELECT sum(raw_cell_count)::numeric AS celulas_90d
    FROM import_run
   WHERE started_at >= now() - interval '90 days'
)
SELECT pg_size_pretty(pg_database_size(current_database()))                 AS hoje,
       acervo.celulas                                                        AS celulas_no_acervo,
       round(pg_database_size(current_database()) / nullif(acervo.celulas,0), 0) AS bytes_por_celula,
       ritmo.celulas_90d                                                     AS celulas_ultimos_90d,
       pg_size_pretty((
         ritmo.celulas_90d / 90 * 365
         * (pg_database_size(current_database()) / nullif(acervo.celulas, 0))
       )::bigint)                                                            AS crescimento_anual_estimado
  FROM acervo, ritmo;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [6] CONFERÊNCIA EXATA — CUSTA SEGUNDOS, NÃO MILISSEGUNDOS =========='
-- As três seções abaixo varrem as tabelas grandes inteiras para contar as
-- linhas VIVAS por mês de importação. As seções 1 e 1b já responderam a mesma
-- pergunta pelos contadores; isto existe para conferir que os contadores não
-- divergiram do acervo — e para ver a distribuição real depois das exclusões.
--
-- `fact` e `staged_fact` têm coluna indexada apontando para `import_run`
-- (`fact_origin_import_run_idx`, `staged_fact_run_idx`), mas um GROUP BY sobre
-- a tabela inteira varre mesmo assim. ~275 mil linhas cada.

\echo ''
\echo '--- [6a] fact vivo, por mês da importação de origem ---------------------'
SELECT date_trunc('month', ir.started_at)::date AS mes,
       count(*)                                 AS fatos_vivos,
       count(DISTINCT f.snapshot_id)            AS snapshots,
       count(DISTINCT f.origin_import_run_id)   AS runs
  FROM fact f
  JOIN import_run ir ON ir.id = f.origin_import_run_id
 GROUP BY 1
 ORDER BY 1;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '--- [6b] staged_fact vivo, por mês da importação ------------------------'
SELECT date_trunc('month', ir.started_at)::date AS mes,
       count(*)                                 AS staged_vivos,
       count(DISTINCT s.import_run_id)          AS runs
  FROM staged_fact s
  JOIN import_run ir ON ir.id = s.import_run_id
 GROUP BY 1
 ORDER BY 1;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '--- [6c] raw_cell vivo, por mês — dois saltos até import_run ------------'
-- `raw_cell` não aponta para `import_run`: o caminho é
-- raw_cell -> raw_row -> raw_sheet -> import_run. Os dois saltos são por índice
-- (`raw_cell_row_idx`, `raw_row_sheet_index_uq`) e `raw_row`/`raw_sheet` são
-- pequenas, mas o GROUP BY ainda percorre as ~315 mil células.
SELECT date_trunc('month', ir.started_at)::date AS mes,
       count(*)                                 AS celulas_vivas,
       count(DISTINCT rs.import_run_id)         AS runs
  FROM raw_cell rc
  JOIN raw_row   rr ON rr.id = rc.raw_row_id
  JOIN raw_sheet rs ON rs.id = rr.raw_sheet_id
  JOIN import_run ir ON ir.id = rs.import_run_id
 GROUP BY 1
 ORDER BY 1;

COMMIT;

\echo ''
\echo '=== FIM. Nenhuma escrita foi executada. ================================='
