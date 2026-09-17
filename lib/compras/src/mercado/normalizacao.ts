/**
 * O CUSTO TOTAL COMPARÁVEL — porque preço anunciado não se compara.
 *
 * Três ofertas de pneu: R$ 1.450 a unidade, R$ 8.400 a caixa com seis, e
 * R$ 1.380 a unidade com frete de R$ 40 e pedido mínimo de 100. A mais barata
 * não é nenhuma das que parecem, e descobrir qual é exige desfazer três
 * diferenças que o anúncio não desfaz: a **embalagem**, o **frete** e o
 * **pedido mínimo**.
 *
 * Este arquivo faz essa conta, e faz uma só: de preço anunciado para **custo
 * por unidade comparável**. Toda a decisão do agente — mediana, faixa,
 * preço-alvo, economia, margem — roda sobre este número, nunca sobre o
 * anunciado.
 *
 * **O que falta não vira zero.** Frete desconhecido não é frete grátis, e essa
 * confusão inverteria o ranking na primeira comparação entre um marketplace que
 * declara frete e um distribuidor que não declara. Quando o frete não é
 * conhecido, o custo comparável sai **sem ele**, marcado como incompleto — e a
 * confiança cai (`confianca.ts`). Ver {@link CustoComparavel.completo}.
 */

import type { OfertaCapturada, UnidadeDoPreco } from "./oferta";

/** Quantas unidades de compra cabem em uma unidade de preço. */
export function unidadesPorPreco(oferta: OfertaCapturada): number | null {
  switch (oferta.unidadeDoPreco) {
    case "UNIDADE":
    case "MES":
    case "METRO":
    case "KG":
    case "LITRO":
      /*
        Quilo, litro e metro são a própria unidade de compra quando é assim que
        o item é comprado — a especificação é que diz. O que este módulo não faz
        é converter litro em unidade: sem saber quantos litros tem a peça, a
        conversão seria invenção, e ela apareceria como um preço unitário
        plausível e errado.
      */
      return 1;
    case "CAIXA":
    case "PACOTE":
      return oferta.unidadesPorEmbalagem !== null &&
        oferta.unidadesPorEmbalagem > 0
        ? oferta.unidadesPorEmbalagem
        : null;
    case "DESCONHECIDA":
      return null;
  }
}

export type MotivoSemCusto =
  /** Preço por caixa ou pacote sem dizer quantas unidades vêm dentro. */
  | "EMBALAGEM_DESCONHECIDA"
  /** A unidade do preço não foi declarada pela página. */
  | "UNIDADE_DESCONHECIDA";

export const ROTULO_SEM_CUSTO: Record<MotivoSemCusto, string> = {
  EMBALAGEM_DESCONHECIDA:
    "Preço por embalagem, sem dizer quantas unidades ela traz",
  UNIDADE_DESCONHECIDA: "A página não declara a unidade do preço",
};

/** O custo de uma oferta, levado à unidade de compra. */
export interface CustoComparavel {
  /** O preço anunciado, como a página o traz. */
  precoAnunciado: number;
  unidadeDoPreco: UnidadeDoPreco;
  /** O anunciado dividido pela embalagem. Nulo quando ela é desconhecida. */
  precoPorUnidade: number | null;
  /** O frete rateado pela quantidade do pedido. Nulo quando não se conhece. */
  fretePorUnidade: number | null;
  /** O imposto rateado, quando a página o declara à parte. */
  impostoPorUnidade: number | null;
  /** Preço + frete + imposto, por unidade. É o número que se compara. */
  custoTotal: number | null;
  /** Falso quando o frete não é conhecido: o custo existe e está incompleto. */
  completo: boolean;
  /** Por que não há custo, quando não há. */
  semCusto: MotivoSemCusto | null;
  /** Verdadeiro quando o pedido não alcança o mínimo do fornecedor. */
  abaixoDoMinimo: boolean;
  /** A conta, escrita, para a resposta poder mostrá-la. */
  conta: string;
}

/**
 * O custo comparável de uma oferta, dada a quantidade que se pretende comprar.
 *
 * `quantidade` entra por dois motivos, e os dois são do mundo real: o frete é
 * **do pedido** e se dilui, e o pedido mínimo é uma condição que invalida a
 * oferta para quem compra menos. Sem quantidade, o frete não é rateado — ele
 * fica de fora e a oferta sai incompleta, que é a verdade.
 */
export function custoComparavel(
  oferta: OfertaCapturada,
  quantidade: number | null,
): CustoComparavel {
  const unidades = unidadesPorPreco(oferta);
  const base = {
    precoAnunciado: oferta.preco,
    unidadeDoPreco: oferta.unidadeDoPreco,
    abaixoDoMinimo:
      oferta.quantidadeMinima !== null &&
      quantidade !== null &&
      quantidade < oferta.quantidadeMinima,
  };

  if (unidades === null) {
    const semCusto: MotivoSemCusto =
      oferta.unidadeDoPreco === "DESCONHECIDA"
        ? "UNIDADE_DESCONHECIDA"
        : "EMBALAGEM_DESCONHECIDA";
    return {
      ...base,
      precoPorUnidade: null,
      fretePorUnidade: null,
      impostoPorUnidade: null,
      custoTotal: null,
      completo: false,
      semCusto,
      conta: ROTULO_SEM_CUSTO[semCusto],
    };
  }

  const precoPorUnidade = oferta.preco / unidades;

  /*
    Frete incluso é zero **declarado**; frete ausente é desconhecido. A página
    que diz "frete grátis" resolveu a parcela, e a que não fala nada não
    resolveu nada — tratar as duas igual daria vantagem, no ranking, a quem
    simplesmente omite.
  */
  const fretePorUnidade =
    oferta.freteIncluso === true
      ? 0
      : oferta.frete !== null && quantidade !== null && quantidade > 0
        ? oferta.frete / quantidade
        : oferta.frete !== null && quantidade === null
          ? null
          : null;

  const impostoPorUnidade =
    oferta.impostos !== null && quantidade !== null && quantidade > 0
      ? oferta.impostos / quantidade
      : oferta.impostos !== null
        ? null
        : 0;

  const completo = fretePorUnidade !== null;
  const custoTotal =
    precoPorUnidade + (fretePorUnidade ?? 0) + (impostoPorUnidade ?? 0);

  const partes = [`${precoPorUnidade.toFixed(2)} por unidade`];
  if (unidades > 1) partes[0] = `${oferta.preco.toFixed(2)} ÷ ${unidades} un`;
  if (fretePorUnidade !== null && fretePorUnidade > 0) {
    partes.push(`+ ${fretePorUnidade.toFixed(2)} de frete rateado`);
  }
  if (fretePorUnidade === null)
    partes.push("(frete desconhecido, fora da conta)");
  if (impostoPorUnidade !== null && impostoPorUnidade > 0) {
    partes.push(`+ ${impostoPorUnidade.toFixed(2)} de imposto rateado`);
  }

  return {
    ...base,
    precoPorUnidade,
    fretePorUnidade,
    impostoPorUnidade,
    custoTotal,
    completo,
    semCusto: null,
    conta: partes.join(" "),
  };
}
