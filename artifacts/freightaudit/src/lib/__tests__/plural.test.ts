import { describe, expect, it } from "vitest";
import { comPlural, plural } from "@/lib/format";

/**
 * A concordância do substantivo com o número.
 *
 * Existe porque a tela escrevia "1 placas" — e a razão de isso ter durado é que
 * ninguém repara num plural errado lendo código: `${n} placas` parece certo até
 * `n` valer um. Este arquivo é o lugar onde ele para de passar.
 *
 * Numa tela de auditoria isso pesa mais do que parece: quem lê "1 placas" passa
 * a duvidar dos números pelo mesmo motivo que duvidaria de uma soma malfeita —
 * o texto é a única evidência de cuidado que a pessoa tem à mão.
 */

describe("plural", () => {
  it("usa o singular só no um", () => {
    expect(plural(1, "placa", "placas")).toBe("placa");
    expect(plural(2, "placa", "placas")).toBe("placas");
  });

  /*
    Zero é plural em português — "0 divergentes", e não "0 divergente". É o
    caso mais comum destes rodapés, e o que uma regra ingênua (`n > 1`) erraria
    em toda tela conciliada.
  */
  it("trata zero como plural, como a língua trata", () => {
    expect(plural(0, "divergente", "divergentes")).toBe("divergentes");
  });

  /*
    As duas formas são escritas, e não derivadas por sufixo: nenhuma regra de
    corte de letra cobre "nomeia/nomeiam", que é justamente um dos usos desta
    tela.
  */
  it("serve a irregular, e não só a plural com s", () => {
    expect(plural(1, "nomeia", "nomeiam")).toBe("nomeia");
    expect(plural(6, "nomeia", "nomeiam")).toBe("nomeiam");
  });
});

describe("comPlural", () => {
  it("junta o número formatado ao substantivo concordado", () => {
    expect(comPlural(1, "placa", "placas")).toBe("1 placa");
    expect(comPlural(22, "placa", "placas")).toBe("22 placas");
  });

  /*
    O separador de milhar continua sendo o de `formatNumber` — um número de
    quatro dígitos numa tela em português se escreve "3.247", e escapar disso
    aqui criaria duas grafias do mesmo número na mesma tela.
  */
  it("mantém a grafia de número da casa", () => {
    expect(comPlural(3247, "chamado", "chamados")).toBe("3.247 chamados");
  });

  it("respeita as casas decimais quando pedidas", () => {
    expect(comPlural(1.5, "hora", "horas", 1)).toBe("1,5 horas");
  });
});
