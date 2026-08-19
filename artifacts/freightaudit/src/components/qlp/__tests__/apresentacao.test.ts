import { describe, expect, it } from "vitest";
import {
  agruparMovimentos,
  formatarValor,
  rotuloDaVigencia,
  separarRotulo,
} from "../apresentacao";
import type { ChangeRow } from "@/components/changes/change-table";

/**
 * As decisões de apresentação da tela de QLP — lógica pura, sem DOM, como
 * manda o `vitest.config.ts` deste artifact.
 */

const linha = (sobrepor: Partial<ChangeRow>): ChangeRow => ({
  id: 1,
  category: "FLEET",
  changeType: "ENTITY_ADDED",
  nature: null,
  attributeCode: null,
  attributeName: null,
  entityLabel: null,
  entityType: "QLP_ADMINISTRATIVO",
  valueBefore: null,
  valueAfter: null,
  deltaAbsolute: null,
  deltaPercent: null,
  comparability: "COMPARABLE",
  inconclusiveReason: null,
  impactConfidence: "NOT_CALCULABLE",
  impactAmount: null,
  impactPeriodicity: null,
  impactReason: null,
  costClass: null,
  taxonomyName: null,
  semanticsStatus: "UNKNOWN",
  semanticsVersionA: null,
  semanticsVersionB: null,
  semanticsEffectiveFrom: null,
  ...sobrepor,
});

describe("formatarValor", () => {
  const semantica = (status: string, isMonetary: boolean | null) => ({
    semantica: { status, isMonetary, unit: null, periodicity: null, aggregation: null },
  });

  it("ausência é travessão, nunca zero", () => {
    expect(formatarValor(null, semantica("UNKNOWN", null))).toBe("—");
  });

  it("número sem curadoria aparece como número, não como reais", () => {
    // Chamar de dinheiro o que ninguém confirmou seria interpretação.
    expect(formatarValor(9800, semantica("UNKNOWN", null))).toBe("9.800");
  });

  it("vira R$ só com semântica confirmada e monetária", () => {
    expect(formatarValor(9800, semantica("CONFIRMED", true))).toContain("9.800,00");
    expect(formatarValor(9800, semantica("CONFIRMED", false))).toBe("9.800");
  });

  it("texto e booleano passam legíveis", () => {
    expect(formatarValor("GEO NE", semantica("UNKNOWN", null))).toBe("GEO NE");
    expect(formatarValor(true, semantica("UNKNOWN", null))).toBe("Sim");
  });
});

describe("separarRotulo", () => {
  it("divide no separador da identidade canônica", () => {
    expect(separarRotulo("07.526.557/0015-05 · ANALISTA ADM")).toEqual({
      unidade: "07.526.557/0015-05",
      cargo: "ANALISTA ADM",
    });
  });

  it("sem separador, tudo é cargo — melhor do que inventar uma unidade", () => {
    expect(separarRotulo("ANALISTA ADM")).toEqual({ unidade: "", cargo: "ANALISTA ADM" });
  });
});

describe("agruparMovimentos", () => {
  /*
    O motor grava nas linhas de frota a chave normalizada da entidade —
    `20618821000799AUXILIARADM` —, e é isso que chega aqui. O dicionário da
    série devolve o nome como o arquivo o escreveu.
  */
  const serie = [
    { cargo: "AUXILIAR ADM", unidadeCnpj: "20618821000799", unidadeCnpjLegivel: "20.618.821/0007-99" },
    { cargo: "ANALISTA ADM", unidadeCnpj: "07526557001505", unidadeCnpjLegivel: "07.526.557/0015-05" },
  ];

  it("agrupa entradas e saídas por unidade, com o nome legível da série", () => {
    const grupos = agruparMovimentos(
      [
        linha({ changeType: "ENTITY_ADDED", entityLabel: "20618821000799AUXILIARADM" }),
        linha({ changeType: "ENTITY_REMOVED", entityLabel: "07526557001505ANALISTAADM" }),
        linha({ changeType: "VALUE_CHANGED", entityLabel: "07526557001505AUXILIARADM" }),
      ],
      serie,
    );

    expect(grupos).toEqual([
      { unidade: "07.526.557/0015-05", entraram: [], sairam: ["ANALISTA ADM"] },
      { unidade: "20.618.821/0007-99", entraram: ["AUXILIAR ADM"], sairam: [] },
    ]);
  });

  it("sem dicionário, abre a chave pela forma dela — menos bonito, igualmente verdadeiro", () => {
    const grupos = agruparMovimentos([
      linha({ changeType: "ENTITY_ADDED", entityLabel: "20618821000799AUXILIARADM" }),
    ]);
    expect(grupos).toEqual([
      { unidade: "20.618.821/0007-99", entraram: ["AUXILIARADM"], sairam: [] },
    ]);
  });

  it("rótulo já legível passa direto — o formato de amanhã não quebra a leitura", () => {
    const grupos = agruparMovimentos([
      linha({ changeType: "ENTITY_ADDED", entityLabel: "20.618.821/0007-99 · AUXILIAR ADM" }),
    ]);
    expect(grupos).toEqual([
      { unidade: "20.618.821/0007-99", entraram: ["AUXILIAR ADM"], sairam: [] },
    ]);
  });

  it("linha sem rótulo não derruba o agrupamento", () => {
    expect(agruparMovimentos([linha({ entityLabel: null })])).toEqual([]);
  });
});

describe("rotuloDaVigencia", () => {
  it("prefere o rótulo literal da fonte — duas quinzenas do mesmo mês têm o mesmo periodLabel", () => {
    expect(
      rotuloDaVigencia({ periodLabel: "agosto/2026", sourceLabels: ["EMPURRADA_1_8_2026"] }),
    ).toBe("EMPURRADA_1_8_2026");
  });

  it("sem rótulo da fonte, cai no periodLabel em vez de sumir", () => {
    expect(rotuloDaVigencia({ periodLabel: "agosto/2026", sourceLabels: [] })).toBe(
      "agosto/2026",
    );
  });
});
