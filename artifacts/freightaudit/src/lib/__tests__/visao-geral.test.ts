import { describe, expect, it } from "vitest";
import { formatBrlShort } from "@/lib/format";
import {
  cobertura,
  composicaoDasAlteracoes,
  composicaoDoImpacto,
  detalheDaAlteracao,
  detalheDoImpacto,
  equipamentoMaisTocado,
  escreverVariacao,
  frotaTotal,
  impactosDaVigencia,
  integridade,
  ladosDoImpacto,
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
  ImpactSummary,
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

/**
 * Um resumo de impacto na forma que o servidor envia — a de `ResumoDeImpacto`.
 *
 * Os mocks daqui carregavam um campo (`excludedByPeriodicity`) que a API tinha
 * deixado de enviar, e a suíte verde escondeu um crash de produção. O construtor
 * é tipado contra o tipo do servidor: se o contrato mudar de novo, é aqui que o
 * typecheck e a suíte quebram — antes da tela.
 */
function impacto(
  parcial: {
    byPeriodicity?: Record<string, number>;
    excluido?: Record<string, number>;
    excludedChanges?: number;
    notCalculable?: number;
    calculatedChanges?: number;
  } = {},
): ImpactSummary {
  const oficial = parcial.byPeriodicity ?? {};
  const removido = parcial.excluido ?? {};
  const bruto: Record<string, number> = { ...oficial };
  for (const [balde, valor] of Object.entries(removido)) {
    bruto[balde] = (bruto[balde] ?? 0) + valor;
  }
  return {
    byPeriodicity: oficial,
    brutoByPeriodicity: bruto,
    rastro: {
      brutoByPeriodicity: bruto,
      degraus: [
        {
          etapa: "COMPOSICAO",
          rotulo: "duplicidades por composição",
          removidoByPeriodicity: removido,
          mudancasRemovidas: parcial.excludedChanges ?? 0,
          subtotalByPeriodicity: oficial,
        },
        {
          etapa: "ESCOPO_DE_CONJUNTO",
          rotulo: "duplicidades entre escopos cavalo↔carreta",
          removidoByPeriodicity: {},
          mudancasRemovidas: 0,
          subtotalByPeriodicity: oficial,
        },
      ],
      oficialByPeriodicity: oficial,
    },
    excludedChanges: parcial.excludedChanges ?? 0,
    notCalculable: parcial.notCalculable ?? 0,
    calculatedChanges: parcial.calculatedChanges ?? 0,
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
      impact: impacto({ notCalculable: 62, calculatedChanges: 205 }),
      hasImpact: true,
      anomalies: { groups: 0, changes: 0, formatOnlyGroups: 0, formatOnlyChanges: 0 },
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
  const impact = impacto({
    byPeriodicity: { MENSAL: -39936.28 },
    notCalculable: 62,
    calculatedChanges: 205,
  });
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
      formatOnlyChanges: 0,
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
      impact: impacto({
        byPeriodicity: { ANUAL: -5000, MENSAL: -39936.28 },
        calculatedChanges: 10,
      }),
    });
    expect(impactosDaVigencia(view).map((i) => i.periodicity)).toEqual(["MENSAL", "ANUAL"]);
  });

  it("não inventa linha quando não há impacto apurado", () => {
    const view = vigencia({
      impact: impacto({ notCalculable: 62 }),
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
    impact: impacto(),
    lossesByPeriodicity: {},
    gainsByPeriodicity: {},
    sides: [],
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

/**
 * Os dois lados do impacto.
 *
 * O líquido é uma subtração, e uma subtração esconde as duas parcelas: a mesma
 * frase descreve uma vigência calma e uma em que dois movimentos grandes quase
 * se anularam. O que roda aqui são as três maneiras de essa leitura mentir:
 *
 * 1. Publicar um total que não é a soma da lista que o explica.
 * 2. Somar periodicidades diferentes para produzir "o positivo da vigência".
 * 3. Desenhar uma balança onde não houve movimento apurável.
 */
describe("os dois lados do impacto", () => {
  const lado = (
    total: number,
    parametros: { key: string; name: string; amount: number; changes?: number }[],
  ) => ({
    total,
    changes: parametros.reduce((soma, p) => soma + (p.changes ?? 1), 0),
    vehicles: parametros.length,
    parameters: parametros.map((p) => ({
      key: p.key,
      name: p.name,
      family: "AQUISICAO",
      familyName: "Aquisição e financiamento",
      changes: p.changes ?? 1,
      vehicles: 1,
      amount: p.amount,
    })),
  });

  const comLados = (sides: FamiliesView["summary"]["sides"]): FamiliesView => ({
    ...vigencia({
      impact: impacto({
        byPeriodicity: Object.fromEntries(sides.map((s) => [s.periodicity, s.net])),
        excluido: { MENSAL: -400 },
        excludedChanges: 2,
        notCalculable: 62,
        calculatedChanges: 205,
      }),
    }),
    summary: {
      impact: impacto(),
      lossesByPeriodicity: Object.fromEntries(
        sides.filter((s) => s.losses.total !== 0).map((s) => [s.periodicity, s.losses.total]),
      ),
      gainsByPeriodicity: Object.fromEntries(
        sides.filter((s) => s.gains.total !== 0).map((s) => [s.periodicity, s.gains.total]),
      ),
      sides,
      changes: 0,
      groups: 0,
      critical: 0,
      locked: 0,
      notCalculable: 62,
      vehiclesTouched: 0,
      topParameters: [],
      topVehicles: [],
    },
    families: [],
    freightechSemDado: [],
  });

  const mensal = {
    periodicity: "MENSAL",
    net: 11916.7,
    gains: lado(19616.7, [
      { key: "AQUISICAO|Financiamento", name: "Financiamento", amount: 14938.7, changes: 5 },
      { key: "REMUNERACAO|Lucro fixo", name: "Lucro fixo", amount: 4678 },
    ]),
    losses: lado(-7700, [
      { key: "AQUISICAO|Depreciação", name: "Depreciação", amount: -7700, changes: 3 },
    ]),
  };
  const anual = {
    periodicity: "ANUAL",
    net: -2100,
    gains: lado(0, []),
    losses: lado(-2100, [{ key: "MANUTENCAO|Pneus", name: "Pneus", amount: -2100 }]),
  };

  it("publica os dois lados ao lado do líquido, e os três fecham", () => {
    const [primeiro] = ladosDoImpacto(comLados([mensal]));
    expect(primeiro.ganhos + primeiro.perdas).toBeCloseTo(primeiro.liquido, 2);
    expect(primeiro.ganhos).toBeGreaterThan(0);
    expect(primeiro.perdas).toBeLessThan(0);
  });

  it("mede movimento e não saldo na fatia da barra", () => {
    // R$ 19.616,70 subiram e R$ 7.700 desceram: 71,8% do que se mexeu foi para
    // cima. A fatia do saldo (11.916,70 ÷ 19.616,70) daria 60,7% — o número de
    // outra pergunta.
    const [primeiro] = ladosDoImpacto(comLados([mensal]));
    expect(primeiro.fatiaDeGanho).toBeCloseTo(19616.7 / (19616.7 + 7700), 4);
  });

  it("não desenha balança quando não houve movimento apurável", () => {
    expect(ladosDoImpacto(comLados([]))).toEqual([]);
    expect(ladosDoImpacto(null)).toEqual([]);
    const parado = { periodicity: "MENSAL", net: 0, gains: lado(0, []), losses: lado(0, []) };
    expect(ladosDoImpacto(comLados([parado]))[0].fatiaDeGanho).toBeNull();
  });

  it("mantém cada periodicidade na sua linha, com o seu par de lados", () => {
    const lidos = ladosDoImpacto(comLados([mensal, anual]));
    expect(lidos.map((l) => l.periodicity)).toEqual(["MENSAL", "ANUAL"]);
    expect(lidos[1].ganhos).toBe(0);
    expect(lidos[1].perdas).toBe(-2100);
  });

  describe("a balança que o cartão abre", () => {
    it("o total de cada lado é a soma exata da lista que o explica", () => {
      const balanca = composicaoDoImpacto(comLados([mensal]), "MENSAL")!;
      const somaDosGanhos = balanca.ganhos.linhas.reduce((t, l) => t + l.amount, 0);
      const somaDasPerdas = balanca.perdas.linhas.reduce((t, l) => t + l.amount, 0);
      expect(somaDosGanhos).toBeCloseTo(balanca.ganhos.total, 2);
      expect(somaDasPerdas).toBeCloseTo(balanca.perdas.total, 2);
      expect(balanca.ganhos.total + balanca.perdas.total).toBeCloseTo(balanca.liquido, 2);
    });

    it("põe as duas listas na mesma escala, porque são da mesma periodicidade", () => {
      const balanca = composicaoDoImpacto(comLados([mensal]), "MENSAL")!;
      // A maior perda (7.700) é metade do maior ganho (14.938,70): a barra dela
      // precisa terminar na metade, e não no fim de uma escala só das perdas.
      expect(balanca.ganhos.linhas[0].proporcao).toBe(1);
      expect(balanca.perdas.linhas[0].proporcao).toBeCloseTo(7700 / 14938.7, 4);
    });

    /*
      O caso real de agosto/2026: `Financiamento` subiu em quatro cavalos e caiu
      num quinto. Pelo saldo ele seria "+R$ 14.939 e mais nada", e o movimento
      contrário sumiria dentro do próprio parâmetro.
    */
    const dosDoisLados = comLados([
      {
        periodicity: "MENSAL",
        net: 11916.7,
        gains: lado(21764.05, [
          { key: "AQUISICAO|Financiamento", name: "Financiamento", amount: 17086.2, changes: 4 },
          { key: "REMUNERACAO|Lucro fixo", name: "Lucro fixo", amount: 4677.85 },
        ]),
        losses: lado(-9847.35, [
          { key: "AQUISICAO|Depreciação", name: "Depreciação", amount: -7700.16 },
          { key: "AQUISICAO|Financiamento", name: "Financiamento", amount: -2147.19 },
        ]),
      },
    ]);

    it("diz na linha quando o mesmo parâmetro está nos dois lados", () => {
      const balanca = composicaoDoImpacto(dosDoisLados, "MENSAL")!;
      const ganho = balanca.ganhos.linhas.find((l) => l.name === "Financiamento")!;
      const perda = balanca.perdas.linhas.find((l) => l.name === "Financiamento")!;

      expect(ganho.amount).toBe(17086.2);
      expect(ganho.noOutroLado).toBe(-2147.19);
      // O saldo é o número que o painel do parâmetro abre — e é ele que a linha
      // precisa antecipar, senão o clique parece trocar o número de lugar.
      expect(ganho.liquido).toBeCloseTo(14939.01, 2);
      expect(perda.noOutroLado).toBe(17086.2);
      expect(perda.liquido).toBeCloseTo(14939.01, 2);

      // E o parâmetro de um lado só não inventa a outra ponta.
      const so = balanca.perdas.linhas.find((l) => l.name === "Depreciação")!;
      expect(so.noOutroLado).toBeNull();
      expect(so.liquido).toBe(so.amount);
    });

    it("não deixa o saldo do parâmetro encolher o lado", () => {
      const balanca = composicaoDoImpacto(dosDoisLados, "MENSAL")!;
      // O ganho publicado é o que de fato subiu (21.764,05), e não a soma dos
      // saldos dos parâmetros que terminaram positivos (19.616,86).
      expect(balanca.ganhos.total).toBe(21764.05);
      expect(balanca.perdas.total).toBe(-9847.35);
      expect(balanca.ganhos.total + balanca.perdas.total).toBeCloseTo(balanca.liquido, 2);
    });

    it("ordena cada lado pelo tamanho do movimento", () => {
      const balanca = composicaoDoImpacto(comLados([mensal]), "MENSAL")!;
      expect(balanca.ganhos.linhas.map((l) => l.name)).toEqual(["Financiamento", "Lucro fixo"]);
    });

    it("abre no lado pedido, e sem pedido no lado que mais mexeu", () => {
      const view = comLados([mensal]);
      expect(composicaoDoImpacto(view, "MENSAL", "perdas")!.primeiro).toBe("perdas");
      expect(composicaoDoImpacto(view, "MENSAL")!.primeiro).toBe("ganhos");
      expect(composicaoDoImpacto(comLados([anual]), "ANUAL")!.primeiro).toBe("perdas");
      // Lado inventado na URL não vira lado: cai na régua do maior movimento.
      expect(composicaoDoImpacto(view, "MENSAL", "outro")!.primeiro).toBe("ganhos");
    });

    it("nunca soma periodicidades — as outras saem em linha própria", () => {
      const balanca = composicaoDoImpacto(comLados([mensal, anual]), "MENSAL")!;
      expect(balanca.periodicity).toBe("MENSAL");
      expect(balanca.outras.map((o) => o.periodicity)).toEqual(["ANUAL"]);
      expect(balanca.liquido).toBe(mensal.net);
    });

    it("cai na periodicidade dominante quando a pedida não está nesta vigência", () => {
      const balanca = composicaoDoImpacto(comLados([mensal]), "ANUAL")!;
      expect(balanca.periodicity).toBe("MENSAL");
    });

    it("diz o que não está na balança, em vez de deixar somar os dois lados como se fossem tudo", () => {
      const balanca = composicaoDoImpacto(comLados([mensal]), "MENSAL")!;
      expect(balanca.semPreco).toBe(62);
      expect(balanca.excluido.alteracoes).toBe(2);
      expect(balanca.excluido.valor).toBe(-400);
    });

    it("não abre balança nenhuma quando a vigência não tem impacto apurado", () => {
      expect(composicaoDoImpacto(comLados([]), "MENSAL")).toBeNull();
      expect(composicaoDoImpacto(null, "MENSAL")).toBeNull();
    });

    it("fica fechada quando a URL não pede periodicidade nenhuma", () => {
      // Sem `?composicao=` não há gaveta. Sem esta recusa, a balança nascia
      // aberta em toda visita à Visão geral, por cima da tela que ninguém pediu
      // para esconder.
      expect(composicaoDoImpacto(comLados([mensal]), null)).toBeNull();
    });
  });
});

/**
 * De onde vêm as alterações detectadas.
 *
 * O cartão publica uma contagem, e uma contagem esconde do que ela é feita. O
 * que roda aqui são as quatro maneiras de essa leitura mentir:
 *
 * 1. Publicar uma partição que não soma o número que ela explica.
 * 2. Trocar de unidade no meio — contar pontos numa seção e alterações na outra.
 * 3. Prometer um filtro que devolveria outra contagem.
 * 4. Recortar as partições junto com a lista, e deixar de fechar com o total.
 */
describe("de onde vêm as alterações detectadas", () => {
  const comFormato = (overrides: Partial<GroupedView> = {}) =>
    vigencia({
      totals: {
        changes: 267,
        formatOnlyChanges: 62,
        groups: 3,
        vehiclesTouched: 83,
        entitiesAdded: 0,
        entitiesRemoved: 0,
        unchanged: 0,
        inconclusive: 62,
      },
      groups: [
        grupo({ key: "a", title: "Combustível", changes: 124, vehicles: 62, badgeLabel: "Abrangência" }),
        grupo({
          key: "b",
          title: "Data do contrato",
          changes: 62,
          vehicles: 62,
          formatOnly: true,
          badge: "FORMATO",
          badgeLabel: "Formato da fonte",
        }),
        grupo({ key: "c", title: "Financiamento", changes: 81, vehicles: 10, badgeLabel: "Dinheiro" }),
      ],
      cockpit: cockpit({
        panorama: {
          bySeverity: [],
          byBadge: [
            { badge: "DINHEIRO", label: "Dinheiro", groups: 7, changes: 81 },
            { badge: "FORMATO", label: "Formato da fonte", groups: 1, changes: 62 },
            { badge: "COBERTURA", label: "Abrangência", groups: 2, changes: 124 },
          ],
          byEquipment: [],
          pricing: {
            calculatedChanges: 7,
            excludedChanges: 12,
            notCalculableChanges: 248,
            lockedGroups: 0,
            reasons: [],
          },
        },
      }),
      ...overrides,
    });

  const soma = (fatias: { alteracoes: number }[]) =>
    fatias.reduce((total, f) => total + f.alteracoes, 0);

  it("cada partição soma exatamente o número que ela explica", () => {
    const c = composicaoDasAlteracoes(comFormato(), "todas")!;
    expect(c.total).toBe(267);
    expect(soma(c.porEfeito)).toBe(267);
    expect(soma(c.porNatureza)).toBe(267);
    expect(soma(c.porApuracao)).toBe(267);
  });

  it("separa o que mexeu no valor do que só trocou de formato", () => {
    const c = composicaoDasAlteracoes(comFormato(), "todas")!;
    expect(c.porEfeito.map((f) => [f.chave, f.alteracoes])).toEqual([
      ["valor", 205],
      ["formato", 62],
    ]);
  });

  it("cala a partição do formato quando não houve troca de formato nenhuma", () => {
    // Uma partição de uma fatia só não parte nada — e um "100%" na tela ensina
    // a não ler a seção.
    const c = composicaoDasAlteracoes(vigencia(), "todas")!;
    expect(c.porEfeito).toEqual([]);
  });

  it("ordena a natureza do sinal por alteração, que é o que ela publica", () => {
    const c = composicaoDasAlteracoes(comFormato(), "todas")!;
    expect(c.porNatureza.map((f) => f.rotulo)).toEqual([
      "Abrangência",
      "Dinheiro",
      "Formato da fonte",
    ]);
    // O ponto viaja junto como contexto, e nunca como o número da fatia.
    expect(c.porNatureza[0].alteracoes).toBe(124);
    expect(c.porNatureza[0].pontos).toBe(2);
  });

  it("não promete filtro que devolveria outra contagem", () => {
    const c = composicaoDasAlteracoes(comFormato(), "todas")!;
    const porChave = new Map(c.porApuracao.map((f) => [f.chave, f]));
    // `impactConfidence=CALCULATED` devolveria as 19 — as 7 mais as 12 que
    // saíram por dupla contagem. Sem filtro exato, sem link.
    expect(porChave.get("apurado")!.href).toBeNull();
    expect(porChave.get("excluido")!.href).toBeNull();
    expect(porChave.get("sem-preco")!.href).toContain("impactConfidence=NOT_CALCULABLE");
  });

  it("leva o recorte da vigência no único link que existe", () => {
    const c = composicaoDasAlteracoes(comFormato(), "todas", {
      period: "2026-07-01",
      scopeHash: "h",
      canal: "EMPURRADA",
    })!;
    const query = new URLSearchParams(
      c.porApuracao.find((f) => f.chave === "sem-preco")!.href!.split("?")[1],
    );
    // A vigência é a que o servidor respondeu, e não a que a URL pediu.
    expect(query.get("period")).toBe("2026-08-01");
    expect(query.get("scopeHash")).toBe("h");
    expect(query.get("canal")).toBe("EMPURRADA");
  });

  it("recorta só a lista de pontos, e as partições continuam sobre a vigência inteira", () => {
    const c = composicaoDasAlteracoes(comFormato(), "formato")!;
    expect(c.tocados.map((p) => p.chave)).toEqual(["b"]);
    expect(c.tocadosNoTotal).toBe(3);
    // As três partições não se mexem: filtrá-las faria o painel discordar do
    // número que ele acabou de publicar no topo.
    expect(soma(c.porEfeito)).toBe(267);
    expect(soma(c.porNatureza)).toBe(267);
    expect(soma(c.porApuracao)).toBe(267);
  });

  it("ordena os pontos pelo tamanho, e mede a barra contra o maior da vigência", () => {
    const c = composicaoDasAlteracoes(comFormato(), "valor")!;
    expect(c.tocados.map((p) => p.titulo)).toEqual(["Combustível", "Financiamento"]);
    // O maior é o de 124, e ele está fora deste recorte em "formato" — a escala
    // continua a mesma, senão a barra mudaria de significado ao trocar de foco.
    expect(c.tocados[0].proporcao).toBe(1);
    expect(c.tocados[1].proporcao).toBeCloseTo(81 / 124, 4);
  });

  it("fica fechada quando a URL não pede, e não abre sobre vigência sem alteração", () => {
    expect(composicaoDasAlteracoes(comFormato(), null)).toBeNull();
    expect(composicaoDasAlteracoes(null, "todas")).toBeNull();
    const vazia = vigencia({
      totals: {
        changes: 0,
        formatOnlyChanges: 0,
        groups: 0,
        vehiclesTouched: 0,
        entitiesAdded: 0,
        entitiesRemoved: 0,
        unchanged: 0,
        inconclusive: 0,
      },
    });
    expect(composicaoDasAlteracoes(vazia, "todas")).toBeNull();
  });

  it("foco inventado na URL não vira recorte — cai em todas", () => {
    const c = composicaoDasAlteracoes(comFormato(), "outro")!;
    expect(c.foco).toBe("todas");
    expect(c.tocados).toHaveLength(3);
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
      sides: [],
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
        impact: impacto({
          byPeriodicity: { MENSAL: 26856, ANUAL: -1200 },
          excluido: { MENSAL: -400 },
          excludedChanges: 2,
          notCalculable: 3,
          calculatedChanges: 9,
        }),
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
            impact: impacto({
              byPeriodicity: { MENSAL: 26856, ANUAL: -1200 },
              excluido: { MENSAL: -400 },
              excludedChanges: 2,
              notCalculable: 3,
              calculatedChanges: 9,
            }),
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
      sides: [],
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
        impact: impacto(),
      }),
    );
    const ponto = pontosDeAtencao(view, null, null, recorte).find(
      (p) => p.chave === "sem-preco",
    )!;
    // Filtrar por "sem impacto" uma vigência sem nenhuma devolveria zero linhas,
    // e zero linhas depois de um clique lê-se como defeito da tela.
    expect(ponto.href).toBe("/curadoria");
  });

  it("a gaveta de uma alteração leva o seu próprio recorte para a Planilha", () => {
    const view = vigencia({
      groups: [grupo({ key: "a", attributeCode: "cavalo.ipva", entityType: "CAVALO" })],
      cockpit: cockpit({ priorities: [] }),
    });
    const detalhe = detalheDaAlteracao(view, "a", recorte)!;
    expect(consulta(detalhe.href).get("attributeCode")).toBe("cavalo.ipva");
    expect(consulta(detalhe.href).get("entityType")).toBe("CAVALO");
    expect(consulta(detalhe.href).get("period")).toBe("2026-08-01");
    expect(consulta(detalhe.href).get("scopeHash")).toBe("h");
    // A fila do Acompanhamento leva a vigência aberta, e não a do recorte
    // colado: é a vigência que o servidor de fato respondeu.
    expect(consulta(detalhe.hrefFila).get("period")).toBe("2026-08-01");
  });

  it("grupo sem atributo não inventa filtro", () => {
    // Um ativo que entrou ou uma coluna que sumiu não têm `attributeCode`.
    // `attributeCode=null` no endereço devolveria zero linhas.
    const view = vigencia({
      groups: [grupo({ key: "a", attributeCode: null, entityType: null })],
      cockpit: cockpit({ priorities: [] }),
    });
    const detalhe = detalheDaAlteracao(view, "a", recorte)!;
    expect(consulta(detalhe.href).has("attributeCode")).toBe(false);
    expect(consulta(detalhe.href).has("entityType")).toBe(false);
    expect(consulta(detalhe.href).get("period")).toBe("2026-08-01");
  });
});

/**
 * A gaveta que uma alteração em destaque abre.
 *
 * O que estes casos impedem é a gaveta afirmar mais do que a vigência sustenta:
 * um preço onde o motor não apurou nenhum, uma criticidade que a fila do
 * cockpit não deu, ou uma porta para a Curadoria numa coluna que já está
 * confirmada — três formas de a Visão geral discordar do Acompanhamento sobre a
 * mesma linha.
 */
describe("de onde vem uma alteração em destaque", () => {
  const recorte = { period: null, scopeHash: null, canal: null };

  const consulta = (href: string) => new URLSearchParams(href.split("?")[1] ?? "");

  const comPreco = {
    confidence: "CALCULATED",
    amount: -18420,
    periodicity: "MENSAL",
    reason: null,
    countedVehicles: 61,
    excludedVehicles: 0,
    excludedAmount: null,
    excludedReason: null,
  };

  it("devolve o grupo, a sua posição na fila e o valor escrito", () => {
    const view = vigencia({
      groups: [grupo({ key: "a", title: "IPVA", impact: comPreco })],
      cockpit: cockpit({
        priorities: [prioridade({ key: "a", rank: 2, severity: "ALTO", score: 51 })],
      }),
    });

    const detalhe = detalheDaAlteracao(view, "a", recorte)!;
    expect(detalhe.grupo.title).toBe("IPVA");
    expect(detalhe.titulo).toBe("Valor reduzido em IPVA — Cavalo");
    expect(detalhe.tipo).toBe("queda");
    expect(detalhe.valor).toBe(`${formatBrlShort(-18420)}/mês`);
    expect(detalhe.prioridade?.rank).toBe(2);
    expect(detalhe.semPreco).toBeNull();
  });

  it("sem preço apurado não vira zero — vira a razão, escrita", () => {
    const view = vigencia({
      groups: [
        grupo({
          key: "a",
          semanticsStatus: "PENDING",
          impact: {
            confidence: "NOT_CALCULABLE",
            amount: null,
            periodicity: null,
            reason: "Semântica desconhecida: o atributo ainda não foi confirmado.",
            countedVehicles: 0,
            excludedVehicles: 0,
            excludedAmount: null,
            excludedReason: null,
          },
        }),
      ],
      cockpit: cockpit({ priorities: [] }),
    });

    const detalhe = detalheDaAlteracao(view, "a", recorte)!;
    expect(detalhe.valor).toBeNull();
    expect(detalhe.semPreco).toBe(
      "Semântica desconhecida: o atributo ainda não foi confirmado.",
    );
    // A Curadoria é a porta que destrava o preço, e ela abre já na coluna.
    expect(detalhe.hrefCuradoria).toContain("atributo=cavalo.qualquer");
    expect(detalhe.hrefCuradoria).toContain("equipamento=CAVALO");
  });

  it("coluna já confirmada não manda ninguém para a Curadoria", () => {
    const view = vigencia({
      groups: [grupo({ key: "a", semanticsStatus: "CONFIRMED", impact: comPreco })],
      cockpit: cockpit({ priorities: [] }),
    });
    expect(detalheDaAlteracao(view, "a", recorte)!.hrefCuradoria).toBeNull();
  });

  it("conta as outras alterações da mesma coluna, e só as da mesma coluna", () => {
    const view = vigencia({
      groups: [
        grupo({ key: "a", attributeCode: "cavalo.ipva", entityType: "CAVALO" }),
        grupo({
          key: "b",
          attributeCode: "cavalo.ipva",
          entityType: "CARRETA",
          vehicles: 7,
        }),
        grupo({ key: "c", attributeCode: "cavalo.pneu", vehicles: 99 }),
      ],
      cockpit: cockpit({ priorities: [] }),
    });

    const detalhe = detalheDaAlteracao(view, "a", recorte)!;
    expect(detalhe.mesmoAtributo).toEqual({
      grupos: 1,
      veiculos: 7,
      href: expect.stringContaining("attributeCode=cavalo.ipva"),
    });
    // O link é da coluna inteira: levar o equipamento devolveria a própria
    // linha aberta, sob um rótulo que promete o resto.
    expect(consulta(detalhe.mesmoAtributo!.href).has("entityType")).toBe(false);
  });

  it("grupo sem atributo não tem irmãs a apontar", () => {
    const view = vigencia({
      groups: [grupo({ key: "a", attributeCode: null }), grupo({ key: "b", attributeCode: null })],
      cockpit: cockpit({ priorities: [] }),
    });
    expect(detalheDaAlteracao(view, "a", recorte)!.mesmoAtributo).toBeNull();
  });

  it("chave que não está nesta vigência não abre painel nenhum", () => {
    const view = vigencia({ groups: [grupo({ key: "a" })] });
    expect(detalheDaAlteracao(view, "outra", recorte)).toBeNull();
    expect(detalheDaAlteracao(view, null, recorte)).toBeNull();
    expect(detalheDaAlteracao(null, "a", recorte)).toBeNull();
  });
});
