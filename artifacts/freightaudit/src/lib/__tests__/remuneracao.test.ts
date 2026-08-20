import { describe, expect, it } from "vitest";
import {
  doCampo,
  escreverDivergencia,
  escreverValor,
  paraOCampo,
  type Conferencia,
} from "@/lib/remuneracao";

/**
 * O campo que lê um número da planilha — a única lógica de risco da tela que
 * cadastra a aba à mão.
 *
 * Ela é lógica e não pixel, que é o critério deste pacote, e é a que merece
 * teste com mais folga: **um erro de leitura aqui é um erro de mil vezes.** A
 * pessoa copia `1.424,91` da célula do Excel; lido como decimal inglês, isso
 * vira cento e quarenta e dois mil e quatrocentos e noventa e um. O número
 * entraria no cadastro com autor, data e ar de coisa conferida.
 *
 * O contrato tem três partes, e as três estão abaixo:
 *
 * 1. as duas grafias que saem de uma planilha brasileira são lidas iguais;
 * 2. o que não é número devolve `undefined` — e nunca `NaN`, que viraria `null`
 *    no JSON e **apagaria** a linha;
 * 3. `paraOCampo` e `doCampo` fecham o ciclo: o que a tela reescreve ao perder
 *    o foco volta a ser o mesmo número.
 */

describe("o que a pessoa digita, virado número", () => {
  it("lê as duas grafias que saem de uma planilha brasileira", () => {
    // Excel em pt-BR: ponto de milhar, vírgula decimal.
    expect(doCampo("1.424,91")).toBe(1424.91);
    expect(doCampo("85.491,28")).toBe(85491.28);
    // CSV exportado: ponto decimal, sem milhar.
    expect(doCampo("1424.91")).toBe(1424.91);
    // Excel em en-US, que aparece quando alguém copia de outra máquina.
    expect(doCampo("1,424.91")).toBe(1424.91);
  });

  it("aceita o símbolo colado junto, que é como a célula é copiada", () => {
    expect(doCampo("R$ 8.919,38")).toBe(8919.38);
    expect(doCampo("96,84%")).toBe(96.84);
    expect(doCampo(" 56 ")).toBe(56);
  });

  /*
    A regra que resolve `1.424`: com um sinal só, uma vez, e exatamente três
    dígitos depois, ele é separador de milhar. É a grafia de um valor redondo em
    português, e um decimal de três casas não existe em linha de dinheiro.
    A ambiguidade que sobra é resolvida na tela, não aqui — o campo se reescreve
    ao perder o foco, e quem quis dizer outra coisa vê `1.424,00` antes de
    salvar.
  */
  it("trata o ponto de milhar solitário como milhar, e não como decimal", () => {
    expect(doCampo("1.424")).toBe(1424);
    expect(doCampo("24.309")).toBe(24309);
    expect(doCampo("1.234.567")).toBe(1234567);
  });

  it("devolve undefined, e nunca NaN, para o que não é número", () => {
    // `null` no corpo da requisição apaga a linha; um `NaN` que vazasse para lá
    // transformaria um erro de digitação num apagamento silencioso.
    expect(doCampo("")).toBeUndefined();
    expect(doCampo("   ")).toBeUndefined();
    expect(doCampo("mil reais")).toBeUndefined();
    expect(doCampo("12a34")).toBeUndefined();
  });

  it("aceita zero e negativo — os dois são valores legítimos da aba", () => {
    expect(doCampo("0")).toBe(0);
    expect(doCampo("-150,50")).toBe(-150.5);
  });
});

describe("o número de volta ao campo", () => {
  /*
    O campo não traz símbolo: ele já está do lado de fora. Um valor que voltasse
    do servidor com `R$` obrigaria quem edita a apagá-lo antes de digitar, e é
    assim que se perde um dígito.
  */
  it("escreve em pt-BR e sem símbolo", () => {
    expect(paraOCampo(1424.91, "DINHEIRO")).toBe("1.424,91");
    expect(paraOCampo(5.9, "PERCENTUAL")).toBe("5,90");
    expect(paraOCampo(56, "QUANTIDADE")).toBe("56");
  });

  it("fecha o ciclo com doCampo, nas três medidas", () => {
    for (const [valor, medida] of [
      [1424.91, "DINHEIRO"],
      [85491.28, "DINHEIRO"],
      [-150.5, "DINHEIRO"],
      [17.84, "PERCENTUAL"],
      [72.91, "PERCENTUAL"],
      [64, "QUANTIDADE"],
    ] as const) {
      expect(doCampo(paraOCampo(valor, medida)), `${valor} ${medida}`).toBe(valor);
    }
  });
});

describe("a divergência escrita", () => {
  const conferencia = (diferenca: number): Conferencia => ({
    cadastro: 1000,
    planilha: 1000 + diferenca,
    diferenca,
    percentual: diferenca / 10,
    bate: diferenca === 0,
  });

  /*
    O sinal é do ponto de vista da planilha, e sempre explícito: "+R$ 6,00" quer
    dizer que a aba pede seis reais a mais do que o cadastro apurou. Quem
    confere precisa saber para que lado, porque é isso que decide quem cobra de
    quem.
  */
  it("carrega o sinal, do ponto de vista da planilha", () => {
    expect(escreverDivergencia(conferencia(6), "DINHEIRO")).toBe(`+${escreverValor(6, "DINHEIRO")}`);
    expect(escreverDivergencia(conferencia(-6), "DINHEIRO")).toBe(
      `−${escreverValor(6, "DINHEIRO")}`,
    );
  });

  it("usa o menos tipográfico, e não o hífen", () => {
    // O hífen se confunde com um traço de separação numa coluna de números.
    expect(escreverDivergencia(conferencia(-6), "DINHEIRO").startsWith("−")).toBe(true);
  });
});
