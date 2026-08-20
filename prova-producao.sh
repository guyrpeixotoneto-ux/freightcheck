#!/usr/bin/env bash
# ===========================================================================
# RUNNER DA PROVA — SOMENTE LEITURA, SOMENTE PRODUCTION
# ===========================================================================
# Executa prova-qlp.sql contra Production com seis travas. Nenhuma escrita:
# nada é reprocessado, aprovado, excluído, corrigido ou migrado.
#
# Uso:  PRODUCTION_DATABASE_URL='postgres://…' ./prova-producao.sh
# ===========================================================================
set -Eeuo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${AQUI}/prova-qlp.sql"
TZ_ALVO="${TZ_ALVO:-America/Sao_Paulo}"   # Camaçari/BA = UTC-3
MINUTO_ALVO="${MINUTO_ALVO:-2026-08-19 06:44}"

erro() { printf '\n\033[1;31mRECUSADO:\033[0m %s\n\n' "$1" >&2; exit 1; }

# --- TRAVA 0 -------------------------------------------------------------
# Neutraliza o vetor exato do incidente: com a URL vazia, o libpq cai nos
# defaults (socket local, usuário do processo, base homônima) e conecta em
# OUTRO banco em silêncio. Sem estas variáveis não há default para onde cair.
unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGSERVICE PGSERVICEFILE || true

# --- TRAVA 1 — variável de Production ausente ou vazia --------------------
if [ -z "${PRODUCTION_DATABASE_URL+x}" ]; then
  erro "PRODUCTION_DATABASE_URL não está definida. Nada foi executado."
fi
if [ -z "${PRODUCTION_DATABASE_URL// /}" ]; then
  erro "PRODUCTION_DATABASE_URL está definida mas VAZIA — este é exatamente o
        caso que fez o psql conectar silenciosamente em outro banco. Nada foi executado."
fi

# --- TRAVA 2 — é uma URL de verdade, e é a de Production ------------------
case "$PRODUCTION_DATABASE_URL" in
  postgres://*|postgresql://*) : ;;
  *) erro "PRODUCTION_DATABASE_URL não começa com postgres:// nem postgresql://.
        Recusado antes de qualquer conexão." ;;
esac
if [ -n "${DATABASE_URL:-}" ] && [ "$PRODUCTION_DATABASE_URL" = "${DATABASE_URL}" ]; then
  erro "PRODUCTION_DATABASE_URL é IDÊNTICA a DATABASE_URL (Development).
        Uma das duas está configurada errado. Nada foi executado."
fi
[ -r "$SQL" ] || erro "prova-qlp.sql não encontrado em ${AQUI}."

# Daqui para baixo, a URL nunca é impressa nem ecoada.
PSQL=(psql --dbname="$PRODUCTION_DATABASE_URL"
           --no-psqlrc --quiet --no-password
           -v ON_ERROR_STOP=1)

# --- TRAVA 3 — a conexão abre? ------------------------------------------
if ! "${PSQL[@]}" -Atc 'SELECT 1' >/dev/null 2>&1; then
  erro "Não foi possível conectar com PRODUCTION_DATABASE_URL.
        (Mensagem omitida de propósito: ela costuma conter host e usuário.)"
fi

# --- TRAVA 4 — evidência não sensível de que isto é Production ------------
# Nada aqui revela host, usuário, senha ou base: o host aparece só como
# hash curto, que serve para COMPARAR com o de Development sem expor nenhum.
echo "=== [0] EVIDÊNCIA DE AMBIENTE (não sensível) ==="
"${PSQL[@]}" -X <<'EOSQL'
BEGIN READ ONLY;
SELECT
  current_database()                                    AS base,
  left(md5(coalesce(inet_server_addr()::text,'socket')), 8) AS host_hash,
  pg_is_in_recovery()                                   AS replica,
  date_trunc('second', pg_postmaster_start_time())      AS servidor_no_ar_desde,
  (SELECT count(*) FROM import_run)                     AS runs_totais,
  (SELECT count(*) FROM source_file)                    AS arquivos,
  (SELECT count(*) FROM snapshot)                       AS snapshots_totais,
  (SELECT min(started_at)::date FROM import_run)        AS primeiro_run,
  (SELECT max(started_at)::date FROM import_run)        AS ultimo_run;
COMMIT;
EOSQL

cat <<'AVISO'

  ^ CONFIRA ACIMA ANTES DE SEGUIR:
    - "base" é o nome do banco de Production?
    - "runs_totais"/"primeiro_run" batem com um ambiente em uso real?
      (Development tem poucos runs e histórico curto.)
    - "host_hash" difere do hash do host de Development?
AVISO

# --- TRAVA 5 — identificação inequívoca do run das 06:44 ------------------
echo ""
echo "=== [0b] CANDIDATOS AO RUN DAS ${MINUTO_ALVO} (${TZ_ALVO}) ==="
"${PSQL[@]}" -X -v tz="$TZ_ALVO" -v minuto="$MINUTO_ALVO" <<'EOSQL'
BEGIN READ ONLY;
SELECT ir.id AS import_run_id,
       ir.status,
       ir.declared_type,
       sf.filename,
       to_char(ir.started_at AT TIME ZONE :'tz', 'YYYY-MM-DD HH24:MI:SS') AS iniciado_local,
       to_char(ir.started_at, 'YYYY-MM-DD HH24:MI:SS TZ')                 AS iniciado_utc
  FROM import_run ir
  JOIN source_file sf ON sf.id = ir.source_file_id
 WHERE (sf.filename ILIKE '%QLP%ADM%' OR ir.declared_type LIKE 'QLP%')
 ORDER BY ir.started_at DESC;
COMMIT;
EOSQL

N=$("${PSQL[@]}" -X -Atc "
  SELECT count(*) FROM import_run ir
    JOIN source_file sf ON sf.id = ir.source_file_id
   WHERE (sf.filename ILIKE '%QLP%ADM%' OR ir.declared_type LIKE 'QLP%')
     AND to_char(ir.started_at AT TIME ZONE '${TZ_ALVO}','YYYY-MM-DD HH24:MI')
         = '${MINUTO_ALVO}'")

echo ""
if [ "$N" -eq 0 ]; then
  erro "Nenhum run de QLP às ${MINUTO_ALVO} (${TZ_ALVO}). Veja os candidatos acima
        e reexecute com MINUTO_ALVO='YYYY-MM-DD HH:MM' — ou TZ_ALVO, se o fuso
        for outro. Recusado para não concluir usando um run parecido."
fi
if [ "$N" -gt 1 ]; then
  erro "${N} runs de QLP às ${MINUTO_ALVO} (${TZ_ALVO}) — ambíguo.
        Recusado para não concluir usando o run errado."
fi
echo "OK: exatamente 1 run identificado às ${MINUTO_ALVO} (${TZ_ALVO})."

# --- A PROVA -------------------------------------------------------------
# prova-qlp.sql já abre BEGIN READ ONLY; ON_ERROR_STOP=1 vem do array PSQL.
echo ""
echo "=== EXECUTANDO prova-qlp.sql (consultas 1–8, somente leitura) ==="
"${PSQL[@]}" -X -f "$SQL"

echo ""
echo "=== FIM. Nenhuma escrita foi executada. ==="
