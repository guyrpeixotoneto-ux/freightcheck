import { describe, expect, it } from "vitest";
import {
  criarDeduplicador,
  excluidoDaSoma,
  resumirImpacto,
  somarResumos,
  SEM_VINCULOS,
  type LinhaDeMudanca,
  type ResumoDeImpacto,
} from "@workspace/comparison/deduplicacao";
import { detalheDoImpacto } from "../visao-geral";
import type { FamiliesView, ImpactSummary } from "@/components/inicio/types";

/**
 * O contrato entre a API e esta interface, exercitado com o código da API.
 *
 * O resumo de impacto que chega em `/changes/families` é produzido por
 * `resumirImpacto` — e é exatamente esse produtor que roda aqui, sem mock no
 * meio. Se o servidor mudar a forma do resumo, este arquivo quebra no mesmo
 * commit; foi a ausência dele que deixou a interface ler
 * `excludedByPeriodicity` por oito commits depois de o campo morrer no
 * servidor, com a suíte verde e a tela caindo no primeiro clique.
 *
 * Duas amarras, uma por camada:
 *  - o typecheck: `ImpactSummary` da interface é `ResumoDeImpacto` do servidor,
 *    por `import type` — drift de tipo não compila;
 *  - esta suíte: o objeto real do produtor atravessa o leitor real da tela —
 *    drift de comportamento não passa.
 */

/** Linhas com um total coberto pela parcela — o caso que enche os degraus. */
function linhasComDuplaContagem(): LinhaDeMudanca[] {
  return [
    {
      attributeCode: "carreta.finame",
      entityId: "carreta-1",
      comparacaoId: "cmp-1",
      impactConfidence: "CALCULATED",
      impactAmount: "150.00",
      impactPeriodicity: "MENSAL",
    },
    {
      // O total cujas parcelas mudaram: sai da soma, vira degrau.
      attributeCode: "carreta.custo_fixo",
      entityId: "carreta-1",
      comparacaoId: "cmp-1",
      impactConfidence: "CALCULATED",
      impactAmount: "150.00",
      impactPeriodicity: "MENSAL",
    },
    {
      attributeCode: "carreta.pedagio",
      entityId: "carreta-2",
      comparacaoId: "cmp-1",
      impactConfidence: "NOT_CALCULABLE",
      impactAmount: null,
      impactPeriodicity: null,
    },
  ];
}

function resumoReal(): ResumoDeImpacto {
  const linhas = linhasComDuplaContagem();
  return resumirImpacto(linhas, criarDeduplicador(linhas, SEM_VINCULOS));
}

/** A menor FamiliesView que carrega um resumo real até o leitor da tela. */
function familiasCom(resumo: ImpactSummary): FamiliesView {
  return {
    context: {
      scopeHash: "h",
      channel: "EMPURRADA",
      label: "CAMAÇARI · EMPURRADA",
      scopes: [],
      latestPeriod: "2026-08-01",
      periods: 9,
    },
    otherContexts: [],
    period: "2026-08-01",
    periodLabel: "agosto de 2026",
    families: [
      {
        code: "AQUISICAO",
        name: "Aquisição e financiamento",
        origin: "FREIGHTECH",
        note: "",
        parametersWithData: 1,
        parametersChanged: 1,
        changes: 2,
        vehicles: 1,
        impact: resumo,
        critical: 0,
        locked: 0,
        parameters: [
          {
            key: "AQUISICAO|Financiamento",
            name: "Financiamento",
            family: "AQUISICAO",
            pending: null,
            changes: 2,
            vehicles: 1,
            impact: resumo,
            groups: [],
          },
        ],
      },
    ],
  } as unknown as FamiliesView;
}

describe("o resumo que o servidor produz é o que a tela consegue ler", () => {
  it("o drill-down da Visão geral abre sobre o resumo real, sem campo fantasma", () => {
    // Era exatamente este caminho que caía com "Cannot read properties of
    // undefined (reading 'MENSAL')" — detalheDoImpacto lendo um campo que o
    // produtor não escreve mais.
    const detalhe = detalheDoImpacto(familiasCom(resumoReal()), "AQUISICAO|Financiamento");
    expect(detalhe).not.toBeNull();
    expect(detalhe!.periodicity).toBe("MENSAL");
    // A parcela conta; o total coberto sai — e o excluído diz exatamente isso.
    expect(detalhe!.amount).toBe(150);
    expect(detalhe!.excluido.alteracoes).toBe(1);
    expect(detalhe!.excluido.valor).toBe(150);
  });

  it("o excluído é derivado do rastro, e fecha com bruto − oficial", () => {
    const resumo = resumoReal();
    const excluido = excluidoDaSoma(resumo);
    for (const balde of Object.keys(resumo.brutoByPeriodicity)) {
      expect(excluido[balde] ?? 0).toBeCloseTo(
        (resumo.brutoByPeriodicity[balde] ?? 0) - (resumo.byPeriodicity[balde] ?? 0),
        6,
      );
    }
  });

  it("a soma de resumos preserva os invariantes do resumo — o cartão agregado não inventa forma própria", () => {
    const um = resumoReal();
    const soma = somarResumos([um, um]);
    expect(soma.byPeriodicity.MENSAL).toBeCloseTo(2 * um.byPeriodicity.MENSAL, 6);
    expect(soma.brutoByPeriodicity.MENSAL).toBeCloseTo(2 * um.brutoByPeriodicity.MENSAL, 6);
    expect(soma.excludedChanges).toBe(2 * um.excludedChanges);
    expect(soma.notCalculable).toBe(2 * um.notCalculable);
    // bruto = oficial + excluído, no agregado como no unitário.
    expect(soma.brutoByPeriodicity.MENSAL).toBeCloseTo(
      soma.byPeriodicity.MENSAL + (excluidoDaSoma(soma).MENSAL ?? 0),
      6,
    );
  });
});
