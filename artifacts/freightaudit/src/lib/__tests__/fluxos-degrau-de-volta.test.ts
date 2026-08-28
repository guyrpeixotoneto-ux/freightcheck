import { describe, expect, it } from "vitest";

import { degrauDeVolta, type DegrauDaTrilha } from "@/lib/fluxos";

const degrau = (fluxoId: string): DegrauDaTrilha => ({
  fluxoId,
  fluxoNome: `Fluxo ${fluxoId}`,
  etapaId: `etapa-${fluxoId}`,
  etapaNome: `Etapa de ${fluxoId}`,
});

describe("degrauDeVolta", () => {
  it("devolve o pai imediato, que é o último degrau da trilha", () => {
    expect(degrauDeVolta({ trilha: [degrau("raiz"), degrau("meio")] })?.fluxoId).toBe("meio");
  });

  it("não tem degrau quando o fluxo é raiz", () => {
    expect(degrauDeVolta({ trilha: [] })).toBeNull();
  });

  it("tolera a trilha ausente e o fluxo ainda não carregado", () => {
    expect(degrauDeVolta({})).toBeNull();
    expect(degrauDeVolta(undefined)).toBeNull();
    expect(degrauDeVolta(null)).toBeNull();
  });
});
