#!/usr/bin/env node
/**
 * TOPOLOGIA — onde está o banco em relação à aplicação, e quanto isso custa.
 *
 * ---------------------------------------------------------------------------
 * A pergunta
 * ---------------------------------------------------------------------------
 * A Fase 0 mediu, no ambiente publicado, **123,4 ms por consulta** — isolados
 * pela diferença entre `/api/build` com e sem cookie, que difere em exatamente
 * três consultas. Com 20 a 50 consultas por tela, é esse número que responde
 * pela maior parte do que o usuário espera.
 *
 * Mas "123 ms por consulta" tem pelo menos quatro causas possíveis, e elas
 * pedem correções completamente diferentes:
 *
 *   A. **Geografia.** App e banco em regiões distantes. 120 ms é exatamente a
 *      ordem de grandeza de São Paulo ↔ Virgínia. Correção: aproximar.
 *   B. **Conexão por consulta.** Se o pool não reaproveita, cada consulta paga
 *      TCP + TLS — três a quatro idas e voltas em vez de uma. Correção: pool.
 *   C. **Proxy no meio.** O endpoint *pooled* do Neon (pgbouncer) acrescenta um
 *      salto. Correção: escolher o endpoint certo.
 *   D. **Compute suspenso.** O Neon suspende por ociosidade e a primeira
 *      consulta acorda o compute. Isso aparece como *outlier*, não como p50.
 *
 * Este script separa as quatro, e a chave é medir o **TCP puro**: um handshake
 * TCP é uma ida e volta e nada mais. Se ele der ~120 ms, a causa é A, e
 * nenhuma otimização de consulta resolve. Se der ~5 ms com a consulta em
 * 123 ms, a causa é B ou C, e aproximar região não resolveria nada.
 *
 * ---------------------------------------------------------------------------
 * Somente leitura, e sem credencial na tela
 * ---------------------------------------------------------------------------
 * Abre conexões e, se houver `psql`, roda `SELECT 1`. Não escreve, não migra,
 * não cria nada. Lê `DATABASE_URL` do ambiente e **nunca** imprime usuário,
 * senha ou a URL inteira: só o host, a porta e a região que o nome do host
 * revela.
 *
 * ---------------------------------------------------------------------------
 * Onde rodar
 * ---------------------------------------------------------------------------
 * **No Shell do Replit.** O que interessa é a distância do lado da aplicação,
 * e é de lá que ela se mede. Rodar da sua máquina mediria a distância errada.
 *
 *   node scripts/diagnostico/topologia-app-banco.mjs
 *
 * Variáveis: `DATABASE_URL` (ou `PRODUCTION_DATABASE_URL`), `N` (amostras).
 */
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const N = Number(process.env.N || 12);
const BRUTA = process.env.DATABASE_URL || process.env.PRODUCTION_DATABASE_URL || "";

if (!BRUTA) {
  console.error("\nDefina DATABASE_URL (ou PRODUCTION_DATABASE_URL) e rode de novo.");
  console.error("No Shell do Replit ela já costuma estar no ambiente.\n");
  process.exit(1);
}

let url;
try { url = new URL(BRUTA); } catch {
  console.error("\nDATABASE_URL não é uma URL válida. Nada foi impresso dela.\n");
  process.exit(1);
}
const HOST = url.hostname;
const PORTA = Number(url.port || 5432);

/** A região que o nome do host do Neon carrega: ep-algo-123.<REGIÃO>.aws.neon.tech */
function regiaoDoHost(host) {
  const m = host.match(/\.([a-z]{2}-[a-z]+-\d)\.(aws|azure)\.neon\.tech$/);
  if (m) return { provedor: m[2], regiao: m[1] };
  const g = host.match(/\.([a-z]{2}-[a-z]+\d?-\d)\./);
  if (g) return { provedor: "?", regiao: g[1] };
  return null;
}

/** O endpoint *pooled* do Neon traz `-pooler` no nome. */
const ehPooled = /-pooler\./.test(HOST);

const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : "—");

function tcp() {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const s = net.connect({ host: HOST, port: PORTA });
    s.once("connect", () => { const ms = Number(process.hrtime.bigint() - t0) / 1e6; s.destroy(); resolve(ms); });
    s.once("error", () => { s.destroy(); resolve(null); });
    s.setTimeout(15000, () => { s.destroy(); resolve(null); });
  });
}

/**
 * TLS direto na porta do Postgres não funciona: o protocolo pede um
 * `SSLRequest` em texto claro antes de subir o TLS. São 8 bytes, e é leitura
 * pura — o servidor responde 'S' (aceita) ou 'N' (recusa).
 */
function tlsPostgres() {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const s = net.connect({ host: HOST, port: PORTA });
    let tcpEm = null;
    s.once("connect", () => {
      tcpEm = Number(process.hrtime.bigint() - t0) / 1e6;
      const pedido = Buffer.alloc(8);
      pedido.writeInt32BE(8, 0);
      pedido.writeInt32BE(80877103, 4); // 1234 << 16 | 5679
      s.write(pedido);
    });
    s.once("data", (d) => {
      if (d[0] !== 0x53) { s.destroy(); resolve({ tcp: tcpEm, tls: null, aceitaSsl: false }); return; }
      /* SNI só com nome; com IP a RFC 6066 proíbe, e o Node avisa. */
      const ehIp = net.isIP(HOST) !== 0;
      const seguro = tls.connect({ socket: s, ...(ehIp ? {} : { servername: HOST }), rejectUnauthorized: false }, () => {
        const total = Number(process.hrtime.bigint() - t0) / 1e6;
        const proto = seguro.getProtocol();
        seguro.destroy();
        resolve({ tcp: tcpEm, tls: total, aceitaSsl: true, proto });
      });
      seguro.once("error", () => { seguro.destroy(); resolve({ tcp: tcpEm, tls: null, aceitaSsl: true }); });
    });
    s.once("error", () => { s.destroy(); resolve({ tcp: null, tls: null, aceitaSsl: null }); });
    s.setTimeout(20000, () => { s.destroy(); resolve({ tcp: tcpEm, tls: null, aceitaSsl: null }); });
  });
}

async function selectUm() {
  try {
    const t0 = process.hrtime.bigint();
    await execFileP("psql", [BRUTA, "-X", "-q", "-t", "-c", "SELECT 1"], { timeout: 30000 });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  } catch { return null; }
}

// --- Identidade ------------------------------------------------------------
console.log(`\n\x1b[1;36mBanco\x1b[0m\n`);
console.log(`  host            ${HOST}`);
console.log(`  porta           ${PORTA}`);
const reg = regiaoDoHost(HOST);
console.log(`  região          ${reg ? `\x1b[1m${reg.regiao}\x1b[0m (${reg.provedor})` : "não deduzível pelo nome do host"}`);
console.log(`  endpoint        ${ehPooled ? "\x1b[1;33mpooled (pgbouncer)\x1b[0m" : "direto"}`);
try {
  const ips = await dns.lookup(HOST, { all: true });
  console.log(`  resolve para    ${ips.map((i) => i.address).join(", ")}`);
} catch { console.log("  resolve para    (falhou)"); }

// --- Medição ---------------------------------------------------------------
console.log(`\n\x1b[1;36mLatência, ${N} amostras\x1b[0m\n`);
const tcps = [], tlss = [];
for (let i = 0; i < N; i++) {
  const r = await tlsPostgres();
  if (r.tcp !== null) tcps.push(r.tcp);
  if (r.tls !== null) tlss.push(r.tls);
}
if (!tcps.length) {
  console.error("  Não consegui abrir conexão. Confira DATABASE_URL e a rede.\n");
  process.exit(1);
}
console.log(`  TCP (1 ida e volta)        p50 ${r1(pct(tcps, 0.5))} ms  · p95 ${r1(pct(tcps, 0.95))} ms  · min ${r1(Math.min(...tcps))} ms`);
console.log(`  TCP+TLS (3-4 idas)         p50 ${r1(pct(tlss, 0.5))} ms  · p95 ${r1(pct(tlss, 0.95))} ms  · min ${r1(Math.min(...tlss))} ms`);

const consultas = [];
for (let i = 0; i < Math.min(N, 8); i++) { const v = await selectUm(); if (v !== null) consultas.push(v); }
if (consultas.length) {
  console.log(`  psql SELECT 1 (processo)   p50 ${r1(pct(consultas, 0.5))} ms  · min ${r1(Math.min(...consultas))} ms`);
  console.log(`  (inclui subir o psql e o handshake inteiro — serve de teto, não de RTT)`);
} else {
  console.log(`  psql SELECT 1              psql não disponível ou recusou; o TCP acima já responde a pergunta`);
}

// --- Veredito --------------------------------------------------------------
const rttTcp = pct(tcps, 0.5);
const MEDIDO_NO_AR = 123.4; // ms por consulta, Fase 0
console.log(`\n\x1b[1;36mVeredito\x1b[0m\n`);
console.log(`  Uma ida e volta até o banco custa \x1b[1m${r1(rttTcp)} ms\x1b[0m.`);
console.log(`  A Fase 0 mediu \x1b[1m${MEDIDO_NO_AR} ms por consulta\x1b[0m no ambiente publicado.\n`);

if (rttTcp >= MEDIDO_NO_AR * 0.7) {
  console.log("  \x1b[1;31m▸ CAUSA A — GEOGRAFIA.\x1b[0m O custo por consulta é o próprio RTT da rede.");
  console.log("    Nenhuma otimização de consulta o reduz: só aproximar app e banco.");
  console.log(`    Aproximar para ~2 ms levaria uma tela de 48 consultas de ${r1(48 * MEDIDO_NO_AR / 1000)} s para ~0,1 s.`);
} else if (rttTcp < MEDIDO_NO_AR * 0.3) {
  console.log("  \x1b[1;33m▸ NÃO é geografia.\x1b[0m A rede é rápida e a consulta é lenta assim mesmo.");
  console.log("    Olhe nesta ordem: (B) o pool está reaproveitando conexão? (C) o endpoint");
  console.log(`    é o pooled? ${ehPooled ? "\x1b[1;33mÉ — e isso acrescenta um salto.\x1b[0m" : "Não é."} (D) o compute do Neon suspende por ociosidade?`);
  console.log("    Mudar de região NÃO resolveria — e a alternativa à 1b muda de figura.");
} else {
  console.log("  \x1b[1;33m▸ MISTO.\x1b[0m A rede explica parte, e há mais alguma coisa por cima.");
  console.log("    Aproximar região ajuda, mas não sozinho.");
}
console.log("");
