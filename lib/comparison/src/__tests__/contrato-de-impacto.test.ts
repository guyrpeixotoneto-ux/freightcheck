import { describe, expect, it } from "vitest";
import {
  agruparPendencias,
  coberturaDaApuracao,
  estadoDaApuracao,
  montarLeituraDeImpacto,
  periodicidadePrincipal,
  periodicidadesDaLeitura,
  posicaoDoPar,
  temMaisDeUmaPeriodicidade,
  type EntradaDaLeitura,
  type LadosPorPeriodicidade,
} from "../contrato-de-impacto";
import type { ResumoDeImpacto } from "../deduplicacao";

/**
 * O contrato de impacto — os cenários que a tela precisa poder distinguir.
 *
 * Cada `it` aqui corresponde a uma frase diferente na interface. Se dois deles
 * passassem a produzir a mesma leitura, seria porque o produto voltou a
 * confundir dois fatos — que é o defeito que este contrato existe para não ter.
 */

function impacto(p: Partial<ResumoDeImpacto> = {}): ResumoDeImpacto {
  return {
    byPeriodicity: {},
    brutoByPeriodicity: {},
    rastro: { brutoByPeriodicity: {}, degraus: [], oficialByPeriodicity: {} },
    excludedChanges: 0,
    calculatedChanges: 0,
    notCalculable: 0,
    zeroChanges: 0,
    ...p,
  };
}

function lado(
  periodicity: string,
  gains: number,
  losses: number,
  changes = 1,
): LadosPorPeriodicidade {
  return {
    periodicity,
    net: Number((gains + losses).toFixed(2)),
    gains: { total: gains, changes: gains !== 0 ? changes : 0 },
    losses: { total: losses, changes: losses !== 0 ? changes : 0 },
  };
}

function entrada(p: Partial<EntradaDaLeitura> = {}): EntradaDaLeitura {
  return {
    recorte: "PAR_SELECIONADO",
    de: { date: "2026-07-16", label: "julho/2026" },
    para: { date: "2026-08-01", label: "agosto/2026 · 1ª quinzena" },
    vigencias: ["2026-06-16", "2026-07-16", "2026-08-01"],
    impact: impacto(),
    totais: { alteracoes: 0, veiculos: 0 },
    ...p,
  };
}

// ---------------------------------------------------------------------------
// Os quatro estados — cenários 3, 4, 5 e 6 da bateria
// ---------------------------------------------------------------------------

describe("estado da apuração", () => {
  it("sem alteração nenhuma não é impacto zero", () => {
    expect(estadoDaApuracao(0, { calculatedChanges: 0, notCalculable: 0 })).toBe(
      "SEM_ALTERACAO",
    );
  });

  it("alterações sem nenhum preço são NAO_CALCULAVEL, e não zero", () => {
    expect(estadoDaApuracao(300, { calculatedChanges: 0, notCalculable: 300 })).toBe(
      "NAO_CALCULAVEL",
    );
  });

  it("parte apurada e parte pendente é PARCIALMENTE_CALCULADO", () => {
    expect(estadoDaApuracao(300, { calculatedChanges: 212, notCalculable: 88 })).toBe(
      "PARCIALMENTE_CALCULADO",
    );
  });

  it("tudo decidido é CALCULADO — inclusive quando o resultado é zero", () => {
    expect(estadoDaApuracao(12, { calculatedChanges: 12, notCalculable: 0 })).toBe(
      "CALCULADO",
    );
  });

  it("apurado em R$ 0,00 e nada apurado são leituras diferentes", () => {
    const zerado = montarLeituraDeImpacto(
      entrada({
        impact: impacto({ byPeriodicity: { MENSAL: 0 }, calculatedChanges: 9, zeroChanges: 9 }),
        totais: { alteracoes: 9, veiculos: 3 },
      }),
    );
    const semPreco = montarLeituraDeImpacto(
      entrada({
        impact: impacto({ calculatedChanges: 0, notCalculable: 9 }),
        totais: { alteracoes: 9, veiculos: 3 },
      }),
    );

    expect(zerado.estado).toBe("CALCULADO");
    expect(zerado.totais.semEfeitoFinanceiro).toBe(9);
    expect(semPreco.estado).toBe("NAO_CALCULAVEL");
    expect(semPreco.totais.semEfeitoFinanceiro).toBe(0);
    // O ponto inteiro: as duas não podem virar a mesma coisa na tela.
    expect(zerado.estado).not.toBe(semPreco.estado);
  });
});

// ---------------------------------------------------------------------------
// Periodicidade — cenários 7 a 11
// ---------------------------------------------------------------------------

describe("periodicidade", () => {
  it("publica todas as periodicidades, nunca só uma", () => {
    const leitura = montarLeituraDeImpacto(
      entrada({
        impact: impacto({
          byPeriodicity: { MENSAL: -11712.3, ANUAL: -144874.5 },
          calculatedChanges: 76,
          notCalculable: 517,
        }),
        sides: [lado("ANUAL", 0, -144874.5), lado("MENSAL", 1000, -12712.3)],
        totais: { alteracoes: 593, veiculos: 120 },
      }),
    );
    expect(leitura.periodicidades.map((p) => p.periodicity).sort()).toEqual([
      "ANUAL",
      "MENSAL",
    ]);
    expect(temMaisDeUmaPeriodicidade(leitura.periodicidades)).toBe(true);
  });

  it("valores mensais, anuais e pontuais convivem sem somar", () => {
    const p = periodicidadesDaLeitura(
      { byPeriodicity: { MENSAL: 100, ANUAL: 1200, PONTUAL: 50 } },
      [lado("MENSAL", 100, 0), lado("ANUAL", 1200, 0), lado("PONTUAL", 50, 0)],
    );
    expect(p).toHaveLength(3);
    expect(p.reduce((s, x) => s + x.liquido, 0)).toBe(1350); // só a prova de que nada foi fundido
    expect(new Set(p.map((x) => x.periodicity)).size).toBe(3);
  });

  it("uma periodicidade preferida ZERADA não esconde a que tem dinheiro", () => {
    // O defeito real: `ANUAL` existe como balde apurado em R$ 0,00 e vencia o
    // eixo do gráfico, escondendo o mensal inteiro.
    const p = periodicidadesDaLeitura({ byPeriodicity: { ANUAL: 0, MENSAL: -11712.3 } }, [
      lado("ANUAL", 0, 0),
      lado("MENSAL", 0, -11712.3),
    ]);
    expect(periodicidadePrincipal(p, "ANUAL")).toBe("MENSAL");
    expect(periodicidadePrincipal(p, null)).toBe("MENSAL");
  });

  it("a preferida vence quando ela de fato tem movimento", () => {
    const p = periodicidadesDaLeitura({ byPeriodicity: { ANUAL: -144874.5, MENSAL: -11712.3 } }, [
      lado("ANUAL", 0, -144874.5),
      lado("MENSAL", 0, -11712.3),
    ]);
    expect(periodicidadePrincipal(p, "MENSAL")).toBe("MENSAL");
    expect(periodicidadePrincipal(p, null)).toBe("ANUAL"); // sem preferência, a maior
  });

  it("um balde compensado tem movimento, ainda que o líquido seja zero", () => {
    const p = periodicidadesDaLeitura({ byPeriodicity: { MENSAL: 0, ANUAL: 4 } }, [
      lado("MENSAL", 120000, -120000),
      lado("ANUAL", 4, 0),
    ]);
    expect(p[0].periodicity).toBe("MENSAL");
    expect(p[0].temMovimento).toBe(true);
    expect(periodicidadePrincipal(p, null)).toBe("MENSAL");
  });

  it("sem periodicidade nenhuma não inventa uma", () => {
    expect(periodicidadePrincipal([], "MENSAL")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Recorte e par — cenários 1, 2, 15 e 16
// ---------------------------------------------------------------------------

describe("recorte e par", () => {
  it("par consecutivo é marcado como tal, sem intermediárias", () => {
    expect(posicaoDoPar("2026-07-16", "2026-08-01", ["2026-07-16", "2026-08-01"])).toEqual({
      consecutivo: true,
      invertido: false,
      intermediarias: [],
    });
  });

  it("par salteado nomeia a vigência que ficou no meio", () => {
    const p = posicaoDoPar("2026-06-16", "2026-08-01", [
      "2026-06-16",
      "2026-07-16",
      "2026-08-01",
    ]);
    expect(p.consecutivo).toBe(false);
    expect(p.intermediarias).toEqual(["2026-07-16"]);
  });

  it("a volta é marcada como invertida", () => {
    const p = posicaoDoPar("2026-08-01", "2026-07-16", ["2026-07-16", "2026-08-01"]);
    expect(p.invertido).toBe(true);
    expect(p.consecutivo).toBe(true);
  });

  it("sem a lista de vigências não afirma vizinhança", () => {
    expect(posicaoDoPar("2026-06-16", "2026-08-01").consecutivo).toBe(false);
  });

  it("cada recorte se declara", () => {
    const daVigencia = montarLeituraDeImpacto(entrada({ recorte: "VIGENCIA_VS_ANTERIOR" }));
    const doPar = montarLeituraDeImpacto(entrada({ recorte: "PAR_SELECIONADO" }));
    const doIntervalo = montarLeituraDeImpacto(entrada({ recorte: "INTERVALO_ACUMULADO" }));
    expect(daVigencia.recorte).toBe("VIGENCIA_VS_ANTERIOR");
    expect(doPar.recorte).toBe("PAR_SELECIONADO");
    expect(doIntervalo.recorte).toBe("INTERVALO_ACUMULADO");
  });

  it("toda leitura identifica as duas vigências comparadas", () => {
    const leitura = montarLeituraDeImpacto(entrada());
    expect(leitura.de?.label).toBe("julho/2026");
    expect(leitura.para.label).toBe("agosto/2026 · 1ª quinzena");
  });
});

// ---------------------------------------------------------------------------
// Cobertura e pendências
// ---------------------------------------------------------------------------

describe("cobertura", () => {
  it("0/0 não é cobertura zero", () => {
    expect(coberturaDaApuracao(0, 0)).toBeNull();
  });

  it("parcial publica valor, cobertura e pendências juntos", () => {
    const leitura = montarLeituraDeImpacto(
      entrada({
        impact: impacto({
          byPeriodicity: { MENSAL: -18420 },
          calculatedChanges: 212,
          notCalculable: 88,
        }),
        sides: [lado("MENSAL", 1000, -19420, 212)],
        totais: { alteracoes: 300, veiculos: 112 },
        pendencias: [
          { motivo: "Semântica presumida", alteracoes: 60, atributos: ["carreta.seguro"] },
          { motivo: "Não é um montante financeiro", alteracoes: 28, atributos: ["cavalo.ciclo"] },
        ],
      }),
    );
    expect(leitura.estado).toBe("PARCIALMENTE_CALCULADO");
    expect(leitura.cobertura?.apuradas).toBe(212);
    expect(leitura.cobertura?.semPreco).toBe(88);
    expect(leitura.cobertura?.percentual).toBeCloseTo(70.67, 2);
    expect(leitura.cobertura?.parcial).toBe(true);
    expect(leitura.pendencias[0].alteracoes).toBe(60);
    expect(leitura.periodicidades[0].liquido).toBe(-18420);
  });

  it("agrupa pendências pelo motivo do motor, com os atributos", () => {
    const pendencias = agruparPendencias([
      {
        impact_confidence: "NOT_CALCULABLE",
        impact_reason: "Semântica presumida",
        attribute_code: "carreta.seguro",
      },
      {
        impact_confidence: "NOT_CALCULABLE",
        impact_reason: "Semântica presumida",
        attribute_code: "cavalo.ativo",
      },
      {
        impact_confidence: "NOT_CALCULABLE",
        impact_reason: "Não é um montante financeiro",
        attribute_code: "cavalo.ciclo",
      },
      {
        impact_confidence: "CALCULATED",
        impact_reason: "Semântica confirmada",
        attribute_code: "cavalo.custo_fixo",
      },
    ]);
    expect(pendencias).toHaveLength(2);
    expect(pendencias[0]).toEqual({
      motivo: "Semântica presumida",
      alteracoes: 2,
      atributos: ["carreta.seguro", "cavalo.ativo"],
    });
  });
});

// ---------------------------------------------------------------------------
// A regressão do caso real — cenário do print de 18/09/2026
// ---------------------------------------------------------------------------

describe("regressão: o par que dizia não ter impacto enquanto o seletor tinha", () => {
  /*
    Os números são os do export real (ver docs/AUDITORIA-CONTRATO-DE-IMPACTO.md):

    - a vigência 2026-07-16 contra a anterior dela: ANUAL −144.874,50 e
      MENSAL −11.712,30;
    - a vigência 2026-03-16 contra a anterior dela: 400 alterações, nenhuma
      apurada.

    O que a tela fazia: o seletor publicava só o mensal, o gráfico só o anual, e
    o cartão de 2026-03-16 dizia "Nenhum valor apurado" com a mesma cara de uma
    vigência apurada em zero.
  */
  it("a leitura da vigência e a leitura do par são recortes distintos e declarados", () => {
    const daVigencia = montarLeituraDeImpacto(
      entrada({
        recorte: "VIGENCIA_VS_ANTERIOR",
        de: { date: "2026-07-16", label: "julho/2026" },
        para: { date: "2026-08-01", label: "agosto/2026 · 1ª quinzena" },
        impact: impacto({
          byPeriodicity: { MENSAL: 11916.7 },
          calculatedChanges: 19,
          notCalculable: 248,
        }),
        sides: [lado("MENSAL", 21764.05, -9847.35, 19)],
        totais: { alteracoes: 267, veiculos: 77 },
      }),
    );

    const doPar = montarLeituraDeImpacto(
      entrada({
        recorte: "PAR_SELECIONADO",
        de: { date: "2026-06-16", label: "junho/2026" },
        para: { date: "2026-08-01", label: "agosto/2026 · 1ª quinzena" },
        vigencias: ["2026-06-16", "2026-07-16", "2026-08-01"],
        impact: impacto({
          byPeriodicity: { ANUAL: -144874.5, MENSAL: -8091.08 },
          calculatedChanges: 89,
          notCalculable: 585,
        }),
        sides: [
          lado("ANUAL", 1399.6, -146274.1, 40),
          lado("MENSAL", 21764.05, -29855.13, 49),
        ],
        totais: { alteracoes: 674, veiculos: 133 },
      }),
    );

    // Os dois números são verdadeiros e diferentes — e agora cada um diz de quê.
    expect(daVigencia.recorte).toBe("VIGENCIA_VS_ANTERIOR");
    expect(doPar.recorte).toBe("PAR_SELECIONADO");
    expect(doPar.consecutivo).toBe(false);
    expect(doPar.intermediarias).toEqual(["2026-07-16"]);

    // E o par salteado publica as DUAS periodicidades: nenhuma metade some.
    expect(doPar.periodicidades.map((p) => p.periodicity)).toEqual(["ANUAL", "MENSAL"]);
    expect(temMaisDeUmaPeriodicidade(doPar.periodicidades)).toBe(true);
  });

  it("400 alterações sem preço nenhum não viram R$ 0", () => {
    const leitura = montarLeituraDeImpacto(
      entrada({
        recorte: "VIGENCIA_VS_ANTERIOR",
        de: { date: "2026-02-16", label: "fevereiro/2026" },
        para: { date: "2026-03-16", label: "março/2026" },
        impact: impacto({ calculatedChanges: 0, notCalculable: 400 }),
        totais: { alteracoes: 400, veiculos: 130 },
      }),
    );
    expect(leitura.estado).toBe("NAO_CALCULAVEL");
    expect(leitura.periodicidades).toEqual([]);
    expect(leitura.cobertura?.percentual).toBe(0);
    expect(leitura.cobertura?.parcial).toBe(true);
    // Nenhum campo desta leitura oferece um zero que possa ser lido como saldo.
    expect(periodicidadePrincipal(leitura.periodicidades, null)).toBeNull();
  });
});
