#!/usr/bin/env bash
# Atalho histórico: este nome foi o executado em 15/09/2026 e fica registrado
# nos documentos daquela passada. A implementação é `reindexar.sh`, numa cópia
# só — as travas todas moram lá.
set -Eeuo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${AQUI}/reindexar.sh" "$@" --os-quatro
