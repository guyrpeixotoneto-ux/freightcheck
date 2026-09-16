import { describe, expect, it } from "vitest";
import {
  corDaCelula,
  LEITURA_DE_CUSTO,
  type CelulaDaPlaca,
} from "../evolucao-por-placa";

/**
 * A LEITURA DA MATRIZ — o mesmo sinal, dois idiomas.
 *
 * O sinal do impacto é a **direção do valor**, e não um juízo. Medido na base
 * real: `cavalo.finame_cavalo` indo de R$ 10.578,03 para R$ 0 — um
 * financiamento quitado — grava `impact_amount = −10.578,03`.
 *
 * Numa rubrica de remuneração, negativo é menos dinheiro entrando: perda,
 * vermelho. Numa de custo, negativo é menos dinheiro saindo: economia, verde.
 * A matriz nasceu falando só o primeiro idioma, e a Evolução anual do FINAME
 * pintava de vermelho, sob a palavra "Perda", a parcela que acabara de ser
 * quitada — enquanto o cartão acima pintava o mesmo número de verde.
 *
 * O que estes casos prendem é que a tradução é de **cor e nome**, e nunca de
 * número: inverter o valor seria a tela discordando do domínio.
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

describe("sem leitura, a matriz fala remuneração — como sempre falou", () => {
  it("negativo é a cor ruim e positivo é a boa", () => {
    expect(corDaCelula(celula(-10578.03))).toBe("perda");
    expect(corDaCelula(celula(818))).toBe("ganho");
  });
});

describe("com a leitura de custo, o mesmo sinal troca de lado", () => {
  it("um financiamento quitado é economia, e não perda", () => {
    /* O caso real: R$ 10.578,03 → R$ 0, impacto −10.578,03. */
    expect(corDaCelula(celula(-10578.03), LEITURA_DE_CUSTO)).toBe("ganho");
  });

  it("uma parcela que subiu é a direção ruim", () => {
    expect(corDaCelula(celula(16769.83), LEITURA_DE_CUSTO)).toBe("perda");
  });

  it("é exatamente o inverso da leitura de remuneração, valor a valor", () => {
    for (const net of [-10578.03, -1, 1, 818, 16769.83]) {
      const remuneracao = corDaCelula(celula(net));
      const custo = corDaCelula(celula(net), LEITURA_DE_CUSTO);
      expect(custo, `net=${net}`).not.toBe(remuneracao);
    }
  });
});

describe("o que a leitura não pode fazer", () => {
  it("não inventa cor para o que não tem valoração", () => {
    expect(corDaCelula(celula(null))).toBe("sem-valoracao");
    expect(corDaCelula(celula(null), LEITURA_DE_CUSTO)).toBe("sem-valoracao");
  });

  it("não transforma ausência em zero, nem zero em direção", () => {
    expect(corDaCelula(undefined)).toBe("sem-alteracao");
    expect(corDaCelula(undefined, LEITURA_DE_CUSTO)).toBe("sem-alteracao");
    /* Zero é zero nos dois idiomas: não é economia e não é aumento. */
    expect(corDaCelula(celula(0))).toBe("sem-alteracao");
    expect(corDaCelula(celula(0), LEITURA_DE_CUSTO)).toBe("sem-alteracao");
  });

  it("nomeia as duas direções sem prometer um juízo que o número não tem", () => {
    expect(LEITURA_DE_CUSTO.positivo).toBe("Aumento de custo");
    expect(LEITURA_DE_CUSTO.negativo).toBe("Redução de custo");
    expect(LEITURA_DE_CUSTO.subirEhRuim).toBe(true);
  });
});
