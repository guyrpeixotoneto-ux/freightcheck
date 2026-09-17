-- ---------------------------------------------------------------------------
-- OBSERVAÇÃO DO ESCOPO EM PRODUÇÃO — somente leitura.
-- ---------------------------------------------------------------------------
--
-- Este arquivo responde as seis perguntas que precedem o corte da ACL por
-- unidade. Ele **não escreve nada**: são sete `SELECT`, e a sessão é aberta em
-- `READ ONLY` justamente para que um engano de cópia não possa virar escrita.
--
-- Como rodar:
--
--     psql "$DATABASE_URL" -f scripts/diagnostico/escopo-em-producao.sql
--
-- Riscos, ditos por extenso:
--
-- · **Escrita:** impossível. `SET TRANSACTION READ ONLY` faz o Postgres recusar
--   qualquer `INSERT`, `UPDATE`, `DELETE` ou DDL dentro desta transação.
-- · **Carga:** as consultas são agregações sobre `unidade`, `app_user`,
--   `acesso_a_unidade` e `remuneracao_unidade` — tabelas de cadastro, não de
--   acervo. A maior delas tem ordem de milhares de linhas. Nenhuma varre
--   `fact`, `snapshot_fact` ou `change`.
-- · **Bloqueio:** nenhum. Leitura não pega lock que atrapalhe escrita
--   concorrente no MVCC do Postgres.
-- · **Dado sensível na saída:** sai e-mail de conta e nome de unidade. O
--   resultado é material de administração — trate-o como trata a tela de
--   Permissões, e não cole num canal aberto.
--
-- O que **não** está aqui, de propósito: a contagem de requisições que seriam
-- bloqueadas por rota. Ela não é uma pergunta de banco — sai de
-- `GET /api/escopo/observacao`, que mede tráfego real desde a última partida do
-- processo. As duas medições são complementares e a ordem certa é esta:
-- primeiro o cadastro (aqui), depois o tráfego (lá).

\timing on
BEGIN;
SET TRANSACTION READ ONLY;

\echo ''
\echo '=== 1. Unidades canônicas cadastradas ==='
\echo '(Se vier zero, a ponte que liga acervo a fronteira não existe ainda, e'
\echo ' o corte bloquearia toda leitura de acervo. É a primeira pré-condição.)'
SELECT count(*) AS unidades_canonicas FROM unidade;

\echo ''
\echo '=== 2. scope_hash distintos usados pelo acervo ==='
\echo '(O universo a classificar. Sai de snapshot, que é onde o acervo de fato'
\echo ' declara o escopo — e não de remuneracao_unidade, que é o cadastro.)'
SELECT count(DISTINCT scope_hash) AS hashes_no_acervo FROM snapshot;

\echo ''
\echo '=== 3. Hashes COM vínculo a uma unidade canônica ==='
SELECT count(DISTINCT ru.scope_hash) AS hashes_vinculados
  FROM remuneracao_unidade ru
 WHERE ru.unidade_id IS NOT NULL;

\echo ''
\echo '=== 4. Hashes SEM vínculo — o número que trava o corte ==='
\echo '(Cada um precisa ganhar unidade ou exceção escrita antes do enforcement.'
\echo ' Eles não são liberados por conveniência: no corte são recusados.)'
SELECT s.scope_hash,
       s.canal,
       count(*)                AS snapshots,
       max(s.effective_date)   AS vigencia_mais_recente
  FROM snapshot s
  LEFT JOIN remuneracao_unidade ru
         ON ru.scope_hash = s.scope_hash
        AND ru.unidade_id IS NOT NULL
 WHERE ru.scope_hash IS NULL
 GROUP BY s.scope_hash, s.canal
 ORDER BY count(*) DESC;

\echo ''
\echo '=== 5. Contas ativas e as concessões que já têm ==='
\echo '(A coluna `unidade_de_lotacao` é sugestão para o cadastro, NUNCA'
\echo ' autorização: ver schema/auth.ts. Ela sai aqui só para quem for'
\echo ' preencher a matriz ter por onde começar.)'
SELECT u.email,
       u.role,
       coalesce(l.nome, '(sem lotação)')  AS unidade_de_lotacao,
       count(a.unidade_id)                AS concessoes
  FROM app_user u
  LEFT JOIN unidade l ON l.id = u.unidade_id
  LEFT JOIN acesso_a_unidade a ON a.user_id = u.id
 WHERE u.disabled_at IS NULL
 GROUP BY u.email, u.role, l.nome
 ORDER BY count(a.unidade_id) ASC, u.email;

\echo ''
\echo '=== 6. Contas que ficariam SEM NENHUM acesso se o corte fosse ligado ==='
\echo '(É o trabalho de provisionamento. Enquanto for maior que zero, ligar o'
\echo ' corte é apagão — e nenhum fallback conserta isso sem desfazer a'
\echo ' fronteira, que é a decisão de produto registrada em'
\echo ' schema/acesso-a-unidade.ts.)'
SELECT count(*) AS contas_sem_concessao
  FROM app_user u
 WHERE u.disabled_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM acesso_a_unidade a WHERE a.user_id = u.id);

\echo ''
\echo '=== 7. Cobertura, em uma linha ==='
SELECT (SELECT count(*) FROM unidade)                                   AS unidades,
       (SELECT count(DISTINCT scope_hash) FROM snapshot)                AS hashes_acervo,
       (SELECT count(DISTINCT scope_hash) FROM remuneracao_unidade
         WHERE unidade_id IS NOT NULL)                                  AS vinculados,
       (SELECT count(*) FROM acesso_a_unidade)                          AS concessoes,
       (SELECT count(*) FROM app_user WHERE disabled_at IS NULL)        AS contas_ativas;

ROLLBACK;
\echo ''
\echo 'Transação encerrada com ROLLBACK. Nada foi escrito.'
