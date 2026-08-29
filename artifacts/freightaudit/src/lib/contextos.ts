import { useQuery } from "@tanstack/react-query";

import { chamadaResiliente } from "@/lib/chamada-resiliente";
import {
  useConsultaResiliente,
  type ConsultaResiliente,
} from "@/lib/consulta-resiliente";

/**
 * `/contexts` — uma pergunta, uma consulta, uma política.
 *
 * Este módulo nasceu de um defeito que não é da tela de Unidades, embora só ela
 * o mostrasse: **quatro `useQuery` diferentes usavam a chave `["contexts"]`, com
 * três `queryFn` distintas e três conjuntos de opções.** No React Query a chave
 * *é* a identidade da consulta — há um objeto `Query` por chave, com **uma**
 * `queryFn` e **uma** política de repetição. Quando os observadores divergem,
 * quem dispara a busca é quem dita as duas para todo mundo; os outros só assinam
 * o resultado. Não é uma sutileza de biblioteca: é o contrato dela.
 *
 * O efeito medido, no navegador, em `/unidades`:
 *
 *   - a `queryFn` que rodava era a da **barra lateral** (o `Layout` monta antes,
 *     e efeitos do React correm de dentro para fora), nunca a da página;
 *   - a da lateral traduz `!response.ok` em `[]`. Com a API fora do ar — 502 do
 *     roteador, 500 do proxy do Vite, ambos de corpo vazio, medidos — a tela
 *     escrevia "Nenhuma vigência importada ainda", que é falso e é exatamente o
 *     contrário do que houve. Uma sessão expirada (401) dava a mesma frase;
 *   - `retry: false` da lateral também vencia, então as cinco tentativas de
 *     `resiliencia.ts` (13,2s, calibradas para partida a frio) **nunca**
 *     rodavam: uma única falha de rede pintava o painel na hora;
 *   - e como todo status virava `[]`, o único erro que sobrava para a página era
 *     o `fetch` rejeitando. Daí o aviso afirmar sempre "a requisição não
 *     completou" e "isso descarta o processo API Server fora do ar": não era
 *     diagnóstico, era o único desfecho que o caminho deixava chegar.
 *
 * A correção é ter um lugar só. Quem monta a casca e quem responde pela tela
 * fazem a **mesma** chamada, com a **mesma** política; o que muda entre eles é o
 * que desenham — e isso é decisão de renderização, não de transporte.
 *
 * `components/layout/contadores.ts` já tinha resolvido isto do outro jeito
 * possível: sufixa as chaves dele com `"casca"` para não compartilhar cache com
 * as telas. As duas consultas de `/contexts` da lateral ficaram fora daquela
 * convenção — e a lista de Unidades foi a vítima.
 */

/**
 * Uma unidade e canal que já entregou vigência.
 *
 * A forma morava copiada em três arquivos (`pages/unidades.tsx`,
 * `components/layout/sidebar.tsx` e `components/inicio/types.ts`, este último
 * como `SeriesContext`). Três cópias da mesma resposta é a mesma doença da
 * chave compartilhada, um nível acima: nada obriga as três a concordarem.
 */
export interface Contexto {
  scopeHash: string;
  channel: string | null;
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
  latestPeriod: string;
  periods: number;
  /**
   * Todas as vigências deste contexto, da mais antiga à mais recente — já
   * chega no JSON de `/contexts` (`ContextInfo.periodosDisponiveis` no
   * servidor), só faltava o tipo aqui reconhecer. A Visão Geral usa isto
   * para montar o seletor de competência sem uma segunda chamada.
   */
  periodosDisponiveis: string[];
}

/**
 * A chave, escrita uma vez.
 *
 * Exportada para que ninguém precise redigitar `["contexts"]` — foi redigitando
 * que quatro lugares passaram a compartilhar cache sem que nenhum deles
 * soubesse. Quem invalida depois de uma mutação usa esta constante.
 */
export const CHAVE_DOS_CONTEXTOS = ["contexts"] as const;

/** A rota. É também a chave do registro de falhas (`registro-de-falhas.ts`). */
export const ENDPOINT_DOS_CONTEXTOS = "/contexts";

/**
 * Para a tela que **responde** por esta lista.
 *
 * Traz a política inteira de `resiliencia.ts`: cinco tentativas em 13,2s, a
 * última resposta válida preservada quando uma repetição falha, e o painel de
 * indisponibilidade só quando não há nada em tela para mostrar. As falhas ficam
 * registradas em `__freightcheck_falhas`, que é a única evidência que sai de um
 * navegador que não está conseguindo falar com o servidor.
 */
export function useContextos(): ConsultaResiliente<Contexto[]> {
  return useConsultaResiliente<Contexto[]>({
    queryKey: CHAVE_DOS_CONTEXTOS,
    endpoint: ENDPOINT_DOS_CONTEXTOS,
  });
}

/** O que a casca lê: a lista, e se a chamada falhou — sem nunca dizer por quê. */
export interface ContextosDaCasca {
  contextos: Contexto[];
  carregando: boolean;
  /**
   * A chamada falhou e não há lista para mostrar.
   *
   * Existe para a casca poder calar em vez de mentir. Ela não diz **o que**
   * houve, de propósito: explicar é trabalho da tela, e dois lugares explicando
   * a mesma falha é o defeito que `apresentar-erro.ts` existe para fechar.
   */
  indisponivel: boolean;
}

/**
 * Para a casca — o mesmo `/contexts`, sem nunca mostrar falha.
 *
 * A barra lateral e o Resumo executivo leem esta lista para se enfeitar, não
 * para responder por ela: um erro aqui não pode virar painel. O que **não** dá
 * para fazer é traduzir o erro em `[]` dentro da `queryFn`, como as duas versões
 * anteriores faziam — a `queryFn` é do cache, é compartilhada, e engolir ali
 * engole para todo mundo que usa a chave. Aqui o erro chega e é ignorado **na
 * leitura**, que é o único lugar onde ignorar é decisão de quem ignora.
 *
 * `refetchOnWindowFocus: true` continua sendo exceção deliberada (o `Layout`
 * nunca desmonta, então `refetchOnMount` não o alcança — ver `App.tsx`), e agora
 * é uma exceção **segura de verdade**: a falha de um refetch por foco não
 * substitui mais a tela de Unidades por um painel, porque quem responde por ela
 * preserva a última resposta válida (`useContextos`).
 */
export function useContextosDaCasca(): ContextosDaCasca {
  const { data, isLoading, error } = useQuery({
    queryKey: CHAVE_DOS_CONTEXTOS,
    ...chamadaResiliente<Contexto[]>({ endpoint: ENDPOINT_DOS_CONTEXTOS }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  return {
    contextos: data ?? [],
    carregando: isLoading,
    indisponivel: error != null && data === undefined,
  };
}

/**
 * Qual contexto está aberto — a regra, num lugar só.
 *
 * A caixa "Unidade atual" da lateral e as telas que honram `scopeHash` (ver
 * `TELAS_QUE_HONRAM_ESCOPO`, em `lib/navegacao-do-escopo.ts`) precisam responder
 * **a mesma coisa**: sem isso a lateral nomeia uma unidade e a tela mostra
 * outra população. Foi o que aconteceu com a Cobertura de dados — a lateral
 * escrevia PERNAMBUCO, porque sem `scopeHash` na URL ela cai no primeiro
 * contexto, e a matriz listava as cinco unidades do acervo, porque a tela não
 * lia o par.
 *
 * O fallback para o primeiro é deliberado e não é um palpite: `/contexts` volta
 * ordenado, e o primeiro é o que a lateral já anuncia como aberto. Quem quer
 * todas de uma vez escreve `visaoGeral=1`, que é uma escolha e não uma ausência.
 *
 * Um `scopeHash` que não existe na lista — um endereço velho, ou colado à mão —
 * cai no primeiro em vez de deixar a tela sem contexto: mostrar a unidade que a
 * lateral nomeia é melhor do que mostrar o acervo inteiro sob um nome só.
 */
export function contextoAberto(
  contextos: Contexto[],
  scopeHash: string | null,
): Contexto | undefined {
  if (scopeHash === null) return contextos[0];
  return contextos.find((c) => c.scopeHash === scopeHash) ?? contextos[0];
}
