import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";
import type { CandidatosDoPar } from "@/lib/candidatos";

/** As rubricas que têm rota de candidatas — o prefixo é o nome dela. */
export type RubricaComCandidatas = "finame" | "ipva" | "lucro-fixo";

/**
 * Quanto se espera entre uma rodada e a seguinte enquanto ainda há pendente.
 *
 * Curto de propósito. Cada rodada custa ao servidor até o orçamento dele
 * (`ORCAMENTO_DE_CANDIDATAS_MS`, oito segundos), então o que se economiza
 * esperando mais aqui é ruído perto do que a conta já leva — e o que se perde é
 * exatamente o que esta tela promete: a fila terminar antes de alguém abrir o
 * menu. Com um segundo e meio entre rodadas, um histórico de seis vigências
 * levava quase dez segundos só em espera parada.
 */
export const ESPERA_ENTRE_RODADAS_MS = 300;

/** Quantas respostas sem progresso ainda merecem uma tentativa, com recuo. */
export const RODADAS_SEM_ANDAR = 3;

/**
 * OS NÚMEROS DE CADA CANDIDATA A "DE" — a pergunta e a cadência dela.
 *
 * ---------------------------------------------------------------------------
 * Por que isto é um hook e não três blocos iguais nas três telas
 * ---------------------------------------------------------------------------
 * Porque era isso que havia: FINAME, IPVA e Lucro Fixo repetiam o mesmo
 * `useQuery`, o mesmo `staleTime` e o mesmo `refetchInterval`, cada um com um
 * comentário dizendo que era de propósito que fossem iguais. Um comentário não
 * segura três cópias: a primeira correção de cadência que alguém fizesse numa
 * delas deixaria as outras duas respondendo com outro fôlego à mesma pergunta,
 * e nada na tela diria por quê. Agora a cadência é uma, e mudá-la é mudar um
 * arquivo.
 *
 * O que varia entre as três é só o prefixo da rota, e ele entra por parâmetro.
 *
 * ---------------------------------------------------------------------------
 * As três decisões
 * ---------------------------------------------------------------------------
 * **A pergunta sai assim que há um "Para".** `enabled` não conhece menu nenhum:
 * ninguém precisa abrir o seletor para o cálculo começar. Esperar o clique fazia
 * o menu abrir com um esqueleto cinza em cada linha e os números entrarem
 * debaixo do cursor de quem já estava escolhendo — a coluna existe para decidir
 * a escolha, e chegar depois dela é chegar tarde.
 *
 * **A chave carrega o "Para" e a unidade.** Trocar qualquer um dos dois é uma
 * pergunta nova, então é chave nova: a consulta refaz-se sozinha, e não há
 * invalidação manual a esquecer. É o que faz o número ao lado de junho mudar
 * quando o "Para" vai de agosto para julho, e a coluna inteira trocar quando a
 * lateral troca de unidade. Voltar para uma combinação já vista dentro do
 * `staleTime` reaproveita o que está no cache, sem chamada nova.
 *
 * **A fila é drenada até o fim.** O servidor calcula o que couber no orçamento
 * dele e diz quantas ficaram de fora; enquanto houver pendente, pergunta-se de
 * novo, e a rodada seguinte continua de onde a anterior parou porque o que foi
 * calculado ficou gravado. O que **não** se faz é desistir na primeira resposta
 * que não andou: a rota calcula pelo menos uma candidata por chamada, então uma
 * fila parada é sinal de aperto momentâneo, não de fila eterna — daí o recuo
 * (`RODADAS_SEM_ANDAR` tentativas, cada uma esperando o dobro da anterior)
 * antes de encerrar. Desistir na primeira era o que deixava linhas sem número
 * nenhum para sempre, que é o estado em que o menu mente por omissão.
 */
export function useCandidatosDoPar(
  rubrica: RubricaComCandidatas,
  para: string,
  escopo: string | null,
) {
  /**
   * A régua do progresso — por resposta, e não por renderização.
   *
   * `refetchInterval` é reavaliado a cada render do observador, e não só quando
   * uma resposta chega: um contador incrementado direto aqui dentro subiria
   * sozinho enquanto o usuário rola a tela, e a fila seria encerrada por
   * movimento do mouse. `marca` é o `dataUpdatedAt` da resposta que produziu a
   * decisão; enquanto ele não muda, a decisão é a mesma de antes.
   */
  const progresso = useRef<{
    marca: number;
    chave: string;
    pendentes: number;
    semAndar: number;
    intervalo: number | false;
  } | null>(null);

  return useQuery({
    queryKey: [rubrica, "candidatos", escopo, para],
    enabled: Boolean(para),
    staleTime: 5 * 60_000,
    queryFn: () => fetchJson<CandidatosDoPar>(`/${rubrica}/candidatos?para=${para}`),
    refetchInterval: (query) => {
      const dados = query.state.data;
      if (!dados || dados.pendentes === 0) {
        progresso.current = null;
        return false;
      }

      const marca = query.state.dataUpdatedAt;
      const chave = JSON.stringify(query.queryKey);
      const anterior = progresso.current;
      if (anterior && anterior.marca === marca && anterior.chave === chave) {
        return anterior.intervalo;
      }

      const mesmaPergunta = anterior?.chave === chave;
      const semAndar =
        mesmaPergunta && dados.pendentes >= anterior!.pendentes ? anterior!.semAndar + 1 : 0;
      const intervalo =
        semAndar > RODADAS_SEM_ANDAR ? false : ESPERA_ENTRE_RODADAS_MS * 2 ** semAndar;

      progresso.current = { marca, chave, pendentes: dados.pendentes, semAndar, intervalo };
      return intervalo;
    },
  });
}
