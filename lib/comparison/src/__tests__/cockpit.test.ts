import { describe, expect, it } from "vitest";
import {
  buildCockpit,
  diagnose,
  narrate,
  scoreGroup,
  severityOf,
  summarisePatterns,
  type CockpitInput,
} from "../cockpit";
import type { ChangeGroup } from "../grouped";

/**
 * O cockpit, sem banco.
 *
 * Todo o módulo é função pura sobre grupos já apurados, e é assim que ele é
 * testado: grupos fabricados à mão, com um campo mexido de cada vez. O contrato
 * contra o export real da Freightec continua em `grouped-real.test.ts` — aqui a
 * pergunta é outra, e é a que o painel novo introduz: *dado este conjunto de
 * sinais, qual é a fila de investigação, e por quê*.
 */

function group(overrides: Partial<ChangeGroup> = {}): ChangeGroup {
  return {
    key: overrides.key ?? "attr|CAVALO|VALUE_CHANGED|COMPARABLE|NOT_CALCULABLE",
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
    composition: null,
    badge: "SEM_SINAL",
    badgeLabel: "Sem sinal relevante",
    ...overrides,
  };
}

/** O caso que originou a tela: `cavalo.data_fim_contrato` em agosto/2026. */
const fimDoContrato = group({
  key: "cavalo.data_fim_contrato|CAVALO|VALUE_CHANGED|INCONCLUSIVE|NOT_CALCULABLE",
  attributeCode: "cavalo.data_fim_contrato",
  title: "Fim do contrato",
  comparability: "INCONCLUSIVE",
  changes: 62,
  vehicles: 62,
  fleet: 62,
  coverage: "TOTAL",
  coverageLabel: "Toda a frota · 62 de 62 cavalos",
  patterns: 2,
  dominantPattern: { before: "2028-07-01T12:00:00Z", after: "46935.5", vehicles: 54 },
  natures: ["mudou de tipo"],
  natureCodes: ["TYPE_CHANGE"],
  badge: "RUPTURA",
  badgeLabel: "Ruptura",
  anomalies: [
    {
      kind: "DATA_COMO_SERIAL_EXCEL",
      sameInstant: true,
      differenceMs: 0,
      interpretation: "46935.5 lido como serial do Excel é 2028-07-01T12:00:00Z",
      explanation: "…",
      vehicles: 54,
    },
    {
      kind: "DATA_COMO_SERIAL_EXCEL",
      sameInstant: false,
      differenceMs: 1,
      interpretation: "46936 lido como serial do Excel é 2028-07-02T00:00:00Z",
      explanation: "…",
      vehicles: 8,
    },
  ],
});

/** Dinheiro apurado na frota inteira: o IPVA de julho/2026. */
const ipva = group({
  key: "cavalo.ipva_licenciamento|CAVALO|VALUE_CHANGED|COMPARABLE|CALCULATED",
  attributeCode: "cavalo.ipva_licenciamento",
  title: "IPVA / Licenciamento",
  changes: 62,
  vehicles: 62,
  fleet: 62,
  coverage: "TOTAL",
  coverageLabel: "Toda a frota · 62 de 62 cavalos",
  patterns: 13,
  dominantPattern: { before: "6674.5", after: "4338.4", vehicles: 20 },
  aggregate: {
    summable: true,
    aggregation: "SUM",
    totalBefore: 413826.3,
    totalAfter: 268951.8,
    rowsInTotal: 62,
    perVehicle: {
      numeratorBefore: 413826.3,
      numeratorAfter: 268951.8,
      denominator: 62,
      averageBefore: 6674.62,
      averageAfter: 4338.06,
    },
    deltaPercent: -35,
    minPercent: -35,
    maxPercent: -35,
  },
  impact: {
    confidence: "CALCULATED",
    amount: -144874.5,
    periodicity: "ANUAL",
    reason: null,
    countedVehicles: 62,
    excludedVehicles: 0,
    excludedAmount: null,
    excludedReason: null,
  },
  natures: ["valor"],
  natureCodes: ["NUMERIC"],
  badge: "DINHEIRO",
  badgeLabel: "Dinheiro",
});

/** Zeramento em minoria da frota: "Consumo de combustível (referência)". */
const zerado = group({
  key: "cavalo.combustivel_consumo_benchmark|CAVALO|VALUE_CHANGED|COMPARABLE|NOT_CALCULABLE",
  attributeCode: "cavalo.combustivel_consumo_benchmark",
  title: "Consumo de combustível (referência)",
  changes: 10,
  vehicles: 10,
  fleet: 62,
  coverage: "PARCIAL",
  coverageLabel: "10 de 62 cavalos",
  aggregate: {
    summable: false,
    aggregation: "AVG",
    totalBefore: null,
    totalAfter: null,
    rowsInTotal: 0,
    perVehicle: null,
    deltaPercent: null,
    minPercent: -100,
    maxPercent: -100,
  },
  impact: {
    confidence: "NOT_CALCULABLE",
    amount: null,
    periodicity: null,
    reason: "O significado desta coluna ainda não foi confirmado.",
    countedVehicles: 0,
    excludedVehicles: 0,
    excludedAmount: null,
    excludedReason: null,
  },
  natures: ["zerou"],
  natureCodes: ["ZEROING"],
  badge: "RUPTURA",
  badgeLabel: "Ruptura",
});

/** Um ponto sem sinal: existe, é contado, e fica no fim da fila. */
const semSinal = group({
  key: "cavalo.odometro_entrada|CAVALO|VALUE_CHANGED|COMPARABLE|NOT_CALCULABLE",
  attributeCode: "cavalo.odometro_entrada",
  title: "Odômetro de entrada",
  changes: 3,
  vehicles: 3,
  fleet: 62,
  aggregate: {
    summable: false,
    aggregation: null,
    totalBefore: null,
    totalAfter: null,
    rowsInTotal: 0,
    perVehicle: null,
    deltaPercent: null,
    minPercent: 2,
    maxPercent: 4,
  },
});

function view(groups: ChangeGroup[], overrides: Partial<CockpitInput> = {}): CockpitInput {
  const changes = groups.reduce((total, g) => total + g.changes, 0);
  return {
    groups,
    periodLabel: "agosto/2026",
    totals: {
      changes,
      groups: groups.length,
      vehiclesTouched: 62,
      entitiesAdded: 0,
      entitiesRemoved: 0,
      unchanged: 1000,
      inconclusive: 0,
    },
    impact: {
      byPeriodicity: {},
      excludedByPeriodicity: {},
      excludedChanges: 0,
      notCalculable: changes,
      calculatedChanges: 0,
    },
    accumulated: {
      byPeriodicity: {},
      excludedByPeriodicity: {},
      excludedChanges: 0,
      notCalculable: 0,
      calculatedChanges: 0,
      comparisons: 1,
      from: "2026-08-01",
      to: "2026-08-01",
    },
    series: [
      {
        entityTypeSet: "CAVALO",
        equipment: "Cavalo",
        snapshotLabel: "EMPURRADA_1_8_2026",
        previousLabel: "EMPURRADA_2_7_2026",
        fleet: 62,
        changeSetId: "set-cavalo",
        reason: null,
      },
    ],
    ...overrides,
  };
}

describe("score — determinístico, aditivo e explicável", () => {
  it("a soma dos motivos é o score, sempre", () => {
    for (const g of [fimDoContrato, ipva, zerado, semSinal]) {
      const { score, reasons } = scoreGroup(g);
      expect(reasons.reduce((total, r) => total + r.points, 0)).toBe(score);
    }
  });

  it("o mesmo grupo produz sempre o mesmo score", () => {
    expect(scoreGroup(fimDoContrato).score).toBe(scoreGroup({ ...fimDoContrato }).score);
  });

  it("ruptura de tipo em toda a frota, com anomalia, é crítica", () => {
    // 35 (ruptura) + 10 (mudou de tipo) + 10 (anomalia) + 30 (toda a frota).
    const { score, reasons } = scoreGroup(fimDoContrato);
    expect(score).toBe(85);
    expect(severityOf(score)).toBe("CRITICO");
    expect(reasons.map((r) => r.label)).toContain("indício de troca de formato");
  });

  it("dinheiro apurado em toda a frota, com −35%, é crítico", () => {
    // 35 (impacto) + 30 (toda a frota) + 6 (variação ≥ 20%).
    const { score } = scoreGroup(ipva);
    expect(score).toBe(71);
    expect(severityOf(score)).toBe("CRITICO");
  });

  it("zeramento em 16% da frota é alto, não crítico — abrangência pesa", () => {
    // 35 (ruptura) + 10 (zerou) + 3 (16% da frota) + 20 (variação ≥ 100%).
    const { score } = scoreGroup(zerado);
    expect(score).toBe(68);
    expect(severityOf(score)).toBe("ALTO");
  });

  it("o mesmo zeramento na frota inteira passa a crítico", () => {
    const todos = { ...zerado, vehicles: 62, coverage: "TOTAL" as const };
    expect(severityOf(scoreGroup(todos).score)).toBe("CRITICO");
  });

  it("ponto sem sinal fica em baixo, e continua na lista", () => {
    const { score } = scoreGroup(semSinal);
    expect(severityOf(score)).toBe("BAIXO");
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("valor fora do total por dupla contagem pontua menos que dinheiro novo", () => {
    const excluido = group({
      impact: { ...semSinal.impact, excludedVehicles: 5, excludedAmount: -16594.54 },
    });
    const novo = group({
      impact: { ...semSinal.impact, amount: -16594.54, confidence: "CALCULATED" },
    });
    expect(scoreGroup(excluido).score).toBeLessThan(scoreGroup(novo).score);
    expect(scoreGroup(excluido).score).toBeGreaterThan(0);
  });

  it("impacto apurado de zero não é impacto ausente, e não pontua como dinheiro", () => {
    // R$ 0,00 apurado é uma resposta; ela não vira "não calculável" nem ganha
    // os pontos de dinheiro — não há valor a investigar.
    const zeroApurado = group({
      impact: { ...semSinal.impact, confidence: "CALCULATED", amount: 0, periodicity: "MENSAL" },
    });
    expect(scoreGroup(zeroApurado).score).toBe(scoreGroup(group()).score);
  });
});

describe("ordenação — a fila de investigação", () => {
  it("ordena por criticidade e devolve rank 1-based", () => {
    const cockpit = buildCockpit(view([semSinal, zerado, ipva, fimDoContrato]));
    expect(cockpit.priorities.map((p) => p.key)).toEqual([
      fimDoContrato.key,
      ipva.key,
      zerado.key,
      semSinal.key,
    ]);
    expect(cockpit.priorities.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
  });

  it("a ordem não depende da ordem de entrada", () => {
    const a = buildCockpit(view([fimDoContrato, ipva, zerado, semSinal]));
    const b = buildCockpit(view([semSinal, ipva, fimDoContrato, zerado]));
    expect(a.priorities.map((p) => p.key)).toEqual(b.priorities.map((p) => p.key));
  });

  it("empate no score é desempatado por veículos e depois pela chave", () => {
    const poucos = group({ key: "z|CAVALO", vehicles: 2, changes: 2 });
    const muitos = group({ key: "a|CAVALO", vehicles: 9, changes: 9 });
    const cockpit = buildCockpit(view([poucos, muitos]));
    expect(cockpit.priorities[0].key).toBe(muitos.key);

    const iguais = buildCockpit(
      view([group({ key: "b|CAVALO" }), group({ key: "a|CAVALO" })]),
    );
    expect(iguais.priorities.map((p) => p.key)).toEqual(["a|CAVALO", "b|CAVALO"]);
  });

  it("nenhum grupo some da fila — priorizar não é filtrar", () => {
    const grupos = [semSinal, zerado, ipva, fimDoContrato];
    const cockpit = buildCockpit(view(grupos));
    expect(cockpit.priorities).toHaveLength(grupos.length);
  });
});

describe("KPIs — alteração, ponto e veículo são coisas diferentes", () => {
  const cockpit = buildCockpit(view([fimDoContrato, ipva, zerado, semSinal]));

  it("alterações são linhas; pontos são grupos; veículos são ativos distintos", () => {
    expect(cockpit.kpis.changes).toBe(62 + 62 + 10 + 3);
    expect(cockpit.kpis.parameters).toBe(4);
    expect(cockpit.kpis.vehicles).toBe(62);
    expect(cockpit.kpis.fleet).toBe(62);
  });

  it("a soma das alterações dos grupos fecha com o total da vigência", () => {
    const porGrupo = cockpit.panorama.byBadge.reduce((total, b) => total + b.changes, 0);
    expect(porGrupo).toBe(cockpit.kpis.changes);
  });

  it("atenção conta apenas crítico e alto", () => {
    const criticos = cockpit.panorama.bySeverity.find((b) => b.severity === "CRITICO")!;
    const altos = cockpit.panorama.bySeverity.find((b) => b.severity === "ALTO")!;
    expect(cockpit.kpis.attention).toBe(criticos.groups + altos.groups);
    expect(criticos.groups).toBe(2);
    expect(altos.groups).toBe(1);
  });

  it("anomalias vêm do detector, e contam pontos e linhas", () => {
    expect(cockpit.kpis.anomalies.groups).toBe(1);
    expect(cockpit.kpis.anomalies.changes).toBe(62);
  });

  it("sem impacto apurado, hasImpact é falso e o número não vira zero", () => {
    expect(cockpit.kpis.hasImpact).toBe(false);
    expect(cockpit.kpis.impact.byPeriodicity).toEqual({});
    expect(cockpit.panorama.pricing.notCalculableChanges).toBeGreaterThan(0);
  });
});

describe("panorama — a composição do risco", () => {
  it("separa calculável, fora do total e sem preço, sem somar os três", () => {
    const cockpit = buildCockpit(
      view([ipva, zerado], {
        impact: {
          byPeriodicity: { ANUAL: -144874.5 },
          excludedByPeriodicity: { MENSAL: -11425.04 },
          excludedChanges: 6,
          notCalculable: 10,
          calculatedChanges: 68,
        },
      }),
    );
    const p = cockpit.panorama.pricing;
    expect(p.calculatedChanges).toBe(62);
    expect(p.excludedChanges).toBe(6);
    expect(p.notCalculableChanges).toBe(10);
    expect(cockpit.kpis.hasImpact).toBe(true);
  });

  it("agrupa os motivos de não haver preço, do que mais explica para o que menos", () => {
    const outro = group({
      key: "outro|CAVALO",
      changes: 2,
      impact: { ...zerado.impact, reason: "Outro motivo." },
    });
    const cockpit = buildCockpit(view([zerado, outro]));
    expect(cockpit.panorama.pricing.reasons[0].changes).toBe(10);
    expect(cockpit.panorama.pricing.reasons[0].reason).toContain("não foi confirmado");
    expect(cockpit.panorama.pricing.reasons).toHaveLength(2);
  });

  it("por frota: cavalo e carreta não se misturam, e a frota vem da série", () => {
    const carreta = group({
      key: "carreta.finame|CARRETA",
      entityType: "CARRETA",
      equipment: "Carreta",
      changes: 5,
      vehicles: 5,
      fleet: 71,
    });
    const cockpit = buildCockpit(
      view([ipva, carreta], {
        series: [
          {
            entityTypeSet: "CAVALO",
            equipment: "Cavalo",
            snapshotLabel: "cavalo",
            previousLabel: null,
            fleet: 62,
            changeSetId: "a",
            reason: null,
          },
          {
            entityTypeSet: "CARRETA",
            equipment: "Carreta",
            snapshotLabel: "carreta",
            previousLabel: null,
            fleet: 71,
            changeSetId: "b",
            reason: null,
          },
        ],
      }),
    );
    const porFrota = cockpit.panorama.byEquipment;
    expect(porFrota.map((b) => b.entityType)).toEqual(["CAVALO", "CARRETA"]);
    expect(porFrota[0].changes).toBe(62);
    expect(porFrota[0].fleet).toBe(62);
    expect(porFrota[1].changes).toBe(5);
    expect(porFrota[1].fleet).toBe(71);
    expect(cockpit.kpis.fleet).toBe(133);
  });

  it("todas as criticidades aparecem, inclusive as vazias", () => {
    const cockpit = buildCockpit(view([semSinal]));
    expect(cockpit.panorama.bySeverity.map((b) => b.severity)).toEqual([
      "CRITICO",
      "ALTO",
      "MEDIO",
      "BAIXO",
    ]);
    expect(cockpit.panorama.bySeverity.find((b) => b.severity === "CRITICO")!.groups).toBe(0);
  });
});

describe("diagnóstico — a primeira camada em português", () => {
  it("anomalia de formato é dita como indício, nunca como certeza", () => {
    const texto = diagnose(fimDoContrato);
    expect(texto).toContain("indício");
    expect(texto).toContain("compatível com o formato serial");
    expect(texto).not.toMatch(/\b46935\.5\b/);
    // Os 54 do mesmo instante e os 8 diferentes continuam separados.
    expect(texto).toContain("54");
    expect(texto).toContain("8");
  });

  it("zeramento é dito como zeramento", () => {
    expect(diagnose(zerado)).toBe("O valor foi zerado em 10 cavalos nesta vigência.");
  });

  it("total somável vira antes → depois com a variação", () => {
    const texto = diagnose(ipva);
    expect(texto).toContain("413.826,3");
    expect(texto).toContain("268.951,8");
    expect(texto).toContain("−35%");
  });

  it("os padrões viram frase, e só quando há mais de um", () => {
    expect(summarisePatterns(fimDoContrato)).toBe(
      "Encontramos 2 comportamentos diferentes nesta alteração; 54 dos 62 cavalos seguem o mesmo padrão.",
    );
    expect(summarisePatterns(semSinal)).toBeNull();
  });
});

describe("narrativa — composição determinística, nunca modelo", () => {
  it("com risco e sem preço, o risco é o protagonista e a ausência é contexto", () => {
    const cockpit = buildCockpit(view([fimDoContrato, zerado]));
    expect(cockpit.narrative.headline).toBe("Agosto/2026 exige atenção.");
    const texto = cockpit.narrative.sentences.join(" ");
    expect(texto).toContain("72 alterações");
    expect(texto).toContain("2 pontos");
    expect(texto).toContain("62 veículos");
    expect(texto).toContain("Nenhuma destas alterações teve impacto financeiro calculado");
    expect(texto).toContain("regra de precificação suficiente");
    expect(texto).not.toContain("nenhum valor apurável");
  });

  it("com impacto apurado, cada periodicidade aparece separada", () => {
    const cockpit = buildCockpit(
      view([ipva], {
        impact: {
          byPeriodicity: { ANUAL: -144874.5, MENSAL: 28511.24 },
          excludedByPeriodicity: {},
          excludedChanges: 0,
          notCalculable: 0,
          calculatedChanges: 62,
        },
      }),
    );
    const texto = cockpit.narrative.sentences.join(" ");
    expect(texto).toContain("/ano");
    expect(texto).toContain("/mês");
    expect(texto).toContain("nunca somadas");
  });

  it("primeira vigência da série não é dita como 'nada mudou'", () => {
    const cockpit = buildCockpit(
      view([], {
        totals: {
          changes: 0,
          groups: 0,
          vehiclesTouched: 0,
          entitiesAdded: 0,
          entitiesRemoved: 0,
          unchanged: 0,
          inconclusive: 0,
        },
        series: [
          {
            entityTypeSet: "CAVALO",
            equipment: "Cavalo",
            snapshotLabel: "EMPURRADA_1_12_2025",
            previousLabel: null,
            fleet: 60,
            changeSetId: null,
            reason: "Primeira vigência desta série…",
          },
        ],
      }),
    );
    expect(cockpit.baseline.hasBaseline).toBe(false);
    expect(cockpit.baseline.seriesWithoutBaseline).toEqual(["Cavalo"]);
    expect(cockpit.narrative.headline).toBe("Agosto/2026 é a primeira vigência disponível.");
    expect(cockpit.narrative.sentences.join(" ")).toContain("vigência anterior com que comparar");
    expect(cockpit.narrative.sentences.join(" ")).not.toContain("não teve alterações");
  });

  it("vigência sem alteração nenhuma diz isso, e não mostra painel vazio", () => {
    const cockpit = buildCockpit(
      view([], {
        totals: {
          changes: 0,
          groups: 0,
          vehiclesTouched: 0,
          entitiesAdded: 0,
          entitiesRemoved: 0,
          unchanged: 4000,
          inconclusive: 0,
        },
      }),
    );
    expect(cockpit.narrative.headline).toBe("Agosto/2026 não teve alterações.");
    expect(cockpit.priorities).toHaveLength(0);
    expect(cockpit.kpis.attention).toBe(0);
  });

  it("sem ponto crítico nem alto, a manchete não alarma", () => {
    const cockpit = buildCockpit(view([semSinal]));
    expect(cockpit.narrative.headline).toBe("Agosto/2026 não trouxe alterações críticas.");
    expect(cockpit.narrative.sentences.join(" ")).toContain(
      "Nenhum ponto foi classificado como crítico ou alto",
    );
  });

  it("a mesma entrada produz sempre o mesmo texto", () => {
    const a = narrate({
      periodLabel: "agosto/2026",
      totals: view([ipva]).totals,
      kpis: buildCockpit(view([ipva])).kpis,
      bySeverity: buildCockpit(view([ipva])).panorama.bySeverity,
      pricing: buildCockpit(view([ipva])).panorama.pricing,
      baseline: buildCockpit(view([ipva])).baseline,
    });
    const b = buildCockpit(view([ipva])).narrative;
    expect(a).toEqual(b);
  });
});

describe("histórico — não confundir vigência com acumulado", () => {
  it("uma comparação só não é histórico suficiente", () => {
    const cockpit = buildCockpit(view([ipva]));
    expect(cockpit.history.comparisons).toBe(1);
    expect(cockpit.history.sufficient).toBe(false);
  });

  it("com várias comparações e valor, o histórico é dito — e num campo próprio", () => {
    const cockpit = buildCockpit(
      view([ipva], {
        accumulated: {
          byPeriodicity: { ANUAL: -735312.15 },
          excludedByPeriodicity: {},
          excludedChanges: 0,
          notCalculable: 0,
          calculatedChanges: 100,
          comparisons: 16,
          from: "2026-01-02",
          to: "2026-08-01",
        },
      }),
    );
    expect(cockpit.history.sufficient).toBe(true);
    expect(cockpit.history.byPeriodicity.ANUAL).toBeCloseTo(-735312.15, 2);
    // O acumulado nunca vaza para o impacto da vigência.
    expect(cockpit.kpis.impact.byPeriodicity).toEqual({});
  });
});
