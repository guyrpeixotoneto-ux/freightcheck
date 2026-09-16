import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";
import type { CandidatosDoPar } from "@/lib/candidatos";

/**
 * Quanto se espera a pessoa parar de digitar antes de refazer a pergunta.
 *
 * A busca do Monitor escreve no endereço a cada tecla, e o recorte vai na chave
 * das candidatas: sem espera, "carreta" dispara **sete** rodadas, cada uma
 * podendo custar o orçamento inteiro da rota (oito segundos) vezes o número de
 * candidatas. As seis primeiras são perguntas que ninguém queria fazer — a
 * resposta que interessa é a do texto inteiro.
 *
 * 400ms é a pausa entre palavras de quem digita, e não a pausa entre teclas:
 * curto o bastante para a coluna chegar antes de alguém abrir o menu, longo o
 * bastante para uma palavra inteira contar como um gesto só.
 */
export const ESPERA_DA_BUSCA_MS = 400;

/**
 * UM TEXTO QUE SÓ VALE DEPOIS DA PAUSA — e o aviso de que ele ainda não vale.
 *
 * ---------------------------------------------------------------------------
 * Por que devolve `emTransito`, e por que ele não é opcional
 * ---------------------------------------------------------------------------
 * Porque o adiamento cria uma janela em que o menu **sabe** que o que tem na
 * mão não responde mais à pergunta da tela: o recorte já mudou, os números são
 * do anterior. Um debounce que só atrasasse a consulta deixaria esses números
 * em tela durante a janela, e eles estariam errados — não desatualizados, e sim
 * respondendo outra pergunta. É exatamente o defeito que mandar o recorte junto
 * existe para não ter.
 *
 * Com `emTransito`, a janela vira esqueleto: quem chama passa `undefined` no
 * lugar dos dados e `true` no carregamento, e a linha diz *está vindo* em vez
 * de dizer um número. É a mesma régua de `numerosDaLinha` — ausência de
 * cálculo nunca se escreve com número —, aplicada ao caso em que o cálculo
 * existe mas é de outro recorte.
 *
 * O primeiro valor entra sem espera: abrir a tela com um filtro no endereço não
 * é alguém digitando.
 */
export function useTextoAdiado(texto: string, espera = ESPERA_DA_BUSCA_MS) {
  const [adiado, setAdiado] = useState(texto);

  useEffect(() => {
    if (adiado === texto) return;
    const id = setTimeout(() => setAdiado(texto), espera);
    return () => clearTimeout(id);
  }, [texto, espera, adiado]);

  return { valor: adiado, emTransito: adiado !== texto };
}

/**
 * As telas que têm rota de candidatas — o prefixo é o caminho dela.
 *
 * Eram três, e chamavam-se `RubricaComCandidatas` porque as três eram rubricas.
 * O Monitor Custo Fixo não é uma: ele lê os quatro módulos de uma vez, e a rota
 * dele aceita os filtros da tela junto (`opcoes.filtros`). O nome mudou com o
 * conjunto — um tipo chamado "rubrica" com o Monitor dentro obrigaria quem lê a
 * lembrar que a palavra não vale para um dos membros.
 *
 * KM Rodado e Velocidade Média entraram depois, e o grão delas é **trecho** e
 * não veículo. Para esta lista isso não muda nada: o que a define é ter rota de
 * candidatas, e as duas têm — a contagem e o impacto saem das mesmas funções
 * que a tela chama depois do clique.
 */
export type TelaComCandidatas =
  | "finame"
  | "ipva"
  | "lucro-fixo"
  | "impostos"
  | "monitor-custo-fixo"
  | "monitor-equipe"
  | "km-rodado"
  | "velocidade-media"
  | "tma"
  | "qlp";

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
  tela: TelaComCandidatas,
  para: string,
  escopo: string | null,
  /**
   * O recorte que a tela está mostrando, já em `querystring`.
   *
   * O Monitor manda os filtros da tela; o QLP manda o quadro (obrigatório, é o
   * que separa administrativo de operacional) e a rubrica aberta, quando há
   * uma.
   *
   * Vai na chave da consulta pela razão que a rota documenta: o número do menu
   * tem de ser o número que o clique entrega. Com filtro ligado e sem isto, o
   * menu prometeria "457 alterações" ao lado de uma vigência que, escolhida,
   * mostraria zero — e a tela teria duas réguas para a mesma pergunta.
   */
  filtros = "",
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
    queryKey: [tela, "candidatos", escopo, para, filtros],
    enabled: Boolean(para),
    staleTime: 5 * 60_000,
    queryFn: () =>
      fetchJson<CandidatosDoPar>(
        `/${tela}/candidatos?para=${para}${filtros ? `&${filtros}` : ""}`,
      ),
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
