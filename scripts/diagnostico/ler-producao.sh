#!/usr/bin/env bash
# ===========================================================================
# LEITURA DE PRODUÇÃO — SOMENTE LEITURA, SOMENTE PRODUCTION
# ===========================================================================
# Executa um .sql de diagnóstico contra Production. Nenhuma escrita: não migra,
# não apaga, não reindexa, não instala extensão, não roda VACUUM.
#
# As travas são as de `prova-producao.sh`, e pelo mesmo motivo: com a variável
# vazia o libpq cai nos defaults e conecta EM OUTRO BANCO em silêncio.
#
# Uso:  PRODUCTION_DATABASE_URL='postgres://…' \
#         ./scripts/diagnostico/ler-producao.sh scripts/diagnostico/crescimento.sql
# ===========================================================================
set -Eeuo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL="${1:-${AQUI}/tamanho-do-banco.sql}"

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
[ -r "$SQL" ] || erro "arquivo SQL não encontrado ou ilegível: ${SQL}"

# --- TRAVA 3 — o arquivo é mesmo somente-leitura -------------------------
# A trava que as outras não dão: confere o CONTEÚDO antes de mandar para o
# banco. Pega o caso em que alguém edita um destes .sql — ou aponta este runner
# para um arquivo qualquer — e um comando de escrita entra junto.
#
# Duas coisas saem antes da conferência:
#
#   - os comentários, porque metade destes arquivos EXPLICA por que não faz
#     DELETE, e casar a palavra dentro da explicação recusaria o arquivo por
#     dizer a verdade sobre si mesmo;
#   - as linhas `\echo`, que são rótulo de saída e não SQL. Sem isso, o título
#     "IDENTIDADE DO SERVIDOR" era recusado pelo "DO" do português.
#
# E a busca é por PALAVRA INTEIRA (`\b`): sem isso, `min(deleted_at)` casava
# com DELETE, e `last_vacuum` com VACUUM. Os dois foram observados aqui, não
# imaginados.
#
# `DO` só conta na forma que de fato executa código — `DO $$ … $$` —, nunca
# como palavra solta.
SEM_COMENTARIO="$(sed -e 's/--.*$//' -e '/^[[:space:]]*\\echo/d' "$SQL" | tr '\n' ' ')"
PROIBIDOS='INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|REINDEX|VACUUM|CLUSTER|REFRESH|COPY|CALL|LOCK|SELECT[[:space:]]+INTO'
if printf '%s' "$SEM_COMENTARIO" | grep -qiE "\\b(${PROIBIDOS})\\b" \
   || printf '%s' "$SEM_COMENTARIO" | grep -qiE '\bDO\b[[:space:]]*\$\$'; then
  erro "o arquivo ${SQL} contém um comando de escrita fora de comentário.
        Recusado antes de qualquer conexão. Confira com:
          sed -e 's/--.*\$//' -e '/^[[:space:]]*\\\\echo/d' '${SQL}' | grep -inwE '${PROIBIDOS}'"
fi

# Daqui para baixo a URL nunca é impressa nem ecoada.

# --- TRAVA 4 — a conexão abre? -------------------------------------------
if ! psql --dbname="$PRODUCTION_DATABASE_URL" -X --quiet --no-password \
     -Atc 'SELECT 1' >/dev/null 2>&1; then
  erro "Não foi possível conectar com PRODUCTION_DATABASE_URL.
        (Mensagem omitida de propósito: ela costuma conter host e usuário.)"
fi

# --- A LEITURA ------------------------------------------------------------
# `default_transaction_read_only = on` vale para a SESSÃO inteira e é a trava
# que não depende do arquivo: uma escrita que escapasse é recusada pelo servidor.
# O `-c` roda antes do `-f`, na mesma sessão.
#
# Sem `ON_ERROR_STOP`, de propósito: em banco gerenciado algumas visões de
# catálogo são negadas por permissão (`pg_ls_waldir()` é a certa) e a extensão
# `pgstattuple` pode não estar instalada. Parar no primeiro erro devolveria um
# diagnóstico pela metade; cada seção tem transação própria, então a recusa de
# uma não contamina as outras.
echo "→ lendo ${SQL}"
psql --dbname="$PRODUCTION_DATABASE_URL" -X --quiet --no-password \
     -c 'SET default_transaction_read_only = on' \
     -f "$SQL"
