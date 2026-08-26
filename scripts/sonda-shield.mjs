#!/usr/bin/env node
/**
 * As chamadas de API estão sendo interceptadas antes de chegar ao nosso
 * servidor? E, se estão, por qual das três razões possíveis?
 *
 * A pergunta nasceu de uma tela que ficava ~15s em "Carregando..." e terminava
 * em "o quadro das unidades não pôde ser carregado". O console do navegador
 * mostrava toda chamada a `/api/*` sendo redirecionada para
 * `replit.com/__replshield`, e o redirect — que cruza origem e chega a um
 * domínio sem `Access-Control-Allow-Origin` — sendo abortado pelo browser. A
 * API nunca era alcançada. Não havia lentidão nenhuma: havia um desvio.
 *
 * O que este script resolve é o passo *seguinte*, que é onde se erra. Saber que
 * o shield intercepta não diz **por quê**, e as três razões pedem correções
 * diferentes e incompatíveis:
 *
 *   1. a sessão do Replit expirou **neste navegador** — nada de errado com o
 *      ambiente, só com o cookie de quem olha;
 *   2. o deployment está protegido/privado — o shield está na frente do serviço
 *      publicado, para todo mundo;
 *   3. o domínio custom aponta para o ambiente errado — para o editor/dev em vez
 *      do deployment publicado, e é o editor que exige login.
 *
 * As três produzem, no navegador, exatamente a mesma tela. Escolher entre elas
 * por intuição manda arrumar a configuração que não está quebrada.
 *
 * ---------------------------------------------------------------------------
 * Por que um script, e não o DevTools
 * ---------------------------------------------------------------------------
 *
 * Duas propriedades que o navegador não tem, e que são justamente as que
 * separam as três causas:
 *
 *   - **Aqui não há CORS.** `fetch` no Node lê `Location` de um redirect
 *     cross-origin; o navegador não — lá a resposta é opaca e o erro chega como
 *     um `TypeError: "Failed to fetch"` sem `cause`, sem `status` e sem `url`,
 *     idêntico ao de uma origem fora do ar ou de um DNS inexistente. Medido: os
 *     quatro cenários produzem o mesmo objeto. Nenhuma classificação é possível
 *     do lado do cliente, e é por isso que ela não está no código do app.
 *
 *   - **Aqui não há cookie.** O `fetch` do Node não carrega a sessão do
 *     replit.com. Toda sondagem daqui é anônima por construção, que é a
 *     condição de contorno que a causa (1) precisa: se o acesso anônimo
 *     funciona, o que estava quebrado era a sessão de quem olhava.
 *
 * Uso:
 *
 *   node scripts/sonda-shield.mjs https://freightcheck.com.br \
 *        --deployment https://<seu-app>.replit.app
 *
 * O `--deployment` é a URL canônica do serviço publicado (painel do Replit →
 * Deployments). **Sem ele o veredito não separa (2) de (3)** — é a comparação
 * entre os dois endereços que distingue "o serviço publicado está protegido" de
 * "o domínio nem chega ao serviço publicado" —, e o script diz isso em vez de
 * escolher um dos dois.
 */

import { promises as dns } from "node:dns";

const argumentos = process.argv.slice(2);
const posicional = argumentos.filter((a) => !a.startsWith("--"));

function texto(nome) {
  const i = argumentos.indexOf(`--${nome}`);
  if (i === -1) return null;
  const valor = argumentos[i + 1];
  return valor && !valor.startsWith("--") ? valor.replace(/\/+$/, "") : null;
}

const DOMINIO = (posicional[0] ?? "").replace(/\/+$/, "");
const DEPLOYMENT = texto("deployment");

if (!DOMINIO) {
  console.error(
    "Uso: node scripts/sonda-shield.mjs <url-do-dominio> [--deployment <url-do-.replit.app>]\n" +
      "\n" +
      "  <url-do-dominio>  o endereço por onde as pessoas entram, sem /api no fim.\n" +
      "  --deployment      a URL canônica do serviço publicado. Sem ela o veredito\n" +
      "                    não separa 'deployment protegido' de 'domínio errado'.",
  );
  process.exit(1);
}

const TEMPO_LIMITE_MS = 15_000;
const MAX_SALTOS = 5;

/*
  Os caminhos sondados, e por que estes três.

  `/api/build` é o carimbo de saúde: responde sem autenticação nenhuma, e é o
  mesmo que a `sonda-cold-start.mjs` usa. Se *ele* for desviado, o desvio é do
  caminho e não da nossa autenticação — é o discriminante principal.

  `/api/contexts` é uma das chamadas que a tela faz de verdade. Ele pode
  legitimamente responder 401 (a nossa sessão, não a do Replit), e essa
  diferença importa: 401 é o nosso servidor **respondendo**, o que prova que a
  chamada chegou. Confundir os dois é o erro que este script existe para evitar.

  `/` é a página. Se a raiz também for desviada, nem o app carrega — e aí o
  problema é anterior a qualquer chamada de API.
*/
const CAMINHOS = ["/api/build", "/api/contexts", "/"];

/** Um salto: o que este endereço respondeu, sem seguir nada automaticamente. */
async function saltar(url) {
  const comecou = Date.now();
  try {
    const resposta = await fetch(url, {
      redirect: "manual",
      headers: { "Cache-Control": "no-cache" },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    return {
      ms: Date.now() - comecou,
      status: resposta.status,
      location: resposta.headers.get("location"),
      tipoDeConteudo: resposta.headers.get("content-type") ?? "",
    };
  } catch (err) {
    return { ms: Date.now() - comecou, erro: err.message };
  }
}

/**
 * A cadeia inteira de redirects a partir de um endereço.
 *
 * Seguir à mão, e não com `redirect: "follow"`, é o ponto: o interesse está nos
 * degraus, não no destino. É um degrau — o primeiro que sai da origem pedida —
 * que carrega a resposta, e `follow` o engoliria.
 */
async function seguirCadeia(inicio) {
  const degraus = [];
  let url = inicio;

  for (let i = 0; i < MAX_SALTOS; i += 1) {
    const r = await saltar(url);
    degraus.push({ url, ...r });

    if (r.erro) break;
    if (r.status < 300 || r.status >= 400 || !r.location) break;

    url = new URL(r.location, url).toString();
  }
  return degraus;
}

/** O redirect saiu do domínio que se pediu? É isso que caracteriza a interceptação. */
function desviouParaFora(degraus, origemPedida) {
  for (const degrau of degraus) {
    if (new URL(degrau.url).origin !== origemPedida) return degrau.url;
  }
  return null;
}

const ehShield = (url) => /replit\.com\/__replshield|\/__replshield/i.test(url ?? "");

/**
 * O veredito de **um** endereço: interceptado, respondendo, ou fora do ar.
 *
 * `respondeu` é deliberadamente generoso — qualquer status do nosso servidor
 * conta, 401 e 500 incluídos. A pergunta aqui não é se a resposta agradou; é se
 * a chamada chegou ao outro lado. Um 401 nosso e um 302 do shield são fatos
 * opostos sobre o caminho, e é o caminho que está sob suspeita.
 */
async function diagnosticar(base) {
  const origem = new URL(base).origin;
  const achados = [];

  for (const caminho of CAMINHOS) {
    const degraus = await seguirCadeia(`${base}${caminho}`);
    const fora = desviouParaFora(degraus, origem);
    const ultimo = degraus[degraus.length - 1];

    achados.push({
      caminho,
      degraus,
      interceptado: Boolean(fora),
      destinoExterno: fora,
      shield: ehShield(fora),
      semResposta: Boolean(degraus[0]?.erro),
      respondeu: !fora && !degraus[0]?.erro && typeof ultimo?.status === "number",
      status: ultimo?.status ?? null,
    });
  }

  return {
    base,
    achados,
    // Um caminho interceptado já basta: a interceptação é do caminho até o
    // servidor, e ela não escolhe rota por rota.
    interceptado: achados.some((a) => a.interceptado),
    shield: achados.some((a) => a.shield),
    saudavel: achados.some((a) => a.caminho === "/api/build" && a.respondeu),
    inalcancavel: achados.every((a) => a.semResposta),
  };
}

function imprimir(rotulo, diagnostico) {
  console.log(`\n${rotulo}`);
  console.log(`  ${diagnostico.base}`);

  for (const achado of diagnostico.achados) {
    const primeiro = achado.degraus[0];
    const cabeca = primeiro.erro
      ? `sem resposta — ${primeiro.erro}`
      : `HTTP ${primeiro.status}${primeiro.location ? ` → ${primeiro.location}` : ""}`;

    console.log(`  ${achado.caminho.padEnd(15)} ${String(primeiro.ms).padStart(5)}ms  ${cabeca}`);

    for (const degrau of achado.degraus.slice(1)) {
      const corpo = degrau.erro
        ? `sem resposta — ${degrau.erro}`
        : `HTTP ${degrau.status}${degrau.location ? ` → ${degrau.location}` : ""}`;
      console.log(`  ${" ".repeat(15)} ${String(degrau.ms).padStart(5)}ms  ↳ ${corpo}`);
    }

    if (achado.shield) console.log(`  ${" ".repeat(22)}  ⚠ INTERCEPTADO pelo ReplShield`);
    else if (achado.interceptado) console.log(`  ${" ".repeat(22)}  ⚠ desviado para fora do domínio`);
  }
}

/** Para onde o domínio aponta. É a evidência de apoio da causa (3). */
async function resolverDominio(host) {
  const linhas = [];
  try {
    linhas.push(`CNAME    ${(await dns.resolveCname(host)).join(", ")}`);
  } catch {
    // Domínio de apex não tem CNAME — normal, e o A abaixo é que vale.
  }
  try {
    linhas.push(`A        ${(await dns.resolve4(host)).join(", ")}`);
  } catch (err) {
    linhas.push(`A        não resolveu — ${err.code ?? err.message}`);
  }
  return linhas;
}

// ---------------------------------------------------------------------------

console.log("Sonda do ReplShield — as chamadas chegam ao nosso servidor?");
console.log(`  domínio     ${DOMINIO}`);
console.log(`  deployment  ${DEPLOYMENT ?? "(não informado — o veredito ficará parcial)"}`);

const dominio = await diagnosticar(DOMINIO);
imprimir("Domínio custom (anônimo, sem cookie de sessão)", dominio);

const deployment = DEPLOYMENT ? await diagnosticar(DEPLOYMENT) : null;
if (deployment) imprimir("Deployment publicado (anônimo)", deployment);

console.log("\nPara onde o domínio aponta");
for (const linha of await resolverDominio(new URL(DOMINIO).hostname)) {
  console.log(`  ${linha}`);
}

// ---------------------------------------------------------------------------
// O veredito
// ---------------------------------------------------------------------------

console.log("\nVeredito");

if (dominio.inalcancavel && !dominio.interceptado) {
  console.log("  INCONCLUSIVO — nenhuma sondagem do domínio obteve resposta. Isto não é o");
  console.log("  shield: é a origem fora do ar, a rede desta máquina, ou um bloqueio de saída");
  console.log("  daqui. Confira os erros acima antes de mexer em qualquer configuração.");
  process.exit(0);
}

if (!dominio.interceptado) {
  /*
    O acesso anônimo funciona. Como esta sonda não carrega cookie nenhum, isso
    elimina (2) e (3): não há proteção na frente do serviço, e o domínio chega
    nele. Sobra a sessão do navegador de quem viu a falha.
  */
  console.log("  SESSÃO DO NAVEGADOR — o domínio responde normalmente a um cliente anônimo,");
  console.log("  agora. Nada está interceptando o caminho: nem proteção de deployment, nem");
  console.log("  domínio apontando para o ambiente errado. Se a tela falha no seu navegador e");
  console.log("  não aqui, o que difere entre os dois é o cookie — a sessão do replit.com");
  console.log("  expirou. Confirme numa aba anônima; resolva entrando de novo em replit.com.");
  console.log("");
  console.log("  Vale dizer o que isto **não** prova: que a configuração esteja correta em");
  console.log("  regime. Um app servido em domínio próprio depender da sessão do replit.com é");
  console.log("  a mesma falha esperando a próxima expiração. Se a API deve exigir login, que");
  console.log("  seja o nosso (/api/auth/session), que responde JSON — o shield responde HTML");
  console.log("  de login para um cliente que espera JSON, e é por isso que a tela inteira cai");
  console.log("  em vez de só a chamada ser negada.");
  process.exit(0);
}

const comoDesviou = dominio.shield ? "pelo ReplShield" : "para fora do domínio";

if (!deployment) {
  console.log(`  PARCIAL — o domínio está sendo interceptado ${comoDesviou}, e isto está provado.`);
  console.log("  O que falta é distinguir a causa, e não dá com uma medida só: 'deployment");
  console.log("  protegido' e 'domínio apontando para o ambiente errado' produzem este mesmo");
  console.log("  desvio. Rode de novo com --deployment <url-do-.replit.app>: é a comparação");
  console.log("  entre os dois endereços que separa os dois casos.");
  process.exit(0);
}

if (deployment.inalcancavel) {
  console.log("  INCONCLUSIVO — o domínio está interceptado, mas o deployment informado não");
  console.log("  respondeu, então não há com o que comparar. Confira a URL do --deployment");
  console.log("  (painel do Replit → Deployments) e repita.");
  process.exit(0);
}

if (!deployment.interceptado && deployment.saudavel) {
  console.log("  DOMÍNIO APONTANDO PARA O AMBIENTE ERRADO.");
  console.log("");
  console.log("  O deployment publicado responde a um cliente anônimo; o domínio custom, não —");
  console.log("  ele cai no shield. O serviço está de pé e desprotegido: quem não chega nele é");
  console.log("  o domínio. Ele está atado ao ambiente de desenvolvimento/editor, e é o editor");
  console.log("  que exige login do Replit.");
  console.log("");
  console.log("  Correção: no painel do Replit, religue o domínio custom ao deployment");
  console.log("  publicado (autoscale), não ao ambiente de desenvolvimento. O .replit deste");
  console.log("  repo já declara deploymentTarget = \"autoscale\" e router = \"application\";");
  console.log("  o defeito está no vínculo do domínio, fora do repositório.");
} else if (deployment.interceptado) {
  console.log("  DEPLOYMENT PROTEGIDO / PRIVADO.");
  console.log("");
  console.log("  Os dois endereços caem no shield, inclusive a URL canônica do serviço");
  console.log("  publicado. O desvio não é do domínio — é do próprio deployment, que está");
  console.log("  exigindo sessão do Replit de todo mundo. O domínio está apontando para o");
  console.log("  lugar certo; o lugar certo é que está fechado.");
  console.log("");
  console.log("  Correção: desligue a proteção de acesso do deployment no painel do Replit.");
  console.log("  Se a API deve mesmo exigir autenticação, que seja a nossa — o shield responde");
  console.log("  HTML de login a um cliente que espera JSON, e derruba a tela inteira em vez");
  console.log("  de negar uma chamada.");
} else {
  console.log("  ATÍPICO — o domínio está interceptado e o deployment responde, mas /api/build");
  console.log("  não veio saudável por lá. Leia a cadeia de redirects acima antes de concluir:");
  console.log("  há um desvio no caminho e algo a mais no serviço publicado, e este script não");
  console.log("  arrisca escolher entre os dois.");
}
