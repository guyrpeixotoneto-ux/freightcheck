import { describe, expect, it } from "vitest";
import {
  FILTRO_VAZIO,
  cabeNoFoco,
  contarFocos,
  equipamentosDisponiveis,
  filtrarPrioridades,
  filtroAtivo,
  juntarPrioridades,
  type ItemCockpit,
} from "../cockpit";
import type {
  ChangeGroup,
  CockpitView,
  GroupedView,
  PriorityItem,
} from "@/components/inicio/types";

/**
 * O que a tela decide sozinha.
 *
 * A fila, a criticidade e o diagnóstico chegam prontos da API — testados em
 * `lib/comparison/src/__tests__/cockpit.test.ts` contra o export real. O que
 * sobra para cá é o recorte: quem entra em cada filtro, quantos cada botão
 * promete, e a junção entre a fila e os grupos. São as três coisas que, se
 * errarem, fazem a tela mostrar uma lista que não corresponde ao número escrito
 * ao lado dela.
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
    composition: null,
    badge: "SEM_SINAL",
    badgeLabel: "Sem sinal relevante",
    ...overrides,
  };
}

function item(overrides: Partial<PriorityItem> = {}): PriorityItem {
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

const critico: ItemCockpit = {
  item: item({ key: "critico", rank: 1, severity: "CRITICO", score: 85, hasAnomaly: true }),
  group: grupo({
    key: "critico",
    title: "Fim do contrato",
    attributeCode: "cavalo.data_fim_contrato",
    badge: "RUPTURA",
    badgeLabel: "Ruptura",
  }),
};

const comDinheiro: ItemCockpit = {
  item: item({ key: "dinheiro", rank: 2, severity: "ALTO", score: 65, hasImpact: true }),
  group: grupo({
    key: "dinheiro",
    title: "IPVA / Licenciamento",
    attributeCode: "cavalo.ipva_licenciamento",
    badge: "DINHEIRO",
    badgeLabel: "Dinheiro",
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
  }),
};

const zeroApurado: ItemCockpit = {
  item: item({ key: "zero", rank: 3, severity: "MEDIO", score: 30 }),
  group: grupo({
    key: "zero",
    title: "Seguro",
    attributeCode: "carreta.seguro",
    entityType: "CARRETA",
    equipment: "Carreta",
    impact: {
      confidence: "CALCULATED",
      amount: 0,
      periodicity: "MENSAL",
      reason: null,
      countedVehicles: 4,
      excludedVehicles: 0,
      excludedAmount: null,
      excludedReason: null,
    },
  }),
};

const semPreco: ItemCockpit = {
  item: item({ key: "sem-preco", rank: 4, severity: "BAIXO", score: 5 }),
  group: grupo({
    key: "sem-preco",
    title: "Odômetro de entrada",
    attributeCode: "cavalo.odometro_entrada",
  }),
};

const entradas = [critico, comDinheiro, zeroApurado, semPreco];

describe("junção — cada item da fila com o seu grupo", () => {
  const view = {
    groups: entradas.map((e) => e.group),
    cockpit: { priorities: entradas.map((e) => e.item) },
  } as Pick<GroupedView, "groups"> & { cockpit: Pick<CockpitView, "priorities"> };

  it("preserva a ordem da fila, que é a resposta do produto", () => {
    expect(juntarPrioridades(view).map((e) => e.item.key)).toEqual([
      "critico",
      "dinheiro",
      "zero",
      "sem-preco",
    ]);
  });

  it("junta pela chave, e não pela posição", () => {
    const embaralhado = { ...view, groups: [...view.groups].reverse() };
    const juntado = juntarPrioridades(embaralhado);
    expect(juntado.every((e) => e.item.key === e.group.key)).toBe(true);
  });

  it("item sem grupo correspondente não vira cartão vazio", () => {
    const orfao = {
      groups: [critico.group],
      cockpit: { priorities: [critico.item, comDinheiro.item] },
    };
    expect(juntarPrioridades(orfao)).toHaveLength(1);
  });
});

describe("filtros — recortam, nunca reordenam", () => {
  it("“todos” devolve a fila inteira, na mesma ordem", () => {
    const saida = filtrarPrioridades(entradas, FILTRO_VAZIO);
    expect(saida.map((e) => e.item.key)).toEqual(entradas.map((e) => e.item.key));
  });

  it("“exigem atenção” é crítico e alto — nada além", () => {
    const saida = filtrarPrioridades(entradas, { ...FILTRO_VAZIO, foco: "ATENCAO" });
    expect(saida.map((e) => e.item.key)).toEqual(["critico", "dinheiro"]);
  });

  it("“com impacto” usa o valor apurado, não a criticidade", () => {
    const saida = filtrarPrioridades(entradas, { ...FILTRO_VAZIO, foco: "IMPACTO" });
    expect(saida.map((e) => e.item.key)).toEqual(["dinheiro"]);
  });

  it("“sem preço” não inclui o impacto apurado de R$ 0,00", () => {
    // A distinção que o produto inteiro defende: zero é uma resposta; ausência
    // de preço é a falta de uma. O filtro não pode fundir as duas.
    const saida = filtrarPrioridades(entradas, { ...FILTRO_VAZIO, foco: "SEM_PRECO" });
    expect(saida.map((e) => e.item.key)).toEqual(["critico", "sem-preco"]);
    expect(saida.map((e) => e.item.key)).not.toContain("zero");
  });

  it("“com anomalia” vem do detector, e não do selo", () => {
    const saida = filtrarPrioridades(entradas, { ...FILTRO_VAZIO, foco: "ANOMALIA" });
    expect(saida.map((e) => e.item.key)).toEqual(["critico"]);
  });

  it("equipamento separa cavalo de carreta", () => {
    const cavalos = filtrarPrioridades(entradas, { ...FILTRO_VAZIO, equipamento: "CAVALO" });
    const carretas = filtrarPrioridades(entradas, { ...FILTRO_VAZIO, equipamento: "CARRETA" });
    expect(cavalos).toHaveLength(3);
    expect(carretas.map((e) => e.item.key)).toEqual(["zero"]);
  });

  it("criticidade e selo recortam um valor por vez", () => {
    expect(
      filtrarPrioridades(entradas, { ...FILTRO_VAZIO, severidade: "CRITICO" }),
    ).toHaveLength(1);
    expect(
      filtrarPrioridades(entradas, { ...FILTRO_VAZIO, selo: "DINHEIRO" }).map(
        (e) => e.item.key,
      ),
    ).toEqual(["dinheiro"]);
  });

  it("a busca cobre título, código do atributo e equipamento, sem diferenciar caixa", () => {
    expect(
      filtrarPrioridades(entradas, { ...FILTRO_VAZIO, busca: "IPVA" }).map((e) => e.item.key),
    ).toEqual(["dinheiro"]);
    expect(
      filtrarPrioridades(entradas, { ...FILTRO_VAZIO, busca: "data_fim" }).map(
        (e) => e.item.key,
      ),
    ).toEqual(["critico"]);
    expect(filtrarPrioridades(entradas, { ...FILTRO_VAZIO, busca: "  " })).toHaveLength(4);
  });

  it("os recortes se combinam", () => {
    const saida = filtrarPrioridades(entradas, {
      ...FILTRO_VAZIO,
      foco: "ATENCAO",
      equipamento: "CAVALO",
      busca: "contrato",
    });
    expect(saida.map((e) => e.item.key)).toEqual(["critico"]);
  });

  it("recorte sem resultado devolve vazio — e nada é escondido da origem", () => {
    const saida = filtrarPrioridades(entradas, { ...FILTRO_VAZIO, busca: "inexistente" });
    expect(saida).toHaveLength(0);
    expect(entradas).toHaveLength(4);
  });
});

describe("contagens — nenhum botão promete o que não entrega", () => {
  it("conta cada foco sobre o recorte já aplicado de equipamento e busca", () => {
    const contagens = contarFocos(entradas, { ...FILTRO_VAZIO, equipamento: "CAVALO" });
    expect(contagens.TODOS).toBe(3);
    expect(contagens.ATENCAO).toBe(2);
    expect(contagens.IMPACTO).toBe(1);
    expect(contagens.SEM_PRECO).toBe(2);
    expect(contagens.ANOMALIA).toBe(1);
  });

  it("a contagem de um foco é o tamanho da lista que ele produz", () => {
    const filtro = { ...FILTRO_VAZIO, busca: "cavalo" };
    const contagens = contarFocos(entradas, filtro);
    for (const foco of ["TODOS", "ATENCAO", "IMPACTO", "SEM_PRECO", "ANOMALIA"] as const) {
      expect(contagens[foco]).toBe(filtrarPrioridades(entradas, { ...filtro, foco }).length);
    }
  });

  it("o foco corrente não influencia a própria contagem", () => {
    const comFoco = contarFocos(entradas, { ...FILTRO_VAZIO, foco: "ANOMALIA" });
    const semFoco = contarFocos(entradas, FILTRO_VAZIO);
    expect(comFoco).toEqual(semFoco);
  });
});

describe("estado do filtro", () => {
  it("o filtro vazio não é ativo; qualquer recorte é", () => {
    expect(filtroAtivo(FILTRO_VAZIO)).toBe(false);
    expect(filtroAtivo({ ...FILTRO_VAZIO, foco: "IMPACTO" })).toBe(true);
    expect(filtroAtivo({ ...FILTRO_VAZIO, busca: "ipva" })).toBe(true);
    expect(filtroAtivo({ ...FILTRO_VAZIO, busca: "   " })).toBe(false);
  });

  it("cabeNoFoco é a mesma regra que o filtro usa", () => {
    expect(cabeNoFoco(critico, "ANOMALIA")).toBe(true);
    expect(cabeNoFoco(comDinheiro, "ANOMALIA")).toBe(false);
    expect(cabeNoFoco(zeroApurado, "SEM_PRECO")).toBe(false);
  });

  it("os equipamentos do seletor vêm do panorama, sem os nulos", () => {
    const view = {
      cockpit: {
        panorama: {
          byEquipment: [
            { entityType: "CAVALO", equipment: "Cavalo", groups: 3, changes: 9, fleet: 62 },
            { entityType: null, equipment: "Sem equipamento", groups: 1, changes: 1, fleet: null },
          ],
          bySeverity: [],
          byBadge: [],
          pricing: {
            calculatedChanges: 0,
            excludedChanges: 0,
            notCalculableChanges: 0,
            lockedGroups: 0,
            reasons: [],
          },
        },
      },
    };
    expect(equipamentosDisponiveis(view)).toEqual([
      { entityType: "CAVALO", equipment: "Cavalo" },
    ]);
  });
});
