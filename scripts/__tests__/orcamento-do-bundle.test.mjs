import { describe, expect, it } from "vitest";
import {
  TETO_DO_JS_INICIAL,
  conferir,
  primeiraCargaDoHtml,
} from "../ci/orcamento-do-bundle.mjs";

/**
 * O orçamento reprova o que ele existe para reprovar.
 *
 * Um portão de CI que nunca fecha é pior do que nenhum: dá a impressão de que
 * alguém está olhando. Estes testes cobrem as duas metades do portão — a leitura
 * do `index.html`, que decide *o que* conta como primeira carga, e a comparação,
 * que decide *se passa* — com números de mentira, sem depender de haver build
 * no disco.
 *
 * Medir um build de verdade não é testado aqui de propósito: isso **é** o passo
 * do CI (`pnpm run bundle:check`), e repeti-lo num teste seria medir a mesma
 * coisa duas vezes e chamar a segunda de cobertura.
 */
describe("o que conta como primeira carga sai do index.html", () => {
  it("separa o JS inicial do CSS, e pega os modulepreload junto", () => {
    const html = `
      <script type="module" crossorigin src="/assets/index-abc.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-def.js">
      <link rel="stylesheet" crossorigin href="/assets/index-ghi.css">
      <link rel="icon" href="/favicon.svg">
    `;
    expect(primeiraCargaDoHtml(html)).toEqual({
      js: ["/assets/index-abc.js", "/assets/vendor-def.js"],
      css: ["/assets/index-ghi.css"],
    });
  });

  /*
    Os pedaços adiados são justamente o que o code splitting conquistou: existem
    no disco e ninguém os baixa para ver a primeira tela. Eles não aparecem no
    `index.html`, e é por isso que ler de lá — em vez de varrer `assets/` — é o
    que faz o teto medir tempo até a pintura, e não tamanho do produto.
  */
  it("não vê os pedaços adiados, que não estão no html", () => {
    const html = `<script type="module" src="/assets/index-abc.js"></script>`;
    expect(primeiraCargaDoHtml(html).js).toEqual(["/assets/index-abc.js"]);
  });

  it("ignora terceiros, que não são nossos para orçar", () => {
    const html = `<link rel="stylesheet" href="https://fonts.example/x.css">`;
    expect(primeiraCargaDoHtml(html).css).toEqual([]);
  });

  it("não confunde um <script> comum com o módulo de entrada", () => {
    expect(primeiraCargaDoHtml(`<script src="/analytics.js"></script>`).js).toEqual([]);
  });
});

describe("a comparação com o teto", () => {
  const medida = (jsInicial) => ({
    jsInicial,
    maiorPedaco: { arquivo: "x.js", bytes: jsInicial },
    pedacos: [{ arquivo: "x.js", bytes: jsInicial }],
    cssInicial: 0,
    folhas: [],
  });

  it("aprova o que cabe", () => {
    expect(conferir(medida(90), 100).estourou).toBe(false);
  });

  it("reprova o que passa, e diz por quanto", () => {
    const v = conferir(medida(130), 100);
    expect(v.estourou).toBe(true);
    expect(v.excedente).toBe(30);
    expect(v.real).toBe(130);
    expect(v.teto).toBe(100);
  });

  it("o limite é o teto, e exatamente nele ainda passa", () => {
    expect(conferir(medida(100), 100).estourou).toBe(false);
    expect(conferir(medida(101), 100).estourou).toBe(true);
  });

  /*
    A prova do caminho negativo com o número real: o pedaço único de antes do
    code splitting (848.948 B gzip, 15/09/2026) tem de reprovar contra o teto
    que está no arquivo. É a regressão que este portão existe para pegar.
  */
  it("reprova a entrada de antes do code splitting", () => {
    const v = conferir(medida(848_948));
    expect(v.estourou).toBe(true);
    expect(v.teto).toBe(TETO_DO_JS_INICIAL);
  });

  it("aprova o medido em 15/09/2026, depois do code splitting", () => {
    expect(conferir(medida(174_782)).estourou).toBe(false);
  });
});

describe("o teto declarado", () => {
  /*
    O valor não é testado contra si mesmo — ele é uma decisão, e um teste que o
    repetisse só obrigaria a mudar dois lugares em vez de um. O que se testa é
    que ele continua sendo um número de gente, e que continua abaixo do que o
    produto já entregou uma vez: um teto acima de 848.948 aprovaria justamente a
    regressão que ele guarda.
  */
  it("é finito e menor do que a entrada de antes do splitting", () => {
    expect(Number.isFinite(TETO_DO_JS_INICIAL)).toBe(true);
    expect(TETO_DO_JS_INICIAL).toBeLessThan(848_948);
  });

  it("é os 200 KB que a decisão registrou", () => {
    expect(TETO_DO_JS_INICIAL).toBe(200 * 1024);
  });
});
