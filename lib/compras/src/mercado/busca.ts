/**
 * O BUSCADOR DE MERCADO — a porta, e por que ela é uma porta.
 *
 * Tudo o que está em volta deste arquivo é determinístico e testável sem rede:
 * especificação, match, normalização, estatística, preço-alvo, confiança. A
 * busca é a única peça que sai para o mundo, e por isso ela é uma **interface**
 * com três implementações — a de modelo, a indisponível e a de teste.
 *
 * Não é abstração por gosto. É o que permite a suíte provar a cadeia inteira —
 * *especificação → cotações → normalização → preço-alvo → evidências* — contra
 * páginas escritas à mão, inclusive as que tentam injetar instrução, sem
 * depender de um site de terceiro continuar existindo amanhã.
 *
 * **O contrato da porta é curto e o que ele exige é a proveniência.** Quem
 * implementa devolve as páginas que de fato baixou, com URL e instante de
 * captura carimbados por quem baixou — e as ofertas que leu delas, cada uma com
 * o trecho verbatim. A conferência (`verificacao.ts`) cruza as duas coisas, e o
 * que não cruzar não entra. Uma implementação que quisesse mentir teria de
 * forjar o texto da página inteira.
 */

import type { EspecificacaoDeCompra } from "./especificacao";
import type { OfertaBruta } from "./oferta";
import type { PaginaBaixada } from "./verificacao";

/** O que uma busca devolve: o que foi baixado, e o que se leu do que foi baixado. */
export interface ResultadoDaBusca {
  paginas: PaginaBaixada[];
  ofertas: OfertaBruta[];
  /** As consultas efetivamente disparadas — evidência do que se procurou. */
  consultas: string[];
  /** Por que a busca não aconteceu, quando não aconteceu. Nulo quando aconteceu. */
  indisponivel: string | null;
  /** Quanto custou, para o painel técnico. */
  medicao: { latenciaMs: number; paginasBaixadas: number };
}

export interface BuscaDeMercado {
  /** O nome desta implementação, para a evidência dizer quem buscou. */
  readonly nome: string;
  buscar(
    especificacao: EspecificacaoDeCompra,
    opcoes?: { maximoDePaginas?: number },
  ): Promise<ResultadoDaBusca>;
}

/**
 * A busca que não busca — e diz por quê.
 *
 * É o que responde quando não há chave de modelo configurada. Ela não é um
 * erro e não derruba nada: o Agente de Compras continua respondendo sobre a
 * remuneração, o teto econômico e as cotações registradas à mão, e a resposta
 * diz que o mercado não foi consultado. Um agente que falhasse inteiro por
 * falta de busca externa seria pior do que um que responde o que sabe.
 */
export function buscaIndisponivel(porque: string): BuscaDeMercado {
  return {
    nome: "indisponivel",
    async buscar(): Promise<ResultadoDaBusca> {
      return {
        paginas: [],
        ofertas: [],
        consultas: [],
        indisponivel: porque,
        medicao: { latenciaMs: 0, paginasBaixadas: 0 },
      };
    },
  };
}

/**
 * A busca de fixture — páginas escritas à mão, para a suíte.
 *
 * Devolve o material como se tivesse baixado, inclusive o `capturadoEm` que o
 * teste escolher. É o que torna o frescor testável: um teste pode entregar uma
 * captura de três meses atrás e conferir que a recomendação a trata como velha.
 */
export function buscaDeFixture(
  paginas: PaginaBaixada[],
  ofertas: OfertaBruta[],
): BuscaDeMercado {
  return {
    nome: "fixture",
    async buscar(especificacao): Promise<ResultadoDaBusca> {
      return {
        paginas,
        ofertas,
        consultas: [especificacao.consulta],
        indisponivel: null,
        medicao: { latenciaMs: 0, paginasBaixadas: paginas.length },
      };
    },
  };
}
