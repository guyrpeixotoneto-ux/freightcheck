#!/usr/bin/env bash
# ===========================================================================
# ENTREGA ESTÁTICA — o que o host publicado manda pela rede
# ===========================================================================
# Responde, com cabeçalhos de verdade, a pergunta que a auditoria de 18/09/2026
# deixou aberta em §5.1 e §8: **o host estático do Replit comprime o bundle?**
#
# A diferença medida entre comprimir e não comprimir, no mesmo bundle:
#
#     4G   tela utilizável 1.896 ms  →  4.603 ms   (+2,7 s)
#     3G   tela utilizável 7.727 ms  → 22.820 ms   (+15,1 s)
#
# É a maior alavanca de primeira abertura do produto e ela não é código: é
# configuração do host. Por isso esta conferência vem antes de qualquer
# correção.
#
# SOMENTE LEITURA: só faz GET e HEAD. Não escreve, não publica, não muda nada.
#
# Uso:  ./scripts/diagnostico/entrega-estatica.sh https://<app>.replit.app
# ===========================================================================
set -Eeuo pipefail

URL="${1:-}"
[ -n "$URL" ] || { printf '\n\033[1;31mUso:\033[0m %s https://<app>.replit.app\n\n' "$0" >&2; exit 1; }
URL="${URL%/}"

azul()  { printf '\n\033[1;36m%s\033[0m\n' "$1"; }
alerta(){ printf '\033[1;33m  ▸ %s\033[0m\n' "$1"; }
bom()   { printf '\033[1;32m  ▸ %s\033[0m\n' "$1"; }

# --- 1. Descobrir os assets que o index.html referencia --------------------
azul "1. index.html"
INDEX="$(curl -sS --compressed "$URL/" || true)"
[ -n "$INDEX" ] || { echo "  Não respondeu. Confira a URL." >&2; exit 1; }

ASSETS="$(printf '%s' "$INDEX" \
  | grep -oE '(src|href)="[^"]*/assets/[^"]+\.(js|css)"' \
  | sed -E 's/.*"(.*)"/\1/' | sort -u)"

if [ -z "$ASSETS" ]; then
  alerta "Nenhum /assets/*.js|css referenciado no index.html — o app pode estar servindo outra coisa."
  printf '%s' "$INDEX" | head -c 400; echo
fi

# --- 2. Cabeçalhos, tamanho na rede e tamanho descompactado ---------------
# `--compressed` faz o curl anunciar gzip/br e descompactar; `size_download` é
# o que chegou **depois** de descompactar, então o tamanho na rede sai de uma
# segunda passada que não descompacta nada.
medir_um() {
  local caminho="$1" rotulo="$2"
  local alvo="$URL$caminho"

  local cab; cab="$(curl -sSI --compressed "$alvo" || true)"
  local enc;  enc="$(printf  '%s' "$cab" | grep -i '^content-encoding:'  | tr -d '\r' | cut -d' ' -f2- || true)"
  local cc;   cc="$(printf   '%s' "$cab" | grep -i '^cache-control:'     | tr -d '\r' | cut -d' ' -f2- || true)"
  local etag; etag="$(printf '%s' "$cab" | grep -i '^etag:'              | tr -d '\r' | cut -d' ' -f2- || true)"
  local lm;   lm="$(printf   '%s' "$cab" | grep -i '^last-modified:'     | tr -d '\r' | cut -d' ' -f2- || true)"
  local vary; vary="$(printf '%s' "$cab" | grep -i '^vary:'              | tr -d '\r' | cut -d' ' -f2- || true)"
  local tipo; tipo="$(printf '%s' "$cab" | grep -i '^content-type:'      | tr -d '\r' | cut -d' ' -f2- || true)"

  # Bruto: sem anunciar compressão nenhuma.
  local bruto; bruto="$(curl -sS -o /dev/null -H 'accept-encoding: identity' -w '%{size_download}' "$alvo" || echo 0)"
  # Rede: anunciando gzip e br, sem descompactar (sem --compressed o curl não
  # descompacta, e o corpo que ele conta é o que trafegou).
  local rede;  rede="$(curl -sS -o /dev/null -H 'accept-encoding: gzip, br, zstd' -w '%{size_download}' "$alvo" || echo 0)"
  # E qual codificação o servidor escolheu quando os três foram oferecidos.
  local escolhida; escolhida="$(curl -sSI -H 'accept-encoding: gzip, br, zstd' "$alvo" \
                    | grep -i '^content-encoding:' | tr -d '\r' | cut -d' ' -f2- || true)"

  printf '\n  %s\n' "$rotulo"
  printf '    caminho         %s\n' "$caminho"
  printf '    content-type    %s\n' "${tipo:-—}"
  printf '    content-encoding %s\n' "${escolhida:-<NENHUMA>}"
  printf '    cache-control   %s\n' "${cc:-<AUSENTE>}"
  printf '    etag            %s\n' "${etag:-<AUSENTE>}"
  printf '    last-modified   %s\n' "${lm:-<AUSENTE>}"
  printf '    vary            %s\n' "${vary:-<AUSENTE>}"
  printf '    bruto           %s bytes\n' "$bruto"
  printf '    na rede         %s bytes\n' "$rede"
  if [ "$bruto" -gt 0 ] && [ "$rede" -gt 0 ]; then
    printf '    fator           %sx\n' "$(awk -v a="$bruto" -v b="$rede" 'BEGIN{printf "%.1f", a/b}')"
  fi

  if [ -z "$escolhida" ]; then
    alerta "SEM COMPRESSÃO. É o cenário caro: +2,7 s em 4G, +15,1 s em 3G (§5.1 da auditoria)."
  else
    bom "Comprimido com '$escolhida'."
  fi

  # Revisita: o navegador manda o validador de volta. 304 é cache útil.
  if [ -n "$etag" ]; then
    local st; st="$(curl -sS -o /dev/null -H "if-none-match: $etag" -w '%{http_code}' "$alvo" || echo 000)"
    if [ "$st" = "304" ]; then bom "Revisita: 304 com if-none-match — o navegador não rebaixa este arquivo."
    else alerta "Revisita: $st com if-none-match — o arquivo é rebaixado inteiro a cada abertura."; fi
  else
    alerta "Sem ETag: a revisita não tem validador para usar."
  fi
}

azul "2. Assets"
if [ -n "$ASSETS" ]; then
  while IFS= read -r a; do
    case "$a" in *.js) r="JavaScript";; *.css) r="CSS";; *) r="asset";; esac
    medir_um "$a" "$r"
  done <<< "$ASSETS"
fi
medir_um "/" "index.html"

# --- 3. O que o navegador de verdade negocia ------------------------------
azul "3. Negociação, do jeito que um Chrome pede"
for ae in "gzip, deflate, br, zstd" "gzip" "br" "identity"; do
  esc="$(curl -sSI -H "accept-encoding: $ae" "$URL/" | grep -i '^content-encoding:' | tr -d '\r' | cut -d' ' -f2- || true)"
  printf '    accept-encoding: %-26s → %s\n' "$ae" "${esc:-<nenhuma>}"
done

azul "Pronto."
echo "  Cole esta saída na Fase 0. A linha que decide o plano é o content-encoding do JavaScript."
