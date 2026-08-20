import { describe, expect, it } from "vitest";
import {
  impactEntries,
  periodicityAdjective,
  sortByPeriodicity,
} from "../format";

/**
 * As duas regras que sustentam um cartão por periodicidade.
 *
 * Enquanto mensal e anual dividiam duas linhas de um cartão só, nenhuma das
 * duas tinha consequência visível: a ordem era a dos baldes e o nome da
 * grandeza vinha do sufixo do número. Separados em cartões, a ordem decide onde
 * cada número mora na régua — e o rótulo passa a ser o único lugar em que a
 * grandeza está escrita antes de alguém ler o valor.
 */
describe("sortByPeriodicity", () => {
  it("escreve mensal, anual e pontual nessa ordem, venha o balde como vier", () => {
    const ordenado = sortByPeriodicity(
      impactEntries({ PONTUAL: 12, ANUAL: -144875, MENSAL: -11712 }),
    );
    expect(ordenado.map((e) => e.periodicity)).toEqual([
      "MENSAL",
      "ANUAL",
      "PONTUAL",
    ]);
  });

  it("não deixa a ordem do arquivo decidir onde o cartão fica", () => {
    /*
      É o defeito que a função existe para tirar: `Object.entries` devolve os
      baldes na ordem em que foram preenchidos, que é a ordem das linhas do
      arquivo importado. Duas vigências da mesma unidade chegam com os baldes
      trocados, e sem esta ordenação o mesmo número mudaria de lugar entre uma
      visita e a seguinte.
    */
    const primeira = sortByPeriodicity(impactEntries({ ANUAL: -1, MENSAL: -2 }));
    const segunda = sortByPeriodicity(impactEntries({ MENSAL: -2, ANUAL: -1 }));
    expect(primeira.map((e) => e.periodicity)).toEqual(
      segunda.map((e) => e.periodicity),
    );
  });

  it("manda o balde desconhecido para o fim, sem embaralhar os de lá", () => {
    const ordenado = sortByPeriodicity(
      impactEntries({ QUINZENAL: 1, SEM_PERIODICIDADE: 2, MENSAL: 3 }),
    );
    expect(ordenado.map((e) => e.periodicity)).toEqual([
      "MENSAL",
      "QUINZENAL",
      "SEM_PERIODICIDADE",
    ]);
  });

  it("devolve uma lista nova — a régua não reordena o que lhe emprestaram", () => {
    const entradas = impactEntries({ ANUAL: -1, MENSAL: -2 });
    const ordenado = sortByPeriodicity(entradas);
    expect(entradas.map((e) => e.periodicity)).toEqual(["ANUAL", "MENSAL"]);
    expect(ordenado).not.toBe(entradas);
  });
});

describe("periodicityAdjective", () => {
  it("dá ao rótulo a palavra que o cartão escreve", () => {
    expect(`Impacto líquido ${periodicityAdjective("MENSAL")}`).toBe(
      "Impacto líquido mensal",
    );
    expect(`Impacto líquido ${periodicityAdjective("ANUAL")}`).toBe(
      "Impacto líquido anual",
    );
    expect(`Impacto líquido ${periodicityAdjective("PONTUAL")}`).toBe(
      "Impacto líquido pontual",
    );
  });

  it("nunca deixa o código do banco aparecer no rótulo", () => {
    /*
      `SEM_PERIODICIDADE` é balde de verdade — `resumirImpacto` o usa para toda
      linha sem periodicidade declarada —, e um cartão chamado "Impacto líquido
      SEM_PERIODICIDADE" se lê como defeito da tela, não como o que é.
    */
    expect(periodicityAdjective("SEM_PERIODICIDADE")).toBe("sem periodicidade");
    expect(periodicityAdjective("QUINZENAL")).toBe("quinzenal");
    expect(periodicityAdjective("A_CADA_DUAS_VIAGENS")).toBe(
      "a cada duas viagens",
    );
  });
});
