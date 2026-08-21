import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Corpo JSON sem `Content-Type` é um pedido que **chega vazio** do outro lado.
 *
 * Este teste não é sobre a tela de Unidades. É sobre o defeito que ela teve, e
 * existe porque ele é invisível em toda parte onde se costuma procurar: o
 * `JSON.stringify` está lá, o objeto está correto, o TypeScript aprova, a
 * requisição sai com 200 bytes de corpo e chega ao servidor certo. O que falta
 * é uma linha de cabeçalho, e a ausência dela não é um erro em lugar nenhum —
 * é um `Content-Type` diferente.
 *
 * A mecânica, que é determinística nos dois lados:
 *
 * - `fetch` com um corpo de texto e nenhum cabeçalho declara
 *   `text/plain;charset=UTF-8`. É o padrão do navegador, não um descuido dele;
 * - `express.json()` desserializa **por tipo**. O que não se declara JSON ele
 *   não lê, e não reclama: deixa `req.body` vazio e passa adiante.
 *
 * O resultado é o pior formato possível de falha — a rota roda inteira, com o
 * pedido de outra pessoa: o de quem não preencheu nada. Em
 * `POST /unidades/canonicas` isso apareceu como o cadastro que recusava um
 * formulário preenchido dizendo "O nome da unidade é o que a lista mostra…
 * sem ele a unidade existe e ninguém a acha", com o nome à vista no campo.
 * A validação estava certa; o nome é que não tinha viajado.
 *
 * A regra que este teste prende: **todo `body: JSON.stringify(…)` declara
 * `Content-Type: application/json` no mesmo objeto de opções.** No mesmo
 * objeto, e não "em algum lugar": um cabeçalho que venha de fora por variável
 * é indistinguível daqui de não ter cabeçalho nenhum, e um teste que aceitasse
 * o que não consegue ler pararia de proteger exatamente onde a escrita ficou
 * mais indireta.
 */

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

function arquivosDeCodigo(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name !== "__tests__") achados.push(...arquivosDeCodigo(caminho));
    } else if (/\.tsx?$/.test(entrada.name)) {
      achados.push(caminho);
    }
  }
  return achados;
}

/**
 * O objeto de opções que contém este `body:` — achado por contagem de chaves,
 * de trás para frente.
 *
 * Andar para trás é o que permite não depender de como a chamada foi escrita:
 * `fetch(url, { … })`, `fetchJson(rota, { … })`, uma constante `init` declarada
 * antes, o objeto quebrado em cinco linhas ou espremido em uma — todas põem o
 * `body` dentro de um literal, e é o literal que precisa ter o cabeçalho.
 *
 * Devolve `null` quando a varredura não fecha as chaves. Nesse caso o
 * comentário abaixo vale: o teste prefere acusar a passar em silêncio.
 */
function objetoDeOpcoes(fonte: string, posicaoDoBody: number): string | null {
  let profundidade = 0;
  let inicio = -1;
  for (let i = posicaoDoBody; i >= 0; i--) {
    const c = fonte[i];
    if (c === "}" || c === ")" || c === "]") profundidade++;
    else if (c === "{" || c === "(" || c === "[") {
      if (profundidade === 0) {
        // O primeiro delimitador aberto que envolve o `body` tem de ser uma
        // chave: `body` é propriedade de objeto. Um `(` ou `[` aqui significa
        // que a contagem se perdeu, e inventar um bloco a partir disso seria
        // afirmar coisa nenhuma sobre a chamada.
        if (c !== "{") return null;
        inicio = i;
        break;
      }
      profundidade--;
    }
  }
  if (inicio === -1) return null;

  let nivel = 0;
  for (let i = inicio; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") {
      nivel--;
      if (nivel === 0) return fonte.slice(inicio, i + 1);
    }
  }
  return null;
}

interface Escrita {
  onde: string;
  opcoes: string | null;
}

function escritasComCorpoJson(): Escrita[] {
  const escritas: Escrita[] = [];
  for (const arquivo of arquivosDeCodigo(RAIZ)) {
    const fonte = readFileSync(arquivo, "utf8");
    const marca = /body\s*:\s*JSON\.stringify\s*\(/g;
    let achado: RegExpExecArray | null;
    while ((achado = marca.exec(fonte)) !== null) {
      escritas.push({
        onde: `${path.relative(RAIZ, arquivo)}:${fonte.slice(0, achado.index).split("\n").length}`,
        opcoes: objetoDeOpcoes(fonte, achado.index),
      });
    }
  }
  return escritas;
}

/** O cabeçalho, escrito como se escreve em JavaScript — e sem depender do caixa. */
function declaraJson(opcoes: string): boolean {
  return /["']?content-type["']?\s*:\s*["'`][^"'`]*application\/json/i.test(opcoes);
}

describe("corpo JSON declara o tipo do corpo", () => {
  const escritas = escritasComCorpoJson();

  /*
    A guarda contra o teste vazio, como em `chave-compartilhada.test.ts`: uma
    varredura que deixa de encontrar escritas passa em silêncio e para de
    proteger, e é o desfecho mais provável de um refactor que centralize as
    chamadas. Se o dia chegar em que um helper único monta o corpo, este piso
    cai junto — de propósito, para que alguém leia este arquivo antes.
  */
  it("a varredura encontra as escritas da aplicação", () => {
    expect(escritas.length).toBeGreaterThan(30);
  });

  it("todo body: JSON.stringify vem com Content-Type: application/json", () => {
    const semCabecalho = escritas
      .filter((e) => e.opcoes === null || !declaraJson(e.opcoes))
      .map((e) =>
        e.opcoes === null
          ? `\n    ${e.onde} — não foi possível ler o objeto de opções desta chamada`
          : `\n    ${e.onde}`,
      );

    expect(
      semCabecalho.join(""),
      "Sem `headers: { \"Content-Type\": \"application/json\" }` o navegador manda " +
        "text/plain, o express.json() não desserializa e a rota roda com req.body " +
        "vazio — não como erro, mas como se ninguém tivesse preenchido nada. " +
        "Declare o cabeçalho no mesmo objeto de opções do body.",
    ).toBe("");
  });
});
