import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Clock,
  FileText,
  Gauge,
  GitCompareArrows,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Truck,
  Tv,
} from "lucide-react";
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
import { ApiError, fetchJson, fetchJsonOrNull } from "@/lib/api";
import { useContextosDaCasca } from "@/lib/contextos";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { DASHBOARD, GESTAO_A_VISTA } from "@/lib/ambiente";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  escreverImpacto,
  frotaTotal,
  impactosDaVigencia,
  ladosDoImpacto,
  type Impacto,
  type LadosDoImpacto,
} from "@/lib/visao-geral";
import { juntarPrioridades } from "@/lib/cockpit";
import { lerRecorte, linkDeAlteracoes, nomeDaUnidade } from "@/lib/recorte";
import { unidadesPorImpacto } from "@/components/inicio/visao-geral-consolidada";
import { BeforeAfter } from "@/components/inicio/group-card";
import { Sparkline } from "@/components/dashboard/sparkline";
import { AnelDeCobertura } from "@/components/dashboard/anel-de-cobertura";
import { GraficoDeImpacto, pontosDeImpacto, type PontoDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import { iconeDaAlteracao } from "@/components/dashboard/icone-da-alteracao";
import type {
  ChangeGroup,
  FamiliesOverview,
  FamiliesView,
  OverviewContextRef,
  SeriesContext,
} from "@/components/inicio/types";
import type { Movimentos } from "@/lib/analise";

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
  // exista. Só existe em modo Unidade: a Visão Geral não mescla histórico
  // entre unidades (mesmo limite documentado em `ConteudoGeral`), então não
  // há intervalo a pedir.
  const janela = useMemo(() => {
    if (!view || view.periods.length <= 1) return null;
    const ordenadas = [...view.periods].sort((a, b) => a.date.localeCompare(b.date));
    return ordenadas.slice(-6);
  }, [view]);

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
              <ConteudoGeral overview={overview} atualizadoEm={atualizadoEm} onTrocar={trocarPara} />
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
  onTrocar,
  paraGestaoAVista,
}: {
  view: FamiliesView | null;
  overview: FamiliesOverview | null;
  visaoGeral: boolean;
  periodosOverview: string[];
  contextos: SeriesContext[];
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
            : view &&
              view.periods.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger className={BOTAO_DE_TROCA}>
                    <CalendarDays className="w-4 h-4" />
                    Trocar vigência
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

          {/*
            O botão da Gestão à Vista é o único cheio desta tela — a mesma
            régua de `pages/inicio.tsx`, que reserva a cor sólida da marca para
            a ação que a tela existe para oferecer.
          */}
          <Link
            href={paraGestaoAVista}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-brand-foreground hover:opacity-90 transition-opacity"
          >
            <Tv className="w-4 h-4" />
            Gestão à Vista
          </Link>
        </div>
      </div>
    </header>
  );
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

  const { pontos, periodicity } = useMemo(() => {
    if (!movimentos) return { pontos: [] as PontoDeImpacto[], periodicity: null as string | null };
    const ordenadas = [...movimentos.periods].sort((a, b) => a.date.localeCompare(b.date));
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
        vehiclesTouched={view.totals.vehiclesTouched}
        atualizadoEm={atualizadoEm}
      />

      <Indicadores principal={principal} cobertura={cobertura} sparklines={sparklines} />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <section className={cn(CARTAO, "px-6 py-5 h-full")}>
            <h2 className="text-base font-bold mb-1">Impacto das alterações por competência</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Ganhos e perdas divergindo do zero, com o líquido por cima.
            </p>
            <GraficoDeImpacto pontos={pontos} periodicity={periodicity} />
          </section>
        </div>
        <div className="lg:col-span-2">
          <MaioresImpactos view={view} />
        </div>
      </div>

      <PrincipaisAlteracoes view={view} recorte={recorte} />

      <MovimentacaoDaFrota view={view} />

      <QualidadeDaApuracao
        cobertura={cobertura}
        notCalculable={view.impact.notCalculable}
        semCorrespondencia={view.totals.inconclusive}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Geral — o corpo inteiro da tela
// ---------------------------------------------------------------------------

function ConteudoGeral({
  overview,
  atualizadoEm,
  onTrocar,
}: {
  overview: FamiliesOverview;
  atualizadoEm: number;
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  const cobertura = coberturaDePreco(overview.summary.changes, overview.summary.notCalculable);
  const principal = ladosDoImpacto(overview)[0] ?? null;

  return (
    <>
      <FaixaSlim
        changes={overview.summary.changes}
        vehiclesTouched={overview.summary.vehiclesTouched}
        atualizadoEm={atualizadoEm}
      />

      <Indicadores principal={principal} cobertura={cobertura} sparklines={null} />

      <RankingDeUnidades overview={overview} onTrocar={onTrocar} />

      <QualidadeDaApuracao cobertura={cobertura} notCalculable={overview.summary.notCalculable} semCorrespondencia={null} />

      <p className="text-xs text-muted-foreground">
        O gráfico de impacto por competência, o pódio de maiores impactos e a tabela de alterações
        abrem dentro de cada unidade — a soma Geral não mescla o histórico nem os grupos entre elas.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// A faixa fina de abertura — Unidade e Geral, a mesma leitura
// ---------------------------------------------------------------------------

/**
 * "33 alterações detectadas desde a competência anterior · 27 veículos
 * afetados", com o relógio da última atualização do outro lado.
 *
 * Substitui o cartão grande de abertura das duas primeiras versões desta tela
 * — os mesmos dois números (`changes`/`vehiclesTouched`), sem a frase de
 * impacto: o líquido já tem cartão próprio logo abaixo, com corpo maior do que
 * uma frase soubesse dar a ele.
 *
 * O relógio nunca fabrica hora: é `dataUpdatedAt` da própria consulta
 * (`useQuery`), a mesma leitura da Gestão à Vista — `0` antes da primeira
 * resposta, e a faixa diz isso em vez de inventar um horário.
 */
function FaixaSlim({
  changes,
  vehiclesTouched,
  atualizadoEm,
}: {
  changes: number;
  vehiclesTouched: number;
  atualizadoEm: number;
}) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-1 py-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>
          <strong className="text-foreground tabular-nums">{changes.toLocaleString("pt-BR")}</strong>{" "}
          {changes === 1 ? "alteração detectada" : "alterações detectadas"} desde a competência
          anterior
          {vehiclesTouched > 0 && (
            <>
              {" "}
              ·{" "}
              <strong className="text-foreground tabular-nums">
                {vehiclesTouched.toLocaleString("pt-BR")}
              </strong>{" "}
              {vehiclesTouched === 1 ? "veículo afetado" : "veículos afetados"}
            </>
          )}
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
      <Cartao icone={TrendingDown} titulo="Perdas mensais">
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

      <Cartao icone={TrendingUp} titulo="Ganhos mensais">
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

      <Cartao icone={ReceiptText} titulo="Impacto líquido" destaque>
        {principal ? (
          <>
            <p
              className={cn(
                "text-5xl font-extrabold tabular-nums leading-none",
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

      <Cartao icone={Gauge} titulo="Cobertura financeira">
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
  children,
  className,
  destaque = false,
}: {
  icone: typeof FileText;
  titulo: string;
  children: React.ReactNode;
  className?: string;
  destaque?: boolean;
}) {
  return (
    <section
      className={cn(
        CARTAO,
        "p-5 flex flex-col",
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
// Maiores impactos desta competência — antiga "Onde a Ambev alterou"
// ---------------------------------------------------------------------------

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
function MaioresImpactos({ view }: { view: FamiliesView }) {
  const dominante = impactosDaVigencia(view)[0]?.periodicity ?? null;
  const comImpacto = (dominante === null
    ? []
    : view.families
        .map((f) => ({ nome: f.name, changes: f.changes, amount: f.impact.byPeriodicity[dominante] ?? 0 }))
        .filter((f) => f.amount !== 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  ).slice(0, 5);

  // Sem impacto apurado nenhum, a família ainda tem o que dizer: quantas
  // alterações ela concentrou. Uma barra de quantidade substitui a de R$ em
  // vez de deixar o cartão vazio.
  const porQuantidade =
    comImpacto.length === 0
      ? [...view.families]
          .filter((f) => f.changes > 0)
          .sort((a, b) => b.changes - a.changes)
          .slice(0, 5)
      : [];

  const teto = comImpacto.reduce((maior, l) => Math.max(maior, Math.abs(l.amount)), 0);
  const tetoQuantidade = porQuantidade.reduce((maior, f) => Math.max(maior, f.changes), 0);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col h-full")}>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-bold">Maiores impactos desta competência</h2>
        {dominante && comImpacto.length > 0 && (
          <span className="text-xs font-semibold text-muted-foreground">
            em R${periodicitySuffix(dominante)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">Por família da remuneração.</p>

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
 * As alterações mais relevantes desta vigência, na ordem de prioridade do
 * cockpit — a mesma fila que o Acompanhamento e `ultimasAlteracoes` já usam
 * (`juntarPrioridades`, `lib/cockpit.ts`). Reordenar aqui por conta própria
 * faria esta tabela discordar da lista de "Alterações recentes" que já existe
 * no produto sobre os mesmos dados.
 *
 * Cada linha mostra `grupo.title` — a etiqueta de negócio já curada por
 * `attributeLabel()` no servidor — e nunca `attributeCode` cru. O par
 * antes/depois vem de `<BeforeAfter>`, o mesmo componente que os cartões de
 * alteração usam. O ícone à esquerda do título é só decorativo
 * (`iconeDaAlteracao`): uma pista de que tipo de mudança é aquela, com uma
 * etiqueta neutra sempre que a régua de palavras-chave não reconhece nada —
 * nunca um ícone específico arriscado por adivinhação.
 */
function PrincipaisAlteracoes({
  view,
  recorte,
}: {
  view: FamiliesView;
  recorte: ReturnType<typeof lerRecorte>;
}) {
  const fila = juntarPrioridades(view);
  const grupos: ChangeGroup[] = (fila.length > 0 ? fila.map((e) => e.group) : view.groups).slice(
    0,
    8,
  );
  const daVigencia = { ...recorte, period: view.period };

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col h-full")}>
      <h2 className="text-base font-bold mb-1">Principais alterações</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Na ordem do Acompanhamento — dinheiro e criticidade primeiro.
      </p>

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
                <th className="font-semibold px-2 pb-2">Antes → agora</th>
                <th className="font-semibold px-2 pb-2 text-right">Veíc.</th>
                <th className="font-semibold px-2 pb-2 text-right">Impacto</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((grupo) => {
                const filtros: Record<string, string> = {};
                if (grupo.attributeCode) filtros.attributeCode = grupo.attributeCode;
                if (grupo.entityType) filtros.entityType = grupo.entityType;
                const href = linkDeAlteracoes({ recorte: daVigencia, filtros });
                const comPreco = grupo.impact.confidence === "CALCULATED" && grupo.impact.amount !== null;
                const Icone = iconeDaAlteracao(grupo);

                return (
                  <tr key={grupo.key} className="border-t hover:bg-accent/30 transition-colors">
                    <td className="px-2 py-2.5 align-top">
                      <div className="flex items-start gap-2">
                        <span className="w-6 h-6 rounded-md bg-accent flex items-center justify-center shrink-0 mt-0.5">
                          <Icone className="w-3.5 h-3.5 text-brand" strokeWidth={2.25} />
                        </span>
                        <div className="min-w-0">
                          <Link href={href} className="font-semibold hover:text-brand transition-colors">
                            {grupo.title}
                          </Link>
                          <div className="text-xs text-muted-foreground">{grupo.equipment}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 align-top text-xs">
                      <BeforeAfter group={grupo} />
                    </td>
                    <td className="px-2 py-2.5 align-top text-right tabular-nums text-xs text-muted-foreground">
                      {grupo.vehicles.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-2 py-2.5 align-top text-right tabular-nums">
                      {comPreco ? (
                        <span className={cn("font-bold", grupo.impact.amount! < 0 ? "text-red-700" : "text-emerald-700")}>
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
 * Só aparece em modo Unidade: a Visão Geral não soma `entitiesAdded`/
 * `entitiesRemoved` entre unidades (o mesmo limite de `FamiliesOverview` que
 * já tira families/groups da soma).
 */
function MovimentacaoDaFrota({ view }: { view: FamiliesView }) {
  const { entitiesAdded, entitiesRemoved } = view.totals;
  const ativos = frotaTotal(view);

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
 * clique ou de uma gaveta (`Sheet`). É o que substitui, neste modo, o gráfico
 * de impacto e o pódio de maiores impactos: a soma Geral não mescla
 * `families`/`groups` entre unidades (`FamiliesOverview` não os tem — ver o
 * limite documentado em `lib/comparison/src/families-view-overview.ts`),
 * então o que existe para mostrar aqui é a comparação unidade a unidade, e não
 * o detalhe de uma soma que não pode ser aberta.
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
