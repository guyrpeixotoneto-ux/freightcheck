import { periodicitySuffix } from "@workspace/comparison/labels";
import { formatBrl, formatNumber } from "@/lib/format";

/**
 * OS NÚMEROS DE CADA CANDIDATA A "DE" — e a regra de quando não escrever nada.
 *
 * ---------------------------------------------------------------------------
 * Por que este módulo não mora em `lib/finame.ts`
 * ---------------------------------------------------------------------------
 * Porque quem o lê é o seletor de par (`components/comparacao/seletor-do-par`),
 * que desde a Auditoria de IPVA serve **duas** telas. Um componente
 * compartilhado importando do módulo de uma rubrica é a seta apontando para o
 * lado errado: bastaria a segunda tela querer a mesma coluna para o FINAME
 * virar dependência de quem não fala de FINAME.
 *
 * Aqui não há nada de FINAME — é a forma de uma resposta de candidatas e a
 * regra de como ela vira texto. Uma rota `/ipva/candidatos` que devolva esta
 * mesma forma entra sem tocar em nada.
 */

/** O que uma rota de candidatas devolve. */
export interface CandidatosDoPar {
  para: string;
  candidatos: {
    id: string;
    numeros: {
      alteracoes: number;
      /*
        Só `porPeriodicidade`, e é o que a linha precisa.

        A primeira versão deste tipo copiou o impacto do FINAME inteiro, com
        `cobertasPorParcelas` junto — e o IPVA, que chama o mesmo campo de
        `foraDaSoma`, não caberia aqui sem inventar uma conversão. Pedir só o
        que se lê é o que torna esta forma comum de verdade: cada rubrica
        acrescenta o que quiser no resto, e nada disso chega ao menu.
      */
      impacto: { porPeriodicidade: Record<string, number> };
    } | null;
  }[];
  /** Quantas candidatas não couberam no orçamento desta chamada. */
  pendentes: number;
}

/** O que uma linha do menu mostra à direita da vigência. */
export interface NumerosDaLinha {
  /**
   * Uma linha de dinheiro por periodicidade, já escrita — **nunca vazia**.
   *
   * Quando o par não move dinheiro nenhum, a lista é `R$ 0,00`: a coluna
   * zerada é a resposta, e a coluna em branco era a ausência dela. Ver
   * {@link numerosDaLinha}.
   */
  valores: { texto: string; bruto: number }[];
  /** "457 alterações", "1 alteração", "0 alterações". */
  alteracoes: string;
}

/**
 * O que escrever ao lado de uma vigência — ou **nada**, que é o caso que
 * importa.
 *
 * A regra inteira está no tipo de retorno: `null` quer dizer *não escreva
 * número nenhum nesta linha*, e é o que sai para quem ainda não foi calculado.
 * Ausência de cálculo e "nada mudou" são fatos diferentes, e é essa fronteira
 * — e só ela — que separa a linha muda da linha zerada. Um número escrito por
 * cima de uma conta que não aconteceu **mente com números**, que é a pior
 * forma de mentir numa tela de auditoria; um número escrito sobre uma conta
 * que aconteceu e deu zero é a notícia que quem audita veio buscar.
 *
 * Calculado, o par **sempre** escreve as duas coisas: o dinheiro e a contagem.
 * A versão anterior filtrava os baldes zerados e, quando nada mudava, sobrava
 * a coluna do dinheiro em branco ao lado de um "nenhuma alteração" — duas
 * linhas vizinhas, uma com `+R$ 7.238,85/mês` e outra com espaço vazio, que é
 * exatamente a leitura que o seletor não pode oferecer: espaço em branco na
 * coluna do dinheiro já significa *ainda não calculei* nesta tela, e a mesma
 * casa não pode significar *calculei e deu zero*. `R$ 0,00` e `0 alterações`
 * dizem a segunda em voz alta, na mesma régua em que as outras linhas dizem a
 * delas.
 *
 * O zero não leva sinal: `+` e `−` são a direção do movimento, e não há
 * direção quando não houve movimento. Quem pinta a linha é o seletor, e ele lê
 * `bruto` — zero não é ganho nem perda, e não recebe a cor de nenhum dos dois.
 *
 * O dinheiro sai por periodicidade, cada balde na sua linha, com o sufixo do
 * motor (`/mês`, `/ano`, `(valor único)`). Somar os baldes num número só é o
 * que `impactoPorPeriodicidade` se recusa a fazer — a parcela é mensal e a base
 * de compra é do ato da compra —, e uma tela que somasse aqui publicaria um
 * total que nenhuma outra do produto reconhece.
 */
export function numerosDaLinha(
  numeros: CandidatosDoPar["candidatos"][number]["numeros"],
): NumerosDaLinha | null {
  if (!numeros) return null;

  const valores = Object.entries(numeros.impacto.porPeriodicidade)
    .filter(([, valor]) => valor !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodicidade, valor]) => ({
      texto: `${valor > 0 ? "+" : "−"}${formatBrl(Math.abs(valor))}${periodicitySuffix(
        periodicidade,
      )}`,
      bruto: valor,
    }));

  /*
    Nenhum balde valorado — e a linha diz isso com um número, não com o vazio.

    Sem periodicidade nenhuma no bolso, o zero também não ganha sufixo: escrever
    `R$ 0,00/mês` afirmaria que o que não mudou era mensal, e não há balde que
    sustente a frase. Quando algum balde tem valor, o zero dos outros continua
    filtrado: ali o que responde é o movimento, e `R$ 0,00/ano` embaixo de
    `+R$ 7.238,85/mês` só rouba a linha de quem tem notícia.
  */
  if (valores.length === 0) valores.push({ texto: formatBrl(0), bruto: 0 });

  const alteracoes = `${formatNumber(numeros.alteracoes, 0)} ${
    numeros.alteracoes === 1 ? "alteração" : "alterações"
  }`;

  return { valores, alteracoes };
}
