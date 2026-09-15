#!/usr/bin/env bash
# ===========================================================================
# DIAGNÓSTICO DE COBERTURA DAS VIGÊNCIAS — SOMENTE LEITURA, SOMENTE PRODUCTION
# ===========================================================================
# Executa scripts/diagnostico/coberturas-da-vigencia.sql contra Production.
# Nenhuma escrita: não migra, não apaga, não corrige e não reimporta nada — só
# responde por que duas vigências de trecho da mesma unidade chegaram com
# coberturas diferentes.
#
# As travas são as mesmas de `prova-producao.sh`, e pelo mesmo motivo: com a
# variável vazia o libpq cai nos defaults e conecta EM OUTRO BANCO em silêncio.
#
# Uso:  PRODUCTION_DATABASE_URL='postgres://…' ./scripts/diagnostico/coberturas-da-vigencia.sh
# ===========================================================================
set -Eeuo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${AQUI}/coberturas-da-vigencia.sql"

erro() { printf '\n\033[1;31mRECUSADO:\033[0m %s\n\n' "$1" >&2; exit 1; }

# --- TRAVA 0 — sem defaults para onde cair -------------------------------
unset PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGSERVICE PGSERVICEFILE || true

# --- TRAVA 1 — variável ausente ou vazia ---------------------------------
if [ -z "${PRODUCTION_DATABASE_URL+x}" ]; then
  erro "PRODUCTION_DATABASE_URL não está definida. Nada foi executado."
fi
if [ -z "${PRODUCTION_DATABASE_URL// /}" ]; then
  erro "PRODUCTION_DATABASE_URL está definida mas VAZIA. Nada foi executado."
fi

# --- TRAVA 2 — é uma URL, e não é a de Development -----------------------
case "$PRODUCTION_DATABASE_URL" in
  postgres://*|postgresql://*) : ;;
  *) erro "PRODUCTION_DATABASE_URL não começa com postgres:// nem postgresql://." ;;
esac
if [ -n "${DATABASE_URL:-}" ] && [ "$PRODUCTION_DATABASE_URL" = "${DATABASE_URL}" ]; then
  erro "PRODUCTION_DATABASE_URL é IDÊNTICA a DATABASE_URL (Development)."
fi
[ -r "$SQL" ] || erro "coberturas-da-vigencia.sql não encontrado em ${AQUI}."

# Daqui para baixo a URL nunca é impressa nem ecoada.

# --- TRAVA 3 — a conexão abre? -------------------------------------------
if ! psql --dbname="$PRODUCTION_DATABASE_URL" -X --quiet --no-password \
     -Atc 'SELECT 1' >/dev/null 2>&1; then
  erro "Não foi possível conectar com PRODUCTION_DATABASE_URL.
        (Mensagem omitida de propósito: ela costuma conter host e usuário.)"
fi

# --- A LEITURA ------------------------------------------------------------
# `default_transaction_read_only = on` vale para a SESSÃO inteira e é a trava
# que não depende do arquivo: uma escrita que aparecesse no .sql por engano é
# recusada pelo servidor. O `-c` roda antes do `-f`, na mesma sessão.
#
# Sem `ON_ERROR_STOP`, de propósito: uma seção que esbarre em permissão ou numa
# coluna que a base ainda não tenha não pode levar o diagnóstico inteiro junto.
# Cada seção do .sql tem transação própria, então a recusa de uma não contamina
# as outras; o erro aparece no lugar dela, nomeado, e o resto continua.
psql --dbname="$PRODUCTION_DATABASE_URL" -X --quiet --no-password \
     -c 'SET default_transaction_read_only = on' \
     -f "$SQL"
