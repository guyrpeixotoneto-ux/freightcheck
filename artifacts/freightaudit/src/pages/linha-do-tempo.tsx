import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { ApiError, fetchJson } from "@/lib/api";
import { useContextosDaCasca } from "@/lib/contextos";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { LINHA_DO_TEMPO } from "@/lib/ambiente";
import { opcoesDoIntervalo } from "@/lib/intervalo-da-linha-do-tempo";
import { cn } from "@/lib/utils";
import { LinhaDoTempoDeImpacto } from "@/components/linha-do-tempo/linha-do-tempo-de-impacto";
import { LinhaDoTempoDeAlteracoes } from "@/components/linha-do-tempo/linha-do-tempo-de-alteracoes";
import { LinhaDoTempoConsolidada } from "@/components/linha-do-tempo/linha-do-tempo-consolidada";
import { nomeDaUnidade } from "@/lib/recorte";
import { VisaoGeralConteudo } from "@/components/inicio/visao-geral-consolidada";
import {
  SeletorDeVigencia,
  SeletorDeVigenciaGeral,
} from "@/components/vigencia/seletor-de-vigencia";
import type { FamiliesOverview, FamiliesView } from "@/components/inicio/types";

/**
 * Linha do Tempo — o histórico de vigências da unidade aberta.
 *
 * Tela própria, e não mais um cartão dentro do Resumo executivo: lá o cartão
 * disputava rolagem com os cinco números do instante atual, e aqui a
 * pergunta é outra — como o impacto se moveu vigência a vigência, e o que
 * mudou em cada uma. Cada linha do histórico agora leva até as alterações
 * daquela vigência, o que faltava quando isto era só um cartão de leitura.
 *
 * A unidade e o canal moram na URL, como no Resumo executivo: o seletor da
 * lateral (`components/layout/sidebar.tsx`) é o que permite ver a linha do
 * tempo de outra unidade, ou a Visão Geral, sem sair da tela.
 */
export default function LinhaDoTempo() {
  const search = useSearch();
  const [, navegar] = useLocation();
  const parametros = new URLSearchParams(search);

  const consulta = new URLSearchParams();
  for (const chave of ["period", "scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }
  const sufixo = consulta.toString() ? `?${consulta}` : "";

  /*
    "Visão Geral" é uma opção de unidade — vive no seletor da lateral —
    nunca um valor de `period`. Ver a mesma decisão em `inicio.tsx`.
  */
  const visaoGeral = parametros.get("visaoGeral") === "1";

  const vigencia = useQuery({
    queryKey: ["families", "linha-do-tempo", consulta.toString()],
    enabled: !visaoGeral,
    queryFn: async () => {
      try {
        return await fetchJson<FamiliesView>(`/changes/families${sufixo}`);
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
    /*
      Uma vigência fechada não muda entre duas importações, e esta leitura é a
      primeira de uma cascata: enquanto ela não responde, nada mais desta tela
      pode sair. Sem `staleTime`, voltar para cá refazia a chamada inteira —
      e refazia a espera junto. O minuto é o mesmo das outras leituras da
      tela; uma importação nova invalida a chave, não o relógio.
    */
    staleTime: 60_000,
  });

  const contextos = useContextosDaCasca();
  const view = visaoGeral ? null : (vigencia.data ?? null);

  /*
    O intervalo, pedido antes de a vigência responder.

    `periods` e `currentPeriod` — as duas pontas que `/changes/range` precisa —
    chegam hoje pelo `/changes/families` acima, e é só por isso que a leitura
    do intervalo esperava por ele: duas ondas em série para uma dependência que
    é só de dois valores. Mas esses dois valores já estão em `/contexts`, que a
    casca carrega para montar a lateral e que a esta altura está no cache
    (`periodosDisponiveis`, `latestPeriod`).

    Então a página pergunta na hora, com a mesma chave que os dois cartões vão
    usar (`opcoesDoIntervalo`): quando eles montarem, a resposta já está no
    cache ou a caminho. As duas leituras caras da tela passam a sair juntas em
    vez de uma atrás da outra.

    A régua de resolução é a do servidor, e precisa continuar sendo — uma ponta
    diferente aqui não daria resposta errada, mas viraria uma segunda chamada
    cara em vez de um prefetch aproveitado. Contexto pedido, ou o primeiro da
    lista (o padrão de `resolveContext`); competência pedida só se ela existe
    no histórico daquele contexto, senão a mais recente dele (o padrão de
    `getRangeAnalysis`).
  */
  const cliente = useQueryClient();
  const contextoAberto = useMemo(() => {
    if (visaoGeral || contextos.contextos.length === 0) return null;
    const scopeHash = parametros.get("scopeHash");
    const canal = parametros.get("canal");
    if (scopeHash === null && canal === null) return contextos.contextos[0];
    return (
      contextos.contextos.find(
        (c) =>
          (scopeHash === null || c.scopeHash === scopeHash) &&
          (canal === null || c.channel === canal),
      ) ?? null
    );
  }, [visaoGeral, contextos.contextos, search]);

  const chaveDaConsulta = consulta.toString();
  useEffect(() => {
    if (!contextoAberto) return;
    const historico = contextoAberto.periodosDisponiveis;
    if (historico.length <= 1) return;
    const pedida = parametros.get("period");
    const fim =
      pedida !== null && historico.includes(pedida)
        ? pedida
        : contextoAberto.latestPeriod;
    void cliente.prefetchQuery(
      opcoesDoIntervalo(new URLSearchParams(chaveDaConsulta), historico[0], fim),
    );
    // `chaveDaConsulta` é a forma estável de `consulta`; `parametros` sai dela.
  }, [cliente, contextoAberto, chaveDaConsulta]);

  /*
    A união de competências de todas as unidades — o mesmo cálculo de
    `inicio.tsx`, para "Ir para vigência" oferecer datas que pelo menos uma
    unidade tem, em vez do histórico de uma unidade só.
  */
  const periodosOverview = useMemo(
    () =>
      Array.from(new Set(contextos.contextos.flatMap((c) => c.periodosDisponiveis))).sort(
        (a, b) => b.localeCompare(a),
      ),
    [contextos.contextos],
  );

  /*
    Sem `?period=` abre na competência **mais recente**: `periodosOverview` vem
    em ordem decrescente, e pegar a última da lista abria a tela na competência
    mais antiga do histórico — a que não tem vigência anterior contra a qual ser
    comparada, e por isso não tem alteração nenhuma a mostrar.
  */
  const periodoOverviewEfetivo = parametros.get("period") ?? periodosOverview[0] ?? null;

  /*
    A Visão Geral aqui soma só o último passo comum — a competência pedida
    contra a vigência imediatamente anterior de cada unidade, o mesmo
    `ExecutiveSummary` que o Resumo executivo já consolida. Não é um
    histórico: é o mesmo `/changes/families/overview`, reaproveitado.
  */
  const overviewQuery = useFamiliesOverviewQuery(periodoOverviewEfetivo, {
    enabled: visaoGeral,
  });

  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;

  const trocarPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${LINHA_DO_TEMPO}?${texto}` : LINHA_DO_TEMPO);
  };

  return (
    <Layout>
      <Cabecalho
        view={view}
        overview={overview}
        visaoGeral={visaoGeral}
        periodosOverview={periodosOverview}
        consulta={consulta}
        onTrocar={trocarPara}
      />

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {visaoGeral ? (
          <>
            {/*
              O histórico somado entre unidades vem primeiro, e não depende da
              leitura de competência abaixo: é ele que responde à pergunta que
              traz alguém a esta tela — como o impacto se moveu vigência a
              vigência —, agora também quando a unidade escolhida é "todas".
            */}
            <LinhaDoTempoConsolidada periodos={periodosOverview} ate={periodoOverviewEfetivo} />

            {overviewQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando a Visão Geral…</p>
            )}
            {overviewQuery.error && (
              <ApiErrorNotice
                error={overviewQuery.error}
                what="Não foi possível montar a Visão Geral."
              />
            )}
            {!overviewQuery.isLoading && !overviewQuery.error && overview === null && (
              <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
                Nenhuma unidade tem vigência importada nesta competência.
              </section>
            )}
            {overview && (
              <>
                <div className="pt-2">
                  <h2 className="text-base font-bold leading-tight">
                    A competência aberta, unidade a unidade
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Só o último passo — a competência aberta contra a vigência imediatamente
                    anterior de cada unidade —, para comparar unidade com unidade e entrar no
                    detalhe de uma delas. O histórico inteiro é o da linha do tempo acima.
                  </p>
                </div>
                <VisaoGeralConteudo
                  overview={overview}
                  search={search}
                  onTrocar={trocarPara}
                  notaExtra="Este bloco soma só o último passo — a competência contra a vigência imediatamente anterior de cada unidade. O histórico inteiro está na linha do tempo acima."
                />
              </>
            )}
          </>
        ) : (
          <>
            {vigencia.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando a vigência…</p>
            )}

            {vigencia.error && (
              <ApiErrorNotice error={vigencia.error} what="Não foi possível montar a linha do tempo." />
            )}

            {!vigencia.isLoading && !vigencia.error && view === null && (
              <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
                Nenhuma vigência importada ainda para este recorte.
              </section>
            )}

            {view && (
              <LinhaDoTempoDeImpacto
                consulta={consulta}
                periods={view.periods}
                currentPeriod={view.period}
              />
            )}

            {view && (
              <LinhaDoTempoDeAlteracoes
                consulta={consulta}
                periods={view.periods}
                currentPeriod={view.period}
                onEscolherVigencia={(periodo) => trocarPara({ period: periodo })}
              />
            )}

            {view && view.periods.length <= 1 && (
              <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
                Esta unidade tem uma vigência só no histórico — a linha do tempo
                compara vigência com vigência, e ainda não há com o que comparar.
              </section>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// O cabeçalho
// ---------------------------------------------------------------------------

function Cabecalho({
  view,
  overview,
  visaoGeral,
  periodosOverview,
  consulta,
  onTrocar,
}: {
  view: FamiliesView | null;
  overview: FamiliesOverview | null;
  visaoGeral: boolean;
  periodosOverview: string[];
  consulta: URLSearchParams;
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const partes = visaoGeral
    ? [
        overview
          ? `${overview.unitsIncluded.length} de ${overview.unitsIncluded.length + overview.unitsExcluded.length} unidades incluídas`
          : null,
        /*
          A mesma linha que a unidade traz — "N vigências no histórico" —, aqui
          sobre a união das competências: é o eixo que a linha do tempo
          consolidada percorre.
        */
        periodosOverview.length > 0
          ? `${periodosOverview.length} ${periodosOverview.length === 1 ? "vigência" : "vigências"} no histórico`
          : null,
      ].filter((p): p is string => p !== null)
    : [
        view?.context.channel ?? null,
        view
          ? `${view.periods.length} ${view.periods.length === 1 ? "vigência" : "vigências"} no histórico`
          : null,
      ].filter((p): p is string => p !== null);

  return (
    <header className="px-8 pt-7 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-4 max-w-[1600px]">
        <div className="min-w-0">
          <h1 className="text-[2rem] font-extrabold tracking-tight leading-tight">
            Linha do Tempo — {visaoGeral ? "Visão Geral" : (unidade ?? "")}
          </h1>
          {partes.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1.5">{partes.join(" · ")}</p>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {visaoGeral
            ? (
                <SeletorDeVigenciaGeral
                  periodos={periodosOverview}
                  ativa={overview?.period ?? null}
                  onTrocar={onTrocar}
                  className={BOTAO_DE_TROCA}
                  rotulo="Ir para vigência"
                />
              )
            : (
                <SeletorDeVigencia
                  view={view}
                  consulta={consulta}
                  onTrocar={onTrocar}
                  className={BOTAO_DE_TROCA}
                  rotulo="Ir para vigência"
                />
              )}
        </div>
      </div>
    </header>
  );
}

const BOTAO_DE_TROCA =
  "flex items-center gap-2 rounded-lg border border-brand bg-card px-4 py-2.5 " +
  "text-sm font-bold text-brand hover:bg-accent transition-colors";
