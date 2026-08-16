/**
 * A conta da paginação, separada do rodapé que a mostra.
 *
 * Mora em `lib/` pelo mesmo critério do resto deste diretório: é o que a tela
 * **decide**, e não o que ela desenha. Quais páginas aparecem no rodapé, onde
 * entra a reticência e que faixa de linhas a página atual cobre são perguntas
 * com resposta certa e errada — e a resposta errada aqui manda o operador para
 * uma página vazia, ou esconde dele as 918 alterações que a lista não coube.
 */

/**
 * Quantas linhas por página, e as opções que a tela oferece.
 *
 * Eram 300 fixas, sem página seguinte: a lista carregava as 300 primeiras e o
 * resto só era alcançável por filtro. Cem é o que cabe numa rolagem sem pesar,
 * e quem quiser as 300 de antes continua tendo a opção no rodapé.
 */
export const POR_PAGINA_PADRAO = 100;
export const TAMANHOS_DE_PAGINA = [50, 100, 300];

/** Onde a lista está: o tamanho da página e qual delas. */
export interface Janela {
  porPagina: number;
  /** 1-based, como as pessoas contam páginas. */
  pagina: number;
}

export const primeiraPagina: Janela = {
  porPagina: POR_PAGINA_PADRAO,
  pagina: 1,
};

/**
 * A janela como a API a entende — `limit` e `offset`, numa definição só.
 *
 * As duas listas paginadas montam a query de jeitos diferentes (uma varre os
 * filtros, a outra os nomeia um a um), e é só aqui que a página vira posição.
 * Duas traduções desta conta é como uma tela mostra a página 4 e a outra a 3.
 */
export function aplicarJanela(params: URLSearchParams, janela: Janela): void {
  params.set("limit", String(janela.porPagina));
  const offset = (janela.pagina - 1) * janela.porPagina;
  if (offset > 0) params.set("offset", String(offset));
}

/**
 * As páginas visíveis no rodapé — `1 … 7 8 9 [10] 11`.
 *
 * `null` é a reticência. A primeira e a última estão sempre presentes, e ao
 * redor da atual ficam duas de cada lado: é a forma do Freightech, e ela
 * mantém o rodapé do mesmo tamanho com 11 páginas ou com 40.
 */
export function numerosDePagina(
  atual: number,
  total: number,
): (number | null)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, indice) => indice + 1);
  }

  const paginas = new Set<number>([1, total]);
  for (let numero = atual - 2; numero <= atual + 2; numero++) {
    if (numero >= 1 && numero <= total) paginas.add(numero);
  }

  const ordenadas = [...paginas].sort((a, b) => a - b);
  const resultado: (number | null)[] = [];
  let anterior: number | null = null;
  for (const numero of ordenadas) {
    if (anterior !== null && numero - anterior > 1) resultado.push(null);
    resultado.push(numero);
    anterior = numero;
  }
  return resultado;
}

export interface FaixaDaPagina {
  /** 1-based, e 0 quando não há resultado nenhum. */
  primeiro: number;
  ultimo: number;
  totalPaginas: number;
  /** A página pedida, presa dentro do que existe. */
  atual: number;
}

/**
 * Que faixa de resultados a página atual cobre — e em quantas páginas.
 *
 * A página pedida é presa entre 1 e a última: um filtro que encurta a lista
 * pode deixar de existir a página em que se estava, e o rodapé afirmando
 * "Mostrando 901 - 1000 de 40" sobre uma tabela vazia é pior do que mostrar a
 * última página.
 */
export function faixaDaPagina(
  pagina: number,
  porPagina: number,
  total: number,
): FaixaDaPagina {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const atual = Math.min(Math.max(1, pagina), totalPaginas);
  return {
    totalPaginas,
    atual,
    primeiro: total === 0 ? 0 : (atual - 1) * porPagina + 1,
    ultimo: Math.min(atual * porPagina, total),
  };
}
