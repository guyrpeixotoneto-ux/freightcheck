/**
 * O total de uma coluna **no recorte que está na tela**.
 *
 * A rota já manda o total de cada produto na frota inteira, e ele continua
 * valendo enquanto ninguém filtra. No instante em que a pessoa escolhe "só
 * carretas" ou digita três letras da placa, aquele número passa a ser um valor
 * certo debaixo de uma lista que não o produz — que é a pior mentira que uma
 * tabela pode contar. Por isso o rodapé e o cartão da visão por produto somam o
 * recorte, e dizem que é do recorte.
 *
 * É a única duplicação de regra entre esta tela e `lib/compras/src/matriz.ts`, e
 * ela é da **regra**, não do cálculo: as duas recusas viajam junto da soma
 * porque sem elas a soma não é legítima.
 *
 * - **Gavetas não se somam.** Mensal com anual, ou anual com valor de
 *   aquisição, não têm soma que signifique algo — e um número embaixo da
 *   palavra "total" vira orçamento na reunião seguinte.
 * - **Coluna sem valor não vira zero.** `R$ 0,00` se lê como "a Ambev não paga
 *   nada por isto"; a ausência de valor se lê como o que é.
 */

import type { CelulaDaMatriz, ColunaDaMatriz, LinhaDaMatriz } from "./tipos";

export function totalizarColuna(
  coluna: ColunaDaMatriz,
  linhas: LinhaDaMatriz[],
  indice: number,
): ColunaDaMatriz {
  const celulas: CelulaDaMatriz[] = linhas
    .map((l) => l.celulas[indice]!)
    .filter((c) => c.valor !== null);

  if (celulas.length === 0) {
    return { ...coluna, gaveta: null, veiculosComValor: 0, total: null, semTotal: "SEM_VALOR" };
  }

  const gavetas = new Set(celulas.map((c) => c.gaveta));
  if (gavetas.size > 1) {
    return {
      ...coluna,
      gaveta: null,
      veiculosComValor: celulas.length,
      total: null,
      semTotal: "GAVETAS_DIFERENTES",
    };
  }

  return {
    ...coluna,
    gaveta: celulas[0]!.gaveta,
    veiculosComValor: celulas.length,
    total: Number(celulas.reduce((s, c) => s + (c.valor ?? 0), 0).toFixed(2)),
    semTotal: null,
  };
}
