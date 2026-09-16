#!/usr/bin/env bash
# Atalho histórico: `ler-producao.sh` é o runner, e este nome continua valendo
# porque foi o publicado no PR #556. Todas as travas estão lá, numa cópia só.
set -Eeuo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${AQUI}/ler-producao.sh" "${AQUI}/tamanho-do-banco.sql"
