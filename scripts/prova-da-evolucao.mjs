#!/usr/bin/env node
/**
 * A PROVA DA EVOLUÇÃO ANUAL DO FINAME — dirigir a tela, e não só abri-la.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo acrescenta a um print
 * ---------------------------------------------------------------------------
 * Um print prova que a página carregou. Não prova que os números estão certos:
 * **um número errado sozinho parece certo**. Foi assim que o recorte interno
 * passou na primeira conferência devolvendo o acervo inteiro na aba Cavalo — a
 * tela estava bonita e o cartão da ponta a ponta estava vazio.
 *
 * O que denuncia isso é uma **identidade**: Cavalo e Carreta são disjuntos por
 * construção (cada variável de FINAME tem um código por lado), então as duas
 * metades têm de somar o todo — em **cada** um dos dois cartões, não em um
 * deles. Esse é o teste que este script faz, e é ele que falha quando alguém
 * recortar só metade da tela.
 *
 * Ver `docs/PROVA-DA-EVOLUCAO-DE-FINAME.md` para o roteiro por extenso.
 *
 * ---------------------------------------------------------------------------
 * Uso
 * ---------------------------------------------------------------------------
 *   node scripts/prova-local.mjs subir
 *   node scripts/prova-da-evolucao.mjs [--prints /tmp]
 *
 * Sai com código 1 se qualquer identidade não fechar, se faltar um pedaço da
 * tela, ou se o console acusar erro.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = `http://localhost:${process.env.WEB_PORT ?? "25609"}`;
const PRINTS = process.argv.includes("--prints")
  ? process.argv[process.argv.indexOf("--prints") + 1]
  : "/tmp";
const CHROME =
  process.env.PROVA_CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PLAYWRIGHT =
  process.env.PROVA_PLAYWRIGHT ?? "/tmp/pw/node_modules/playwright-core/index.mjs";

const falhas = [];
const conferir = (condicao, oQue) => {
  console.log(`  ${condicao ? "✓" : "✗"} ${oQue}`);
  if (!condicao) falhas.push(oQue);
};

/** O cookie, do mesmo lugar em que o ambiente foi montado. */
function cookie() {
  return execFileSync("node", [path.join(root, "scripts", "prova-local.mjs"), "cookie"], {
    encoding: "utf8",
  }).trim();
}

/**
 * Os dois números dos dois primeiros cartões, lidos da tela.
 *
 * Lidos do texto renderizado de propósito: é o que o usuário vê. Ler da API
 * provaria que a API está certa, que é justamente o que os testes de domínio já
 * provam — e deixaria passar um cartão trocado por outro na montagem.
 */
async function cartoes(page) {
  const texto = await page.textContent("body");
  const moeda = (rotulo) => {
    const i = texto.indexOf(rotulo);
    if (i < 0) return null;
    const m = /(−|-)?R\$\s*([\d.]+)\/mês/.exec(texto.slice(i, i + 400));
    if (!m) return null;
    return Number(m[2].replace(/\./g, "")) * (m[1] ? -1 : 1);
  };
  return {
    movimentos: moeda("Impacto líquido dos movimentos"),
    pontaAPonta: moeda("Variação ponta a ponta"),
  };
}

const esperar = (page, ms) => page.waitForTimeout(ms);

async function main() {
  const { chromium } = await import(PLAYWRIGHT);
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    deviceScaleFactor: 2,
  });
  await ctx.addCookies([
    { name: "freightcheck_session", value: cookie(), domain: "localhost", path: "/" },
  ]);
  const page = await ctx.newPage();

  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(`console: ${m.text().slice(0, 300)}`);
  });

  try {
    // ---- 1. a comparação, e a fileira de quatro --------------------------
    console.log("\n[1] A tela de comparação e a fileira");
    await page.goto(`${BASE}/custo-fixo-finame`, { waitUntil: "networkidle" });
    await esperar(page, 5000);
    const abas = await page.$$eval('[role="tab"]', (ns) => ns.map((n) => n.textContent));
    conferir(abas.slice(0, 4).join("|") === "Cavalo + Carreta|Cavalo|Carreta|Evolução",
      "a fileira é Cavalo + Carreta | Cavalo | Carreta | Evolução");
    conferir((await page.textContent("body")).includes("Comparação entre vigências"),
      "o cabeçalho anuncia a comparação");
    await page.screenshot({ path: path.join(PRINTS, "prova-1-comparacao.png") });

    // ---- 2. abrir a Evolução ---------------------------------------------
    console.log("\n[2] O modo Evolução");
    await page.click("#finame-recorte-extra");
    await esperar(page, 9000);
    conferir(page.url().includes("modo=evolucao"), "o endereço carrega ?modo=evolucao");
    const corpo = await page.textContent("body");
    for (const pedaco of [
      "Evolução anual",
      "Esta evolução mostra",
      "Impacto líquido dos movimentos",
      "Variação ponta a ponta",
      "Alterações no ano",
      "Veículos impactados",
    ]) {
      conferir(corpo.includes(pedaco), `a tela mostra "${pedaco}"`);
    }
    /*
      Duas fileiras, uma marcação em cada — e a conferência precisa ser por
      fileira, e não da página inteira. A de cima é o modo (`finame-recorte-*`)
      e a de dentro é o recorte da evolução (`finame-evolucao-recorte-*`); um
      `$$eval` sobre `[role="tab"]` conta as duas juntas e acusa um defeito que
      não existe. Foi o que esta prova fez na primeira execução.
    */
    const marcadas = await page.$$eval('[role="tab"][aria-selected="true"]', (ns) =>
      ns.map((n) => ({ id: n.id, texto: n.textContent })),
    );
    const naFileiraDeCima = marcadas.filter(
      (m) => m.id.startsWith("finame-recorte-"),
    );
    const naDeDentro = marcadas.filter((m) =>
      m.id.startsWith("finame-evolucao-recorte-"),
    );
    conferir(
      naFileiraDeCima.length === 1 && naFileiraDeCima[0].texto === "Evolução",
      "na fileira de cima, só a aba Evolução fica marcada",
    );
    conferir(
      naDeDentro.length === 1 && naDeDentro[0].texto === "Cavalo + Carreta",
      "o seletor de dentro abre em Cavalo + Carreta",
    );

    // ---- 3. o vocabulário de custo ---------------------------------------
    console.log("\n[3] O idioma é de custo");
    conferir(corpo.includes("Redução de custo") && corpo.includes("Aumento de custo"),
      'a legenda diz "Redução de custo" e "Aumento de custo"');
    conferir(!corpo.includes("Impacto por placa ao longo do tempo"),
      "o título genérico de remuneração não aparece");
    conferir(corpo.includes("Variação do FINAME por veículo ao longo do ano"),
      "o título nomeia a rubrica");
    await page.screenshot({ path: path.join(PRINTS, "prova-2-evolucao.png"), fullPage: true });

    // ---- 4. a identidade do recorte --------------------------------------
    console.log("\n[4] Cavalo + Carreta = Cavalo + Carreta, nos dois cartões");
    const lidos = {};
    for (const [chave, id] of [
      ["todos", "#finame-evolucao-recorte-todos"],
      ["cavalo", "#finame-evolucao-recorte-cavalo"],
      ["carreta", "#finame-evolucao-recorte-carreta"],
    ]) {
      await page.click(id);
      await esperar(page, 8000);
      lidos[chave] = await cartoes(page);
      console.log(
        `    ${chave.padEnd(8)} movimentos=${lidos[chave].movimentos} ponta=${lidos[chave].pontaAPonta}`,
      );
    }
    for (const campo of ["movimentos", "pontaAPonta"]) {
      const partes = lidos.cavalo[campo] + lidos.carreta[campo];
      const todo = lidos.todos[campo];
      conferir(
        partes !== null && todo !== null && Math.abs(partes - todo) <= 2,
        `${campo}: ${lidos.cavalo[campo]} + ${lidos.carreta[campo]} = ${todo}`,
      );
    }
    conferir(
      lidos.todos.movimentos !== lidos.todos.pontaAPonta,
      "os dois cartões respondem números diferentes",
    );

    // ---- 5. o painel lateral ---------------------------------------------
    console.log("\n[5] O painel lateral");
    await page.click("#finame-evolucao-recorte-todos");
    await esperar(page, 8000);
    const linha = await page.$("tbody tr");
    conferir(linha !== null, "a matriz desenhou linhas");
    if (linha) {
      await linha.click();
      await esperar(page, 3000);
      const comPainel = await page.textContent("body");
      conferir(comPainel.includes("Ver histórico completo"), "a gaveta abriu");
      conferir(comPainel.includes("Variação no ano"),
        'a gaveta usa o vocabulário da tela ("Variação no ano")');
      await page.screenshot({ path: path.join(PRINTS, "prova-3-painel.png"), fullPage: true });
    }

    // ---- 6. a saída -------------------------------------------------------
    console.log("\n[6] A saída");
    await page.click("#finame-recorte-carreta");
    await esperar(page, 6000);
    conferir(!page.url().includes("modo=evolucao"), "sair da Evolução limpa o modo");
    conferir((await page.textContent("body")).includes("Comparação entre vigências"),
      "o cabeçalho volta a anunciar a comparação");

    // ---- 7. console -------------------------------------------------------
    console.log("\n[7] Console");
    conferir(erros.length === 0, `sem erros de console${erros.length ? `: ${erros[0]}` : ""}`);
  } finally {
    await browser.close();
  }

  console.log(
    falhas.length === 0
      ? `\n✓ Prova completa. Prints em ${PRINTS}.`
      : `\n✗ ${falhas.length} verificação(ões) falharam:\n  - ${falhas.join("\n  - ")}`,
  );
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((erro) => {
  console.error(`\n✗ ${erro instanceof Error ? erro.stack : String(erro)}`);
  process.exit(1);
});
