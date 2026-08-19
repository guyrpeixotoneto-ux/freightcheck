#!/usr/bin/env node
/**
 * Production está sofrendo partida a frio? — medido, não deduzido.
 *
 * A pergunta nasceu de um aviso na tela da Curadoria que dizia "a requisição
 * não completou". Esse estado tem três causas possíveis e elas pedem coisas
 * diferentes: a origem indisponível (que é o que o Autoscale produz ao recolher
 * o serviço), a conexão cortada no meio, e a sessão do ambiente expirada.
 * Escolher entre elas por intuição foi o que fez a correção anterior mandar
 * conferir um processo que estava de pé.
 *
 * O `/api/build` já responde o que decide a questão, e ninguém estava olhando:
 *
 *   - `startedAt` — quando **este processo** subiu. Se ele muda entre duas
 *     sondagens sem ninguém ter publicado, o serviço foi recolhido e subiu de
 *     novo. É a assinatura da partida a frio, e é um fato, não uma inferência.
 *   - `revision` — de qual commit. Muda junto num deploy, e é o que separa
 *     "publicaram" de "foi recolhido".
 *   - o tempo até a resposta — a partida a frio custa segundos; um processo já
 *     de pé responde em dezenas de milissegundos. A diferença é grande o
 *     bastante para não precisar de estatística.
 *
 * A leitura é a combinação dos três. `startedAt` novo + `revision` igual +
 * primeira resposta lenta é partida a frio, e não há outra coisa que produza
 * essa combinação. `revision` diferente é deploy. Tudo igual e resposta rápida
 * é um serviço que ficou de pé o intervalo inteiro — e aí a queda que se viu na
 * tela foi do caminho, não do servidor.
 *
 *   node scripts/sonda-cold-start.mjs https://…            # 12 × 5min = 1h
 *   node scripts/sonda-cold-start.mjs https://… --rodadas 6 --intervalo 600
 *   node scripts/sonda-cold-start.mjs http://127.0.0.1:8080 --rodadas 3 --intervalo 5
 *
 * O intervalo é a variável que importa: a janela de recolhimento do Autoscale é
 * de minutos de ociosidade, então sondar de 30 em 30 segundos **mantém o
 * serviço acordado** e prova o oposto do que se queria. O padrão de 5 minutos é
 * o menor intervalo que ainda deixa o serviço ocioso entre as sondagens.
 */

const argumentos = process.argv.slice(2);
const base = (argumentos.find((a) => !a.startsWith("--")) ?? "").replace(/\/+$/, "");

function opcao(nome, padrao) {
  const i = argumentos.indexOf(`--${nome}`);
  if (i === -1) return padrao;
  const valor = Number(argumentos[i + 1]);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

const RODADAS = opcao("rodadas", 12);
const INTERVALO_S = opcao("intervalo", 300);

if (!base) {
  console.error(
    "Uso: node scripts/sonda-cold-start.mjs <url-do-app> [--rodadas N] [--intervalo SEGUNDOS]\n" +
      "\n" +
      "A URL é a do app publicado, sem /api no fim. O script sonda /api/build\n" +
      "e reporta se o processo do outro lado foi trocado entre as sondagens.",
  );
  process.exit(1);
}

/** Uma sondagem: o carimbo e quanto ele demorou a chegar. */
async function sondar() {
  const comecou = Date.now();
  try {
    const resposta = await fetch(`${base}/api/build`, {
      redirect: "manual",
      headers: { "Cache-Control": "no-cache" },
    });
    const ms = Date.now() - comecou;
    const texto = await resposta.text();

    if (resposta.status >= 300 && resposta.status < 400) {
      /*
        Redirect é resultado, não erro. É a assinatura da sessão do ambiente
        expirada — a mesma que, no navegador, chega como erro de CORS e vira
        "Failed to fetch". Confundi-la com o serviço fora do ar manda procurar
        no lugar errado.
      */
      return {
        ms,
        erro: `redirect ${resposta.status} para ${resposta.headers.get("location") ?? "?"}`,
      };
    }
    if (!resposta.ok) return { ms, erro: `HTTP ${resposta.status}` };

    try {
      const corpo = JSON.parse(texto);
      return { ms, carimbo: corpo };
    } catch {
      return {
        ms,
        erro: `resposta não-JSON (${resposta.status}): ${texto.slice(0, 80)}`,
      };
    }
  } catch (err) {
    return { ms: Date.now() - comecou, erro: `sem resposta — ${err.message}` };
  }
}

const hhmmss = (d) => d.toISOString().slice(11, 19);
const espera = (s) => new Promise((r) => setTimeout(r, s * 1000));

console.log(`Sondando ${base}/api/build`);
console.log(`${RODADAS} rodadas a cada ${INTERVALO_S}s (~${Math.round((RODADAS - 1) * INTERVALO_S / 60)} min)\n`);
console.log("  hora      tempo    startedAt (processo)   revision   observação");
console.log("  --------  -------  ---------------------  ---------  ----------");

const leituras = [];
let anterior = null;

for (let i = 0; i < RODADAS; i += 1) {
  if (i > 0) await espera(INTERVALO_S);

  const r = await sondar();
  const agora = new Date();

  if (r.erro) {
    leituras.push({ em: agora, ms: r.ms, erro: r.erro });
    console.log(
      `  ${hhmmss(agora)}  ${String(r.ms).padStart(5)}ms  ${"—".padEnd(21)}  ${"—".padEnd(9)}  ${r.erro}`,
    );
    continue;
  }

  const { startedAt = "?", revision = "?" } = r.carimbo;
  let nota = "";
  if (anterior) {
    if (anterior.revision !== revision) nota = "DEPLOY — revision mudou";
    else if (anterior.startedAt !== startedAt) nota = "PROCESSO NOVO — mesmo build";
  }
  leituras.push({ em: agora, ms: r.ms, startedAt, revision, nota });
  console.log(
    `  ${hhmmss(agora)}  ${String(r.ms).padStart(5)}ms  ${startedAt.slice(11, 19).padEnd(21)}  ${String(revision).slice(0, 9).padEnd(9)}  ${nota}`,
  );
  anterior = { startedAt, revision };
}

// ---------------------------------------------------------------------------
// O veredito
// ---------------------------------------------------------------------------

const boas = leituras.filter((l) => l.startedAt);
const falhas = leituras.filter((l) => l.erro);
const processos = new Set(boas.map((l) => l.startedAt));
const builds = new Set(boas.map((l) => l.revision));
/*
  Trocas de processo que não foram deploy. É o número que responde à pergunta:
  todo deploy troca o processo, e contá-los juntos inflaria a conta de partidas
  a frio com publicações legítimas.
*/
const trocasSemDeploy = leituras.filter((l) => l.nota?.startsWith("PROCESSO NOVO")).length;
const lentas = boas.filter((l) => l.ms > 1500);

console.log("\nVeredito");
console.log(`  sondagens             ${leituras.length} (${falhas.length} sem resposta)`);
console.log(`  processos distintos   ${processos.size}`);
console.log(`  builds distintos      ${builds.size}`);
console.log(`  trocas sem deploy     ${trocasSemDeploy}`);
if (boas.length > 0) {
  const tempos = boas.map((l) => l.ms).sort((a, b) => a - b);
  console.log(
    `  tempo de resposta     mín ${tempos[0]}ms · mediana ${tempos[Math.floor(tempos.length / 2)]}ms · máx ${tempos[tempos.length - 1]}ms`,
  );
  console.log(`  respostas > 1500ms    ${lentas.length}`);
}

console.log("");
if (boas.length === 0) {
  console.log("  INCONCLUSIVO: nenhuma sondagem trouxe carimbo. Ver os erros acima —");
  console.log("  um redirect indica sessão do ambiente, e 'sem resposta' indica a origem fora.");
} else if (trocasSemDeploy > 0) {
  console.log(`  PARTIDA A FRIO CONFIRMADA: o processo foi trocado ${trocasSemDeploy}× sem`);
  console.log("  mudança de build, ou seja, sem ninguém publicar. É o Autoscale recolhendo o");
  console.log("  serviço na ociosidade e subindo outro na chamada seguinte — e é essa chamada");
  console.log("  seguinte que a tela vê como 'a requisição não completou'.");
} else if (builds.size > 1) {
  console.log("  HOUVE DEPLOY durante a janela: o build mudou. Uma queda aqui é publicação,");
  console.log("  não partida a frio. Repita a sonda numa janela sem publicar.");
} else {
  console.log(`  SEM PARTIDA A FRIO nesta janela: o mesmo processo (${[...processos][0]})`);
  console.log(`  respondeu as ${boas.length} sondagens. Se a tela falhou neste período, a causa`);
  console.log("  não foi o servidor ser recolhido — foi o caminho até ele.");
  console.log("  Aumente --intervalo se a suspeita for de uma ociosidade mais longa.");
}
