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
  /**
   * Quanto custou, para o painel técnico e para a prova de execução real.
   *
   * `modelo` e `tokens` são o que distingue uma pesquisa de verdade de uma de
   * fixture: a fixture não chama modelo nenhum e devolve os dois zerados. É por
   * eles que se confere, depois, que a busca saiu mesmo para a internet.
   */
  medicao: {
    latenciaMs: number;
    paginasBaixadas: number;
    modelo: string | null;
    tokensEntrada: number;
    tokensSaida: number;
    /** As buscas e os fetches que o servidor de fato executou. */
    buscasServidor: number;
    fetchesServidor: number;
  };
  /**
   * Os erros que as ferramentas de servidor devolveram, quando devolveram.
   *
   * Erro de `web_search`/`web_fetch` **não** levanta exceção: ele volta com
   * HTTP 200, num bloco de resultado cujo conteúdo é um objeto de erro em vez
   * da lista/documento esperado. Sem esta lista, uma pesquisa que não abriu
   * página nenhuma por bloqueio de domínio ficaria indistinguível de uma que
   * não achou fornecedor.
   */
  errosDeFerramenta: { ferramenta: string; codigo: string }[];
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
        medicao: MEDICAO_VAZIA,
        errosDeFerramenta: [],
      };
    },
  };
}

/** A medição de quem não chamou modelo nenhum. */
export const MEDICAO_VAZIA = {
  latenciaMs: 0,
  paginasBaixadas: 0,
  modelo: null,
  tokensEntrada: 0,
  tokensSaida: 0,
  buscasServidor: 0,
  fetchesServidor: 0,
} as const;

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
        medicao: { ...MEDICAO_VAZIA, paginasBaixadas: paginas.length },
        errosDeFerramenta: [],
      };
    },
  };
}
