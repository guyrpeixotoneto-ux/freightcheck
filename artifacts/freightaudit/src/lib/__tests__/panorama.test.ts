import { describe, expect, it } from "vitest";
import {
  estadoDaProcedencia,
  graoValido,
  leituraDaUnidade,
  leituraDaVisaoGeral,
  mapaDoPanorama,
  mapaVazio,
  placarDoPanorama,
  procedenciaDoPanorama,
  rankingPorFamilia,
  rankingPorParametro,
  vereditoDoPanorama,
} from "../panorama";
import { impactoPorFamilia, ladosDoImpacto } from "../visao-geral";
import {
  coberturaDaVigencia,
  mudancasRelevantes,
  situacaoDaApuracao,
} from "../impacto-apurado";
import type { ItemCockpit } from "../cockpit";
import type { BalancoDoRecorte } from "@/components/balanco/tipos";
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
      kpis: { fleet: 144, ativosNaFrota: 120, inativosNaFrota: 24 },
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
        ativosNaFrota: 120,
        inativosNaFrota: 24,
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

  /** A view de uma unidade com a situação da frota que se quiser. */
  const comSituacao = (ativosNaFrota: number, inativosNaFrota: number) =>
    vigencia({
      cockpit: {
        baseline: { hasBaseline: true, seriesWithoutBaseline: [] },
        kpis: { fleet: 144, ativosNaFrota, inativosNaFrota },
        panorama: { byEquipment: [] },
      },
    } as unknown as Partial<FamiliesView>);

  const notaDe = (view: FamiliesView): string => {
    const leitura = leituraDaUnidade(view);
    const placar = placarDoPanorama(leitura, vereditoDoPanorama(leitura, null), {
      recorte: RECORTE,
      comDestino: false,
      variacaoDeAlteracoes: null,
    });
    return placar.find((m) => m.chave === "veiculos")!.nota!;
  };

  it("conta a frota em equipamentos, e não em 'ativos'", () => {
    /*
      "Ativo" tem dois donos neste produto, e os dois aparecem na mesma frota:
      o bem — o sentido deste card — e a coluna `ativo` do export, que vale
      `ATIVO` ou `PARADO` e que `lib/remuneracao` conta à parte como "frota fixa
      inativos". Em PERNAMBUCO · agosto/2026 os dois números não coincidem: a
      vigência entregou 69 equipamentos, dos quais 55 em `ATIVO`.

      O card dizia "39% da frota (69 ativos)", e quem conhece a coluna lia 69
      rodando. O denominador nunca foi a coluna — é `count(DISTINCT entity_id)`
      sobre os fatos da vigência (`lib/comparison/src/grouped.ts`) —, então o
      número estava certo e a palavra é que emprestava a ele uma promessa que
      ele não cumpre.
    */
    const nota = notaDe(vigencia());
    expect(nota).toContain("144 equipamentos");
    // "ativos", no plural e como substantivo, era a palavra ambígua.
    expect(nota).not.toContain(" ativos");
  });

  it("diz quantos estão em ATIVO quando a frota inteira declara a coluna", () => {
    // 120 + 24 = 144: ninguém ficou sem responder, e não há o que ressalvar.
    expect(notaDe(comSituacao(120, 24))).toContain("144 equipamentos · 120 em ATIVO");
  });

  it("nomeia quem não trouxe a coluna, em vez de deixar a subtração inventá-los", () => {
    /*
      46 responderam ATIVO e 16 responderam PARADO, numa frota de 144: 82 não
      declararam a coluna — é o caso real das carretas, que não a têm. Sem a
      ressalva, "46 em ATIVO" sobre 144 equipamentos convida a subtrair, e a
      subtração chamaria de parados 98 veículos que a fonte nunca disse que
      estão.
    */
    const nota = notaDe(comSituacao(46, 16));
    expect(nota).toContain("46 em ATIVO");
    expect(nota).toContain("82 sem a coluna");
  });

  it("não quebra a página quando a resposta é anterior aos dois campos", () => {
    /*
      A interface é um bundle próprio, e uma resposta em cache de antes desta
      mudança não traz `ativosNaFrota`. Enquanto a leitura assumia o campo, o
      Panorama inteiro caía num `toLocaleString` de `undefined` — a página
      renderizava vazia, e o custo de acrescentar um número seria perder a tela.
      Ausente é "ninguém respondeu", e a nota volta a ser a de antes.
    */
    const semOsCampos = vigencia({
      cockpit: {
        baseline: { hasBaseline: true, seriesWithoutBaseline: [] },
        kpis: { fleet: 144 },
        panorama: { byEquipment: [] },
      },
    } as unknown as Partial<FamiliesView>);

    const nota = notaDe(semOsCampos);
    expect(nota).toContain("144 equipamentos");
    expect(nota).not.toContain("ATIVO");
    expect(nota).not.toContain("NaN");
  });

  it("cala sobre a situação quando ninguém declarou a coluna", () => {
    /*
      Uma frota só de carretas não responde a pergunta, e "0 em ATIVO" seria
      lido como frota inteira parada — o erro exato que a contagem de três
      pontas existe para não cometer. A nota volta a ser a de antes.
    */
    const nota = notaDe(comSituacao(0, 0));
    expect(nota).toContain("144 equipamentos");
    expect(nota).not.toContain("ATIVO");
    expect(nota).not.toContain("sem a coluna");
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

// ---------------------------------------------------------------------------
// 2b. O ranking — um cartão, dois grãos
// ---------------------------------------------------------------------------

/*
  O ranking substituiu três cartões que liam a mesma lista: dois pódios de
  família e uma lista de parâmetros. O risco da fusão é o oposto do da
  duplicação — uma régua só que responda errado a um dos recortes —, e é ele que
  estes testes vigiam: quem participa de cada lado, qual número cada linha
  publica, e a que a barra se compara.
*/
describe("o ranking da dobra 2", () => {
  /*
    Uma vigência com três famílias: uma que só somou, uma que só tirou, e uma
    que fez as duas e voltou ao mesmo lugar — a que o saldo esconde.
  */
  const familias = () =>
    impactoPorFamilia(
      vigencia({
        summary: sumario({
          sides: [
            {
              periodicity: "MENSAL",
              net: 6000,
              gains: {
                total: 46000,
                changes: 7,
                vehicles: 40,
                parameters: [
                  contribuinte("financiamento", "AQUISICAO", 6000, { changes: 2 }),
                  contribuinte("ipva", "TRIBUTOS", 40000, { changes: 5 }),
                ],
              },
              losses: {
                total: -40000,
                changes: 4,
                vehicles: 9,
                parameters: [
                  contribuinte("promocao", "COMERCIAL", -10000, { changes: 1 }),
                  contribuinte("licenciamento", "TRIBUTOS", -30000, { changes: 3 }),
                ],
              },
            },
          ],
        }),
      }),
      "MENSAL",
    );

  it("no recorte inteiro publica o líquido, e não repete o líquido embaixo", () => {
    const linhas = rankingPorFamilia(familias(), "todos", 6);

    /* TRIBUTOS somou 40 mil e tirou 30 mil: líquido de 10 mil. */
    const tributos = linhas.find((l) => l.chave === "TRIBUTOS")!;
    expect(tributos.valor).toBe(10000);
    expect(tributos.classificacao).toBe("ganho");
    /* O número de cima já é o líquido — repeti-lo embaixo diria duas vezes o
       mesmo. */
    expect(tributos.liquido).toBeNull();
  });

  it("no recorte de um lado publica a parcela, com o líquido embaixo", () => {
    const perdas = rankingPorFamilia(familias(), "perdas", 6);
    const tributos = perdas.find((l) => l.chave === "TRIBUTOS")!;

    expect(tributos.valor).toBe(-30000);
    expect(tributos.liquido).toBe(10000);
    expect(tributos.classificacao).toBe("perda");
  });

  it("a família que não participou do lado pedido não entra na lista", () => {
    /*
      AQUISICAO só somou. Nos ganhos ela é linha; nas perdas ela **não é zero**,
      ela não participou — e uma linha de R$ 0 ali diria que a família perdeu
      dinheiro e o valor foi nenhum.
    */
    expect(rankingPorFamilia(familias(), "ganhos", 6).map((l) => l.chave)).toContain("AQUISICAO");
    expect(rankingPorFamilia(familias(), "perdas", 6).map((l) => l.chave)).not.toContain(
      "AQUISICAO",
    );
  });

  it("as alterações da linha são as do lado pedido, e nunca as das duas somadas", () => {
    /*
      TRIBUTOS tem 5 alterações que somaram e 3 que tiraram. Repetir "8
      alterações" nos dois lados afirmaria que 16 alterações mexeram nesta
      família.
    */
    const ganhos = rankingPorFamilia(familias(), "ganhos", 6).find((l) => l.chave === "TRIBUTOS")!;
    const perdas = rankingPorFamilia(familias(), "perdas", 6).find((l) => l.chave === "TRIBUTOS")!;

    expect(ganhos.contexto).toContain("5");
    expect(perdas.contexto).toContain("3");
  });

  it("a barra mede contra a maior linha da própria lista", () => {
    const perdas = rankingPorFamilia(familias(), "perdas", 6);

    /* A maior perda enche a barra; a outra se mede contra ela. */
    expect(perdas[0]!.proporcao).toBe(1);
    expect(perdas[1]!.proporcao).toBeCloseTo(10000 / 30000, 5);
  });

  it("o grão do parâmetro é o degrau abaixo — mesma forma de linha, outro grão", () => {
    const resumo = vigencia();
    const linhas = rankingPorParametro(
      mudancasRelevantes(resumo, "MENSAL"),
      "todos",
      6,
    );

    expect(linhas.map((l) => l.chave)).toEqual(["financiamento", "promocao"]);
    /* A linha diz de que família o parâmetro vem — é o que a família, no grão
       de cima, não precisa dizer. */
    expect(linhas[0]!.contexto).toContain("AQUISICAO");
  });

  it("o limite é do chamador, e a lista respeita", () => {
    expect(rankingPorFamilia(familias(), "todos", 2)).toHaveLength(2);
  });

  it("grão de URL inválido não vira grão", () => {
    expect(graoValido("familia")).toBe(true);
    expect(graoValido("parametro")).toBe(true);
    expect(graoValido("placa")).toBe(false);
    expect(graoValido(null)).toBe(false);
  });
});

describe("o mapa vazio", () => {
  /*
    A pergunta é de grade, e não de cartão: o mapa divide a dobra 3 com o
    gráfico da trajetória, e um cartão que se apaga por dentro deixa metade da
    faixa em branco. Quem monta a grade precisa saber disto antes de desenhar —
    e precisa saber pela **mesma** regra que o cartão usa.
  */
  it("uma vigência sem tipo tocado e sem frota declarada não tem mapa", () => {
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
      cockpit: {
        baseline: { hasBaseline: true, seriesWithoutBaseline: [] },
        kpis: {},
        panorama: { byEquipment: [] },
      } as unknown as CockpitView,
    });
    expect(mapaVazio(mapaDoPanorama(leituraDaUnidade(vazia), vazia, []))).toBe(true);
  });

  it("com tipo tocado ou frota declarada, tem", () => {
    const leitura = leituraDaUnidade(vigencia());
    expect(mapaVazio(mapaDoPanorama(leitura, vigencia(), []))).toBe(false);
  });

  it("na Visão Geral sem unidade no ranking, não tem", () => {
    const leitura = leituraDaVisaoGeral(overviewDe());
    expect(mapaVazio(mapaDoPanorama(leitura, null, []))).toBe(true);
  });
});

describe("as duas leituras", () => {
  it("a unidade conta ativos distintos; a Visão Geral usa a união quando existe", () => {
    expect(leituraDaUnidade(vigencia()).veiculosDeduplicados).toBe(true);
    expect(leituraDaVisaoGeral(overviewDe()).veiculos).toBe(96);
    expect(leituraDaVisaoGeral(overviewDe({ vehiclesTouchedDistinct: undefined })).veiculos).toBe(80);
  });

  it("as duas atravessam os seis andares pela mesma forma", () => {
    const daUnidade = leituraDaUnidade(vigencia());
    const daSoma = leituraDaVisaoGeral(overviewDe());
    expect(Object.keys(daUnidade).sort()).toEqual(Object.keys(daSoma).sort());
  });
});

// ---------------------------------------------------------------------------
// 4. O mapa — o único andar que troca de eixo
// ---------------------------------------------------------------------------

describe("o mapa", () => {
  const comTipos = (baldes: { equipment: string; entityType: string | null; changes: number; groups?: number; fleet?: number | null }[]) =>
    vigencia({
      cockpit: {
        baseline: { hasBaseline: true, seriesWithoutBaseline: [] },
        kpis: { fleet: 144, ativosNaFrota: 120, inativosNaFrota: 24 },
        panorama: { byEquipment: baldes },
      } as unknown as CockpitView,
    });

  const DESTINO = { recorte: RECORTE, comDestino: true };

  it("dentro de uma unidade ranqueia os tipos de ativo, e por alteração", () => {
    /*
      A carreta tem a frota maior e mexeu menos. Ranquear por frota responderia
      uma pergunta que ninguém fez — a frota é a mesma de vigência em vigência;
      o que muda, e o que o andar pergunta, é onde esta vigência mexeu.
    */
    const view = comTipos([
      { equipment: "Carreta", entityType: "CARRETA", changes: 23, groups: 5, fleet: 71 },
      { equipment: "Cavalo", entityType: "CAVALO", changes: 244, groups: 15, fleet: 62 },
    ]);
    const mapa = mapaDoPanorama(leituraDaUnidade(view), view, [], DESTINO);

    expect(mapa.eixo).toBe("tipos");
    if (mapa.eixo !== "tipos") throw new Error("eixo errado");
    expect(mapa.tipos.map((t) => t.nome)).toEqual(["Cavalo", "Carreta"]);
    expect(mapa.tipos[0].alteracoes).toBe(244);
    expect(mapa.tipos[0].proporcao).toBe(1);
    expect(mapa.tipos[1].proporcao).toBeCloseTo(23 / 244, 5);
    /* A linha diz em quantos parâmetros, e de que frota — é a razão entre os
       dois que qualifica a contagem. */
    expect(mapa.tipos[0].contexto).toBe("15 parâmetros · frota de 62");
  });

  it("ranqueia **todos** os tipos que a vigência trouxe, e não só o mais tocado", () => {
    /*
      Esta é a promessa que o cartão antigo quebrava, e ela não é de estilo.

      `byEquipment` é montado no servidor a partir de `group.entityType`, sem
      lista fixa (`lib/comparison/src/cockpit.ts`): o balde existe porque a
      vigência trouxe aquele tipo. Trecho é da **mesma família** do cavalo e da
      carreta (`REMUNERACAO_EQUIPAMENTO`, em `lib/ingest/src/tipos.ts`), e por
      isso ele chega aqui pelo mesmo caminho, sem nada a acrescentar.

      O cartão antigo lia `equipamentoMaisTocado` — um balde, o do topo — e o
      publicava como "Cavalo — o mais tocado". Numa vigência de cavalo, carreta
      e trecho, dois terços do "onde aconteceu" não apareciam na tela, e nada
      dizia que existiam. Este teste prende o contrário: entrou na resposta,
      está na lista.
    */
    const view = comTipos([
      { equipment: "Cavalo", entityType: "CAVALO", changes: 244, groups: 15, fleet: 62 },
      { equipment: "Trecho", entityType: "TRECHO", changes: 118, groups: 6, fleet: 940 },
      { equipment: "Carreta", entityType: "CARRETA", changes: 23, groups: 5, fleet: 71 },
    ]);
    const mapa = mapaDoPanorama(leituraDaUnidade(view), view, [], DESTINO);
    if (mapa.eixo !== "tipos") throw new Error("eixo errado");

    expect(mapa.tipos.map((t) => t.nome)).toEqual(["Cavalo", "Trecho", "Carreta"]);
    /* O trecho não é identificado por placa — a "frota" dele é a contagem de
       chaves de trecho da vigência, e a linha a publica como as outras. */
    expect(mapa.tipos[1].contexto).toBe("6 parâmetros · frota de 940");
    expect(mapa.tipos[1].href).toContain("entityType=TRECHO");
  });

  it("a linha leva à lista de alterações daquele tipo, pelo código e não pelo nome", () => {
    const view = comTipos([
      { equipment: "Cavalo", entityType: "CAVALO", changes: 244, groups: 15, fleet: 62 },
    ]);
    const mapa = mapaDoPanorama(leituraDaUnidade(view), view, [], DESTINO);
    if (mapa.eixo !== "tipos") throw new Error("eixo errado");

    expect(mapa.tipos[0].href).toContain("entityType=CAVALO");
    expect(mapa.tipos[0].href).toContain("scopeHash=hash-pe");
  });

  it("na Visão Geral a linha do tipo não aponta para tela de unidade", () => {
    /*
      A mesma recusa do placar: um endereço sem `scopeHash` cai na unidade
      padrão do servidor, e a linha abriria a lista de **uma** debaixo de
      números que somaram todas. (Aqui o eixo é o de unidades, e o de tipos nem
      existe — o teste do destino vale para o caminho de unidade sem destino.)
    */
    const view = comTipos([
      { equipment: "Cavalo", entityType: "CAVALO", changes: 244, groups: 15, fleet: 62 },
    ]);
    const mapa = mapaDoPanorama(leituraDaUnidade(view), view, [], {
      recorte: RECORTE,
      comDestino: false,
    });
    if (mapa.eixo !== "tipos") throw new Error("eixo errado");
    expect(mapa.tipos[0].href).toBeNull();
  });

  it("um tipo sem alteração não entra na lista", () => {
    /* Não é um tipo de zero alterações: é um tipo que esta vigência não tocou. */
    const view = comTipos([
      { equipment: "Cavalo", entityType: "CAVALO", changes: 244, groups: 15, fleet: 62 },
      { equipment: "Trecho", entityType: "TRECHO", changes: 0, groups: 0, fleet: 9 },
    ]);
    const mapa = mapaDoPanorama(leituraDaUnidade(view), view, [], DESTINO);
    if (mapa.eixo !== "tipos") throw new Error("eixo errado");
    expect(mapa.tipos.map((t) => t.nome)).toEqual(["Cavalo"]);
  });

  it("uma resposta sem os dois campos novos não quebra a linha — ela cala", () => {
    /*
      `groups` e `fleet` podem faltar numa resposta de versão anterior ainda em
      cache, e o tipo não protege contra o que já está gravado no navegador.
      Zero parâmetros e frota nula são os dois casos em que a cláusula some, em
      vez de publicar "0 parâmetros" para um tipo que teve 244 alterações.
    */
    const view = comTipos([{ equipment: "Cavalo", entityType: "CAVALO", changes: 244 }]);
    const mapa = mapaDoPanorama(leituraDaUnidade(view), view, [], DESTINO);
    if (mapa.eixo !== "tipos") throw new Error("eixo errado");

    expect(mapa.tipos[0].alteracoes).toBe(244);
    expect(mapa.tipos[0].contexto).toBe("");
    expect(mapa.tipos[0].frota).toBeNull();
  });

  it("a movimentação da frota vem separada, e com a frota nomeada como frota", () => {
    /*
      O cartão antigo publicava `ativos: leitura.frota` debaixo do rótulo
      "Veículos ativos" — 144 entregues onde os que respondem ATIVO eram 120.
      Aqui as duas pontas viajam nomeadas, e a terceira (quem não trouxe a
      coluna) não é inventada pela subtração.
    */
    const view = vigencia();
    const mapa = mapaDoPanorama(leituraDaUnidade(view), view, [], DESTINO);
    if (mapa.eixo !== "tipos") throw new Error("eixo errado");

    expect(mapa.movimento).toEqual({
      frota: 144,
      ativos: 120,
      inativos: 24,
      entraram: 3,
      sairam: 1,
    });
  });

  it("na Visão Geral fala de unidades, e não desenha uma frota que não existe", () => {
    const mapa = mapaDoPanorama(
      leituraDaVisaoGeral(overviewDe()),
      null,
      [
        {
          chave: "hash-pe",
          label: "Pernambuco",
          impacto: { periodicity: "MENSAL", amount: -18420 },
          alteracoes: 61,
        },
        { chave: "hash-ba", label: "Bahia", impacto: null, alteracoes: 12 },
      ],
      { recorte: RECORTE, comDestino: false },
    );
    expect(mapa.eixo).toBe("unidades");
    if (mapa.eixo !== "unidades") throw new Error("eixo errado");
    expect(mapa.linhas[0].negativo).toBe(true);
    expect(mapa.linhas[0].impacto).toContain("/mês");
    /* A barra da unidade mede contra a maior do ranking — a mesma régua das
       outras duas listas da tela. */
    expect(mapa.linhas[0].proporcao).toBe(1);
    /* Sem valor apurado é `null`, e não R$ 0: a unidade pode ter alterações
       das quais nenhuma virou dinheiro. */
    expect(mapa.linhas[1].impacto).toBeNull();
    expect(mapa.linhas[1].negativo).toBeNull();
    expect(mapa.linhas[1].proporcao).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. A procedência — o recorte, e as contagens que substituíram o percentual
// ---------------------------------------------------------------------------

/** Uma resposta de `/balance/recorte`, com o mínimo que a tela lê. */
const recorte = (over: {
  arquivos?: number;
  fecham?: number;
  celulasDosArquivos?: number;
  residuo?: number;
  exclusiva?: boolean;
  celulasEmFato?: number;
  ultima?: BalancoDoRecorte["ultima"];
} = {}): BalancoDoRecorte => ({
  recorte: {
    operacao: "EMPURRADA",
    scopeHash: "hash-pe",
    canal: "EMPURRADA",
    period: "2026-08-01",
    label: "PERNAMBUCO · EMPURRADA",
  },
  importacoes: [],
  conservacao: {
    arquivos: over.arquivos ?? 3,
    fecham: over.fecham ?? 3,
    celulasDosArquivos: over.celulasDosArquivos ?? 47_318,
    residuo: over.residuo ?? 0,
    exclusivaDesteRecorte: over.exclusiva ?? true,
  },
  atribuido: { vigenciasVivas: 1, celulasEmFato: over.celulasEmFato ?? 12_004 },
  ultima:
    over.ultima === undefined
      ? {
          importRunId: "1",
          filename: "cavalos.xlsx",
          status: "PROMOTED",
          receivedAt: "2026-09-02T07:00:00Z",
        }
      : over.ultima,
});

describe("a procedência", () => {
  const AGORA = new Date("2026-09-02T09:00:00Z");

  it("publica contagens, e nenhum percentual", () => {
    const p = procedenciaDoPanorama(recorte(), AGORA)!;

    expect(p.arquivos).toEqual({ total: 3, fecham: 3, exclusivos: true });
    expect(p.celulasEmFato).toBe(12_004);
    expect(p.massaDosArquivos).toBe(47_318);
    /*
      A régua deste andar: nenhum campo é fração de nada. Cobertura auditada
      recortada não é grandeza bem definida — o resíduo nunca virou fato, logo
      não tem unidade a que pertencer —, e um percentual aqui rateava o
      irrateável.
    */
    expect(Object.keys(p)).not.toContain("cobertura");
    expect(Object.keys(p)).not.toContain("qualidade");
    expect(JSON.stringify(p)).not.toMatch(/percentual/i);
  });

  it("separa a massa dos arquivos das células do recorte", () => {
    /*
      São populações diferentes, e a diferença é o que impede a divisão de uma
      pela outra: a massa é integral dos arquivos e pode conter célula de outra
      unidade; as células em fato são deste recorte.
    */
    const p = procedenciaDoPanorama(
      recorte({ celulasDosArquivos: 100_000, celulasEmFato: 4_000 }),
      AGORA,
    )!;

    expect(p.massaDosArquivos).toBe(100_000);
    expect(p.celulasEmFato).toBe(4_000);
  });

  it("carrega o recorte que o servidor resolveu, e não o que a tela pediu", () => {
    const p = procedenciaDoPanorama(recorte(), AGORA)!;
    expect(p.recorte.label).toBe("PERNAMBUCO · EMPURRADA");
    expect(p.recorte.period).toBe("2026-08-01");
  });

  it("some inteira quando nenhum arquivo alimenta o recorte — não desenha zeros", () => {
    expect(procedenciaDoPanorama(null, AGORA)).toBeNull();
    expect(procedenciaDoPanorama(undefined, AGORA)).toBeNull();
    expect(procedenciaDoPanorama(recorte({ arquivos: 0, fecham: 0 }), AGORA)).toBeNull();
  });

  it("diz quando a massa não é exclusiva deste recorte", () => {
    const p = procedenciaDoPanorama(recorte({ exclusiva: false }), AGORA)!;
    expect(p.arquivos.exclusivos).toBe(false);
  });

  it("a última importação é a do recorte, com hora e distância", () => {
    const p = procedenciaDoPanorama(recorte(), AGORA)!;
    expect(p.ultima?.filename).toBe("cavalos.xlsx");
    expect(p.ultima?.relativo).toBe("há 2h");
  });

  it("sem última importação, cala em vez de fabricar uma data", () => {
    const p = procedenciaDoPanorama(recorte({ ultima: null }), AGORA)!;
    expect(p.ultima).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Em que pé está a procedência — os quatro fatos que eram um nada só
// ---------------------------------------------------------------------------

/*
  Até aqui os quatro terminavam no mesmo pixel: as consultas saíam com
  `.catch(() => null)`, e um `null` fazia o andar sumir. "Não há importação
  conferida", "a API respondeu 503", "ainda estou lendo" e "o seu acesso não
  alcança isto" viravam a mesma tela — a ausência —, num andar cuja pergunta é
  "posso confiar nisto?".

  A régua destes casos é uma só: **nenhum desfecho pode ser confundido com
  outro**, e o que não se sabe nunca pode sair como se soubesse.
*/
describe("o estado do andar da procedência", () => {
  const AGORA = new Date("2026-09-02T09:00:00Z");
  const PRONTA = () => procedenciaDoPanorama(recorte(), AGORA);

  /** Uma leitura que respondeu. */
  const respondeu = (rota: string) => ({ rota, carregando: false, dados: {}, erro: null });

  /** Uma leitura que falhou, com o status que o servidor deu. */
  const falhou = (rota: string, status: number | null, erroEm = 1_756_800_000_000) => ({
    rota,
    carregando: false,
    dados: undefined,
    erro: status === null ? new TypeError("Failed to fetch") : { status },
    erroEm,
  });

  const lendo = (rota: string) => ({ rota, carregando: true, dados: undefined, erro: null });

  it("com resposta e dado a publicar, está pronta", () => {
    const estado = estadoDaProcedencia([respondeu("/balance/recorte")], PRONTA());

    expect(estado.estado).toBe("pronta");
    if (estado.estado !== "pronta") throw new Error("desfecho errado");
    expect(estado.procedencia.celulasEmFato).toBe(12_004);
  });

  it("distingue 'não há o que conferir' de 'não consegui ler'", () => {
    const vazia = estadoDaProcedencia([respondeu("/balance/recorte")], null);
    const falha = estadoDaProcedencia([falhou("/balance/recorte", 503)], null);

    expect(vazia.estado).toBe("vazia");
    expect(falha.estado).toBe("falha");
  });

  it("não chama de vazia uma leitura que ainda não começou", () => {
    /*
      A consulta fica desligada até o conteúdo principal chegar, e `isPending` é
      verdadeiro o tempo todo aí. Tratá-la como decidida publicaria "nenhuma
      importação passou pela conferência" sobre uma pergunta que ninguém tinha
      feito ainda.
    */
    expect(estadoDaProcedencia([lendo("/balance/recorte")], null).estado).toBe("carregando");
  });

  it("espera todas se decidirem antes de anunciar uma falha", () => {
    /*
      Um 403 responde em milissegundos e uma leitura lenta demora segundos: sem
      esta espera o andar piscaria "falhou" e viraria "parcial" com o dado que
      estava a caminho.
    */
    const estado = estadoDaProcedencia([falhou("/a", 503), lendo("/b")], null);
    expect(estado.estado).toBe("carregando");
  });

  it("401 e 403 são acesso, e não falha de leitura", () => {
    for (const status of [401, 403]) {
      expect(estadoDaProcedencia([falhou("/balance/recorte", status)], null).estado).toBe(
        "sem_acesso",
      );
    }
  });

  it("uma recusa de acesso ao lado de uma falha de servidor é falha", () => {
    /*
      Mandar quem está na tela falar com o administrador da unidade sobre um
      servidor com defeito é o tipo de recomendação que faz perder a viagem.
    */
    const estado = estadoDaProcedencia([falhou("/a", 403), falhou("/b", 500)], null);
    expect(estado.estado).toBe("falha");
  });

  it("com dado publicável e uma leitura falhada, é parcial e nomeia o que faltou", () => {
    /*
      O Panorama lê uma fonte só hoje, então ele não produz este desfecho. A
      regra fica porque a máquina é de N leituras: quem acrescentar uma segunda
      fonte recebe o comportamento certo em vez de reinventá-lo.
    */
    const estado = estadoDaProcedencia(
      [respondeu("/balance/recorte"), falhou("/imports", 503)],
      PRONTA(),
    );

    expect(estado.estado).toBe("parcial");
    if (estado.estado !== "parcial") throw new Error("desfecho errado");
    expect(estado.procedencia.celulasEmFato).toBe(12_004);
    expect(estado.faltou).toHaveLength(1);
    expect(estado.faltou[0]!.rota).toBe("/imports");
    expect(estado.faltou[0]!.status).toBe(503);
  });

  it("não inventa status para uma falha que não teve um", () => {
    /*
      Uma queda de rede sobe um `TypeError` sem status nenhum. Escrever "HTTP
      500" aqui explicaria uma causa que a tela não conhece.
    */
    const estado = estadoDaProcedencia([falhou("/balance/recorte", null)], null);

    expect(estado.estado).toBe("falha");
    if (estado.estado !== "falha") throw new Error("desfecho errado");
    expect(estado.falhas[0]!.status).toBeNull();
    expect(estado.falhas[0]!.semAcesso).toBe(false);
  });

  it("a hora da falha é a do registro dela, e nunca a de agora", () => {
    const estado = estadoDaProcedencia(
      [
        falhou("/a", 503, Date.parse("2026-09-02T08:59:12Z")),
        falhou("/b", 503, 0),
      ],
      null,
    );

    if (estado.estado !== "falha") throw new Error("desfecho errado");
    expect(estado.falhas[0]!.quando?.toISOString()).toBe("2026-09-02T08:59:12.000Z");
    /* Sem carimbo, a tela cala sobre a hora em vez de fabricar uma. */
    expect(estado.falhas[1]!.quando).toBeNull();
  });

  it("uma falha nunca vira 'vazia'", () => {
    /*
      O caso que o `.catch(() => null)` produzia: o erro sumia, a procedência
      saía `null`, e a tela publicava a ausência — que é uma afirmação sobre o
      acervo — a partir de um servidor que caiu.
    */
    expect(estadoDaProcedencia([falhou("/balance/recorte", 500)], null).estado).toBe("falha");
  });
});
