/**
 * Material sintético para os testes de cálculo.
 *
 * Montado à mão de propósito: os testes de aritmética, periodicidade, escopo e
 * ausência têm de falhar por causa do motor, e não por causa de uma vigência que
 * mudou de conteúdo. A bateria contra o export real vive em `dre-real.test.ts`,
 * e é ela que responde "isto funciona sobre o dado da Ambev?".
 */

import type { AttributeClassification } from "@workspace/comparison";
import type { ValorAprovado } from "@workspace/composition";
import type { LadoDaApuracao } from "../motor";

export function classificacao(
  code: string,
  over: Partial<AttributeClassification> = {},
): AttributeClassification {
  return {
    attributeId: `attr-${code}`,
    attributeCode: code,
    attributeName: code,
    attributeDisplayName: null,
    entityType: code.split(".")[0].toUpperCase(),
    dataType: "NUMERIC",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    semanticsStatus: "CONFIRMED",
    semanticsVersion: 1,
    calculationBasis: null,
    costClass: "FIXO",
    taxonomyPath: "remuneracao/custo_fixo/cf_outros",
    taxonomyName: "Outros custos fixos",
    economicDirection: null,
    economicEffect: null,
    ...over,
  };
}

export function aprovado(
  code: string,
  valor: number,
  over: Partial<AttributeClassification> = {},
): ValorAprovado {
  return {
    code,
    titulo: code,
    valor,
    classificacao: classificacao(code, over),
    fato: {
      attribute_id: `attr-${code}`,
      code,
      source_name: code,
      display_name: null,
      data_type: "NUMERIC",
      value_numeric: String(valor),
      value_text: null,
      value_boolean: null,
      value_date: null,
      is_null: false,
      null_reason: null,
      source_label: "TESTE_1_1_2026",
      sheet_name: "cavalos",
      row_index: 7,
      column_letter: "AB",
      column_header: code,
      raw_value: String(valor),
    },
    excluidoPor: null,
  };
}

/** Um lado pronto, a partir de pares `code → valor`. */
export function lado(
  entityType: "CAVALO" | "CARRETA",
  placa: string,
  valores: Record<string, number>,
  classificacoes: Record<string, Partial<AttributeClassification>> = {},
): LadoDaApuracao {
  const aprovados = new Map<string, ValorAprovado>();
  for (const [code, valor] of Object.entries(valores)) {
    aprovados.set(code, aprovado(code, valor, classificacoes[code] ?? {}));
  }
  return { entityId: `ent-${placa}`, entityType, placa, aprovados };
}

/**
 * Um conjunto realista, com os números medidos numa placa real de ago/2026.
 *
 * Não é o dado da Ambev — é uma cópia das ordens de grandeza dele, para que uma
 * falha de sinal ou de escala apareça como um número absurdo e não como um
 * número plausivelmente errado.
 */
export function conjuntoDeReferencia() {
  return {
    cavalo: lado("CAVALO", "ABC1D23", {
      "cavalo.finame_cavalo": 14000,
      "cavalo.amortizacao_cavalo": 9000,
      "cavalo.juros_finame_cavalo": 4900,
      "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": 100,
      "cavalo.ipva_licenciamento": 12000,
    }, {
      "cavalo.ipva_licenciamento": { periodicity: "ANUAL" },
    }),
    carreta: lado("CARRETA", "XYZ9W87", {
      "carreta.custo_fixo": 17000,
      "carreta.finame_implemento": 2500,
      "carreta.amortizacao_implemento": 1800,
      "carreta.juros_finame_implemento": 600,
      "carreta.custo_aluguel": 100,
      /*
        A coluna do conjunto e a parcela própria da carreta, nas proporções
        medidas: lucroFixomodeloNovoCiclo = parcela da carreta + parcela do
        cavalo (284 de 284 pares). Aqui 500 = 400 + 100, com os 100 do cavalo
        acima. É essa diferença que faz a receita do conjunto exceder a soma dos
        dois lados — o mesmo R$ 34.793,84 do export real, em miniatura.
      */
      "carreta.lucro_fixomodelo_novo_ciclo": 500,
      "carreta.lucro_fixomodelo_novo_ciclo_carreta": 400,
    }),
  };
}
