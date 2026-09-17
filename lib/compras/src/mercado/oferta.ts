/**
 * A OFERTA DE MERCADO — e a proveniência sem a qual ela não existe.
 *
 * A regra desta camada cabe numa linha: **não há preço sem fonte.** Toda oferta
 * carrega a URL de onde saiu, o domínio, o instante da captura e o trecho
 * verbatim da página em que o preço aparece. Uma oferta sem qualquer um desses
 * quatro não é uma oferta fraca — ela é descartada em `verificacao.ts`, antes
 * de chegar à conta.
 *
 * **Dois tipos, e a distância entre eles é o ponto.** {@link OfertaBruta} é o
 * que o extrator afirma ter lido; {@link OfertaCapturada} é o que sobreviveu à
 * conferência contra o texto que o buscador de fato trouxe. O extrator é um
 * modelo de linguagem, e a diferença entre os dois tipos é exatamente o que
 * impede a fluência dele de virar preço na tela.
 */

/** De onde a oferta veio — preenchido pelo buscador, nunca pelo extrator. */
export interface Proveniencia {
  url: string;
  titulo: string | null;
  /** O domínio, para agrupar e para julgar a qualidade da fonte. */
  fonte: string;
  /** ISO 8601. O instante em que a página foi buscada, não o da resposta. */
  capturadoEm: string;
  /**
   * A idade que a própria página declara, quando declara.
   *
   * Vem do buscador (`page_age`) e é diferente de `capturadoEm`: buscar hoje
   * uma página publicada há dois anos é captura fresca de preço velho, e as
   * duas datas juntas são a única forma de dizer isso.
   */
  idadeDaPagina: string | null;
}

/** Como o preço está escrito na oferta. */
export type UnidadeDoPreco =
  | "UNIDADE"
  | "CAIXA"
  | "PACOTE"
  | "KG"
  | "LITRO"
  | "METRO"
  | "MES"
  | "DESCONHECIDA";

export const ROTULO_DA_UNIDADE: Record<UnidadeDoPreco, string> = {
  UNIDADE: "por unidade",
  CAIXA: "por caixa",
  PACOTE: "por pacote",
  KG: "por quilo",
  LITRO: "por litro",
  METRO: "por metro",
  MES: "por mês",
  DESCONHECIDA: "unidade não declarada",
};

/**
 * O que o extrator afirma ter lido numa página.
 *
 * Todo campo é opcional menos três — preço, unidade e o trecho —, e a razão é a
 * mesma para os três: sem preço não há oferta, sem unidade não há comparação, e
 * sem trecho não há como conferir que o preço estava mesmo na página.
 */
export interface OfertaBruta {
  fornecedor: string | null;
  produto: string | null;
  marca: string | null;
  especificacao: string | null;
  preco: number;
  unidadeDoPreco: UnidadeDoPreco;
  /** Quantas unidades vêm na embalagem, quando o preço é de caixa ou pacote. */
  unidadesPorEmbalagem: number | null;
  quantidadeMinima: number | null;
  disponibilidade: string | null;
  frete: number | null;
  /** Verdadeiro quando a página declara frete incluso; nulo quando não diz nada. */
  freteIncluso: boolean | null;
  impostos: number | null;
  prazoEmDias: number | null;
  condicaoComercial: string | null;
  /**
   * O trecho **verbatim** da página em que o preço aparece.
   *
   * É a peça central da conferência: `verificacao.ts` exige que este trecho
   * exista, literalmente, no texto que o buscador trouxe daquela URL, e que o
   * preço apareça dentro dele. Um extrator que invente o preço tem de inventar
   * junto um trecho que a página não contém — e aí a oferta cai.
   */
  trecho: string;
  /** A URL de onde o extrator diz ter lido. Conferida contra o que foi buscado. */
  url: string;
}

/** Uma oferta que passou pela conferência, com proveniência carimbada. */
export interface OfertaCapturada extends Omit<OfertaBruta, "url"> {
  proveniencia: Proveniencia;
}

/** O domínio de uma URL, ou `null` quando ela não é uma URL. */
export function dominioDe(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
