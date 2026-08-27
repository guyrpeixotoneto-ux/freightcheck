import { describe, expect, it } from "vitest";
import {
  intensidadeDaCelula,
  janelaDoRadar,
  maiorImpactoDaGrade,
  montarRadar,
  periodicidadesDoRadar,
  resumoDoRadar,
  type UnidadeDoRadar,
} from "../gestao-a-vista-radar";
import type { Movimentos } from "@/lib/analise";

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
