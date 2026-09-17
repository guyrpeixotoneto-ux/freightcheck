/**
 * A LEITURA DO MERCADO — mediana, faixa e dispersão sobre o custo comparável.
 *
 * Três números e nenhuma opinião. Eles rodam sobre o **custo total comparável**
 * das ofertas que passaram no match (`normalizacao.ts`), nunca sobre o preço
 * anunciado, e é essa escolha que faz a mediana significar alguma coisa: uma
 * mediana de preços de embalagens diferentes é um número com cara de estatística.
 *
 * **Mediana, e não média.** A média de sete ofertas em que uma é um anúncio de
 * caminhão inteiro no meio de pneus é a média do caminhão. A mediana ignora a
 * ponta, que é exatamente o comportamento que se quer de uma pesquisa de preço
 * feita na internet aberta.
 */

/** A leitura de um conjunto de custos comparáveis. */
export interface LeituraDeMercado {
  /** Quantas ofertas entraram na conta. */
  ofertas: number;
  menor: number;
  maior: number;
  mediana: number;
  /** A média — só para medir a dispersão, nunca para recomendar. */
  media: number;
  /**
   * O coeficiente de variação: desvio padrão sobre a média.
   *
   * É a dispersão em forma comparável entre itens de preços diferentes — 15% é
   * 15% num pneu de R$ 1.400 e num parafuso de R$ 2. É ele que a confiança lê,
   * e é ele que denuncia um conjunto que mistura coisas diferentes.
   */
  dispersao: number;
}

/**
 * A leitura, ou `null` quando não há custo nenhum.
 *
 * Nulo, e não uma leitura de zeros: "mediana R$ 0,00" seria lido como mercado
 * de graça, e o que aconteceu foi não haver oferta comparável.
 */
export function lerMercado(custos: number[]): LeituraDeMercado | null {
  const validos = custos
    .filter((c) => Number.isFinite(c) && c > 0)
    .sort((a, b) => a - b);
  if (validos.length === 0) return null;

  const media = validos.reduce((a, b) => a + b, 0) / validos.length;
  const variancia =
    validos.reduce((soma, c) => soma + (c - media) ** 2, 0) / validos.length;

  return {
    ofertas: validos.length,
    menor: validos[0]!,
    maior: validos[validos.length - 1]!,
    mediana: medianaDe(validos),
    media,
    dispersao: media > 0 ? Math.sqrt(variancia) / media : 0,
  };
}

/** A mediana de uma lista já ordenada. Par devolve a média dos dois do meio. */
export function medianaDe(ordenados: number[]): number {
  const n = ordenados.length;
  if (n === 0) return 0;
  const meio = Math.floor(n / 2);
  return n % 2 === 1
    ? ordenados[meio]!
    : (ordenados[meio - 1]! + ordenados[meio]!) / 2;
}
