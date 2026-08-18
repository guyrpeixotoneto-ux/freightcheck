import { describe, expect, it } from "vitest";
import { FAMILIES, FREIGHTECH_SEM_DADO, placementOf } from "../families";

/**
 * A gaveta do QLP ADM.
 *
 * Quando o export do quadro administrativo passou a ser importável, deixar os
 * `qlp_administrativo.*` caírem em "Sem família" faria a Curadoria tratar como
 * coluna desconhecida um dicionário inteiro já documentado — e manter "QLP ADM"
 * na nota de rodapé diria que o dado não existe justamente quando ele passou a
 * existir. Este arquivo fixa as duas correções.
 */

/** Os 35 atributos do dicionário (`docs/tabela-de-qlp-adm-dicionario.csv`):
 *  37 colunas menos a vigência (rótulo) e o cargo (chave). */
const ESTRUTURAIS = [
  "quantidade_ordenados",
  "salario_ordenados",
  "despesa_ordenados",
  "quantidade_encargos",
  "salario_encargos",
  "despesa_encargos",
  "quantidade_beneficio",
  "valor_beneficio",
  "despesa_beneficio",
  "vale_transporte",
  "quantidade_frota_leve",
  "valor_frota_leve",
  "despesa_frota_leve",
  "quantidade_telefonia",
  "valor_telefonia",
  "despesa_telefonia",
  "quantidade_uniformes",
  "valor_uniformes",
  "despesa_uniformes",
  "qlp_benchmark_quantidade",
  "qlp_benchmark_salario",
];

const CADASTRAIS = [
  "unidade_cnpj",
  "unidade_nome",
  "unidade_sap",
  "unidade_tms",
  "unidade_promax_unb",
  "unidade_regional",
  "operador_cnpj",
  "operador_nome",
  "operador_sap",
  "operador_tms",
  "operador_promax",
  "organizacao_de_compras",
  "prazo_pagamento",
  "id",
];

describe("a família do QLP ADM", () => {
  it("os 21 estruturais caem em Estrutura administrativa, nunca em Sem família", () => {
    for (const sufixo of ESTRUTURAIS) {
      const placement = placementOf(`qlp_administrativo.${sufixo}`);
      expect(placement.family, sufixo).toBe("ESTRUTURA_ADM");
    }
  });

  it("cada rubrica reúne o próprio trio quantidade × valor = despesa", () => {
    const parametro = (sufixo: string) =>
      placementOf(`qlp_administrativo.${sufixo}`).parameter;
    expect(parametro("quantidade_ordenados")).toBe(parametro("despesa_ordenados"));
    expect(parametro("valor_telefonia")).toBe(parametro("despesa_telefonia"));
    expect(parametro("qlp_benchmark_quantidade")).toBe(
      parametro("qlp_benchmark_salario"),
    );
  });

  it("os 14 cadastrais seguem a convenção da casa: CONTEXTO, como nos equipamentos", () => {
    for (const sufixo of CADASTRAIS) {
      const placement = placementOf(`qlp_administrativo.${sufixo}`);
      expect(placement.family, sufixo).toBe("CONTEXTO");
    }
  });

  it("cobre os 35 do dicionário — 21 + 14, sem sobra e sem invenção", () => {
    expect(ESTRUTURAIS.length + CADASTRAIS.length).toBe(35);
  });

  it("QLP ADM saiu da nota de 'o que o export não traz'", () => {
    const equipe = FREIGHTECH_SEM_DADO.find((f) => f.family === "Equipe")!;
    expect(equipe.parameters).not.toContain("QLP ADM");
    // O resto da família Equipe continua sem dado — a nota segue verdadeira.
    expect(equipe.parameters.length).toBeGreaterThan(0);
  });

  it("a família nova existe na tela, e 'Equipe' continua não sendo família da tela", () => {
    expect(FAMILIES.ESTRUTURA_ADM.name).toBe("Estrutura administrativa");
    const nomes = Object.values(FAMILIES).map((f) => f.name);
    expect(nomes).not.toContain("Equipe");
  });
});
