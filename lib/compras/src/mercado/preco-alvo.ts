/**
 * O PREÇO-ALVO DE NEGOCIAÇÃO — derivado de evidência, nunca sugerido.
 *
 * Este é o número que vai para a mesa, e é o único ponto do produto em que a
 * tentação de "arredondar para algo negociável" é grande. A regra aqui é a mais
 * dura do repositório: **o preço-alvo é uma função das evidências, escrita em
 * código, e ela devolve junto a derivação que a explica.** Quando as evidências
 * não bastam, ela devolve `null` e diz o que falta — nunca um palpite.
 *
 * ---------------------------------------------------------------------------
 * A regra
 * ---------------------------------------------------------------------------
 * A faixa-alvo é `[piso, teto]`, e cada ponta vem de uma evidência diferente:
 *
 * - **piso** = o **menor custo comparável confiável** encontrado. Não é o menor
 *   preço da lista: é o menor entre as ofertas que passaram no match, têm custo
 *   completo e alcançam o pedido mínimo. Pagar menos que isso não é meta, é
 *   sorte — nenhum fornecedor observado cobra menos.
 * - **teto** = a **mediana** do mercado. Fechar na mediana é fechar no preço
 *   que metade do mercado pratica, e é o ponto em que a negociação deixa de ser
 *   ganho e vira o normal.
 *
 * Duas correções entram sobre isso, e as duas puxam para baixo:
 *
 * 1. **O preço praticado hoje**, quando existe. Se já se compra abaixo da
 *    mediana, a mediana não pode ser meta — ela seria uma recomendação de
 *    piorar. O teto da faixa passa a ser o menor entre a mediana e o preço
 *    atual.
 * 2. **O teto econômico da remuneração**, quando o motor o calculou
 *    (`motor.ts`). Um alvo acima dele é um alvo que destrói margem, por mais
 *    barato que o mercado esteja. A faixa inteira é cortada ali, e a derivação
 *    diz que foi a remuneração que mandou — que é justamente a pergunta que
 *    este produto existe para responder.
 *
 * ---------------------------------------------------------------------------
 * O que **não** entra
 * ---------------------------------------------------------------------------
 * Oferta `NAO_COMPARAVEL`, oferta sem custo completo, oferta abaixo do pedido
 * mínimo do pedido em análise, e oferta com captura `VELHA`. As quatro aparecem
 * na lista de evidências, marcadas, e nenhuma delas move o alvo.
 */

/** Uma evidência que pesou — ou que foi expressamente descartada. */
export interface EvidenciaDoAlvo {
  tipo:
    | "MENOR_CUSTO"
    | "MEDIANA"
    | "PRECO_ATUAL"
    | "TETO_ECONOMICO"
    | "HISTORICO"
    | "DESCARTADA";
  valor: number | null;
  /** O que esta evidência fez com a faixa. */
  efeito: string;
}

export interface FaixaAlvo {
  /** A ponta ambiciosa: o menor custo comparável confiável. */
  piso: number;
  /** A ponta aceitável. */
  teto: number;
  evidencias: EvidenciaDoAlvo[];
  /** A derivação em uma frase, para a resposta citar sem reescrever a regra. */
  derivacao: string;
}

export interface SemAlvoDeMercado {
  /** O que falta, em uma frase acionável. */
  porque: string;
  evidencias: EvidenciaDoAlvo[];
}

export interface EntradaDoAlvo {
  /** Os custos comparáveis das ofertas que entram — já filtrados por quem chama. */
  custosConfiaveis: number[];
  mediana: number | null;
  /** O que se paga hoje ou se pagou, por unidade, quando se sabe. */
  precoAtual: number | null;
  /** O histórico de compra, quando existe. Informativo: não move a faixa sozinho. */
  precoHistorico: number | null;
  /** O teto do motor econômico — o limite que a remuneração sustenta. */
  tetoEconomico: number | null;
}

/**
 * A faixa-alvo, ou a recusa com motivo.
 *
 * **Uma oferta só não produz faixa.** É a decisão mais discutível deste arquivo
 * e ela é deliberada: com um ponto não há mediana, não há dispersão e não há
 * como saber se aquele preço é o mercado ou um outlier. O que sai é a recusa,
 * dizendo que há uma oferta e que ela não basta — e a oferta continua visível
 * na tela, com a fonte. O comprador decide; o agente não finge que sabe.
 */
export function derivarPrecoAlvo(
  entrada: EntradaDoAlvo,
): FaixaAlvo | SemAlvoDeMercado {
  const evidencias: EvidenciaDoAlvo[] = [];
  const custos = entrada.custosConfiaveis.filter(
    (c) => Number.isFinite(c) && c > 0,
  );

  if (custos.length === 0) {
    return {
      porque:
        "Nenhuma oferta com custo total comparável sobreviveu ao match e à conferência de " +
        "fonte. Sem isso não há evidência sobre a qual derivar um preço-alvo — e inventar " +
        "um número aqui seria exatamente o que este agente não faz.",
      evidencias,
    };
  }

  if (custos.length === 1) {
    evidencias.push({
      tipo: "MENOR_CUSTO",
      valor: custos[0]!,
      efeito:
        "Única oferta comparável — registrada como evidência, insuficiente para uma faixa.",
    });
    return {
      porque:
        "Só uma oferta comparável foi encontrada. Com um ponto não há mediana nem dispersão, " +
        "e não dá para dizer se aquele preço é o mercado ou uma exceção. A oferta está listada " +
        "abaixo, com a fonte; para recomendar uma faixa é preciso pelo menos mais uma.",
      evidencias,
    };
  }

  const menor = Math.min(...custos);
  const mediana = entrada.mediana ?? menor;

  evidencias.push({
    tipo: "MENOR_CUSTO",
    valor: menor,
    efeito:
      "Define o piso da faixa: é o menor custo total comparável observado.",
  });
  evidencias.push({
    tipo: "MEDIANA",
    valor: mediana,
    efeito:
      "Define o teto da faixa: fechar acima disso é pagar mais que metade do mercado.",
  });

  let piso = menor;
  let teto = Math.max(menor, mediana);
  const cortes: string[] = [];

  if (entrada.precoAtual !== null && entrada.precoAtual > 0) {
    const abaixo = entrada.precoAtual < teto;
    evidencias.push({
      tipo: "PRECO_ATUAL",
      valor: entrada.precoAtual,
      efeito: abaixo
        ? "Já se compra abaixo da mediana: o teto da faixa desce até o preço atual, porque a mediana seria uma recomendação de piorar."
        : "Acima da faixa: é a diferença que a negociação pode capturar.",
    });
    if (abaixo) {
      teto = Math.max(piso, entrada.precoAtual);
      cortes.push("limitada pelo preço que já se pratica");
    }
  }

  if (entrada.precoHistorico !== null && entrada.precoHistorico > 0) {
    evidencias.push({
      tipo: "HISTORICO",
      valor: entrada.precoHistorico,
      efeito:
        "Registrado como referência do que já se pagou. Não move a faixa sozinho: o histórico diz o passado, e a faixa é do mercado de agora.",
    });
  }

  if (entrada.tetoEconomico !== null && entrada.tetoEconomico > 0) {
    const corta = entrada.tetoEconomico < teto;
    evidencias.push({
      tipo: "TETO_ECONOMICO",
      valor: entrada.tetoEconomico,
      efeito: corta
        ? "Corta a faixa: acima disso a compra consome mais remuneração do que a operação recebe pelo item."
        : "Acima da faixa inteira: a remuneração cobre o mercado com folga.",
    });
    if (corta) {
      teto = entrada.tetoEconomico;
      piso = Math.min(piso, teto);
      cortes.push("cortada pelo teto econômico da remuneração");
    }
  }

  const derivacao =
    `Piso ${piso.toFixed(2)} — o menor custo total comparável entre ${custos.length} ofertas; ` +
    `teto ${teto.toFixed(2)} — a mediana do mercado` +
    (cortes.length > 0 ? `, ${cortes.join(" e ")}` : "") +
    ".";

  return { piso, teto, evidencias, derivacao };
}

/** Distingue os dois desfechos sem `in`, para a tela e a redação lerem igual. */
export function temFaixa(r: FaixaAlvo | SemAlvoDeMercado): r is FaixaAlvo {
  return (r as FaixaAlvo).piso !== undefined;
}
