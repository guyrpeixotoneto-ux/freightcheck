import { describe, expect, it } from "vitest";
import {
  ESCOPOS,
  combina,
  contarPorEscopo,
  ehEscopo,
  ehOrdem,
  escopoDoAtributo,
  escoposImportados,
  montarAtributos,
  ordenar,
  type AtributoRender,
} from "../escopos";
import { ESCOPOS_DE_CONJUNTO } from "@workspace/comparison/composition";
import type { ChangeGroup, FamiliesView } from "@/components/inicio/types";

/**
 * O que a grade de atributos decide sozinha.
 *
 * Três coisas, e as três podem errar em silêncio — que é o que as põe sob
 * teste. **A classificação por escopo**, porque pendurar `carreta.custo_fixo`
 * entre as carretas em vez de no conjunto convida a somar o cavalo duas vezes,
 * e a tela não teria como avisar. **A ordenação por impacto**, porque tratar
 * "sem preço" como zero esconderia justamente a linha que precisa de decisão
 * humana. **A busca**, porque quem chega com o nome da coluna anotado da
 * planilha e não encontra conclui que o produto não cobre o assunto — foi
 * exatamente essa a queixa que esta grade existe para responder.
 *
 * Nada aqui testa pixel.
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

function atributo(overrides: Partial<AtributoRender> = {}): AtributoRender {
  const g = overrides.grupo ?? grupo();
  return {
    chave: g.key,
    code: g.attributeCode,
    titulo: g.title,
    escopo: "CAVALO",
    equipamento: g.equipment,
    parametro: "Financiamento",
    parametroChave: "AQUISICAO_FINANCIAMENTO|Financiamento",
    familia: "Aquisição e financiamento",
    grupo: g,
    ...overrides,
  };
}

/** Uma `FamiliesView` com só o que estas funções leem. */
function view(parcial: {
  groups: ChangeGroup[];
  familias?: { name: string; parameters: { name: string; groups: ChangeGroup[] }[] }[];
  series?: { entityTypeSet: string }[];
}): FamiliesView {
  return {
    groups: parcial.groups,
    families: (parcial.familias ?? []).map((f) => ({
      code: f.name,
      name: f.name,
      origin: "FREIGHTCHECK",
      note: "",
      parametersWithData: 0,
      parametersChanged: 0,
      changes: 0,
      vehicles: 0,
      impact: {} as never,
      critical: 0,
      locked: 0,
      parameters: f.parameters.map((p) => ({
        key: `${f.name}|${p.name}`,
        name: p.name,
        family: f.name,
        pending: null,
        changes: 0,
        vehicles: 0,
        impact: {} as never,
        groups: p.groups,
      })),
    })),
    series: (parcial.series ?? []).map((s) => ({
      entityTypeSet: s.entityTypeSet,
      equipment: s.entityTypeSet,
      snapshotLabel: "",
      previousLabel: null,
      previousPeriod: null,
      previousPeriodLabel: null,
      fleet: 0,
      changeSetId: null,
      reason: null,
    })),
  } as unknown as FamiliesView;
}

describe("de qual escopo é um atributo", () => {
  it("os cinco tipos importáveis caem cada um no seu", () => {
    expect(escopoDoAtributo("cavalo.finame_cavalo", "CAVALO")).toBe("CAVALO");
    expect(escopoDoAtributo("carreta.pneu", "CARRETA")).toBe("CARRETA");
    expect(escopoDoAtributo("trecho.km", "TRECHO")).toBe("TRECHO");
    expect(escopoDoAtributo("qlp.ordenado", "QLP_ADMINISTRATIVO")).toBe(
      "QLP_ADMINISTRATIVO",
    );
    expect(escopoDoAtributo("qlp.piso", "QLP_OPERACIONAL")).toBe("QLP_OPERACIONAL");
  });

  /*
    A regra que sustenta a existência do escopo CONJUNTO. `carreta.custo_fixo`
    é guardado como CARRETA no banco — e é da carreta que ele vem, na linha e no
    arquivo. O que ele **vale** é o par: o financiamento do cavalo vinculado já
    está dentro dele. Um cartão desses entre as carretas é o convite mais curto
    a somar cada cavalo duas vezes, e quem soma não teria nada na tela dizendo
    que somou errado.
  */
  it("a coluna medida como de conjunto vence o entity_type do banco", () => {
    for (const escopo of ESCOPOS_DE_CONJUNTO) {
      expect(escopoDoAtributo(escopo.code, escopo.entityType)).toBe("CONJUNTO");
    }
  });

  it("a lista de conjunto não é uma segunda lista escrita aqui", () => {
    // Se `ESCOPOS_DE_CONJUNTO` ganhar uma quinta coluna medida, ela passa a ser
    // do conjunto nesta tela sem ninguém tocar em `escopos.ts`. É o ponto de
    // importar a lista em vez de copiá-la.
    expect(ESCOPOS_DE_CONJUNTO.length).toBeGreaterThan(0);
    expect(
      ESCOPOS_DE_CONJUNTO.every((e) => escopoDoAtributo(e.code, e.entityType) === "CONJUNTO"),
    ).toBe(true);
  });

  it("o tipo com dois equipamentos é conjunto", () => {
    expect(escopoDoAtributo("qualquer.coisa", "CARRETA+CAVALO")).toBe("CONJUNTO");
  });

  it("o que não é nenhum dos cinco não é encaixado no mais provável", () => {
    expect(escopoDoAtributo("algo.novo", "REBOQUE")).toBe("SEM_ESCOPO");
    expect(escopoDoAtributo(null, null)).toBe("SEM_ESCOPO");
    expect(escopoDoAtributo("algo.novo", "")).toBe("SEM_ESCOPO");
  });

  it("aceita o tipo em caixa baixa e com espaço", () => {
    expect(escopoDoAtributo(null, " cavalo ")).toBe("CAVALO");
  });
});

describe("montar a lista a partir da vigência", () => {
  it("um atributo por grupo, com a procedência do parâmetro e da família", () => {
    const a = grupo({ key: "a", attributeCode: "cavalo.finame_cavalo" });
    const b = grupo({ key: "b", attributeCode: "carreta.custo_fixo", entityType: "CARRETA" });

    const atributos = montarAtributos(
      view({
        groups: [a, b],
        familias: [
          {
            name: "Aquisição e financiamento",
            parameters: [{ name: "Financiamento", groups: [a, b] }],
          },
        ],
      }),
    );

    expect(atributos).toHaveLength(2);
    expect(atributos[0]).toMatchObject({
      chave: "a",
      code: "cavalo.finame_cavalo",
      escopo: "CAVALO",
      parametro: "Financiamento",
      // A chave do parâmetro é o que liga o atributo à gaveta do espelho.
      parametroChave: "Aquisição e financiamento|Financiamento",
      familia: "Aquisição e financiamento",
    });
    expect(atributos[1].escopo).toBe("CONJUNTO");
  });

  /*
    Um grupo que a árvore de famílias não alcança continua na grade. Ele existe
    em `view.groups`, que é a lista inteira; sumir com ele por falta de
    procedência seria esconder uma alteração real por um detalhe de arrumação.
  */
  it("grupo sem procedência entra assim mesmo, dito como tal", () => {
    const atributos = montarAtributos(view({ groups: [grupo({ key: "orfao" })] }));
    expect(atributos).toHaveLength(1);
    expect(atributos[0].parametro).toBe("Sem parâmetro");
    // Sem chave não há link para o espelho — e é melhor não ter link do que ter
    // um que abra a gaveta errada.
    expect(atributos[0].parametroChave).toBeNull();
  });

  it("sem vigência, lista vazia", () => {
    expect(montarAtributos(null)).toEqual([]);
  });
});

describe("a busca", () => {
  const item = atributo({
    grupo: grupo({ attributeCode: "cavalo.finame_cavalo", title: "Financiamento do cavalo" }),
    code: "cavalo.finame_cavalo",
    titulo: "Financiamento do cavalo",
    parametro: "Financiamento",
    familia: "Aquisição e financiamento",
    equipamento: "Cavalo",
  });

  it("acha pelo rótulo, pelo código, pelo parâmetro e pela família", () => {
    expect(combina(item, "financiamento do cavalo")).toBe(true);
    expect(combina(item, "cavalo.finame_cavalo")).toBe(true);
    expect(combina(item, "finame")).toBe(true);
    expect(combina(item, "aquisição")).toBe(true);
  });

  it("ignora acento e caixa", () => {
    expect(combina(item, "AQUISICAO")).toBe(true);
    expect(combina(item, "aquisicao")).toBe(true);
  });

  /*
    Palavras soltas, em qualquer ordem e em qualquer campo. Sem isto, "finame
    cavalo" exigiria que alguém adivinhasse como as duas aparecem juntas — e
    elas aparecem em campos diferentes.
  */
  it("cada palavra do termo tem de aparecer, em qualquer campo e em qualquer ordem", () => {
    expect(combina(item, "finame cavalo")).toBe(true);
    expect(combina(item, "cavalo finame")).toBe(true);
    expect(combina(item, "finame carreta")).toBe(false);
  });

  it("termo vazio não filtra nada", () => {
    expect(combina(item, "")).toBe(true);
    expect(combina(item, "   ")).toBe(true);
  });
});

describe("a ordenação", () => {
  const comValor = (chave: string, amount: number | null, changes = 1, vehicles = 1) =>
    atributo({
      chave,
      titulo: chave,
      grupo: grupo({
        key: chave,
        title: chave,
        changes,
        vehicles,
        impact: { ...grupo().impact, amount, periodicity: amount === null ? null : "MENSAL" },
      }),
    });

  /*
    A recusa mais importante desta tela, dita na ordenação: **sem preço não é
    zero.** Um atributo sem impacto apurado ordenado como zero cairia no meio da
    lista, entre as perdas e os ganhos, e passaria por "mexeu pouco" quando o
    que ele diz é "ninguém sabe quanto". Ele vai para o fim, onde é visível como
    uma classe própria.
  */
  it("por impacto: tamanho do movimento primeiro, sem preço por último", () => {
    const ordenados = ordenar(
      [comValor("pequeno", -100), comValor("sem preço", null), comValor("grande", 9000)],
      "impacto",
    );
    expect(ordenados.map((a) => a.chave)).toEqual(["grande", "pequeno", "sem preço"]);
  });

  it("por impacto, perda e ganho competem pelo tamanho e não pelo sinal", () => {
    const ordenados = ordenar([comValor("ganho", 100), comValor("perda", -900)], "impacto");
    expect(ordenados.map((a) => a.chave)).toEqual(["perda", "ganho"]);
  });

  it("por veículos, por alterações e por nome", () => {
    const itens = [
      comValor("b", null, 1, 30),
      comValor("a", null, 9, 2),
      comValor("c", null, 3, 60),
    ];
    expect(ordenar(itens, "veiculos").map((a) => a.chave)).toEqual(["c", "b", "a"]);
    expect(ordenar(itens, "alteracoes").map((a) => a.chave)).toEqual(["a", "c", "b"]);
    expect(ordenar(itens, "nome").map((a) => a.chave)).toEqual(["a", "b", "c"]);
  });

  it("não altera a lista recebida", () => {
    const itens = [comValor("b", 1), comValor("a", 9)];
    ordenar(itens, "impacto");
    expect(itens.map((a) => a.chave)).toEqual(["b", "a"]);
  });
});

describe("as contagens da barra de escopos", () => {
  /*
    Atributos e alterações somam; veículos não têm número aqui. O mesmo cavalo
    aparece em dez colunas, e somá-lo diria "72 tocados" numa frota de 62 — o
    erro que a barra existe para não cometer. A pergunta de veículos é
    respondida no cartão de cada atributo, com o número exato.
  */
  it("conta atributos e alterações, e não publica veículos", () => {
    const contagens = contarPorEscopo([
      atributo({ chave: "a", grupo: grupo({ key: "a", changes: 62, vehicles: 62 }) }),
      atributo({ chave: "b", grupo: grupo({ key: "b", changes: 10, vehicles: 10 }) }),
    ]);

    expect(contagens).toHaveLength(1);
    expect(contagens[0]).toMatchObject({ atributos: 2, alteracoes: 72 });
    expect(contagens[0]).not.toHaveProperty("veiculos");
  });

  it("sai na ordem dos escopos, e não na de chegada", () => {
    const contagens = contarPorEscopo([
      atributo({ chave: "q", escopo: "QLP_OPERACIONAL" }),
      atributo({ chave: "c", escopo: "CAVALO" }),
      atributo({ chave: "j", escopo: "CONJUNTO" }),
    ]);
    expect(contagens.map((c) => c.escopo.code)).toEqual([
      "CAVALO",
      "CONJUNTO",
      "QLP_OPERACIONAL",
    ]);
  });

  it("escopo sem nada não aparece na contagem", () => {
    const contagens = contarPorEscopo([atributo({ chave: "c", escopo: "CAVALO" })]);
    expect(contagens.map((c) => c.escopo.code)).toEqual(["CAVALO"]);
  });
});

describe("o que foi importado, e o que só não mudou", () => {
  /*
    A diferença entre as duas frases é a informação de auditoria. "Não
    importado" manda pedir um arquivo; "importado e sem alteração" é a resposta
    de que naquela quinzena ninguém mexeu. Uma tela que não as separa faz o
    auditor cobrar do cliente um export que já está no banco.
  */
  it("as séries dizem o que chegou", () => {
    const importados = escoposImportados(view({ groups: [], series: [{ entityTypeSet: "CAVALO" }] }));
    expect(importados.has("CAVALO")).toBe(true);
    expect(importados.has("TRECHO")).toBe(false);
  });

  it("conjunto existe quando cavalo e carreta chegam — não é série própria", () => {
    const so = escoposImportados(view({ groups: [], series: [{ entityTypeSet: "CAVALO" }] }));
    expect(so.has("CONJUNTO")).toBe(false);

    const ambos = escoposImportados(
      view({ groups: [], series: [{ entityTypeSet: "CAVALO" }, { entityTypeSet: "CARRETA" }] }),
    );
    expect(ambos.has("CONJUNTO")).toBe(true);
  });

  it("a série com dois tipos no rótulo conta pelos dois", () => {
    const importados = escoposImportados(
      view({ groups: [], series: [{ entityTypeSet: "CARRETA+CAVALO" }] }),
    );
    expect(importados.has("CAVALO")).toBe(true);
    expect(importados.has("CARRETA")).toBe(true);
    expect(importados.has("CONJUNTO")).toBe(true);
  });

  it("sem vigência, nada foi importado", () => {
    expect(escoposImportados(null).size).toBe(0);
  });
});

describe("o que vem da URL", () => {
  it("escopo e ordenação adulterados caem no padrão em vez de quebrar", () => {
    expect(ehEscopo("CAVALO")).toBe(true);
    expect(ehEscopo("CONJUNTO")).toBe(true);
    expect(ehEscopo("cavalo")).toBe(false);
    expect(ehEscopo("QUALQUER")).toBe(false);
    expect(ehEscopo(null)).toBe(false);

    expect(ehOrdem("impacto")).toBe(true);
    expect(ehOrdem("nome")).toBe(true);
    expect(ehOrdem("qualquer")).toBe(false);
    expect(ehOrdem(null)).toBe(false);
  });

  it("todo escopo da barra é endereçável", () => {
    for (const escopo of ESCOPOS) expect(ehEscopo(escopo.code)).toBe(true);
  });
});
