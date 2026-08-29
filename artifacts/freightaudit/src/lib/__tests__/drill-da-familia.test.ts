import { describe, expect, it } from "vitest";
import {
  gruposDoParametro,
  porPlaca,
  unidadesDoParametro,
  type UnidadeDoDrill,
} from "../drill-da-familia";
import type {
  ChangeGroup,
  ExecutiveSummary,
  FamiliesView,
  GroupVehicle,
} from "@/components/inicio/types";

/**
 * Os dois degraus que a gaveta da família ganhou: **por unidade** e, dentro de
 * uma unidade, **por placa**.
 *
 * O que roda aqui são as decisões que, se errarem, fazem um degrau publicar um
 * número que não é o de cima:
 *
 * 1. Somar unidades que não têm este parâmetro deste lado.
 * 2. Deixar a soma das placas discordar do número da unidade **em silêncio**.
 * 3. Contar no total uma linha que o servidor tirou dele — sem preço, do outro
 *    lado, ou já contada nas parcelas.
 * 4. Misturar periodicidades dentro do mesmo degrau.
 */

const RESUMO_VAZIO: Omit<ExecutiveSummary, "sides"> = {
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
};

function unidade(
  chave: string,
  label: string,
  sides: ExecutiveSummary["sides"],
): UnidadeDoDrill {
  return {
    chave,
    label,
    contexts: [{ scopeHash: `hash-${chave}`, channel: null }],
    summary: { ...RESUMO_VAZIO, sides } as ExecutiveSummary,
  };
}

function contribuidor(key: string, amount: number, changes = 1, vehicles = 1) {
  return {
    key,
    name: key.split("|")[1] ?? key,
    family: "AQUISICAO_FINANCIAMENTO",
    familyName: "Aquisição e financiamento",
    changes,
    vehicles,
    amount,
  };
}

function lado(parametros: ReturnType<typeof contribuidor>[]) {
  return {
    total: Number(parametros.reduce((soma, p) => soma + p.amount, 0).toFixed(2)),
    changes: parametros.reduce((soma, p) => soma + p.changes, 0),
    vehicles: parametros.reduce((soma, p) => soma + p.vehicles, 0),
    parameters: parametros,
  };
}

const FINANCIAMENTO = "AQUISICAO_FINANCIAMENTO|Financiamento";

/*
  O caso da tela: `Financiamento` tirou −R$ 76.318/mês na soma de todas as
  unidades. Camaçari e Jaguariúna respondem por ele; Uberlândia mexeu no mesmo
  parâmetro, mas **para cima** — e por isso não pode aparecer no degrau da
  perda.
*/
const UNIDADES: UnidadeDoDrill[] = [
  unidade("CAMACARI", "Camaçari", [
    {
      periodicity: "MENSAL",
      net: -50000,
      gains: lado([]),
      losses: lado([contribuidor(FINANCIAMENTO, -50000, 12, 11)]),
    },
  ]),
  unidade("JAGUARIUNA", "Jaguariúna", [
    {
      periodicity: "MENSAL",
      net: -26318,
      gains: lado([]),
      losses: lado([contribuidor(FINANCIAMENTO, -26318, 9, 8)]),
    },
  ]),
  unidade("UBERLANDIA", "Uberlândia", [
    {
      periodicity: "MENSAL",
      net: 4000,
      gains: lado([contribuidor(FINANCIAMENTO, 4000, 2, 2)]),
      losses: lado([]),
    },
  ]),
];

describe("o degrau por unidade", () => {
  it("abre o parâmetro nas unidades que o produziram, a maior primeiro", () => {
    const aberto = unidadesDoParametro(UNIDADES, {
      parameterKey: FINANCIAMENTO,
      periodicity: "MENSAL",
      lado: "perdas",
      esperado: -76318,
    });
    expect(aberto.linhas.map((l) => l.label)).toEqual(["Camaçari", "Jaguariúna"]);
    expect(aberto.linhas[0].amount).toBe(-50000);
    expect(aberto.linhas[0].proporcao).toBe(1);
  });

  it("fecha com o número que a linha de cima afirma", () => {
    const aberto = unidadesDoParametro(UNIDADES, {
      parameterKey: FINANCIAMENTO,
      periodicity: "MENSAL",
      lado: "perdas",
      esperado: -76318,
    });
    expect(aberto.total).toBe(-76318);
    expect(aberto.resto).toBe(0);
  });

  /*
    Uma unidade fora da consolidação, ou um cache mais velho, faz os dois
    números divergirem. O degrau não pode escolher um dos dois em silêncio.
  */
  it("expõe o que a soma das unidades não explica", () => {
    const aberto = unidadesDoParametro(UNIDADES.slice(0, 1), {
      parameterKey: FINANCIAMENTO,
      periodicity: "MENSAL",
      lado: "perdas",
      esperado: -76318,
    });
    expect(aberto.total).toBe(-50000);
    expect(aberto.resto).toBe(-26318);
  });

  it("não deixa o lado contrário entrar no degrau da perda", () => {
    const aberto = unidadesDoParametro(UNIDADES, {
      parameterKey: FINANCIAMENTO,
      periodicity: "MENSAL",
      lado: "perdas",
      esperado: -76318,
    });
    expect(aberto.linhas.some((l) => l.label === "Uberlândia")).toBe(false);
  });

  it("não mistura periodicidades", () => {
    const aberto = unidadesDoParametro(UNIDADES, {
      parameterKey: FINANCIAMENTO,
      periodicity: "ANUAL",
      lado: "perdas",
      esperado: 0,
    });
    expect(aberto.linhas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

function grupo(overrides: Partial<ChangeGroup> = {}): ChangeGroup {
  return {
    key: "g1",
    attributeCode: "cavalo.financiamento_juros",
    title: "Juros do financiamento · Cavalo",
    entityType: "CAVALO",
    equipment: "Cavalo",
    changeType: "VALUE_CHANGE",
    category: "PRECO",
    comparability: "COMPARABLE",
    changes: 3,
    vehicles: 3,
    entityIds: ["a", "b", "c"],
    fleet: 10,
    coverage: "PARCIAL",
    coverageLabel: "3 de 10",
    patterns: 3,
    dominantPattern: null,
    aggregate: {
      summable: true,
      aggregation: "SUM",
      totalBefore: null,
      totalAfter: null,
      rowsInTotal: 3,
      perVehicle: null,
      deltaPercent: null,
      minPercent: null,
      maxPercent: null,
    },
    impact: {
      confidence: "CALCULATED",
      amount: -50000,
      periodicity: "MENSAL",
      reason: null,
      countedVehicles: 3,
      excludedVehicles: 0,
      excludedAmount: null,
      excludedReason: null,
    },
    natures: [],
    natureCodes: [],
    semanticsStatus: "CONFIRMED",
    semanticsLabel: "confirmada",
    unit: "BRL",
    isMonetary: true,
    costClass: "FIXO",
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

function veiculo(overrides: Partial<GroupVehicle> = {}): GroupVehicle {
  return {
    changeId: 1,
    plate: "ABC1D23",
    valueBefore: "1000",
    valueAfter: "2000",
    numericBefore: 1000,
    numericAfter: 2000,
    deltaPercent: 100,
    impactAmount: -30000,
    impactPeriodicity: "MENSAL",
    impactConfidence: "CALCULATED",
    foraDoTotal: null,
    inconclusiveReason: null,
    anomaly: null,
    periodBefore: "2026-07-01",
    periodAfter: "2026-08-01",
    periodBeforeLabel: "julho/2026",
    periodAfterLabel: "agosto/2026",
    ...overrides,
  };
}

describe("o degrau por placa", () => {
  const entradas = [
    {
      grupo: grupo(),
      veiculos: [
        veiculo({ changeId: 1, plate: "ABC1D23", impactAmount: -30000 }),
        veiculo({ changeId: 2, plate: "DEF4G56", impactAmount: -20000 }),
        // Do outro lado: subiu, e o degrau aberto é o da perda.
        veiculo({ changeId: 3, plate: "HIJ7K89", impactAmount: 900 }),
        // Sem preço apurado: nunca entrou em nenhum dos dois lados.
        veiculo({
          changeId: 4,
          plate: "LMN0P12",
          impactAmount: null,
          impactConfidence: "NOT_CALCULABLE",
        }),
        // Já contada nas parcelas: tem valor, e o lugar dele não é aqui.
        veiculo({
          changeId: 5,
          plate: "QRS3T45",
          impactAmount: -9999,
          foraDoTotal: {
            motivo: "COBERTO_POR_PARCELAS",
            representadoPor: "cavalo.custo_fixo",
            explicacao: "já contado nas parcelas",
          },
        }),
        // Outra periodicidade: não se soma com a de cima, aqui nem em lugar nenhum.
        veiculo({ changeId: 6, plate: "UVW6X78", impactAmount: -777, impactPeriodicity: "ANUAL" }),
      ],
    },
  ];

  const aberto = porPlaca(entradas, {
    periodicity: "MENSAL",
    lado: "perdas",
    esperado: -50000,
  });

  it("soma exatamente o número da unidade", () => {
    expect(aberto.total).toBe(-50000);
    expect(aberto.resto).toBe(0);
  });

  it("mostra só as placas deste lado, a maior primeiro", () => {
    expect(aberto.linhas.map((l) => l.plate)).toEqual(["ABC1D23", "DEF4G56"]);
    expect(aberto.linhas[0].proporcao).toBe(1);
  });

  it("carrega o antes e o depois de cada placa", () => {
    expect(aberto.linhas[0].numericAntes).toBe(1000);
    expect(aberto.linhas[0].numericDepois).toBe(2000);
    expect(aberto.linhas[0].unit).toBe("BRL");
  });

  /*
    Nada some: as linhas que não compõem este número continuam contadas e
    ditas pelo nome. A alternativa é alguém abrir a tabela do grupo, contar
    seis linhas onde este degrau mostra duas, e não ter como saber qual das
    duas leituras acreditar.
  */
  it("conta o que ficou de fora, e por quê", () => {
    expect(aberto.foraDesteLado).toEqual({ outroLado: 1, semPreco: 1, jaContadas: 1 });
  });

  it("expõe a diferença quando a soma das placas não fecha", () => {
    const parcial = porPlaca(entradas, {
      periodicity: "MENSAL",
      lado: "perdas",
      esperado: -76318,
    });
    expect(parcial.resto).toBe(-26318);
  });
});

describe("os grupos de um parâmetro", () => {
  const view = {
    families: [
      {
        parameters: [
          {
            key: FINANCIAMENTO,
            groups: [
              grupo({ key: "mensal" }),
              grupo({ key: "anual", impact: { ...grupo().impact, periodicity: "ANUAL" } }),
              grupo({
                key: "sem-preco",
                impact: { ...grupo().impact, amount: null },
              }),
            ],
          },
        ],
      },
    ],
  } as unknown as Pick<FamiliesView, "families">;

  it("pega os desta periodicidade, e só os que têm valor apurado", () => {
    expect(gruposDoParametro(view, FINANCIAMENTO, "MENSAL").map((g) => g.key)).toEqual([
      "mensal",
    ]);
  });

  it("devolve vazio para um parâmetro que não está nesta vigência", () => {
    expect(gruposDoParametro(view, "OUTRO|Parâmetro", "MENSAL")).toEqual([]);
  });
});
