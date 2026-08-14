import { describe, expect, it } from "vitest";
import { ARTIGOS } from "../conhecimento";
import { buscar } from "../recuperacao";
import { normalizar, pontuar, termos } from "../normalizar";

/**
 * O que estes testes protegem: o limiar.
 *
 * Um assistente de conhecimento tem duas formas de errar, e elas puxam para
 * lados opostos. Se o limiar for alto demais, perguntas legítimas caem em "não
 * sei" e o produto parece não saber o que sabe. Se for baixo demais, qualquer
 * pergunta encontra o artigo menos distante dela e o produto responde sobre
 * curadoria quando perguntaram sobre o tempo.
 *
 * Os dois casos estão aqui de propósito, e mexer em `LIMIAR` sem rodá-los é
 * mexer no que o produto afirma saber.
 */

describe("busca no conhecimento", () => {
  it("cada artigo é encontrado pelas perguntas que ele mesmo declara", () => {
    const falhas: string[] = [];

    for (const artigo of ARTIGOS) {
      for (const pergunta of artigo.perguntas) {
        const achados = buscar(pergunta, 5);
        if (!achados.some((a) => a.artigo.id === artigo.id)) {
          falhas.push(`"${pergunta}" não recuperou ${artigo.id}`);
        }
      }
    }

    expect(falhas).toEqual([]);
  });

  it("a pergunta escrita como quem opera fala chega no artigo certo", () => {
    const casos: [string, string][] = [
      ["o que é o book do operador?", "book-o-que-e"],
      ["como faço para apagar uma entrada do book", "book-revisoes"],
      ["por que a cobertura da apuração está em 0%?", "parametros-cobertura"],
      ["posso somar o impacto mensal com o anual?", "parametros-periodicidade"],
      ["por que o ipva mensal é maior que o anual", "leitura-ipva"],
      ["como importo uma planilha", "conceito-importacao"],
      ["esqueci minha senha, como recupero", "conceito-acesso"],
    ];

    for (const [pergunta, esperado] of casos) {
      const achados = buscar(pergunta, 5);
      expect(
        achados.map((a) => a.artigo.id),
        `"${pergunta}"`,
      ).toContain(esperado);
    }
  });

  it("a pergunta mais provável fica em primeiro lugar", () => {
    expect(buscar("o que é o book do operador")[0]?.artigo.id).toBe("book-o-que-e");
    expect(buscar("como funcionam as revisões do book")[0]?.artigo.area).toBe("BOOK");
  });

  it("pergunta fora do assunto não recupera nada", () => {
    const foraDoAssunto = [
      "qual a previsão do tempo em salvador amanhã",
      "me escreva um poema sobre o mar",
      "quanto é 2 mais 2",
      "qual o melhor restaurante da cidade",
    ];

    for (const pergunta of foraDoAssunto) {
      expect(buscar(pergunta), `"${pergunta}"`).toEqual([]);
    }
  });

  it("todo artigo declara fonte e ao menos uma pergunta", () => {
    for (const artigo of ARTIGOS) {
      expect(artigo.fonte, artigo.id).toBeTruthy();
      expect(artigo.perguntas.length, artigo.id).toBeGreaterThan(0);
      expect(artigo.termos.length, artigo.id).toBeGreaterThan(0);
      expect(artigo.corpo.length, artigo.id).toBeGreaterThan(80);
    }
  });

  it("nenhum id de artigo se repete", () => {
    const ids = ARTIGOS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("normalização", () => {
  it("apaga acento e caixa", () => {
    expect(normalizar("Vigência")).toBe("vigencia");
    expect(normalizar("APURAÇÃO")).toBe("apuracao");
  });

  it("descarta o português funcional que não distingue pergunta nenhuma", () => {
    expect(termos("qual é o impacto disso")).toEqual(["impacto"]);
  });

  it("a expressão inteira pesa mais que a palavra solta", () => {
    const inteira = pontuar("o que é o book do operador", ["book do operador"]);
    const solta = pontuar("o que é o book do operador", ["book"]);
    expect(inteira).toBeGreaterThan(solta);
  });

  it("assunto sem termo casado pontua zero", () => {
    expect(pontuar("previsão do tempo", ["book", "bloco", "revisao"])).toBe(0);
  });
});
