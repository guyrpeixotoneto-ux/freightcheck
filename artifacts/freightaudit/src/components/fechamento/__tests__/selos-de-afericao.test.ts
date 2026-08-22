import { describe, expect, it } from "vitest";

import { faixa, percentual } from "../selos-de-afericao";

/**
 * OS SELOS — o que a tela decide sobre um número que ela não calcula.
 *
 * Os dois percentuais vêm prontos do servidor, e é lá que eles são provados
 * (`afericao.test.ts`). O que sobra para esta tela são duas decisões de leitura,
 * e as duas já erraram em produtos parecidos:
 *
 * 1. **Razão sem denominador não é zero.** Um canal cujo painel ninguém
 *    transcreveu não tem precisão ruim — tem precisão indefinida. Mostrar
 *    `0,0%` ali afirmaria que a conta está errada quando ninguém a fez, e as
 *    duas afirmações pedem coisas opostas de quem lê.
 * 2. **A cor é categórica, não gradiente.** Quem varre a tela precisa de três
 *    faixas legíveis; um verde que escurece devagar não é leitura, é decoração.
 */

describe("um percentual que não existe não é zero por cento", () => {
  it("`null` vira traço", () => {
    expect(percentual(null)).toBe("—");
  });

  it("zero vira zero — que é uma afirmação, e diferente de traço", () => {
    expect(percentual(0)).toBe("0,0%");
  });

  it("escreve com uma casa e vírgula, como o resto da tela escreve número", () => {
    expect(percentual(0.99127)).toBe("99,1%");
    expect(percentual(1)).toBe("100,0%");
  });
});

describe("a faixa que decide a cor", () => {
  it("sem medida é a sua própria faixa, e não a pior delas", () => {
    /* Cinza, não vermelho: não medido e medido mal são coisas diferentes. */
    expect(faixa(null)).toBe("SEM_MEDIDA");
  });

  it("os cortes são 99% e 90%", () => {
    expect(faixa(0.9913)).toBe("BOA");
    expect(faixa(0.99)).toBe("BOA");
    expect(faixa(0.9899)).toBe("ATENCAO");
    expect(faixa(0.9)).toBe("ATENCAO");
    expect(faixa(0.8999)).toBe("BAIXA");
    expect(faixa(0)).toBe("BAIXA");
  });

  it("os mesmos cortes valem para os dois selos", () => {
    /*
      Precisão e lastro são a mesma grandeza — fração do dinheiro do fechamento
      —, e cortes diferentes fariam a mesma cor significar coisas diferentes em
      dois selos lado a lado. Por isso `faixa` não recebe qual selo é.
    */
    expect(faixa.length).toBe(1);
  });
});
