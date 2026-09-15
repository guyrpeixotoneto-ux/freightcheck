#!/usr/bin/env bash
# ===========================================================================
# REINDEXAÇÃO DOS QUATRO MAIORES ÍNDICES — ESTE SCRIPT ESCREVE NO BANCO
# ===========================================================================
# Mora em `scripts/manutencao/`, e não em `scripts/diagnostico/`, porque a
# diferença importa: tudo em `diagnostico/` é somente leitura e o runner de lá
# RECUSA este arquivo por conter REINDEX. Essa recusa é correta e não deve ser
# afrouxada — por isso a operação de escrita tem casa própria, nome próprio, e
# exige confirmação explícita.
#
# O que faz: `REINDEX INDEX CONCURRENTLY` em quatro índices, um por vez, do
# menor para o maior, conferindo a validade depois de cada um e parando no
# primeiro sinal de problema.
#
# O que NÃO faz: não apaga dado, não altera schema, não instala extensão, não
# roda VACUUM, não toca em `staged_fact`, não mexe em nenhum outro índice.
# `REINDEX` reconstrói a mesma estrutura a partir das mesmas linhas.
#
# Autorizado por Guy em 15/09/2026, para estes quatro índices e mais nada.
# Evidência: docs/PLANO-INCHACO-DOS-INDICES.md
#
# Uso:  PRODUCTION_DATABASE_URL='postgres://…' \
#         ./scripts/manutencao/reindexar-os-quatro.sh --confirmar
# ===========================================================================
set -Eeuo pipefail

erro() { printf '\n\033[1;31mABORTADO:\033[0m %s\n\n' "$1" >&2; exit 1; }
titulo() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

# Do menor para o maior. O primeiro calibra: se ele levar muito mais que o
# esperado, o resto da estimativa está errado e vale parar antes do de 355 MB.
INDICES=(
  fact_raw_cell_idx            # ~60 MB
  fact_snapshot_attribute_idx  # ~159 MB
  fact_grain_uq                # ~172 MB
  staged_fact_grain_uq         # ~355 MB
)

# --- TRAVA 0 — confirmação explícita -------------------------------------
if [ "${1:-}" != "--confirmar" ]; then
  cat >&2 <<'AVISO'
Este script ESCREVE no banco de produção.

Ele reconstrói quatro índices com REINDEX INDEX CONCURRENTLY. Não apaga dado e
não altera schema, mas é escrita, e escrita não acontece por engano aqui.

Para executar:  ./scripts/manutencao/reindexar-os-quatro.sh --confirmar
AVISO
  exit 1
fi

# --- TRAVA 1 — sem defaults para onde cair -------------------------------
unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGSERVICE PGSERVICEFILE || true

# --- TRAVA 2 — a URL existe, é URL, e não é a de Development -------------
[ -n "${PRODUCTION_DATABASE_URL+x}" ] || erro "PRODUCTION_DATABASE_URL não está definida."
[ -n "${PRODUCTION_DATABASE_URL// /}" ] || erro "PRODUCTION_DATABASE_URL está VAZIA."
case "$PRODUCTION_DATABASE_URL" in
  postgres://*|postgresql://*) : ;;
  *) erro "PRODUCTION_DATABASE_URL não é uma URL postgres." ;;
esac
if [ -n "${DATABASE_URL:-}" ] && [ "$PRODUCTION_DATABASE_URL" = "${DATABASE_URL}" ]; then
  erro "PRODUCTION_DATABASE_URL é IDÊNTICA a DATABASE_URL (Development)."
fi

# A URL nunca é impressa daqui para baixo.
#
# `lock_timeout` e não espera infinita: REINDEX CONCURRENTLY aguarda as
# transações abertas que enxergam a tabela, e sem teto ele fica pendurado em
# silêncio. Com teto, falha rápido e com nome — e falhar antes de começar é
# muito melhor que ser morto no meio.
#
# `statement_timeout = 0` de propósito, e é a exceção deliberada: um REINDEX
# morto pelo relógio deixa um índice INVÁLIDO para trás. O teto aqui é a pessoa
# que está olhando, não o relógio.
PSQL=(psql --dbname="$PRODUCTION_DATABASE_URL" -X --quiet --no-password
           -v ON_ERROR_STOP=1
           -c 'SET lock_timeout = "60s"'
           -c 'SET statement_timeout = 0')

conectar_ou_morrer() {
  psql --dbname="$PRODUCTION_DATABASE_URL" -X --quiet --no-password \
       -Atc 'SELECT 1' >/dev/null 2>&1 \
    || erro "Não foi possível conectar. (Mensagem omitida: costuma conter host e usuário.)"
}

consulta() {  # consulta <sql> -> saída crua, uma coluna
  psql --dbname="$PRODUCTION_DATABASE_URL" -X --quiet --no-password -Atc "$1"
}

tabela() {    # tabela <sql> -> saída formatada
  psql --dbname="$PRODUCTION_DATABASE_URL" -X --quiet --no-password \
       --pset=pager=off -c "$1"
}

conectar_ou_morrer

# =========================================================================
# CONFERÊNCIAS PRÉVIAS — qualquer uma que falhe aborta antes de escrever
# =========================================================================
titulo "[0] CONFERÊNCIAS PRÉVIAS"

# --- 0a. Importação em andamento -----------------------------------------
# PENDING, READING e PROMOTING são trabalho em curso. STAGED e PREVIEWED
# esperam decisão de gente e podem virar promoção a qualquer segundo — contam
# como impedimento pelo mesmo motivo.
tabela "
SELECT ir.status::text AS estado,
       count(*)        AS quantas,
       max(ir.started_at) AS mais_recente
  FROM import_run ir
 WHERE ir.status IN ('PENDING','READING','PROMOTING','STAGED','PREVIEWED')
 GROUP BY ir.status
 ORDER BY 1;"

EM_CURSO="$(consulta "
SELECT count(*) FROM import_run
 WHERE status IN ('PENDING','READING','PROMOTING','STAGED','PREVIEWED');")"

if [ "${EM_CURSO:-0}" -gt 0 ]; then
  erro "Há ${EM_CURSO} importação(ões) em andamento ou aguardando decisão (acima).
        REINDEX CONCURRENTLY espera as transações abertas que enxergam a tabela,
        e uma promoção no meio o faria esperar — ou ser morto. Nada foi escrito.

        Conclua ou descarte essas importações e rode de novo."
fi
echo "  ok: nenhuma importação em andamento."

# --- 0b. Transação longa aberta ------------------------------------------
tabela "
SELECT pid,
       state,
       date_trunc('second', clock_timestamp() - xact_start) AS transacao_aberta_ha,
       left(regexp_replace(query, '\s+', ' ', 'g'), 60)     AS consulta
  FROM pg_stat_activity
 WHERE xact_start IS NOT NULL
   AND pid <> pg_backend_pid()
   AND datname = current_database()
   AND clock_timestamp() - xact_start > interval '30 seconds'
 ORDER BY xact_start;"

LONGAS="$(consulta "
SELECT count(*) FROM pg_stat_activity
 WHERE xact_start IS NOT NULL AND pid <> pg_backend_pid()
   AND datname = current_database()
   AND clock_timestamp() - xact_start > interval '30 seconds';")"

if [ "${LONGAS:-0}" -gt 0 ]; then
  erro "Há ${LONGAS} transação(ões) aberta(s) há mais de 30s (acima).
        REINDEX CONCURRENTLY vai esperar por elas. Nada foi escrito."
fi
echo "  ok: nenhuma transação longa aberta."

# --- 0c. Índice inválido preexistente ------------------------------------
INVALIDOS="$(consulta "
SELECT count(*) FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT i.indisvalid AND n.nspname = 'public';")"

if [ "${INVALIDOS:-0}" -gt 0 ]; then
  tabela "
SELECT c.relname AS indice_invalido, pg_size_pretty(pg_relation_size(c.oid)) AS tamanho
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT i.indisvalid AND n.nspname = 'public';"
  erro "Já existe ${INVALIDOS} índice inválido no banco (acima), de alguma operação
        anterior interrompida. Limpe-os antes:
          DROP INDEX CONCURRENTLY <nome>;
        Nada foi escrito."
fi
echo "  ok: nenhum índice inválido preexistente."

# --- 0d. Os quatro existem? ----------------------------------------------
for idx in "${INDICES[@]}"; do
  existe="$(consulta "SELECT count(*) FROM pg_class WHERE relname = '${idx}' AND relkind = 'i';")"
  [ "${existe:-0}" -eq 1 ] || erro "Índice '${idx}' não encontrado. Nada foi escrito."
done
echo "  ok: os quatro índices existem."

# =========================================================================
# ANTES
# =========================================================================
titulo "[1] ANTES"
# `IFS="','"` NÃO serve aqui: o join de ${a[*]} usa só o PRIMEIRO caractere do
# IFS, então aquilo produzia 'a'b'c'd' — lista inválida que quebraria as duas
# consultas de antes/depois. Observado ao testar, não deduzido.
LISTA_SQL="$(printf "'%s'," "${INDICES[@]}")"; LISTA_SQL="${LISTA_SQL%,}"
tabela "
SELECT c.relname AS indice, pg_size_pretty(pg_relation_size(c.oid)) AS tamanho
  FROM pg_class c WHERE c.relname IN (${LISTA_SQL})
 ORDER BY pg_relation_size(c.oid);"
tabela "
SELECT pg_size_pretty(pg_database_size(current_database())) AS banco_total,
       (SELECT sum(raw_cell_count) FROM import_run)         AS celulas_vivas,
       round(pg_database_size(current_database())
             / nullif((SELECT sum(raw_cell_count) FROM import_run), 0), 0)
                                                            AS bytes_por_celula;"

ANTES_BANCO="$(consulta "SELECT pg_database_size(current_database());")"

# =========================================================================
# A REINDEXAÇÃO — um por vez, validando entre um e o seguinte
# =========================================================================
for idx in "${INDICES[@]}"; do
  antes="$(consulta "SELECT pg_size_pretty(pg_relation_size('${idx}'::regclass));")"
  titulo "[2] REINDEX ${idx} (antes: ${antes})"
  inicio=$(date +%s)

  if ! "${PSQL[@]}" -c "REINDEX INDEX CONCURRENTLY ${idx};"; then
    tabela "
SELECT c.relname AS indice, i.indisvalid AS valido,
       pg_size_pretty(pg_relation_size(c.oid)) AS tamanho
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND (NOT i.indisvalid OR c.relname LIKE '%_ccnew%');"
    erro "REINDEX de '${idx}' falhou. O índice ANTIGO continua válido e em uso —
        a aplicação não foi afetada. Se a listagem acima mostrar algum
        '%_ccnew%', remova com:
          DROP INDEX CONCURRENTLY <nome>;
        Os índices seguintes NÃO foram tocados."
  fi

  fim=$(date +%s)
  depois="$(consulta "SELECT pg_size_pretty(pg_relation_size('${idx}'::regclass));")"
  valido="$(consulta "SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = '${idx}';")"

  if [ "$valido" != "t" ]; then
    erro "'${idx}' ficou INVÁLIDO depois do REINDEX. Pare aqui e investigue.
        Os índices seguintes NÃO foram tocados."
  fi

  # Um `_ccnew` sobrando é lixo de uma tentativa anterior; não é fatal, mas não
  # passa em silêncio.
  sobras="$(consulta "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname LIKE '%_ccnew%';")"
  if [ "${sobras:-0}" -gt 0 ]; then
    tabela "SELECT c.relname AS sobra FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE '%_ccnew%';"
    erro "Sobrou índice '_ccnew' (acima) depois de '${idx}'. Remova com
          DROP INDEX CONCURRENTLY <nome>;
        antes de continuar. Os índices seguintes NÃO foram tocados."
  fi

  printf '  \033[1;32mok\033[0m: %s → %s em %ds, válido, sem sobras.\n' \
    "$antes" "$depois" "$((fim - inicio))"
done

# =========================================================================
# DEPOIS
# =========================================================================
titulo "[3] DEPOIS"
tabela "
SELECT c.relname AS indice, pg_size_pretty(pg_relation_size(c.oid)) AS tamanho
  FROM pg_class c WHERE c.relname IN (${LISTA_SQL})
 ORDER BY pg_relation_size(c.oid);"
tabela "
SELECT pg_size_pretty(pg_database_size(current_database())) AS banco_total,
       (SELECT sum(raw_cell_count) FROM import_run)         AS celulas_vivas,
       round(pg_database_size(current_database())
             / nullif((SELECT sum(raw_cell_count) FROM import_run), 0), 0)
                                                            AS bytes_por_celula;"

titulo "[4] ÍNDICES INVÁLIDOS OU SOBRAS — tem de vir vazio"
tabela "
SELECT c.relname AS indice, i.indisvalid AS valido,
       pg_size_pretty(pg_relation_size(c.oid)) AS tamanho
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND (NOT i.indisvalid OR c.relname LIKE '%_ccnew%');"

DEPOIS_BANCO="$(consulta "SELECT pg_database_size(current_database());")"
titulo "[5] RESULTADO"
printf '  banco antes:  %s\n' "$(consulta "SELECT pg_size_pretty(${ANTES_BANCO}::bigint);")"
printf '  banco depois: %s\n' "$(consulta "SELECT pg_size_pretty(${DEPOIS_BANCO}::bigint);")"
printf '  recuperado:   %s\n' "$(consulta "SELECT pg_size_pretty((${ANTES_BANCO} - ${DEPOIS_BANCO})::bigint);")"
echo ""
echo "  Nenhum dado foi alterado. Nenhum schema foi alterado."
echo "  Próximo passo: ./scripts/diagnostico/ler-producao.sh scripts/diagnostico/crescimento.sql"
