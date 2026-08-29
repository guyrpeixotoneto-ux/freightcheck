import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { celulasAntesDepois, impactoLiquidoDaTabela } from "../dashboard";
import { formatBrlShort, reaisPublicados } from "@/lib/format";
import type { ChangeGroup } from "@/components/inicio/types";

/**
 * `celulasAntesDepois` espelha os ramos de `<BeforeAfter>`
 * (`components/inicio/group-card.tsx`): só existe total de Antes/Agora quando
 * `aggregation = SUM`. Fora disso, Antes e Agora ficam em branco e a
 * Diferença carrega a mesma leitura (faixa de variação, padrão dominante, ou
 * nenhuma) — nunca um número que a agregação não autoriza.
 */

const grupoBase: ChangeGroup = {
  key: "g",
  attributeCode: "atributo",
  title: "Alteração",
  entityType: "CAVALO",
  equipment: "Cavalo",
  changeType: "VALUE_CHANGED",
  category: "FIXO",
  comparability: "COMPARAVEL",
  changes: 1,
  vehicles: 3,
  fleet: 10,
  coverage: "TOTAL",
  coverageLabel: "toda a frota",
  patterns: 1,
  dominantPattern: null,
  aggregate: {
    summable: false,
    aggregation: null,
    totalBefore: null,
    totalAfter: null,
    rowsInTotal: 0,
    perVehicle: null,
    deltaPercent: null,
    minPercent: null,
    maxPercent: null,
  },
  impact: {
    confidence: "NOT_CALCULABLE",
    amount: null,
    periodicity: null,
    reason: null,
    countedVehicles: 3,
    excludedVehicles: 0,
    excludedAmount: null,
    excludedReason: null,
  },
  natures: [],
  natureCodes: [],
  semanticsStatus: null,
} as unknown as ChangeGroup;

const html = (node: unknown) => renderToStaticMarkup(node as React.ReactElement);

describe("celulasAntesDepois", () => {
  it("soma Antes e Agora quando a agregação é somável, com o delta e o percentual", () => {
    const grupo: ChangeGroup = {
      ...grupoBase,
      unit: "BRL",
      aggregate: {
        ...grupoBase.aggregate,
        summable: true,
        totalBefore: 5729.39,
        totalAfter: 43817.91,
        deltaPercent: 664.8,
      },
    } as ChangeGroup;

    const { antes, agora, diferenca } = celulasAntesDepois(grupo);

    expect(antes).toBe("R$ 5.729,39");
    expect(agora).toBe("R$ 43.817,91");
    expect(html(diferenca)).toContain("664,8%");
    expect(html(diferenca)).toContain("38.088,52");
  });

  it("deixa Antes e Agora em branco quando a agregação não é somável", () => {
    const grupo: ChangeGroup = {
      ...grupoBase,
      aggregate: {
        ...grupoBase.aggregate,
        summable: false,
        minPercent: -100,
        maxPercent: -66.5,
        aggregation: null,
      },
    } as ChangeGroup;

    const { antes, agora, diferenca } = celulasAntesDepois(grupo);

    expect(antes).toBe("—");
    expect(agora).toBe("—");
    expect(html(diferenca)).toContain("não somável");
    expect(html(diferenca)).toContain("-100,0%");
  });

  it("usa o padrão dominante quando não há total nem faixa de variação", () => {
    const grupo: ChangeGroup = {
      ...grupoBase,
      dominantPattern: { before: "SIM", after: "NÃO", vehicles: 3 },
    } as ChangeGroup;

    const { antes, agora } = celulasAntesDepois(grupo);

    expect(antes).toBe("SIM");
    expect(agora).toBe("NÃO");
  });
});

describe("impactoLiquidoDaTabela", () => {
  const precificado = (amount: number, periodicity = "MENSAL"): ChangeGroup =>
    ({
      ...grupoBase,
      impact: { ...grupoBase.impact, confidence: "CALCULATED", amount, periodicity },
    }) as ChangeGroup;

  it("soma os grupos precificados quando todos têm a mesma periodicidade", () => {
    const resultado = impactoLiquidoDaTabela([
      precificado(9042),
      precificado(-15713),
      precificado(-5023),
      grupoBase,
    ]);

    expect(resultado).toEqual({ misturado: false, total: 9042 - 15713 - 5023, periodicidade: "MENSAL" });
  });

  it("recusa somar periodicidades diferentes em vez de misturar R$/mês com R$/ano", () => {
    const resultado = impactoLiquidoDaTabela([precificado(100, "MENSAL"), precificado(100, "ANUAL")]);

    expect(resultado).toEqual({ misturado: true });
  });

  it("retorna null quando nenhum grupo visível tem preço", () => {
    expect(impactoLiquidoDaTabela([grupoBase])).toBeNull();
  });

  /*
    O caso real de 01/08/2026, aba Carreta: as três perdas terminam em −,58,
    −,60 e −,61, e cada uma sobe um centavo ao ser escrita sem centavos. Somado
    no cru, o total era −R$ 20.461,79 → −R$ 20.462; somando a coluna escrita,
    −R$ 20.463. O cartão se anuncia como a soma daquelas linhas, então é dela
    que ele tem de fechar.
  */
  it("fecha com a coluna escrita, e não com a soma dos centavos", () => {
    const linhas = [
      precificado(9042),
      precificado(-10450.58),
      precificado(-3340.6),
      precificado(-15712.61),
    ];
    const resultado = impactoLiquidoDaTabela(linhas);

    const somaDaColuna = linhas
      .map((g) => Number(formatBrlShort(g.impact.amount!).replace(/[^0-9]/g, "")) * Math.sign(g.impact.amount!))
      .reduce((t, n) => t + n, 0);

    expect(somaDaColuna).toBe(-20463);
    expect(resultado).toEqual({ misturado: false, total: somaDaColuna, periodicidade: "MENSAL" });
    // E o cru continua sendo outro número — é ele que o cartão do topo publica.
    expect(linhas.reduce((t, g) => t + g.impact.amount!, 0)).toBeCloseTo(-20461.79, 2);
  });

  it("meio centavo sobe em módulo, como o Intl escreve", () => {
    expect(reaisPublicados(10.5)).toBe(11);
    expect(reaisPublicados(-10.5)).toBe(-11);
    expect(formatBrlShort(-10.5)).toBe(formatBrlShort(reaisPublicados(-10.5)));
    expect(formatBrlShort(10.5)).toBe(formatBrlShort(reaisPublicados(10.5)));
  });
});
