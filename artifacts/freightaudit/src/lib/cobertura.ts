/**
 * De quem é a Cobertura de dados — o recorte da tela, fora do JSX.
 *
 * A tela media o acervo inteiro. Sempre, em qualquer unidade: `/coverage` era
 * chamada só com vigências, criticidade e equipamento, e a matriz voltava com
 * CAMAÇARI, CDD CEBRASA, EQUATORIAL, MANAUS e PERNAMBUCO uma embaixo da outra
 * — enquanto a caixa "Unidade atual" da lateral, a cinco centímetros dali,
 * escrevia PERNAMBUCO. Os 89,7% de cobertura e as 3.201 lacunas eram do acervo,
 * e o nome ao lado deles era de uma unidade só. Nenhum dos dois estava errado
 * sozinho; juntos, na mesma tela, um desmentia o outro.
 *
 * O recorte vem do endereço, como em toda tela que honra escopo (ver
 * `TELAS_QUE_HONRAM_ESCOPO`, em `lib/navegacao-do-escopo.ts`), e a ausência dele
 * **não** volta a significar "todas": significa a unidade que a lateral já está
 * anunciando — a mesma `contextoAberto` que ela usa. É o que faz chegar aqui
 * pelo menu, sem parâmetro nenhum, mostrar a unidade cujo nome está na tela.
 *
 * "Todas as unidades" continua existindo e passou a ser dita: é `visaoGeral=1`,
 * escrito por quem escolheu — no seletor da lateral ou no link do cabeçalho.
 *
 * Nada aqui lê a rede nem o React: contextos e endereço entrando, recorte e
 * `URLSearchParams` saindo. É o que deixa a regra testável sem montar tela.
 */

import { contextoAberto, type Contexto } from "@/lib/contextos";
import { visaoGeralAtiva } from "@/lib/navegacao-do-escopo";
import { lerRecorte } from "@/lib/recorte";

/** Uma das duas alturas: uma unidade, ou a soma de todas. */
export interface EscopoDaCobertura {
  /** A soma de todas as unidades, pedida por escrito. */
  visaoGeral: boolean;
  /** A unidade aberta — `undefined` na visão geral e enquanto não se sabe. */
  contexto: Contexto | undefined;
  /**
   * Ainda não dá para dizer de quem é a tela.
   *
   * Acontece num caso só: endereço sem `scopeHash` e `/contexts` em voo. Medir
   * agora devolveria o acervo inteiro e, um instante depois, a unidade — e o
   * primeiro número, o errado, é o que fica na memória de quem estava olhando.
   * A consulta espera; a tela diz que está medindo, que é a verdade.
   */
  indefinido: boolean;
}

/** O recorte que o endereço e a lista de contextos, juntos, determinam. */
export function escopoDaCobertura({
  contextos,
  carregando,
  pathname,
  search,
}: {
  contextos: Contexto[];
  carregando: boolean;
  pathname: string;
  search: string;
}): EscopoDaCobertura {
  if (visaoGeralAtiva(pathname, search)) {
    return { visaoGeral: true, contexto: undefined, indefinido: false };
  }

  const { scopeHash } = lerRecorte(search);
  const contexto = contextoAberto(contextos, scopeHash);
  /*
    Sem contexto e sem carregar é acervo vazio ou `/contexts` fora do ar. Nos
    dois a tela mede sem recorte — e, como não tem unidade para nomear, também
    não anuncia nenhuma: é a mesma recusa da lateral, que cala em vez de mentir.
  */
  return {
    visaoGeral: false,
    contexto,
    indefinido: contexto === undefined && scopeHash === null && carregando,
  };
}

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
  escopo: EscopoDaCobertura,
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
