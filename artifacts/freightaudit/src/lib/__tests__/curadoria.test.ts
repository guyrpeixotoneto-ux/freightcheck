import { describe, expect, it } from "vitest";
import {
  abasDeEquipamento,
  estaDescrito,
  filtrarPorEquipamento,
  normalizarEquipamento,
  rotuloDoEquipamento,
} from "../curadoria";

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
  it("abre com Todos e as três abas fixas, nessa ordem", () => {
    expect(abasDeEquipamento(fila).map((a) => a.rotulo)).toEqual([
      "Todos",
      "Cavalo",
      "Carreta",
      "Trecho",
    ]);
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

  it("acrescenta um quarto tipo importado depois das fixas, sem perdê-lo", () => {
    const abas = abasDeEquipamento([...fila, { entityType: "REBOQUE" }]);
    expect(abas.map((a) => a.tipo)).toEqual([
      null,
      "CAVALO",
      "CARRETA",
      "TRECHO",
      "REBOQUE",
    ]);
    expect(abas.at(-1)?.total).toBe(1);
  });

  it("continua com as três abas na fila vazia — é onde elas mais importam", () => {
    expect(abasDeEquipamento([]).map((a) => a.tipo)).toEqual([
      null,
      "CAVALO",
      "CARRETA",
      "TRECHO",
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

describe("rotuloDoEquipamento", () => {
  it("escreve os três conhecidos como o produto fala deles", () => {
    expect(rotuloDoEquipamento("CAVALO")).toBe("Cavalo");
    expect(rotuloDoEquipamento("CARRETA")).toBe("Carreta");
    expect(rotuloDoEquipamento("TRECHO")).toBe("Trecho");
  });

  it("não inventa capitalização para o tipo que não conhece", () => {
    expect(rotuloDoEquipamento("FROTA_PROPRIA")).toBe("FROTA_PROPRIA");
  });
});
