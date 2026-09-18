import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJsonOrNull } from "@/lib/api";
import { impactosDaVigencia, ladosDoImpacto } from "@/lib/visao-geral";
import { opcoesDoIntervaloGeral } from "@/lib/intervalo-da-linha-do-tempo";
import { LEITURA_DE_APURACAO } from "@/lib/frescor-das-leituras";
import { contextoAberto, useContextosDaCasca } from "@/lib/contextos";
import {
  TETO_DA_SERIE,
  pontosDeImpacto,
  type PontoDeImpacto,
} from "@/components/dashboard/grafico-de-impacto";
import type { FamiliesOverview, FamiliesView } from "@/components/inicio/types";
import type { Movimentos } from "@/lib/analise";
import type { PeriodicidadeApurada } from "@workspace/comparison/contrato-de-impacto";

/**
 * As opções da consulta de um intervalo — **a chave escrita uma vez**.
 *
 * Quem lê um intervalo desta série são dois: o gráfico, que carrega a janela
 * inteira (`TETO_DA_SERIE`) para o seletor recortar sem ir ao servidor, e o
 * cartão da janela no Panorama, que precisa do rollup por parâmetro **do
 * recorte desenhado** — o servidor soma o rollup sobre o intervalo pedido, e
 * não há como cortá-lo no navegador (o rollup traz o total de cada parâmetro,
 * não a fatia dele por vigência).
 *
 * Com a chave numa função só, os dois se encontram no cache sempre que pedem o
 * mesmo intervalo — janela desenhada igual à carregada é **zero** requisição —,
 * e quando diferem é uma consulta a mais, de um minuto de validade, disparada
 * depois do conteúdo principal. Escrita duas vezes, bastaria uma delas mudar de
 * formato para as duas leituras passarem a falar de janelas diferentes sem que
 * nada acusasse.
 *
 * A chave começa em `changes-range` de propósito: é o prefixo que
 * `invalidarApuracao` alcança (`lib/frescor-das-leituras.ts`), e é ele que
 * sustenta o `staleTime` de `LEITURA_DE_APURACAO` — nenhum cache entra aqui sem
 * a invalidação que o corrige quando a apuração muda.
 */
export function opcoesDoIntervalo(chave: string, de: string | null, ate: string | null) {
  return {
    queryKey: ["changes-range", "dashboard-impacto", chave, de ?? "", ate ?? ""],
    queryFn: () => {
      const q = new URLSearchParams(chave);
      q.delete("period");
      q.set("from", de!);
      q.set("to", ate!);
      return fetchJsonOrNull<Movimentos>(`/changes/range?${q}`);
    },
    ...LEITURA_DE_APURACAO,
  };
}

/**
 * A série do gráfico "Impacto das alterações por vigência" — a conta que o
 * Dashboard e o Resumo executivo dividem.
 *
 * As duas telas desenham o mesmo gráfico sobre o mesmo recorte, e a série tem
 * três decisões que não são óbvias (a janela carregada, o intervalo pedido ao
 * servidor, e a periodicidade que manda no eixo). Escrita duas vezes, bastaria
 * uma delas mudar de janela para as duas telas passarem a mostrar gráficos
 * diferentes do mesmo dado, lado a lado no mesmo menu — sem que nada acuse a
 * divergência.
 *
 * A chave da consulta também é uma só, e é isso que faz a segunda tela abrir
 * com o gráfico pronto: quem vem do Dashboard para o Resumo executivo (ou o
 * contrário) encontra a resposta no cache em vez de esperar a mesma varredura
 * de novo.
 */
export function useSerieDeImpacto(
  view: FamiliesView | null,
  consulta: URLSearchParams,
  /*
    Se esta leitura é a que a tela mostra.

    `view === null` quer dizer duas coisas opostas — "a vigência ainda não
    chegou" e "a tela está na Visão Geral, e esta série não é a dela" —, e
    enquanto a janela vinha de `view` as duas davam no mesmo: sem `view`, sem
    consulta. Agora que a janela vem de `/contexts`, a Visão Geral passaria a
    buscar o intervalo da primeira unidade da lista, que não é o que ela
    desenha. Quem chama diz qual dos dois casos é o seu.
  */
  habilitado = true,
  /**
   * A grandeza que a pessoa escolheu no gráfico — `null` enquanto ela não
   * escolheu nada.
   *
   * Ela entra como **preferência**, e não como imposição: uma escolha que o
   * recorte aberto não tem (trocou-se de unidade depois de escolher R$/ano) cai
   * na régua do contrato em vez de esvaziar o gráfico.
   */
  periodicidadeEscolhida: string | null = null,
): {
  pontos: PontoDeImpacto[];
  periodicity: string | null;
  /** As grandezas do recorte desenhado — para o seletor do gráfico. */
  disponiveis: PeriodicidadeApurada[];
  carregando: boolean;
  /**
   * A resposta crua do intervalo — para quem precisa do **rollup da janela**, e
   * não só dos pontos do gráfico.
   *
   * Ela já vinha nesta consulta: `Movimentos.byParameter` soma cada parâmetro
   * ao longo das vigências lidas, e é a única leitura do produto que responde
   * "quem vem puxando o resultado" em vez de "quanto pesou nesta competência".
   * Devolvê-la aqui é o que permite ao Panorama desenhar o cartão da janela ao
   * lado do gráfico **sem uma segunda ida ao servidor** — a alternativa era
   * repetir a chave de cache noutro lugar, e duas chamadoras da mesma chave é
   * onde as duas começam a divergir sobre qual janela estão lendo.
   */
  movimentos: Movimentos | null;
} {
  /*
    De onde saem as vigências da janela — e por que não de `view`.

    A janela é "as últimas `TETO_DA_SERIE` vigências desta unidade até a que
    está aberta", e essa lista existe em dois lugares: dentro de `view`
    (`/changes/families`, a leitura pesada da vigência) e dentro de
    `/contexts` (`periodosDisponiveis`), que a casca já leu antes de a página
    montar e mantém em cache.

    Lendo de `view`, o gráfico só começava a buscar depois que
    `/changes/families` respondia — duas idas ao servidor em fila, e o gráfico
    aparecendo sempre uma resposta inteira depois do resto da tela. Lendo de
    `/contexts`, as duas partem juntas: o intervalo é o mesmo, e quem o conhece
    primeiro é quem já está em memória.

    `view` continua mandando quando chega, porque é ela quem diz qual vigência
    a tela de fato abriu — pedir um `period` que a unidade não tem faz o
    servidor cair na mais recente dela, e o gráfico tem de terminar onde a tela
    terminou. No caminho normal os dois concordam, a chave não muda, e a
    resposta já buscada continua valendo.
  */
  const { contextos } = useContextosDaCasca();
  const contexto = contextoAberto(contextos, consulta.get("scopeHash"));

  const vigencias = useMemo(
    () => (view ? view.periods.map((p) => p.date) : (contexto?.periodosDisponiveis ?? [])),
    [view, contexto],
  );
  const ate = view?.period ?? consulta.get("period") ?? contexto?.latestPeriod ?? null;

  /*
    A janela carregada — as últimas competências até a aberta, nunca mais que
    `TETO_DA_SERIE`. Quantas dessas vão para a tela é escolha do seletor do
    gráfico.

    O corte em `ate` é o mesmo que a Visão Geral faz logo abaixo: sem ele, uma
    vigência antiga aberta pelo próprio gráfico pedia um intervalo que começava
    **depois** de onde terminava.
  */
  const janela = useMemo(() => {
    if (!habilitado || ate === null) return null;
    const ordenadas = [...vigencias].sort((a, b) => a.localeCompare(b)).filter((d) => d <= ate);
    return ordenadas.length > 1 ? ordenadas.slice(-TETO_DA_SERIE) : null;
  }, [habilitado, vigencias, ate]);

  const chave = consulta.toString();
  const range = useQuery({
    ...opcoesDoIntervalo(chave, janela?.[0] ?? null, ate),
    /*
      A política de frescor vem de `opcoesDoIntervalo`: o minuto de `staleTime`
      faz voltar a uma unidade já vista desenhar o gráfico no primeiro quadro, e
      o `placeholderData` faz a troca de unidade manter o gráfico anterior em
      tela em vez de apagá-lo.
    */
    enabled: habilitado && janela !== null && ate !== null,
  });

  const dominante = view ? (impactosDaVigencia(view)[0]?.periodicity ?? null) : null;
  const movimentos = range.data ?? null;

  /*
    "Ainda não chegou" e "não há o que desenhar" são respostas diferentes, e
    quem desenha precisa distinguir as duas: sem este sinal o gráfico escrevia
    "Nenhuma alteração valorada no intervalo recente" durante toda a espera —
    uma afirmação sobre o dado, feita antes de o dado existir.

    `isPlaceholderData` entra junto: o que está em tela é o gráfico do recorte
    anterior, e ele é tão "ainda não chegou" quanto o vazio.
  */
  const carregando = habilitado && (range.isLoading || range.isPlaceholderData);

  /*
    As vigências desenhadas são as do **intervalo pedido**, e não todas as que
    o contexto tem: `movimentos.periods` lista o histórico inteiro, e cruzar os
    dois desenhava um ponto `ganhos: 0, perdas: 0` para cada vigência antiga —
    e zero aqui não é "não mudou nada", é "não foi perguntado".
  */
  const serie = useMemo(() => {
    if (!movimentos) return { pontos: [], periodicity: null, disponiveis: [] };
    const ordenadas = movimentos.periods
      .filter((p) => p.date >= movimentos.from && p.date <= movimentos.to)
      .sort((a, b) => a.date.localeCompare(b.date));
    /*
      A escolha da pessoa manda sobre a da vigência — e as duas são
      preferências, resolvidas pela mesma régua do contrato lá dentro.
    */
    return pontosDeImpacto(
      ordenadas,
      movimentos.entries,
      periodicidadeEscolhida ?? dominante,
    );
  }, [movimentos, dominante, periodicidadeEscolhida]);

  return { ...serie, carregando, movimentos };
}

/**
 * O intervalo **desenhado** — o rollup por parâmetro do que o gráfico mostra.
 *
 * O seletor do gráfico (3 · 6 · 12 vigências ou meses) recorta o que já veio;
 * este hook pede ao servidor o rollup daquele recorte, porque rollup não se
 * corta no navegador. Quando o recorte desenhado coincide com o carregado — o
 * caso de quem tem menos vigências que o teto da série —, a chave é a mesma da
 * consulta do gráfico e nada sai para a rede.
 *
 * `null` em `de` é "ainda não sei qual é a janela": sem pontos desenhados não há
 * recorte a pedir, e a consulta fica desligada em vez de pedir o intervalo
 * inteiro e publicá-lo como se fosse o do gráfico.
 */
export function useJanelaDesenhada(
  consulta: URLSearchParams,
  de: string | null,
  ate: string | null,
  habilitado: boolean,
): { movimentos: Movimentos | null; carregando: boolean } {
  const chave = consulta.toString();
  const range = useQuery({
    ...opcoesDoIntervalo(chave, de, ate),
    enabled: habilitado && de !== null && ate !== null,
  });

  return {
    movimentos: range.data ?? null,
    carregando: habilitado && (range.isLoading || range.isPlaceholderData),
  };
}

/**
 * A mesma série em Visão Geral — somada entre unidades.
 *
 * A janela sai das competências que **alguma** unidade entregou, e nunca do
 * histórico de uma unidade só: a Visão Geral não tem uma unidade a quem
 * perguntar, e usar a primeira da lista faria o eixo depender de quem chegou
 * primeiro no banco. Termina na competência aberta — competência posterior à
 * que a tela mostra não entra num gráfico que fala dela.
 *
 * O intervalo lido é o histórico inteiro, e não a janela: é a mesma leitura
 * que o menu "Trocar vigência" faz para contar as alterações de cada
 * competência, e ler as duas pontas faz das duas uma requisição só. O recorte
 * para a janela acontece aqui embaixo.
 */
export function useSerieDeImpactoGeral(
  periodosOverview: string[],
  periodoAberto: string | null,
  overview: FamiliesOverview | null,
  habilitado: boolean,
): PontoDeImpacto[] {
  const janela = useMemo(() => {
    if (!habilitado || periodoAberto === null) return null;
    const ate = [...periodosOverview]
      .sort((a, b) => a.localeCompare(b))
      .filter((data) => data <= periodoAberto);
    return ate.length > 1 ? ate.slice(-TETO_DA_SERIE) : null;
  }, [habilitado, periodosOverview, periodoAberto]);

  const range = useQuery({
    ...opcoesDoIntervaloGeral(
      periodosOverview[periodosOverview.length - 1] ?? null,
      periodosOverview[0] ?? null,
    ),
    enabled: habilitado && periodosOverview.length > 1,
  });

  /*
    A periodicidade é a dominante da soma — a mesma que manda no cartão de
    Impacto líquido acima do gráfico. Sem esse acordo o gráfico desenharia
    R$/ano embaixo de um número em R$/mês, que é a mistura de escala que o
    produto recusa em toda tela.
  */
  const pontos = range.data?.serie;
  return useMemo(() => {
    const dominante = ladosDoImpacto(overview)[0]?.periodicity ?? null;
    if (!dominante || !pontos || !janela) return [];
    const naJanela = new Set(janela);
    return pontos
      .filter((ponto) => naJanela.has(ponto.period))
      .map((ponto) => {
        const lado = ponto.byPeriodicity[dominante] ?? { gains: 0, losses: 0 };
        return {
          periodo: ponto.period,
          label: ponto.label,
          ganhos: lado.gains,
          perdas: lado.losses,
          liquido: Number((lado.gains + lado.losses).toFixed(2)),
        };
      });
  }, [pontos, overview, janela]);
}
