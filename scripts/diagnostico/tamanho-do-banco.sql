-- ===========================================================================
-- DIAGNÓSTICO DE TAMANHO E CRESCIMENTO DO BANCO — SOMENTE LEITURA
-- ===========================================================================
-- Nenhuma linha deste arquivo escreve. Não há DELETE, UPDATE, INSERT, DDL,
-- VACUUM, ANALYZE nem migration. Toda seção roda dentro de uma transação
-- `READ ONLY`, que faz o próprio Postgres recusar qualquer escrita que
-- escapasse por engano — a trava não depende de quem lê o arquivo.
--
-- Custo: TODAS as seções leem apenas CATÁLOGO e ESTATÍSTICA (pg_class,
-- pg_stat_*, information_schema). Nenhuma varre os dados de nenhuma tabela: são
-- milissegundos mesmo num banco grande, e não competem com a aplicação. Não há
-- `count(*)` exato em lugar nenhum — a contagem de linhas sai da estimativa do
-- planejador, que é o que torna a seção 3 barata.
--
-- A seção 10 é a exceção estudada: ela NÃO consulta as tabelas, apenas IMPRIME
-- o SQL que mediria a janela de datas delas. Esse SQL é o único deste
-- diagnóstico que pode custar caro (min/max sem índice varre a tabela inteira),
-- e por isso sai para ser lido antes de rodar, em vez de rodar sozinho.
--
-- Uso:  ./scripts/diagnostico/tamanho-do-banco.sh
-- ===========================================================================

\pset pager off
\timing off

-- Uma transação POR SEÇÃO, e não uma para o arquivo inteiro. Se uma seção for
-- recusada por falta de permissão (é o caso de `pg_ls_waldir()` em banco
-- gerenciado), só ela falha: numa transação única, a primeira recusa abortaria
-- todas as seguintes com "current transaction is aborted" e o diagnóstico
-- voltaria vazio sem que ninguém percebesse o motivo.
--
-- `default_transaction_read_only = on` já vem ligado pelo runner, para a sessão
-- inteira; o `READ ONLY` de cada `BEGIN` é a segunda trava, não a única.
--
-- O teto de 60s mata uma consulta de diagnóstico que se alongue, em vez de
-- deixá-la segurando recurso do banco de produção.
SET statement_timeout = '60s';

BEGIN READ ONLY;

\echo ''
\echo '=== [0] IDENTIDADE DO SERVIDOR (nada sensível) ==========================='
-- O host aparece só como hash curto: serve para COMPARAR com o de
-- desenvolvimento sem expor endereço, usuário ou senha.
SELECT current_database()                                          AS base,
       left(md5(coalesce(inet_server_addr()::text,'socket')), 8)   AS host_hash,
       pg_is_in_recovery()                                         AS eh_replica,
       version()                                                   AS versao,
       date_trunc('second', pg_postmaster_start_time())            AS no_ar_desde,
       date_trunc('second', now() - pg_postmaster_start_time())    AS uptime;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [1] TAMANHO TOTAL DO BANCO ==========================================='
-- pg_database_size = heap + índices + TOAST + catálogo DESTE banco.
-- Não inclui WAL, backups, réplicas, logs nem arquivos fora do Postgres.
SELECT pg_size_pretty(pg_database_size(current_database())) AS banco_total,
       pg_database_size(current_database())                 AS bytes;

\echo ''
\echo '--- [1b] Todos os bancos do mesmo servidor (o painel pode somar todos) ---'
SELECT datname                                AS banco,
       pg_size_pretty(pg_database_size(datname)) AS tamanho,
       pg_database_size(datname)              AS bytes
  FROM pg_database
 WHERE datallowconn
 ORDER BY pg_database_size(datname) DESC;

COMMIT;

BEGIN READ ONLY;

\echo ''
-- Numa transação só dela: `pg_ls_waldir()` exige `pg_monitor`, e em banco
-- gerenciado a recusa é o resultado esperado — não pode levar junto as outras.
\echo '--- [1c] WAL acumulado (fora do pg_database_size, mas ocupa disco) -------'
SELECT count(*)                                    AS arquivos_wal,
       pg_size_pretty(coalesce(sum(size), 0))      AS wal_total
  FROM pg_ls_waldir();

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [2] DADOS x ÍNDICES x TOAST (o banco inteiro, por camada) ============'
SELECT pg_size_pretty(sum(pg_relation_size(c.oid)))                 AS heap_tabelas,
       pg_size_pretty(sum(pg_indexes_size(c.oid)))                  AS indices,
       pg_size_pretty(sum(
         CASE WHEN c.reltoastrelid <> 0
              THEN pg_total_relation_size(c.reltoastrelid) ELSE 0 END))  AS toast,
       pg_size_pretty(sum(pg_total_relation_size(c.oid)))           AS total
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p','m')
   AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast');

\echo ''
\echo '--- [2b] Por schema ------------------------------------------------------'
SELECT n.nspname                                          AS schema,
       count(*)                                           AS tabelas,
       pg_size_pretty(sum(pg_total_relation_size(c.oid))) AS total
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p','m')
   AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
 GROUP BY n.nspname
 ORDER BY sum(pg_total_relation_size(c.oid)) DESC;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [3] AS 20 MAIORES TABELAS (total, heap, índices, TOAST, linhas) ====='
-- `linhas_aprox` vem de pg_class.reltuples: a estimativa do planejador,
-- atualizada pelo autovacuum/analyze. É barata e não varre a tabela. Onde o
-- número tiver de ser exato, ver seção 10.
SELECT c.relname                                              AS tabela,
       pg_size_pretty(pg_total_relation_size(c.oid))          AS total,
       pg_size_pretty(pg_relation_size(c.oid))                AS heap,
       pg_size_pretty(pg_indexes_size(c.oid))                 AS indices,
       pg_size_pretty(CASE WHEN c.reltoastrelid <> 0
                           THEN pg_total_relation_size(c.reltoastrelid)
                           ELSE 0 END)                        AS toast,
       CASE WHEN c.reltuples < 0 THEN NULL
            ELSE c.reltuples::bigint END                      AS linhas_aprox,
       round(100.0 * pg_total_relation_size(c.oid)
             / nullif(pg_database_size(current_database()), 0), 1) AS pct_do_banco
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p','m')
   AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
 ORDER BY pg_total_relation_size(c.oid) DESC
 LIMIT 20;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [4] PROPORÇÃO ÍNDICE/DADO — onde o índice pesa mais que a tabela ===='
SELECT c.relname                                     AS tabela,
       pg_size_pretty(pg_relation_size(c.oid))       AS heap,
       pg_size_pretty(pg_indexes_size(c.oid))        AS indices,
       round(pg_indexes_size(c.oid)::numeric
             / nullif(pg_relation_size(c.oid), 0), 2) AS indice_por_dado
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r','p')
   AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
   AND pg_relation_size(c.oid) > 1024*1024
 ORDER BY pg_indexes_size(c.oid) DESC
 LIMIT 20;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [5] OS 25 MAIORES ÍNDICES, E QUANTAS VEZES FORAM USADOS ============='
-- idx_scan = 0 quer dizer "nunca usado DESDE O ÚLTIMO RESET DA ESTATÍSTICA".
-- A data do reset está logo abaixo: sem ela o zero não quer dizer nada.
SELECT s.relname                                  AS tabela,
       s.indexrelname                             AS indice,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS tamanho,
       s.idx_scan                                 AS usos,
       i.indisunique                              AS unico,
       i.indisprimary                             AS pk
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON i.indexrelid = s.indexrelid
 ORDER BY pg_relation_size(s.indexrelid) DESC
 LIMIT 25;

\echo ''
\echo '--- [5b] Desde quando a estatística de uso está contando -----------------'
SELECT stats_reset AS estatistica_zerada_em FROM pg_stat_database
 WHERE datname = current_database();

\echo ''
\echo '--- [5c] Índices nunca usados e não-únicos (candidatos, NÃO veredito) ----'
-- Não é ordem de apagar: um índice pode existir para um relatório mensal, para
-- uma FK, ou para uma consulta que ainda não rodou desde o reset acima.
SELECT s.relname AS tabela, s.indexrelname AS indice,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS tamanho
  FROM pg_stat_user_indexes s
  JOIN pg_index i ON i.indexrelid = s.indexrelid
 WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
   AND pg_relation_size(s.indexrelid) > 512*1024
 ORDER BY pg_relation_size(s.indexrelid) DESC;

\echo ''
\echo '--- [5d] Índices redundantes: um é prefixo de colunas do outro ----------'
SELECT a.relname AS tabela,
       a.indexrelname AS contido,   pg_size_pretty(pg_relation_size(a.indexrelid)) AS tam_contido,
       b.indexrelname AS contendo,  pg_size_pretty(pg_relation_size(b.indexrelid)) AS tam_contendo
  FROM pg_stat_user_indexes a
  JOIN pg_index ia ON ia.indexrelid = a.indexrelid
  JOIN pg_stat_user_indexes b ON b.relid = a.relid AND b.indexrelid <> a.indexrelid
  JOIN pg_index ib ON ib.indexrelid = b.indexrelid
 WHERE ia.indnatts <= ib.indnatts
   AND ia.indkey::text = left(ib.indkey::text, length(ia.indkey::text))
   AND NOT ia.indisprimary
 ORDER BY pg_relation_size(a.indexrelid) DESC;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [6] LINHAS MORTAS E AUTOVACUUM ======================================'
-- n_dead_tup alto = espaço ocupado por linhas já apagadas/atualizadas que o
-- autovacuum ainda não devolveu para reuso. Muito dele explica um banco maior
-- que a soma dos dados vivos — sem que nada de errado tenha sido feito.
SELECT relname                                      AS tabela,
       n_live_tup                                   AS vivas,
       n_dead_tup                                   AS mortas,
       round(100.0 * n_dead_tup / nullif(n_live_tup + n_dead_tup, 0), 1) AS pct_mortas,
       pg_size_pretty(pg_total_relation_size(relid)) AS total,
       last_autovacuum, last_vacuum, last_autoanalyze
  FROM pg_stat_user_tables
 WHERE n_dead_tup > 1000
 ORDER BY n_dead_tup DESC
 LIMIT 25;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [7] TOAST — os campos extensos (texto grande, jsonb, bytea) ========='
SELECT c.relname                                               AS tabela,
       pg_size_pretty(pg_total_relation_size(c.reltoastrelid)) AS toast,
       pg_size_pretty(pg_relation_size(c.oid))                 AS heap,
       round(100.0 * pg_total_relation_size(c.reltoastrelid)
             / nullif(pg_total_relation_size(c.oid), 0), 1)    AS pct_da_tabela
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND c.reltoastrelid <> 0
   AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
   AND pg_total_relation_size(c.reltoastrelid) > 0
 ORDER BY pg_total_relation_size(c.reltoastrelid) DESC
 LIMIT 20;

\echo ''
\echo '--- [7b] Colunas jsonb / bytea / text declaradas no schema ---------------'
SELECT table_name AS tabela, column_name AS coluna, data_type AS tipo
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND data_type IN ('jsonb','json','bytea')
 ORDER BY data_type, table_name, column_name;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [8] SINAIS DE CRESCIMENTO CONTÍNUO =================================='
-- n_tup_ins acumula desde o reset da estatística (data na seção 5b). Uma tabela
-- com muita inserção e nenhuma remoção é, por definição, uma que só cresce.
SELECT relname                                       AS tabela,
       n_tup_ins                                     AS inseridas,
       n_tup_upd                                     AS atualizadas,
       n_tup_del                                     AS removidas,
       n_live_tup                                    AS vivas,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
  FROM pg_stat_user_tables
 WHERE n_tup_ins > 0
 ORDER BY n_tup_ins DESC
 LIMIT 25;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [9] TABELAS SEM NENHUMA LEITURA (candidatas a órfãs) ================'
-- Mesma ressalva da 5c: "não lida desde o reset" não é "não usada".
SELECT relname                                       AS tabela,
       seq_scan, idx_scan, n_live_tup                AS vivas,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
  FROM pg_stat_user_tables
 WHERE seq_scan = 0 AND coalesce(idx_scan, 0) = 0
 ORDER BY pg_total_relation_size(relid) DESC;

COMMIT;

BEGIN READ ONLY;

\echo ''
\echo '=== [10] GERADOR: janela de datas das maiores tabelas ==================='
-- Esta seção NÃO consulta as tabelas: ela IMPRIME o SQL que faria isso, para
-- que cada consulta seja lida antes de rodar. São min()/max() sobre colunas de
-- data das 15 maiores tabelas; com índice na coluna é barato, sem índice é uma
-- varredura da tabela inteira — por isso não roda sozinha.
SELECT format(
         'SELECT %L AS tabela, min(%I) AS mais_antigo, max(%I) AS mais_recente, count(*) AS linhas FROM %I;',
         c.relname, a.attname, a.attname, c.relname) AS sql_para_revisar
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  JOIN pg_type t ON t.oid = a.atttypid
 WHERE c.relkind = 'r'
   AND n.nspname = 'public'
   AND t.typname IN ('timestamptz','timestamp','date')
   AND a.attname IN ('created_at','received_at','started_at','em','dia','criado_em','guardado_em')
   AND c.oid IN (
     SELECT c2.oid FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
      WHERE c2.relkind = 'r' AND n2.nspname = 'public'
      ORDER BY pg_total_relation_size(c2.oid) DESC LIMIT 15)
 ORDER BY pg_total_relation_size(c.oid) DESC, c.relname, a.attname;

COMMIT;

\echo ''
\echo '=== FIM. Nenhuma escrita foi executada. ================================='
