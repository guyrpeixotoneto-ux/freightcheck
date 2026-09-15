#!/usr/bin/env bash
# ===========================================================================
# REINDEXAÇÃO — ESTE SCRIPT ESCREVE NO BANCO
# ===========================================================================
# Mora em `scripts/manutencao/`, e não em `scripts/diagnostico/`, porque a
# diferença importa: tudo em `diagnostico/` é somente leitura e o runner de lá
# RECUSA este arquivo por conter REINDEX. Essa recusa é correta e não deve ser
# afrouxada — por isso a operação de escrita tem casa própria, nome próprio, e
# exige confirmação explícita.
#
# O que faz: `REINDEX INDEX CONCURRENTLY` nos índices pedidos, um por vez, do
# menor para o maior, conferindo a validade depois de cada um e parando no
# primeiro sinal de problema.
#
# O que NÃO faz: não apaga dado, não altera schema, não instala extensão, não
# roda VACUUM, não toca em `staged_fact`, não mexe em índice que não foi pedido.
# `REINDEX` reconstrói a mesma estrutura a partir das mesmas linhas.
#
# ---------------------------------------------------------------------------
# A lista vem de fora, e é de propósito
# ---------------------------------------------------------------------------
# A primeira versão trazia quatro índices fixos no código. Quando os doze
# restantes foram autorizados, fixar uma SEGUNDA lista teria criado dois
# scripts quase iguais que divergem no primeiro dia em que alguém edita um só.
# Agora a lista é argumento, e os presets são atalhos nomeados para conjuntos
# que já foram autorizados — não permissões que o script se concede.
#
# Presets:
#   --os-quatro     os quatro maiores (executado em 15/09/2026)
#   --os-restantes  os treze que sobraram depois daquela passada
#
# Uso:  PRODUCTION_DATABASE_URL='postgres://…' \
#         ./scripts/manutencao/reindexar.sh --confirmar --os-restantes
#       PRODUCTION_DATABASE_URL='postgres://…' \
#         ./scripts/manutencao/reindexar.sh --confirmar fact_pkey raw_cell_pkey
# ===========================================================================
set -Eeuo pipefail

erro() { printf '\n\033[1;31mABORTADO:\033[0m %s\n\n' "$1" >&2; exit 1; }
titulo() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

# Autorizado por Guy em 15/09/2026. Executado na mesma data.
PRESET_OS_QUATRO=(
  fact_raw_cell_idx
  fact_snapshot_attribute_idx
  fact_grain_uq
  staged_fact_grain_uq
)

# Autorizado por Guy em 15/09/2026, depois do resultado da primeira passada.
# Ordenados pelo tamanho medido DEPOIS da primeira passada, do menor para o
# maior — o primeiro calibra.
#
# Quatro deles (`raw_cell_row_idx`, `staged_fact_run_idx`,
# `staged_fact_run_label_idx`, `fact_origin_import_run_idx`) mediram fator 0,9 a
# 1,6 e **não têm praticamente nada a recuperar**. Entram mesmo assim: custam
# segundos, e um "0 bytes recuperados" neles é confirmação de que estão sadios,
# não falha do script. Ver docs/RESULTADO-DA-REINDEXACAO.md.
PRESET_OS_RESTANTES=(
  change_pkey                  # ~3,7 MB — o maior fator do banco (~20x)
  raw_cell_row_idx             # ~11 MB — 1,2x, sadio
  staged_fact_run_idx          # ~11 MB — 1,3x, sadio
  staged_fact_run_label_idx    # ~12 MB — 0,9x, sadio
  fact_origin_import_run_idx   # ~13 MB — 1,6x
  fact_attribute_idx           # ~15 MB — 1,8x
  fact_snapshot_entity_idx     # ~20 MB — 1,6x
  fact_entity_attribute_idx    # ~35 MB — 2,7x
  staged_fact_pkey             # ~35 MB — 6,0x
  staged_fact_raw_cell_idx     # ~35 MB — 6,0x
  raw_cell_pkey                # ~37 MB — 4,1x
  fact_pkey                    # ~42 MB — 7,3x
  raw_cell_row_column_uq       # ~53 MB — 4,8x
)

CONFIRMADO=0
INDICES=()
for arg in "$@"; do
  case "$arg" in
    --confirmar)    CONFIRMADO=1 ;;
    --os-quatro)    INDICES+=("${PRESET_OS_QUATRO[@]}") ;;
    --os-restantes) INDICES+=("${PRESET_OS_RESTANTES[@]}") ;;
    -*)             erro "opção desconhecida: ${arg}" ;;
    *)              INDICES+=("$arg") ;;
  esac
done

# --- TRAVA 0 — confirmação explícita e lista não vazia -------------------
if [ "$CONFIRMADO" -ne 1 ] || [ ${#INDICES[@]} -eq 0 ]; then
  cat >&2 <<'AVISO'
Este script ESCREVE no banco de produção.

Ele reconstrói índices com REINDEX INDEX CONCURRENTLY. Não apaga dado e não
altera schema, mas é escrita, e escrita não acontece por engano aqui.

  ./scripts/manutencao/reindexar.sh --confirmar --os-restantes
  ./scripts/manutencao/reindexar.sh --confirmar <indice> [<indice>...]

Presets: --os-quatro, --os-restantes
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

# `IFS="','"` NÃO serve para montar esta lista: o join de ${a[*]} usa só o
# PRIMEIRO caractere do IFS, e produzia 'a'b'c'd' — lista inválida que quebraria
# as consultas de antes e depois. Observado ao testar, não deduzido.
LISTA_SQL_INICIAL="$(printf "'%s'," "${INDICES[@]}")"; LISTA_SQL_INICIAL="${LISTA_SQL_INICIAL%,}"

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

# --- 0d. Os índices pedidos existem? -------------------------------------
for idx in "${INDICES[@]}"; do
  existe="$(consulta "SELECT count(*) FROM pg_class WHERE relname = '${idx}' AND relkind = 'i';")"
  [ "${existe:-0}" -eq 1 ] || erro "Índice '${idx}' não encontrado. Nada foi escrito."
done
echo "  ok: os ${#INDICES[@]} índices pedidos existem."

# --- 0e. Do menor para o maior, pelo tamanho REAL ------------------------
# A ordem não vem da lista escrita à mão: vem do banco. O primeiro índice
# calibra o tempo dos demais, e para isso ele precisa ser mesmo o menor hoje —
# não o que era menor quando a lista foi escrita.
mapfile -t INDICES < <(consulta "
SELECT c.relname FROM pg_class c
 WHERE c.relname IN (${LISTA_SQL_INICIAL})
 ORDER BY pg_relation_size(c.oid);")
echo "  ordem (menor → maior): ${INDICES[*]}"

# =========================================================================
# ANTES
# =========================================================================
titulo "[1] ANTES"
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
