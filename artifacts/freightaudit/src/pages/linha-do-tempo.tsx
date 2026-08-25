import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { CalendarDays, GitCompareArrows } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, fetchJson } from "@/lib/api";
import { useContextosDaCasca } from "@/lib/contextos";
import { LINHA_DO_TEMPO } from "@/lib/ambiente";
import { cn } from "@/lib/utils";
import { LinhaDoTempoDeImpacto } from "@/components/linha-do-tempo/linha-do-tempo-de-impacto";
import { LinhaDoTempoDeAlteracoes } from "@/components/linha-do-tempo/linha-do-tempo-de-alteracoes";
import { nomeDaUnidade } from "@/lib/recorte";
import { VisaoGeralConteudo } from "@/components/inicio/visao-geral-consolidada";
import type { FamiliesOverview, FamiliesView, SeriesContext } from "@/components/inicio/types";

/**
 * Linha do Tempo — o histórico de vigências da unidade aberta.
 *
 * Tela própria, e não mais um cartão dentro do Resumo executivo: lá o cartão
 * disputava rolagem com os cinco números do instante atual, e aqui a
 * pergunta é outra — como o impacto se moveu vigência a vigência, e o que
 * mudou em cada uma. Cada linha do histórico agora leva até as alterações
 * daquela vigência, o que faltava quando isto era só um cartão de leitura.
 *
 * A unidade e o canal moram na URL, como no Resumo executivo: "Trocar
 * unidade" é o que permite ver a linha do tempo de outra unidade sem sair
 * da tela.
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
    "Visão Geral" é uma opção de unidade — vive no dropdown "Trocar unidade" —
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
  });

  const contextos = useContextosDaCasca();
  const view = visaoGeral ? null : (vigencia.data ?? null);

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

  const periodoOverviewEfetivo =
    parametros.get("period") ?? periodosOverview[periodosOverview.length - 1] ?? null;

  /*
    A Visão Geral aqui soma só o último passo comum — a competência pedida
    contra a vigência imediatamente anterior de cada unidade, o mesmo
    `ExecutiveSummary` que o Resumo executivo já consolida. Não é um
    histórico: é o mesmo `/changes/families/overview`, reaproveitado.
  */
  const overviewQuery = useQuery({
    queryKey: ["families", "overview", periodoOverviewEfetivo],
    enabled: visaoGeral && periodoOverviewEfetivo !== null,
    queryFn: async () => {
      try {
        return await fetchJson<FamiliesOverview>(
          `/changes/families/overview?period=${encodeURIComponent(periodoOverviewEfetivo!)}`,
        );
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
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
        contextos={contextos.contextos}
        onTrocar={trocarPara}
      />

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {visaoGeral ? (
          <>
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
              <VisaoGeralConteudo
                overview={overview}
                search={search}
                onTrocar={trocarPara}
                notaExtra="A Visão Geral aqui soma só o último passo — a competência contra a vigência imediatamente anterior de cada unidade — não o histórico inteiro que a Linha do Tempo de uma unidade mostra."
              />
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
  contextos,
  onTrocar,
}: {
  view: FamiliesView | null;
  overview: FamiliesOverview | null;
  visaoGeral: boolean;
  periodosOverview: string[];
  contextos: SeriesContext[];
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const partes = visaoGeral
    ? overview
      ? [
          `${overview.unitsIncluded.length} de ${overview.unitsIncluded.length + overview.unitsExcluded.length} unidades incluídas`,
        ]
      : []
    : [
        view?.context.channel ?? null,
        view
          ? `${view.periods.length} ${view.periods.length === 1 ? "vigência" : "vigências"} no histórico`
          : null,
      ].filter((p): p is string => p !== null);

  /*
    A competência que "Visão Geral" leva consigo ao ligar — mesma decisão de
    `inicio.tsx`, para a rota de overview nunca receber `period` vazio.
  */
  const periodoAtual = visaoGeral ? (overview?.period ?? null) : (view?.period ?? null);

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
          {contextos.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger className={BOTAO_DE_TROCA}>
                <GitCompareArrows className="w-4 h-4" />
                Trocar unidade
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem
                  onSelect={() =>
                    onTrocar({
                      visaoGeral: "1",
                      scopeHash: null,
                      canal: null,
                      ...(periodoAtual ? { period: periodoAtual } : {}),
                    })
                  }
                  className={cn("flex flex-col items-start gap-0.5", visaoGeral && "font-bold text-brand")}
                >
                  <span className="font-semibold">Visão Geral</span>
                  <span className="text-xs text-muted-foreground">
                    Último passo de todas as unidades com dado na competência
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {contextos.length} unidades com vigência importada
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {contextos.map((contexto) => (
                  <DropdownMenuItem
                    key={`${contexto.scopeHash}|${contexto.channel ?? ""}`}
                    onSelect={() =>
                      onTrocar({
                        scopeHash: contexto.scopeHash,
                        canal: contexto.channel,
                        period: null,
                        visaoGeral: null,
                      })
                    }
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="font-semibold">{nomeDaUnidade(contexto)}</span>
                    <span className="text-xs text-muted-foreground">
                      {contexto.channel ?? "sem canal no rótulo"} · {contexto.periods}{" "}
                      {contexto.periods === 1 ? "vigência" : "vigências"}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {visaoGeral
            ? periodosOverview.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger className={BOTAO_DE_TROCA}>
                    <CalendarDays className="w-4 h-4" />
                    Ir para vigência
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {periodosOverview.length} competências disponíveis
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {periodosOverview.map((data) => (
                      <DropdownMenuItem
                        key={data}
                        onSelect={() => onTrocar({ period: data })}
                        className={cn(data === overview?.period && "font-bold text-brand")}
                      >
                        {data}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )
            : view &&
              view.periods.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger className={BOTAO_DE_TROCA}>
                    <CalendarDays className="w-4 h-4" />
                    Ir para vigência
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {view.periods.length} vigências no histórico
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {[...view.periods]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((periodo) => (
                        <DropdownMenuItem
                          key={periodo.date}
                          onSelect={() => onTrocar({ period: periodo.date })}
                          className={cn(periodo.date === view.period && "font-bold text-brand")}
                        >
                          {periodo.label}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
        </div>
      </div>
    </header>
  );
}

const BOTAO_DE_TROCA =
  "flex items-center gap-2 rounded-lg border border-brand bg-card px-4 py-2.5 " +
  "text-sm font-bold text-brand hover:bg-accent transition-colors";
