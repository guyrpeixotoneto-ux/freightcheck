-- ===========================================================================
-- DIAGNÓSTICO DE COBERTURA DAS VIGÊNCIAS — SOMENTE LEITURA
-- ===========================================================================
-- A pergunta: por que duas vigências de trecho da mesma unidade chegam com
-- `entity_type_set` diferente — uma `TRECHO`, outra `CAVALO+TRECHO` — e por
-- isso não formam par no seletor das telas de rubrica.
--
-- A hipótese que este diagnóstico confirma ou derruba, e que sai da leitura do
-- código (`canonical-identity.ts`, `pipeline.ts`):
--
--   A identidade de uma vigência é (sistema, FAMÍLIA, canal, data, escopo).
--   `datasetFamilyFor` não tem entrada para TRECHO, e o padrão é inclusivo:
--   TRECHO cai em REMUNERACAO_EQUIPAMENTO, a MESMA família de CAVALO e
--   CARRETA. Então a tabela de frete de uma unidade, com o mesmo canal e a
--   mesma data do export de equipamento, tem a MESMA identidade canônica — e
--   o segundo arquivo a chegar não abre vigência nova: entra como REVISÃO do
--   primeiro, herdando os fatos dos tipos que ele não toca. O
--   `entity_type_set` resultante é a união, e passa a declarar CAVALO+TRECHO.
--
--   Onde a data ou o canal não coincidem, não há colisão e a vigência de
--   trecho fica `TRECHO` limpa. É essa diferença entre meses que o seletor
--   mostra como "duas vigências que não emparelham".
--
-- Nenhuma linha escreve. Não há DELETE, UPDATE, INSERT, DDL nem migration, e
-- a sessão roda com `default_transaction_read_only = on` — a trava é do
-- servidor, não da leitura deste arquivo.
--
-- Custo: as seções leem `snapshot`, `snapshot_merge` e `import_decision`, que
-- têm uma linha por vigência/importação — dezenas a milhares, não milhões. A
-- seção 4 toca `fact` pela coluna indexada `snapshot_id`, restrita às
-- vigências que a seção 2 apontou.
--
-- Uso:  ./scripts/diagnostico/coberturas-da-vigencia.sh
-- ===========================================================================

\pset pager off
\timing off

\echo ''
\echo '=== 1. AS COBERTURAS QUE EXISTEM NO ACERVO ================================'
\echo 'Quantas vigências ativas por entity_type_set. Um TRECHO puro e um'
\echo 'CAVALO+TRECHO na mesma lista é o sintoma.'
\echo ''

BEGIN READ ONLY;
SELECT s.entity_type_set,
       s.dataset_family,
       count(*)                      AS vigencias,
       count(DISTINCT s.scope_hash)  AS unidades,
       min(s.effective_date)         AS da_data,
       max(s.effective_date)         AS ate_a_data
  FROM snapshot s
 WHERE s.status <> 'SUPERSEDED'
 GROUP BY 1, 2
 ORDER BY 1;
COMMIT;

\echo ''
\echo '=== 2. AS VIGÊNCIAS QUE COBREM TRECHO, UNIDADE A UNIDADE =================='
\echo 'É esta a lista que o seletor de Km Rodado, TMA e Velocidade Média oferece.'
\echo 'Duas linhas da mesma unidade com entity_type_set diferente é o par que'
\echo 'o motor recusa — `engine.ts`: "Coberturas diferentes".'
\echo ''

BEGIN READ ONLY;
SELECT s.scope_hash,
       s.effective_date,
       s.canal,
       s.source_label,
       s.entity_type_set,
       s.revision,
       s.supersedes_snapshot_id IS NOT NULL AS veio_de_revisao
  FROM snapshot s
 WHERE s.status <> 'SUPERSEDED'
   AND 'TRECHO' = ANY(string_to_array(s.entity_type_set, '+'))
 ORDER BY s.scope_hash, s.effective_date;
COMMIT;

\echo ''
\echo '=== 3. AS UNIDADES EM QUE A COBERTURA DIVERGE ============================='
\echo 'O recorte da seção 2 reduzido ao que quebra o par: unidades com duas ou'
\echo 'mais vigências de trecho e mais de um entity_type_set entre elas. Se esta'
\echo 'seção vier vazia, a causa do seletor travado é OUTRA — e a seção 2 diz'
\echo 'qual (uma vigência só, ou unidades diferentes na mesma lista).'
\echo ''

BEGIN READ ONLY;
SELECT s.scope_hash,
       count(*)                                   AS vigencias_de_trecho,
       array_agg(DISTINCT s.entity_type_set)      AS coberturas,
       array_agg(s.effective_date ORDER BY s.effective_date) AS datas
  FROM snapshot s
 WHERE s.status <> 'SUPERSEDED'
   AND 'TRECHO' = ANY(string_to_array(s.entity_type_set, '+'))
 GROUP BY s.scope_hash
HAVING count(DISTINCT s.entity_type_set) > 1
 ORDER BY 2 DESC;
COMMIT;

\echo ''
\echo '=== 4. A FUSÃO, PEGA NO ATO ==============================================='
\echo 'A prova direta da hipótese: numa vigência que declara CAVALO+TRECHO, os'
\echo 'fatos de CAVALO são HERDADOS (inherited_from_snapshot_id preenchido) e os'
\echo 'de TRECHO são próprios. Isso é o arquivo de trecho tendo entrado como'
\echo 'revisão do de equipamento, por partilharem a identidade canônica.'
\echo ''

BEGIN READ ONLY;
SELECT s.source_label,
       s.effective_date,
       s.entity_type_set,
       e.entity_type,
       count(*) FILTER (WHERE f.inherited_from_snapshot_id IS NOT NULL) AS fatos_herdados,
       count(*) FILTER (WHERE f.inherited_from_snapshot_id IS NULL)     AS fatos_do_arquivo
  FROM snapshot s
  JOIN fact f   ON f.snapshot_id = s.id
  JOIN entity e ON e.id = f.entity_id
 WHERE s.status <> 'SUPERSEDED'
   AND 'TRECHO' = ANY(string_to_array(s.entity_type_set, '+'))
   AND array_length(string_to_array(s.entity_type_set, '+'), 1) > 1
 GROUP BY 1, 2, 3, 4
 ORDER BY 2, 1, 4;
COMMIT;

\echo ''
\echo '=== 5. O QUE A PRÓPRIA IMPORTAÇÃO REGISTROU ==============================='
\echo 'O pipeline grava o motivo da fusão em snapshot_merge: "o arquivo trouxe X'
\echo 'e N fatos dos componentes não tocados foram herdados da revisão anterior".'
\echo 'É a frase escrita no momento em que a cobertura mudou.'
\echo ''

BEGIN READ ONLY;
SELECT s.source_label,
       s.effective_date,
       s.entity_type_set,
       m.motivo,
       m.created_at
  FROM snapshot_merge m
  JOIN snapshot s ON s.id = m.snapshot_id
 WHERE 'TRECHO' = ANY(string_to_array(s.entity_type_set, '+'))
 ORDER BY m.created_at DESC
 LIMIT 50;
COMMIT;

\echo ''
\echo '=== 6. AS IDENTIDADES CANÔNICAS DISPUTADAS ================================'
\echo 'A causa raiz, em uma linha por identidade: mesma família, mesmo canal,'
\echo 'mesma data e mesma unidade servindo a mais de uma revisão. A coluna'
\echo 'coberturas mostra a cobertura crescendo de uma revisão para a seguinte.'
\echo ''

BEGIN READ ONLY;
SELECT s.dataset_family,
       s.canal,
       s.effective_date,
       s.scope_hash,
       count(*)                                          AS revisoes,
       array_agg(s.entity_type_set ORDER BY s.revision)   AS coberturas,
       array_agg(s.source_label    ORDER BY s.revision)   AS arquivos
  FROM snapshot s
 WHERE s.canonical_snapshot_key IN (
         SELECT canonical_snapshot_key
           FROM snapshot
          WHERE 'TRECHO' = ANY(string_to_array(entity_type_set, '+'))
       )
 GROUP BY 1, 2, 3, 4
HAVING count(*) > 1
 ORDER BY 3, 2;
COMMIT;

\echo ''
\echo '=== FIM ==================================================================='
\echo ''
