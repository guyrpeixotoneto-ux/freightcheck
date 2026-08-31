import { describe, expect, it } from "vitest";
import {
  coberturaApurada,
  extremosDaSerie,
  filtrarMudancas,
  frasesDaCobertura,
  mancheteApurada,
  mudancasRelevantes,
  ondeAgirAgora,
  outrasPeriodicidades,
  perdasParaAuditar,
  ponteDoImpacto,
  valorDaMudanca,
} from "../impacto-apurado";
import { consultaDoRecorte } from "../leitura-da-vigencia";
import { linhasDaPonte } from "@/components/impacto-apurado/ponte-do-impacto";
import { recorteDaJanela, type PontoDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import type { ItemCockpit } from "../cockpit";
import type {
  ChangeGroup,
  CockpitView,
  ExecutiveSummary,
  FamiliesView,
  ImpactContributor,
  ImpactSummary,
  PriorityItem,
} from "@/components/inicio/types";

/**
 * O que o Impacto Apurado decide sozinho.
 *
 * A tela publica o número que vai para a reunião, e a régua deste arquivo é a
 * mesma da Visão geral: nada aqui testa pixel — testam-se as decisões que, se
 * errarem, fazem a tela mentir com aparência de total.
 *
 * 1. **A manchete tem de fechar com os dois lados.** `ganhos + perdas` é o
 *    líquido, sempre, e é a mesma varredura do servidor que produz os três.
 * 2. **A ponte tem de reconciliar com a manchete.** Uma escada que soma
 *    R$ 21.930 debaixo de um número que diz R$ 21.931 é pior que nenhuma
 *    escada.
 * 3. **Cobertura é fração de população, não de dinheiro** — precificadas sobre
 *    elegíveis, com `apurado + semPreco = total`.
 * 4. **Zero não é ausência.** Sem preço apurado a tela devolve `null` e escreve
 *    "sem valor apurado"; um R$ 0 diria que a apuração deu zero.
 * 5. **O ranking é pelo dinheiro, não pela contagem.**
 * 6. **A autorização não se amplia pela URL** — o recorte que viaja ao servidor
 *    é uma lista fechada de três chaves.
 */

// ---------------------------------------------------------------------------
// Fixtures — a forma do servidor, e não uma cópia conveniente dela
// ---------------------------------------------------------------------------

function impacto(parcial: Partial<ImpactSummary> = {}): ImpactSummary {
  const oficial = parcial.byPeriodicity ?? {};
  return {
    byPeriodicity: oficial,
    brutoByPeriodicity: oficial,
    rastro: { brutoByPeriodicity: oficial, degraus: [], oficialByPeriodicity: oficial },
    excludedChanges: 0,
    calculatedChanges: 0,
    notCalculable: 0,
    ...parcial,
  };
}

function contribuinte(
  key: string,
  familia: string,
  amount: number,
  extras: Partial<ImpactContributor> = {},
): ImpactContributor {
  return {
    key,
    name: key,
    family: familia,
    familyName: familia,
    changes: 1,
    vehicles: 1,
    amount,
    ...extras,
  };
}

/**
 * Uma vigência com dois lados que fecham — a base de quase todo teste daqui.
 *
 * `AQUISICAO` sobe R$ 26.583 e desce R$ 4.652; `PEDAGIO` só desce. O líquido é
 * R$ 21.931, que é o número da manchete — os mesmos valores da tela de
 * referência, para que a leitura do teste e a da tela sejam a mesma leitura.
 */
function resumo(overrides: Partial<ExecutiveSummary> = {}): Pick<FamiliesView, "summary"> {
  return {
    summary: {
      impact: impacto({ byPeriodicity: { MENSAL: 21931 }, calculatedChanges: 7, notCalculable: 95 }),
      lossesByPeriodicity: { MENSAL: -4652 },
      gainsByPeriodicity: { MENSAL: 26583 },
      sides: [
        {
          periodicity: "MENSAL",
          net: 21931,
          gains: {
            total: 26583,
            changes: 5,
            vehicles: 40,
            parameters: [
              contribuinte("financiamento", "AQUISICAO", 18742, { changes: 3, vehicles: 24 }),
              contribuinte("frete", "FRETE", 6841, { changes: 1, vehicles: 12 }),
              contribuinte("outros", "AQUISICAO", 1000, { changes: 1, vehicles: 4 }),
            ],
          },
          losses: {
            total: -4652,
            changes: 3,
            vehicles: 9,
            parameters: [
              contribuinte("promocao", "COMERCIAL", -3012, { changes: 1, vehicles: 5 }),
              contribuinte("financiamento", "AQUISICAO", -1640, { changes: 2, vehicles: 4 }),
            ],
          },
        },
      ],
      changes: 102,
      groups: 16,
      critical: 0,
      locked: 0,
      notCalculable: 95,
      vehiclesTouched: 80,
      topParameters: [],
      topVehicles: [],
      ...overrides,
    },
  };
}

function grupo(overrides: Partial<ChangeGroup> = {}): ChangeGroup {
  return {
    key: "k",
    attributeCode: "cavalo.qualquer",
    title: "Qualquer coisa",
    entityType: "CAVALO",
    equipment: "Cavalo",
    changeType: "VALUE_CHANGED",
    category: "SOURCE_CHANGE",
    comparability: "COMPARABLE",
    changes: 1,
    vehicles: 1,
    entityIds: [],
    fleet: 62,
    coverage: "PARCIAL",
    coverageLabel: "1 de 62",
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
      confidence: "CALCULATED",
      amount: -1200,
      periodicity: "MENSAL",
      reason: null,
      countedVehicles: 1,
      excludedVehicles: 0,
      excludedAmount: null,
      excludedReason: null,
    },
    natures: [],
    natureCodes: [],
    semanticsStatus: "CONFIRMED",
    semanticsLabel: "confirmado",
    unit: null,
    isMonetary: true,
    costClass: null,
    taxonomyName: null,
    inconclusiveReason: null,
    anomalies: [],
    formatOnly: false,
    composition: null,
    badge: "DINHEIRO",
    badgeLabel: "Dinheiro",
    ...overrides,
  };
}

function prioridade(overrides: Partial<PriorityItem> = {}): PriorityItem {
  return {
    rank: 1,
    key: "k",
    severity: "CRITICO",
    score: 90,
    reasons: [],
    diagnosis: "…",
    patternsSummary: null,
    sharePercent: null,
    shareLabel: "",
    hasImpact: true,
    hasAnomaly: false,
    ...overrides,
  };
}

function vigencia(overrides: Partial<FamiliesView> = {}): FamiliesView {
  const base = resumo();
  return {
    ...(base as unknown as FamiliesView),
    context: {
      scopeHash: "hash-pe",
      channel: "EMPURRADA",
      label: "PERNAMBUCO · EMPURRADA",
      scopes: [{ scopeType: "UNIDADE", code: "BR07", name: "Pernambuco" }],
      latestPeriod: "2026-08-01",
      periods: 6,
      periodosDisponiveis: [],
    },
    otherContexts: [],
    period: "2026-08-01",
    periodLabel: "agosto de 2026",
    periods: [],
    composicao: { tipos: [] },
    series: [],
    missingSeries: [],
    complete: true,
    totals: {
      changes: 102,
      formatOnlyChanges: 0,
      groups: 16,
      vehiclesTouched: 80,
      entitiesAdded: 0,
      entitiesRemoved: 0,
      unchanged: 0,
      inconclusive: 0,
    },
    entityIdsTouched: [],
    impact: impacto({
      byPeriodicity: { MENSAL: 21931 },
      calculatedChanges: 7,
      notCalculable: 95,
    }),
    accumulated: { ...impacto(), comparisons: 6, from: null, to: null },
    groups: [],
    families: [],
    freightechSemDado: [],
    cockpit: {
      baseline: { hasBaseline: true, seriesWithoutBaseline: [] },
    } as unknown as CockpitView,
    ...overrides,
  } as FamiliesView;
}

const ponto = (periodo: string, liquido: number): PontoDeImpacto => ({
  periodo,
  label: periodo,
  ganhos: liquido > 0 ? liquido : 0,
  perdas: liquido < 0 ? liquido : 0,
  liquido,
});

// ---------------------------------------------------------------------------
// 1. Quanto já apuramos?
// ---------------------------------------------------------------------------

describe("a manchete", () => {
  it("fecha: ganhos + perdas é o líquido apurado", () => {
    const lados = mancheteApurada(resumo())!;
    expect(lados.ganhos + lados.perdas).toBe(lados.liquido);
    expect(lados.liquido).toBe(21931);
  });

  /*
    `sides` chega do servidor ordenado pelo módulo do líquido
    (`families-view.ts`), e a manchete é a primeira — a periodicidade que mais
    se mexeu. O que este teste guarda é que ela **não soma** as outras: elas
    ficam nomeadas ao lado, em linha própria, como R$/mês e R$/ano ficam em
    todo o resto do produto.
  */
  it("publica uma periodicidade só, e nomeia as outras em vez de somá-las", () => {
    const view = resumo({
      sides: [
        { periodicity: "MENSAL", net: -5000, gains: lado(0), losses: lado(-5000) },
        { periodicity: "ANUAL", net: 900, gains: lado(900), losses: lado(0) },
      ],
    });
    expect(mancheteApurada(view)!.periodicity).toBe("MENSAL");
    expect(mancheteApurada(view)!.liquido).toBe(-5000);
    expect(outrasPeriodicidades(view).map((l) => l.periodicity)).toEqual(["ANUAL"]);
  });

  it("devolve nulo — e não zero — quando nada foi apurado", () => {
    expect(mancheteApurada(resumo({ sides: [] }))).toBeNull();
  });
});

function lado(total: number) {
  return { total, changes: 0, vehicles: 0, parameters: [] };
}

// ---------------------------------------------------------------------------
// 2. Posso confiar nesse número?
// ---------------------------------------------------------------------------

describe("a cobertura", () => {
  it("é precificadas sobre elegíveis, e as duas parcelas fecham com o total", () => {
    const cobertura = coberturaApurada(102, 95)!;
    expect(cobertura.apurado).toBe(7);
    expect(cobertura.apurado + cobertura.semPreco).toBe(cobertura.total);
    expect(cobertura.percentual).toBeCloseTo(6.86, 2);
  });

  it("usa a régua canônica do produto para a severidade — nenhum corte novo", () => {
    expect(coberturaApurada(100, 93)!.qualidade).toEqual({ palavra: "Baixa", tom: "grave" });
    expect(coberturaApurada(100, 10)!.qualidade).toEqual({ palavra: "Parcial", tom: "atencao" });
    expect(coberturaApurada(100, 2)!.qualidade).toEqual({ palavra: "Alta", tom: "ok" });
    expect(coberturaApurada(100, 0)!.qualidade).toEqual({ palavra: "Excelente", tom: "ok" });
  });

  it("não chama de cobertura zero a vigência sem alteração nenhuma", () => {
    expect(coberturaApurada(0, 0)).toBeNull();
  });

  it("declara o resultado parcial enquanto sobrar alteração sem preço", () => {
    expect(coberturaApurada(102, 95)!.parcial).toBe(true);
    expect(coberturaApurada(102, 0)!.parcial).toBe(false);
    expect(frasesDaCobertura(coberturaApurada(102, 95)!).titulo).toContain("Resultado parcial");
    expect(frasesDaCobertura(coberturaApurada(102, 0)!).titulo).toContain("Resultado completo");
  });
});

// ---------------------------------------------------------------------------
// 3. O que explica o resultado?
// ---------------------------------------------------------------------------

describe("a ponte", () => {
  it("reconcilia exatamente com o líquido da manchete", () => {
    const ponte = ponteDoImpacto(resumo(), "MENSAL")!;
    const soma = ponte.degraus.reduce((total, d) => total + d.valor, 0);
    expect(Number(soma.toFixed(2))).toBe(ponte.total);
    expect(ponte.total).toBe(mancheteApurada(resumo())!.liquido);
    expect(ponte.resto).toBe(0);
  });

  it("encadeia os degraus: cada um começa onde o anterior terminou", () => {
    const ponte = ponteDoImpacto(resumo(), "MENSAL")!;
    let esperado = 0;
    for (const degrau of ponte.degraus) {
      expect(degrau.base).toBe(esperado);
      expect(degrau.topo).toBe(Number((esperado + degrau.valor).toFixed(2)));
      esperado = degrau.topo;
    }
    expect(esperado).toBe(ponte.total);
  });

  it("põe o que somou antes do que tirou, cada bloco do maior para o menor", () => {
    const ponte = ponteDoImpacto(resumo(), "MENSAL")!;
    expect(ponte.degraus.map((d) => d.code)).toEqual(["AQUISICAO", "FRETE", "COMERCIAL"]);
    expect(ponte.degraus.map((d) => d.valor > 0)).toEqual([true, true, false]);
  });

  it("fecha a escada com a barra do líquido, e só ela parte do zero", () => {
    const linhas = linhasDaPonte(ponteDoImpacto(resumo(), "MENSAL")!);
    const ultima = linhas.at(-1)!;
    expect(ultima.total).toBe(true);
    expect(ultima.faixa).toEqual([0, 21931]);
    expect(linhas.filter((l) => l.total)).toHaveLength(1);
  });

  it("carrega os dois lados de cada família — o saldo esconde as parcelas", () => {
    const aquisicao = ponteDoImpacto(resumo(), "MENSAL")!.degraus[0];
    expect(aquisicao.ganhos).toBe(19742);
    expect(aquisicao.perdas).toBe(-1640);
    expect(aquisicao.valor).toBe(18102);
  });

  it("não desenha a periodicidade que a vigência não tem", () => {
    expect(ponteDoImpacto(resumo(), "ANUAL")).toBeNull();
    expect(ponteDoImpacto(resumo(), null)).toBeNull();
  });

  it("nomeia as periodicidades que ficaram de fora, em vez de somá-las", () => {
    const view = resumo({
      sides: [
        { periodicity: "MENSAL", net: 100, gains: lado(100), losses: lado(0) },
        { periodicity: "ANUAL", net: 20, gains: lado(20), losses: lado(0) },
      ],
    });
    expect(ponteDoImpacto(view, "MENSAL")!.outras).toEqual(["ANUAL"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Estamos melhorando ou piorando?
// ---------------------------------------------------------------------------

describe("a evolução por vigência", () => {
  it("aponta a melhor e a pior da janela desenhada", () => {
    const extremos = extremosDaSerie([
      ponto("2026-06-01", 12000),
      ponto("2026-07-01", -61243),
      ponto("2026-08-01", 21931),
    ])!;
    expect(extremos.melhor.periodo).toBe("2026-08-01");
    expect(extremos.pior.periodo).toBe("2026-07-01");
  });

  it("não compara uma vigência consigo mesma", () => {
    expect(extremosDaSerie([ponto("2026-08-01", 21931)])).toBeNull();
    expect(extremosDaSerie([])).toBeNull();
  });

  it("desenha uma linha por vigência — a janela não duplica nem funde vigências", () => {
    const serie = [
      ponto("2026-06-01", 1),
      ponto("2026-07-01", 2),
      ponto("2026-07-16", 3),
      ponto("2026-08-01", 4),
    ];
    const naJanela = recorteDaJanela(serie, { unidade: "vigencias", quantidade: 3 });
    expect(naJanela.map((p) => p.periodo)).toEqual(["2026-07-01", "2026-07-16", "2026-08-01"]);
    expect(new Set(naJanela.map((p) => p.periodo)).size).toBe(naJanela.length);
  });
});

// ---------------------------------------------------------------------------
// 5. Onde está o dinheiro?
// ---------------------------------------------------------------------------

describe("as principais mudanças", () => {
  it("junta os dois lados do mesmo parâmetro numa linha só", () => {
    const financiamento = mudancasRelevantes(resumo(), "MENSAL").find(
      (l) => l.key === "financiamento",
    )!;
    expect(financiamento.ganhos).toBe(18742);
    expect(financiamento.perdas).toBe(-1640);
    expect(financiamento.liquido).toBe(17102);
    expect(financiamento.doisLados).toBe(true);
  });

  it("ordena pelo dinheiro que se mexeu, e não pela quantidade de alterações", () => {
    const view = resumo({
      sides: [
        {
          periodicity: "MENSAL",
          net: 1000,
          gains: {
            total: 40300,
            changes: 101,
            vehicles: 101,
            parameters: [
              contribuinte("gigante", "A", 40000, { changes: 1, vehicles: 1 }),
              contribuinte("miudo", "B", 300, { changes: 100, vehicles: 100 }),
            ],
          },
          losses: {
            total: -39300,
            changes: 1,
            vehicles: 1,
            parameters: [contribuinte("gigante", "A", -39300, { changes: 1, vehicles: 1 })],
          },
        },
      ],
    });
    const linhas = mudancasRelevantes(view, "MENSAL");
    /*
      `gigante` tem saldo de R$ 700 e `miudo` de R$ 300 — mas `gigante` moveu
      R$ 79.300 e é o acontecimento da vigência. Ranqueado pelo saldo ele
      apareceria em segundo; pela contagem, em último.
    */
    expect(linhas.map((l) => l.key)).toEqual(["gigante", "miudo"]);
    expect(linhas[0].movimento).toBe(79300);
    expect(linhas[0].proporcao).toBe(1);
  });

  it("não conta o mesmo veículo nos dois lados do parâmetro", () => {
    const financiamento = mudancasRelevantes(resumo(), "MENSAL").find(
      (l) => l.key === "financiamento",
    )!;
    // 24 no ganho, 4 na perda: o piso honesto é 24, nunca 28.
    expect(financiamento.veiculos).toBe(24);
  });

  it("no recorte de perdas, mostra a perda de um parâmetro de saldo positivo", () => {
    const perdas = filtrarMudancas(mudancasRelevantes(resumo(), "MENSAL"), "perdas");
    expect(perdas.map((l) => l.key)).toEqual(["promocao", "financiamento"]);
    expect(valorDaMudanca(perdas[1], "perdas")).toBe(-1640);
    expect(perdas.every((l) => l.classificacao === "perda")).toBe(true);
  });

  it("no recorte de ganhos, reordena e reescala pelo lado pedido", () => {
    const ganhos = filtrarMudancas(mudancasRelevantes(resumo(), "MENSAL"), "ganhos");
    expect(ganhos.map((l) => l.key)).toEqual(["financiamento", "frete", "outros"]);
    expect(ganhos[0].proporcao).toBe(1);
    expect(valorDaMudanca(ganhos[0], "ganhos")).toBe(18742);
  });

  it("devolve lista vazia quando a vigência não tem valor apurado", () => {
    expect(mudancasRelevantes(resumo({ sides: [] }), "MENSAL")).toEqual([]);
    expect(mudancasRelevantes(resumo(), "ANUAL")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Onde agir agora?
// ---------------------------------------------------------------------------

const fila = (grupos: Partial<ChangeGroup>[], itens: Partial<PriorityItem>[] = []): ItemCockpit[] =>
  grupos.map((g, i) => ({ item: prioridade(itens[i] ?? {}), group: grupo(g) }));

describe("onde agir agora", () => {
  it("leva as alterações sem preço à população exata que contou", () => {
    const acoes = ondeAgirAgora({
      view: vigencia(),
      cobertura: coberturaApurada(102, 95),
      periodicidade: "MENSAL",
      prioridades: [],
      recorte: { period: null, scopeHash: "hash-pe", canal: "EMPURRADA" },
      comDestino: true,
    });
    const semPreco = acoes.find((a) => a.chave === "sem-preco")!;
    expect(semPreco.titulo).toContain("95");
    expect(semPreco.href).toContain("impactConfidence=NOT_CALCULABLE");
    expect(semPreco.href).toContain("period=2026-08-01");
    expect(semPreco.href).toContain("scopeHash=hash-pe");
  });

  it("não inventa alerta onde o dado não sustenta um", () => {
    const acoes = ondeAgirAgora({
      view: vigencia({ impact: impacto({ byPeriodicity: { MENSAL: 1 }, calculatedChanges: 102 }) }),
      cobertura: coberturaApurada(102, 0),
      periodicidade: "MENSAL",
      prioridades: [],
      recorte: { period: null, scopeHash: null, canal: null },
      comDestino: true,
    });
    expect(acoes).toEqual([]);
  });

  it("conta como perda relevante só o que a fila marcou como crítico ou alto", () => {
    const prioridades = fila(
      [
        { key: "a", impact: { ...grupo().impact, amount: -3000 } },
        { key: "b", impact: { ...grupo().impact, amount: -620 } },
        { key: "c", impact: { ...grupo().impact, amount: -9000 } },
        { key: "d", impact: { ...grupo().impact, amount: 5000 } },
      ],
      [{ severity: "CRITICO" }, { severity: "ALTO" }, { severity: "BAIXO" }, { severity: "CRITICO" }],
    );
    const perdas = perdasParaAuditar(prioridades, "MENSAL")!;
    expect(perdas.quantidade).toBe(2);
    expect(perdas.total).toBe(-3620);
  });

  it("não soma perdas de periodicidades diferentes", () => {
    const prioridades = fila([
      { key: "a", impact: { ...grupo().impact, amount: -3000, periodicity: "MENSAL" } },
      { key: "b", impact: { ...grupo().impact, amount: -50000, periodicity: "ANUAL" } },
    ]);
    expect(perdasParaAuditar(prioridades, "MENSAL")!.total).toBe(-3000);
  });

  it("não conta como perda a alteração sem preço apurado", () => {
    const prioridades = fila([
      {
        key: "a",
        impact: { ...grupo().impact, confidence: "NOT_CALCULABLE", amount: null },
      },
    ]);
    expect(perdasParaAuditar(prioridades, "MENSAL")).toBeNull();
  });

  it("aponta as famílias com alteração crítica pelo campo do servidor", () => {
    const acoes = ondeAgirAgora({
      view: vigencia({
        families: [
          { code: "AQUISICAO", name: "Aquisição", critical: 2 },
          { code: "FRETE", name: "Frete", critical: 0 },
        ] as unknown as FamiliesView["families"],
      }),
      cobertura: coberturaApurada(102, 0),
      periodicidade: "MENSAL",
      prioridades: [],
      recorte: { period: null, scopeHash: null, canal: null },
      comDestino: true,
    });
    const criticas = acoes.find((a) => a.chave === "familias-criticas")!;
    expect(criticas.titulo).toContain("1 família");
    expect(criticas.detalhe).toContain("2 tipos de alteração");
  });

  it("diz quando a vigência não tem anterior com que comparar", () => {
    const acoes = ondeAgirAgora({
      view: vigencia({
        cockpit: { baseline: { hasBaseline: false, seriesWithoutBaseline: [] } } as CockpitView,
        impact: impacto({ byPeriodicity: { MENSAL: 1 }, calculatedChanges: 102 }),
      }),
      cobertura: coberturaApurada(102, 0),
      periodicidade: "MENSAL",
      prioridades: [],
      recorte: { period: null, scopeHash: null, canal: null },
      comDestino: true,
    });
    expect(acoes.map((a) => a.chave)).toEqual(["sem-baseline"]);
  });

  it("não promete destino que a Visão Geral não pode honrar", () => {
    const acoes = ondeAgirAgora({
      view: vigencia(),
      cobertura: coberturaApurada(102, 95),
      periodicidade: "MENSAL",
      prioridades: [],
      recorte: { period: null, scopeHash: null, canal: null },
      comDestino: false,
    });
    expect(acoes.length).toBeGreaterThan(0);
    expect(acoes.every((a) => a.href === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// O recorte que viaja ao servidor
// ---------------------------------------------------------------------------

describe("o recorte da consulta", () => {
  it("leva unidade, canal e vigência — e nada mais", () => {
    const consulta = consultaDoRecorte(
      "?period=2026-08-01&scopeHash=hash-pe&canal=EMPURRADA&familia=AQUISICAO&mudancas=perdas",
    );
    expect([...consulta.keys()].sort()).toEqual(["canal", "period", "scopeHash"]);
  });

  /*
    O eixo que separa as quatro auditorias é carimbado pelo cliente
    (`lib/api.ts`) e conferido pelo servidor. Deixar a tela repassar um
    `?operacao=` escrito na barra de endereço faria a Auditoria Empurrada pedir
    o acervo da Rota com o menu dizendo "Empurrada" — o vazamento não sai da
    tela porque a lista é fechada, e não porque alguém lembrou de filtrar.
  */
  it("não repassa operação, empresa ou qualquer outra chave escrita na URL", () => {
    const consulta = consultaDoRecorte("?operacao=ROTA&empresaId=outra&scopeHash=hash-pe");
    expect(consulta.get("operacao")).toBeNull();
    expect(consulta.get("empresaId")).toBeNull();
    expect(consulta.get("scopeHash")).toBe("hash-pe");
  });
});
