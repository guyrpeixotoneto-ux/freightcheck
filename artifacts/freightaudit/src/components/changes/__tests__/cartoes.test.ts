import { describe, expect, it } from "vitest";
import { larguraAproximada } from "../cartoes";

/**
 * A conta que decide o corpo do número dos cartões de impacto.
 *
 * `ImpactoPorPeriodicidade` escolhe o tamanho da letra dividindo a largura do
 * cartão pela largura que a linha pede — e uma conta que erra para baixo devolve
 * o defeito que ela existe para tirar: `R$ 11.917/mensal` pintado por cima do
 * cartão vizinho. Por isso os dois testes abaixo são um par, e o primeiro é o
 * que não pode falhar nunca.
 *
 * Os números de referência foram medidos no Chromium, em Montserrat 700 com
 * `tabular-nums` e `tracking-tight` — a mesma pilha da tela —, e estão em
 * múltiplos do corpo da fonte. Se a fonte do produto mudar, é aqui que a
 * mudança aparece primeiro.
 */
const MEDIDO: Record<string, number> = {
  "R$ 0": 2.258,
  "R$ 12": 2.933,
  "R$ 594": 3.604,
  "R$ 1.284": 4.517,
  "R$ 11.917": 5.192,
  "R$ 111.917": 5.867,
  "−R$ 1.284.567": 7.354,
  "/mês": 2.458,
  "/mensal": 4.017,
  "/ano": 2.2,
  "/anual": 3.117,
  "/quinzenal": 5.292,
  "/pontual": 4.128,
};

describe("larguraAproximada", () => {
  it("nunca fica abaixo da largura real — o erro cai sempre para o lado que sobra", () => {
    for (const [texto, medido] of Object.entries(MEDIDO)) {
      expect
        .soft(larguraAproximada(texto), `${texto} estreito demais`)
        .toBeGreaterThanOrEqual(medido);
    }
  });

  it("não sobra tanto a ponto de encolher o número sem motivo", () => {
    for (const [texto, medido] of Object.entries(MEDIDO)) {
      expect
        .soft(larguraAproximada(texto), `${texto} largo demais`)
        .toBeLessThanOrEqual(medido * 1.25);
    }
  });

  it("cresce com o número, que é o que faz o cartão apertar", () => {
    expect(larguraAproximada("R$ 11.917")).toBeGreaterThan(
      larguraAproximada("R$ 594"),
    );
    expect(larguraAproximada("−R$ 1.284.567")).toBeGreaterThan(
      larguraAproximada("R$ 111.917"),
    );
  });

  it("conta o sinal de menos, que é meio dígito de largura e muda a leitura", () => {
    expect(larguraAproximada("−R$ 594")).toBeGreaterThan(
      larguraAproximada("R$ 594"),
    );
  });
});
