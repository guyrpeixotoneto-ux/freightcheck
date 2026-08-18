import { describe, expect, it } from "vitest";
import {
  cobertura,
  detalheDoImpacto,
  equipamentoMaisTocado,
  escreverVariacao,
  frotaTotal,
  impactosDaVigencia,
  integridade,
  maioresImpactos,
  participacao,
  pontosDeAtencao,
  qualidadeDaCobertura,
  tempoRelativo,
  ultimaImportacao,
  ultimasAlteracoes,
  variacao,
  vigenciaAnterior,
} from "../visao-geral";
import type { BalancoResumo } from "@/components/balanco/tipos";
import type {
  ChangeGroup,
  CockpitView,
  ExecutiveSummary,
  FamiliesView,
  GroupedView,
  PriorityItem,
} from "@/components/inicio/types";

/**
 * O que a Visão geral decide sozinha.
 *
 * A tela é a primeira que se abre e a que menos contexto exige de quem lê, o
 * que a torna o pior lugar do produto para um número errado: ele será lido
 * primeiro, e repetido antes de alguém abrir o detalhe. Nada aqui testa pixel.
 * O que roda são as cinco decisões que, se errarem, fazem a tela mentir com
 * aparência de total:
 *
 * 1. Somar periodicidades diferentes num ranking só.
 * 2. Mostrar zero onde não houve medição.
 * 3. Chamar de coberta a massa que a auditoria não alcança.
 * 4. Divergir do Acompanhamento sobre a mesma vigência.
 * 5. Anunciar variação contra uma base que não existe.
 */

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
    fleet: 62,
    coverage: "PARCIAL",
    coverageLabel: "1 de 62 cavalos",
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
      countedVehicles: 0,
      excludedVehicles: 0,
      excludedAmount: null,
      excludedReason: null,
    },
    natures: [],
    natureCodes: [],
    semanticsStatus: "CONFIRMED",
    semanticsLabel: "significado confirmado",
    unit: null,
    isMonetary: null,
    costClass: null,
    taxonomyName: null,
    inconclusiveReason: null,
    anomalies: [],
    formatOnly: false,
    composition: null,
    badge: "SEM_SINAL",
    badgeLabel: "Sem sinal relevante",
    ...overrides,
  };
}

function prioridade(overrides: Partial<PriorityItem> = {}): PriorityItem {
  return {
    rank: 1,
    key: "k",
    severity: "BAIXO",
    score: 3,
    reasons: [],
    diagnosis: "…",
    patternsSummary: null,
    sharePercent: 1.6,
    shareLabel: "1 de 62 cavalos",
    hasImpact: false,
    hasAnomaly: false,
    ...overrides,
  };
}

function cockpit(overrides: Partial<CockpitView> = {}): CockpitView {
  return {
    kpis: {
      changes: 267,
      parameters: 41,
      attention: 6,
      vehicles: 83,
      fleet: 144,
      impact: {
        byPeriodicity: {},
        excludedByPeriodicity: {},
        excludedChanges: 0,
        notCalculable: 62,
        calculatedChanges: 205,
      },
      hasImpact: true,
      anomalies: { groups: 0, changes: 0 },
    },
    baseline: { hasBaseline: true, seriesWithoutBaseline: [] },
    narrative: { headline: "…", sentences: [] },
    panorama: {
      bySeverity: [],
      byBadge: [],
      byEquipment: [
        { entityType: "CAVALO", equipment: "Cavalo", groups: 30, changes: 244, fleet: 78 },
        { entityType: "CARRETA", equipment: "Carreta", groups: 11, changes: 23, fleet: 66 },
      ],
      pricing: {
        calculatedChanges: 205,
        excludedChanges: 0,
        notCalculableChanges: 62,
        lockedGroups: 4,
        reasons: [],
      },
    },
    priorities: [],
    history: {
      comparisons: 16,
      from: null,
      to: null,
      byPeriodicity: {},
      sufficient: true,
    },
    ...overrides,
  };
}

function vigencia(overrides: Partial<GroupedView> = {}): GroupedView {
  const impact = {
    byPeriodicity: { MENSAL: -39936.28 },
    excludedByPeriodicity: {},
    excludedChanges: 0,
    notCalculable: 62,
    calculatedChanges: 205,
  };
  return {
    context: {
      scopeHash: "h",
      channel: "EMPURRADA",
      label: "CAMAÇARI · EMPURRADA",
      scopes: [{ scopeType: "UNIDADE", code: "BR04", name: "Camaçari" }],
      latestPeriod: "2026-08-01",
      periods: 9,
    },
    otherContexts: [],
    period: "2026-08-01",
    periodLabel: "agosto de 2026",
    periods: [
      { date: "2026-06-01", label: "junho de 2026", series: [] },
      { date: "2026-07-01", label: "julho de 2026", series: [] },
      { date: "2026-08-01", label: "agosto de 2026", series: [] },
    ],
    series: [],
    missingSeries: [],
    complete: true,
    totals: {
      changes: 267,
      groups: 41,
      vehiclesTouched: 83,
      entitiesAdded: 0,
      entitiesRemoved: 0,
      unchanged: 0,
      inconclusive: 62,
    },
    impact,
    accumulated: { ...impact, comparisons: 16, from: null, to: null },
    groups: [],
    cockpit: cockpit(),
    ...overrides,
  };
}

function balanco(overrides: Partial<BalancoResumo> = {}): BalancoResumo {
  return {
    importRunId: "run",
    filename: "Modelo_Cavalo.xlsx",
    contentSha256: "a".repeat(64),
    status: "PROMOTED",
    recebidoEm: "2026-08-14T10:42:00.000Z",
    entrada: 1000,
    entradaRegistrada: 1000,
    capturaConfere: true,
    destinos: [],
    porNatureza: { FATO: 800, OUTRO_PAPEL: 150, DESCARTE: 40, PERDA: 10, RESIDUO: 0 },
    residuo: 0,
    fecha: true,
    ...overrides,
  };
}

describe("impacto", () => {
  it("lista uma linha por periodicidade, a maior em módulo primeiro", () => {
    const view = vigencia({
      impact: {
        byPeriodicity: { ANUAL: -5000, MENSAL: -39936.28 },
        excludedByPeriodicity: {},
        excludedChanges: 0,
        notCalculable: 0,
        calculatedChanges: 10,
      },
    });
    expect(impactosDaVigencia(view).map((i) => i.periodicity)).toEqual(["MENSAL", "ANUAL"]);
  });

  it("não inventa linha quando não há impacto apurado", () => {
    const view = vigencia({
      impact: {
        byPeriodicity: {},
        excludedByPeriodicity: {},
        excludedChanges: 0,
        notCalculable: 62,
        calculatedChanges: 0,
      },
    });
    expect(impactosDaVigencia(view)).toEqual([]);
  });
});

describe("variação contra a vigência anterior", () => {
  it("encontra a anterior imediata, e não a mais antiga", () => {
    expect(vigenciaAnterior(vigencia())?.date).toBe("2026-07-01");
  });

  it("devolve nulo quando a aberta é a primeira do histórico", () => {
    const view = vigencia({
      period: "2026-06-01",
      periods: [{ date: "2026-06-01", label: "junho de 2026", series: [] }],
    });
    expect(vigenciaAnterior(view)).toBeNull();
  });

  it("recusa a divisão quando não há base — nada de +∞%", () => {
    expect(variacao(267, 0)).toBeNull();
    expect(variacao(267, null)).toBeNull();
    expect(variacao(267, undefined)).toBeNull();
  });

  it("escreve o sinal por extenso, sem casas decimais", () => {
    expect(escreverVariacao(variacao(267, 217)!)).toBe("+23%");
    expect(escreverVariacao(variacao(217, 267)!)).toBe("−19%");
  });

  it("não devolve proporção sem denominador", () => {
    expect(participacao(83, 0)).toBeNull();
    expect(participacao(83, 144)).toBeCloseTo(57.6, 1);
  });
});

describe("cobertura auditada", () => {
  it("conta descarte e outro papel como cobertos, e perda e resíduo como fora", () => {
    const resultado = cobertura([balanco()])!;
    // 1000 células, 10 de perda e 0 de resíduo ficam de fora.
    expect(resultado.foraDaAuditoria).toBe(10);
    expect(resultado.percentual).toBeCloseTo(99, 5);
  });

  it("some em vez de mostrar 0% quando não houve importação nenhuma", () => {
    expect(cobertura([])).toBeNull();
    expect(cobertura(null)).toBeNull();
  });

  it("não deixa o resíduo empurrar a qualidade para cima", () => {
    const comResiduo = cobertura([
      balanco({
        porNatureza: { FATO: 800, OUTRO_PAPEL: 150, DESCARTE: 0, PERDA: 0, RESIDUO: 50 },
        residuo: 50,
        fecha: false,
      }),
    ])!;
    expect(comResiduo.percentual).toBeCloseTo(95, 5);
  });

  it("adjetiva pelos cortes escritos, e nunca elogia o que o número não sustenta", () => {
    expect(qualidadeDaCobertura(99.4).palavra).toBe("Excelente");
    expect(qualidadeDaCobertura(96).palavra).toBe("Alta");
    expect(qualidadeDaCobertura(90).tom).toBe("atencao");
    expect(qualidadeDaCobertura(60).tom).toBe("grave");
  });
});

describe("integridade", () => {
  it("acusa a massa sem destino antes de qualquer outra coisa", () => {
    const resultado = integridade([balanco({ residuo: 12, fecha: false })])!;
    expect(resultado.ok).toBe(false);
    expect(resultado.detalhe).toBe("12 células sem destino");
  });

  it("separa 'não fecha' de 'sumiu massa' — mandam procurar em lugares diferentes", () => {
    const resultado = integridade([balanco({ residuo: 0, fecha: false })])!;
    expect(resultado.ok).toBe(false);
    expect(resultado.detalhe).toBe("1 importação não fecha");
  });

  it("sem importação nenhuma não afirma integridade", () => {
    expect(integridade([])).toBeNull();
  });
});

describe("última importação", () => {
  it("só considera o que chegou ao canônico", () => {
    const runs = [
      { importRunId: "a", status: "PROMOTED", filename: "antiga.xlsx", receivedAt: "2026-08-14T08:00:00.000Z" },
      { importRunId: "b", status: "PREVIEWED", filename: "nova.xlsx", receivedAt: "2026-08-14T11:00:00.000Z" },
    ];
    const agora = new Date("2026-08-14T10:00:00.000Z");
    expect(ultimaImportacao(runs, agora)?.filename).toBe("antiga.xlsx");
  });

  it("sem nenhuma promovida, não há última importação", () => {
    expect(ultimaImportacao([{ importRunId: "b", status: "FAILED", filename: "x.xlsx", receivedAt: "2026-08-14T11:00:00.000Z" }])).toBeNull();
    expect(ultimaImportacao([])).toBeNull();
  });

  it("passa de uma semana e vira data, para não obrigar a conta de volta", () => {
    const agora = new Date("2026-08-14T12:00:00.000Z");
    expect(tempoRelativo(new Date("2026-08-14T11:00:00.000Z"), agora)).toBe("há 1h");
    expect(tempoRelativo(new Date("2026-08-14T11:30:00.000Z"), agora)).toBe("há 30min");
    expect(tempoRelativo(new Date("2026-08-13T12:00:00.000Z"), agora)).toBe("ontem");
    expect(tempoRelativo(new Date("2026-08-10T12:00:00.000Z"), agora)).toBe("há 4 dias");
    expect(tempoRelativo(new Date("2026-06-01T12:00:00.000Z"), agora)).toContain("01/06/2026");
  });
});

describe("maiores impactos", () => {
  const summary = (parametros: ExecutiveSummary["topParameters"]): ExecutiveSummary => ({
    impact: {
      byPeriodicity: {},
      excludedByPeriodicity: {},
      excludedChanges: 0,
      notCalculable: 0,
      calculatedChanges: 0,
    },
    lossesByPeriodicity: {},
    gainsByPeriodicity: {},
    changes: 0,
    groups: 0,
    critical: 0,
    locked: 0,
    notCalculable: 0,
    vehiclesTouched: 0,
    topParameters: parametros,
    topVehicles: [],
  });

  it("ranqueia dentro de uma periodicidade só, e nomeia as que ficaram de fora", () => {
    const ranking = maioresImpactos(
      summary([
        { key: "ipva", name: "IPVA", family: "F", familyName: "Impostos", changes: 1, byPeriodicity: { MENSAL: -18420 } },
        { key: "seg", name: "Seguro", family: "F", familyName: "Seguros", changes: 1, byPeriodicity: { MENSAL: -8910 } },
        { key: "pneu", name: "Pneus", family: "F", familyName: "Manutenção", changes: 1, byPeriodicity: { ANUAL: -2100 } },
      ]),
    )!;

    expect(ranking.periodicity).toBe("MENSAL");
    expect(ranking.linhas.map((l) => l.key)).toEqual(["ipva", "seg"]);
    expect(ranking.outras).toEqual(["ANUAL"]);
  });

  it("a barra é proporção dentro do ranking, não do total do mundo", () => {
    const ranking = maioresImpactos(
      summary([
        { key: "a", name: "A", family: "F", familyName: "F", changes: 1, byPeriodicity: { MENSAL: -1000 } },
        { key: "b", name: "B", family: "F", familyName: "F", changes: 1, byPeriodicity: { MENSAL: 250 } },
      ]),
    )!;
    expect(ranking.linhas[0].proporcao).toBe(1);
    expect(ranking.linhas[1].proporcao).toBe(0.25);
  });

  it("sem parâmetro com impacto, não há pódio", () => {
    expect(maioresImpactos(summary([]))).toBeNull();
    expect(maioresImpactos(undefined)).toBeNull();
  });
});

describe("de onde vem um número do pódio", () => {
  /*
    Um parâmetro com as três coisas que o painel precisa distinguir: o que soma
    no número (dois grupos MENSAL), o que fica de fora por dupla contagem, e o
    que ficou sem preço. O terceiro grupo é ANUAL de propósito — é a linha que,
    se entrasse na soma, faria o painel cometer exatamente a soma entre
    periodicidades que o pódio existe para recusar.
  */
  const comFamilias = (): FamiliesView => ({
    ...vigencia(),
    summary: {
      impact: vigencia().impact,
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
    },
    families: [
      {
        code: "AQUISICAO",
        name: "Aquisição e financiamento",
        origin: "FREIGHTECH",
        note: "",
        parametersWithData: 4,
        parametersChanged: 1,
        changes: 12,
        vehicles: 9,
        impact: {
          byPeriodicity: { MENSAL: 26856, ANUAL: -1200 },
          excludedByPeriodicity: { MENSAL: -400 },
          excludedChanges: 2,
          notCalculable: 3,
          calculatedChanges: 9,
        },
        critical: 1,
        locked: 0,
        parameters: [
          {
            key: "AQUISICAO|Financiamento",
            name: "Financiamento",
            family: "AQUISICAO",
            pending: null,
            changes: 12,
            vehicles: 9,
            impact: {
              byPeriodicity: { MENSAL: 26856, ANUAL: -1200 },
              excludedByPeriodicity: { MENSAL: -400 },
              excludedChanges: 2,
              notCalculable: 3,
              calculatedChanges: 9,
            },
            groups: [
              grupo({
                key: "g-pequeno",
                attributeCode: "cavalo.financiamento",
                impact: {
                  confidence: "CALCULATED",
                  amount: 6856,
                  periodicity: "MENSAL",
                  reason: null,
                  countedVehicles: 2,
                  excludedVehicles: 0,
                  excludedAmount: null,
                  excludedReason: null,
                },
              }),
              grupo({
                key: "g-grande",
                attributeCode: "cavalo.financiamento",
                impact: {
                  confidence: "CALCULATED",
                  amount: 20000,
                  periodicity: "MENSAL",
                  reason: null,
                  countedVehicles: 5,
                  excludedVehicles: 2,
                  excludedAmount: -400,
                  excludedReason: "coberto pelas parcelas",
                },
              }),
              grupo({
                key: "g-anual",
                attributeCode: "cavalo.financiamento",
                impact: {
                  confidence: "CALCULATED",
                  amount: -1200,
                  periodicity: "ANUAL",
                  reason: null,
                  countedVehicles: 1,
                  excludedVehicles: 0,
                  excludedAmount: null,
                  excludedReason: null,
                },
              }),
            ],
          },
        ],
      },
    ],
    freightechSemDado: [],
  });

  it("os grupos que somam no número são só os da periodicidade pedida", () => {
    const detalhe = detalheDoImpacto(comFamilias(), "AQUISICAO|Financiamento", "MENSAL")!;
    expect(detalhe.amount).toBe(26856);
    expect(detalhe.grupos.map((g) => g.key)).toEqual(["g-grande", "g-pequeno"]);
    expect(detalhe.veiculosContados).toBe(7);
    expect(detalhe.resto).toBe(0);
  });

  it("a outra periodicidade aparece nomeada, e nunca somada", () => {
    const detalhe = detalheDoImpacto(comFamilias(), "AQUISICAO|Financiamento", "MENSAL")!;
    expect(detalhe.outras).toEqual([{ periodicity: "ANUAL", amount: -1200 }]);
  });

  it("o que ficou de fora do número é dito, e não some na diferença", () => {
    const detalhe = detalheDoImpacto(comFamilias(), "AQUISICAO|Financiamento", "MENSAL")!;
    expect(detalhe.semPreco).toBe(3);
    expect(detalhe.excluido).toEqual({ alteracoes: 2, valor: -400 });
  });

  it("a diferença entre a soma dos grupos e o número publicado fica exposta", () => {
    const view = comFamilias();
    view.families[0].parameters[0].impact.byPeriodicity.MENSAL = 27000;
    const detalhe = detalheDoImpacto(view, "AQUISICAO|Financiamento", "MENSAL")!;
    expect(detalhe.resto).toBe(144);
  });

  it("com um código de atributo só, o link leva o filtro; com dois, não leva", () => {
    expect(
      detalheDoImpacto(comFamilias(), "AQUISICAO|Financiamento", "MENSAL")!.attributeCode,
    ).toBe("cavalo.financiamento");

    const view = comFamilias();
    view.families[0].parameters[0].groups[0].attributeCode = "carreta.financiamento";
    expect(detalheDoImpacto(view, "AQUISICAO|Financiamento", "MENSAL")!.attributeCode).toBeNull();
  });

  it("periodicidade que o parâmetro não tem cai na de maior módulo, e não em nada", () => {
    const detalhe = detalheDoImpacto(comFamilias(), "AQUISICAO|Financiamento", "SEMANAL")!;
    expect(detalhe.periodicity).toBe("MENSAL");
  });

  it("parâmetro que não está nesta vigência não abre painel nenhum", () => {
    expect(detalheDoImpacto(comFamilias(), "AQUISICAO|Inexistente", "MENSAL")).toBeNull();
    expect(detalheDoImpacto(comFamilias(), null, "MENSAL")).toBeNull();
    expect(detalheDoImpacto(null, "AQUISICAO|Financiamento", "MENSAL")).toBeNull();
  });
});

describe("o que o cockpit já respondeu", () => {
  it("lê a frota do cockpit, para não divergir do Acompanhamento", () => {
    expect(frotaTotal(vigencia())).toBe(144);
  });

  it("conta mudanças por equipamento, e não ativos", () => {
    expect(equipamentoMaisTocado(vigencia())).toEqual({
      nome: "Cavalo",
      // O código sai junto do nome porque é ele que viaja no link para
      // Alterações: "Cavalo" é como se lê, `CAVALO` é como o servidor filtra.
      entityType: "CAVALO",
      mudancas: 244,
    });
  });

  it("sem equipamento com mudança, não elege nenhum", () => {
    const view = vigencia({
      cockpit: cockpit({
        panorama: {
          ...cockpit().panorama,
          byEquipment: [
            { entityType: "CAVALO", equipment: "Cavalo", groups: 0, changes: 0, fleet: 78 },
          ],
        },
      }),
    });
    expect(equipamentoMaisTocado(view)).toBeNull();
  });

  it("a lista segue a fila de prioridade, e não a ordem dos grupos", () => {
    const view = vigencia({
      groups: [grupo({ key: "b", title: "Segundo" }), grupo({ key: "a", title: "Primeiro" })],
      cockpit: cockpit({
        priorities: [prioridade({ key: "a", rank: 1 }), prioridade({ key: "b", rank: 2 })],
      }),
    });
    expect(ultimasAlteracoes(view).map((l) => l.chave)).toEqual(["a", "b"]);
  });

  it("fila vazia não apaga as alterações da vigência", () => {
    const view = vigencia({ groups: [grupo({ key: "a" })], cockpit: cockpit({ priorities: [] }) });
    expect(ultimasAlteracoes(view)).toHaveLength(1);
  });

  it("distingue queda, alta e mudança sem preço", () => {
    const view = vigencia({
      groups: [
        grupo({
          key: "queda",
          title: "IPVA",
          impact: {
            confidence: "CALCULATED",
            amount: -18420,
            periodicity: "MENSAL",
            reason: null,
            countedVehicles: 61,
            excludedVehicles: 0,
            excludedAmount: null,
            excludedReason: null,
          },
        }),
        grupo({
          key: "alta",
          title: "Manutenção",
          impact: {
            confidence: "CALCULATED",
            amount: 5240,
            periodicity: "MENSAL",
            reason: null,
            countedVehicles: 44,
            excludedVehicles: 0,
            excludedAmount: null,
            excludedReason: null,
          },
        }),
        grupo({
          key: "travado",
          title: "Seguro",
          impact: {
            confidence: "NOT_CALCULABLE",
            amount: null,
            periodicity: null,
            reason: "preço não localizado",
            countedVehicles: 0,
            excludedVehicles: 0,
            excludedAmount: null,
            excludedReason: null,
          },
        }),
      ],
    });

    const linhas = ultimasAlteracoes(view);
    expect(linhas.map((l) => l.tipo)).toEqual(["queda", "alta", "sem-preco"]);
    expect(linhas[0].titulo).toBe("Valor reduzido em IPVA — Cavalo");
    expect(linhas[1].titulo).toBe("Valor aumentado em Manutenção — Cavalo");
    expect(linhas[2].titulo).toBe("Mudança sem preço — Seguro — Cavalo");
    expect(linhas[2].detalhe).toBe("preço não localizado");
  });
});

/**
 * Para onde cada número desta tela leva.
 *
 * O defeito que estes casos impedem não é um link quebrado — é o link que abre
 * uma população **diferente da que foi clicada**. Quem lê 62 alterações sem
 * preço em julho e cai numa lista de agosto com outro total não conclui que
 * errou de link: conclui que uma das duas telas está mentindo, e não tem como
 * saber qual.
 */
describe("o caminho até as Alterações", () => {
  const recorte = { period: "2026-07-01", scopeHash: "h", canal: "EMPURRADA" };

  const consulta = (href: string) =>
    new URLSearchParams(href.split("?")[1] ?? "");

  const familias = (view = vigencia()): FamiliesView => ({
    ...view,
    summary: {
      impact: view.impact,
      lossesByPeriodicity: {},
      gainsByPeriodicity: {},
      changes: 0,
      groups: 0,
      critical: 0,
      locked: 0,
      notCalculable: view.impact.notCalculable,
      vehiclesTouched: 0,
      topParameters: [],
      topVehicles: [],
    },
    families: [],
    freightechSemDado: [],
  });

  it("as mudanças sem preço abrem as próprias linhas, filtradas", () => {
    const ponto = pontosDeAtencao(familias(), null, null, recorte).find(
      (p) => p.chave === "sem-preco",
    )!;
    expect(ponto.href.startsWith("/alteracoes?")).toBe(true);
    expect(consulta(ponto.href).get("impactConfidence")).toBe("NOT_CALCULABLE");
  });

  it("o equipamento mais tocado recorta dentro da vigência, e não troca de série", () => {
    // `entityType` filtra as linhas do período aberto; `serie` trocaria a
    // comparação por "a mais recente do cavalo", que pode ser outro mês.
    const ponto = pontosDeAtencao(familias(), null, null, recorte).find(
      (p) => p.chave === "equipamento",
    )!;
    expect(consulta(ponto.href).get("entityType")).toBe("CAVALO");
    expect(consulta(ponto.href).has("serie")).toBe(false);
  });

  it("a vigência que viaja é a que o servidor respondeu, não a que a URL pediu", () => {
    // Quem abre a Visão geral sem escolher nada está lendo uma vigência mesmo
    // assim. Mandar o recorte vazio faria o outro lado escolher de novo, por
    // conta própria, e possivelmente outra.
    const ponto = pontosDeAtencao(familias(), null, null)[0];
    expect(consulta(ponto.href).get("period")).toBe("2026-08-01");
  });

  it("sem alteração sem preço, o ponto deixa de ser uma lista e vira a Curadoria", () => {
    const view = familias(
      vigencia({
        impact: {
          byPeriodicity: {},
          excludedByPeriodicity: {},
          excludedChanges: 0,
          notCalculable: 0,
          calculatedChanges: 0,
        },
      }),
    );
    const ponto = pontosDeAtencao(view, null, null, recorte).find(
      (p) => p.chave === "sem-preco",
    )!;
    // Filtrar por "sem impacto" uma vigência sem nenhuma devolveria zero linhas,
    // e zero linhas depois de um clique lê-se como defeito da tela.
    expect(ponto.href).toBe("/curadoria");
  });

  it("cada alteração em destaque leva o seu próprio recorte", () => {
    const view = vigencia({
      groups: [grupo({ key: "a", attributeCode: "cavalo.ipva", entityType: "CAVALO" })],
      cockpit: cockpit({ priorities: [] }),
    });
    const [linha] = ultimasAlteracoes(view, 4, recorte);
    expect(consulta(linha.href).get("attributeCode")).toBe("cavalo.ipva");
    expect(consulta(linha.href).get("entityType")).toBe("CAVALO");
    expect(consulta(linha.href).get("period")).toBe("2026-08-01");
    expect(consulta(linha.href).get("scopeHash")).toBe("h");
  });

  it("grupo sem atributo não inventa filtro", () => {
    // Um ativo que entrou ou uma coluna que sumiu não têm `attributeCode`.
    // `attributeCode=null` no endereço devolveria zero linhas.
    const view = vigencia({
      groups: [grupo({ key: "a", attributeCode: null, entityType: null })],
      cockpit: cockpit({ priorities: [] }),
    });
    const [linha] = ultimasAlteracoes(view, 4, recorte);
    expect(consulta(linha.href).has("attributeCode")).toBe(false);
    expect(consulta(linha.href).has("entityType")).toBe(false);
    expect(consulta(linha.href).get("period")).toBe("2026-08-01");
  });
});
