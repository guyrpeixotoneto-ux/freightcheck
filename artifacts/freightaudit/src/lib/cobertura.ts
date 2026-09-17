/**
 * A consulta da Cobertura de dados — o recorte virando `URLSearchParams`.
 *
 * A tela media o acervo inteiro. Sempre, em qualquer unidade: `/coverage` era
 * chamada só com vigências, criticidade e equipamento, e a matriz voltava com
 * CAMAÇARI, CDD CEBRASA, EQUATORIAL, MANAUS e PERNAMBUCO uma embaixo da outra
 * — enquanto a caixa "Unidade atual" da lateral, a cinco centímetros dali,
 * escrevia PERNAMBUCO. Os 89,7% de cobertura e as 3.201 lacunas eram do acervo,
 * e o nome ao lado deles era de uma unidade só. Nenhum dos dois estava errado
 * sozinho; juntos, na mesma tela, um desmentia o outro.
 *
 * **De quem é a tela** deixou de ser pergunta desta tela: a regra mora em
 * `lib/escopo-da-tela.ts` desde que a segunda tela precisou dela. O que ficou
 * aqui é o que é da Cobertura — traduzir o recorte e os três filtros do topo na
 * consulta que `/coverage` entende.
 */

import { type EscopoDaTela } from "@/lib/escopo-da-tela";

/** Os filtros da própria tela — os três que moram nos `select` do topo. */
export interface FiltrosDaCobertura {
  vigencias: number;
  criticidade: string;
  equipamento: string;
}

/**
 * A consulta que vai para `/coverage`.
 *
 * `canal` só entra quando o contexto tem um, pela mesma razão de `enderecoDe`:
 * a chave ausente quer dizer "sem filtro de canal", e mandá-la vazia seria
 * escrever um filtro que o servidor descarta em silêncio (ver
 * `vigenciasObservadas`, em `lib/coverage/src/observado.ts`, onde `null` é
 * "não filtre"). O canal da **operação** é outro eixo e não passa por aqui: ele
 * é escopo do ambiente, resolvido no servidor.
 */
export function paramsDaCobertura(
  escopo: EscopoDaTela,
  filtros: FiltrosDaCobertura,
): URLSearchParams {
  const query = new URLSearchParams({ vigencias: String(filtros.vigencias) });
  if (filtros.criticidade !== "TODAS")
    query.set("criticidade", filtros.criticidade);
  if (filtros.equipamento !== "TODOS")
    query.set("equipamento", filtros.equipamento);
  if (!escopo.visaoGeral && escopo.contexto !== undefined) {
    query.set("escopo", escopo.contexto.scopeHash);
    if (escopo.contexto.channel !== null)
      query.set("canal", escopo.contexto.channel);
  }
  return query;
}
