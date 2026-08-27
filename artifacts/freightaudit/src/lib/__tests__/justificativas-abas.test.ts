import { describe, expect, it } from "vitest";

import { abasDeTipo, placasDaAba } from "../justificativas";
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

describe("abasDeTipo", () => {
  it("abre com Todas, contando todas as placas — inclusive as sem tipo", () => {
    const abas = abasDeTipo([placa("CAVALO"), placa("TRECHO"), placa(null)]);
    expect(abas[0]).toEqual({ tipo: null, rotulo: "Todas", total: 3 });
  });

  it("traz os três tipos com tela 360°, na ordem do produto", () => {
    const abas = abasDeTipo([]);
    expect(abas.slice(1).map((a) => a.tipo)).toEqual(EQUIPAMENTOS);
    expect(abas.slice(1).map((a) => a.rotulo)).toEqual(["Cavalo", "Carreta", "Trecho"]);
  });

  it("mostra a aba vazia com zero em vez de escondê-la", () => {
    // Sem isto, quem abre uma vigência só de cavalos não sabe se a base não
    // mexeu em trecho ou se a tela não sabe mostrar trecho.
    const abas = abasDeTipo([placa("CAVALO"), placa("CAVALO")]);
    expect(abas.find((a) => a.tipo === "TRECHO")).toEqual({
      tipo: "TRECHO",
      rotulo: "Trecho",
      total: 0,
    });
  });

  it("conta placas, e não alterações — é a placa que vira card", () => {
    const abas = abasDeTipo([placa("TRECHO"), placa("TRECHO"), placa("CARRETA")]);
    expect(abas.find((a) => a.tipo === "TRECHO")?.total).toBe(2);
    expect(abas.find((a) => a.tipo === "CARRETA")?.total).toBe(1);
  });

  it("normaliza o tipo como o banco o guarda, para não abrir duas abas do mesmo", () => {
    const abas = abasDeTipo([placa("cavalo"), placa(" CAVALO ")]);
    expect(abas.find((a) => a.tipo === "CAVALO")?.total).toBe(2);
    expect(abas.filter((a) => a.tipo !== null)).toHaveLength(EQUIPAMENTOS.length);
  });

  it("põe um tipo desconhecido depois dos três, em ordem alfabética", () => {
    const abas = abasDeTipo([placa("DOLLY"), placa("BITREM"), placa("CAVALO")]);
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
});

describe("placasDaAba", () => {
  const lista = [placa("CAVALO"), placa("TRECHO"), placa("trecho"), placa(null)];

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
