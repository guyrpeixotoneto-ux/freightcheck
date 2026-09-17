/**
 * O que a pergunta quer — decidido por regra, antes de qualquer consulta.
 *
 * Dez intenções, e cada uma monta um dossiê diferente: perguntar o preço-alvo
 * de um pneu lê a remuneração de um item; perguntar onde se destrói margem
 * varre a carteira inteira. Classificar antes de consultar é o que evita as
 * duas falhas opostas — consultar tudo para toda pergunta, e responder "qual
 * item?" para quem perguntou sobre a carteira.
 *
 * **Por regra, e não por modelo**, pela mesma razão da extração: a classificação
 * decide o que vai ao banco, e uma classificação instável faria a mesma
 * pergunta devolver dossiês diferentes em dois dias. O preço de classificar por
 * palavra é a pergunta escrita de um jeito que a tabela não prevê — e ela cai
 * em {@link INTENCAO_PADRAO}, que é a leitura de item, a mais útil das dez para
 * quem chegou com um pedido na mão.
 */

import { normalizar } from "./extracao";

export type Intencao =
  /** "Quanto devo pagar por este item?" — o preço-alvo e o teto. */
  | "PRECO_ALVO"
  /** "Qual é meu preço máximo?" — o teto, com o alvo ao lado. */
  | "TETO"
  /** "Essa cotação está boa?" — o veredito sobre um preço. */
  | "AVALIAR_COTACAO"
  /** "Compare essas três cotações." — o ranking entre propostas. */
  | "COMPARAR"
  /** "Quais fornecedores estão mais competitivos?" */
  | "FORNECEDORES"
  /** "Quais itens estou comprando acima do teto?" */
  | "ACIMA_DO_TETO"
  /** "Onde estou destruindo margem?" / "maior margem entre remunerado e comprado" */
  | "MARGEM"
  /** "Quais compras têm maior oportunidade de economia?" / "quanto economizamos no ano?" */
  | "OPORTUNIDADES"
  /** "Simule uma compra de 80 unidades a R$ 3.080." */
  | "SIMULAR"
  /** "Mostre a evidência que sustenta esse preço-alvo." */
  | "EVIDENCIA"
  /** "Pesquise esse uniforme no mercado." / "Encontre fornecedores para este item." */
  | "PESQUISAR_MERCADO"
  /** "Quanto a Ambev remunera e quanto consigo comprar?" — os dois lados juntos. */
  | "REMUNERADO_VERSUS_MERCADO";

export const INTENCAO_PADRAO: Intencao = "PRECO_ALVO";

export const ROTULO_DA_INTENCAO: Record<Intencao, string> = {
  PRECO_ALVO: "Preço-alvo do item",
  TETO: "Teto econômico do item",
  AVALIAR_COTACAO: "Análise de uma cotação",
  COMPARAR: "Comparação de propostas",
  FORNECEDORES: "Competitividade por fornecedor",
  ACIMA_DO_TETO: "Compras acima do teto",
  MARGEM: "Margem entre remunerado e comprado",
  OPORTUNIDADES: "Oportunidades de economia",
  SIMULAR: "Simulação de compra",
  EVIDENCIA: "Evidência do preço-alvo",
  PESQUISAR_MERCADO: "Pesquisa de mercado",
  REMUNERADO_VERSUS_MERCADO: "Remuneração contra o mercado",
};

/**
 * As marcas de cada intenção, da mais específica para a mais genérica.
 *
 * A ordem da lista **é** a precedência, e ela não é alfabética: "mostre a
 * evidência do preço-alvo" contém "preço-alvo", e responder com o preço-alvo a
 * quem pediu a evidência devolveria o número que a pessoa já tem. Por isso as
 * intenções que falam *sobre* uma resposta anterior vêm antes das que produzem
 * uma nova.
 */
const MARCAS: { intencao: Intencao; termos: string[] }[] = [
  {
    intencao: "EVIDENCIA",
    termos: [
      "evidencia",
      "evidencias",
      "como foi calculado",
      "como chegou",
      "de onde vem",
      "de onde veio",
      "que sustenta",
      "me mostre a conta",
      "abrir a conta",
      "qual a premissa",
      "quais premissas",
    ],
  },
  {
    /*
      Vem depois da evidência e antes de tudo o mais: "compare o que somos
      remunerados com o mercado" contém "compare", e responder com o ranking de
      propostas registradas deixaria de fora justamente o mercado que a pergunta
      pede. As duas intenções de mercado são as únicas que saem para a internet,
      e por isso elas precisam ser reconhecidas antes das que só leem o acervo.
    */
    intencao: "REMUNERADO_VERSUS_MERCADO",
    termos: [
      "remunera e quanto consigo",
      "remunerado com o mercado",
      "remunerados com o mercado",
      "remuneracao com o mercado",
      "somos remunerados",
      "remunerado e o mercado",
      "quanto somos remunerados",
      "compare o remunerado",
      "remuneracao contra o mercado",
      "sobra se eu comprar no mercado",
    ],
  },
  {
    intencao: "PESQUISAR_MERCADO",
    termos: [
      "pesquise",
      "pesquisar",
      "pesquisa de mercado",
      "no mercado",
      "de mercado",
      "encontre fornecedores",
      "procure fornecedores",
      "buscar fornecedores",
      "achar fornecedores",
      "quanto custa no mercado",
      "quanto o mercado",
      "precos de mercado",
      "cotar",
      "cote",
      "cotacao de mercado",
      "estou pagando caro",
      "pagando caro",
      "melhor preco encontrado",
      "me mostre as fontes",
      "mostre as fontes",
      "quais as fontes",
    ],
  },
  {
    intencao: "COMPARAR",
    termos: [
      "compare",
      "comparar",
      "comparacao",
      "qual das",
      "entre as propostas",
      "versus",
    ],
  },
  {
    intencao: "FORNECEDORES",
    termos: [
      "fornecedor",
      "fornecedores",
      "mais competitivo",
      "mais competitivos",
      "negociar primeiro",
      "quem esta mais caro",
    ],
  },
  {
    intencao: "ACIMA_DO_TETO",
    termos: [
      "acima do teto",
      "acima do limite",
      "estourando",
      "estouraram",
      "passaram do teto",
      "fora do teto",
    ],
  },
  {
    intencao: "MARGEM",
    termos: [
      "destruindo margem",
      "destruicao de margem",
      "maior margem",
      "margem entre",
      "sobra da remuneracao",
      "quanto sobra",
      "merecem atencao",
    ],
  },
  {
    intencao: "OPORTUNIDADES",
    termos: [
      "oportunidade",
      "oportunidades",
      "economia",
      "economizar",
      "poupar",
      "quanto podemos",
      "maior ganho",
      "onde ganhar",
    ],
  },
  {
    intencao: "SIMULAR",
    termos: ["simule", "simular", "simulacao", "e se eu comprar", "cenario"],
  },
  {
    intencao: "AVALIAR_COTACAO",
    termos: [
      "esta boa",
      "esta bom",
      "essa cotacao",
      "esta cotacao",
      "essa proposta",
      "esta proposta",
      "pagando acima",
      "acima do ideal",
      "vale a pena",
      "aceito",
      "aceitar",
      "analisar a cotacao",
      "analisar cotacao",
    ],
  },
  {
    intencao: "TETO",
    termos: [
      "preco maximo",
      "valor maximo",
      "teto",
      "limite economico",
      "no maximo",
      "ate quanto",
    ],
  },
  {
    intencao: "PRECO_ALVO",
    termos: [
      "preco alvo",
      "quanto devo pagar",
      "quanto posso pagar",
      "quanto pagar",
      "bom preco",
      "preco justo",
      "meta de negociacao",
      "descobrir preco",
    ],
  },
];

/**
 * A intenção da pergunta.
 *
 * `temCotacao` é o desempate que a tabela sozinha não consegue: "quanto posso
 * pagar nesse pneu? a proposta é R$ 3.080" pede preço-alvo **e** traz um preço,
 * e responder sem comparar com ele deixaria de fora a única coisa que a pessoa
 * já sabia. Com preço na mão, PRECO_ALVO e TETO viram avaliação de cotação — as
 * duas continuam saindo na resposta, agora com o veredito na frente.
 */
export function intencaoDe(
  pergunta: string,
  contexto: { temCotacao?: boolean } = {},
): Intencao {
  const texto = normalizar(pergunta);

  let achada: Intencao | null = null;
  for (const marca of MARCAS) {
    if (marca.termos.some((t) => texto.includes(normalizar(t)))) {
      achada = marca.intencao;
      break;
    }
  }

  const intencao = achada ?? INTENCAO_PADRAO;
  if (
    contexto.temCotacao === true &&
    (intencao === "PRECO_ALVO" || intencao === "TETO")
  ) {
    return "AVALIAR_COTACAO";
  }
  return intencao;
}

/** Se a intenção fala de um item só, ou da carteira inteira. */
export function ehDeItem(intencao: Intencao): boolean {
  return (
    intencao === "PRECO_ALVO" ||
    intencao === "TETO" ||
    intencao === "AVALIAR_COTACAO" ||
    intencao === "SIMULAR" ||
    intencao === "EVIDENCIA" ||
    ehDeMercado(intencao)
  );
}

/**
 * Se a intenção exige sair para a internet.
 *
 * É a decisão de ferramenta do agente, e ela é por regra: pesquisa de mercado
 * custa tempo e dinheiro, e disparar uma a cada pergunta — inclusive nas que o
 * acervo responde sozinho — seria pagar por resposta que já se tinha. Quem
 * pergunta o teto econômico de um item quer a conta da remuneração; quem
 * pergunta quanto o mercado cobra quer a internet.
 */
export function ehDeMercado(intencao: Intencao): boolean {
  return (
    intencao === "PESQUISAR_MERCADO" || intencao === "REMUNERADO_VERSUS_MERCADO"
  );
}
