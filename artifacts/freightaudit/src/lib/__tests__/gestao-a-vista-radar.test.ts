import { describe, expect, it } from "vitest";
import {
  atributosDaCelula,
  intensidadeDaCelula,
  janelaDoRadar,
  maiorImpactoDaGrade,
  montarRadar,
  periodicidadesDoRadar,
  resumoDoRadar,
  type UnidadeDoRadar,
} from "../gestao-a-vista-radar";
import type { Movimentos, RangeEntry } from "@/lib/analise";

/** Um `/changes/range` com só o que o Radar lê: movimentos e lacunas. */
function movimentos(
  linhas: {
    period: string;
    changes: number;
    impact?: Record<string, number>;
    notCalculable?: number;
  }[],
  lacunas: string[] = [],
): Movimentos {
  return {
    movements: linhas.map((l) => ({
      period: l.period,
      label: l.period,
      comparisons: 1,
      changes: l.changes,
      vehicles: l.changes,
      impact: { byPeriodicity: l.impact ?? {}, notCalculable: l.notCalculable ?? 0 },
    })),
    gaps: lacunas.map((period) => ({ period, label: period, reason: "sem comparação" })),
  } as unknown as Movimentos;
}

function unidade(
  nome: string,
  ...leituras: (Movimentos | null)[]
): UnidadeDoRadar {
  return {
    unidade: nome,
    label: nome,
    contextos: leituras.map((_, i) => ({ scopeHash: `${nome}-${i}`, canal: null })),
    movimentos: leituras,
  };
}

describe("janelaDoRadar", () => {
  const serie = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];

  it("pede o intervalo a partir da vigência anterior à primeira coluna", () => {
    // `/changes/range` conta as transições que vão de `from` até `to`: sem a
    // vigência anterior no `from`, a primeira coluna nasceria vazia.
    expect(janelaDoRadar(serie, "2026-05", 3)).toEqual({
      from: "2026-02",
      to: "2026-05",
      periodos: ["2026-03", "2026-04", "2026-05"],
    });
  });

  it("com o histórico inteiro dentro da janela, parte da primeira vigência", () => {
    expect(janelaDoRadar(serie, "2026-05", 9)).toEqual({
      from: "2026-01",
      to: "2026-05",
      periodos: serie,
    });
  });

  it("respeita a vigência escolhida como fim da janela", () => {
    expect(janelaDoRadar(serie, "2026-03", 2)).toEqual({
      from: "2026-01",
      to: "2026-03",
      periodos: ["2026-02", "2026-03"],
    });
  });

  it("sem vigência nenhuma, não há janela a pedir", () => {
    expect(janelaDoRadar([], null)).toEqual({ from: null, to: null, periodos: [] });
  });
});

describe("periodicidadesDoRadar", () => {
  it("ordena pelo módulo do total, não pelo sinal", () => {
    const unidades = [
      unidade("A", movimentos([{ period: "2026-02", changes: 2, impact: { MENSAL: 500 } }])),
      unidade("B", movimentos([{ period: "2026-02", changes: 3, impact: { ANUAL: -9000 } }])),
    ];
    expect(periodicidadesDoRadar(unidades)).toEqual(["ANUAL", "MENSAL"]);
  });

  it("sem impacto apurado, não há periodicidade a oferecer", () => {
    expect(periodicidadesDoRadar([unidade("A", movimentos([{ period: "2026-02", changes: 4 }]))])).toEqual(
      [],
    );
  });
});

describe("montarRadar", () => {
  const periodos = ["2026-01", "2026-02", "2026-03"];

  it("distingue sem vigência, sem comparação e apurado com zero", () => {
    const linhas = montarRadar(
      periodos,
      [unidade("A", movimentos([{ period: "2026-03", changes: 0 }], ["2026-02"]))],
      "MENSAL",
    );
    expect(linhas[0].celulas.map((c) => c.estado)).toEqual([
      "sem-vigencia",
      "sem-comparacao",
      "apurado",
    ]);
    expect(linhas[0].celulas[2].alteracoes).toBe(0);
  });

  it("só lê a periodicidade escolhida — R$/mês nunca vira R$/ano", () => {
    const linhas = montarRadar(
      periodos,
      [
        unidade(
          "A",
          movimentos([{ period: "2026-03", changes: 2, impact: { MENSAL: -1200, ANUAL: -30000 } }]),
        ),
      ],
      "MENSAL",
    );
    expect(linhas[0].celulas[2].impacto).toBe(-1200);
    expect(linhas[0].totalDeImpacto).toBe(-1200);
  });

  it("soma os contextos da mesma unidade numa linha só", () => {
    const linhas = montarRadar(
      periodos,
      [
        unidade(
          "A",
          movimentos([{ period: "2026-03", changes: 2, impact: { MENSAL: -1000 }, notCalculable: 1 }]),
          movimentos([{ period: "2026-03", changes: 3, impact: { MENSAL: -500 }, notCalculable: 2 }]),
        ),
      ],
      "MENSAL",
    );
    expect(linhas[0].celulas[2]).toMatchObject({
      alteracoes: 5,
      impacto: -1500,
      semApuracao: 3,
    });
  });

  it("um contexto que ainda não respondeu não vira zero apurado", () => {
    const linhas = montarRadar(periodos, [unidade("A", null)], "MENSAL");
    expect(linhas[0].celulas.every((c) => c.estado === "sem-vigencia")).toBe(true);
    expect(linhas[0].totalDeAlteracoes).toBe(0);
  });

  it("ordena por módulo de impacto, e o volume desempata", () => {
    const linhas = montarRadar(
      periodos,
      [
        unidade("CALMA", movimentos([{ period: "2026-02", changes: 9, impact: { MENSAL: 0 } }])),
        unidade("PESADA", movimentos([{ period: "2026-02", changes: 1, impact: { MENSAL: -8000 } }])),
        unidade("MEDIA", movimentos([{ period: "2026-02", changes: 2, impact: { MENSAL: 300 } }])),
      ],
      "MENSAL",
    );
    expect(linhas.map((l) => l.label)).toEqual(["PESADA", "MEDIA", "CALMA"]);
  });

  it("unidade sem nenhuma vigência na janela continua na grade", () => {
    const linhas = montarRadar(periodos, [unidade("A", movimentos([]))], "MENSAL");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].totalDeAlteracoes).toBe(0);
  });
});

describe("resumoDoRadar", () => {
  it("conta unidades afetadas, não unidades na grade", () => {
    const linhas = montarRadar(
      ["2026-02"],
      [
        unidade("A", movimentos([{ period: "2026-02", changes: 3, impact: { MENSAL: -900 }, notCalculable: 2 }])),
        unidade("B", movimentos([{ period: "2026-02", changes: 0 }])),
        unidade("C", movimentos([])),
      ],
      "MENSAL",
    );
    expect(resumoDoRadar(linhas)).toEqual({
      alteracoes: 3,
      unidadesAfetadas: 1,
      impacto: -900,
      semApuracao: 2,
    });
  });
});

describe("intensidade da grade", () => {
  it("a escala é o maior módulo de impacto de uma célula", () => {
    const linhas = montarRadar(
      ["2026-01", "2026-02"],
      [
        unidade(
          "A",
          movimentos([
            { period: "2026-01", changes: 1, impact: { MENSAL: -2000 } },
            { period: "2026-02", changes: 40, impact: { MENSAL: 500 } },
          ]),
        ),
      ],
      "MENSAL",
    );
    const maior = maiorImpactoDaGrade(linhas);
    expect(maior).toBe(2000);
    expect(intensidadeDaCelula(-2000, maior)).toBe(1);
    expect(intensidadeDaCelula(500, maior)).toBe(0.25);
  });

  it("sem impacto apurado nenhum, ninguém acende — nem a célula com mais alterações", () => {
    expect(intensidadeDaCelula(0, 0)).toBe(0);
    expect(maiorImpactoDaGrade([])).toBe(0);
  });
});

/** Um `/changes/range` com só o que a abertura de célula lê: as entradas. */
function comEntradas(
  entradas: {
    period: string;
    parameterKey: string;
    amount?: number | null;
    periodicity?: string | null;
  }[],
): Movimentos {
  return {
    movements: [],
    gaps: [],
    entries: entradas.map((e, i) => ({
      key: `${e.parameterKey}-${i}`,
      period: e.period,
      periodLabel: e.period,
      parameterKey: e.parameterKey,
      parameterName: e.parameterKey,
      family: "REMUNERACAO",
      attributeCode: null,
      amount: e.amount === undefined ? null : e.amount,
      periodicity: e.periodicity === undefined ? "MENSAL" : e.periodicity,
    })) as unknown as RangeEntry[],
  } as unknown as Movimentos;
}

describe("atributosDaCelula", () => {
  it("separa os lados do impacto e ordena pelo módulo", () => {
    const abertura = atributosDaCelula(
      unidade(
        "A",
        comEntradas([
          { period: "2026-02", parameterKey: "pedagio", amount: -300 },
          { period: "2026-02", parameterKey: "diesel", amount: -5000 },
          { period: "2026-02", parameterKey: "bonus", amount: 900 },
        ]),
      ),
      "2026-02",
      "MENSAL",
    );

    expect(abertura.desfavoraveis.map((a) => a.parameterKey)).toEqual(["diesel", "pedagio"]);
    expect(abertura.favoraveis.map((a) => a.parameterKey)).toEqual(["bonus"]);
    expect(abertura.impacto).toBe(-4400);
  });

  it("não deixa vazar entrada de outra vigência para dentro da célula", () => {
    const abertura = atributosDaCelula(
      unidade(
        "A",
        comEntradas([
          { period: "2026-01", parameterKey: "diesel", amount: -9000 },
          { period: "2026-02", parameterKey: "diesel", amount: -100 },
        ]),
      ),
      "2026-02",
      "MENSAL",
    );

    expect(abertura.impacto).toBe(-100);
    expect(abertura.desfavoraveis[0].alteracoes).toBe(1);
  });

  it("soma os canais da unidade, porque a célula clicada é a soma deles", () => {
    const abertura = atributosDaCelula(
      unidade(
        "A",
        comEntradas([{ period: "2026-02", parameterKey: "diesel", amount: -1000 }]),
        comEntradas([{ period: "2026-02", parameterKey: "diesel", amount: -500 }]),
      ),
      "2026-02",
      "MENSAL",
    );

    expect(abertura.desfavoraveis).toHaveLength(1);
    expect(abertura.desfavoraveis[0].impacto).toBe(-1500);
    expect(abertura.desfavoraveis[0].alteracoes).toBe(2);
  });

  it("sem preço não vira zero — o atributo aparece com a contagem que tem", () => {
    const abertura = atributosDaCelula(
      unidade(
        "A",
        comEntradas([
          { period: "2026-02", parameterKey: "manutencao", amount: null },
          { period: "2026-02", parameterKey: "manutencao", amount: null },
        ]),
      ),
      "2026-02",
      "MENSAL",
    );

    expect(abertura.favoraveis).toEqual([]);
    expect(abertura.desfavoraveis).toEqual([]);
    expect(abertura.semDinheiro[0]).toMatchObject({
      parameterKey: "manutencao",
      alteracoes: 2,
      semApuracao: 2,
      impacto: 0,
    });
  });

  it("dinheiro de outra periodicidade fica de fora da soma e dito na linha", () => {
    // A grade inteira é desenhada numa periodicidade de cada vez: somar o
    // anual aqui seria o mesmo erro que `montarRadar` recusa na célula.
    const abertura = atributosDaCelula(
      unidade(
        "A",
        comEntradas([
          { period: "2026-02", parameterKey: "seguro", amount: -12000, periodicity: "ANUAL" },
        ]),
      ),
      "2026-02",
      "MENSAL",
    );

    expect(abertura.impacto).toBe(0);
    expect(abertura.semDinheiro[0]).toMatchObject({
      parameterKey: "seguro",
      alteracoes: 1,
      outraPeriodicidade: 1,
      semApuracao: 0,
    });
  });

  it("sem periodicidade escolhida, nenhuma entrada entra na soma", () => {
    const abertura = atributosDaCelula(
      unidade("A", comEntradas([{ period: "2026-02", parameterKey: "diesel", amount: -1000 }])),
      "2026-02",
      null,
    );

    expect(abertura.impacto).toBe(0);
    expect(abertura.semDinheiro).toHaveLength(1);
  });
});
