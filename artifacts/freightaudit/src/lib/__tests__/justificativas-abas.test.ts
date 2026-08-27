import { describe, expect, it } from "vitest";

import {
  abasDaVigencia,
  indexarContagens,
  placasDaAba,
  vigenciasDaAba,
  type Comparacao,
} from "../justificativas";
import { EQUIPAMENTOS } from "../frota";

/**
 * O Plano de Ação agrupa por placa, e a placa sozinha não diz de que tipo de
 * ativo se fala. Sem as abas, a fila chegava com cavalo, carreta e trecho
 * misturados numa lista só, e o único recorte era a etiqueta dentro de cada
 * card — que responde "de que é esta placa" e não "o que mudou nos trechos",
 * que é a pergunta de quem justifica.
 *
 * O que se guarda aqui é o que a aba promete: o nome certo do tipo, a
 * contagem em placas, a presença dos três mesmo vazios, e o recorte que a
 * escolha aplica.
 */

const placa = (entityType: string | null) => ({ entityType });

function comparacao(id: string, data: string): Comparacao {
  return {
    id,
    snapshotBLabel: `EMPURRADA_${id}`,
    snapshotBDate: data,
    alteracoes: 0,
    scopeHash: null,
  };
}

/** As contagens como `/change-sets/tipos` as devolve. */
function contagens(
  ...linhas: [
    changeSetId: string,
    entityType: string | null,
    placas: number,
    alteracoes: number,
  ][]
) {
  return indexarContagens(
    linhas.map(([changeSetId, entityType, placas, alteracoes]) => ({
      changeSetId,
      entityType,
      placas,
      alteracoes,
    })),
  );
}

describe("abasDaVigencia", () => {
  it("abre com Todas, contando todas as placas da vigência — inclusive as sem tipo", () => {
    const abas = abasDaVigencia(
      [comparacao("v1", "2026-08-02")],
      contagens(
        ["v1", "CAVALO", 1, 3],
        ["v1", "TRECHO", 1, 2],
        ["v1", null, 1, 1],
      ),
      "v1",
    );
    expect(abas[0]).toEqual({
      tipo: null,
      rotulo: "Todas",
      total: 3,
      changeSetId: "v1",
    });
  });

  it("traz os três tipos com tela 360°, na ordem do produto", () => {
    const abas = abasDaVigencia([], contagens(), undefined);
    expect(abas.slice(1).map((a) => a.tipo)).toEqual(EQUIPAMENTOS);
    expect(abas.slice(1).map((a) => a.rotulo)).toEqual([
      "Cavalo",
      "Carreta",
      "Trecho",
    ]);
  });

  it("mostra a aba vazia com zero em vez de escondê-la", () => {
    // Sem isto, quem abre uma vigência só de cavalos não sabe se a base não
    // mexeu em trecho ou se a tela não sabe mostrar trecho.
    const abas = abasDaVigencia(
      [comparacao("v1", "2026-08-02")],
      contagens(["v1", "CAVALO", 2, 5]),
      "v1",
    );
    expect(abas.find((a) => a.tipo === "TRECHO")).toEqual({
      tipo: "TRECHO",
      rotulo: "Trecho",
      total: 0,
      changeSetId: undefined,
    });
  });

  it("conta placas, e não alterações — é a placa que vira card", () => {
    const abas = abasDaVigencia(
      [comparacao("v1", "2026-08-02")],
      contagens(["v1", "TRECHO", 2, 16], ["v1", "CARRETA", 1, 4]),
      "v1",
    );
    expect(abas.find((a) => a.tipo === "TRECHO")?.total).toBe(2);
    expect(abas.find((a) => a.tipo === "CARRETA")?.total).toBe(1);
  });

  it("normaliza o tipo como o banco o guarda, para não abrir duas abas do mesmo", () => {
    const abas = abasDaVigencia(
      [comparacao("v1", "2026-08-02")],
      contagens(["v1", "cavalo", 1, 1], ["v1", " CAVALO ", 1, 1]),
      "v1",
    );
    expect(abas.find((a) => a.tipo === "CAVALO")?.total).toBe(2);
    expect(abas.filter((a) => a.tipo !== null)).toHaveLength(
      EQUIPAMENTOS.length,
    );
  });

  it("põe um tipo desconhecido depois dos três, em ordem alfabética", () => {
    const abas = abasDaVigencia(
      [comparacao("v1", "2026-08-02")],
      contagens(
        ["v1", "DOLLY", 1, 1],
        ["v1", "BITREM", 1, 1],
        ["v1", "CAVALO", 1, 1],
      ),
      "v1",
    );
    expect(abas.map((a) => a.tipo)).toEqual([
      null,
      "CAVALO",
      "CARRETA",
      "TRECHO",
      "BITREM",
      "DOLLY",
    ]);
    // Sem tela e sem importação, o nome volta como veio — "Ativo" sumiria ao
    // lado de Cavalo e Carreta, e inventar capitalização erraria a sigla.
    expect(abas.find((a) => a.tipo === "DOLLY")?.rotulo).toBe("DOLLY");
  });

  /*
    O ponto da vigência por aba: a série de uma comparação é (escopo,
    entity_type_set), então trecho e equipamento da mesma unidade na mesma data
    são duas comparações diferentes. A aba tem de abrir a que tem o tipo dela.
  */
  it("mantém a vigência escolhida na aba que também a tem", () => {
    const abas = abasDaVigencia(
      [comparacao("equip", "2026-08-02"), comparacao("trecho", "2026-08-02")],
      contagens(["equip", "CAVALO", 4, 9], ["trecho", "TRECHO", 36, 120]),
      "equip",
    );
    expect(abas.find((a) => a.tipo === "CAVALO")?.changeSetId).toBe("equip");
  });

  it("leva a aba para a vigência mais recente que tem o tipo dela", () => {
    const abas = abasDaVigencia(
      [comparacao("equip", "2026-08-02"), comparacao("trecho", "2026-08-02")],
      contagens(["equip", "CAVALO", 4, 9], ["trecho", "TRECHO", 36, 120]),
      "equip",
    );
    // Estando numa comparação de equipamento, a aba Trecho não abre sobre ela:
    // ela tem a mesma data e o mesmo nome de unidade, e nenhum trecho.
    expect(abas.find((a) => a.tipo === "TRECHO")?.changeSetId).toBe("trecho");
    expect(abas.find((a) => a.tipo === "TRECHO")?.total).toBe(36);
  });

  it("prefere a mais recente quando várias vigências têm o tipo", () => {
    const abas = abasDaVigencia(
      // Como `/change-sets` devolve: da mais recente para a mais antiga.
      [comparacao("nova", "2026-08-02"), comparacao("velha", "2026-07-01")],
      contagens(["nova", "TRECHO", 3, 5], ["velha", "TRECHO", 9, 20]),
      undefined,
    );
    expect(abas.find((a) => a.tipo === "TRECHO")?.changeSetId).toBe("nova");
  });

  it("não afirma total nenhum enquanto as contagens não chegaram", () => {
    // Um zero durante o carregamento seria uma afirmação que ainda não se pode
    // fazer — a aba diria "nenhum trecho mudou" antes de saber.
    const abas = abasDaVigencia([comparacao("v1", "2026-08-02")], null, "v1");
    expect(abas.every((a) => a.total === null)).toBe(true);
    expect(abas.every((a) => a.changeSetId === "v1")).toBe(true);
  });
});

describe("vigenciasDaAba", () => {
  const lista = [
    comparacao("equip", "2026-08-02"),
    comparacao("trecho", "2026-08-02"),
  ];
  const contadas = contagens(
    ["equip", "CAVALO", 4, 9],
    ["equip", "CARRETA", 2, 3],
    ["trecho", "TRECHO", 36, 120],
  );

  it("oferece só as vigências que têm o tipo da aba", () => {
    expect(
      vigenciasDaAba(lista, [], contadas, "TRECHO").map((o) => o.id),
    ).toEqual(["trecho"]);
    expect(
      vigenciasDaAba(lista, [], contadas, "CAVALO").map((o) => o.id),
    ).toEqual(["equip"]);
  });

  it("conta as alterações do tipo, e não as da comparação inteira", () => {
    expect(vigenciasDaAba(lista, [], contadas, "CAVALO")[0].alteracoes).toBe(9);
    // Todas soma os tipos da comparação.
    expect(
      vigenciasDaAba(lista, [], contadas, null).find((o) => o.id === "equip")
        ?.alteracoes,
    ).toBe(12);
  });

  it("lista tudo enquanto as contagens não chegaram", () => {
    // Esconder vigência antes de saber esvaziaria o seletor no meio do
    // carregamento, e quem estava escolhendo perderia a linha que mirava.
    expect(vigenciasDaAba(lista, [], null, "TRECHO")).toHaveLength(2);
  });
});

describe("placasDaAba", () => {
  const lista = [
    placa("CAVALO"),
    placa("TRECHO"),
    placa("trecho"),
    placa(null),
  ];

  it("não recorta nada na aba Todas", () => {
    expect(placasDaAba(lista, null)).toHaveLength(4);
  });

  it("recorta pelo tipo, com a mesma normalização das abas", () => {
    // O `?tipo=` do endereço é escrito à mão tanto quanto clicado.
    expect(placasDaAba(lista, "trecho")).toHaveLength(2);
    expect(placasDaAba(lista, "TRECHO")).toHaveLength(2);
  });

  it("deixa a placa sem tipo fora de toda aba de tipo", () => {
    expect(placasDaAba(lista, "CAVALO")).toHaveLength(1);
  });
});
