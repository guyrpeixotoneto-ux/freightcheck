import type { LinhaDaFrota } from "./tipos";

/**
 * A ordem da tabela da frota — o que o clique no cabeçalho decide.
 *
 * A lista chega inteira: `/composition/fleet` não pagina, e `getVisaoDeFrota`
 * devolve as linhas da vigência já ordenadas por placa. Por isso ordenar aqui é
 * ordenar a frota inteira, e não a página que chegou — a armadilha que a lista
 * de chamados evita mandando o `sort` junto da query, porque lá a lista vem
 * cortada. Se um dia esta rota paginar, a ordenação muda de lugar junto.
 *
 * **Ausência não é zero.** A tabela já respeita isso célula a célula: um
 * equipamento sem valor apurado mostra "aguardando curadoria", e não
 * `R$ 0,00`. Ordenar por remuneração com `null` valendo zero desfaria a regra
 * na ordem — os que ninguém conseguiu apurar desceriam para o fundo da lista
 * como se fossem a frota mais barata, que é exatamente a leitura que a coluna
 * existe para negar. Aqui a ausência vai para o fim **nos dois sentidos**: ela
 * não é o menor valor nem o maior, é a falta de um.
 *
 * **O empate mantém a ordem de chegada.** `Array.prototype.sort` é estável
 * desde o ES2019 e a lista chega por placa, então dois equipamentos com a mesma
 * remuneração saem em ordem de placa — inverta-se ou não o sentido.
 */

export type ChaveDeOrdem = "equipamento" | "unidade" | "mensal" | "variacao" | "alertas";

export type Sentido = "asc" | "desc";

/** `null` é a ordem da casa: a que o servidor entregou, por placa. */
export type OrdemDaFrota = { chave: ChaveDeOrdem; sentido: Sentido } | null;

/**
 * O sentido de estreia de cada coluna.
 *
 * Dinheiro e contagem estreiam do maior para o menor: quem clica em
 * "remuneração apurada" quer ver o que pesa, não o que não pesa — e quem clica
 * em "alertas" quer os equipamentos com problema, não os sem. Texto estreia de
 * A a Z, que é como se procura uma placa.
 */
export const PRIMEIRO_SENTIDO: Record<ChaveDeOrdem, Sentido> = {
  equipamento: "asc",
  unidade: "asc",
  mensal: "desc",
  variacao: "desc",
  alertas: "desc",
};

/**
 * O próximo estado do cabeçalho: sentido de estreia, inverso, e de volta.
 *
 * O terceiro clique não é enfeite. Sem ele não há como desfazer uma ordenação a
 * não ser recarregando a tela, e a ordem por placa é a única em que o leitor
 * reencontra um equipamento onde ele já sabia que estava. É o mesmo ciclo do
 * cabeçalho da lista de chamados — ver `components/changes/ticket-table.tsx`.
 */
export function proximaOrdem(atual: OrdemDaFrota, chave: ChaveDeOrdem): OrdemDaFrota {
  if (atual === null || atual.chave !== chave) {
    return { chave, sentido: PRIMEIRO_SENTIDO[chave] };
  }
  if (atual.sentido === PRIMEIRO_SENTIDO[chave]) {
    return { chave, sentido: atual.sentido === "asc" ? "desc" : "asc" };
  }
  return null;
}

/**
 * A unidade como a célula a escreve — unidade e operação, nessa ordem.
 *
 * Ordenar só pela unidade deixaria a segunda metade do rótulo fora da conta, e
 * a coluna mostra as duas. Uma linha sem nenhuma das duas é ausência; uma linha
 * só com operação ordena pela operação, que é o texto que ela de fato exibe.
 */
function textoDaUnidade(linha: LinhaDaFrota): string | null {
  const partes = [linha.unidade, linha.operacao].filter((p): p is string => Boolean(p));
  return partes.length > 0 ? partes.join(" · ") : null;
}

/** Ausência depois, em qualquer sentido — ver o cabeçalho deste arquivo. */
function porNumero(a: number | null, b: number | null, sentido: Sentido): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return sentido === "asc" ? a - b : b - a;
}

/** A mesma régua do servidor: `pt-BR`, com número lido como número. */
function porTexto(a: string | null, b: string | null, sentido: Sentido): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  const ordem = a.localeCompare(b, "pt-BR", { numeric: true });
  return sentido === "asc" ? ordem : -ordem;
}

function comparar(a: LinhaDaFrota, b: LinhaDaFrota, ordem: NonNullable<OrdemDaFrota>): number {
  switch (ordem.chave) {
    case "equipamento":
      return porTexto(a.placa, b.placa, ordem.sentido);
    case "unidade":
      return porTexto(textoDaUnidade(a), textoDaUnidade(b), ordem.sentido);
    case "mensal":
      return porNumero(a.mensal, b.mensal, ordem.sentido);
    /*
      Pelo valor com sinal, e não pelo módulo: esta é uma tela de custo, onde
      um aumento de mil reais e uma economia de mil reais são notícias
      opostas — a própria célula pinta uma de vermelho e a outra de verde.
      Ordenar pelo módulo as encostaria uma na outra no topo da lista.
    */
    case "variacao":
      return porNumero(a.variacao?.absoluta ?? null, b.variacao?.absoluta ?? null, ordem.sentido);
    case "alertas":
      return porNumero(a.status.alertas, b.status.alertas, ordem.sentido);
  }
}

/** Sem ordem pedida, a lista sai como chegou. */
export function ordenarLinhas(
  linhas: LinhaDaFrota[],
  ordem: OrdemDaFrota,
): LinhaDaFrota[] {
  if (ordem === null) return linhas;
  return [...linhas].sort((a, b) => comparar(a, b, ordem));
}
