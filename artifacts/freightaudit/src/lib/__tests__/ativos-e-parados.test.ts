import { describe, expect, it } from "vitest";
import {
  avisoDeCobertura,
  comSinal,
  numeroOuTraco,
  percentual,
  pontosDoGrafico,
  rotuloCurto,
  rotuloLongo,
  sentido,
  ultimaMedida,
  unidadesSemRelatorio,
  type QuinzenaDaFrota,
} from "../ativos-e-parados";

/**
 * A apresentação de Ativos e Parados, sem componente e sem servidor.
 *
 * O que ela prende é o que dá errado calado nesta tela: um `null` renderizado
 * como `0` — no número, no gráfico, na variação —, e o mês 1-indexado do banco
 * escrito com o rótulo do mês anterior.
 */

function quinzena(parcial: Partial<QuinzenaDaFrota> = {}): QuinzenaDaFrota {
  return {
    competencia: "2026-07-Q2",
    ano: 2026,
    mes: 7,
    quinzena: 2,
    inicio: "2026-07-16",
    fim: "2026-07-31",
    ativos: 118,
    parados: 12,
    total: 130,
    percentualParado: 12 / 130,
    emAmbasAsSituacoes: 0,
    cobertura: {
      unidades: ["443"],
      comFrotaAtiva: ["443"],
      comFrotaInativa: ["443"],
    },
    variacao: null,
    ...parcial,
  };
}

describe("rótulos", () => {
  it("escreve o mês certo — o banco é 1-indexado e o vetor não", () => {
    expect(rotuloCurto({ mes: 7, ano: 2026, quinzena: 2 })).toBe(
      "jul/26 · 2ªq",
    );
    expect(rotuloLongo({ mes: 1, ano: 2026, quinzena: 1 })).toBe(
      "jan/2026, 1ª quinzena",
    );
    expect(rotuloLongo({ mes: 12, ano: 2026, quinzena: 2 })).toBe(
      "dez/2026, 2ª quinzena",
    );
  });
});

describe("números", () => {
  it("ausência é travessão, e zero é zero", () => {
    expect(numeroOuTraco(null)).toBe("—");
    expect(numeroOuTraco(0)).toBe("0");
    expect(numeroOuTraco(1234)).toBe("1.234");
  });

  it("percentual ausente não vira 0%", () => {
    expect(percentual(null)).toBe("—");
    expect(percentual(0)).toBe("0%");
    expect(percentual(0.125)).toBe("12,5%");
  });

  it("a variação carrega o sinal, e a ausência não vira número", () => {
    expect(comSinal(3)).toBe("+3");
    expect(comSinal(-2)).toBe("-2");
    expect(comSinal(0)).toBe("0");
    expect(comSinal(null)).toBeNull();
  });

  it("o sentido separa ausência de estabilidade", () => {
    expect(sentido(null)).toBe("semDado");
    expect(sentido(0)).toBe("igual");
    expect(sentido(1)).toBe("subiu");
    expect(sentido(-1)).toBe("desceu");
  });
});

describe("cobertura", () => {
  it("não avisa nada quando as duas fontes vieram de todas as unidades", () => {
    expect(avisoDeCobertura(quinzena())).toBeNull();
  });

  it("nomeia a unidade e o relatório que faltou", () => {
    const sem = quinzena({
      parados: null,
      total: null,
      percentualParado: null,
      cobertura: {
        unidades: ["443", "999"],
        comFrotaAtiva: ["443", "999"],
        comFrotaInativa: ["443"],
      },
    });

    expect(unidadesSemRelatorio(sem, "INATIVA")).toEqual(["999"]);
    expect(unidadesSemRelatorio(sem, "ATIVA")).toEqual([]);
    expect(avisoDeCobertura(sem)).toContain("a frota parada de 999");
    expect(avisoDeCobertura(sem)).toContain("não é zero");
  });
});

describe("a série na tela", () => {
  it("o gráfico recebe null, e não zero — é o que apaga a barra", () => {
    const pontos = pontosDoGrafico([
      quinzena({
        competencia: "2026-07-Q1",
        quinzena: 1,
        ativos: 100,
        parados: 10,
      }),
      quinzena({ competencia: "2026-07-Q2", parados: null }),
    ]);

    expect(pontos[0]).toMatchObject({
      rotulo: "jul/26 · 1ªq",
      ativos: 100,
      parados: 10,
    });
    expect(pontos[1]!.parados).toBeNull();
  });

  it("a manchete é a última quinzena medida, e não a última aberta", () => {
    const serie = [
      quinzena({ competencia: "2026-07-Q1", quinzena: 1 }),
      quinzena({
        competencia: "2026-07-Q2",
        ativos: null,
        parados: null,
        total: null,
        percentualParado: null,
        cobertura: {
          unidades: ["443"],
          comFrotaAtiva: [],
          comFrotaInativa: [],
        },
      }),
    ];

    expect(ultimaMedida(serie)!.competencia).toBe("2026-07-Q1");
    expect(ultimaMedida([])).toBeNull();
  });
});
