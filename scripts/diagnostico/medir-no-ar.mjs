#!/usr/bin/env node
/**
 * MEDIR NO AR — as cinco hipóteses da auditoria, conferidas contra o
 * deployment publicado, num navegador de verdade.
 *
 * A auditoria de 18/09/2026 mediu tudo contra um FreightCheck local. Este
 * script repete as medições que **podem** divergir no ar, e só elas:
 *
 *   H1  a casca de seis chamadas sai em toda rota
 *   H2  três consultas de pedágio em toda requisição   (via §2 — veja abaixo)
 *   H3  a revisita a uma tela refaz tudo (staleTime ausente)
 *   H4  o bundle inicial é um chunk só
 *   H5  um endpoint com defeito segura a tela em esqueleto, calada
 *
 * H2 não é observável daqui — é contagem de SQL. Quem a confere no ar é
 * `pedagio-e-latencia.mjs`, que isola o pedágio pela diferença entre
 * `/api/build` com e sem cookie. Este script mede o resto.
 *
 * H5 é medido **sem tocar no servidor**: a política de repetição é do cliente,
 * então a resposta é interceptada dentro do navegador (`page.route`) e trocada
 * por um 503. O deployment não recebe nada de diferente, e o que se mede é o
 * que a tela faz — quanto tempo ela fica sem dizer nada.
 *
 * SOMENTE LEITURA: navega e observa. Não clica em nada que escreva.
 *
 * A credencial nunca entra pela linha de comando: um cookie em `argv` fica no
 * histórico do shell e aparece em `ps aux`. Este script lê só de
 * `FREIGHTCHECK_COOKIE`, recusa um terceiro argumento, e nunca imprime o valor.
 *
 * Antes:
 *   npm install playwright-core@1.50.1 --no-save --prefix /tmp/pw
 *
 * Uso:
 *   read -rs FREIGHTCHECK_COOKIE && export FREIGHTCHECK_COOKIE
 *   node scripts/diagnostico/medir-no-ar.mjs https://<app>.replit.app
 *
 * O cookie é o valor de `freightcheck_session` de uma sessão aberta
 * (DevTools → Application → Cookies).
 *
 * Com `FASE0_JSON=<arquivo>` grava também um resumo em JSON, sem a credencial.
 */

import { chromium } from "/tmp/pw/node_modules/playwright-core/index.mjs";
import fsSync from "node:fs";

const [, , BASE_BRUTA, EXCEDENTE] = process.argv;
const COOKIE = (() => {
  if (process.env.FREIGHTCHECK_COOKIE) return process.env.FREIGHTCHECK_COOKIE.trim();
  const arq = process.env.FREIGHTCHECK_COOKIE_FILE;
  if (arq) { try { return fsSync.readFileSync(arq, "utf8").trim(); } catch { /* segue sem */ } }
  return "";
})();
if (!BASE_BRUTA || !COOKIE) {
  console.error("\nUso: node scripts/diagnostico/medir-no-ar.mjs https://<app>.replit.app");
  console.error("O cookie vem de FREIGHTCHECK_COOKIE:\n");
  console.error("  read -rs FREIGHTCHECK_COOKIE && export FREIGHTCHECK_COOKIE\n");
  process.exit(1);
}
if (EXCEDENTE !== undefined) {
  console.error("\nEste script NÃO aceita o cookie por argumento: ele ficaria no histórico do");
  console.error("shell e visível em `ps aux`. Exporte FREIGHTCHECK_COOKIE e rode de novo.\n");
  process.exit(2);
}
const JSON_SAIDA = process.env.FASE0_JSON || null;
const relatorio = { alvo: null, em: new Date().toISOString(), bundle: null, rotas: [],
                    duplicadas: [], h1: null, h3: null, h5: null, errosDeConsole: [] };
const BASE = BASE_BRUTA.replace(/\/+$/, "");
const DOMINIO = new URL(BASE).hostname;
const EXECUTAVEL = process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/**
 * Uma amostra pequena e representativa das 65 rotas — as mais lentas do §4.1 e
 * algumas baratas, para o contraste.
 *
 * `ROTAS_TELA`, e não `ROTAS`: `pedagio-e-latencia.mjs` lê a sua própria lista,
 * de endpoints. Ver a nota lá sobre o que a colisão produziu.
 */
const ROTAS = (process.env.ROTAS_TELA ?? [
  "/panorama", "/dre", "/curadoria", "/linha-do-tempo", "/resumo-executivo",
  "/dashboard", "/composicao", "/alteracoes", "/vigencia", "/custo-fixo-finame",
].join(",")).split(",").filter(Boolean);

if (ROTAS.some((r) => r.startsWith("/api/"))) {
  console.error("\nROTAS_TELA é lista de telas, não de endpoints. Recebido /api/… — use ROTAS_API no outro script.\n");
  process.exit(3);
}

const PARTIDA = "/visao-gerencial";
const LIMITE = 45_000;
/** Quanto esperar antes da revisita. Maior que o maior staleTime do app (60 s). */
const ESPERA_S = Number(process.env.ESPERA_S ?? 75);

const navegador = await chromium.launch({ executablePath: EXECUTAVEL, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await navegador.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addCookies([{ name: "freightcheck_session", value: COOKIE, domain: DOMINIO, path: "/" }]);
const page = await ctx.newPage();

let chamadas = [];
const erros = [];
page.on("request", (r) => r.url().includes("/api/") && chamadas.push({ t: Date.now(), u: r.url().replace(BASE, ""), f: "saiu" }));
page.on("response", (r) => r.url().includes("/api/") && chamadas.push({ t: Date.now(), u: r.url().replace(BASE, ""), f: "voltou", s: r.status() }));
page.on("pageerror", (e) => erros.push(String(e).slice(0, 120)));

const sonda = () => page.evaluate(() => {
  const m = document.querySelector("main") ?? document.body;
  const t = (m.innerText ?? "").trim();
  return {
    esqueletos: document.querySelectorAll('.animate-pulse, [data-slot="skeleton"]').length,
    chars: t.length,
    carregando: /Carregando|Calculando|Buscando/i.test(t),
    erro: /não foi possível|indisponível|Tentar de novo|não completou/i.test(t),
    titulo: (document.querySelector("main h1") ?? document.querySelector("h1"))?.innerText?.trim() ?? "",
  };
}).catch(() => null);

async function esperarUtil(t0) {
  let primeiro = null;
  while (Date.now() - t0 < LIMITE) {
    const s = await sonda();
    if (!s) break;
    if (primeiro === null && s.chars > 200) primeiro = Date.now() - t0;
    if (s.esqueletos === 0 && !s.carregando && s.chars > 200) return { util: Date.now() - t0, primeiro };
    await page.waitForTimeout(80);
  }
  return { util: null, primeiro };
}

async function irPara(rota) {
  const antes = (await sonda())?.titulo ?? "";
  chamadas = [];
  const t0 = Date.now();
  await page.evaluate((r) => { window.history.pushState({}, "", r); window.dispatchEvent(new PopStateEvent("popstate")); }, rota);
  let casca = null;
  while (Date.now() - t0 < LIMITE) {
    const s = await sonda();
    if (s && s.titulo !== antes) { casca = Date.now() - t0; break; }
    await page.waitForTimeout(30);
  }
  const { util } = await esperarUtil(t0);
  await page.waitForTimeout(1200);
  const api = chamadas.filter((c) => c.f === "saiu");
  return { casca, util, chamadas: api.map((c) => c.u) };
}

relatorio.alvo = BASE;
console.log(`\nAlvo: ${BASE}   ·   ${new Date().toISOString()}`);

// --- H4: o bundle ----------------------------------------------------------
console.log("\n\x1b[1;36mH4 — o bundle inicial\x1b[0m\n");
const t0 = Date.now();
await page.goto(`${BASE}${PARTIDA}`, { waitUntil: "commit" });
const abertura = await esperarUtil(t0);
const bundle = await page.evaluate(() => {
  const js = performance.getEntriesByType("resource").filter((r) => r.name.endsWith(".js"));
  const nav = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
  return {
    arquivos: js.length,
    rede: js.reduce((s, r) => s + (r.transferSize || 0), 0),
    bruto: js.reduce((s, r) => s + (r.decodedBodySize || 0), 0),
    maior: Math.max(0, ...js.map((r) => r.decodedBodySize || 0)),
    fcp: fcp ? Math.round(fcp.startTime) : null,
    dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
  };
});
const kb = (n) => Math.round(n / 1024) + " KB";
console.log(`  arquivos .js            ${bundle.arquivos}`);
console.log(`  na rede / bruto         ${kb(bundle.rede)} / ${kb(bundle.bruto)}   (fator ${(bundle.bruto / Math.max(1, bundle.rede)).toFixed(1)}x)`);
console.log(`  maior chunk             ${kb(bundle.maior)}`);
console.log(`  FCP / DCL               ${bundle.fcp} ms / ${bundle.dcl} ms`);
console.log(`  primeira abertura útil  ${abertura.util ?? "não estabilizou"} ms`);
relatorio.bundle = { ...bundle, aberturaUtilMs: abertura.util };
console.log(bundle.arquivos <= 2
  ? "  \x1b[1;33m  ▸ CONFIRMADO: chunk único. R2 vale no ar.\x1b[0m"
  : `  \x1b[1;32m  ▸ Há ${bundle.arquivos} arquivos — o bundle já está dividido.\x1b[0m`);
console.log(bundle.rede >= bundle.bruto * 0.9
  ? "  \x1b[1;31m  ▸ O JavaScript chegou SEM COMPRESSÃO.\x1b[0m"
  : "  \x1b[1;32m  ▸ O JavaScript chegou comprimido.\x1b[0m");

// --- H1 e H3: casca e revisita --------------------------------------------
console.log("\n\x1b[1;36mH1 e H3 — a casca de toda rota, e o custo da revisita\x1b[0m\n");
const CASCA = ["/api/auth/session", "/api/contexts", "/api/change-sets", "/api/imports", "/api/curation/summary", "/api/build"];
const primeira = new Map(), revisita = new Map();

for (const rota of ROTAS) {
  if ((await page.evaluate(() => location.pathname)) !== PARTIDA) await irPara(PARTIDA);
  primeira.set(rota, await irPara(rota));
}
/*
  A espera não é enfeite: a revisita só responde à pergunta de H3 depois de o
  staleTime das consultas que o declaram ter vencido. Na auditoria local ela
  vinha de graça, porque a segunda passada percorria as outras 64 rotas antes
  de voltar. Com uma amostra curta é preciso esperar de propósito.
*/
process.stdout.write(`\n  esperando ${ESPERA_S}s para a revisita (o maior staleTime declarado é 60 s)…`);
await page.waitForTimeout(ESPERA_S * 1000);
process.stdout.write(" pronto\n\n");
for (const rota of ROTAS) {
  if ((await page.evaluate(() => location.pathname)) !== PARTIDA) await irPara(PARTIDA);
  revisita.set(rota, await irPara(rota));
}

console.log("  | Rota | Casca | 1ª visita | Req | Revisita | Req | Δ |");
console.log("  |---|--:|--:|--:|--:|--:|--:|");
let refazem = 0;
for (const rota of ROTAS) {
  const a = primeira.get(rota), b = revisita.get(rota);
  const d = a.util !== null && b.util !== null ? `${Math.round(((b.util - a.util) / a.util) * 100)}%` : "—";
  if (b.chamadas.length > 0) refazem++;
  console.log(`  | ${rota} | ${a.casca ?? "—"} | ${a.util ?? "∞"} | ${a.chamadas.length} | ${b.util ?? "∞"} | ${b.chamadas.length} | ${d} |`);
  relatorio.rotas.push({ rota, cascaMs: a.casca, primeiraUtilMs: a.util, primeiraReq: a.chamadas.length,
                         revisitaUtilMs: b.util, revisitaReq: b.chamadas.length, deltaPct: d,
                         chamadasPrimeira: a.chamadas.map((u) => u.split("?")[0]) });
}
relatorio.h3 = { refazem, total: ROTAS.length, esperaSegundos: ESPERA_S,
                 veredito: refazem > ROTAS.length / 2 ? "CONFIRMADO" : "NAO_CONFIRMADO" };
console.log(refazem > ROTAS.length / 2
  ? `\n  \x1b[1;33m  ▸ H3 CONFIRMADO: ${refazem} de ${ROTAS.length} rotas refazem chamadas na revisita, ${ESPERA_S}s depois.\x1b[0m`
  : `\n  \x1b[1;32m  ▸ H3 não se confirmou: só ${refazem} de ${ROTAS.length} refazem, ${ESPERA_S}s depois.\x1b[0m`);
console.log(`     (a casca declara staleTime de 30–60 s; com espera menor que isso o veredito sai falso-negativo)`);

// --- H1: a casca é da RECARGA, não da navegação interna --------------------
/*
  Medir a casca na navegação interna dá falso-negativo, e a razão é o desenho:
  o `Layout` nunca desmonta, e as cinco leituras da casca declaram staleTime de
  30–60 s. Dentro da mesma aba elas não devem mesmo sair de novo — e não saem.
  A afirmação do §3.1 da auditoria é sobre a **abertura** de cada rota, que é
  onde o piso de ~400 ms é pago. É isso que se confere aqui.
*/
console.log("\n\x1b[1;36mH1 — a casca em cada abertura direta (F5)\x1b[0m\n");
console.log("  | Rota | Chamadas da casca | Próprias | Utilizável |");
console.log("  |---|--:|--:|--:|");
let cascaEmTodas = true;
for (const rota of ROTAS) {
  chamadas = [];
  const t = Date.now();
  await page.goto(`${BASE}${rota}`, { waitUntil: "commit" });
  const { util } = await esperarUtil(t);
  await page.waitForTimeout(800);
  const saiu = chamadas.filter((c) => c.f === "saiu").map((c) => c.u);
  const daCasca = saiu.filter((u) => CASCA.some((c) => u.startsWith(c)));
  const proprias = saiu.filter((u) => !CASCA.some((c) => u.startsWith(c)));
  if (daCasca.length < 4) cascaEmTodas = false;
  console.log(`  | ${rota} | ${daCasca.length} | ${proprias.length} | ${util ?? "∞"} ms |`);
  const linhaDaRota = relatorio.rotas.find((x) => x.rota === rota);
  if (linhaDaRota) Object.assign(linhaDaRota, { aberturaCasca: daCasca.length, aberturaProprias: proprias.length, aberturaUtilMs: util });
}
relatorio.h1 = { veredito: cascaEmTodas ? "CONFIRMADO" : "NAO_CONFIRMADO" };
console.log(cascaEmTodas
  ? "\n  \x1b[1;33m  ▸ H1 CONFIRMADO: toda abertura paga a casca inteira.\x1b[0m"
  : "\n  \x1b[1;32m  ▸ H1 não se confirmou no ar.\x1b[0m");

// --- Duplicatas ------------------------------------------------------------
console.log("\n\x1b[1;36mChamadas repetidas na mesma tela\x1b[0m\n");
let houve = false;
for (const rota of ROTAS) {
  const c = new Map();
  for (const u of primeira.get(rota).chamadas) c.set(u, (c.get(u) ?? 0) + 1);
  for (const [u, n] of c) if (n > 1) { console.log(`  ${rota.padEnd(22)} ${u.split("?")[0]} ×${n}`); houve = true; relatorio.duplicadas.push({ rota, url: u.split("?")[0], vezes: n }); }
}
if (!houve) console.log("  nenhuma");

// --- H5: o silêncio durante a repetição ------------------------------------
console.log("\n\x1b[1;36mH5 — quanto tempo a tela fica calada quando uma chamada não volta\x1b[0m\n");
console.log("  (a resposta é trocada por 503 dentro do navegador; o deployment não é tocado)");
await page.route("**/api/dre/fleet*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"sonda da Fase 0"}' }));
await irPara(PARTIDA);
const tD = Date.now();
await page.evaluate(() => { window.history.pushState({}, "", "/dre"); window.dispatchEvent(new PopStateEvent("popstate")); });
let apareceu = null, esqueletoEm = null;
while (Date.now() - tD < 40_000) {
  const s = await sonda();
  if (s) {
    if (esqueletoEm === null && s.esqueletos > 0) esqueletoEm = Date.now() - tD;
    if (s.erro) { apareceu = Date.now() - tD; break; }
  }
  await page.waitForTimeout(150);
}
await page.unroute("**/api/dre/fleet*");
console.log(`  esqueleto aparece em          ${esqueletoEm ?? "—"} ms`);
console.log(`  a tela diz que houve erro em  ${apareceu ?? "não disse em 40 s"} ms`);
relatorio.h5 = { esqueletoEmMs: esqueletoEm, erroVisivelEmMs: apareceu,
                 veredito: apareceu === null || apareceu > 5000 ? "CONFIRMADO" : "NAO_CONFIRMADO" };
console.log(apareceu === null || apareceu > 5000
  ? "  \x1b[1;33m  ▸ H5 CONFIRMADO: a tela fica calada por mais de 5 s.\x1b[0m"
  : "  \x1b[1;32m  ▸ H5 não se confirmou no ar.\x1b[0m");

if (erros.length) console.log(`\n\x1b[1;36mErros de console\x1b[0m\n  ${[...new Set(erros)].slice(0, 6).join("\n  ")}`);

relatorio.errosDeConsole = [...new Set(erros)].slice(0, 10);
await navegador.close();
if (JSON_SAIDA) fsSync.writeFileSync(JSON_SAIDA, JSON.stringify(relatorio, null, 2));
console.log("");
