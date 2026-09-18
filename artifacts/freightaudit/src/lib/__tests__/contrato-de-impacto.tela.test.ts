import { describe, expect, it } from "vitest";
import { montarLeituraDeImpacto } from "@workspace/comparison/contrato-de-impacto";
import {
  avisoDeInversao,
  avisoDeOutrasPeriodicidades,
  avisoDeSalteado,
  fraseDaLeitura,
  rotuloDoPar,
  type EstadoEmTela,
} from "@/lib/impacto/contrato";
import { pontosDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import type { RangeEntry } from "@/lib/analise";

/**
 * O contrato de impacto na tela — as frases, e o que nenhuma delas pode virar.
 *
 * A bateria tem um eixo só: **nenhum destes casos pode produzir a mesma coisa
 * na tela que outro**. Era essa colisão — quatro fatos diferentes publicados
 * como `R$ 0` ou como "nenhum valor apurado" — o defeito que o contrato
 * corrige.
 */

const impacto = (p: Record<string, unknown> = {}) => ({
  byPeriodicity: {},
  brutoByPeriodicity: {},
  rastro: { brutoByPeriodicity: {}, degraus: [], oficialByPeriodicity: {} },
  excludedChanges: 0,
  calculatedChanges: 0,
  notCalculable: 0,
  zeroChanges: 0,
  ...p,
});

const leitura = (p: Record<string, unknown> = {}) =>
  montarLeituraDeImpacto({
    recorte: "PAR_SELECIONADO",
    de: { date: "2026-07-16", label: "julho/2026" },
    para: { date: "2026-08-01", label: "agosto/2026 · 1ª quinzena" },
    vigencias: ["2026-06-16", "2026-07-16", "2026-08-01"],
    impact: impacto(),
    totais: { alteracoes: 0, veiculos: 0 },
    ...p,
  } as never);

const lido = (l: ReturnType<typeof leitura>): EstadoEmTela => ({
  situacao: "LIDO",
  leitura: l,
});

// ---------------------------------------------------------------------------
// Falha técnica, espera e resposta vazia — cenários 12, 13 e 14
// ---------------------------------------------------------------------------

describe("ausência de dado nunca vira zero", () => {
  it("erro de API não publica valor e diz que não é zero", () => {
    const frase = fraseDaLeitura({ situacao: "ERRO" });
    expect(frase.publicaValor).toBe(false);
    expect(frase.titulo).toBe("Não foi possível carregar o impacto");
    expect(frase.detalhe).toContain("não quer dizer que o impacto seja zero");
  });

  it("timeout entra pelo mesmo caminho do erro — é ausência, não resultado", () => {
    // Um timeout chega à tela como falha de leitura, e a tela tem um estado
    // para isso. O que ela não pode é cair no `catch` e desenhar R$ 0.
    const frase = fraseDaLeitura({ situacao: "ERRO", detalhe: "timeout" });
    expect(frase.publicaValor).toBe(false);
  });

  it("espera é espera, e não 'nada apurado'", () => {
    const frase = fraseDaLeitura({ situacao: "CARREGANDO" });
    expect(frase.publicaValor).toBe(false);
    expect(frase.titulo).toBe("Carregando o impacto…");
    expect(frase.titulo).not.toBe(
      fraseDaLeitura({ situacao: "ERRO" }).titulo,
    );
  });

  it("resposta vazia — sem alteração nenhuma — tem frase própria", () => {
    const frase = fraseDaLeitura(lido(leitura()));
    expect(frase.titulo).toBe("Nada mudou");
    expect(frase.publicaValor).toBe(false);
  });

  it("as quatro ausências produzem quatro frases diferentes", () => {
    const titulos = [
      fraseDaLeitura({ situacao: "CARREGANDO" }).titulo,
      fraseDaLeitura({ situacao: "ERRO" }).titulo,
      fraseDaLeitura(lido(leitura())).titulo,
      fraseDaLeitura(
        lido(
          leitura({
            impact: impacto({ notCalculable: 300 }),
            totais: { alteracoes: 300, veiculos: 112 },
          }),
        ),
      ).titulo,
    ];
    expect(new Set(titulos).size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Os estados com valor — cenários 4, 5 e 6
// ---------------------------------------------------------------------------

describe("zero medido, zero desconhecido e zero parcial", () => {
  it("nada apurado não publica valor e diz que o resultado é desconhecido", () => {
    const frase = fraseDaLeitura(
      lido(
        leitura({
          impact: impacto({ notCalculable: 300 }),
          totais: { alteracoes: 300, veiculos: 112 },
        }),
      ),
    );
    expect(frase.titulo).toBe("Impacto financeiro ainda não calculado");
    expect(frase.publicaValor).toBe(false);
    expect(frase.detalhe).toContain("não é zero");
  });

  it("apurado em R$ 0,00 publica valor e diz que a conta aconteceu", () => {
    const frase = fraseDaLeitura(
      lido(
        leitura({
          impact: impacto({
            byPeriodicity: { MENSAL: 0 },
            calculatedChanges: 9,
            zeroChanges: 9,
          }),
          totais: { alteracoes: 9, veiculos: 4 },
        }),
      ),
    );
    expect(frase.titulo).toBeNull();
    expect(frase.publicaValor).toBe(true);
    expect(frase.detalhe).toContain("Sem alteração financeira");
  });

  it("parcial publica valor, cobertura e pendências na mesma frase", () => {
    const frase = fraseDaLeitura(
      lido(
        leitura({
          impact: impacto({
            byPeriodicity: { MENSAL: -18420 },
            calculatedChanges: 212,
            notCalculable: 88,
          }),
          sides: [
            {
              periodicity: "MENSAL",
              net: -18420,
              gains: { total: 1000, changes: 10 },
              losses: { total: -19420, changes: 202 },
            },
          ],
          totais: { alteracoes: 300, veiculos: 112 },
        }),
      ),
    );
    expect(frase.publicaValor).toBe(true);
    expect(frase.parcial).toBe(true);
    expect(frase.detalhe).toContain("212 de 300");
    expect(frase.detalhe).toContain("70,7%");
    expect(frase.detalhe).toContain("88");
  });
});

// ---------------------------------------------------------------------------
// O par, escrito — cenários 1, 2, 15 e 16
// ---------------------------------------------------------------------------

describe("o par aparece na tela", () => {
  it("nomeia as duas vigências", () => {
    expect(rotuloDoPar(leitura())).toBe("julho/2026 → agosto/2026 · 1ª quinzena");
  });

  it("par consecutivo não recebe aviso", () => {
    expect(avisoDeSalteado(leitura())).toBeNull();
    expect(avisoDeInversao(leitura())).toBeNull();
  });

  it("par salteado avisa, e conta as vigências do meio", () => {
    const aviso = avisoDeSalteado(
      leitura({ de: { date: "2026-06-16", label: "junho/2026" } }),
    );
    expect(aviso).toContain("não consecutiva");
    expect(aviso).toContain("uma vigência intermediária");
  });

  it("par invertido avisa que a variação não é o inverso da ida", () => {
    const aviso = avisoDeInversao(
      leitura({
        de: { date: "2026-08-01", label: "agosto/2026 · 1ª quinzena" },
        para: { date: "2026-07-16", label: "julho/2026" },
      }),
    );
    expect(aviso).toContain("invertida");
  });

  it("a leitura consolidada não se apresenta como primeira do histórico", () => {
    const consolidada = rotuloDoPar(
      leitura({ de: null, pontaDePorUnidade: true }),
    );
    expect(consolidada).toContain("cada unidade contra a anterior dela");
    expect(rotuloDoPar(leitura({ de: null }))).toContain("primeira do histórico");
  });
});

// ---------------------------------------------------------------------------
// Periodicidade — cenários 7 a 11, e a regressão do gráfico
// ---------------------------------------------------------------------------

describe("nenhuma grandeza some da tela", () => {
  it("a segunda periodicidade é publicada em linha própria", () => {
    const l = leitura({
      impact: impacto({
        byPeriodicity: { MENSAL: -11712.3, ANUAL: -144874.5 },
        calculatedChanges: 76,
        notCalculable: 517,
      }),
      sides: [
        {
          periodicity: "ANUAL",
          net: -144874.5,
          gains: { total: 0, changes: 0 },
          losses: { total: -144874.5, changes: 40 },
        },
        {
          periodicity: "MENSAL",
          net: -11712.3,
          gains: { total: 0, changes: 0 },
          losses: { total: -11712.3, changes: 36 },
        },
      ],
      totais: { alteracoes: 593, veiculos: 130 },
    });
    const aviso = avisoDeOutrasPeriodicidades(l, "MENSAL");
    expect(aviso).toContain("/ano");
    expect(aviso).toContain("não somam");
  });

  it("com uma grandeza só, não há linha a acrescentar", () => {
    const l = leitura({
      impact: impacto({ byPeriodicity: { MENSAL: 100 }, calculatedChanges: 1 }),
      sides: [
        {
          periodicity: "MENSAL",
          net: 100,
          gains: { total: 100, changes: 1 },
          losses: { total: 0, changes: 0 },
        },
      ],
      totais: { alteracoes: 1, veiculos: 1 },
    });
    expect(avisoDeOutrasPeriodicidades(l, "MENSAL")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A regressão do gráfico chapado no zero — o caso real de 18/09/2026
// ---------------------------------------------------------------------------

describe("regressão: o gráfico não escolhe uma periodicidade parada", () => {
  /*
    Os números são os do export real (docs/AUDITORIA-CONTRATO-DE-IMPACTO.md):
    julho/2026 tem `ANUAL −144.874,50` e `MENSAL −11.712,30`; as outras cinco
    vigências da janela só têm mensal. Com a vigência anual aberta, o gráfico
    escolhia o eixo anual e desenhava **cinco dos seis pontos em zero**, ao lado
    de um seletor que publicava dezenas de milhares de reais por mês.
  */
  const periodos = [
    "2026-03-16",
    "2026-04-16",
    "2026-05-16",
    "2026-06-16",
    "2026-07-16",
    "2026-08-01",
  ].map((date) => ({ date, label: date }));

  const entrada = (
    period: string,
    periodicity: string,
    amount: number,
  ): RangeEntry =>
    ({
      key: `${period}|${periodicity}|${amount}`,
      period,
      periodLabel: period,
      parameterKey: "REMUNERACAO|teste",
      parameterName: "teste",
      family: "REMUNERACAO",
      attributeCode: "cavalo.teste",
      title: "teste",
      equipment: "CAVALO",
      vehicles: 1,
      unit: null,
      amount,
      periodicity,
      confidence: "CALCULATED",
      reason: "teste",
      badge: "DINHEIRO",
      badgeLabel: "Dinheiro",
      group: {} as never,
    }) as unknown as RangeEntry;

  const entradas: RangeEntry[] = [
    entrada("2026-04-16", "MENSAL", 16588.35),
    entrada("2026-05-16", "MENSAL", 73772.05),
    entrada("2026-06-16", "MENSAL", -20996.9),
    entrada("2026-07-16", "MENSAL", -11712.3),
    entrada("2026-08-01", "MENSAL", 11916.7),
    entrada("2026-07-16", "ANUAL", -144874.5),
  ];

  it("com a vigência anual aberta, o eixo continua o do dinheiro do recorte", () => {
    const serie = pontosDeImpacto(periodos, entradas, "ANUAL");
    // A preferida tem movimento aqui, então ela vale — mas o aviso da outra
    // grandeza é o que impede o mensal de sumir (ver a bateria acima).
    expect(serie.periodicity).toBe("ANUAL");
    expect(serie.pontos.filter((p) => p.liquido !== 0)).toHaveLength(1);
  });

  it("uma periodicidade preferida SEM movimento no recorte não ganha o eixo", () => {
    // O caso que produzia o gráfico chapado: o balde anual existe (há linha com
    // preço nele) e soma zero na janela desenhada.
    const comAnualZerado = [
      ...entradas.filter((e) => e.periodicity === "MENSAL"),
      entrada("2026-07-16", "ANUAL", 0),
    ];
    const serie = pontosDeImpacto(periodos, comAnualZerado, "ANUAL");
    expect(serie.periodicity).toBe("MENSAL");
    expect(serie.pontos.filter((p) => p.liquido !== 0).length).toBeGreaterThan(1);
  });

  it("sem preferência, manda quem mais moveu — e não o alfabeto", () => {
    const serie = pontosDeImpacto(periodos, entradas, null);
    expect(serie.periodicity).toBe("ANUAL"); // 144.874,50 bruto contra 134.986,30
  });

  it("intervalo sem nenhuma alteração valorada não desenha e não inventa eixo", () => {
    const serie = pontosDeImpacto(periodos, [], "MENSAL");
    expect(serie.pontos).toEqual([]);
    expect(serie.periodicity).toBeNull();
    expect(serie.disponiveis).toEqual([]);
  });

  it("as duas grandezas são oferecidas — a escolha é um gesto, não um silêncio", () => {
    const serie = pontosDeImpacto(periodos, entradas, "ANUAL");
    const comMovimento = serie.disponiveis.filter((p) => p.temMovimento);
    expect(comMovimento.map((p) => p.periodicity).sort()).toEqual(["ANUAL", "MENSAL"]);

    // E escolher a outra desenha a outra — sem somar as duas.
    const emMensal = pontosDeImpacto(periodos, entradas, "MENSAL");
    expect(emMensal.periodicity).toBe("MENSAL");
    expect(emMensal.pontos.filter((p) => p.liquido !== 0).length).toBe(5);
  });
});
