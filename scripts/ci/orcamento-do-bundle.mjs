import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * O orçamento do bundle — o que impede a primeira carga de engordar sem que
 * ninguém veja.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 * Entre 27/08 e 15/09/2026 o bundle do FreightCheck cresceu **24,6%** — de
 * 690 KB para 849 KB comprimidos — em três semanas, e ninguém soube. Não houve
 * decisão: houve 109 commits, cada um acrescentando o que precisava, e o número
 * subindo por baixo. O `vite build` avisa que "alguns chunks passam de 500 kB",
 * mas o aviso não reprova nada e some no meio do log.
 *
 * Em 15/09 o code splitting levou a entrada de 848.948 para 174.782 bytes gzip
 * (`docs/AUDITORIA-PERFORMANCE-2026-09.md`, Parte III). Sem este arquivo, nada
 * impede que ela volte — e a forma mais provável não é alguém decidir piorar:
 * é **um `import` estático de página entrar em `App.tsx` por distração**, o que
 * arrasta a página inteira e tudo o que ela importa de volta para o pedaço de
 * entrada. Isso não quebra teste nenhum, não muda uma linha de comportamento e
 * não aparece no diff como um problema.
 *
 * Por isso a conferência é um portão do CI, e não um relatório.
 *
 * ---------------------------------------------------------------------------
 * O que é medido, exatamente
 * ---------------------------------------------------------------------------
 * **O JavaScript inicial alcançável a partir da entrada, comprimido.** Isto é:
 * o módulo que o `index.html` carrega, mais tudo o que ele declarar em
 * `<link rel="modulepreload">` — que é o que o navegador busca *antes de
 * pintar*, sem esperar por navegação nenhuma.
 *
 * Três decisões dentro dessa frase, e nenhuma é arbitrária:
 *
 * 1. **Lido do `index.html`, não adivinhado pelo nome do arquivo.** É o HTML que
 *    decide o que o navegador baixa primeiro; procurar por "o chunk chamado
 *    index" seria uma segunda verdade sobre isso, e quebraria no dia em que o
 *    Vite mudasse o padrão de nome ou passasse a partir a entrada em dois.
 *
 * 2. **Os pedaços adiados (`lazy`) ficam de fora.** Eles são exatamente o que o
 *    code splitting conquistou: existem, mas ninguém os baixa para ver a
 *    primeira tela. Somá-los aqui mediria o tamanho do produto, e o que este
 *    portão guarda é o tempo até a primeira pintura.
 *
 * 3. **Soma, e não o maior.** Com os preloads, tudo o que está na lista bloqueia
 *    junto: dois pedaços de 120 KB atrasam mais que um de 170. Hoje a lista tem
 *    um item só e a soma coincide com o maior — o relatório imprime os dois para
 *    que, no dia em que deixarem de coincidir, a diferença apareça.
 *
 * **O CSS não entra no teto.** Ele bloqueia a pintura tanto quanto o JS, e por
 * isso é medido e impresso — mas num orçamento à parte seria outro número e
 * outra decisão, e misturá-lo aqui faria o teto de JS subir e descer por causa
 * de Tailwind. Fica como contexto no relatório, declarado como não-orçado.
 *
 * **Sempre gzip.** É o que atravessa a rede, e a única medida que corresponde ao
 * relógio de quem espera. Cru daria um número três vezes maior e sem relação com
 * nada. Usa `node:zlib`, que já vem com o Node — este arquivo não acrescenta
 * dependência nenhuma ao repositório.
 *
 * ---------------------------------------------------------------------------
 * Como mexer no teto conscientemente
 * ---------------------------------------------------------------------------
 * Quando o CI reprovar, há duas saídas, e as duas são decisões:
 *
 * **(a) Enxugar o que cresceu.** Quase sempre é a certa. Se a entrada inchou, a
 * primeira coisa a procurar é `import X from "@/pages/…"` em `App.tsx` — as
 * telas são `lazy(() => import(…))`, e uma linha fora do padrão arrasta a página
 * inteira para a entrada. A segunda é uma biblioteca nova importada pela casca
 * (o `Layout`, a `sidebar`, o `App`), que por estar no caminho de todo mundo
 * entra na entrada mesmo servindo a uma tela só.
 *
 * **(b) Subir o teto — aqui, no mesmo commit, com o motivo escrito.** É
 * legítimo: o produto cresce, e um teto imutável vira um imposto. O que não é
 * legítimo é subir o teto num commit separado de "consertando o CI", sem dizer o
 * que cresceu e por quê. É assim que um orçamento morre — não de uma vez, mas
 * 30 KB por vez, cada um justificado pela pressa daquele dia.
 *
 * Ao subir, escreva junto: a data, o número novo, o número medido, e a
 * funcionalidade que justificou. O histórico deste `const` passa a ser o
 * registro de como o produto engordou, que é a informação que faltava em agosto.
 */

/**
 * O teto: **200 KB gzip** do JavaScript inicial.
 *
 * | quando | medido | teto |
 * |---|--:|--:|
 * | 15/09/2026, depois do code splitting | 174.782 B | 204.800 B |
 *
 * ~17% de folga. A régua: **cabe uma funcionalidade normal, não cabe um
 * acidente.** Uma tela nova adiada não mexe neste número; uma página voltando a
 * ser `import` estático leva a entrada aos 848.948 B de antes — quatro vezes o
 * teto, e o portão fecha na hora.
 *
 * Não são os 350 KB que a auditoria pôs como meta no §18: aquela meta foi
 * escrita quando o número real era 849 KB, e um teto de 350 aprovaria dobrar o
 * tamanho de hoje sem dizer nada.
 */
export const TETO_DO_JS_INICIAL = 200 * 1024;

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PADRAO = path.resolve(AQUI, "../../artifacts/freightaudit/dist/public");

/**
 * Os arquivos que o `index.html` manda buscar antes de pintar, separados por
 * natureza: o JS entra no teto, o CSS é contexto.
 */
export function primeiraCargaDoHtml(html) {
  const js = [];
  const css = [];
  for (const m of html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g)) js.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) js.push(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)) css.push(m[1]);
  const nosso = (c) => !/^https?:/.test(c);
  return { js: js.filter(nosso), css: css.filter(nosso) };
}

/**
 * Mede um build no disco. Não conhece o teto — quem compara é `conferir`, e
 * separar os dois é o que permite testar a comparação com números de mentira.
 */
export function medir(raiz = PADRAO) {
  const indexHtml = path.join(raiz, "index.html");
  if (!existsSync(indexHtml)) {
    throw new Error(
      `Não há build para medir em ${raiz}.\n` +
        `Rode antes: pnpm --filter @workspace/freightaudit run build`,
    );
  }

  const html = readFileSync(indexHtml, "utf8");
  const { js, css } = primeiraCargaDoHtml(html);

  const pesar = (rel) => {
    const abs = path.join(raiz, rel.replace(/^\//, ""));
    if (!existsSync(abs)) {
      throw new Error(
        `O index.html aponta para ${rel}, que não existe no build — ` +
          `build incompleto ou corrompido.`,
      );
    }
    return { arquivo: rel, bytes: gzipSync(readFileSync(abs)).length };
  };

  const pedacos = js.map(pesar).sort((a, b) => b.bytes - a.bytes);
  const folhas = css.map(pesar).sort((a, b) => b.bytes - a.bytes);

  if (pedacos.length === 0) {
    throw new Error(
      `O index.html não carrega nenhum módulo. Build incompleto, ou o Vite ` +
        `mudou como declara a entrada — e aí este medidor precisa acompanhar.`,
    );
  }

  return {
    jsInicial: pedacos.reduce((s, p) => s + p.bytes, 0),
    maiorPedaco: pedacos[0],
    pedacos,
    cssInicial: folhas.reduce((s, f) => s + f.bytes, 0),
    folhas,
  };
}

/** Compara com o teto. Devolve o veredito; não imprime nada. */
export function conferir(medida, teto = TETO_DO_JS_INICIAL) {
  return {
    teto,
    real: medida.jsInicial,
    estourou: medida.jsInicial > teto,
    excedente: Math.max(0, medida.jsInicial - teto),
    folga: (teto - medida.jsInicial) / teto,
  };
}

const kb = (b) => `${(b / 1024).toFixed(1)} KB`;

function relatar(medida, v) {
  console.log("Orçamento do bundle — JavaScript inicial, gzip\n");
  console.log(
    `  ${v.estourou ? "✗" : "✓"} JS inicial  ${kb(v.real).padStart(10)} ` +
      `de ${kb(v.teto).padStart(10)}  ` +
      (v.estourou
        ? `ESTOUROU por ${kb(v.excedente)} (${v.real} B de ${v.teto} B)`
        : `${(v.folga * 100).toFixed(0)}% de folga (${v.real} B de ${v.teto} B)`),
  );

  console.log(`\n  O que o index.html carrega antes de pintar:`);
  for (const p of medida.pedacos) console.log(`    ${kb(p.bytes).padStart(10)}  ${p.arquivo}`);
  console.log(`    maior pedaço isolado: ${kb(medida.maiorPedaco.bytes)} (${medida.maiorPedaco.arquivo})`);
  for (const f of medida.folhas) {
    console.log(`    ${kb(f.bytes).padStart(10)}  ${f.arquivo}   (CSS — fora do teto, ver o topo do script)`);
  }

  if (v.estourou) {
    console.error("\n" + "─".repeat(74));
    console.error("O JavaScript inicial estourou o orçamento.\n");
    console.error(`  encontrado: ${kb(v.real)}  (${v.real} bytes gzip)`);
    console.error(`  permitido : ${kb(v.teto)}  (${v.teto} bytes gzip)`);
    console.error(`  excedente : ${kb(v.excedente)}  (${v.excedente} bytes)\n`);
    console.error("  Responsáveis — os pedaços que o index.html carrega, do maior:");
    for (const p of medida.pedacos) {
      console.error(`    ${kb(p.bytes).padStart(10)}  ${p.arquivo}`);
    }
    console.error(
      `\n  A causa mais provável é uma página ter voltado a ser 'import'\n` +
        `  estático em App.tsx. Procure lá por 'import X from "@/pages/…' — as\n` +
        `  telas são 'lazy(() => import(…))'. A segunda causa mais provável é uma\n` +
        `  biblioteca nova importada pela casca (Layout, sidebar, App), que entra\n` +
        `  na entrada mesmo servindo a uma tela só.\n\n` +
        `  As saídas são duas, e as duas são decisões: enxugar o que cresceu, ou\n` +
        `  subir o teto em scripts/ci/orcamento-do-bundle.mjs, no mesmo commit,\n` +
        `  com o motivo escrito. O porquê disso está no topo daquele arquivo.`,
    );
    console.error("─".repeat(74));
  } else if (v.folga > 0.4) {
    console.log(
      `\n  Nota: o teto está ${(v.folga * 100).toFixed(0)}% acima do real. Um teto que sobra tanto\n` +
        `  não mede mais nada — se esta folga veio para ficar, aperte o número.`,
    );
  }
}

/* Rodado direto, confere e sai com o código que o CI lê. Importado, não faz
   nada — é o que permite testá-lo sem build no disco. */
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  try {
    const medida = medir();
    const veredito = conferir(medida);
    relatar(medida, veredito);
    process.exit(veredito.estourou ? 1 : 0);
  } catch (err) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
}
