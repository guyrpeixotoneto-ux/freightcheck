#!/usr/bin/env node
/**
 * PEDÁGIO E LATÊNCIA — quanto custam, no ar, as três consultas que toda
 * requisição paga antes de a rota começar.
 *
 * ---------------------------------------------------------------------------
 * A ideia, e por que ela dispensa credencial de banco
 * ---------------------------------------------------------------------------
 * A auditoria de 18/09/2026 (§6.3) mediu que toda requisição autenticada paga
 * três consultas antes da rota: `requireSession` lê `user_session ⋈ app_user`,
 * e `escopoEmObservacao` lê `acesso_a_unidade` e `remuneracao_unidade`. Em
 * localhost isso custa 0,1 ms e some no ruído. Contra um Neon distante custa
 * `3 × RTT` por requisição — e uma tela com catorze chamadas paga isso catorze
 * vezes.
 *
 * Medir isso **de dentro** do Replit exigiria shell no deployment. Não exige,
 * por causa de um acidente feliz do desenho do servidor, conferido no log do
 * Postgres em 18/09/2026:
 *
 *     GET /api/healthz            → 0 consultas   (rota pública, sem banco)
 *     GET /api/build  sem cookie  → 0 consultas   (sem sessão, os dois
 *                                                  middlewares saem cedo)
 *     GET /api/build  com cookie  → 3 consultas   (exatamente o pedágio)
 *
 * `/api/build` não lê dado de produto: devolve cinco campos de `process`. Então
 * a diferença entre as duas últimas linhas **é o pedágio, e só ele** — já
 * incluindo o RTT da API até o banco, que é justamente o número que não dá
 * para obter de fora de outro jeito.
 *
 *     pedágio  ≈  p50(build com cookie)  −  p50(build sem cookie)
 *     RTT      ≈  pedágio / 3
 *
 * E `healthz` dá a linha de base do que não é aplicação nenhuma: rede até o
 * Replit, roteador, e o Node aceitando a conexão.
 *
 * ---------------------------------------------------------------------------
 * O que este script NÃO mede, e por quê
 * ---------------------------------------------------------------------------
 * Aquisição de conexão do pool, execução SQL e serialização **separadas** não
 * são observáveis de fora: são três etapas dentro de um mesmo processo, sem
 * instrumentação publicada. O que sai daqui é a soma delas por requisição, que
 * é o que decide a prioridade. Separá-las pede `pg_stat_statements` no Neon ou
 * um `server-timing` no servidor — e as duas coisas são mudança, não medição.
 *
 * SOMENTE LEITURA: só faz GET em rotas de leitura. Não escreve nada.
 *
 * Uso:
 *   node scripts/diagnostico/pedagio-e-latencia.mjs https://<app>.replit.app <cookie>
 *
 * O cookie é o valor de `freightcheck_session` de uma sessão aberta no
 * navegador (DevTools → Application → Cookies). Sem ele o script ainda mede a
 * linha de base e a entrega estática, mas não o pedágio.
 */

const [, , BASE_BRUTA, COOKIE] = process.argv;
if (!BASE_BRUTA) {
  console.error("\nUso: node scripts/diagnostico/pedagio-e-latencia.mjs https://<app>.replit.app <cookie>\n");
  process.exit(1);
}
const BASE = BASE_BRUTA.replace(/\/+$/, "");
const N = Number(process.env.N || 40);

/** As rotas do caminho crítico das telas mais lentas da auditoria (§4.1). */
const ROTAS_DE_PRODUTO = (process.env.ROTAS ?? [
  "/api/contexts",
  "/api/change-sets",
  "/api/imports",
  "/api/curation/summary",
  "/api/auth/session",
  "/api/changes/families",
  "/api/changes/grouped",
  "/api/dre/fleet?escopo=CONJUNTO",
  "/api/curation/queue",
  "/api/composition/fleet",
].join(",")).split(",").filter(Boolean);

async function medir(caminho, comCookie) {
  const t0 = process.hrtime.bigint();
  let status = 0, bytes = 0;
  try {
    const r = await fetch(BASE + caminho, {
      headers: {
        "accept-encoding": "gzip, br",
        ...(comCookie && COOKIE ? { cookie: `freightcheck_session=${COOKIE}` } : {}),
      },
      redirect: "manual",
    });
    status = r.status;
    bytes = (await r.arrayBuffer()).byteLength;
  } catch (e) {
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, status: 0, bytes: 0, erro: String(e).slice(0, 80) };
  }
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, status, bytes };
}

const pct = (v, p) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN;
};
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : n);

async function amostrar(caminho, comCookie, n = N) {
  await medir(caminho, comCookie); // aquece a conexão TLS
  const ms = [], erros = [];
  let status = 0, bytes = 0;
  for (let i = 0; i < n; i++) {
    const r = await medir(caminho, comCookie);
    if (r.erro) erros.push(r.erro); else { ms.push(r.ms); status = r.status; bytes = r.bytes; }
  }
  return { caminho, comCookie, n: ms.length, status, bytes, erros: erros.length,
           p50: pct(ms, 0.5), p95: pct(ms, 0.95), p99: pct(ms, 0.99),
           min: Math.min(...ms), max: Math.max(...ms) };
}

const linha = (r, rotulo) =>
  `  ${(rotulo ?? r.caminho).padEnd(38)} ${String(r.status).padStart(3)}  p50 ${String(r1(r.p50)).padStart(7)}  p95 ${String(r1(r.p95)).padStart(7)}  p99 ${String(r1(r.p99)).padStart(7)}  min ${String(r1(r.min)).padStart(7)}  ${String(r.bytes).padStart(7)} B`;

console.log(`\nAlvo: ${BASE}   ·   ${N} amostras por medição   ·   ${new Date().toISOString()}`);
if (!COOKIE) console.log("\n\x1b[1;33m  Sem cookie: o pedágio não será medido.\x1b[0m");

// --- 1. Linha de base: o que não é banco -----------------------------------
console.log("\n\x1b[1;36m1. Linha de base — rede, roteador e Node, sem uma consulta sequer\x1b[0m\n");
const healthz = await amostrar("/api/healthz", false);
const buildSem = await amostrar("/api/build", false);
console.log(linha(healthz, "/api/healthz (0 consultas)"));
console.log(linha(buildSem, "/api/build sem cookie (0 consultas)"));

if (healthz.n === 0) {
  console.error("\n\x1b[1;31mNenhuma resposta. Confira a URL e se o deployment está no ar.\x1b[0m\n");
  process.exit(1);
}

// --- 2. O pedágio ----------------------------------------------------------
let pedagio = null;
if (COOKIE) {
  console.log("\n\x1b[1;36m2. O pedágio — as mesmas rotas, agora com sessão\x1b[0m\n");
  const buildCom = await amostrar("/api/build", true);
  const sessao = await amostrar("/api/auth/session", true);
  console.log(linha(buildCom, "/api/build com cookie (3 consultas)"));
  console.log(linha(sessao, "/api/auth/session (10 consultas)"));

  if (buildCom.status === 200 && buildSem.status === 200) {
    pedagio = { p50: buildCom.p50 - buildSem.p50, p95: buildCom.p95 - buildSem.p95 };
    const rtt = pedagio.p50 / 3;
    console.log(`\n  \x1b[1mpedágio (3 consultas)\x1b[0m   p50 ${r1(pedagio.p50)} ms   p95 ${r1(pedagio.p95)} ms`);
    console.log(`  \x1b[1mRTT estimado até o banco\x1b[0m  ~${r1(rtt)} ms por consulta`);
    if (rtt < 2)       console.log("  \x1b[1;32m  ▸ Banco na mesma região. O pedágio é barato; R4 continua alto, não crítico.\x1b[0m");
    else if (rtt < 10) console.log("  \x1b[1;33m  ▸ Banco próximo. O pedágio pesa em telas com muitas chamadas.\x1b[0m");
    else               console.log("  \x1b[1;31m  ▸ Banco DISTANTE. R4 vira crítico: uma tela de 14 chamadas paga " +
                                   `${r1(pedagio.p50 * 14)} ms só de pedágio.\x1b[0m`);
  } else {
    console.log("\n  \x1b[1;33m  ▸ Cookie recusado (status " + buildCom.status + "). O pedágio não pôde ser isolado.\x1b[0m");
  }
}

// --- 3. As rotas de produto ------------------------------------------------
if (COOKIE) {
  console.log("\n\x1b[1;36m3. Rotas de produto — e quanto delas é pedágio\x1b[0m\n");
  const menor = Math.max(8, Math.floor(N / 4));
  for (const rota of ROTAS_DE_PRODUTO) {
    const r = await amostrar(rota, true, menor);
    let sufixo = "";
    if (pedagio && r.p50 > 0) {
      const parte = Math.min(100, (pedagio.p50 / r.p50) * 100);
      sufixo = `   pedágio ≈ ${Math.round(parte)}% do total`;
    }
    console.log(linha(r) + sufixo);
  }
}

// --- 4. Partida a frio -----------------------------------------------------
console.log("\n\x1b[1;36m4. Partida a frio — este processo é o mesmo de antes?\x1b[0m\n");
try {
  const r = await fetch(`${BASE}/api/build`, { headers: COOKIE ? { cookie: `freightcheck_session=${COOKIE}` } : {} });
  const b = await r.json();
  console.log(`  pid ${b.pid}  ·  de pé há ${b.uptimeSeconds}s  ·  startedAt ${b.startedAt}  ·  revision ${b.revision}`);
  console.log("  Rode de novo depois de 15 min de ociosidade: pid diferente com a mesma revision = o Autoscale recolheu e subiu de novo.");
} catch {
  console.log("  /api/build não respondeu JSON.");
}
console.log("");
