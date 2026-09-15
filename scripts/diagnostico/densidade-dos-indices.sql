-- ===========================================================================
-- DENSIDADE REAL DOS ÍNDICES — SOMENTE LEITURA
-- ===========================================================================
-- A seção 3 de `tamanho-do-banco.sql` mostra que os índices ocupam 87% deste
-- banco. Isso é medida de TAMANHO, e tamanho sozinho não distingue "índice
-- grande porque a chave é larga" de "índice grande porque está cheio de página
-- vazia". Este arquivo mede a segunda coisa: a densidade das folhas.
--
-- ---------------------------------------------------------------------------
-- NADA AQUI INSTALA NADA
-- ---------------------------------------------------------------------------
-- `pgstatindex` vem da extensão `pgstattuple`. A seção 0 apenas PERGUNTA se ela
-- existe e se está instalada — `CREATE EXTENSION` é DDL e não aparece em lugar
-- nenhum deste arquivo. Se não estiver instalada, a seção 1 falha com "function
-- pgstatindex does not exist", só ela, e a seção 2 (que não depende da extensão)
-- continua rodando e já dá uma resposta aproximada.
--
-- ---------------------------------------------------------------------------
-- CUSTO — e este é o único diagnóstico caro do conjunto
-- ---------------------------------------------------------------------------
-- `pgstatindex` LÊ O ÍNDICE INTEIRO, página por página. Para os índices desta
-- lista isso é ~900 MB de leitura somados. Não bloqueia escrita nem leitura de
-- ninguém (é um scan comum), mas ocupa I/O e, num compute Neon que estava
-- suspenso, traz páginas frias do storage.
--
-- Rode fora do horário de uso, e comece pelo menor para calibrar o tempo.
--
-- ---------------------------------------------------------------------------
-- RODADO EM PRODUÇÃO — 15/09/2026
-- ---------------------------------------------------------------------------
-- `pgstattuple` está disponível (1.5) e NÃO instalada. A seção 1 falhou com
-- "function pgstatindex(text) does not exist" — só ela, como previsto — e a
-- seção 2 respondeu: fator 9 a 10x nos quatro maiores índices, ~881 MB
-- recuperáveis. Resultado em `docs/PLANO-INCHACO-DOS-INDICES.md`, seção 1.1.
--
-- A aproximação bastou para decidir. Instalar a extensão daria a densidade
-- exata das folhas, mas é DDL — e não foi feito.
--
-- Uso:  ./scripts/diagnostico/ler-producao.sh scripts/diagnostico/densidade-dos-indices.sql
-- ===========================================================================

\pset pager off
\timing on

SET statement_timeout = '600s';

BEGIN READ ONLY;

\echo ''
\echo '=== [0] A EXTENSÃO EXISTE? ESTÁ INSTALADA? (só pergunta) ================'
SELECT a.name                                             AS extensao,
       a.default_version                                  AS versao_disponivel,
       i.extversion                                       AS versao_instalada,
       CASE WHEN i.extversion IS NULL
            THEN 'NÃO instalada — a seção 1 vai falhar; use a seção 2'
            ELSE 'instalada — a seção 1 roda' END          AS situacao
  FROM pg_available_extensions a
  LEFT JOIN pg_extension i ON i.extname = a.name
 WHERE a.name = 'pgstattuple';

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [1] DENSIDADE MEDIDA — exige pgstattuple ============================'
-- `avg_leaf_density` é o percentual médio de ocupação das páginas-folha.
--
--   > 70%  saudável — um índice recém-construído fica em ~90%
--   40-70% normal para um índice com escrita constante
--   < 30%  inchado: a maior parte do arquivo é espaço vazio
--
-- `leaf_fragmentation` alto diz que a ordem física das folhas se afastou da
-- ordem lógica — varredura por faixa fica mais cara.
--
-- A lista é fixa de propósito: são os índices que a seção 5 de
-- `tamanho-do-banco.sql` mostrou como maiores, e medir só eles evita varrer o
-- banco inteiro. Edite a lista se quiser outro recorte.
SELECT i.nome                                             AS indice,
       pg_size_pretty(pg_relation_size(i.nome::regclass))  AS tamanho,
       s.version,
       s.tree_level                                        AS niveis,
       s.index_size,
       s.leaf_pages                                        AS paginas_folha,
       s.avg_leaf_density                                  AS densidade_pct,
       s.leaf_fragmentation                                AS fragmentacao_pct,
       round((pg_relation_size(i.nome::regclass)
              * (1 - s.avg_leaf_density / 100.0))::numeric / 1024 / 1024, 1)
                                                           AS mb_vazios_estimados
  FROM (VALUES
         ('change_pkey'),
         ('fact_origin_import_run_idx'),
         ('fact_attribute_idx'),
         ('fact_snapshot_entity_idx'),
         ('staged_fact_run_idx'),
         ('raw_cell_row_idx'),
         ('staged_fact_run_label_idx'),
         ('fact_entity_attribute_idx'),
         ('staged_fact_pkey'),
         ('staged_fact_raw_cell_idx'),
         ('raw_cell_pkey'),
         ('fact_pkey'),
         ('raw_cell_row_column_uq'),
         ('fact_raw_cell_idx'),
         ('fact_snapshot_attribute_idx'),
         ('fact_grain_uq'),
         ('staged_fact_grain_uq')
       ) AS i(nome)
  CROSS JOIN LATERAL pgstatindex(i.nome) AS s
 ORDER BY pg_relation_size(i.nome::regclass);

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [2] APROXIMAÇÃO SEM EXTENSÃO NENHUMA ================================'
-- Quando `pgstattuple` não está disponível, dá para chegar perto pelo catálogo:
-- compara o tamanho real com o que as chaves ocupariam se as páginas estivessem
-- cheias. É estimativa — a largura média das colunas vem de `pg_stats`, que o
-- ANALYZE alimenta por amostragem — mas separa 2x de 10x sem erro.
--
-- Leia `fator` como "quantas vezes maior que o mínimo teórico". Acima de ~3
-- merece o `pgstatindex` da seção 1 para confirmar antes de qualquer decisão.
-- ---------------------------------------------------------------------------
-- CORRIGIDO EM 15/09/2026 — a versão anterior subestimava inchaço
-- ---------------------------------------------------------------------------
-- A primeira versão calculava o piso como `linhas × largura_da_chave`, ou seja,
-- uma entrada por linha com a chave inteira repetida. Isso vale para índice
-- ÚNICO e está errado para índice NÃO-ÚNICO de baixa cardinalidade, por causa
-- da deduplicação de btree do PG 13+: chaves iguais viram uma *posting list* —
-- a chave guardada uma vez, e 6 bytes de ponteiro por linha.
--
-- O erro apareceu medido. `staged_fact_run_idx` indexa `import_run_id` sobre
-- 437 mil linhas com QUATRO valores distintos. A fórmula antiga dava piso de
-- 8.355 kB e fator 1,3 — "sadio". Reconstruído, ele foi de 11 MB para 3.032 kB:
-- estava 3,7x inchado. 437k × 6 bytes ≈ 2,6 MB, que é o tamanho real.
--
-- Quatro outros índices tiveram o mesmo diagnóstico errado pelo mesmo motivo
-- (`raw_cell_row_idx`, `staged_fact_run_label_idx`, `fact_origin_import_run_idx`,
-- `fact_snapshot_entity_idx`), e todos recuperaram 3 a 4x.
--
-- O erro era na direção pior: SUBESTIMAR inchaço justamente onde o ganho
-- proporcional é maior. Ver docs/RESULTADO-DA-REINDEXACAO.md.
WITH coluna AS (
  -- Uma linha por (índice, coluna indexada), com a largura média que o ANALYZE
  -- mediu. `indkey` é int2vector: o cast para smallint[] permite o unnest.
  -- `ord = 1` marca a coluna principal, que é a que manda na deduplicação.
  SELECT s.indexrelid,
         s.indexrelname                  AS indice,
         s.relname                       AS tabela,
         k.ord,
         coalesce(st.avg_width, 16)      AS avg_width,
         st.n_distinct
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
    CROSS JOIN LATERAL unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    LEFT JOIN pg_stats st ON st.schemaname = 'public'
                         AND st.tablename  = s.relname
                         AND st.attname    = a.attname
   WHERE pg_relation_size(s.indexrelid) > 4 * 1024 * 1024
     AND k.attnum > 0
), base AS (
  SELECT c.indice,
         c.tabela,
         c.indexrelid,
         i.indisunique                                   AS unico,
         pg_relation_size(c.indexrelid)                  AS bytes,
         greatest(t.reltuples, 0)::numeric               AS linhas,
         12 + sum(c.avg_width)                           AS bytes_por_entrada,
         -- n_distinct do ANALYZE: positivo é contagem absoluta, negativo é
         -- fração das linhas. Só o da coluna principal interessa.
         max(c.n_distinct) FILTER (WHERE c.ord = 1)      AS nd
    FROM coluna c
    JOIN pg_stat_user_indexes s ON s.indexrelid = c.indexrelid
    JOIN pg_index i ON i.indexrelid = c.indexrelid
    JOIN pg_class t ON t.oid = s.relid
   GROUP BY c.indice, c.tabela, c.indexrelid, i.indisunique, t.reltuples
), piso AS (
  SELECT b.*,
         CASE
           WHEN b.nd IS NULL THEN NULL
           WHEN b.nd >= 0    THEN b.nd
           ELSE -b.nd * b.linhas
         END                                             AS distintos_estimados
    FROM base b
), calculado AS (
  SELECT p.*,
         CASE
           -- Índice único: uma entrada por linha, chave inteira. Sem dedup.
           WHEN p.unico OR p.distintos_estimados IS NULL
             THEN p.linhas * p.bytes_por_entrada / 0.9
           -- Não-único: a chave é guardada uma vez por valor distinto, e cada
           -- linha custa os 6 bytes do ponteiro na posting list.
           ELSE (p.distintos_estimados * p.bytes_por_entrada + p.linhas * 6) / 0.9
         END                                             AS piso
    FROM piso p
)
SELECT indice,
       tabela,
       CASE WHEN unico THEN 'único' ELSE 'não-único' END           AS tipo,
       pg_size_pretty(bytes)                                       AS tamanho_real,
       linhas::bigint                                              AS linhas_vivas,
       distintos_estimados::bigint                                 AS valores_distintos,
       pg_size_pretty(piso::bigint)                                AS piso,
       round(bytes / nullif(piso, 0), 1)                           AS fator,
       pg_size_pretty(greatest(bytes - piso, 0)::bigint)           AS recuperavel_estimado,
       CASE WHEN NOT unico AND distintos_estimados < linhas / 10
            THEN 'dedup pesada — o piso já conta posting list' ELSE '' END AS nota
  FROM calculado
 ORDER BY bytes - piso DESC;

COMMIT;

\echo ''
\echo '=== FIM. Nenhuma escrita foi executada. Nenhuma extensão foi instalada. ='
