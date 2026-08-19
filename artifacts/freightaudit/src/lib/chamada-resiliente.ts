import {
  keepPreviousData,
  type QueryFunctionContext,
  type QueryKey,
} from "@tanstack/react-query";

import { fetchJson } from "@/lib/api";
import {
  consumirOrigem,
  registrarFalha,
  registrarSucesso,
  type Carimbo,
  type OrigemDoRefetch,
} from "@/lib/registro-de-falhas";
import { deveTentarDeNovo, esperaDaTentativa } from "@/lib/resiliencia";

/**
 * Uma chamada que sobrevive a um soluço de rede — e que conta o que houve.
 *
 * Este módulo é a junção das três peças: a política de repetição
 * (`resiliencia.ts`), o registro da falha (`registro-de-falhas.ts`) e o
 * `useQuery` de quem chama. Ele existe para que a tela **não** monte essa
 * junção à mão.
 *
 * A razão é a de sempre neste repositório: enquanto cada tela montava as suas
 * opções, elas montavam pela metade — e aqui a metade que falta tem
 * consequência visível. Uma query com `retry` e sem `placeholderData` repete
 * direitinho e mesmo assim pisca a tela inteira a cada tentativa; uma com
 * `placeholderData` e sem `refetchOnWindowFocus: false` preserva os dados e
 * volta a falhar toda vez que a aba ganha foco. As quatro opções abaixo só
 * cumprem a promessa juntas, e por isso saem juntas de um lugar só.
 *
 * **É este objeto que os testes exercitam**, com `buscar` trocado por uma
 * função que falha na hora que o cenário pede. Não há uma segunda cópia da
 * política escrita dentro do teste — o que passa lá é o que roda na tela.
 */

/**
 * As opções que valem para **toda** consulta da aplicação.
 *
 * Exportadas, e não escritas dentro do `new QueryClient`, por um motivo só: é o
 * que permite ao teste exercitar o objeto que roda no produto em vez de uma
 * reescrita dele. Uma política global cuja prova é uma cópia da política não
 * prova nada — foi assim que "o foco não refaz a chamada" chegou a passar num
 * ambiente onde foco não refazia chamada nenhuma.
 *
 * A análise de impacto de cada uma das quatro, e as três exceções que declaram
 * `refetchOnWindowFocus: true`, estão no cabeçalho de `App.tsx`, que é onde
 * quem procura por "por que esta tela não atualiza sozinha" vai olhar.
 */
export const PADRAO_DAS_CONSULTAS = {
  retry: deveTentarDeNovo,
  retryDelay: esperaDaTentativa,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
} as const;

/** O carimbo do servidor, lido de `/api/build`. */
async function lerCarimbo(): Promise<Carimbo | null> {
  try {
    return await fetchJson<Carimbo>("/build");
  } catch {
    /*
      Falhar ao ler o carimbo não pode derrubar a chamada que deu certo. O
      carimbo é diagnóstico: sem ele a interrupção fica `INDETERMINADA`, o que é
      uma perda de informação, não um erro do produto. Um `/build` que não
      responde é inclusive esperado num servidor antigo ainda no ar.
    */
    return null;
  }
}

export interface ChamadaResiliente<T> {
  endpoint: string;
  /**
   * Como buscar. O padrão é `fetchJson`; os testes passam a sua.
   *
   * O parâmetro existe **para os testes**, e isso é deliberado: os seis
   * cenários de falha que esta política promete atravessar não são
   * reproduzíveis contra um servidor de verdade — "a conexão cai e volta" não
   * se agenda. Injetar aqui é o que os torna executáveis.
   */
  buscar?: (endpoint: string) => Promise<T>;
  /** O relógio, injetável pelo mesmo motivo. */
  agora?: () => Date;
  /** Ler o carimbo do servidor. Injetável para os testes não irem à rede. */
  carimbo?: () => Promise<Carimbo | null>;
}

/**
 * As opções de `useQuery` que fazem uma falha transitória passar despercebida.
 *
 * Devolve `queryFn` e a política; **não** devolve `queryKey`, que é de quem
 * chama — a chave carrega os filtros da tela, e adivinhá-la aqui seria decidir
 * pelo chamador o que faz duas chamadas serem a mesma.
 */
export function chamadaResiliente<T>({
  endpoint,
  buscar = (rota) => fetchJson<T>(rota),
  agora = () => new Date(),
  carimbo = lerCarimbo,
}: ChamadaResiliente<T>) {
  /*
    A origem vale para o ciclo inteiro, não para a tentativa.

    Uma repetição não tem origem própria: ela herda a de quem começou o ciclo.
    Registrar `desconhecida` na segunda tentativa de um refetch de reconexão
    apagaria justamente o fato que interessa — que a reconexão foi anunciada
    antes de a rede estar de pé.
  */
  let origemDoCiclo: OrigemDoRefetch = "desconhecida";

  return {
    queryFn: async (ctx: QueryFunctionContext<QueryKey>): Promise<T> => {
      /*
        Quantas falhas este ciclo já teve — perguntado ao React Query, que é
        quem conta. Um contador nosso teria de saber quando o ciclo acabou, e
        `queryFn` não é avisado disso: ficaria contando 4, 5, 6 para sempre
        depois do primeiro esgotamento. Medido em
        `__tests__/fila-de-curadoria.test.ts`: aqui dentro este número sai 0, 1,
        2 nas três tentativas.
      */
      const falhasAntes =
        ctx.client.getQueryState(ctx.queryKey)?.fetchFailureCount ?? 0;
      if (falhasAntes === 0) origemDoCiclo = consumirOrigem(endpoint);

      const inicio = agora().getTime();
      try {
        const dados = await buscar(endpoint);
        /*
          O carimbo é lido **fora do caminho crítico**, e isso é uma correção.

          A primeira versão fazia `await carimbo()` aqui, entre ter o dado em
          mãos e devolvê-lo. O efeito é o oposto do que este módulo existe para
          fazer: toda carga bem-sucedida da fila passava a esperar uma segunda
          requisição antes de a tela receber o que já estava pronto —
          diagnóstico atrasando produto. E atrasava pior justamente onde dói,
          porque a partida a frio que se quer diagnosticar é exatamente o
          momento em que o `/build` também responde devagar.

          Sem `await`: o dado sai agora, o carimbo chega quando chegar. Nada
          depende da ordem — `registrarSucesso` fecha episódios pelo registro,
          não por quem chamou —, e um `/build` que nunca responda não segura
          nada. `void` porque o resultado não interessa a este caminho, e o
          `.catch` porque uma promessa rejeitada sem tratamento derrubaria o
          console com um erro que já é esperado e já é tratado dentro de
          `lerCarimbo`.

          Provado em `__tests__/fila-de-curadoria.test.ts`: com um `/build` que
          demora mais do que o teste inteiro, o dado chega assim mesmo.
        */
        void carimbo()
          .then((atual) => {
            if (atual) registrarSucesso(atual);
          })
          .catch(() => {
            // `lerCarimbo` já engole o que sabe engolir; isto cobre um
            // `carimbo` injetado que rejeite, e mantém a promessa silenciosa.
          });
        return dados;
      } catch (erro) {
        registrarFalha(
          {
            endpoint,
            duracaoMs: agora().getTime() - inicio,
            tentativa: falhasAntes + 1,
            origem: origemDoCiclo,
            erro,
          },
          agora,
        );
        throw erro;
      }
    },

    retry: deveTentarDeNovo,
    retryDelay: esperaDaTentativa,

    /**
     * O foco da aba **não** refaz a chamada.
     *
     * Era o motor da recorrência. Com o padrão do React Query (`true`), toda
     * volta à aba dispara um refetch; quando a origem está indisponível — Repl
     * dormindo, partida a frio — esse refetch falha, e o painel de erro
     * reaparece sem que ninguém tenha pedido nada. Quem só voltou para a aba
     * lê aquilo como "quebrou de novo", e o "de novo" não descreve o produto:
     * descreve o gatilho.
     *
     * O que se perde é pouco, e é o que `refetchOnReconnect` e o botão de
     * tentar de novo repõem: a fila de curadoria muda quando alguém cura uma
     * coluna, e quem cura está nesta aba — as mutações já invalidam a chave.
     */
    refetchOnWindowFocus: false as const,

    /**
     * A volta da conexão **refaz**, e é aqui que a recuperação automática mora.
     *
     * É o oposto do foco e pelo motivo oposto: o evento de reconexão é a única
     * notificação que o navegador dá de que a causa provável da falha deixou de
     * valer. Desligar os dois deixaria a tela parada num dado velho até alguém
     * reparar.
     */
    refetchOnReconnect: true as const,

    /**
     * O resultado anterior fica em tela **enquanto se espera** o novo.
     *
     * Sem isto, trocar de aba de equipamento — que muda a `queryKey` — esvazia
     * a lista e mostra esqueleto. `data` do React Query já sobrevive a um
     * refetch da mesma chave; o que `keepPreviousData` acrescenta é sobreviver
     * à troca de chave.
     *
     * **E só até o erro.** O placeholder vale enquanto o status é `pending`;
     * quando a query falha, o status vira `error` e `data` volta a `undefined`
     * na chave nova. Ou seja: esta opção sozinha **não** cumpre a promessa de
     * preservar a tela numa falha — cobre a espera, não o desfecho. A outra
     * metade é `guardarResposta`, em `resiliencia.ts`, aplicada pelo `ref` de
     * `useConsultaResiliente`; as duas juntas é que fecham o caso. Não é
     * dedução: foi o cenário "dado anterior + falha transitória" de
     * `__tests__/consulta-resiliente.test.ts` que reprovou a versão com só esta
     * linha, e ele ainda afirma o limite (`depois.data` sai `undefined`).
     */
    placeholderData: keepPreviousData,
  };
}
