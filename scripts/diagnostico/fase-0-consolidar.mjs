#!/usr/bin/env node
/**
 * Monta o relatório consolidado da Fase 0 a partir dos três JSON que as
 * medições deixaram. Chamado por `fase-0-publicado.sh`; não se roda sozinho.
 *
 * Só lê arquivos e escreve em stdout. A credencial nunca chega aqui: os JSON
 * de entrada não a contêm, e o orquestrador ainda passa a saída por uma
 * redação depois.
 */
import fs from "node:fs";
import path from "node:path";

const URL_ALVO = process.env.FASE0_URL ?? "(não informada)";
const DIR = process.env.FASE0_DIR ?? ".";
const AUTENTICADO = process.env.FASE0_AUTENTICADO === "1";

const ler = (nome) => {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, "json", nome), "utf8")); }
  catch { return null; }
};
const estatica = ler("estatica.json");
const pedagio = ler("pedagio.json");
const navegador = ler("navegador.json");

const kb = (n) => (Number.isFinite(n) ? `${Math.round(n / 1024)} KB` : "—");
const ms = (n) => (n === null || n === undefined || Number.isNaN(n) ? "—" : `${Math.round(n)} ms`);
const ou = (v, alt = "—") => (v === null || v === undefined || v === "" ? alt : v);
const L = [];
const p = (s = "") => L.push(s);

p("# Fase 0 — medição do ambiente publicado");
p("");
p(`**Data:** ${new Date().toISOString()}`);
p(`**Alvo:** \`${URL_ALVO}\``);
p(`**Sessão autenticada:** ${AUTENTICADO ? "sim" : "**não** — as etapas autenticadas não rodaram"}`);

const proc = pedagio?.processo;
p(`**Build publicado:** ${proc ? `revision \`${proc.revision}\` · construído em ${ou(proc.builtAt)} · pid ${proc.pid} · de pé há ${proc.uptimeSeconds}s (desde ${proc.startedAt})` : "não foi possível ler `/api/build`"}`);
p(`**Amostras:** ${pedagio ? `${pedagio.amostras} por endpoint na etapa 2` : "—"}${navegador ? `; ${navegador.rotas?.length ?? 0} rotas na etapa 3, espera de ${navegador.h3?.esperaSegundos ?? "—"}s antes da revisita` : ""}`);
p("");
p("> Somente leitura: nada foi escrito no banco, na configuração ou no deployment.");
p("");
p("---");
p("");

/* ---------------- 1. acesso público e entrega estática ------------------ */
p("## 1. Acesso público e entrega estática");
p("");
if (!estatica) { p("_A etapa 1 não produziu resultado. Veja o anexo._"); }
else {
  p("| Recurso | content-encoding | bruto | na rede | fator | cache-control | ETag | revisita |");
  p("|---|---|--:|--:|--:|---|---|---|");
  for (const a of estatica.assets ?? []) {
    const fator = a.bruto > 0 && a.rede > 0 ? `${(a.bruto / a.rede).toFixed(1)}×` : "—";
    const rev = String(a.revisita ?? "");
    const revTexto = rev.endsWith(":304")
      ? `304 via ${rev.startsWith("etag") ? "ETag" : "Last-Modified"} (bom)`
      : rev === "sem-validador" ? "**sem validador**" : `**${rev}**`;
    p(`| ${a.rotulo} (\`${a.caminho}\`) | ${a.contentEncoding || "**NENHUMA**"} | ${kb(a.bruto)} | ${kb(a.rede)} | ${fator} | ${ou(a.cacheControl, "**ausente**")} | ${a.etag ? "sim" : "ausente"} | ${revTexto} |`);
  }
  p("");
  p("Negociação, como um Chrome pediria:");
  p("");
  p("| accept-encoding | escolhida |");
  p("|---|---|");
  for (const n of estatica.negociacao ?? []) p(`| \`${n.aceita}\` | ${n.escolhida || "**nenhuma**"} |`);
  p("");
  const js = (estatica.assets ?? []).find((a) => a.rotulo === "JavaScript");
  if (js) {
    if (!js.contentEncoding) {
      p("**VEREDITO — o host NÃO comprime o JavaScript.** É o cenário caro, e ele é");
      p("configuração, não código: a auditoria mediu +2,7 s em 4G e +15,1 s em 3G.");
      p("**E1 sobe para o primeiro lugar absoluto do plano.**");
    } else {
      p(`**VEREDITO — o JavaScript chega comprimido (\`${js.contentEncoding}\`, fator ${(js.bruto / js.rede).toFixed(1)}×).** E1 sai da fase 1.`);
    }
    p("");
    const revJs = String(js.revisita ?? "");
    if (!revJs.endsWith(":304")) {
      p(`**Atenção — a revisita rebaixa o bundle inteiro.** Sem 304, cada abertura paga ${kb(js.bruto)} de novo.`);
      p("");
    } else if (!/max-age|immutable/.test(js.cacheControl ?? "")) {
      p("**Atenção:** o validador funciona (304), mas sem `max-age` o navegador revalida a");
      p("cada abertura — uma ida e volta antes de poder pintar. Com nome de arquivo com hash,");
      p("`max-age=31536000, immutable` elimina até essa ida.");
      p("");
    }
  }
}

/* ---------------- 2. abertura, navegação, revisita ---------------------- */
p("---");
p("");
p("## 2. Abertura autenticada, navegação interna e revisita");
p("");
if (!navegador) { p("_A etapa 3 não rodou (sem sessão, sem navegador, ou pulada). Veja o anexo._"); }
else {
  const b = navegador.bundle ?? {};
  p("### 2.1 Abertura inicial e bundle");
  p("");
  p("| | |");
  p("|---|---|");
  p(`| arquivos \`.js\` | ${ou(b.arquivos)} |`);
  p(`| maior chunk | ${kb(b.maior)} |`);
  p(`| JS na rede / bruto | ${kb(b.rede)} / ${kb(b.bruto)} |`);
  p(`| FCP / DCL | ${ms(b.fcp)} / ${ms(b.dcl)} |`);
  p(`| primeira abertura utilizável | ${ms(b.aberturaUtilMs)} |`);
  p("");
  p(`**H4 — bundle único:** ${b.arquivos <= 2 ? "**CONFIRMADO**" : `não se confirmou (${b.arquivos} arquivos)`}`);
  p("");
  p("### 2.2 Navegação interna, revisita e número de requisições");
  p("");
  p("| Rota | Abertura: casca | Abertura: próprias | Abertura utilizável | Nav. interna 1ª | Req | Revisita | Req | Δ |");
  p("|---|--:|--:|--:|--:|--:|--:|--:|--:|");
  for (const r of navegador.rotas ?? []) {
    p(`| ${r.rota} | ${ou(r.aberturaCasca)} | ${ou(r.aberturaProprias)} | ${ms(r.aberturaUtilMs)} | ${ms(r.primeiraUtilMs)} | ${r.primeiraReq} | ${ms(r.revisitaUtilMs)} | ${r.revisitaReq} | ${ou(r.deltaPct)} |`);
  }
  p("");
  p(`**H1 — casca de seis chamadas em toda abertura:** ${navegador.h1?.veredito === "CONFIRMADO" ? "**CONFIRMADO**" : "não se confirmou"}`);
  p("");
  p(`**H3 — revisita refaz tudo:** ${navegador.h3?.veredito === "CONFIRMADO" ? "**CONFIRMADO**" : "não se confirmou"} — ${navegador.h3?.refazem} de ${navegador.h3?.total} rotas refizeram chamadas **${navegador.h3?.esperaSegundos}s depois** da primeira visita.`);
  p("");
  p("> O intervalo é parte do veredito: o maior `staleTime` do app é 60 s, e uma");
  p("> revisita medida antes disso sai falso-negativa.");
  p("");
  if ((navegador.duplicadas ?? []).length) {
    p("### 2.3 Chamadas repetidas na mesma tela");
    p("");
    p("| Rota | Chamada | Vezes |");
    p("|---|---|--:|");
    for (const d of navegador.duplicadas) p(`| ${d.rota} | \`${d.url}\` | ${d.vezes} |`);
    p("");
  } else { p("### 2.3 Chamadas repetidas\n\nNenhuma.\n"); }
}

/* ---------------- 3. tempos de API e pedágio ---------------------------- */
p("---");
p("");
p("## 3. Tempos de API e pedágio de autenticação");
p("");
if (!pedagio) { p("_A etapa 2 não produziu resultado. Veja o anexo._"); }
else {
  p("### 3.1 Linha de base e isolamento do pedágio");
  p("");
  p("| Medição | status | p50 | p95 | p99 | min | bytes |");
  p("|---|--:|--:|--:|--:|--:|--:|");
  for (const m of pedagio.medicoes ?? []) {
    p(`| ${m.rotulo} | ${m.status} | ${ms(m.p50)} | ${ms(m.p95)} | ${ms(m.p99)} | ${ms(m.min)} | ${m.bytes} |`);
  }
  p("");
  if (pedagio.pedagio) {
    const pd = pedagio.pedagio;
    p(`**Pedágio (3 consultas):** p50 **${pd.p50} ms** · p95 ${pd.p95} ms`);
    p("");
    p(`**RTT estimado até o banco:** ~**${pd.rttPorConsulta} ms** por consulta`);
    p("");
    const frases = {
      ABAIXO_DO_RUIDO: "**VEREDITO — o pedágio não se distingue do ruído de medição** (< 0,5 ms). É o retrato de um banco coladíssimo à API. **D1 cai para a fase 2.**",
      MESMA_REGIAO: "**VEREDITO — banco na mesma região.** O pedágio é barato; **D1 cai para a fase 2** e D2 (592→63 ms) vira o item de backend mais valioso.",
      PROXIMO: "**VEREDITO — banco próximo.** O pedágio pesa em telas com muitas chamadas; D1 fica onde está.",
      DISTANTE: `**VEREDITO — banco DISTANTE.** **D1 sobe para o primeiro lugar do backend:** uma tela de 14 chamadas paga ~${Math.round(pd.p50 * 14)} ms só de pedágio.`,
    };
    p(frases[pd.veredito] ?? "");
    p("");
    p("**H2 — três consultas em toda requisição:** o isolamento só é possível porque");
    p("`/api/build` custa 0 consultas sem cookie e 3 com cookie. A diferença acima **é**");
    p("o pedágio, já incluindo o RTT até o banco.");
    p("");
  } else {
    p("_O pedágio não pôde ser isolado (sem sessão, ou cookie recusado)._");
    p("");
  }
  if ((pedagio.rotas ?? []).length) {
    p("### 3.2 Rotas de produto");
    p("");
    p("| Rota | status | p50 | p95 | p99 | min | bytes | pedágio |");
    p("|---|--:|--:|--:|--:|--:|--:|--:|");
    for (const r of pedagio.rotas) {
      p(`| \`${r.caminho}\` | ${r.status} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.p99)} | ${ms(r.min)} | ${r.bytes} | ${r.parteDoPedagio === null ? "—" : r.parteDoPedagio + "%"} |`);
    }
    p("");
  }
}

/* ---------------- 4. erros, timeouts, bloqueios ------------------------- */
p("---");
p("");
p("## 4. Erros, timeouts e recursos bloqueados");
p("");
const errosApi = (pedagio?.medicoes ?? []).concat(pedagio?.rotas ?? []).filter((m) => m.status !== 200 || m.erros > 0);
if (errosApi.length) {
  p("| Medição | status | falhas de transporte |");
  p("|---|--:|--:|");
  for (const m of errosApi) p(`| ${ou(m.rotulo, m.caminho)} | ${m.status} | ${ou(m.erros, 0)} |`);
} else { p("Nenhuma resposta fora de 200 e nenhuma falha de transporte nas etapas de API."); }
p("");
if (navegador?.h5) {
  p("### Comportamento com um endpoint em falha (503 injetado no navegador)");
  p("");
  p(`| esqueleto aparece em | ${ms(navegador.h5.esqueletoEmMs)} |`);
  p("|---|---|");
  p(`| a tela diz que houve erro em | ${navegador.h5.erroVisivelEmMs === null ? "**não disse em 40 s**" : ms(navegador.h5.erroVisivelEmMs)} |`);
  p("");
  p(`**H5 — retry longo e silencioso:** ${navegador.h5.veredito === "CONFIRMADO" ? "**CONFIRMADO**" : "não se confirmou"}`);
  p("");
}
if ((navegador?.errosDeConsole ?? []).length) {
  p("### Erros de console");
  p("");
  for (const e of navegador.errosDeConsole) p(`- \`${e}\``);
  p("");
}

/* ---------------- 5. limitações ----------------------------------------- */
p("---");
p("");
p("## 5. O que não é mensurável por fora — e continua pendente");
p("");
p("| Limitação | Por que não sai daqui | Como obter |");
p("|---|---|---|");
p("| Aquisição de conexão do pool, execução SQL e serialização **separadas** | são etapas dentro de um processo sem instrumentação publicada; de fora só se vê a soma | `pg_stat_statements` no Neon, ou um cabeçalho `server-timing` no servidor — **as duas são mudança, não medição** |");
p("| Consultas por requisição nas rotas de produto | exige o log do Postgres do ambiente publicado | `log_min_duration_statement` no Neon, ou `pg_stat_statements` |");
p("| Cold start do Autoscale | uma execução só não distingue processo novo de processo antigo | rodar de novo após ~15 min de ociosidade e comparar `pid`/`startedAt` da seção de build |");
p("| Custo com mais de uma unidade | depende do acervo real do ambiente | comparar `/api/contexts` publicado com o seed local (1 unidade) |");
p("| Concorrência real | este diagnóstico é sequencial, de propósito: não se põe carga num ambiente de produção sem combinar | janela combinada, ou métricas do próprio deployment |");
p("| CPU, memória, reinícios e throttling | não são observáveis por HTTP | painel do Replit |");
p("");
p("---");
p("");
p("## 6. Próximo passo");
p("");
p("Envie este arquivo inteiro. Com ele eu fecho a árvore de decisão do");
p("`docs/FASE-0.md` §3, preencho a coluna **evidência no ar** do plano, reordeno");
p("as prioridades pelos números reais e apresento o gate de aprovação da Fase 1.");
p("");
p("Nenhuma fase posterior foi implementada.");

console.log(L.join("\n"));
