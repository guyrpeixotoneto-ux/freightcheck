#!/usr/bin/env node
/**
 * Onde a pergunta do Assistente para — medido, não deduzido.
 *
 * Este script existe por causa de um diagnóstico que não podia ser feito: a
 * tela do Assistente devolvia `500` com um corpo que não era JSON, e não havia
 * como saber, de fora, se a requisição chegara ao servidor, se o banco
 * respondera, se a Anthropic chegara a receber a pergunta. Cada uma dessas
 * hipóteses pede uma ação diferente, e chutar entre elas custou mais tempo do
 * que este arquivo custa a rodar.
 *
 * Ele percorre o caminho inteiro na ordem em que a requisição o percorre —
 * porta, processo, sessão, rota, orquestração, modelo — e para no primeiro
 * degrau que não sustenta o próximo, dizendo qual foi.
 *
 *   node scripts/diagnostico-assistente.mjs
 *   node scripts/diagnostico-assistente.mjs https://…replit.dev
 *   COOKIE_DE_SESSAO="freightcheck_session=…" node scripts/diagnostico-assistente.mjs …
 *
 * Sem cookie ele vai até onde dá sem sessão — que já é o suficiente para
 * separar "a API não está lá" de "a API está lá e a pergunta falha". Com o
 * cookie (copiado do navegador, aba Application → Cookies) ele faz a pergunta
 * de verdade e mostra o que a Anthropic devolveu.
 */
import { execFileSync } from "node:child_process";

const base = (process.argv[2] ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const cookie = process.env["COOKIE_DE_SESSAO"] ?? "";
const PERGUNTA = process.env["PERGUNTA"] ?? "o que vc já sabe?";

let parou = false;
const ok = (m) => console.log(`  ok    ${m}`);
const erro = (m) => {
  parou = true;
  console.log(`  ERRO  ${m}`);
};
const nota = (m) => console.log(`        ${m}`);
const titulo = (m) => console.log(`\n${m}`);

/**
 * Uma resposta descrita pelo que ela **é**, não pelo que se esperava dela.
 *
 * O campo que decide o diagnóstico inteiro é `ehJson`: esta API responde JSON
 * em toda situação, inclusive em erro. Corpo que não é JSON significa que quem
 * respondeu não foi ela — foi um proxy, um roteador, uma página de erro do
 * ambiente —, e é essa distinção que este script existe para tornar visível.
 */
async function pedir(caminho, init = {}) {
  const url = `${base}${caminho}`;
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
      redirect: "manual",
    });
    const texto = await res.text();
    let json = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* fica null de propósito: é o sinal que interessa */
    }
    return {
      url,
      status: res.status,
      tipo: res.headers.get("content-type") ?? "(sem content-type)",
      texto,
      json,
      ehJson: json !== null,
      chegou: true,
    };
  } catch (err) {
    return {
      url,
      chegou: false,
      motivo: err instanceof Error ? err.message : String(err),
    };
  }
}

function descrever(r) {
  if (!r.chegou) return `${r.url} — não completou: ${r.motivo}`;
  return `${r.url} — ${r.status} · ${r.tipo}`;
}

/**
 * Quem está escutando na porta, quando o alvo é esta máquina.
 *
 * Duas ferramentas porque nenhuma das duas está garantida: o contêiner do
 * Replit traz `ss`, e nem toda imagem traz. Sem nenhuma delas, a etapa se
 * declara inconclusiva em vez de afirmar que a porta está vazia — que é a
 * conclusão errada mais cara que este script poderia tirar.
 */
function ouvintesLocais(porta) {
  for (const [cmd, args, filtra] of [
    ["ss", ["-ltnp"], (l) => new RegExp(`[:.]${porta}\\s`).test(l)],
    [
      "lsof",
      ["-iTCP", "-sTCP:LISTEN", "-P", "-n"],
      (l) => l.includes(`:${porta} `) || l.endsWith(`:${porta}`),
    ],
  ]) {
    try {
      const saida = execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return saida.split("\n").filter(filtra).map((l) => l.trim());
    } catch {
      /* ferramenta ausente ou sem permissão: tenta a próxima */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

console.log(`\nDiagnóstico do Assistente — ${base}`);
console.log(`Pergunta usada: "${PERGUNTA}"`);

// 1 ── quem está na porta -----------------------------------------------------
titulo("1. O processo API Server está de pé?");
const porta = new URL(base).port || (base.startsWith("https") ? "443" : "80");
const local = /^(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])$/.test(new URL(base).hostname);
if (local) {
  const linhas = ouvintesLocais(porta);
  if (linhas === null) nota(`\`ss\` indisponível; pulando a inspeção da porta ${porta}.`);
  else if (linhas.length === 0) erro(`ninguém escutando na porta ${porta}.`);
  else {
    ok(`há processo escutando na porta ${porta}.`);
    for (const l of linhas) nota(l);
  }
} else {
  nota("alvo remoto: quem responde é o roteador da plataforma, e a porta não se vê daqui.");
}

// 2 ── healthz: a API responde, e é ela mesma? --------------------------------
titulo("2. A requisição chega ao servidor — e quem responde é a nossa API?");
const saude = await pedir("/api/healthz");
console.log(`        ${descrever(saude)}`);
if (!saude.chegou) {
  erro("nada respondeu. Não há como o Assistente funcionar antes disto.");
} else if (!saude.ehJson) {
  erro(
    "veio resposta, e ela não é JSON — logo não é a nossa API. Toda resposta " +
      "desta API é JSON, inclusive erro.",
  );
  nota(`começo do corpo: ${saude.texto.slice(0, 200)}`);
  nota(
    "Isto é o roteador/proxy respondendo por um servidor que não está lá. " +
      "É neste degrau que o problema está — não no Assistente.",
  );
} else {
  ok("a API respondeu, em JSON.");
  const banco = saude.json?.database ?? {};
  nota(
    `banco: configurado=${banco.configured} alcançável=${banco.reachable} ` +
      `migrations em dia=${banco.upToDate ?? banco.migrated}`,
  );
  if (banco.migrations?.pending?.length) {
    erro(`migrations pendentes: ${banco.migrations.pending.join(", ")}`);
  }
}

// 3 ── build no ar ------------------------------------------------------------
titulo("3. Qual código está no ar?");
const build = await pedir("/api/build");
if (build.chegou && build.ehJson) {
  ok(`revisão ${build.json.revision ?? "?"} · construída em ${build.json.builtAt ?? "?"}`);
} else {
  nota(`sem /api/build legível (${descrever(build)}).`);
}

// 4 ── a sessão ---------------------------------------------------------------
titulo("4. A sessão passa pelo portão?");
const sessao = await pedir("/api/auth/session");
console.log(`        ${descrever(sessao)}`);
if (sessao.chegou && sessao.ehJson && sessao.json?.user) {
  ok(`autenticado como ${sessao.json.user.email}.`);
} else if (!cookie) {
  nota(
    "sem COOKIE_DE_SESSAO: as etapas 5 e 6 vão bater no 401 do portão. " +
      "Copie o cookie `freightcheck_session` do navegador para ir até o fim.",
  );
} else {
  erro("o cookie fornecido não abriu sessão.");
}

// 5 ── capacidades: há chave e modelo neste processo? -------------------------
titulo("5. A chave da Anthropic chegou ao processo que roda a API?");
const cap = await pedir("/api/assistant/capabilities");
console.log(`        ${descrever(cap)}`);
if (cap.chegou && cap.ehJson && cap.status === 200) {
  if (cap.json.ia) ok(`há chave neste processo; modelo configurado: ${cap.json.modelo}`);
  else
    erro(
      "não há ANTHROPIC_API_KEY (nem ANTHROPIC_AUTH_TOKEN) neste processo — " +
        "as respostas saem em redação determinística, sem modelo.",
    );
  nota(`corpus carregado: ${cap.json.trechos} trechos.`);
} else if (cap.chegou && cap.status === 401) {
  nota("401 do portão — esperado sem cookie.");
} else if (cap.chegou && !cap.ehJson) {
  erro("resposta não-JSON nesta rota: de novo, quem respondeu não foi a API.");
}

// 6 ── a pergunta de verdade --------------------------------------------------
titulo("6. A pergunta atravessa a rota inteira?");
for (const [rotulo, accept] of [
  ["sem streaming (JSON puro)", "application/json"],
  ["com streaming (o que a tela faz)", "text/event-stream"],
]) {
  const r = await pedir("/api/assistant/ask", {
    method: "POST",
    headers: { "content-type": "application/json", accept },
    body: JSON.stringify({ pergunta: PERGUNTA }),
  });
  console.log(`\n     ${rotulo}`);
  console.log(`        ${descrever(r)}`);

  if (!r.chegou) {
    erro("a requisição não completou.");
    continue;
  }
  if (r.status === 401) {
    nota("401 do portão — esperado sem cookie.");
    continue;
  }

  const ehStream = (r.tipo ?? "").includes("text/event-stream");
  if (ehStream) {
    const eventos = r.texto
      .split("\n\n")
      .map((b) => /^event: (.+)$/m.exec(b)?.[1])
      .filter(Boolean);
    ok(`stream com os eventos: ${[...new Set(eventos)].join(", ")}`);
    const dadosFinais = /^event: resposta\ndata: (.+)$/m.exec(r.texto)?.[1];
    const evtErro = /^event: erro\ndata: (.+)$/m.exec(r.texto)?.[1];
    if (evtErro) erro(`o stream terminou em erro: ${evtErro}`);
    if (dadosFinais) relatarResposta(JSON.parse(dadosFinais));
    else if (!evtErro) erro("o stream fechou sem evento `resposta`.");
    continue;
  }

  if (!r.ehJson) {
    erro(
      "a resposta não é JSON. Este é o defeito relatado — e ele não pode vir " +
        "desta rota, que responde JSON em todos os seus caminhos.",
    );
    nota(`começo do corpo: ${r.texto.slice(0, 300)}`);
    nota("Quem respondeu foi uma camada antes do Express. Volte à etapa 1.");
    continue;
  }
  if (r.status >= 400) {
    erro(`a rota recusou: ${JSON.stringify(r.json)}`);
    continue;
  }
  ok("a rota respondeu em JSON.");
  relatarResposta(r.json);
}

/** O que a resposta conta sobre a chamada ao modelo. */
function relatarResposta(corpo) {
  nota(`redação: ${corpo.redacao} · intenção: ${corpo.intencao}`);
  nota(`etapas executadas: ${(corpo.etapas ?? []).map((e) => e.nome).join(" → ") || "(nenhuma)"}`);
  const ia = corpo.tecnico?.ia;
  if (!ia) {
    nota(
      "a Anthropic **não foi chamada** nesta pergunta (sem chave no processo, " +
        "ou `semIa`).",
    );
    return;
  }
  nota(
    `Anthropic: desfecho=${ia.desfecho} · modelo=${ia.modelo} · ${ia.latenciaMs}ms`,
  );
  if (ia.erro) erro(`a chamada ao modelo falhou: ${ia.erro}`);
  else if (ia.desfecho === "IA" || ia.desfecho === "PODADA")
    ok("Claude recebeu a pergunta e respondeu.");
}

// 7 ── o anel de uso ----------------------------------------------------------
titulo("7. O que as últimas chamadas ao modelo registraram?");
const uso = await pedir("/api/assistant/usage?limite=5");
if (uso.chegou && uso.ehJson && uso.status === 200) {
  const eventos = uso.json.eventos ?? [];
  if (eventos.length === 0) nota("o anel está vazio — nenhuma chamada ao modelo neste processo.");
  for (const e of eventos.slice(-5)) {
    nota(
      `${e.desfecho} · ${e.modelo} · ${e.latenciaMs}ms` +
        (e.erro ? ` · erro: ${e.erro}` : ""),
    );
  }
} else {
  nota(`sem /api/assistant/usage legível (${descrever(uso)}).`);
}

// ---------------------------------------------------------------------------
console.log(
  parou
    ? "\nHá pelo menos um degrau quebrado acima. O primeiro ERRO é o que precisa " +
        "de conserto; os seguintes costumam ser consequência dele.\n"
    : "\nO caminho inteiro respondeu. Se a tela ainda falha, o que muda entre " +
        "ela e este script é o navegador e o roteador — compare a URL de origem.\n",
);
process.exit(parou ? 1 : 0);
