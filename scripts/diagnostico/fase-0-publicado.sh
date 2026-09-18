#!/usr/bin/env bash
# ===========================================================================
# FASE 0 — UMA MEDIÇÃO SÓ, CONTRA O AMBIENTE PUBLICADO
# ===========================================================================
# Roda as três medições da Fase 0 e escreve um relatório consolidado, pronto
# para colar de volta: data, URL, build publicado, amostras, percentis,
# vereditos, e a saída bruta de cada etapa num anexo auditável.
#
# ---------------------------------------------------------------------------
# SOMENTE LEITURA — o que este script pode e não pode fazer
# ---------------------------------------------------------------------------
# Só emite GET e HEAD. Não escreve no banco, não muda configuração, não publica,
# não migra, não limpa cache e não toca em dado. A única escrita acontece no
# diretório de saída, na máquina onde o script roda.
#
# O 503 do cenário H5 é injetado **dentro do navegador** (`page.route`), não no
# servidor: o deployment nunca recebe nada diferente do que um usuário mandaria.
#
# ---------------------------------------------------------------------------
# A CREDENCIAL
# ---------------------------------------------------------------------------
# O cookie NUNCA entra por argumento: em `argv` ele fica no histórico do shell e
# aparece em `ps aux` para qualquer processo da máquina. Ele vem de
# `FREIGHTCHECK_COOKIE` — e, se não estiver definida, este script o pede em
# entrada silenciosa (sem eco na tela).
#
# Nada imprime o valor. Antes de fechar o relatório, o conteúdo inteiro passa
# por uma redação que substitui qualquer ocorrência da credencial por
# `<REDIGIDO>` — cinto e suspensório, para o caso de uma biblioteca futura
# resolver ecoar um cabeçalho.
#
# ---------------------------------------------------------------------------
# USO
# ---------------------------------------------------------------------------
#   ./scripts/diagnostico/fase-0-publicado.sh https://<app>.replit.app
#
# Opcional, antes de rodar, para não precisar digitar quando ele pedir:
#   read -rs FREIGHTCHECK_COOKIE && export FREIGHTCHECK_COOKIE
#
# Variáveis reconhecidas:
#   FREIGHTCHECK_COOKIE   o valor de `freightcheck_session` (DevTools →
#                         Application → Cookies). Sem ela, o script ainda mede
#                         a parte pública e diz o que ficou de fora.
#   SAIDA                 diretório do relatório (padrão: ./fase-0-<carimbo>)
#   SEM_NAVEGADOR=1       pula a etapa 3 (útil onde não dá para instalar o
#                         playwright-core)
#   N                     amostras por endpoint na etapa 2 (padrão 40)
#   ESPERA_S              espera antes da revisita na etapa 3 (padrão 75)
#   ROTAS_API             endpoints da etapa 2 (só caminhos sob /api/)
#   ROTAS_TELA            telas da etapa 3
#
# As duas listas têm nomes separados de propósito: com um `ROTAS` só, exportar
# a lista de uma corrompia a entrada da outra em silêncio — as telas entravam
# na tabela de API respondendo o `index.html`. Cada script recusa a lista do
# outro em vez de medir a coisa errada.
# ===========================================================================
set -Eeuo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

erro()   { printf '\n\033[1;31mRECUSADO:\033[0m %s\n\n' "$1" >&2; exit 1; }
titulo() { printf '\n\033[1;36m%s\033[0m\n' "$1"; }
ok()     { printf '\033[1;32m  ✓ %s\033[0m\n' "$1"; }
aviso()  { printf '\033[1;33m  ▸ %s\033[0m\n' "$1"; }

# --- 0. Pré-requisitos ----------------------------------------------------
URL="${1:-}"
[ -n "$URL" ] || erro "Uso: $0 https://<app>.replit.app"
case "$URL" in
  https://*|http://*) ;;
  *) erro "A URL precisa começar com https:// (ou http:// em teste local)." ;;
esac
[ $# -le 1 ] || erro "Argumento a mais. O cookie NÃO entra por linha de comando — use FREIGHTCHECK_COOKIE."
URL="${URL%/}"

titulo "0. Pré-requisitos"
command -v curl >/dev/null || erro "curl não encontrado."
command -v node >/dev/null || erro "node não encontrado."
ok "curl $(curl --version | head -1 | cut -d' ' -f2) · node $(node --version)"

for f in entrega-estatica.sh pedagio-e-latencia.mjs medir-no-ar.mjs; do
  [ -r "$AQUI/$f" ] || erro "Falta $AQUI/$f — o repositório está incompleto."
done
ok "as três medições estão presentes"

# A origem responde? Sem isto, tudo o que vem depois mede o nada.
COD="$(curl -sS -o /dev/null -m 25 -w '%{http_code}' "$URL/api/healthz" || echo 000)"
[ "$COD" = "200" ] || erro "GET $URL/api/healthz respondeu $COD. Confira a URL e se o deployment está no ar."
ok "$URL/api/healthz responde 200"

# --- Credencial, em entrada silenciosa ------------------------------------
if [ -z "${FREIGHTCHECK_COOKIE:-}" ]; then
  if [ -t 0 ]; then
    printf '\n  Cole o cookie freightcheck_session (não aparece na tela, ENTER vazio para pular): '
    IFS= read -rs FREIGHTCHECK_COOKIE || true
    printf '\n'
    export FREIGHTCHECK_COOKIE
  fi
fi
COOKIE="${FREIGHTCHECK_COOKIE:-}"

AUTENTICADO=0
if [ -n "$COOKIE" ]; then
  CS="$(curl -sS -o /dev/null -m 25 -w '%{http_code}' -H "Cookie: freightcheck_session=$COOKIE" "$URL/api/contexts" || echo 000)"
  if [ "$CS" = "200" ]; then AUTENTICADO=1; ok "sessão válida (as etapas autenticadas vão rodar)"
  else aviso "a sessão foi recusada ($CS). Só a parte pública será medida."; COOKIE=""; fi
else
  aviso "sem cookie: só a parte pública será medida."
fi

# --- Saída ----------------------------------------------------------------
CARIMBO="$(date -u +%Y%m%d-%H%M%SZ)"
DIR="${SAIDA:-./fase-0-$CARIMBO}"
mkdir -p "$DIR/bruto" "$DIR/json"
REL="$DIR/RELATORIO.md"
ok "saída em $DIR"

# Redação: nada que contenha a credencial sai daqui.
redigir() {
  if [ -n "${FREIGHTCHECK_COOKIE:-}" ]; then
    sed -e "s|${FREIGHTCHECK_COOKIE//|/\\|}|<REDIGIDO>|g"
  else cat; fi
}
# Tira as cores ANSI dos anexos, para o markdown ficar legível.
limpar() { sed -e 's/\x1b\[[0-9;]*m//g'; }

# --- 1. Acesso público e entrega estática ---------------------------------
titulo "1/3  Acesso público e entrega estática"
FASE0_JSON="$DIR/json/estatica.json" "$AQUI/entrega-estatica.sh" "$URL" \
  > >(tee "$DIR/bruto/1-estatica.txt") 2>&1 || aviso "a etapa 1 terminou com erro; o bruto está salvo"
sleep 0.2

# --- 2. Pedágio, latência e tempos de API ---------------------------------
titulo "2/3  Pedágio de autenticação, latência e tempos de API"
if [ "$AUTENTICADO" = "1" ]; then
  N="${N:-40}" FASE0_JSON="$DIR/json/pedagio.json" \
    node "$AQUI/pedagio-e-latencia.mjs" "$URL" \
    > >(tee "$DIR/bruto/2-pedagio.txt") 2>&1 || aviso "a etapa 2 terminou com erro; o bruto está salvo"
else
  N="${N:-40}" FASE0_JSON="$DIR/json/pedagio.json" \
    node "$AQUI/pedagio-e-latencia.mjs" "$URL" \
    > >(tee "$DIR/bruto/2-pedagio.txt") 2>&1 || true
  aviso "sem sessão: o pedágio não pôde ser isolado"
fi
sleep 0.2

# --- 3. Abertura, navegação, revisita e estados ---------------------------
titulo "3/3  Abertura autenticada, navegação interna, revisita e estados"
if [ "${SEM_NAVEGADOR:-0}" = "1" ]; then
  aviso "SEM_NAVEGADOR=1 — etapa 3 pulada"
  echo "PULADA (SEM_NAVEGADOR=1)" > "$DIR/bruto/3-navegador.txt"
elif [ "$AUTENTICADO" != "1" ]; then
  aviso "sem sessão — etapa 3 pulada (ela precisa de sessão para navegar)"
  echo "PULADA (sem sessão)" > "$DIR/bruto/3-navegador.txt"
else
  if [ ! -d /tmp/pw/node_modules/playwright-core ]; then
    aviso "instalando playwright-core (uma vez, em /tmp, sem tocar o repositório)…"
    npm install playwright-core@1.50.1 --no-save --prefix /tmp/pw >/dev/null 2>&1 \
      || aviso "não deu para instalar o playwright-core; a etapa 3 vai ser pulada"
  fi
  if [ -d /tmp/pw/node_modules/playwright-core ]; then
    ESPERA_S="${ESPERA_S:-75}" FASE0_JSON="$DIR/json/navegador.json" \
      node "$AQUI/medir-no-ar.mjs" "$URL" \
      > >(tee "$DIR/bruto/3-navegador.txt") 2>&1 || aviso "a etapa 3 terminou com erro; o bruto está salvo"
  else
    echo "PULADA (playwright-core ausente)" > "$DIR/bruto/3-navegador.txt"
  fi
fi

# --- 4. Consolidação -------------------------------------------------------
titulo "Consolidando"
FASE0_URL="$URL" FASE0_DIR="$DIR" FASE0_AUTENTICADO="$AUTENTICADO" \
  node "$AQUI/fase-0-consolidar.mjs" > "$REL.tmp" 2>&1 || { cat "$REL.tmp"; erro "falha ao consolidar"; }

{
  cat "$REL.tmp"
  echo
  echo "---"
  echo
  echo "## Anexo — saída bruta"
  for etapa in "1-estatica:1. Entrega estática" "2-pedagio:2. Pedágio e latência" "3-navegador:3. Navegador"; do
    arq="${etapa%%:*}"; nome="${etapa#*:}"
    echo; echo "### $nome"; echo; echo '```'
    limpar < "$DIR/bruto/$arq.txt" 2>/dev/null || echo "(sem saída)"
    echo '```'
  done
} | redigir > "$REL"
rm -f "$REL.tmp"

# Os JSON também passam pela redação, por garantia.
for j in "$DIR"/json/*.json; do
  [ -e "$j" ] || continue
  redigir < "$j" > "$j.tmp" && mv "$j.tmp" "$j"
done

# Última conferência: a credencial não pode ter sobrado em lugar nenhum.
if [ -n "${FREIGHTCHECK_COOKIE:-}" ]; then
  if grep -rqF "$FREIGHTCHECK_COOKIE" "$DIR" 2>/dev/null; then
    erro "A credencial apareceu na saída e a redação falhou. NÃO envie $DIR."
  fi
  ok "conferido: a credencial não aparece em nenhum arquivo da saída"
fi

titulo "Pronto"
echo "  Relatório:  $REL"
echo "  Bruto:      $DIR/bruto/"
echo "  JSON:       $DIR/json/"
echo
echo "  Envie o RELATORIO.md inteiro — ele já vem redigido e é auditável."
