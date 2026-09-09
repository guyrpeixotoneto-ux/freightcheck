import { describe, expect, it } from "vitest";
import {
  contarFrotaPorQuinzena,
  ultimaQuinzenaMedida,
  unidadesSemRelatorio,
  type CompetenciaDaSerie,
  type PlacaReportada,
} from "../frota-quinzenal";

/**
 * A régua da série de frota, sobre material sintético.
 *
 * O que ela prende:
 *
 * - a contagem por situação, com placa distinta e não linha do arquivo;
 * - **quinzena sem relatório não é zero** — a contagem sai `null`, e o `null`
 *   atravessa total, percentual e variação sem virar queda no gráfico;
 * - a placa declarada nas duas situações conta nas duas e é reportada como
 *   contradição, em vez de arbitrada;
 * - a variação é sempre contra a quinzena imediatamente anterior da série.
 */

function quinzena(
  competencia: string,
  cobertura: { unidades: string[]; ativa: string[]; inativa: string[] },
): CompetenciaDaSerie {
  const [ano, mes] = competencia.split("-");
  return {
    competencia,
    ano: Number(ano),
    mes: Number(mes),
    quinzena: competencia.endsWith("Q1") ? 1 : 2,
    inicio: `${ano}-${mes}-01`,
    fim: `${ano}-${mes}-15`,
    cobertura: {
      unidades: cobertura.unidades,
      comFrotaAtiva: cobertura.ativa,
      comFrotaInativa: cobertura.inativa,
    },
  };
}

const COMPLETA = { unidades: ["443"], ativa: ["443"], inativa: ["443"] };

function placas(
  competencia: string,
  ativas: string[],
  inativas: string[],
  unidadeCodigo = "443",
): PlacaReportada[] {
  return [
    ...ativas.map((placa) => ({
      competencia,
      unidadeCodigo,
      placa,
      situacao: "ATIVA" as const,
    })),
    ...inativas.map((placa) => ({
      competencia,
      unidadeCodigo,
      placa,
      situacao: "INATIVA" as const,
    })),
  ];
}

describe("contarFrotaPorQuinzena", () => {
  it("conta ativos e parados por quinzena, e a variação contra a anterior", () => {
    const serie = contarFrotaPorQuinzena(
      [quinzena("2026-06-Q1", COMPLETA), quinzena("2026-06-Q2", COMPLETA)],
      [
        ...placas("2026-06-Q1", ["AAA1A11", "BBB2B22", "CCC3C33"], ["DDD4D44"]),
        ...placas("2026-06-Q2", ["AAA1A11", "BBB2B22"], ["CCC3C33", "DDD4D44"]),
      ],
    );

    expect(serie.quinzenas[0]).toMatchObject({
      ativos: 3,
      parados: 1,
      total: 4,
      percentualParado: 0.25,
      variacao: null,
    });
    expect(serie.quinzenas[1]).toMatchObject({
      ativos: 2,
      parados: 2,
      total: 4,
    });
    expect(serie.quinzenas[1]!.variacao).toMatchObject({
      contra: "2026-06-Q1",
      ativos: -1,
      parados: 1,
      total: 0,
      pontosDeParado: 25,
    });
  });

  it("a mesma placa em duas linhas conta uma vez", () => {
    const serie = contarFrotaPorQuinzena(
      [quinzena("2026-06-Q1", COMPLETA)],
      placas("2026-06-Q1", ["AAA1A11", "aaa-1a11", "BBB2B22"], []),
    );
    expect(serie.quinzenas[0]).toMatchObject({
      ativos: 2,
      parados: 0,
      total: 2,
    });
  });

  it("a placa declarada nas duas situações conta nas duas, e fica marcada", () => {
    const serie = contarFrotaPorQuinzena(
      [quinzena("2026-06-Q1", COMPLETA)],
      placas("2026-06-Q1", ["AAA1A11", "BBB2B22"], ["BBB2B22"]),
    );
    expect(serie.quinzenas[0]).toMatchObject({
      ativos: 2,
      parados: 1,
      total: 3,
      emAmbasAsSituacoes: 1,
    });
  });

  it("relatório que não veio é null, e não zero — nem no total, nem na variação", () => {
    const serie = contarFrotaPorQuinzena(
      [
        quinzena("2026-06-Q1", COMPLETA),
        quinzena("2026-06-Q2", {
          unidades: ["443"],
          ativa: ["443"],
          inativa: [],
        }),
      ],
      [
        ...placas("2026-06-Q1", ["AAA1A11", "BBB2B22"], ["CCC3C33"]),
        ...placas("2026-06-Q2", ["AAA1A11", "BBB2B22"], []),
      ],
    );

    const sem = serie.quinzenas[1]!;
    expect(sem.ativos).toBe(2);
    expect(sem.parados).toBeNull();
    expect(sem.total).toBeNull();
    expect(sem.percentualParado).toBeNull();
    expect(sem.variacao).toMatchObject({
      ativos: 0,
      parados: null,
      total: null,
      pontosDeParado: null,
    });
    expect(unidadesSemRelatorio(sem, "INATIVA")).toEqual(["443"]);
    expect(unidadesSemRelatorio(sem, "ATIVA")).toEqual([]);
  });

  it("zero medido é diferente de ausência: o relatório veio e não trouxe parado", () => {
    const serie = contarFrotaPorQuinzena(
      [quinzena("2026-06-Q1", COMPLETA)],
      placas("2026-06-Q1", ["AAA1A11"], []),
    );
    expect(serie.quinzenas[0]).toMatchObject({
      ativos: 1,
      parados: 0,
      total: 1,
      percentualParado: 0,
    });
  });

  it("soma as unidades do recorte na mesma coluna da quinzena", () => {
    const serie = contarFrotaPorQuinzena(
      [
        quinzena("2026-06-Q1", {
          unidades: ["443", "999"],
          ativa: ["443", "999"],
          inativa: ["443"],
        }),
      ],
      [
        ...placas("2026-06-Q1", ["AAA1A11"], ["CCC3C33"], "443"),
        ...placas("2026-06-Q1", ["BBB2B22"], [], "999"),
      ],
    );
    expect(serie.quinzenas[0]).toMatchObject({ ativos: 2, parados: 1 });
    expect(unidadesSemRelatorio(serie.quinzenas[0]!, "INATIVA")).toEqual([
      "999",
    ]);
  });

  it("a manchete é a última quinzena que mediu algo, e não a última aberta", () => {
    const serie = contarFrotaPorQuinzena(
      [
        quinzena("2026-06-Q1", COMPLETA),
        quinzena("2026-06-Q2", { unidades: ["443"], ativa: [], inativa: [] }),
      ],
      placas("2026-06-Q1", ["AAA1A11"], ["BBB2B22"]),
    );

    expect(serie.quinzenas[1]!.ativos).toBeNull();
    expect(ultimaQuinzenaMedida(serie)!.competencia).toBe("2026-06-Q1");
  });

  it("sem competência nenhuma, a série é vazia — e não uma quinzena zerada", () => {
    expect(contarFrotaPorQuinzena([], []).quinzenas).toEqual([]);
    expect(ultimaQuinzenaMedida({ quinzenas: [] })).toBeNull();
  });
});
