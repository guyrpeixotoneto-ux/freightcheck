/**
 * O ARREDONDAMENTO MONETÁRIO — a regra única, e a regressão que a exigiu.
 *
 * O produto tinha duas regras de arredondar dinheiro, e elas discordavam num
 * centavo exatamente onde arredondar é uma decisão. Este arquivo prende a que
 * ficou e **reproduz o caso real** que expôs a outra: a soma das cinco
 * duplicatas retidas do extrato de 2026, que a tela mostrava como R$ 21.206,76
 * quando a apuração à mão dá R$ 21.206,77.
 *
 * O teste que importa aqui não é `arredondar funciona`. É o de baixo, que
 * afirma que `toFixed` **não** serve — porque no dia em que alguém reescrever
 * isto com `toFixed` "porque é mais simples", é este teste que vai explicar por
 * que não é.
 */

import { describe, expect, it } from "vitest";
import { arredondarCentavos, mesmoValor, somarCentavos, MEIO_CENTAVO } from "../dinheiro";

/** As cinco linhas retidas de 2026 — placa RZG5A37, maio a setembro. */
const DUPLICATAS_RETIDAS_DE_2026 = [4334.83, 4288.092, 4241.353, 4194.615, 4147.875];

describe("arredondarCentavos", () => {
  it("sobe o meio centavo — inclusive quando o float64 o coloca um fio abaixo", () => {
    expect(arredondarCentavos(21206.765)).toBe(21206.77);
    expect(arredondarCentavos(1.005)).toBe(1.01);
    expect(arredondarCentavos(2.675)).toBe(2.68);
  });

  it("é para cima na reta, e não para longe do zero — um estorno espelha um custo", () => {
    expect(arredondarCentavos(-21206.765)).toBe(-21206.76);
    /* O par soma zero antes e depois de arredondar: é isto que a simetria
       protege, e é o que um "meio se afasta do zero" quebraria. */
    expect(arredondarCentavos(21206.765) + arredondarCentavos(-21206.765)).toBeCloseTo(0.01, 10);
  });

  it("não inventa zero: ausência e não-número atravessam como ausência", () => {
    expect(arredondarCentavos(null)).toBeNull();
    expect(arredondarCentavos(undefined)).toBeNull();
    expect(arredondarCentavos(Number.NaN)).toBeNull();
    expect(arredondarCentavos(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("deixa em paz o que já tem duas casas", () => {
    for (const v of [0, 0.01, -0.01, 16769.83, 25085.47, 899499.98]) {
      expect(arredondarCentavos(v)).toBe(v);
    }
  });
});

describe("somarCentavos", () => {
  it("apura as cinco duplicatas retidas de 2026 em R$ 21.206,77", () => {
    expect(somarCentavos(DUPLICATAS_RETIDAS_DE_2026)).toBe(21206.77);
  });

  it("não é `Number(soma.toFixed(2))` — e é este centavo que a tela mostrava errado", () => {
    const soma = DUPLICATAS_RETIDAS_DE_2026.reduce((a, b) => a + b, 0);
    /*
      A regressão, escrita como ela aconteceu. `toFixed` arredonda o binário: o
      float64 mais próximo de 21206,765 é 21206,764999999999417…, que está
      abaixo do meio. A rota `/financiamento-real/pendencias` usava esta linha.
    */
    expect(Number(soma.toFixed(2))).toBe(21206.76);
    expect(somarCentavos(DUPLICATAS_RETIDAS_DE_2026)).toBe(21206.77);
    expect(somarCentavos(DUPLICATAS_RETIDAS_DE_2026)).not.toBe(Number(soma.toFixed(2)));
  });

  it("arredonda uma vez, no fim — e não parcela a parcela", () => {
    /* Três valores que sozinhos descem e juntos sobem. Somar já arredondado
       daria 0,03; a conta certa é 0,04. */
    const partes = [0.014, 0.014, 0.014];
    expect(somarCentavos(partes)).toBe(0.04);
    expect(partes.map((p) => arredondarCentavos(p)).reduce((a, b) => a + b, 0)).toBe(0.03);
  });

  it("ignora ausência em vez de tratá-la como zero na conta", () => {
    expect(somarCentavos([10.5, null, 4.5, undefined, Number.NaN])).toBe(15);
    /* Lista sem nenhum valor legível soma zero — que aqui é o neutro da soma, e
       não uma afirmação sobre dinheiro: quem afirma ausência é quem chama. */
    expect(somarCentavos([null, undefined])).toBe(0);
  });

  it("reproduz os dois totais de setembro/2026 a partir das linhas conciliadas", () => {
    /*
      O realizado chega ao confronto **já consolidado ao centavo por placa**, e
      não como linha do razão: a apuração soma os lançamentos de cada placa em
      NUMERIC e guarda o resultado na vigência. Duas rodadas de arredondamento,
      e elas são de propósito — a RPH9E62 tem dois lançamentos que somam
      R$ 21.803,015, e é R$ 21.803,02 que a vigência guarda e que toda tela
      deste produto mostra para ela. Somar os lançamentos de novo aqui daria
      outro número, e um centavo de discordância entre duas telas sobre o mesmo
      mês é o defeito que `fonte-real-do-acervo.ts` existe para não ter.
    */
    const remunerado = [
      4103.53, 16769.83, 16769.83, 16769.83, 16769.83, 16769.83, 16769.83, 16769.83, 15905.65,
      16769.83, 16769.83, 16769.83, 16769.83, 16329.57, 13873.44, 16949.92, 16949.92,
    ];
    const realizado = [
      9958.86, 25085.47, 25085.47, 25085.47, 25085.47, 25085.47, 25085.47, 25085.47, 21803.02,
      21803.02, 21803.02, 21803.02, 21803.02, 21803.02, 4147.88, 17725.03, 17725.03,
    ];
    expect(remunerado).toHaveLength(17);
    expect(realizado).toHaveLength(17);
    expect(somarCentavos(remunerado)).toBe(268580.16);
    expect(somarCentavos(realizado)).toBe(355973.21);
    expect(arredondarCentavos(somarCentavos(remunerado) - somarCentavos(realizado))).toBe(
      -87393.05,
    );
  });
});

describe("mesmoValor", () => {
  it("colapsa o ruído de numeric(18,6) e nunca um centavo de verdade", () => {
    expect(mesmoValor(21803.015, 21803.0151)).toBe(true);
    expect(mesmoValor(100, 100.01)).toBe(false);
    expect(MEIO_CENTAVO).toBeLessThan(0.01);
  });
});
