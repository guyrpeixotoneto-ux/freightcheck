import { describe, expect, it } from "vitest";
import {
  INTERVALO_PADRAO_SEGUNDOS,
  lerIntervaloSegundos,
  montarSequenciaDoAutoplay,
} from "../gestao-a-vista-autoplay";
import type { ExecutiveSummary, FamiliesOverview } from "@/components/inicio/types";

function resumo(amount: number): ExecutiveSummary {
  return {
    changes: 1,
    vehiclesTouched: 1,
    impact: { byPeriodicity: { MENSAL: amount } },
    sides: [],
    topParameters: [],
  } as unknown as ExecutiveSummary;
}

describe("montarSequenciaDoAutoplay", () => {
  it("sem overview, a volta é só a Visão Geral", () => {
    expect(montarSequenciaDoAutoplay(null)).toEqual([{ tipo: "geral" }]);
    expect(montarSequenciaDoAutoplay(undefined)).toEqual([{ tipo: "geral" }]);
  });

  it("a Visão Geral vem primeiro, depois as unidades no ranking de impacto", () => {
    const overview: FamiliesOverview = {
      period: "2026-08",
      summary: resumo(-100),
      unitsIncluded: [
        {
          unidade: "CAMACARI",
          label: "CAMAÇARI",
          contexts: [{ scopeHash: "hash-camacari", channel: null, latestPeriod: "2026-08" }],
          summary: resumo(-1000),
        },
        {
          unidade: "PERNAMBUCO",
          label: "PERNAMBUCO",
          contexts: [{ scopeHash: "hash-pe", channel: null, latestPeriod: "2026-08" }],
          summary: resumo(-27564),
        },
      ],
      unitsExcluded: [],
    };

    expect(montarSequenciaDoAutoplay(overview)).toEqual([
      { tipo: "geral" },
      { tipo: "unidade", label: "PERNAMBUCO", scopeHash: "hash-pe", canal: null },
      { tipo: "unidade", label: "CAMAÇARI", scopeHash: "hash-camacari", canal: null },
    ]);
  });

  it("uma unidade com mais de um contexto vira um slide por contexto, com o canal no rótulo", () => {
    const overview: FamiliesOverview = {
      period: "2026-08",
      summary: resumo(-100),
      unitsIncluded: [
        {
          unidade: "CAMACARI",
          label: "CAMAÇARI",
          contexts: [
            { scopeHash: "hash-empurrada", channel: "EMPURRADA", latestPeriod: "2026-08" },
            { scopeHash: "hash-puxada", channel: "PUXADA", latestPeriod: "2026-08" },
          ],
          summary: resumo(-1000),
        },
      ],
      unitsExcluded: [],
    };

    expect(montarSequenciaDoAutoplay(overview)).toEqual([
      { tipo: "geral" },
      {
        tipo: "unidade",
        label: "CAMAÇARI · EMPURRADA",
        scopeHash: "hash-empurrada",
        canal: "EMPURRADA",
      },
      {
        tipo: "unidade",
        label: "CAMAÇARI · PUXADA",
        scopeHash: "hash-puxada",
        canal: "PUXADA",
      },
    ]);
  });
});

describe("lerIntervaloSegundos", () => {
  it("sem valor, vale o padrão", () => {
    expect(lerIntervaloSegundos(null)).toBe(INTERVALO_PADRAO_SEGUNDOS);
  });

  it("valor inválido, vale o padrão", () => {
    expect(lerIntervaloSegundos("abacate")).toBe(INTERVALO_PADRAO_SEGUNDOS);
  });

  it("abaixo do piso, vale o padrão", () => {
    expect(lerIntervaloSegundos("1")).toBe(INTERVALO_PADRAO_SEGUNDOS);
  });

  it("um valor válido é respeitado", () => {
    expect(lerIntervaloSegundos("45")).toBe(45);
  });
});
