import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DrillDoParametro } from "@/components/inicio/drill-do-parametro";
import type { UnidadeDoDrill } from "@/lib/drill-da-familia";
import type { ExecutiveSummary } from "@/components/inicio/types";

/**
 * O primeiro degrau desenhado — o que aparece ao clicar num parâmetro da
 * gaveta da família.
 *
 * Renderiza sem provider de consulta de propósito: o degrau por unidade **não
 * pede nada ao servidor**, e um teste que precisasse de rede para vê-lo estaria
 * provando o contrário do que o componente promete. O degrau por placa é que
 * pede, e ele só monta quando uma unidade é aberta.
 */

const RESUMO_VAZIO = {
  impact: {
    byPeriodicity: {},
    brutoByPeriodicity: {},
    rastro: { brutoByPeriodicity: {}, degraus: [], oficialByPeriodicity: {} },
    excludedChanges: 0,
    calculatedChanges: 0,
    notCalculable: 0,
  },
  lossesByPeriodicity: {},
  gainsByPeriodicity: {},
  changes: 0,
  groups: 0,
  critical: 0,
  locked: 0,
  notCalculable: 0,
  vehiclesTouched: 0,
  topParameters: [],
  topVehicles: [],
} as Omit<ExecutiveSummary, "sides">;

const FINANCIAMENTO = "AQUISICAO_FINANCIAMENTO|Financiamento";

function unidade(chave: string, label: string, amount: number): UnidadeDoDrill {
  const contribuidor = {
    key: FINANCIAMENTO,
    name: "Financiamento",
    family: "AQUISICAO_FINANCIAMENTO",
    familyName: "Aquisição e financiamento",
    changes: 3,
    vehicles: 3,
    amount,
  };
  const vazio = { total: 0, changes: 0, vehicles: 0, parameters: [] };
  return {
    chave,
    label,
    contexts: [{ scopeHash: `hash-${chave}`, channel: null }],
    summary: {
      ...RESUMO_VAZIO,
      sides: [
        {
          periodicity: "MENSAL",
          net: amount,
          gains: vazio,
          losses: { total: amount, changes: 3, vehicles: 3, parameters: [contribuidor] },
        },
      ],
    } as ExecutiveSummary,
  };
}

const UNIDADES = [unidade("CAMACARI", "Camaçari", -50000), unidade("JAGUARIUNA", "Jaguariúna", -26318)];

describe("o degrau por unidade, desenhado", () => {
  const html = renderToStaticMarkup(
    <DrillDoParametro
      parametro={{ key: FINANCIAMENTO, name: "Financiamento", amount: -76318 }}
      lado="perdas"
      periodicity="MENSAL"
      unidades={UNIDADES}
      period="2026-08-01"
    />,
  );

  it("nomeia as unidades por trás do número, com o valor de cada uma", () => {
    expect(html).toContain("Camaçari");
    expect(html).toContain("Jaguariúna");
    // Só o número: `formatBrlShort` separa "R$" do valor com espaço fino sem
    // quebra, e um teste que reescreve esse espaço à mão testa o teclado de
    // quem o escreveu.
    expect(html).toContain("50.000/mês");
    expect(html).toContain("26.318/mês");
  });

  it("cada unidade é um botão — é ela que abre as placas", () => {
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).toContain('aria-expanded="false"');
  });

  it("não escreve aviso de diferença quando as unidades fecham com o total", () => {
    expect(html).not.toContain("faltam");
  });

  it("diz de quanto é a diferença quando elas não fecham", () => {
    const parcial = renderToStaticMarkup(
      <DrillDoParametro
        parametro={{ key: FINANCIAMENTO, name: "Financiamento", amount: -80000 }}
        lado="perdas"
        periodicity="MENSAL"
        unidades={UNIDADES}
        period="2026-08-01"
      />,
    );
    expect(parcial).toContain("faltam");
    expect(parcial).toContain("3.682/mês");
  });
});
