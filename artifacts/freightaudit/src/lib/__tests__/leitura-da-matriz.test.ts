import { describe, expect, it } from "vitest";
import { corDaCelula, type CelulaDaPlaca } from "../evolucao-por-placa";

/**
 * A COR DA CÉLULA — um idioma só, e é o de quem recebe.
 *
 * O sinal do impacto é a **direção do valor**, e tudo que o FreightCheck mede é
 * a tabela de frete que a transportadora recebe — o FINAME incluído. Medido na
 * base real: `cavalo.finame_cavalo` indo de R$ 10.578,03 para R$ 0 grava
 * `impact_amount = −10.578,03`, e é isso que deixa de entrar.
 *
 * Existiu aqui uma "leitura de custo" que invertia a cor do FINAME, na hipótese
 * de que uma parcela menor fosse economia da casa. Estes casos prendem o que
 * ficou no lugar dela: negativo é perda em toda rubrica, e nenhuma tela inverte
 * a cor de um número que o domínio já assinou.
 */

const celula = (net: number | null): CelulaDaPlaca =>
  ({
    period: "2026-08-01",
    label: "agosto/2026",
    estado: net === null ? "SEM_VALORACAO" : "VALORADA",
    alteracoes: 1,
    valoradas: net === null ? 0 : 1,
    semValoracao: net === null ? 1 : 0,
    foraDoTotal: 0,
    outraPeriodicidade: 0,
    ganho: net !== null && net > 0 ? net : 0,
    perda: net !== null && net < 0 ? net : 0,
    net,
    rubricas: [],
  }) as CelulaDaPlaca;

describe("negativo é a cor ruim, e positivo é a boa", () => {
  it("vale para qualquer valor, inclusive o FINAME", () => {
    /* O caso real: R$ 10.578,03 → R$ 0, impacto −10.578,03 — menos dinheiro
       entrando, e não economia. */
    expect(corDaCelula(celula(-10578.03))).toBe("perda");
    expect(corDaCelula(celula(16769.83))).toBe("ganho");
    expect(corDaCelula(celula(818))).toBe("ganho");
    expect(corDaCelula(celula(-1))).toBe("perda");
  });
});

describe("o que a cor não pode fazer", () => {
  it("não inventa cor para o que não tem valoração", () => {
    expect(corDaCelula(celula(null))).toBe("sem-valoracao");
  });

  it("não transforma ausência em zero, nem zero em direção", () => {
    expect(corDaCelula(undefined)).toBe("sem-alteracao");
    /* Zero não é ganho nem perda: não houve movimento, e não há direção. */
    expect(corDaCelula(celula(0))).toBe("sem-alteracao");
  });
});
