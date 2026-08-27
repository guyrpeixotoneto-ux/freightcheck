import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronDown,
  Clock,
  FileText,
  Gauge,
  GitCompareArrows,
  LayoutDashboard,
  LayoutGrid,
  ReceiptText,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Truck,
  Tv,
  type LucideIcon,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, fetchJson, fetchJsonOrNull } from "@/lib/api";
import { useContextosDaCasca } from "@/lib/contextos";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { DASHBOARD, GESTAO_A_VISTA } from "@/lib/ambiente";
import { cn } from "@/lib/utils";
import { formatBrlShort, formatPercent, formatValue, periodicitySuffix } from "@/lib/format";
import {
  escreverImpacto,
  frotaTotal,
  impactosDaVigencia,
  ladosDoImpacto,
  type Impacto,
  type LadosDoImpacto,
} from "@/lib/visao-geral";
import { juntarPrioridades } from "@/lib/cockpit";
import { lerRecorte, linkDeAlteracoes, nomeDaUnidade, type Recorte } from "@/lib/recorte";
import { unidadesPorImpacto } from "@/components/inicio/visao-geral-consolidada";
import { Sparkline } from "@/components/dashboard/sparkline";
import { AnelDeCobertura } from "@/components/dashboard/anel-de-cobertura";
import { GraficoDeImpacto, pontosDeImpacto, type PontoDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import { iconeDaAlteracao } from "@/components/dashboard/icone-da-alteracao";
import { SeletorDeVigencia } from "@/components/vigencia/seletor-de-vigencia";
import type {
  ChangeGroup,
  FamiliesOverview,
  FamiliesView,
  OverviewContextRef,
  SeriesContext,
} from "@/components/inicio/types";
import type { Movimentos, RangeOverview } from "@/lib/analise";

/**
 * O Dashboard — a tela de vigilância: o que a Ambev mudou, e o que isso custou.
 *
 * A informação está ordenada pela pergunta que ela responde, na ordem em que
 * um executivo faria as perguntas: o que mudou (a faixa fina do topo), quanto
 * isso custou (os quatro indicadores, com o líquido em destaque), onde
 * aconteceu (o gráfico de impacto por competência e o pódio de maiores
 * impactos) e o que precisa de atenção agora (a tabela de alterações, a
 * movimentação da frota e a faixa de qualidade da apuração, por último e nunca
 * competindo com o financeiro pelo olho de quem abre a tela).
 *
 * A Visão Geral desenha exatamente este mesmo corpo, com os números de todas
 * as unidades somados no servidor (`FamiliesOverview.consolidado`) e o
 * ranking de unidades a mais. Trocar de unidade para "Visão Geral" muda o
 * recorte, nunca a forma da tela — foi o defeito da primeira versão, onde a
 * Visão Geral mostrava quatro cartões e o resto abria só dentro de uma
 * unidade.
 *
 * Nada aqui reimplementa a apuração: os indicadores somam `summary.sides`, a
 * tabela lê a mesma fila de prioridade do Acompanhamento (`juntarPrioridades`,
 * `lib/cockpit.ts`), o gráfico de impacto lê a mesma série de `/changes/range`
 * que a antiga linha do tempo lia (`seriesDoIntervalo`), e o pódio de maiores
 * impactos lê `view.families` — os mesmos campos que `lib/visao-geral.ts` já
 * sabia explicar antes desta tela existir.
 *
 * Um princípio que atravessa a tela inteira: **tudo aqui é medido, nada é
 * previsto**. Não existe "projetado em 12 meses" em lugar nenhum — anualizar
 * o líquido de uma competência só multiplicaria uma medida por doze e chamaria
 * o resultado de outra coisa. O que a tela não tem dado honesto para dizer,
 * ela omite — nunca aproxima.
 */
export default function Dashboard() {
  const search = useSearch();
  const [, navegar] = useLocation();
  const parametros = new URLSearchParams(search);

  const consulta = new URLSearchParams();
  for (const chave of ["period", "scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }
  const sufixo = consulta.toString() ? `?${consulta}` : "";
  const visaoGeral = parametros.get("visaoGeral") === "1";

  const vigencia = useQuery({
    queryKey: ["families", "dashboard", consulta.toString()],
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

  const view = visaoGeral ? null : (vigencia.data ?? null);
  const contextos = useContextosDaCasca();

  const periodosOverview = useMemo(
    () =>
      Array.from(new Set(contextos.contextos.flatMap((c) => c.periodosDisponiveis))).sort(
        (a, b) => b.localeCompare(a),
      ),
    [contextos.contextos],
  );

  const periodoOverviewEfetivo =
    parametros.get("period") ?? periodosOverview[periodosOverview.length - 1] ?? null;

  const overviewQuery = useFamiliesOverviewQuery(periodoOverviewEfetivo, {
    enabled: visaoGeral,
  });

  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;
  const recorte = lerRecorte(search);

  // O relógio da faixa fina — a mesma leitura da Gestão à Vista
  // (`dataUpdatedAt` da própria consulta, nunca `new Date()` fabricado no
  // cliente): ele diz quando os dados foram de fato buscados, e não a hora
  // agora.
  const atualizadoEm = visaoGeral ? overviewQuery.dataUpdatedAt : vigencia.dataUpdatedAt;

  // A janela do gráfico de impacto — as últimas competências que a própria
  // vigência já lista, nunca mais que seis e nunca uma competência que não
  // exista.
  const janela = useMemo(() => {
    if (!view || view.periods.length <= 1) return null;
    const ordenadas = [...view.periods].sort((a, b) => a.date.localeCompare(b.date));
    return ordenadas.slice(-6);
  }, [view]);

  /*
    A mesma janela em Visão Geral, tirada das competências que **alguma**
    unidade entregou (`periodosOverview`) e nunca do histórico de uma unidade
    só: a Visão Geral não tem uma unidade a quem perguntar, e usar a primeira
    da lista faria o eixo do gráfico depender de quem chegou primeiro no
    banco. Termina na competência aberta — competência posterior à que a tela
    está mostrando não entra num gráfico que fala dela.
  */
  const janelaGeral = useMemo(() => {
    if (!visaoGeral || periodoOverviewEfetivo === null) return null;
    const ate = [...periodosOverview]
      .sort((a, b) => a.localeCompare(b))
      .filter((data) => data <= periodoOverviewEfetivo);
    return ate.length > 1 ? ate.slice(-6) : null;
  }, [visaoGeral, periodosOverview, periodoOverviewEfetivo]);

  const rangeGeralQuery = useQuery({
    queryKey: ["dashboard-impacto-geral", janelaGeral?.[0] ?? "", periodoOverviewEfetivo ?? ""],
    queryFn: () => {
      const q = new URLSearchParams({ from: janelaGeral![0], to: periodoOverviewEfetivo! });
      return fetchJsonOrNull<RangeOverview>(`/changes/range/overview?${q}`);
    },
    enabled: visaoGeral && !!janelaGeral && periodoOverviewEfetivo !== null,
    staleTime: 60_000,
  });

  /*
    A série do gráfico em Visão Geral, na periodicidade dominante da soma —
    a mesma que manda no cartão de Impacto líquido logo acima dele. Sem esse
    acordo o gráfico desenharia R$/ano embaixo de um número em R$/mês, que é
    a mistura de escala que o produto recusa em toda tela.
  */
  const serieGeral = useMemo<PontoDeImpacto[]>(() => {
    const dominante = ladosDoImpacto(overview)[0]?.periodicity ?? null;
    const pontos = rangeGeralQuery.data?.serie;
    if (!dominante || !pontos || !janelaGeral) return [];
    const naJanela = new Set(janelaGeral);
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
  }, [rangeGeralQuery.data, overview, janelaGeral]);

  const rangeQuery = useQuery({
    queryKey: ["dashboard-impacto", consulta.toString(), janela?.[0]?.date ?? "", view?.period ?? ""],
    queryFn: () => {
      const q = new URLSearchParams(consulta);
      q.delete("period");
      q.set("from", janela![0].date);
      q.set("to", view!.period);
      return fetchJsonOrNull<Movimentos>(`/changes/range?${q}`);
    },
    enabled: !visaoGeral && !!view && !!janela,
    staleTime: 60_000,
  });

  const trocarPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${DASHBOARD}?${texto}` : DASHBOARD);
  };

  // O mesmo recorte que a tela está mostrando, levado para a Gestão à Vista —
  // o telão abre sobre o que esta tela já abriu, nunca sobre outra escolha.
  const paraGestaoAVista = consulta.toString() ? `${GESTAO_A_VISTA}?${consulta}` : GESTAO_A_VISTA;

  return (
    <Layout>
      <Cabecalho
        view={view}
        overview={overview}
        visaoGeral={visaoGeral}
        periodosOverview={periodosOverview}
        contextos={contextos.contextos}
        consulta={consulta}
        onTrocar={trocarPara}
        paraGestaoAVista={paraGestaoAVista}
      />

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {visaoGeral ? (
          <>
            {overviewQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando o Dashboard…</p>
            )}
            {overviewQuery.error && (
              <ApiErrorNotice error={overviewQuery.error} what="Não foi possível montar o Dashboard." />
            )}
            {!overviewQuery.isLoading && !overviewQuery.error && overview === null && <BancoVazio />}
            {overview && (
              <ConteudoGeral
                overview={overview}
                atualizadoEm={atualizadoEm}
                onTrocar={trocarPara}
                serie={serieGeral}
              />
            )}
          </>
        ) : (
          <>
            {vigencia.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando a vigência…</p>
            )}
            {vigencia.error && (
              <ApiErrorNotice error={vigencia.error} what="Não foi possível montar o Dashboard." />
            )}
            {!vigencia.isLoading && !vigencia.error && view === null && <BancoVazio />}
            {view && (
              <ConteudoDaUnidade
                view={view}
                recorte={recorte}
                atualizadoEm={atualizadoEm}
                movimentos={rangeQuery.data ?? null}
              />
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

const CARTAO = "bg-card border rounded-xl shadow-sm";

// ---------------------------------------------------------------------------
// O cabeçalho
// ---------------------------------------------------------------------------

function Cabecalho({
  view,
  overview,
  visaoGeral,
  periodosOverview,
  contextos,
  consulta,
  onTrocar,
  paraGestaoAVista,
}: {
  view: FamiliesView | null;
  overview: FamiliesOverview | null;
  visaoGeral: boolean;
  periodosOverview: string[];
  contextos: SeriesContext[];
  consulta: URLSearchParams;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  paraGestaoAVista: string;
}) {
  const unidade = view ? nomeDaUnidade(view.context) : null;
  const periodoAtual = visaoGeral ? (overview?.period ?? null) : (view?.period ?? null);

  return (
    <header className="px-8 pt-7 pb-2">
      <div className="flex flex-wrap items-start justify-between gap-4 max-w-[1600px]">
        <div className="min-w-0">
          <h1 className="text-[2rem] font-extrabold tracking-tight leading-tight">
            Dashboard — {visaoGeral ? "Visão Geral" : (unidade ?? "")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            O que a Ambev mudou nesta competência, e quanto isso custou.
          </p>
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
                    Soma de todas as unidades com dado na competência
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
                    Trocar vigência
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
            : (
                <SeletorDeVigencia
                  view={view}
                  consulta={consulta}
                  onTrocar={onTrocar}
                  className={BOTAO_DE_TROCA}
                />
              )}

          {/*
            O botão da Gestão à Vista é o único cheio desta tela — a mesma
            régua de `pages/inicio.tsx`, que reserva a cor sólida da marca para
            a ação que a tela existe para oferecer. Agora abre um menu porque a
            Gestão à Vista tem mais de um template: o Financeiro (o telão escuro
            de sempre), o Alertas (a tabela clara de unidades, por competência) e
            o Radar (a grade unidade × vigência, com o impacto de cada célula).
          */}
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-brand-foreground hover:opacity-90 transition-opacity">
              <Tv className="w-4 h-4" />
              Gestão à Vista
              <ChevronDown className="w-3.5 h-3.5 opacity-80" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Escolha o template
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={comTemplate(paraGestaoAVista, "financeiro")} className="flex items-start gap-2.5">
                  <LayoutDashboard className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <span className="block font-semibold">Financeiro</span>
                    <span className="block text-xs text-muted-foreground">
                      O telão completo: impacto, ranking, pendências e tendência.
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={comTemplate(paraGestaoAVista, "alertas")} className="flex items-start gap-2.5">
                  <Bell className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <span className="block font-semibold">Alertas</span>
                    <span className="block text-xs text-muted-foreground">
                      Tabela por unidade: alterações, impacto e a que teve mais mudança.
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={comTemplate(paraGestaoAVista, "radar")} className="flex items-start gap-2.5">
                  <LayoutGrid className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <span className="block font-semibold">Radar</span>
                    <span className="block text-xs text-muted-foreground">
                      Grade unidade × vigência: quando cada uma mexeu e quanto custou.
                    </span>
                  </span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

/** Anexa `?template=` (ou acrescenta, se já houver uma consulta) ao link da Gestão à Vista. */
function comTemplate(
  paraGestaoAVista: string,
  template: "financeiro" | "alertas" | "radar",
): string {
  const [caminho, consulta] = paraGestaoAVista.split("?");
  const parametros = new URLSearchParams(consulta);
  parametros.set("template", template);
  return `${caminho}?${parametros}`;
}

const BOTAO_DE_TROCA =
  "flex items-center gap-2 rounded-lg border border-brand bg-card px-4 py-2.5 " +
  "text-sm font-bold text-brand hover:bg-accent transition-colors";

function BancoVazio() {
  return (
    <div className={cn(CARTAO, "px-6 py-10 text-center")}>
      <p className="text-base font-bold">Nenhuma vigência para mostrar ainda.</p>
      <p className="text-sm text-muted-foreground mt-1.5">
        Envie a primeira planilha em Importações para o Dashboard ter o que vigiar.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unidade — o corpo inteiro da tela
// ---------------------------------------------------------------------------

function ConteudoDaUnidade({
  view,
  recorte,
  atualizadoEm,
  movimentos,
}: {
  view: FamiliesView;
  recorte: ReturnType<typeof lerRecorte>;
  atualizadoEm: number;
  movimentos: Movimentos | null;
}) {
  const cobertura = coberturaDePreco(view.totals.changes, view.impact.notCalculable);
  const principal = ladosDoImpacto(view)[0] ?? null;
  const dominante = impactosDaVigencia(view)[0]?.periodicity ?? null;

  /*
    As vigências do gráfico são as do **intervalo pedido**, e não todas as que o
    contexto tem.

    `movimentos.periods` lista o histórico inteiro do contexto; `entries` traz
    só o que foi comparado entre `from` e `to` (a janela de seis vigências que
    esta tela monta). Cruzar os dois desenhava um ponto para cada vigência
    antiga com `ganhos: 0, perdas: 0` — e zero aqui não é "não mudou nada", é
    "não foi perguntado". Num banco com dez vigências, quatro barras nasciam
    encostadas no zero afirmando estabilidade sobre um trecho que a consulta
    nem cobriu; numa delas o dado real era −R$ 75.903/mês.

    Filtrar pelas próprias pontas que a resposta anuncia mantém a janela e o
    desenho na mesma fonte: se `from`/`to` mudarem, o eixo muda junto, sem uma
    segunda régua de recorte escrita aqui.
  */
  const { pontos, periodicity } = useMemo(() => {
    if (!movimentos) return { pontos: [] as PontoDeImpacto[], periodicity: null as string | null };
    const ordenadas = movimentos.periods
      .filter((p) => p.date >= movimentos.from && p.date <= movimentos.to)
      .sort((a, b) => a.date.localeCompare(b.date));
    return pontosDeImpacto(ordenadas, movimentos.entries, dominante);
  }, [movimentos, dominante]);

  // As sparklines dos cartões só valem quando descrevem a mesma periodicidade
  // do número grande ao lado — misturar R$/mês no número e R$/ano na linha
  // seria a mesma mistura de escala que o produto se recusa a fazer em
  // qualquer outra tela.
  const sparklines =
    principal && periodicity === principal.periodicity && pontos.length >= 2
      ? { ganhos: pontos.map((p) => p.ganhos), perdas: pontos.map((p) => p.perdas) }
      : null;

  return (
    <>
      <FaixaSlim
        changes={view.totals.changes}
        grupos={view.groups.length}
        vehiclesTouched={view.totals.vehiclesTouched}
        veiculosDeduplicados
        atualizadoEm={atualizadoEm}
      />

      <Indicadores principal={principal} cobertura={cobertura} sparklines={sparklines} />

      <ImpactoEPodio
        pontos={pontos}
        periodicity={periodicity}
        familias={view.families}
        dominante={dominante}
      />

      <PrincipaisAlteracoes linhas={linhasDaUnidade(view, recorte)} />

      <MovimentacaoDaFrota
        entitiesAdded={view.totals.entitiesAdded}
        entitiesRemoved={view.totals.entitiesRemoved}
        ativos={frotaTotal(view)}
      />

      <QualidadeDaApuracao
        cobertura={cobertura}
        notCalculable={view.impact.notCalculable}
        semCorrespondencia={view.totals.inconclusive}
      />
    </>
  );
}

/**
 * O gráfico de impacto por competência e o pódio de famílias, lado a lado —
 * a mesma faixa nas duas leituras.
 *
 * Fica num componente próprio porque é literalmente o mesmo bloco: o que muda
 * entre Unidade e Visão Geral são os dados que chegam nele, e um bloco escrito
 * duas vezes é onde as duas leituras começam a divergir no visual sem que
 * ninguém decida isso.
 */
function ImpactoEPodio({
  pontos,
  periodicity,
  familias,
  dominante,
  notaDoGrafico,
}: {
  pontos: PontoDeImpacto[];
  periodicity: string | null;
  familias: FamiliaNoPodio[];
  dominante: string | null;
  notaDoGrafico?: string;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <section className={cn(CARTAO, "px-6 py-5 h-full")}>
          <h2 className="text-base font-bold mb-1">Impacto das alterações por vigência</h2>
          <p className="text-xs text-muted-foreground mb-4">
            {notaDoGrafico ??
              "Ganhos e perdas divergindo do zero, com o líquido por cima. Uma barra por vigência entregue — duas no mesmo mês aparecem pelo dia, nunca somadas."}
          </p>
          <GraficoDeImpacto pontos={pontos} periodicity={periodicity} />
        </section>
      </div>
      <div className="lg:col-span-2">
        <MaioresImpactos familias={familias} dominante={dominante} />
      </div>
    </div>
  );
}

/**
 * As linhas da tabela em modo Unidade — a fila do Acompanhamento, e o recorte
 * da tela em todas elas.
 *
 * `unidade: null` de propósito: a tela inteira já é de uma unidade, e repetir
 * o nome dela em cada linha é ruído.
 */
function linhasDaUnidade(view: FamiliesView, recorte: Recorte): LinhaDaTabela[] {
  const fila = juntarPrioridades(view);
  const grupos: ChangeGroup[] = fila.length > 0 ? fila.map((e) => e.group) : view.groups;
  const daVigencia = { ...recorte, period: view.period };
  return grupos.map((grupo) => ({
    chave: grupo.key,
    grupo,
    unidade: null,
    recorte: daVigencia,
  }));
}

/**
 * As linhas da tabela em Visão Geral — a fila já consolidada pelo servidor.
 *
 * Cada linha leva o recorte da **sua** unidade, e não o da tela: clicar numa
 * alteração de CAMAÇARI abre Alterações em CAMAÇARI, na competência aberta.
 * Um link que caísse no recorte da Visão Geral (que não tem unidade) abriria a
 * unidade padrão — a mesma promessa vazia que `lib/recorte.ts` existe para
 * evitar.
 */
export function linhasDaVisaoGeral(overview: FamiliesOverview): LinhaDaTabela[] {
  return overview.consolidado.groups.map((linha) => ({
    chave: `${linha.unidade}|${linha.channel ?? ""}|${linha.group.key}`,
    grupo: linha.group,
    unidade: linha.label,
    recorte: {
      period: overview.period,
      scopeHash: linha.scopeHash,
      canal: linha.channel,
    },
  }));
}

// ---------------------------------------------------------------------------
// Geral — o corpo inteiro da tela
// ---------------------------------------------------------------------------

/**
 * O mesmo corpo de tela da unidade, com as informações de todas elas.
 *
 * A tela não muda de forma quando se troca uma unidade pela Visão Geral: os
 * mesmos quatro indicadores, o mesmo gráfico por competência, o mesmo pódio de
 * famílias, a mesma tabela de alterações e a mesma movimentação de frota —
 * mais o ranking de unidades, que só a Visão Geral tem para dar.
 *
 * O que muda é a régua de cada peça, e ela está escrita em
 * `OverviewConsolidado` (servidor), não aqui: famílias somam, alterações
 * enfileiram sem mesclar (cada linha diz de que unidade é), frota soma porque
 * as populações são disjuntas. A ressalva que sobrevive à consolidação — o
 * pódio de parâmetros não abre gaveta sobre o total somado — continua dita
 * onde aparece; a contagem de veículos se explica sozinha na faixa do topo,
 * que diz se é união de ativos distintos ou soma de unidades.
 */
function ConteudoGeral({
  overview,
  atualizadoEm,
  onTrocar,
  serie,
}: {
  overview: FamiliesOverview;
  atualizadoEm: number;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  serie: PontoDeImpacto[];
}) {
  const cobertura = coberturaDePreco(overview.summary.changes, overview.summary.notCalculable);
  const principal = ladosDoImpacto(overview)[0] ?? null;
  const dominante = principal?.periodicity ?? null;
  const { totals } = overview.consolidado;

  // A mesma disciplina do modo Unidade: a sparkline só acompanha o número
  // grande quando as duas descrevem a mesma periodicidade.
  const sparklines =
    principal && serie.length >= 2
      ? { ganhos: serie.map((p) => p.ganhos), perdas: serie.map((p) => p.perdas) }
      : null;

  return (
    <>
      <FaixaSlim
        changes={overview.summary.changes}
        grupos={overview.summary.groups}
        /*
          `vehiclesTouchedDistinct` é a união dos ativos das unidades;
          `summary.vehiclesTouched` é a soma delas, e o servidor documenta que
          a soma não é uma cardinalidade global — o mesmo caminhão exportado
          por duas unidades entra duas vezes. A faixa publica a união, que é o
          que a palavra "veículos" promete quando aparece sozinha.

          A soma continua sendo o que a tela mostra quando a resposta é de uma
          versão anterior da API, ainda em cache e sem o campo novo — e aí o
          rótulo diz "soma das unidades" em vez de "distintos", porque um
          número somado com nome de conjunto é exatamente a confusão que esta
          faixa existe para desfazer.
        */
        vehiclesTouched={overview.vehiclesTouchedDistinct ?? overview.summary.vehiclesTouched}
        veiculosDeduplicados={overview.vehiclesTouchedDistinct !== undefined}
        atualizadoEm={atualizadoEm}
      />

      <Indicadores principal={principal} cobertura={cobertura} sparklines={sparklines} />

      <ImpactoEPodio
        pontos={serie}
        periodicity={dominante}
        familias={overview.consolidado.families}
        dominante={dominante}
        notaDoGrafico="Ganhos e perdas de todas as unidades incluídas, com o líquido por cima. Uma barra por competência — a unidade sem vigência naquela competência não entra nela."
      />

      <MovimentacaoDaFrota
        entitiesAdded={totals.entitiesAdded}
        entitiesRemoved={totals.entitiesRemoved}
        ativos={totals.fleet}
      />

      <PrincipaisAlteracoes
        linhas={linhasDaVisaoGeral(overview)}
        nota={
          "Na ordem do Acompanhamento — todas as unidades, dinheiro e criticidade primeiro. " +
          "Uma linha por tipo de alteração (atributo × equipamento) em cada unidade: o mesmo " +
          "atributo em duas unidades são duas linhas, porque são duas frotas e dois valores." +
          (overview.consolidado.gruposNoTotal > overview.consolidado.groups.length
            ? ` A fila traz os ${overview.consolidado.groups.length} de maior prioridade, de ${overview.consolidado.gruposNoTotal.toLocaleString("pt-BR")} que existem nesta competência.`
            : "")
        }
      />

      <RankingDeUnidades overview={overview} onTrocar={onTrocar} />

      <QualidadeDaApuracao
        cobertura={cobertura}
        notCalculable={overview.summary.notCalculable}
        semCorrespondencia={totals.inconclusive}
      />

      <p className="text-xs text-muted-foreground">
        A gaveta de detalhe por parâmetro abre dentro de cada unidade — a soma Geral não mescla a
        árvore de parâmetros entre elas. Os números por periodicidade dos cartões continuam sendo
        soma de unidades; a contagem de veículos da faixa do topo diz, ali mesmo, se é união de
        ativos distintos ou soma.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// A faixa fina de abertura — Unidade e Geral, a mesma leitura
// ---------------------------------------------------------------------------

/**
 * "355 alterações em 91 veículos distintos, agrupadas em 31 tipos — desde a
 * vigência anterior", com o relógio da última atualização do outro lado.
 *
 * Substitui o cartão grande de abertura das duas primeiras versões desta tela
 * — os mesmos números (`changes`/`vehiclesTouched`), sem a frase de impacto: o
 * líquido já tem cartão próprio logo abaixo, com corpo maior do que uma frase
 * soubesse dar a ele.
 *
 * A faixa nomeia os **três universos** da tela numa frase só, e é por isso que
 * ela ganhou o terceiro número. Eles estavam todos publicados, cada um num
 * canto, com a mesma palavra:
 *
 * - `changes` (355) conta **linhas** — uma por (veículo, atributo) que mudou;
 * - `grupos` (31) conta **tipos de alteração** — é o que a tabela de
 *   "Principais alterações" lista e o que as abas Cavalo/Carreta somam
 *   (17 + 14), e não tem como bater com 355;
 * - `vehiclesTouched` (91) conta **ativos distintos**, e por isso é sempre
 *   menor que 355: o mesmo caminhão entra em cada atributo que mudou nele.
 *
 * Escrever "355 alterações" ao lado de uma aba escrita "Cavalo 17" sem dizer
 * isto era a tela oferecendo três respostas para "quantas alterações?".
 *
 * O relógio nunca fabrica hora: é `dataUpdatedAt` da própria consulta
 * (`useQuery`), a mesma leitura da Gestão à Vista — `0` antes da primeira
 * resposta, e a faixa diz isso em vez de inventar um horário.
 */
function FaixaSlim({
  changes,
  grupos,
  vehiclesTouched,
  veiculosDeduplicados,
  atualizadoEm,
}: {
  changes: number;
  grupos: number;
  vehiclesTouched: number;
  /**
   * Se `vehiclesTouched` é a cardinalidade de um conjunto ou a soma de vários.
   *
   * Verdadeiro na Unidade, onde o servidor conta `entity_id` distintos numa
   * varredura só; falso no Geral, onde ele soma as unidades sem deduplicar
   * entre elas. A palavra na tela muda junto — "distintos" é uma afirmação
   * sobre o método, não um enfeite do rótulo.
   */
  veiculosDeduplicados: boolean;
  atualizadoEm: number;
}) {
  const veiculos = veiculosDeduplicados
    ? vehiclesTouched === 1
      ? "veículo distinto"
      : "veículos distintos"
    : vehiclesTouched === 1
      ? "veículo afetado (soma das unidades)"
      : "veículos afetados (soma das unidades)";
  return (
    <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-1 py-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span
          title={
            `${changes.toLocaleString("pt-BR")} linhas de alteração: uma por veículo e atributo que mudou. ` +
            `${grupos.toLocaleString("pt-BR")} tipos de alteração: o mesmo atributo em vários veículos conta uma vez — ` +
            "é o que a tabela de Principais alterações lista e o que as abas de equipamento somam. " +
            `${vehiclesTouched.toLocaleString("pt-BR")} ${veiculos}: ` +
            (veiculosDeduplicados
              ? "o mesmo veículo conta uma vez, por mais alterações que tenha. A identidade do ativo é global (casada por placa e chassi), então ele também não conta duas vezes quando aparece em mais de uma unidade."
              : "soma das unidades, sem deduplicar entre elas — é uma aproximação, e não uma contagem de ativos distintos.")
          }
        >
          <strong className="text-foreground tabular-nums">{changes.toLocaleString("pt-BR")}</strong>{" "}
          {changes === 1 ? "alteração detectada" : "alterações detectadas"}
          {vehiclesTouched > 0 && (
            <>
              {" em "}
              <strong className="text-foreground tabular-nums">
                {vehiclesTouched.toLocaleString("pt-BR")}
              </strong>{" "}
              {veiculos}
            </>
          )}
          {grupos > 0 && (
            <>
              {", em "}
              <strong className="text-foreground tabular-nums">
                {grupos.toLocaleString("pt-BR")}
              </strong>{" "}
              {grupos === 1 ? "tipo de alteração" : "tipos de alteração"}
            </>
          )}
          {" — desde a vigência anterior"}
        </span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <Clock className="w-3.5 h-3.5" />
        {atualizadoEm === 0
          ? "aguardando a primeira resposta…"
          : `atualização ${new Date(atualizadoEm).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}`}
      </span>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cobertura de preço — "24 de 33 alterações precificadas"
// ---------------------------------------------------------------------------

export interface CoberturaDePreco {
  apurado: number;
  total: number;
  percentual: number;
}

/**
 * "24 de 33 alterações precificadas" — a fração de alterações que já viraram
 * dinheiro (apurado ou excluído por já contar noutra parcela), sobre o total,
 * mais o percentual pronto para o anel de progresso.
 *
 * A identidade `apurado + semPreco = total` é a mesma que `porApuracao`
 * (`composicaoDasAlteracoes`) garante nas suas três fatias — aqui só a conta
 * mais simples dela. `null` sem alteração nenhuma: uma fração `0/0` não é
 * cobertura, é ausência de vigência.
 */
function coberturaDePreco(total: number, semPreco: number): CoberturaDePreco | null {
  if (total === 0) return null;
  const apurado = total - semPreco;
  return { apurado, total, percentual: (apurado / total) * 100 };
}

// ---------------------------------------------------------------------------
// Os indicadores — quatro cartões, o líquido em destaque
// ---------------------------------------------------------------------------

/**
 * Os quatro números que respondem "quanto custou" — na mesma régua para a
 * Unidade e para o Geral, porque `FamiliesOverview.summary` tem a mesma forma
 * de `ExecutiveSummary` que `FamiliesView.summary`.
 *
 * O Impacto líquido é o cartão em destaque — o número que a Ambev pergunta em
 * reunião primeiro. Ele nunca ganha um "projetado em 12 meses": este produto
 * só publica medida, e anualizar o líquido de uma competência multiplicaria
 * uma medida por doze para chamar o resultado de outra coisa.
 */
function Indicadores({
  principal,
  cobertura,
  sparklines,
}: {
  principal: LadosDoImpacto | null;
  cobertura: CoberturaDePreco | null;
  sparklines: { ganhos: number[]; perdas: number[] } | null;
}) {
  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
      <Cartao
        icone={TrendingDown}
        titulo="Perdas mensais"
        explicacao={
          `Soma só do que reduziu a remuneração, na periodicidade dominante. ` +
          "Cobre a vigência inteira — todas as alterações precificadas, e não só as " +
          "linhas da tabela de Principais alterações."
        }
      >
        {principal ? (
          <div className="flex items-end justify-between gap-2">
            <p className="text-3xl font-extrabold tabular-nums text-red-700">
              {formatBrlShort(principal.perdas)}
              {principal.periodicity !== "MENSAL" && (
                <span className="text-xs font-normal text-muted-foreground block mt-1">
                  {periodicitySuffix(principal.periodicity)}
                </span>
              )}
            </p>
            {sparklines && sparklines.perdas.length >= 2 && (
              <Sparkline valores={sparklines.perdas} cor="#dc2626" />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">sem valor apurado</p>
        )}
      </Cartao>

      <Cartao
        icone={TrendingUp}
        titulo="Ganhos mensais"
        explicacao={
          `Soma só do que aumentou a remuneração, na periodicidade dominante. ` +
          "Cobre a vigência inteira — todas as alterações precificadas, e não só as " +
          "linhas da tabela de Principais alterações."
        }
      >
        {principal ? (
          <div className="flex items-end justify-between gap-2">
            <p className="text-3xl font-extrabold tabular-nums text-emerald-700">
              {formatBrlShort(principal.ganhos)}
              {principal.periodicity !== "MENSAL" && (
                <span className="text-xs font-normal text-muted-foreground block mt-1">
                  {periodicitySuffix(principal.periodicity)}
                </span>
              )}
            </p>
            {sparklines && sparklines.ganhos.length >= 2 && (
              <Sparkline valores={sparklines.ganhos} cor="#059669" />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">sem valor apurado</p>
        )}
      </Cartao>

      <Cartao
        icone={ReceiptText}
        titulo="Impacto líquido"
        explicacao={
          "Ganhos menos perdas da vigência inteira, na mesma periodicidade. É o mesmo " +
          "número que a barra de líquido do gráfico marca na vigência aberta, e o mesmo " +
          "que as famílias de Maiores impactos somam."
        }
        destaque
        className="min-w-0"
      >
        {principal ? (
          <>
            <p
              className={cn(
                "text-2xl sm:text-3xl xl:text-4xl font-extrabold tabular-nums leading-none whitespace-nowrap",
                principal.liquido < 0 ? "text-red-700" : "text-emerald-700",
              )}
            >
              {formatBrlShort(principal.liquido)}
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              {periodicitySuffix(principal.periodicity) || " valor único"} · +
              {formatBrlShort(principal.ganhos)} / {formatBrlShort(principal.perdas)}
            </p>
          </>
        ) : (
          <p className="text-xl font-extrabold text-muted-foreground">Nenhum valor apurável</p>
        )}
      </Cartao>

      <Cartao
        icone={Gauge}
        titulo="Cobertura financeira"
        explicacao={
          "Fração das linhas de alteração da vigência que já viraram dinheiro — o mesmo " +
          "universo do primeiro número da faixa do topo, e não o dos tipos de alteração " +
          "que a tabela lista."
        }
      >
        {cobertura ? (
          <div className="flex items-center gap-3">
            <AnelDeCobertura percentual={cobertura.percentual} />
            <p className="text-xs text-muted-foreground leading-snug">
              <strong className="text-foreground tabular-nums">
                {cobertura.apurado.toLocaleString("pt-BR")}
              </strong>{" "}
              de{" "}
              <strong className="text-foreground tabular-nums">
                {cobertura.total.toLocaleString("pt-BR")}
              </strong>{" "}
              alterações precificadas
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">sem alteração nesta vigência</p>
        )}
      </Cartao>
    </div>
  );
}

function Cartao({
  icone: Icone,
  titulo,
  explicacao,
  children,
  className,
  destaque = false,
}: {
  icone: typeof FileText;
  titulo: string;
  /** O universo que o cartão mede, por extenso — ver `Indicador.titulo`. */
  explicacao?: string;
  children: React.ReactNode;
  className?: string;
  destaque?: boolean;
}) {
  return (
    <section
      title={explicacao}
      className={cn(
        CARTAO,
        "p-5 flex flex-col overflow-hidden",
        destaque && "bg-accent/40 border-brand/30 border-2",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center shrink-0">
          <Icone className="w-[1.125rem] h-[1.125rem] text-brand" strokeWidth={2.25} />
        </span>
        <h2 className="text-[0.8125rem] font-bold">{titulo}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Maiores impactos desta vigência — antiga "Onde a Ambev alterou"
// ---------------------------------------------------------------------------

/**
 * Uma linha do pódio — o mínimo que ele lê, e por isso o que Unidade e Visão
 * Geral conseguem entregar com a mesma forma.
 *
 * `FamilyView` (unidade) tem tudo isto e mais; `OverviewFamilyTotal` (a soma
 * entre unidades) tem só isto, de propósito — "4 de 10 parâmetros" é uma
 * fração de uma unidade e não sobrevive à soma. Tipar pelo mínimo é o que
 * deixa o mesmo pódio servir às duas sem um `as` no meio.
 */
export interface FamiliaNoPodio {
  code: string;
  name: string;
  changes: number;
  impact: { byPeriodicity: Record<string, number> };
}

/**
 * As famílias mais tocadas, na periodicidade dominante da vigência — a mesma
 * disciplina do pódio do Resumo executivo: o ranking existe dentro de uma
 * periodicidade só, nunca somando R$/mês com R$/ano.
 *
 * Numerada 1..5, com uma barra maior por linha — a mesma conta de "Onde a
 * Ambev alterou" das versões anteriores desta tela, só com a leitura em lista
 * ranqueada. A regra de recair em quantidade quando nada tem preço apurado
 * ainda continua igual: uma família sem impacto ainda tem o que dizer.
 */
function MaioresImpactos({
  familias,
  dominante,
}: {
  familias: FamiliaNoPodio[];
  dominante: string | null;
}) {
  const comImpacto = (dominante === null
    ? []
    : familias
        .map((f) => ({ nome: f.name, changes: f.changes, amount: f.impact.byPeriodicity[dominante] ?? 0 }))
        .filter((f) => f.amount !== 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  ).slice(0, 5);

  // Sem impacto apurado nenhum, a família ainda tem o que dizer: quantas
  // alterações ela concentrou. Uma barra de quantidade substitui a de R$ em
  // vez de deixar o cartão vazio.
  const porQuantidade =
    comImpacto.length === 0
      ? [...familias]
          .filter((f) => f.changes > 0)
          .sort((a, b) => b.changes - a.changes)
          .slice(0, 5)
      : [];

  const teto = comImpacto.reduce((maior, l) => Math.max(maior, Math.abs(l.amount)), 0);
  const tetoQuantidade = porQuantidade.reduce((maior, f) => Math.max(maior, f.changes), 0);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col h-full")}>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-bold">Maiores impactos desta vigência</h2>
        {dominante && comImpacto.length > 0 && (
          <span className="text-xs font-semibold text-muted-foreground">
            em R${periodicitySuffix(dominante)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Por família da remuneração — o líquido de cada uma (ganhos menos perdas), até cinco.
      </p>

      {comImpacto.length > 0 ? (
        <ol className="space-y-3.5 flex-1">
          {comImpacto.map((linha, indice) => (
            <li key={linha.nome} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
                {indice + 1}
              </span>
              <span className="w-28 shrink-0 min-w-0 text-sm font-semibold truncate" title={linha.nome}>
                {linha.nome}
              </span>
              <span className="flex-1 h-3 bg-muted overflow-hidden min-w-8 rounded-sm">
                <span
                  className={cn("block h-full", linha.amount < 0 ? "bg-red-600" : "bg-emerald-600")}
                  style={{ width: `${teto === 0 ? 0 : Math.max(2, (Math.abs(linha.amount) / teto) * 100)}%` }}
                />
              </span>
              <span
                className={cn(
                  "text-xs font-bold tabular-nums w-24 text-right",
                  linha.amount < 0 ? "text-red-700" : "text-emerald-700",
                )}
              >
                {escreverImpacto({ periodicity: dominante, amount: linha.amount })}
              </span>
            </li>
          ))}
        </ol>
      ) : porQuantidade.length > 0 ? (
        <ol className="space-y-3.5 flex-1">
          {porQuantidade.map((familia, indice) => (
            <li key={familia.code} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
                {indice + 1}
              </span>
              <span className="w-28 shrink-0 min-w-0 text-sm font-semibold truncate" title={familia.name}>
                {familia.name}
              </span>
              <span className="flex-1 h-3 bg-muted overflow-hidden min-w-8 rounded-sm">
                <span
                  className="block h-full bg-brand"
                  style={{
                    width: `${tetoQuantidade === 0 ? 0 : Math.max(2, (familia.changes / tetoQuantidade) * 100)}%`,
                  }}
                />
              </span>
              <span className="text-xs font-bold tabular-nums w-24 text-right">
                {familia.changes} {familia.changes === 1 ? "alteração" : "alterações"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground flex-1">
          Nenhuma família registrou alteração nesta vigência.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Principais alterações — a tabela, nomes de negócio sempre
// ---------------------------------------------------------------------------

/**
 * Uma linha da tabela de Principais alterações.
 *
 * O grupo continua sendo o que o servidor apurou; o que a linha acrescenta é
 * **de quem ele é** — `unidade` (preenchida só em Visão Geral, onde a tabela
 * mistura unidades) e o `recorte` que o link de detalhe abre, que em Visão
 * Geral é o da unidade daquela linha e não o da tela. `chave` existe porque
 * `ChangeGroup.key` só é única dentro de uma unidade: a mesma alteração em
 * duas unidades tem a mesma chave, e duas linhas com a mesma `key` no React
 * são uma linha só.
 */
interface LinhaDaTabela {
  chave: string;
  grupo: ChangeGroup;
  unidade: string | null;
  recorte: Recorte;
}

/** Cavalo sempre à frente de Carreta — as demais abas seguem a ordem de chegada. */
const PRIORIDADE_ABA: Record<string, number> = { CAVALO: 0, CARRETA: 1 };

/**
 * As abas de equipamento da tabela — uma por tipo presente na vigência.
 *
 * Cavalo e Carreta respondem a perguntas diferentes (um consome diesel e
 * amortiza financiamento, o outro nem sempre tem tração), e misturá-los numa
 * fila só fazia a tabela alternar de assunto linha a linha. As abas saem dos
 * próprios grupos, e não de uma lista fixa: só aparece a aba que tem conteúdo.
 * A ordem de prioridade do servidor se preserva dentro de cada aba; entre as
 * abas, Cavalo vem sempre primeiro, Carreta em seguida, e qualquer outro
 * equipamento na ordem em que chegou. Um grupo sem `entityType` cai numa aba
 * própria, com a etiqueta que o servidor já deu a ele, em vez de sumir da
 * tela.
 */
export function abasDeEquipamento(
  grupos: ChangeGroup[],
): { chave: string; rotulo: string; grupos: ChangeGroup[] }[] {
  const abas = new Map<string, { chave: string; rotulo: string; grupos: ChangeGroup[] }>();
  for (const grupo of grupos) {
    const chave = grupo.entityType ?? "SEM_EQUIPAMENTO";
    const aba = abas.get(chave);
    if (aba) aba.grupos.push(grupo);
    else abas.set(chave, { chave, rotulo: grupo.equipment, grupos: [grupo] });
  }
  return [...abas.values()].sort(
    (a, b) => (PRIORIDADE_ABA[a.chave] ?? 99) - (PRIORIDADE_ABA[b.chave] ?? 99),
  );
}

/**
 * As colunas Antes / Agora / Diferença de uma linha da tabela.
 *
 * Espelha os mesmos ramos de `<BeforeAfter>` (`components/inicio/group-card.tsx`):
 * só existe total de Antes e Agora quando `aggregation = SUM` — somar km/l ou
 * litros/100km de dezenas de veículos produziria um número que não significa
 * nada. Fora desse caso, Antes e Agora ficam em branco e a Diferença carrega a
 * mesma faixa de variação (ou o padrão dominante) que o cartão de alteração já
 * mostra, para as duas telas nunca se contradizerem sobre o mesmo grupo.
 */
export function celulasAntesDepois(grupo: ChangeGroup) {
  const a = grupo.aggregate;

  if (a.summable && a.totalBefore !== null && a.totalAfter !== null) {
    const alta = a.totalAfter >= a.totalBefore;
    return {
      antes: formatValue(a.totalBefore, grupo.unit),
      agora: formatValue(a.totalAfter, grupo.unit),
      diferenca: (
        <span className={cn("font-semibold whitespace-nowrap", alta ? "text-emerald-700" : "text-red-700")}>
          {alta ? "+" : ""}
          {formatValue(a.totalAfter - a.totalBefore, grupo.unit)}
          {a.deltaPercent !== null && (
            <span
              className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-bold",
                alta ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800",
              )}
            >
              {formatPercent(a.deltaPercent)}
            </span>
          )}
        </span>
      ),
    };
  }

  if (a.minPercent !== null && a.maxPercent !== null) {
    return {
      antes: "—",
      agora: "—",
      diferenca: (
        <span className="text-xs text-muted-foreground">
          variação de {formatPercent(a.minPercent)} a {formatPercent(a.maxPercent)} por veículo
          <br />
          <span className="italic">não somável ({a.aggregation ?? "agregação não definida"})</span>
        </span>
      ),
    };
  }

  if (grupo.dominantPattern) {
    return {
      antes: grupo.dominantPattern.before ?? "—",
      agora: grupo.dominantPattern.after ?? "—",
      diferenca: <span className="text-muted-foreground">—</span>,
    };
  }

  return {
    antes: "—",
    agora: "—",
    diferenca: <span className="text-muted-foreground italic">sem variação numérica</span>,
  };
}

/** O selo de cor de um indicador do cabeçalho — a mesma paleta de `BADGE_STYLE` (group-card.tsx). */
const TOM_INDICADOR = {
  azul: "bg-sky-50 text-sky-600",
  violeta: "bg-violet-50 text-violet-600",
  positivo: "bg-emerald-50 text-emerald-700",
  negativo: "bg-red-50 text-red-700",
} as const;

/**
 * Um indicador do cabeçalho — contagem ou impacto, com o valor em destaque.
 *
 * `ordem` inverte valor e rótulo: as contagens leem "8, alterações" (o número
 * primeiro, porque é a resposta), o impacto lê "Impacto líquido, −R$ 53.256"
 * (o rótulo primeiro, porque só o número não diz de quê).
 */
function Indicador({
  icone: Icone,
  tom,
  valor,
  rotulo,
  titulo,
  ordem = "valor-rotulo",
}: {
  icone: LucideIcon;
  tom: keyof typeof TOM_INDICADOR;
  valor: React.ReactNode;
  rotulo: string;
  /**
   * O universo que o número mede, por extenso.
   *
   * Não é decoração: três indicadores lado a lado com "alterações",
   * "veículos" e "impacto" cabem em duas palavras cada, e duas palavras não
   * distinguem "as 8 linhas que você está vendo" de "as 355 da vigência". O
   * rótulo diz o que é, e isto diz de onde saiu.
   */
  titulo?: string;
  ordem?: "valor-rotulo" | "rotulo-valor";
}) {
  const linhas =
    ordem === "valor-rotulo" ? (
      <>
        <div className="font-bold tabular-nums text-lg leading-tight">{valor}</div>
        <div className="text-xs text-muted-foreground leading-tight">{rotulo}</div>
      </>
    ) : (
      <>
        <div className="text-xs text-muted-foreground leading-tight">{rotulo}</div>
        <div className="font-bold tabular-nums text-lg leading-tight">{valor}</div>
      </>
    );
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5"
      title={titulo}
    >
      <span className={cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", TOM_INDICADOR[tom])}>
        <Icone className="w-4 h-4" strokeWidth={2.25} />
      </span>
      <div>{linhas}</div>
    </div>
  );
}

/**
 * Quantos veículos **distintos** as linhas visíveis tocaram — a união dos
 * ativos, e nunca a soma de `grupo.vehicles`.
 *
 * Somar era o que estava no ar, e o número resultante não tinha nome: oito
 * linhas rendiam "42 veículos impactados" ao lado de "91 veículos afetados" na
 * faixa de cima, e os dois diziam "veículos". 42 não era um subconjunto de 91
 * — era 91 contado várias vezes e cortado em oito linhas, porque o mesmo
 * caminhão entra uma vez em cada atributo que mudou nele. A soma podia até
 * passar a frota inteira.
 *
 * A união só é possível porque o grupo carrega **quais** ativos
 * (`entityIds`), e não só quantos. São as mesmas chaves que o servidor usa em
 * `totals.vehiclesTouched`, então este número é comparável com o da faixa: é
 * sempre um subconjunto dele.
 *
 * `null` quando algum grupo chega sem `entityIds` — resposta de uma versão
 * anterior da API ainda em cache. Uma união parcial subestimaria em silêncio,
 * e este produto não publica número que não sabe defender: a tela diz que não
 * sabe.
 */
export function veiculosDistintos(grupos: ChangeGroup[]): number | null {
  const ativos = new Set<string>();
  for (const grupo of grupos) {
    if (!Array.isArray(grupo.entityIds)) return null;
    for (const id of grupo.entityIds) ativos.add(id);
  }
  return ativos.size;
}

/**
 * O impacto líquido das linhas visíveis — só quando todas compartilham a
 * mesma periodicidade.
 *
 * Somar R$/mês com R$/ano no mesmo total é o erro que este produto existe
 * para pegar (ver o comentário do Painel de Impacto, no topo do arquivo); um
 * indicador de cabeçalho não ganha isenção dessa regra só por ser um resumo.
 * Vindo períodos misturados, o indicador diz isso em vez de mostrar um número.
 */
export function impactoLiquidoDaTabela(grupos: ChangeGroup[]) {
  const precificados = grupos.filter(
    (g) => g.impact.confidence === "CALCULATED" && g.impact.amount !== null,
  );
  if (precificados.length === 0) return null;
  const periodicidades = new Set(precificados.map((g) => g.impact.periodicity));
  if (periodicidades.size > 1) return { misturado: true as const };
  const total = precificados.reduce((soma, g) => soma + g.impact.amount!, 0);
  return { misturado: false as const, total, periodicidade: precificados[0].impact.periodicity };
}

/**
 * As alterações mais relevantes desta vigência, na ordem de prioridade do
 * cockpit — a mesma fila que o Acompanhamento e `ultimasAlteracoes` já usam
 * (`juntarPrioridades`, `lib/cockpit.ts`). Reordenar aqui por conta própria
 * faria esta tabela discordar da lista de "Alterações recentes" que já existe
 * no produto sobre os mesmos dados.
 *
 * A tabela abre numa aba por equipamento (`abasDeEquipamento`), porque uma
 * fila única alternava entre Cavalo e Carreta a cada linha; a fatia de oito
 * linhas passa a ser das oito maiores prioridades **daquele** equipamento. A
 * aba de Cavalo vem sempre primeiro. Com um equipamento só na vigência, as
 * abas somem e o equipamento volta a aparecer sob o título da linha, como
 * antes.
 *
 * Os três indicadores do cabeçalho resumem só a fatia visível (as linhas da
 * aba aberta, até oito) — trocar de aba troca o resumo junto, porque ele
 * responde "o que estou vendo", não "o que existe na vigência inteira".
 *
 * Cada linha mostra `grupo.title` — a etiqueta de negócio já curada por
 * `attributeLabel()` no servidor — e nunca `attributeCode` cru. O ícone à
 * esquerda do título é só decorativo (`iconeDaAlteracao`): uma pista de que
 * tipo de mudança é aquela, com uma etiqueta neutra sempre que a régua de
 * palavras-chave não reconhece nada — nunca um ícone específico arriscado por
 * adivinhação. A cor de fundo da linha (e da coluna Impacto/mês, sempre
 * destacada) segue o sinal do impacto; sem preço, a linha fica neutra.
 */
function PrincipaisAlteracoes({ linhas, nota }: { linhas: LinhaDaTabela[]; nota?: string }) {
  const porGrupo = new Map(linhas.map((l) => [l.grupo, l]));
  const ordenados: ChangeGroup[] = linhas.map((l) => l.grupo);
  const abas = abasDeEquipamento(ordenados);
  const [escolhida, escolher] = useState<string | null>(null);
  const ativa = abas.find((aba) => aba.chave === escolhida) ?? abas[0];
  const daAba = ativa ? ativa.grupos : ordenados;
  const grupos = daAba.slice(0, 8);
  const veiculos = veiculosDistintos(grupos);
  const impacto = impactoLiquidoDaTabela(grupos);
  const escopo = ativa && abas.length > 1 ? ` de ${ativa.rotulo}` : "";

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col h-full")}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-bold">Principais alterações</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {nota ??
              "Na ordem do Acompanhamento — dinheiro e criticidade primeiro. Uma linha por tipo de alteração (atributo × equipamento), não por veículo."}
          </p>
        </div>

        {grupos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Indicador
              icone={SlidersHorizontal}
              tom="azul"
              valor={`${grupos.length} de ${daAba.length}`}
              rotulo={`tipos de alteração${escopo} exibidos`}
              titulo={
                `A tabela mostra no máximo os 8 de maior prioridade. ${daAba.length} ` +
                `${daAba.length === 1 ? "tipo de alteração existe" : "tipos de alteração existem"}` +
                `${escopo} nesta vigência${
                  abas.length > 1 ? ` (${abas.map((a) => `${a.rotulo} ${a.grupos.length}`).join(", ")})` : ""
                }. Um tipo é um atributo num equipamento; a faixa do topo conta linhas — ` +
                "uma por veículo e atributo —, por isso o número de lá é maior."
              }
            />
            <Indicador
              icone={Truck}
              tom="violeta"
              valor={veiculos === null ? "—" : veiculos.toLocaleString("pt-BR")}
              rotulo={
                veiculos === null
                  ? "veículos — recarregue a página"
                  : "veículos distintos nas linhas exibidas"
              }
              titulo={
                veiculos === null
                  ? "Esta resposta veio de uma versão anterior da API, sem a identidade dos ativos. Sem ela, só daria para somar as linhas — e a soma contaria o mesmo veículo uma vez por alteração."
                  : "Ativos distintos tocados pelas linhas acima: o mesmo veículo conta uma vez, mesmo aparecendo em várias delas. É um subconjunto dos veículos distintos da faixa do topo, que cobre a vigência inteira."
              }
            />
            <Indicador
              icone={impacto && !impacto.misturado && impacto.total < 0 ? TrendingDown : TrendingUp}
              tom={
                impacto === null || impacto.misturado
                  ? "azul"
                  : impacto.total < 0
                    ? "negativo"
                    : "positivo"
              }
              ordem="rotulo-valor"
              rotulo="Impacto líquido das linhas exibidas"
              titulo={
                "Soma do impacto das linhas acima, e só delas — trocar de aba ou de vigência " +
                "troca este número junto. O Impacto líquido dos cartões do topo cobre a " +
                "vigência inteira, e é sempre o número maior."
              }
              valor={
                impacto === null ? (
                  "sem preço"
                ) : impacto.misturado ? (
                  "periodicidades diferentes"
                ) : (
                  <span className={impacto.total < 0 ? "text-red-700" : "text-emerald-700"}>
                    {formatBrlShort(impacto.total)}
                    <span className="font-normal text-muted-foreground">
                      {periodicitySuffix(impacto.periodicidade)}
                    </span>
                  </span>
                )
              }
            />
          </div>
        )}
      </div>

      {abas.length > 1 && ativa && (
        <Tabs value={ativa.chave} onValueChange={escolher} className="mb-4">
          <TabsList>
            {abas.map((aba) => (
              <TabsTrigger
                key={aba.chave}
                value={aba.chave}
                title={`${aba.grupos.length} ${
                  aba.grupos.length === 1 ? "tipo de alteração" : "tipos de alteração"
                } em ${aba.rotulo} nesta vigência. As abas somam os tipos, não as linhas: a faixa do topo conta uma linha por veículo e atributo, e por isso é um número maior.`}
              >
                {aba.rotulo}
                <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                  {aba.grupos.length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {grupos.length === 0 ? (
        <p className="text-sm text-muted-foreground flex-1">
          Nenhuma alteração nesta vigência.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                <th className="font-semibold px-2 pb-2">Alteração</th>
                <th className="font-semibold px-2 pb-2">Antes</th>
                <th className="font-semibold px-2 pb-2">Agora</th>
                <th className="font-semibold px-2 pb-2">Diferença</th>
                <th className="font-semibold px-2 pb-2 text-right">Veíc.</th>
                <th className="font-semibold px-2 pb-2 pl-3 text-right bg-muted/50 rounded-t-md">
                  Impacto/mês
                </th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((grupo) => {
                const linha = porGrupo.get(grupo)!;
                const filtros: Record<string, string> = {};
                if (grupo.attributeCode) filtros.attributeCode = grupo.attributeCode;
                if (grupo.entityType) filtros.entityType = grupo.entityType;
                const href = linkDeAlteracoes({ recorte: linha.recorte, filtros });
                const comPreco = grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null;
                const negativo = comPreco && grupo.impact.amount! < 0;
                const Icone = iconeDaAlteracao(grupo);
                const { antes, agora, diferenca } = celulasAntesDepois(grupo);

                return (
                  <tr
                    key={linha.chave}
                    className={cn(
                      "border-t transition-colors",
                      comPreco ? (negativo ? "bg-red-50/50" : "bg-emerald-50/50") : "hover:bg-accent/30",
                    )}
                  >
                    <td className="px-2 py-2.5 align-top">
                      <div className="flex items-start gap-2">
                        <span className="w-6 h-6 rounded-md bg-accent flex items-center justify-center shrink-0 mt-0.5">
                          <Icone className="w-3.5 h-3.5 text-brand" strokeWidth={2.25} />
                        </span>
                        <div className="min-w-0">
                          <Link href={href} className="font-semibold hover:text-brand transition-colors">
                            {grupo.title}
                          </Link>
                          {/*
                            De quem é a linha vem primeiro em Visão Geral: sem
                            isso a tabela mistura unidades sem dizer, e duas
                            linhas do mesmo parâmetro com valores diferentes
                            viram contradição em vez de duas unidades.
                          */}
                          {linha.unidade !== null ? (
                            <div className="text-xs text-muted-foreground">
                              {linha.unidade}
                              {abas.length <= 1 && ` · ${grupo.equipment}`}
                            </div>
                          ) : (
                            abas.length <= 1 && (
                              <div className="text-xs text-muted-foreground">{grupo.equipment}</div>
                            )
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 align-top text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {antes}
                    </td>
                    <td className="px-2 py-2.5 align-top text-xs font-mono font-medium whitespace-nowrap">
                      {agora}
                    </td>
                    <td className="px-2 py-2.5 align-top text-xs">{diferenca}</td>
                    <td className="px-2 py-2.5 align-top text-right tabular-nums text-xs text-muted-foreground">
                      {grupo.vehicles.toLocaleString("pt-BR")}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2.5 pl-3 align-top text-right tabular-nums bg-muted/25",
                        comPreco && (negativo ? "bg-red-100/40" : "bg-emerald-100/40"),
                      )}
                    >
                      {comPreco ? (
                        <span className={cn("font-bold", negativo ? "text-red-700" : "text-emerald-700")}>
                          {formatBrlShort(grupo.impact.amount!)}
                          <span className="font-normal text-muted-foreground">
                            {periodicitySuffix(grupo.impact.periodicity)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">sem preço</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Movimentação da frota — o que entrou, o que saiu, o que está ativo
// ---------------------------------------------------------------------------

/**
 * Três blocos, não quatro. O mockup pedia um quarto — "mudaram de condição" —
 * e ele fica de fora de propósito: o motor só distingue `ENTITY_ADDED` e
 * `ENTITY_REMOVED` como movimento de frota (`lib/comparison/src/engine.ts`);
 * toda outra alteração de um ativo que continua na frota é `VALUE_CHANGED`, o
 * mesmo tipo de qualquer coluna que mudou de valor — não existe um sinal de
 * "mudança de condição" separado de "mudou de valor" que este bloco pudesse
 * mostrar sem inventar um número. Quando esse sinal existir de verdade, o
 * quarto cartão entra aqui.
 *
 * Vale nas duas leituras: entrada e saída de ativo e frota são contagens de
 * populações disjuntas (uma placa é de uma unidade), e por isso somam entre
 * unidades sem a ressalva de dupla contagem que `vehiclesTouched` carrega. Em
 * Visão Geral os números vêm de `consolidado.totals`, somados no servidor.
 */
function MovimentacaoDaFrota({
  entitiesAdded,
  entitiesRemoved,
  ativos,
}: {
  entitiesAdded: number;
  entitiesRemoved: number;
  ativos: number;
}) {
  if (entitiesAdded === 0 && entitiesRemoved === 0 && ativos === 0) return null;

  return (
    <section className={cn(CARTAO, "px-6 py-5")}>
      <h2 className="text-base font-bold mb-4">Movimentação da frota</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <TileDeMovimento
          icone={ArrowUpRight}
          cor="text-emerald-700"
          rotulo="Entraram"
          valor={`+${entitiesAdded.toLocaleString("pt-BR")}`}
        />
        <TileDeMovimento
          icone={ArrowDownRight}
          cor="text-red-700"
          rotulo="Saíram"
          valor={`−${entitiesRemoved.toLocaleString("pt-BR")}`}
        />
        <TileDeMovimento
          icone={Truck}
          cor="text-brand"
          rotulo="Veículos ativos"
          valor={ativos.toLocaleString("pt-BR")}
        />
      </div>
    </section>
  );
}

function TileDeMovimento({
  icone: Icone,
  cor,
  rotulo,
  valor,
}: {
  icone: typeof Truck;
  cor: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
      <span className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
        <Icone className={cn("w-4 h-4", cor)} strokeWidth={2.25} />
      </span>
      <div>
        <p className={cn("text-xl font-extrabold tabular-nums", cor)}>{valor}</p>
        <p className="text-[0.6875rem] text-muted-foreground">{rotulo}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking de unidades — Geral, sempre visível
// ---------------------------------------------------------------------------

type Situacao = "critico" | "atencao" | "positivo";

const SITUACAO: Record<Situacao, { label: string; className: string }> = {
  critico: { label: "Crítico", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  atencao: {
    label: "Atenção",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  positivo: {
    label: "Positivo",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
};

/**
 * O selo de situação de uma unidade no ranking, derivado da própria lista —
 * nunca de um limiar por unidade escrito à mão.
 *
 * Impacto positivo é sempre "Positivo". Impacto negativo vira "Crítico" só
 * quando o módulo chega à metade do pior módulo negativo da competência (a
 * pior unidade da vigência é sempre "Crítico"); abaixo disso é "Atenção". É o
 * mesmo tipo de corte relativo que já separa "maior impacto" do resto em
 * `pontosDeAtencao` — metade do pior é grave o bastante para não ser atenção
 * comum, e é um corte que qualquer um reconstrói olhando a própria lista.
 */
function situacaoDaUnidade(impacto: Impacto | null, piorNegativo: number): Situacao {
  if (!impacto || impacto.amount >= 0) return "positivo";
  if (piorNegativo === 0) return "atencao";
  return Math.abs(impacto.amount) >= piorNegativo * 0.5 ? "critico" : "atencao";
}

/**
 * O ranking de unidades da Visão Geral, sempre visível — nunca atrás de um
 * clique ou de uma gaveta (`Sheet`). É o único bloco que só existe neste modo:
 * o resto da tela é o mesmo corpo da unidade, com os números consolidados
 * (`OverviewConsolidado`, em `lib/comparison/src/families-view-overview.ts`).
 * Ele fica logo abaixo do gráfico porque responde a pergunta seguinte à dele —
 * *onde* aconteceu — antes de a tabela entrar no *o quê*.
 *
 * A ordem é a mesma de `unidadesPorImpacto` — maior módulo de impacto
 * primeiro —, e cada linha leva à Dashboard daquela unidade. O selo de
 * "Situação" é decorativo em cima da mesma ordem, não um recorte novo.
 */
function RankingDeUnidades({
  overview,
  onTrocar,
}: {
  overview: FamiliesOverview;
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  const unidades = unidadesPorImpacto(overview);
  const total = overview.unitsIncluded.length + overview.unitsExcluded.length;
  const piorNegativo = unidades.reduce(
    (pior, u) => (u.impacto && u.impacto.amount < 0 ? Math.max(pior, Math.abs(u.impacto.amount)) : pior),
    0,
  );

  const entrarNaUnidade = (contexto: OverviewContextRef) =>
    onTrocar({
      scopeHash: contexto.scopeHash,
      canal: contexto.channel,
      period: null,
      visaoGeral: null,
    });

  return (
    <section className={cn(CARTAO, "px-6 py-5")}>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-bold">Unidades em atenção</h2>
        <span className="text-xs text-muted-foreground">
          {overview.unitsIncluded.length} de {total} unidades incluídas
        </span>
      </div>

      {unidades.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma unidade entrou na soma desta competência.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                <th className="font-semibold px-2 pb-2">Unidade</th>
                <th className="font-semibold px-2 pb-2 text-right">Alterações</th>
                <th className="font-semibold px-2 pb-2 text-right">Perdas</th>
                <th className="font-semibold px-2 pb-2 text-right">Ganhos</th>
                <th className="font-semibold px-2 pb-2 text-right">Líquido</th>
                <th className="font-semibold px-2 pb-2 text-right">Situação</th>
              </tr>
            </thead>
            <tbody>
              {unidades.map(({ unidade, impacto }) => {
                const perdas =
                  impacto && impacto.periodicity !== null
                    ? (unidade.summary.lossesByPeriodicity[impacto.periodicity] ?? 0)
                    : 0;
                const ganhos =
                  impacto && impacto.periodicity !== null
                    ? (unidade.summary.gainsByPeriodicity[impacto.periodicity] ?? 0)
                    : 0;
                const unico = unidade.contexts.length === 1;
                const situacao = SITUACAO[situacaoDaUnidade(impacto, piorNegativo)];

                return (
                  <tr
                    key={unidade.unidade}
                    className={cn(
                      "border-t transition-colors",
                      unico && "hover:bg-accent/30 cursor-pointer",
                    )}
                    onClick={unico ? () => entrarNaUnidade(unidade.contexts[0]) : undefined}
                  >
                    <td className="px-2 py-2.5 font-semibold">
                      {unico ? (
                        unidade.label
                      ) : (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>{unidade.label}</span>
                          {unidade.contexts.map((contexto) => (
                            <button
                              key={`${contexto.scopeHash}|${contexto.channel ?? ""}`}
                              type="button"
                              onClick={(evento) => {
                                evento.stopPropagation();
                                entrarNaUnidade(contexto);
                              }}
                              className="text-xs font-normal text-brand hover:underline"
                            >
                              {contexto.channel ?? "sem canal"}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                      {unidade.summary.changes.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-red-700">
                      {perdas !== 0 ? formatBrlShort(perdas) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-emerald-700">
                      {ganhos !== 0 ? formatBrlShort(ganhos) : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2.5 text-right tabular-nums font-bold",
                        impacto === null
                          ? "text-muted-foreground font-normal"
                          : impacto.amount < 0
                            ? "text-red-700"
                            : "text-emerald-700",
                      )}
                    >
                      {impacto ? escreverImpacto(impacto) : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2.5 py-0.5 text-[0.6875rem] font-bold",
                          situacao.className,
                        )}
                      >
                        {situacao.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Qualidade da apuração — faixa fina, sempre visível, nunca compete com o financeiro
// ---------------------------------------------------------------------------

/**
 * O que ainda falta apurar — de propósito discreta: pontos coloridos e
 * números pequenos, sem cartão de destaque, para que a régua financeira lá em
 * cima continue sendo a primeira coisa que se lê. É trabalho pendente, não uma
 * falha da tela.
 *
 * "Sem correspondência" só aparece quando o dado existe (`totals.inconclusive`
 * — o mesmo campo que a Gestão à Vista já publica sob este nome) e é maior que
 * zero; na Visão Geral ele nunca aparece porque a soma entre unidades não tem
 * esse total. Não existe um "% da frota conciliada" diferente da cobertura de
 * apuração — não há, nesta base, uma métrica de reconciliação de frota
 * separada dela —, então o selo verde mede exatamente a mesma cobertura do
 * anel dos indicadores, com o rótulo que descreve o que ela de fato é.
 */
function QualidadeDaApuracao({
  cobertura,
  notCalculable,
  semCorrespondencia,
}: {
  cobertura: CoberturaDePreco | null;
  notCalculable: number;
  semCorrespondencia: number | null;
}) {
  if (!cobertura) return null;

  return (
    <section className="flex flex-wrap items-center gap-x-8 gap-y-2 px-2 py-1 text-xs text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide text-[0.6875rem]">
        Qualidade da apuração
      </span>
      <PontoDeQualidade cor="bg-amber-500">
        <strong className="text-foreground tabular-nums">
          {notCalculable.toLocaleString("pt-BR")}
        </strong>{" "}
        sem preço apurado
      </PontoDeQualidade>
      {semCorrespondencia !== null && semCorrespondencia > 0 && (
        <PontoDeQualidade cor="bg-amber-500">
          <strong className="text-foreground tabular-nums">
            {semCorrespondencia.toLocaleString("pt-BR")}
          </strong>{" "}
          sem correspondência
        </PontoDeQualidade>
      )}
      <PontoDeQualidade cor="bg-emerald-600">
        <strong className="text-foreground tabular-nums">
          {cobertura.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
        </strong>{" "}
        de cobertura de apuração
      </PontoDeQualidade>
    </section>
  );
}

function PontoDeQualidade({ cor, children }: { cor: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("w-2 h-2 rounded-full shrink-0", cor)} />
      {children}
    </span>
  );
}
