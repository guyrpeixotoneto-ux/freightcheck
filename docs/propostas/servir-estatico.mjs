/**
 * O host estático do FreightCheck — com compressão e política de cache.
 *
 * PROPOSTA, ainda não aplicada. Existe porque o `serve = "static"` do Replit
 * entrega o bundle **sem compressão nenhuma**: medido em 18/09/2026, gzip, br
 * e zstd oferecidos e os três recusados, 3.866.331 bytes crus por abertura.
 *
 * Duas regras, e a diferença entre elas é o nome do arquivo:
 *
 *   - `/assets/*` sai do `vite build` com o hash do conteúdo no nome. Um nome
 *     desses nunca muda de conteúdo, então vale `immutable` e um ano de
 *     `max-age`: a revisita não emite requisição nenhuma, nem para revalidar.
 *   - `index.html` **não** é versionado, e é ele que aponta para o bundle novo
 *     depois de uma publicação. Ele leva `no-cache`, que não quer dizer "não
 *     guarde" e sim "revalide antes de usar". É o que impede a publicação nova
 *     de ficar presa atrás de uma cópia velha.
 *
 * Comprime em Brotli quando o cliente aceita, gzip como reserva, e nunca
 * comprime o que já vem comprimido (woff2, png). `vary: accept-encoding` sai
 * junto, senão um intermediário pode servir o corpo comprimido a quem pediu
 * texto puro.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const RAIZ = path.resolve(process.env.PUBLIC_DIR ?? "dist/public");
const PORTA = Number(process.env.PORT ?? 25609);

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".map": "application/json",
};
/* Comprimir woff2/png/webp é gastar CPU para crescer o corpo. */
const COMPRIMIVEL = new Set([".html", ".js", ".css", ".json", ".svg", ".map", ".txt"]);

/**
 * Comprimido uma vez e guardado.
 *
 * **A chave inclui `mtime` e tamanho, e isso não é zelo: sem eles, uma
 * publicação nova fica presa.** A primeira versão guardava só por caminho, e o
 * `index.html` — que é o único arquivo cujo nome não muda entre versões —
 * continuava sendo servido da memória do processo depois de reescrito. O teste
 * de publicação pegou: a tela seguia carregando o bundle antigo, e não era o
 * cache do navegador, era o meu.
 *
 * Com `mtime` na chave, reescrever o arquivo troca a chave e o corpo novo é
 * comprimido na hora. As entradas velhas não são um vazamento que importe: são
 * poucos arquivos, e o processo reinicia a cada publicação.
 */
const cache = new Map();
function corpo(arquivo, ext, codificacao, st) {
  const chave = `${arquivo}|${codificacao}|${st.mtimeMs}|${st.size}`;
  const guardado = cache.get(chave);
  if (guardado) return guardado;
  const cru = fs.readFileSync(arquivo);
  let saida = cru;
  if (codificacao === "br") saida = zlib.brotliCompressSync(cru, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: cru.length },
  });
  else if (codificacao === "gzip") saida = zlib.gzipSync(cru, { level: 6 });
  cache.set(chave, saida);
  return saida;
}

function escolherCodificacao(aceita, ext) {
  if (!COMPRIMIVEL.has(ext)) return null;
  const a = String(aceita ?? "");
  if (/\bbr\b/.test(a)) return "br";
  if (/\bgzip\b/.test(a)) return "gzip";
  return null;
}

const servidor = http.createServer((req, res) => {
  const caminho = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let arquivo = path.join(RAIZ, caminho);
  /* Fora da raiz é tentativa de travessia; e o que não existe cai no index,
     que é a reescrita que a SPA precisa (`from = "/*", to = "/index.html"`). */
  if (!arquivo.startsWith(RAIZ) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
    arquivo = path.join(RAIZ, "index.html");
  }

  const ext = path.extname(arquivo);
  const versionado = caminho.startsWith("/assets/") && ext !== ".html";
  const st = fs.statSync(arquivo);
  const etag = `"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`;

  const cabecalhos = {
    "content-type": TIPOS[ext] ?? "application/octet-stream",
    "cache-control": versionado ? "public, max-age=31536000, immutable" : "no-cache",
    "last-modified": st.mtime.toUTCString(),
    etag,
    vary: "accept-encoding",
  };

  if (req.headers["if-none-match"] === etag) { res.writeHead(304, cabecalhos); res.end(); return; }

  const codificacao = escolherCodificacao(req.headers["accept-encoding"], ext);
  const dados = corpo(arquivo, ext, codificacao, st);
  if (codificacao) cabecalhos["content-encoding"] = codificacao;
  cabecalhos["content-length"] = dados.length;

  res.writeHead(200, cabecalhos);
  res.end(req.method === "HEAD" ? undefined : dados);
});

servidor.listen(PORTA, "0.0.0.0", () => {
  console.log(`web estática em :${PORTA} · raiz ${RAIZ} · brotli+gzip · assets immutable`);
});
