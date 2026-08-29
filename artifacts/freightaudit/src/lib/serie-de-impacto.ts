import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJsonOrNull } from "@/lib/api";
import { impactosDaVigencia, ladosDoImpacto } from "@/lib/visao-geral";
import { opcoesDoIntervaloGeral } from "@/lib/intervalo-da-linha-do-tempo";
import { pontosDeImpacto, type PontoDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import type { FamiliesOverview, FamiliesView } from "@/components/inicio/types";
import type { Movimentos } from "@/lib/analise";

/**
 * A série do gráfico "Impacto das alterações por vigência" — a conta que o
 * Dashboard e o Resumo executivo dividem.
 *
 * As duas telas desenham o mesmo gráfico sobre o mesmo recorte, e a série tem
 * três decisões que não são óbvias (a janela de seis, o intervalo pedido ao
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
): { pontos: PontoDeImpacto[]; periodicity: string | null } {
  /*
    A janela do gráfico — as últimas competências que a própria vigência já
    lista, nunca mais que seis e nunca uma competência que não exista.
  */
  const janela = useMemo(() => {
    if (!view || view.periods.length <= 1) return null;
    return [...view.periods].sort((a, b) => a.date.localeCompare(b.date)).slice(-6);
  }, [view]);

  const chave = consulta.toString();
  const range = useQuery({
    queryKey: ["dashboard-impacto", chave, janela?.[0]?.date ?? "", view?.period ?? ""],
    queryFn: () => {
      const q = new URLSearchParams(chave);
      q.delete("period");
      q.set("from", janela![0].date);
      q.set("to", view!.period);
      return fetchJsonOrNull<Movimentos>(`/changes/range?${q}`);
    },
    enabled: !!view && !!janela,
    staleTime: 60_000,
  });

  const dominante = view ? (impactosDaVigencia(view)[0]?.periodicity ?? null) : null;
  const movimentos = range.data ?? null;

  /*
    As vigências desenhadas são as do **intervalo pedido**, e não todas as que
    o contexto tem: `movimentos.periods` lista o histórico inteiro, e cruzar os
    dois desenhava um ponto `ganhos: 0, perdas: 0` para cada vigência antiga —
    e zero aqui não é "não mudou nada", é "não foi perguntado".
  */
  return useMemo(() => {
    if (!movimentos) return { pontos: [], periodicity: null };
    const ordenadas = movimentos.periods
      .filter((p) => p.date >= movimentos.from && p.date <= movimentos.to)
      .sort((a, b) => a.date.localeCompare(b.date));
    return pontosDeImpacto(ordenadas, movimentos.entries, dominante);
  }, [movimentos, dominante]);
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
    return ate.length > 1 ? ate.slice(-6) : null;
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
