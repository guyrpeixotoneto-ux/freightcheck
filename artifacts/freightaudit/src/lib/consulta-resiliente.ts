import { useEffect, useRef } from "react";
import { onlineManager, useQuery, type QueryKey } from "@tanstack/react-query";

import { chamadaResiliente } from "@/lib/chamada-resiliente";
import { marcarOrigem } from "@/lib/registro-de-falhas";
import {
  deveApresentarIndisponibilidade,
  deveAvisarSobreDadoGuardado,
  guardarResposta,
  type RespostaValida,
} from "@/lib/resiliencia";

/**
 * Uma consulta que atravessa um soluço de rede — em uma linha, para qualquer tela.
 *
 * Este hook é a resposta a "resolver estruturalmente, não tela por tela". A
 * política já morava num lugar só (`resiliencia.ts` decide, `chamada-resiliente.ts`
 * monta as opções), mas **adotá-la** ainda custava quatro coisas espalhadas pela
 * tela: espalhar as opções no `useQuery`, guardar a última resposta num `ref`,
 * assinar o `onlineManager` para marcar a origem, e escrever à mão a regra de
 * quando o painel pode aparecer. Quatro coisas para copiar é quatro coisas para
 * copiar pela metade — e foi exatamente assim que a Curadoria e Competências
 * acabaram com tratamentos diferentes para a mesma falha.
 *
 * Aqui elas viram uma. Quem adota troca `useQuery` por `useConsultaResiliente` e
 * recebe o desfecho já decidido: `indisponivel` quando é para mostrar o painel,
 * `avisarSobreDadoGuardado` quando é para mostrar a tira de rodapé, e `dados`
 * que não somem no meio.
 *
 * **O que este hook não faz**, de propósito: repetição, foco e reconexão. Isso
 * agora é padrão global em `App.tsx`, e vale para as 104 consultas da aplicação,
 * não só para as que adotarem este hook. Ver o cabeçalho de lá para a análise de
 * impacto e as exceções. O que sobra aqui é o que **não** dá para ser global,
 * porque muda o que a tela desenha: preservar a resposta e decidir o painel.
 */
export interface ConsultaResiliente<T> {
  /**
   * A última resposta válida, e não necessariamente a desta renderização.
   *
   * É o que sobrevive a uma falha transitória. `undefined` quer dizer uma coisa
   * só, e é literal: nunca houve resposta.
   */
  dados: T | undefined;
  /**
   * Já houve resposta válida — **inclusive vazia**.
   *
   * É a autoridade sobre "tenho o que mostrar", e é ela que substituiu o
   * `dados.length > 0` que a primeira versão usava. Uma lista legitimamente
   * vazia é uma resposta, e trocá-la por um painel de indisponibilidade seria
   * afirmar que o servidor não respondeu uma pergunta que ele respondeu.
   */
  houveResposta: boolean;
  /** Quando o servidor respondeu o que está em tela. `null` se nunca respondeu. */
  respondidoEm: number | null;
  /** É para mostrar o painel de indisponibilidade. */
  indisponivel: boolean;
  /** É para mostrar a tira "o que está em tela é de HH:MM". */
  avisarSobreDadoGuardado: boolean;
  /** Primeira carga, sem nada para mostrar ainda. */
  carregando: boolean;
  /** Há chamada em voo agora — inclusive repetição. */
  atualizando: boolean;
  erro: unknown;
  /** A tentativa manual. Marca a origem antes de disparar, para o registro. */
  tentarDeNovo: () => void;
}

export function useConsultaResiliente<T>({
  queryKey,
  endpoint,
  buscar,
  enabled,
}: {
  queryKey: QueryKey;
  /** A rota, **sem** os filtros: é a chave do registro de falhas. */
  endpoint: string;
  /** Como buscar. O padrão é `fetchJson(endpoint)`; passe quando houver query string. */
  buscar?: () => Promise<T>;
  enabled?: boolean;
}): ConsultaResiliente<T> {
  /*
    A montagem é marcada aqui, durante a renderização, e não num efeito.

    Um `useEffect` roda **depois** de o React Query já ter disparado a primeira
    busca, e a marca chegaria tarde demais para ela — a falha da montagem seria
    registrada como `desconhecida`, que é o valor que não ensina nada.

    E é marcada em toda montagem, não uma vez por sessão. A versão anterior
    deduzia `montagem` da primeira chamada que via para cada endpoint, guardando
    os endpoints vistos num `Set` global; sair da tela e voltar produzia uma
    montagem legítima registrada como `desconhecida`, porque o endpoint já
    constava. Ver `registro-de-falhas.ts`, onde o `Set` deixou de existir.
  */
  const montou = useRef(false);
  if (!montou.current) {
    montou.current = true;
    marcarOrigem(endpoint, "montagem");
  }

  const consulta = useQuery({
    queryKey,
    ...(enabled === undefined ? {} : { enabled }),
    ...chamadaResiliente<T>({
      endpoint,
      ...(buscar === undefined ? {} : { buscar }),
    }),
  });

  /*
    A última resposta válida, com a hora dela.

    `keepPreviousData` (em `chamada-resiliente.ts`) cobre a espera e solta o dado
    no instante do erro — o placeholder só vale com status `pending`. Este `ref`
    cobre o desfecho, que é a metade que faltava.

    O `dataUpdatedAt > 0` é o que distingue resposta de placeholder: numa chave
    que ainda não respondeu, o campo vale 0 mesmo com `data` preenchida pelo
    placeholder. Sem essa guarda a tira exibiria a hora da época sobre uma lista
    carregada há dois minutos.

    Escrever no `ref` durante o render é seguro aqui: a operação só avança, é
    idempotente para a mesma resposta, e um render descartado no máximo teria
    guardado uma resposta que o servidor de fato mandou.
  */
  const guardada = useRef<RespostaValida<T> | null>(null);
  guardada.current = guardarResposta(
    guardada.current,
    consulta.data !== undefined && consulta.dataUpdatedAt > 0
      ? { dados: consulta.data, em: consulta.dataUpdatedAt }
      : undefined,
  );

  /*
    A volta da conexão é anotada antes de o React Query refazer a chamada.

    Sem isto o registro atribuiria a `desconhecida` justamente o refetch mais
    informativo que existe: o que acontece logo depois de o navegador dizer que
    voltou. Quando ele falha, o que se aprendeu é que a reconexão foi anunciada
    cedo demais — conclusão que só se tira sabendo a origem.
  */
  useEffect(
    () =>
      onlineManager.subscribe((online) => {
        if (online) marcarOrigem(endpoint, "reconexao");
      }),
    [endpoint],
  );

  const houveResposta = guardada.current !== null;

  return {
    dados: guardada.current?.dados,
    houveResposta,
    respondidoEm: guardada.current?.em ?? null,
    indisponivel: deveApresentarIndisponibilidade(houveResposta, consulta.error),
    avisarSobreDadoGuardado: deveAvisarSobreDadoGuardado(
      houveResposta,
      consulta.error,
    ),
    carregando: consulta.isLoading,
    atualizando: consulta.isFetching,
    erro: consulta.error,
    tentarDeNovo: () => {
      marcarOrigem(endpoint, "manual");
      void consulta.refetch();
    },
  };
}
