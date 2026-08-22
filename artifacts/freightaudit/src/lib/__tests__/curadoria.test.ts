import { describe, expect, it } from "vitest";
import {
  abasDeEquipamento,
  enderecoDaAba,
  equipamentoDoAtributo,
  EQUIPAMENTOS_DA_CURADORIA,
  estaDescrito,
  filtrarPorEquipamento,
  normalizarEquipamento,
} from "../curadoria";
import { rotuloDoTipo } from "../frota";
import { TIPOS_DE_IMPORTACAO } from "@workspace/ingest/tipos";

/**
 * O verde da fila de curadoria promete uma coisa só: **os três campos do card
 * "Significado" estão escritos.**
 *
 * O que se guarda aqui é o "os três". Cair para dois — porque a fórmula de
 * cálculo chega `null` em atributo sem semântica versionada, que é a maioria da
 * fila — acenderia verde em coluna que ninguém terminou de descrever, e a fila
 * passaria a mentir sobre o próprio progresso justamente onde ela é usada para
 * decidir o que fazer em seguida.
 */

const descrito = {
  displayName: "Consumo de Combustível",
  definition: "Eficiência considerada para o cavalo, em km/L.",
  calculationBasis: "Litros = Quilometragem ÷ Consumo (km/L)",
};

describe("estaDescrito", () => {
  it("acende com os três campos escritos", () => {
    expect(estaDescrito(descrito)).toBe(true);
  });

  it.each(["displayName", "definition", "calculationBasis"] as const)(
    "não acende sem %s",
    (campo) => {
      expect(estaDescrito({ ...descrito, [campo]: null })).toBe(false);
      expect(estaDescrito({ ...descrito, [campo]: "" })).toBe(false);
    },
  );

  it("não conta espaço em branco como texto escrito", () => {
    expect(estaDescrito({ ...descrito, definition: "   \n " })).toBe(false);
  });

  it("não acende no atributo intocado, que é o estado inicial da fila", () => {
    expect(
      estaDescrito({
        displayName: null,
        definition: null,
        calculationBasis: null,
      }),
    ).toBe(false);
  });
});

/**
 * As abas por equipamento prometem duas coisas, e são as duas que se guardam
 * aqui: **estão sempre lá** — inclusive a de um equipamento que esta base não
 * tem — e **o número diz quantos cards o clique abre**.
 *
 * A primeira é o que faz a curadoria responder "não há coluna de trecho nesta
 * base" em vez de não ter onde procurar. A segunda é o que impede a aba de
 * mentir: contada sobre a fila inteira, `Carreta 41` abriria três resultados
 * enquanto o filtro de texto estivesse valendo.
 */
const fila = [
  { entityType: "CAVALO", code: "cavalo.ipva" },
  { entityType: "CAVALO", code: "cavalo.valor_pis_cofins" },
  { entityType: "CARRETA", code: "carreta.finame" },
];

describe("abasDeEquipamento", () => {
  it("abre com Todos e uma aba por tipo importável, nessa ordem", () => {
    expect(abasDeEquipamento(fila).map((a) => a.rotulo)).toEqual([
      "Todos",
      "Cavalo",
      "Carreta",
      "Trecho",
      "QLP Administrativo",
      "QLP Operacional",
    ]);
  });

  /*
    O quadro de pessoal entra por importação e não tem tela 360°: preso à lista
    das telas, ele aparecia como aba extra — só depois de a primeira planilha
    dele entrar, e com o nome do banco, em caixa alta, ao lado de `Cavalo`.
  */
  it("escreve o QLP pelo nome, e não pelo código do banco", () => {
    const abas = abasDeEquipamento([
      ...fila,
      { entityType: "QLP_ADMINISTRATIVO", code: "qlp.ordenados" },
    ]);
    expect(abas.find((a) => a.tipo === "QLP_ADMINISTRATIVO")).toEqual({
      tipo: "QLP_ADMINISTRATIVO",
      rotulo: "QLP Administrativo",
      total: 1,
    });
  });

  it("conta quantos itens da fila caem em cada aba", () => {
    const porRotulo = new Map(
      abasDeEquipamento(fila).map((a) => [a.rotulo, a.total]),
    );
    expect(porRotulo.get("Todos")).toBe(3);
    expect(porRotulo.get("Cavalo")).toBe(2);
    expect(porRotulo.get("Carreta")).toBe(1);
  });

  it("mantém a aba do equipamento que esta base não tem, zerada", () => {
    expect(abasDeEquipamento(fila).find((a) => a.tipo === "TRECHO")).toEqual({
      tipo: "TRECHO",
      rotulo: "Trecho",
      total: 0,
    });
  });

  it("mantém zerada também a do QLP que ainda não foi importado", () => {
    expect(
      abasDeEquipamento(fila).find((a) => a.tipo === "QLP_OPERACIONAL"),
    ).toEqual({
      tipo: "QLP_OPERACIONAL",
      rotulo: "QLP Operacional",
      total: 0,
    });
  });

  it("acrescenta um tipo de fora da lista depois das fixas, sem perdê-lo", () => {
    const abas = abasDeEquipamento([...fila, { entityType: "REBOQUE" }]);
    expect(abas.map((a) => a.tipo)).toEqual([
      null,
      "CAVALO",
      "CARRETA",
      "TRECHO",
      "QLP_ADMINISTRATIVO",
      "QLP_OPERACIONAL",
      "REBOQUE",
    ]);
    expect(abas.at(-1)?.total).toBe(1);
  });

  it("continua com as abas fixas na fila vazia — é onde elas mais importam", () => {
    expect(abasDeEquipamento([]).map((a) => a.tipo)).toEqual([
      null,
      "CAVALO",
      "CARRETA",
      "TRECHO",
      "QLP_ADMINISTRATIVO",
      "QLP_OPERACIONAL",
    ]);
  });
});

describe("filtrarPorEquipamento", () => {
  it("recorta a fila pelo tipo", () => {
    expect(filtrarPorEquipamento(fila, "CAVALO").map((i) => i.code)).toEqual([
      "cavalo.ipva",
      "cavalo.valor_pis_cofins",
    ]);
  });

  it("em Todos (null) devolve a fila inteira", () => {
    expect(filtrarPorEquipamento(fila, null)).toHaveLength(3);
  });

  it("devolve fila vazia no equipamento sem coluna nenhuma", () => {
    expect(filtrarPorEquipamento(fila, "TRECHO")).toEqual([]);
  });
});

/**
 * O clique na aba, que era o defeito visível: com um atributo de cavalo aberto,
 * Carreta, Trecho e QLP **não selecionavam**. A aba escrevia o tipo no
 * endereço, um efeito lia o desencontro entre a aba e o atributo aberto e
 * reescrevia a aba do atributo antes da repintura — sem erro nenhum na tela, e
 * com a aba do equipamento já aberto sendo a única que parecia funcionar.
 *
 * O que se guarda aqui é a inversão: **o clique manda**, e a contradição se
 * desfaz fechando o atributo que não é da aba, nunca desfazendo o clique.
 */
describe("enderecoDaAba", () => {
  const comCodigo = [
    { entityType: "CAVALO", code: "cavalo.ipva" },
    { entityType: "CARRETA", code: "carreta.finame" },
    { entityType: "QLP_ADMINISTRATIVO", code: "qlp.ordenados" },
  ];

  it("troca de aba mesmo com um atributo de outro equipamento aberto", () => {
    expect(enderecoDaAba(comCodigo, "CARRETA", "cavalo.ipva")).toEqual({
      equipamento: "CARRETA",
      atributo: null,
    });
    expect(enderecoDaAba(comCodigo, "QLP_ADMINISTRATIVO", "cavalo.ipva")).toEqual({
      equipamento: "QLP_ADMINISTRATIVO",
      atributo: null,
    });
  });

  it("mantém aberto o atributo que é da aba escolhida", () => {
    expect(enderecoDaAba(comCodigo, "CARRETA", "carreta.finame")).toEqual({
      equipamento: "CARRETA",
      atributo: "carreta.finame",
    });
  });

  it("não fecha nada ao voltar para Todos", () => {
    expect(enderecoDaAba(comCodigo, null, "cavalo.ipva")).toEqual({
      equipamento: null,
      atributo: "cavalo.ipva",
    });
  });

  /*
    A fila em "Pendentes" não traz os confirmados: fechar o painel de um
    atributo que ela não tem apagaria exatamente o que o link pediu.
  */
  it("deixa onde está o atributo que a fila ainda não tem", () => {
    expect(enderecoDaAba(comCodigo, "TRECHO", "cavalo.ja_confirmado")).toEqual({
      equipamento: "TRECHO",
      atributo: "cavalo.ja_confirmado",
    });
    expect(enderecoDaAba([], "CARRETA", "cavalo.ipva")).toEqual({
      equipamento: "CARRETA",
      atributo: "cavalo.ipva",
    });
  });

  it("sem atributo aberto, só troca a aba", () => {
    expect(enderecoDaAba(comCodigo, "TRECHO", null)).toEqual({
      equipamento: "TRECHO",
      atributo: null,
    });
  });
});

describe("equipamentoDoAtributo", () => {
  const comCodigo = [{ entityType: "cavalo ", code: "cavalo.ipva" }];

  it("responde o tipo normalizado do atributo da fila", () => {
    expect(equipamentoDoAtributo(comCodigo, "cavalo.ipva")).toBe("CAVALO");
  });

  /*
    `undefined` é ausência de resposta, e não "sem equipamento": é por
    confundir os dois que a aba trocava sozinha enquanto a fila carregava.
  */
  it("distingue a fila que não tem o atributo de um atributo sem tipo", () => {
    expect(equipamentoDoAtributo(comCodigo, "carreta.finame")).toBeUndefined();
    expect(
      equipamentoDoAtributo([{ entityType: "  ", code: "x" }], "x"),
    ).toBeNull();
  });
});

describe("normalizarEquipamento", () => {
  it("aceita o link escrito à mão em minúsculas", () => {
    expect(normalizarEquipamento("carreta")).toBe("CARRETA");
    expect(filtrarPorEquipamento(fila, normalizarEquipamento(" cavalo "))).toHaveLength(2);
  });

  it("trata endereço truncado como Todos, e não como equipamento inexistente", () => {
    expect(normalizarEquipamento("")).toBeNull();
    expect(normalizarEquipamento("   ")).toBeNull();
    expect(normalizarEquipamento(null)).toBeNull();
  });
});

describe("o rótulo do tipo", () => {
  it("escreve os três conhecidos como o produto fala deles", () => {
    expect(rotuloDoTipo("CAVALO")).toBe("Cavalo");
    expect(rotuloDoTipo("CARRETA")).toBe("Carreta");
    expect(rotuloDoTipo("TRECHO")).toBe("Trecho");
  });

  it("não inventa capitalização para o tipo que não conhece", () => {
    expect(rotuloDoTipo("FROTA_PROPRIA")).toBe("FROTA_PROPRIA");
  });

  /*
    A curadoria mantinha a sua própria lista de tipos, e o dia em que ela
    discordou da autoridade foi o dia do QLP: o quadro de pessoal entra por
    importação e não tem tela 360°, e a lista das telas — que era de onde as
    abas saíam — não o nomeava.

    Este caso não confere que as duas listas combinam: confere que a daqui
    **é derivada** da lista do que se importa. Uma cópia escrita à mão continua
    passando enquanto as duas concordarem, e é por isso que a asserção compara
    contra `TIPOS_DE_IMPORTACAO` em vez de contra cinco strings literais.
  */
  it("sai da lista do que o produto importa, e não de uma cópia", () => {
    expect(EQUIPAMENTOS_DA_CURADORIA).toEqual(
      TIPOS_DE_IMPORTACAO.map((tipo) => tipo.code),
    );
  });
});
