import { describe, expect, it } from "vitest";
import { lerOverview } from "../linha-do-tempo-consolidada";
import type { RangeOverview } from "@/lib/analise";

/**
 * A tradução de `/changes/range/overview` para o que a Linha do Tempo desenha.
 *
 * É a única conta que a Visão Geral faz no navegador, e por isso a única que
 * pode fazer a tela discordar do servidor. Dois riscos concretos: somar o
 * placar a partir da série (que perderia a apuração por unidade que o motor já
 * fez) e entregar a evolução na ordem errada — a janela da linha do tempo
 * pagina do mais antigo para o mais recente e mostraria o histórico de trás
 * para a frente sem reclamar.
 */
const overview: RangeOverview = {
  from: "2026-06-02",
  fromLabel: "02/06/2026",
  to: "2026-08-02",
  toLabel: "02/08/2026",
  unitsIncluded: [
    {
      unidade: "pernambuco",
      label: "PERNAMBUCO",
      contexts: [{ scopeHash: "h-pe", channel: "EMPURRADA", latestPeriod: "2026-08-02" }],
      impact: { byPeriodicity: { ANUAL: -213_006 } },
      gainsByPeriodicity: { ANUAL: 93_454 },
      lossesByPeriodicity: { ANUAL: -306_460 },
      changes: 1_286,
      vehiclesTouched: 203,
      notCalculable: 1_092,
    },
    {
      unidade: "camacari",
      label: "CAMAÇARI",
      contexts: [{ scopeHash: "h-ca", channel: "EMPURRADA", latestPeriod: "2026-08-02" }],
      impact: { byPeriodicity: { ANUAL: -144_875 } },
      gainsByPeriodicity: { ANUAL: 10_000 },
      lossesByPeriodicity: { ANUAL: -154_875 },
      changes: 400,
      vehiclesTouched: 97,
      notCalculable: 8,
    },
  ],
  unitsExcluded: [],
  serie: [
    {
      period: "2026-07-01",
      label: "01/07/2026",
      byPeriodicity: { ANUAL: { gains: 0, losses: -302_261 } },
      changes: 714,
      impact: { byPeriodicity: { ANUAL: -302_261 }, notCalculable: 610 },
      porUnidade: [
        {
          unidade: "pernambuco",
          label: "PERNAMBUCO",
          changes: 500,
          impact: { byPeriodicity: { ANUAL: -200_000 }, notCalculable: 600 },
        },
        {
          unidade: "camacari",
          label: "CAMAÇARI",
          changes: 214,
          impact: { byPeriodicity: { ANUAL: -102_261 }, notCalculable: 10 },
        },
      ],
    },
    {
      period: "2026-08-02",
      label: "02/08/2026",
      byPeriodicity: { ANUAL: { gains: 89_255, losses: 0 } },
      changes: 102,
      impact: { byPeriodicity: { ANUAL: 89_255 }, notCalculable: 95 },
      porUnidade: [],
    },
  ],
};

describe("lerOverview", () => {
  it("o placar é a soma das unidades, não da série", () => {
    const { resumo } = lerOverview(overview);
    expect(resumo.impact.byPeriodicity.ANUAL).toBeCloseTo(-357_881, 2);
    expect(resumo.impact.notCalculable).toBe(1_100);
    expect(resumo.gainsByPeriodicity.ANUAL).toBeCloseTo(103_454, 2);
    expect(resumo.lossesByPeriodicity.ANUAL).toBeCloseTo(-461_335, 2);
    expect(resumo.totals.changes).toBe(1_686);
    expect(resumo.totals.vehiclesTouched).toBe(300);
  });

  it("a evolução vem da série, da mais antiga para a mais recente", () => {
    const { linhas } = lerOverview(overview);
    expect(linhas.map((l) => l.period)).toEqual(["2026-07-01", "2026-08-02"]);
    expect(linhas[0].changes).toBe(714);
    expect(linhas[0].impact).toEqual({ byPeriodicity: { ANUAL: -302_261 }, notCalculable: 610 });
  });

  it("as periodicidades saem da série, e o intervalo consolidado não tem lacunas a nomear", () => {
    const { periodicidades, resumo } = lerOverview(overview);
    expect(periodicidades).toEqual(["ANUAL"]);
    // Vigência sem comparação é conceito de uma unidade só — ver `lerOverview`.
    expect(resumo.gaps).toEqual([]);
  });

  it("um intervalo sem unidade incluída não inventa número nenhum", () => {
    const { resumo, linhas, periodicidades } = lerOverview({
      ...overview,
      unitsIncluded: [],
      serie: [],
    });
    expect(resumo.impact.byPeriodicity).toEqual({});
    expect(resumo.totals.changes).toBe(0);
    expect(linhas).toEqual([]);
    expect(periodicidades).toEqual([]);
  });
});
