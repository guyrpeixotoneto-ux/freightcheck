import { describe, expect, it } from "vitest";
import {
  resumirImpactoDosChamados,
  type ReguaDoParametro,
} from "../chamados";

/**
 * A régua financeira dos chamados — o furo P1 da auditoria, fechado.
 *
 * O "Impacto" da aba somava um escalar: `sum(impact_amount)` sobre TODOS os
 * parâmetros apurados, misturando mensal com anual e monetário com o que nem
 * dinheiro é. A justificativa ("aplicado − pedido é a mesma unidade") vale por
 * linha e é falsa na soma entre linhas. Estas provas fixam o contrato novo:
 * baldes por periodicidade, régua de `viraDinheiro`, e o que não passa é
 * CONTADO — nunca somado, nunca escondido.
 */

const regua = new Map<string, ReguaDoParametro>([
  ["cavalo.seguro", { somavel: true, motivo: null, periodicidade: "MENSAL" }],
  ["cavalo.ipva", { somavel: true, motivo: null, periodicidade: "ANUAL" }],
  [
    "cavalo.km_rodado",
    { somavel: false, motivo: "Não é um montante financeiro", periodicidade: "MENSAL" },
  ],
]);

describe("resumirImpactoDosChamados", () => {
  it("mensal e anual nunca caem no mesmo balde", () => {
    const impacto = resumirImpactoDosChamados(
      [
        { attributeCode: "cavalo.seguro", calculated: 3, impactSum: -450 },
        { attributeCode: "cavalo.ipva", calculated: 1, impactSum: 1200 },
      ],
      regua,
    );

    expect(impacto.porPeriodicidade).toEqual({ MENSAL: -450, ANUAL: 1200 });
    expect(impacto.alteracoesSomadas).toBe(4);
    expect(impacto.foraDaRegua).toBe(0);
  });

  it("o não monetário sai contado, nunca somado", () => {
    // km é variação real e apurável — dinheiro não é.
    const impacto = resumirImpactoDosChamados(
      [
        { attributeCode: "cavalo.seguro", calculated: 2, impactSum: 100 },
        { attributeCode: "cavalo.km_rodado", calculated: 5, impactSum: 900 },
      ],
      regua,
    );

    expect(impacto.porPeriodicidade).toEqual({ MENSAL: 100 });
    expect(impacto.foraDaRegua).toBe(5);
  });

  it("parâmetro sem coluna no modelo fica fora — somar o desconhecido é chute", () => {
    const impacto = resumirImpactoDosChamados(
      [
        { attributeCode: null, calculated: 2, impactSum: 70 },
        { attributeCode: "cavalo.inexistente", calculated: 1, impactSum: 30 },
      ],
      regua,
    );

    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.alteracoesSomadas).toBe(0);
    expect(impacto.foraDaRegua).toBe(3);
  });

  it("sem nada apurado, nada é dito — nem zero", () => {
    const impacto = resumirImpactoDosChamados(
      [{ attributeCode: "cavalo.seguro", calculated: 0, impactSum: null }],
      regua,
    );
    expect(impacto.porPeriodicidade).toEqual({});
    expect(impacto.alteracoesSomadas).toBe(0);
    expect(impacto.foraDaRegua).toBe(0);
  });
});
