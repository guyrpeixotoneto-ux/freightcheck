#!/usr/bin/env node
/**
 * PROVA NO DEPLOYMENT — o custo por consulta medido **de dentro do processo
 * publicado**, e a conexao fria separada da reutilizada.
 *
 * ---------------------------------------------------------------------------
 * Por que isto nao e o que a sonda de topologia ja fazia
 * ---------------------------------------------------------------------------
 * `topologia-app-banco.mjs` mede do **Shell** do Replit ate o Neon: deu 144,3 ms
 * de TCP. E forte, e nao e o numero que importa — o que importa e a distancia do
 * **deployment** ate o banco, e o Shell pode nao estar no mesmo lugar.
 *
 * Aqui nao se pede nada ao Shell: usa-se o proprio servidor publicado como
 * instrumento, pelo mesmo truque da Fase 0 — `/api/build` custa **0 consultas**
 * sem cookie e **3** com cookie, e nao le dado de produto nenhum. A diferenca
 * entre as duas e o custo de tres consultas **pelo pool de verdade da
 * aplicacao, de dentro dela**.
 *
 * ---------------------------------------------------------------------------
 * Fria e reutilizada, separadas
 * ---------------------------------------------------------------------------
 * A primeira consulta depois de o processo nascer paga o que as seguintes nao
 * pagam: estabelecer a conexao (TCP+TLS, tres a quatro idas e voltas) e, se o
 * compute do Neon estiver suspenso, acorda-lo. Nenhuma das duas coisas aparece
 * numa amostra aquecida — e foi por isso que eu **errei** ao escrever, no
 * relatorio anterior, que o compute suspenso estava "descartado": eu tinha 40
 * amostras, e as 40 eram quentes.
 *
 * Dois modos:
 *
 *   `agora`     mede o estado quente, com N amostras (p50/p95/p99).
 *   `aguardar`  sonda `/api/build` **sem cookie** (0 consultas, nao acorda
 *               nada) ate o `startedAt` mudar — o Autoscale recolheu e subiu
 *               outro processo — e ai dispara a primeira requisicao
 *               autenticada e cronometra. Essa e a fria.
 *
 * A leitura do resultado:
 *
 *   fria menos quente ~ 3xRTT  -> e so a conexao do pool
 *   fria menos quente >> 3xRTT -> tem compute do Neon acordando junto
 *
 * ---------------------------------------------------------------------------
 * Somente leitura, e sem credencial na linha de comando
 * ---------------------------------------------------------------------------
 * So GET. Nao escreve nada, nao muda configuracao, e nao toca no banco alem das
 * consultas que o proprio produto ja faria. O cookie vem de
 * `FREIGHTCHECK_COOKIE`, de `FREIGHTCHECK_COOKIE_FILE`, ou do prompt sem eco.
 *
 *   node scripts/diagnostico/prova-no-deployment.mjs https://SEU-APP.replit.app agora
 *   node scripts/diagnostico/prova-no-deployment.mjs https://SEU-APP.replit.app aguardar
 */
import fs from "node:fs";

const [, , BASE_BRUTA, MODO_BRUTO] = process.argv;
const MODO = (MODO_BRUTO ?? "agora").toLowerCase();
if (!BASE_BRUTA || !["agora", "aguardar"].includes(MODO)) {
  console.error("\nUso: node scripts/diagnostico/prova-no-deployment.mjs https://SEU-APP.replit.app [agora|aguardar]\n");
  process.exit(1);
}
const BASE = BASE_BRUTA.replace(/\/+$/, "");
const N = Number(process.env.N || 30);
const ESPERA_MAX_MIN = Number(process.env.ESPERA_MAX_MIN || 90);
/* Intervalo da sondagem. Configuravel para o proprio script poder ser testado
   sem esperar uma hora por um Autoscale de verdade. */
const SONDAGEM_S = Number(process.env.SONDAGEM_S || 60);
const CIANO = "\u001b[1;36m", NEGRITO = "\u001b[1m", AMARELO = "\u001b[1;33m", VERDE = "\u001b[1;32m", FIM = "\u001b[0m";

async function pedirCookie() {
  if (process.env.FREIGHTCHECK_COOKIE) return process.env.FREIGHTCHECK_COOKIE.trim();
  const arq = process.env.FREIGHTCHECK_COOKIE_FILE;
  if (arq) { try { return fs.readFileSync(arq, "utf8").trim(); } catch { /* segue */ } }
  if (!process.stdin.isTTY) return "";
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write("\n  Cole o cookie freightcheck_session e aperte ENTER (nao aparece na tela).\n\n  > ");
  return new Promise((resolve) => {
    let buf = "";
    const ao = (b) => {
      for (const ch of b.toString("utf8")) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode(false); process.stdin.pause();
          process.stdin.off("data", ao); process.stdout.write("\n");
          return resolve(buf.trim());
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f") { buf = buf.slice(0, -1); continue; }
        buf += ch;
      }
    };
    process.stdin.on("data", ao);
  });
}

const COOKIE = await pedirCookie();
if (!COOKIE) { console.error("\nSem cookie nao da para medir o pedagio (ele exige sessao).\n"); process.exit(1); }

async function bater(caminho, comCookie) {
  const t0 = process.hrtime.bigint();
  try {
    const r = await fetch(BASE + caminho, {
      headers: { "accept-encoding": "gzip", ...(comCookie ? { cookie: `freightcheck_session=${COOKIE}` } : {}) },
    });
    const corpo = await r.text();
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, status: r.status, corpo };
  } catch (e) {
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, status: 0, erro: String(e).slice(0, 80) };
  }
}
const build = async () => {
  const r = await bater("/api/build", false);
  try { return { ...r, json: JSON.parse(r.corpo) }; } catch { return r; }
};

const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : "-");

console.log(`\nAlvo: ${BASE}  ·  modo: ${MODO}  ·  ${new Date().toISOString()}`);

const primeiro = await build();
if (primeiro.status !== 200 || !primeiro.json) { console.error("\n/api/build nao respondeu como esperado.\n"); process.exit(1); }
console.log(`\nProcesso: pid ${primeiro.json.pid} · de pe ha ${primeiro.json.uptimeSeconds}s · startedAt ${primeiro.json.startedAt} · revision ${primeiro.json.revision}`);

let fria = null;
if (MODO === "aguardar") {
  console.log(`\n${CIANO}Aguardando o Autoscale recolher o processo${FIM}`);
  console.log(`  Sondo /api/build SEM cookie a cada ${SONDAGEM_S} s — 0 consultas, nao acorda o banco.`);
  console.log("  Nao abra o app durante a espera: qualquer acesso mantem o processo de pe.");
  console.log(`  Desisto em ${ESPERA_MAX_MIN} min. Ctrl-C a qualquer momento.\n`);
  const limite = Date.now() + ESPERA_MAX_MIN * 60000;
  let visto = primeiro.json.startedAt;
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, SONDAGEM_S * 1000));
    const b = await build();
    const agora = b.json?.startedAt;
    if (agora && agora !== visto) {
      console.log(`  ${VERDE}processo novo: ${agora}${FIM} (era ${visto})`);
      /* A PRIMEIRA autenticada deste processo: pool a estabelecer, mais o Neon
         a acordar se estiver suspenso. E a unica amostra fria que existe. */
      fria = await bater("/api/build", true);
      console.log(`  ${NEGRITO}primeira requisicao autenticada: ${r1(fria.ms)} ms${FIM} (status ${fria.status})`);
      break;
    }
    /* Durante a troca, o /api/build pode nao responder por alguns segundos —
       e isso e sinal, nao ruido: e o processo caindo. */
    const estado = b.json ? `de pe ha ${b.json.uptimeSeconds}s` : `sem resposta (status ${b.status}) — pode estar trocando`;
    process.stdout.write(`  ${new Date().toISOString().slice(11, 19)} ainda o mesmo (${estado})\n`);
  }
  if (!fria) console.log(`  ${AMARELO}nao houve troca de processo em ${ESPERA_MAX_MIN} min.${FIM}`);
}

console.log(`\n${CIANO}Estado quente — ${N} amostras${FIM}\n`);
const medir = async (caminho, comCookie) => {
  await bater(caminho, comCookie);
  const v = []; let st = 0;
  for (let i = 0; i < N; i++) { const r = await bater(caminho, comCookie); if (r.status) { v.push(r.ms); st = r.status; } }
  return { v, st };
};
const semCookie = await medir("/api/build", false);
const comCookie = await medir("/api/build", true);
const linha = (rot, o) => `  ${rot.padEnd(36)} ${o.st}  p50 ${String(r1(pct(o.v, 0.5))).padStart(7)}  p95 ${String(r1(pct(o.v, 0.95))).padStart(7)}  p99 ${String(r1(pct(o.v, 0.99))).padStart(7)}  min ${String(r1(Math.min(...o.v))).padStart(7)}`;
console.log(linha("/api/build sem cookie (0 consultas)", semCookie));
console.log(linha("/api/build com cookie (3 consultas)", comCookie));

const pedagio = pct(comCookie.v, 0.5) - pct(semCookie.v, 0.5);
const porConsulta = pedagio / 3;
console.log(`\n  ${NEGRITO}pedagio (3 consultas, pool real, de dentro do deployment)${FIM}  p50 ${r1(pedagio)} ms`);
console.log(`  ${NEGRITO}custo por consulta${FIM}  ~${r1(porConsulta)} ms`);

if (fria) {
  const quente = pct(comCookie.v, 0.5);
  const excedente = fria.ms - quente;
  const tresRtt = 3 * porConsulta;
  console.log(`\n${CIANO}Fria contra reutilizada${FIM}\n`);
  console.log(`  primeira autenticada do processo novo   ${r1(fria.ms)} ms`);
  console.log(`  mediana quente                          ${r1(quente)} ms`);
  console.log(`  excedente da fria                       ${NEGRITO}${r1(excedente)} ms${FIM}`);
  console.log(`  3xRTT (o que um TCP+TLS custaria)       ${r1(tresRtt)} ms\n`);
  if (excedente < tresRtt * 0.5) {
    console.log("  > A fria custou pouco: a conexao ja estava de pe, ou o pool conecta na partida.");
  } else if (excedente < tresRtt * 2) {
    console.log("  > O excedente e da ordem de um TCP+TLS: e o pool estabelecendo conexao.");
    console.log(`    ${NEGRITO}Nao ha sinal de compute suspenso acordando.${FIM}`);
  } else {
    console.log(`  ${AMARELO}> O excedente e MUITO maior que um TCP+TLS.${FIM}`);
    console.log("    E a assinatura do compute do Neon acordando de uma suspensao.");
    console.log("    Desligar a suspensao por ociosidade tira este custo da primeira visita.");
  }
} else if (MODO === "agora") {
  console.log(`\n  ${AMARELO}Nota:${FIM} todas as amostras acima sao quentes. Elas **nao** dizem nada`);
  console.log("  sobre compute suspenso nem sobre o custo de estabelecer conexao.");
  console.log("  Para isso, rode com `aguardar` e deixe o app ocioso.");
}
console.log("");
