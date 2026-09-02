import { describe, expect, it } from "vitest";
import {
  filaDoPanorama,
  leituraDaUnidade,
  leituraDaVisaoGeral,
  mapaDoPanorama,
  placarDoPanorama,
  procedenciaDoPanorama,
  vereditoDoPanorama,
} from "../panorama";
import { ladosDoImpacto } from "../visao-geral";
import { coberturaDaVigencia, situacaoDaApuracao } from "../impacto-apurado";
import type { ItemCockpit } from "../cockpit";
import type { BalancoResumo } from "@/components/balanco/tipos";
import type {
  ChangeGroup,
  CockpitView,
  ExecutiveSummary,
  FamiliesOverview,
  FamiliesView,
  ImpactContributor,
  ImpactSummary,
  PriorityItem,
} from "@/components/inicio/types";

/**
 * O que o Panorama decide sozinho.
 *
 * O módulo existe para desfazer uma redundância, e o risco que ele traz é o
 * contrário dela: publicar um **quinto** número, diferente dos quatro que
 * consolidou, sobre o mesmo dado. Por isso a régua aqui não é de pixel — é de
 * reconciliação:
 *
 * 1. **O veredito do Panorama é o do Impacto Apurado.** Mesma `situacaoDaApuracao`,
 *    mesma `coberturaDaVigencia`, mesmos números. Um teste que compara os dois
 *    lados a partir da mesma resposta fecha a porta de a fusão inventar dinheiro.
 * 2. **A variação nunca compara grandezas diferentes.** R$/mês contra R$/ano é
 *    um percentual que nenhuma das duas justifica.
 * 3. **Há uma cobertura só no placar, e é a da apuração.** Era o defeito que a
 *    seção tinha: dois números em percentual, dois anéis, a mesma régua de cor e
 *    populações diferentes.
 * 4. **A fila funde três listas sem duplicar item nem inventar ordem.**
 * 5. **A Visão Geral não finge ser uma unidade.** Sem destino, sem fila, e o
 *    mapa troca de eixo em vez de desenhar um cartão vazio.
 * 6. **Zero não é ausência.** Sem dado, o andar some — não publica zeros.
 */

// ---------------------------------------------------------------------------
// Fixtures — os mesmos números da suíte do Impacto Apurado, de propósito: se as
// duas telas leem a mesma resposta, os testes têm de ler a mesma resposta.
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
  return { key, name: key, family: familia, familyName: familia, changes: 1, vehicles: 1, amount, ...extras };
}

function sumario(overrides: Partial<ExecutiveSummary> = {}): ExecutiveSummary {
  return {
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
          parameters: [contribuinte("financiamento", "AQUISICAO", 18742, { changes: 3, vehicles: 24 })],
        },
        losses: {
          total: -4652,
          changes: 3,
          vehicles: 9,
          parameters: [contribuinte("promocao", "COMERCIAL", -3012, { changes: 1, vehicles: 5 })],
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
  };
}

function grupo(overrides: Partial<ChangeGroup> = {}): ChangeGroup {
  return {
    key: "k",
    attributeCode: "financiamento",
    title: "Financiamento",
    entityType: "CAVALO",
    equipment: "Cavalo",
    changeType: "SOURCE_CHANGE",
    category: "VALOR",
    comparability: "COMPARABLE",
    changes: 1,
    vehicles: 1,
    entityIds: [],
    fleet: 10,
    coverage: "PARCIAL",
    coverageLabel: "parcial",
    patterns: 1,
    dominantPattern: null,
    aggregate: {
      summable: true,
      aggregation: "SUM",
      totalBefore: null,
      totalAfter: null,
      rowsInTotal: 1,
      perVehicle: null,
      deltaPercent: null,
      minPercent: null,
      maxPercent: null,
    },
    impact: {
      confidence: "CALCULATED",
      amount: -3012,
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
    semanticsLabel: "confirmada",
    unit: null,
    isMonetary: true,
    costClass: null,
    taxonomyName: null,
    inconclusiveReason: null,
    anomalies: [],
    formatOnly: false,
    composition: null,
    badge: "DINHEIRO",
    badgeLabel: "dinheiro",
    ...overrides,
  };
}

function prioridade(overrides: Partial<PriorityItem> = {}): PriorityItem {
  return { key: "k", severity: "CRITICO", reason: "perda relevante", ...overrides } as PriorityItem;
}

function vigencia(overrides: Partial<FamiliesView> = {}): FamiliesView {
  return {
    summary: sumario(),
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
      entitiesAdded: 3,
      entitiesRemoved: 1,
      unchanged: 0,
      inconclusive: 0,
    },
    entityIdsTouched: [],
    impact: impacto({ byPeriodicity: { MENSAL: 21931 }, calculatedChanges: 7, notCalculable: 95 }),
    accumulated: { ...impacto(), comparisons: 6, from: null, to: null },
    groups: [],
    families: [],
    freightechSemDado: [],
    cockpit: {
      baseline: { hasBaseline: true, seriesWithoutBaseline: [] },
      kpis: { fleet: 144 },
      panorama: { byEquipment: [{ equipment: "Carreta", entityType: "CARRETA", changes: 61 }] },
    } as unknown as CockpitView,
    ...overrides,
  } as FamiliesView;
}

function overviewDe(overrides: Partial<FamiliesOverview> = {}): FamiliesOverview {
  return {
    period: "2026-08-01",
    summary: sumario(),
    vehiclesTouchedDistinct: 96,
    unitsIncluded: [],
    unitsExcluded: [],
    consolidado: {
      families: [],
      totals: {
        changes: 102,
        vehiclesTouched: 80,
        entitiesAdded: 3,
        entitiesRemoved: 1,
        inconclusive: 0,
        fleet: 144,
      },
      groups: [],
      gruposNoTotal: 16,
    },
    parametros: null,
    ...overrides,
  } as FamiliesOverview;
}

const RECORTE = { period: "2026-08-01", scopeHash: "hash-pe", canal: "EMPURRADA" };

const filaDoCockpit = (grupos: Partial<ChangeGroup>[]): ItemCockpit[] =>
  grupos.map((g) => ({ item: prioridade(), group: grupo(g) }));

// ---------------------------------------------------------------------------
// 1. O veredito é o do Impacto Apurado — e não um quinto número
// ---------------------------------------------------------------------------

describe("o veredito", () => {
  it("publica exatamente a situação e a cobertura que o Impacto Apurado publica", () => {
    const view = vigencia();
    const leitura = leituraDaUnidade(view);
    const veredito = vereditoDoPanorama(leitura, null);

    /*
      A promessa central do módulo, escrita como teste: se os dois módulos
      lessem contas diferentes da mesma resposta, esta comparação quebraria — e
      é o único jeito de a regressão aparecer na revisão em vez de na reunião.
    */
    expect(veredito.situacao).toEqual(situacaoDaApuracao(view, view.totals.changes));
    expect(veredito.cobertura).toEqual(
      coberturaDaVigencia({ changes: 102 }, { notCalculable: 95 }),
    );
    expect(ladosDoImpacto(view)[0].liquido).toBe(21931);
  });

  it("cobre a vigência inteira: apurado + sem preço = alterações detectadas", () => {
    const veredito = vereditoDoPanorama(leituraDaUnidade(vigencia()), null);
    const c = veredito.cobertura!;
    expect(c.apurado + c.semPreco).toBe(c.total);
    expect(c.total).toBe(102);
  });

  it("sem alteração nenhuma não há cobertura a publicar — e nem um zero no lugar", () => {
    const view = vigencia({
      summary: sumario({ sides: [], changes: 0, notCalculable: 0, impact: impacto() }),
      totals: { ...vigencia().totals, changes: 0 },
      impact: impacto(),
    });
    const veredito = vereditoDoPanorama(leituraDaUnidade(view), null);
    expect(veredito.cobertura).toBeNull();
    expect(veredito.situacao.estado).toBe("sem_alteracao");
  });
});

describe("a variação contra a vigência anterior", () => {
  it("compara o mesmo balde de periodicidade", () => {
    const veredito = vereditoDoPanorama(leituraDaUnidade(vigencia()), {
      impact: { byPeriodicity: { MENSAL: 10000 } },
    });
    // 21931 sobre 10000 — a conta de `variacao`, e nada mais.
    expect(veredito.variacaoDoLiquido).toBeCloseTo(119.31, 2);
  });

  it("recusa comparar R$/mês com R$/ano", () => {
    const veredito = vereditoDoPanorama(leituraDaUnidade(vigencia()), {
      impact: { byPeriodicity: { ANUAL: 10000 } },
    });
    expect(veredito.variacaoDoLiquido).toBeNull();
  });

  it("recusa tratar a ausência do balde como zero", () => {
    /*
      Sem a chave, a anterior não teve movimento naquela grandeza. Ler isso como
      zero publicaria "+∞%" ou "o valor saiu do zero", que é um fato diferente
      de não ter havido valor.
    */
    const veredito = vereditoDoPanorama(leituraDaUnidade(vigencia()), {
      impact: { byPeriodicity: {} },
    });
    expect(veredito.variacaoDoLiquido).toBeNull();
  });

  it("não inventa comparação quando não há vigência anterior", () => {
    expect(vereditoDoPanorama(leituraDaUnidade(vigencia()), null).variacaoDoLiquido).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Uma cobertura só no placar — o conserto do defeito que a seção tinha
// ---------------------------------------------------------------------------

describe("o placar", () => {
  const placarDaUnidade = () => {
    const leitura = leituraDaUnidade(vigencia());
    return placarDoPanorama(leitura, vereditoDoPanorama(leitura, null), {
      recorte: RECORTE,
      comDestino: true,
      variacaoDeAlteracoes: null,
    });
  };

  it("publica uma cobertura só, e é a da apuração", () => {
    const coberturas = placarDaUnidade().filter((m) => m.rotulo.toLowerCase().includes("cobertura"));
    expect(coberturas).toHaveLength(1);
    expect(coberturas[0].chave).toBe("cobertura");
    expect(coberturas[0].rotulo).toBe("Cobertura da apuração");
    // A ajuda diz de que a outra é percentual, e onde ela mora.
    expect(coberturas[0].ajuda).toContain("célula");
  });

  it("tem cinco medidas, e o destaque é o líquido", () => {
    const placar = placarDaUnidade();
    expect(placar).toHaveLength(5);
    expect(placar.filter((m) => m.destaque)).toHaveLength(1);
    expect(placar.find((m) => m.destaque)!.chave).toBe("liquido");
  });

  it("escreve o líquido com a periodicidade colada — nunca um número sem grandeza", () => {
    const liquido = placarDaUnidade().find((m) => m.chave === "liquido")!;
    expect(liquido.valor).toContain("/mês");
  });

  it("na Visão Geral nenhuma medida aponta para uma tela de unidade", () => {
    const leitura = leituraDaVisaoGeral(overviewDe());
    const placar = placarDoPanorama(leitura, vereditoDoPanorama(leitura, null), {
      recorte: RECORTE,
      comDestino: false,
      variacaoDeAlteracoes: null,
    });
    expect(placar.every((m) => m.href === null)).toBe(true);
  });

  it("diz que os veículos são soma quando o servidor não mandou a união", () => {
    const overview = overviewDe({ vehiclesTouchedDistinct: undefined });
    const leitura = leituraDaVisaoGeral(overview);
    expect(leitura.veiculosDeduplicados).toBe(false);

    const placar = placarDoPanorama(leitura, vereditoDoPanorama(leitura, null), {
      recorte: RECORTE,
      comDestino: false,
      variacaoDeAlteracoes: null,
    });
    expect(placar.find((m) => m.chave === "veiculos")!.nota).toContain("soma das unidades");
  });

  it("sem valor apurado o líquido não vira R$ 0 — some do placar", () => {
    const view = vigencia({
      summary: sumario({ sides: [], impact: impacto({ notCalculable: 102 }), notCalculable: 102 }),
      impact: impacto({ notCalculable: 102 }),
    });
    const leitura = leituraDaUnidade(view);
    const placar = placarDoPanorama(leitura, vereditoDoPanorama(leitura, null), {
      recorte: RECORTE,
      comDestino: true,
      variacaoDeAlteracoes: null,
    });
    expect(placar.find((m) => m.chave === "liquido")!.valor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. As duas leituras, e o que cada uma sabe responder
// ---------------------------------------------------------------------------

describe("as duas leituras", () => {
  it("a unidade conta ativos distintos; a Visão Geral usa a união quando existe", () => {
    expect(leituraDaUnidade(vigencia()).veiculosDeduplicados).toBe(true);
    expect(leituraDaVisaoGeral(overviewDe()).veiculos).toBe(96);
    expect(leituraDaVisaoGeral(overviewDe({ vehiclesTouchedDistinct: undefined })).veiculos).toBe(80);
  });

  it("as duas atravessam os sete andares pela mesma forma", () => {
    const daUnidade = leituraDaUnidade(vigencia());
    const daSoma = leituraDaVisaoGeral(overviewDe());
    expect(Object.keys(daUnidade).sort()).toEqual(Object.keys(daSoma).sort());
  });
});

// ---------------------------------------------------------------------------
// 4. O mapa — o único andar que troca de eixo
// ---------------------------------------------------------------------------

describe("o mapa", () => {
  it("dentro de uma unidade fala de frota, com o equipamento mais tocado", () => {
    const view = vigencia();
    const mapa = mapaDoPanorama(leituraDaUnidade(view), view, []);
    expect(mapa.eixo).toBe("frota");
    if (mapa.eixo !== "frota") throw new Error("eixo errado");
    expect(mapa.entraram).toBe(3);
    expect(mapa.sairam).toBe(1);
    expect(mapa.ativos).toBe(144);
    expect(mapa.equipamento?.nome).toBe("Carreta");
  });

  it("na Visão Geral fala de unidades, e não desenha uma frota que não existe", () => {
    const mapa = mapaDoPanorama(leituraDaVisaoGeral(overviewDe()), null, [
      {
        chave: "hash-pe",
        label: "Pernambuco",
        impacto: { periodicity: "MENSAL", amount: -18420 },
        alteracoes: 61,
      },
      { chave: "hash-ba", label: "Bahia", impacto: null, alteracoes: 12 },
    ]);
    expect(mapa.eixo).toBe("unidades");
    if (mapa.eixo !== "unidades") throw new Error("eixo errado");
    expect(mapa.linhas[0].negativo).toBe(true);
    expect(mapa.linhas[0].impacto).toContain("/mês");
    /* Sem valor apurado é `null`, e não R$ 0: a unidade pode ter alterações
       das quais nenhuma virou dinheiro. */
    expect(mapa.linhas[1].impacto).toBeNull();
    expect(mapa.linhas[1].negativo).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. A fila — a fusão das três listas
// ---------------------------------------------------------------------------

describe("a fila", () => {
  const fila = (view: FamiliesView, prioridades: ItemCockpit[] = []) =>
    filaDoPanorama({
      view,
      veredito: vereditoDoPanorama(leituraDaUnidade(view), null),
      prioridades,
      recorte: RECORTE,
      comDestino: true,
    });

  it("traz o que `ondeAgirAgora` já trazia — as alterações sem preço", () => {
    const itens = fila(vigencia());
    const semPreco = itens.find((i) => i.chave === "sem-preco");
    expect(semPreco).toBeDefined();
    expect(semPreco!.titulo).toContain("95");
  });

  it("acrescenta o maior impacto negativo, que nenhuma das outras filas nomeava", () => {
    const view = vigencia({
      summary: sumario({
        topParameters: [
          { key: "ipva", name: "IPVA", family: "TRIBUTOS", familyName: "Tributos", changes: 41, byPeriodicity: { MENSAL: -8200 } },
          { key: "pedagio", name: "Pedágio", family: "VIAGEM", familyName: "Viagem", changes: 5, byPeriodicity: { MENSAL: 1200 } },
        ],
      }),
    });
    const maior = fila(view).find((i) => i.chave === "maior-impacto");
    expect(maior).toBeDefined();
    expect(maior!.titulo).toContain("IPVA");
    expect(maior!.detalhe).toContain("/mês");
  });

  it("não acrescenta o maior impacto quando ele é positivo — não é trabalho a fazer", () => {
    const view = vigencia({
      summary: sumario({
        topParameters: [
          { key: "bonus", name: "Bônus", family: "COMERCIAL", familyName: "Comercial", changes: 2, byPeriodicity: { MENSAL: 5000 } },
        ],
      }),
    });
    expect(fila(view).find((i) => i.chave === "maior-impacto")).toBeUndefined();
  });

  it("acrescenta o equipamento mais tocado", () => {
    const equipamento = fila(vigencia()).find((i) => i.chave === "equipamento");
    expect(equipamento).toBeDefined();
    expect(equipamento!.titulo).toContain("Carreta");
    expect(equipamento!.detalhe).toContain("61");
  });

  it("não publica um item duas vezes quando as duas fontes o produzem", () => {
    const chaves = fila(vigencia(), filaDoCockpit([{}])).map((i) => i.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("ordena por consequência: o grave antes do que é atenção", () => {
    const itens = fila(vigencia(), filaDoCockpit([{}]));
    const graves = itens.filter((i) => i.tom === "grave").length;
    expect(itens.slice(0, graves).every((i) => i.tom === "grave")).toBe(true);
  });

  it("não deixa entrar item tranquilizador — uma fila com 'nada a fazer' deixa de ser lida", () => {
    expect(fila(vigencia()).every((i) => i.tom !== "ok")).toBe(true);
  });

  it("a Visão Geral não tem fila: os destinos dela recortam por unidade", () => {
    expect(
      filaDoPanorama({
        view: null,
        veredito: vereditoDoPanorama(leituraDaVisaoGeral(overviewDe()), null),
        prioridades: [],
        recorte: RECORTE,
        comDestino: false,
      }),
    ).toEqual([]);
  });

  it("sem destino, nenhum item aponta para a lista de uma unidade que ninguém escolheu", () => {
    const itens = filaDoPanorama({
      view: vigencia(),
      veredito: vereditoDoPanorama(leituraDaUnidade(vigencia()), null),
      prioridades: [],
      recorte: RECORTE,
      comDestino: false,
    });
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every((i) => i.href === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. A procedência — e a cobertura que desceu para cá
// ---------------------------------------------------------------------------

describe("a procedência", () => {
  const balanco = (overrides: Partial<BalancoResumo> = {}): BalancoResumo =>
    ({
      entrada: 1000,
      residuo: 0,
      porNatureza: { PERDA: 60, RESIDUO: 0, DESCARTE: 0, DADO: 940, OUTRO: 0 },
      ...overrides,
    }) as BalancoResumo;

  it("publica a cobertura auditada — percentual de célula, não de dinheiro", () => {
    const p = procedenciaDoPanorama([balanco()], null)!;
    expect(p.cobertura!.percentual).toBeCloseTo(94, 5);
    expect(p.cobertura!.celulas).toBe(1000);
    expect(p.qualidade).not.toBeNull();
  });

  it("some inteira quando não há importação conferida — não desenha zeros", () => {
    expect(procedenciaDoPanorama(null, null)).toBeNull();
    expect(procedenciaDoPanorama([], [])).toBeNull();
  });

  it("a última importação sai com hora e distância", () => {
    const agora = new Date("2026-09-02T09:00:00Z");
    const p = procedenciaDoPanorama(
      null,
      [
        {
          importRunId: "1",
          status: "PROMOTED",
          filename: "cavalos.xlsx",
          receivedAt: "2026-09-02T07:00:00Z",
        },
      ],
      agora,
    );
    expect(p?.ultima?.filename).toBe("cavalos.xlsx");
  });
});
