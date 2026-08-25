import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  CalendarDays,
  FileText,
  GitCompareArrows,
  Info,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Tv,
  Truck,
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
import { ApiError, fetchJson } from "@/lib/api";
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
  participacao,
  type LadosDoImpacto,
} from "@/lib/visao-geral";
import { juntarPrioridades } from "@/lib/cockpit";
import { lerRecorte, linkDeAlteracoes, nomeDaUnidade } from "@/lib/recorte";
import { unidadesPorImpacto } from "@/components/inicio/visao-geral-consolidada";
import { BeforeAfter } from "@/components/inicio/group-card";
import { LinhaDoTempoDeAlteracoes } from "@/components/linha-do-tempo/linha-do-tempo-de-alteracoes";
import type {
  ChangeGroup,
  FamiliesOverview,
  FamiliesView,
  OverviewContextRef,
  SeriesContext,
} from "@/components/inicio/types";

/**
 * O Dashboard — a tela de vigilância: o que a Ambev mudou, e o que isso custou.
 *
 * A informação está ordenada pela pergunta que ela responde, na ordem em que
 * um executivo faria as perguntas: o que mudou (o cabeçalho e o número de
 * alterações), quanto isso custou (a régua de dinheiro, com o líquido em
 * destaque), onde aconteceu (a linha do tempo e a composição por família) e o
 * que precisa de atenção agora (a tabela de alterações e a faixa de
 * pendências, por último e nunca competindo com o financeiro pelo olho de
 * quem abre a tela).
 *
 * Nada aqui reimplementa a apuração: os cinco números somam `summary.sides`,
 * a tabela lê a mesma fila de prioridade do Acompanhamento
 * (`juntarPrioridades`, `lib/cockpit.ts`), e a composição por família lê
 * `view.families` — os mesmos campos que `lib/visao-geral.ts` já sabia
 * explicar antes desta tela existir.
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
            {overview && <ConteudoGeral overview={overview} onTrocar={trocarPara} />}
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
            {view && <ConteudoDaUnidade view={view} recorte={recorte} consulta={consulta} />}
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
            régua de `pages/inicio.tsx`, que reserva o laranja sólido para a
            ação que a tela existe para oferecer.
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
  consulta,
}: {
  view: FamiliesView;
  recorte: ReturnType<typeof lerRecorte>;
  consulta: URLSearchParams;
}) {
  const cobertura = coberturaDePreco(view.totals.changes, view.impact.notCalculable);

  return (
    <>
      <FaixaDaUnidade view={view} />

      <Indicadores
        changes={view.totals.changes}
        coberturaLabel={cobertura}
        vehiclesTouched={view.totals.vehiclesTouched}
        veiculosPercent={participacao(view.totals.vehiclesTouched, frotaTotal(view))}
        lados={ladosDoImpacto(view)}
      />

      {view.periods.length > 1 && (
        <LinhaDoTempoDeAlteracoes
          consulta={consulta}
          periods={view.periods}
          currentPeriod={view.period}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <ComposicaoDasAlteracoes view={view} />
        </div>
        <div className="lg:col-span-3">
          <PrincipaisAlteracoes view={view} recorte={recorte} />
        </div>
      </div>

      <Pendencias
        changes={view.totals.changes}
        notCalculable={view.impact.notCalculable}
        inconclusive={view.totals.inconclusive}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Geral — o corpo inteiro da tela
// ---------------------------------------------------------------------------

function ConteudoGeral({
  overview,
  onTrocar,
}: {
  overview: FamiliesOverview;
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  const cobertura = coberturaDePreco(overview.summary.changes, overview.summary.notCalculable);

  return (
    <>
      <FaixaGeral overview={overview} />

      <Indicadores
        changes={overview.summary.changes}
        coberturaLabel={cobertura}
        vehiclesTouched={overview.summary.vehiclesTouched}
        veiculosPercent={null}
        lados={ladosDoImpacto(overview)}
      />

      <RankingDeUnidades overview={overview} onTrocar={onTrocar} />

      <Pendencias
        changes={overview.summary.changes}
        notCalculable={overview.summary.notCalculable}
        inconclusive={null}
      />

      <p className="text-xs text-muted-foreground">
        A linha do tempo, a composição por família e a tabela de alterações abrem dentro de
        cada unidade — a soma Geral não mescla o histórico nem os grupos entre elas.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// A faixa de abertura — Geral
// ---------------------------------------------------------------------------

/** A frase de abertura da Visão Geral — o mesmo `summary.impact` que os cartões de baixo leem. */
function FaixaGeral({ overview }: { overview: FamiliesOverview }) {
  const impactos = Object.entries(overview.summary.impact.byPeriodicity)
    .map(([periodicity, amount]) => ({ periodicity, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const total = overview.unitsIncluded.length + overview.unitsExcluded.length;

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex items-start gap-3")}>
      <span className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center shrink-0">
        <Info className="w-[1.125rem] h-[1.125rem] text-brand" />
      </span>
      <p className="text-sm leading-relaxed">
        <strong className="text-base">
          {overview.summary.changes.toLocaleString("pt-BR")}{" "}
          {overview.summary.changes === 1 ? "alteração detectada" : "alterações detectadas"} na
          competência {overview.period}
        </strong>
        , afetando {overview.unitsIncluded.length} de {total}{" "}
        {total === 1 ? "unidade" : "unidades"}
        {impactos.length > 0 && (
          <>
            , com impacto líquido de{" "}
            <strong className={impactos[0].amount < 0 ? "text-red-700" : "text-emerald-700"}>
              {escreverImpacto(impactos[0])}
            </strong>
          </>
        )}
        .
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// A faixa de abertura — Unidade
// ---------------------------------------------------------------------------

function FaixaDaUnidade({ view }: { view: FamiliesView }) {
  const impactos = impactosDaVigencia(view);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex items-start gap-3")}>
      <span className="w-9 h-9 rounded-xl bg-accent flex items-center justify-center shrink-0">
        <Info className="w-[1.125rem] h-[1.125rem] text-brand" />
      </span>
      <p className="text-sm leading-relaxed">
        <strong className="text-base">
          {view.totals.changes.toLocaleString("pt-BR")}{" "}
          {view.totals.changes === 1 ? "alteração detectada" : "alterações detectadas"} em{" "}
          {view.periodLabel}
        </strong>{" "}
        nesta unidade
        {impactos.length > 0 && (
          <>
            , com impacto líquido de{" "}
            <strong className={impactos[0].amount < 0 ? "text-red-700" : "text-emerald-700"}>
              {escreverImpacto(impactos[0])}
            </strong>
          </>
        )}
        .
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cobertura de preço — "18/37 com preço apurado"
// ---------------------------------------------------------------------------

/**
 * "18 de 37 com preço apurado" — a fração de alterações que já viraram
 * dinheiro (apurado ou excluído por já contar noutra parcela), sobre o total.
 *
 * A identidade `apurado + semPreco = total` é a mesma que `porApuracao`
 * (`composicaoDasAlteracoes`) garante nas suas três fatias — aqui só a conta
 * mais simples dela, para uma linha de subtítulo e não um painel inteiro.
 * `null` sem alteração nenhuma: uma fração `0/0` não é cobertura, é ausência
 * de vigência.
 */
function coberturaDePreco(total: number, semPreco: number): string | null {
  if (total === 0) return null;
  const apurado = total - semPreco;
  return `${apurado.toLocaleString("pt-BR")}/${total.toLocaleString("pt-BR")} com preço apurado`;
}

// ---------------------------------------------------------------------------
// Os indicadores — o financeiro tem o peso visual maior
// ---------------------------------------------------------------------------

/**
 * Os cinco números que respondem "o que mudou" e "quanto custou" — na mesma
 * régua para a Unidade e para o Geral, porque `FamiliesOverview.summary` tem a
 * mesma forma de `ExecutiveSummary` que `FamiliesView.summary`.
 *
 * O Impacto líquido ocupa o dobro da largura dos outros e tem o corpo maior —
 * é o número que a Ambev perguntada em reunião primeiro, e a régua visual diz
 * isso antes de qualquer um ler o rótulo.
 */
function Indicadores({
  changes,
  coberturaLabel,
  vehiclesTouched,
  veiculosPercent,
  lados,
}: {
  changes: number;
  coberturaLabel: string | null;
  vehiclesTouched: number;
  veiculosPercent: number | null;
  lados: LadosDoImpacto[];
}) {
  const principal = lados[0] ?? null;

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
      <Cartao icone={FileText} titulo="Alterações detectadas" className="lg:col-span-1">
        <p className="text-3xl font-extrabold tabular-nums">{changes.toLocaleString("pt-BR")}</p>
        {coberturaLabel && (
          <p className="text-xs text-muted-foreground mt-3">{coberturaLabel}</p>
        )}
      </Cartao>

      <Cartao icone={Truck} titulo="Itens afetados" className="lg:col-span-1">
        <p className="text-3xl font-extrabold tabular-nums">
          {vehiclesTouched.toLocaleString("pt-BR")}
        </p>
        {veiculosPercent !== null && (
          <p className="text-xs text-muted-foreground mt-3">
            {veiculosPercent.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da frota
          </p>
        )}
      </Cartao>

      <Cartao icone={TrendingDown} titulo="Perdas/mês" className="lg:col-span-1">
        {principal ? (
          <p className="text-3xl font-extrabold tabular-nums text-red-700">
            {formatBrlShort(principal.perdas)}
            {principal.periodicity !== "MENSAL" && (
              <span className="text-xs font-normal text-muted-foreground block mt-1">
                {periodicitySuffix(principal.periodicity)}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">sem valor apurado</p>
        )}
      </Cartao>

      <Cartao icone={TrendingUp} titulo="Ganhos/mês" className="lg:col-span-1">
        {principal ? (
          <p className="text-3xl font-extrabold tabular-nums text-emerald-700">
            {formatBrlShort(principal.ganhos)}
            {principal.periodicity !== "MENSAL" && (
              <span className="text-xs font-normal text-muted-foreground block mt-1">
                {periodicitySuffix(principal.periodicity)}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">sem valor apurado</p>
        )}
      </Cartao>

      <Cartao
        icone={ReceiptText}
        titulo="Impacto líquido/mês"
        className="col-span-2 lg:col-span-2"
        destaque
      >
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
        destaque && "bg-accent/40 border-brand/30",
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
// Onde a Ambev alterou — composição por família
// ---------------------------------------------------------------------------

/**
 * As famílias mais tocadas, na periodicidade dominante da vigência — a mesma
 * disciplina do pódio do Resumo executivo: o ranking existe dentro de uma
 * periodicidade só, nunca somando R$/mês com R$/ano.
 *
 * Cada linha traz a contagem de alterações ao lado da barra de R$, porque
 * "onde a Ambev alterou" é tanto uma pergunta de dinheiro quanto de
 * quantidade — uma família pode concentrar metade das alterações e não ter
 * ainda nenhum preço apurado.
 */
function ComposicaoDasAlteracoes({ view }: { view: FamiliesView }) {
  const dominante = impactosDaVigencia(view)[0]?.periodicity ?? null;
  const comImpacto = (dominante === null
    ? []
    : view.families
        .map((f) => ({ nome: f.name, changes: f.changes, amount: f.impact.byPeriodicity[dominante] ?? 0 }))
        .filter((f) => f.amount !== 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  ).slice(0, 6);

  // Sem impacto apurado nenhum, a família ainda tem o que dizer: quantas
  // alterações ela concentrou. Uma barra de quantidade substitui a de R$ em
  // vez de deixar o cartão vazio.
  const porQuantidade =
    comImpacto.length === 0
      ? [...view.families]
          .filter((f) => f.changes > 0)
          .sort((a, b) => b.changes - a.changes)
          .slice(0, 6)
      : [];

  const teto = comImpacto.reduce((maior, l) => Math.max(maior, Math.abs(l.amount)), 0);
  const tetoQuantidade = porQuantidade.reduce((maior, f) => Math.max(maior, f.changes), 0);
  const { entitiesAdded, entitiesRemoved } = view.totals;

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col h-full")}>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-bold">Onde a Ambev alterou</h2>
        {dominante && comImpacto.length > 0 && (
          <span className="text-xs font-semibold text-muted-foreground">
            em R${periodicitySuffix(dominante)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">Por família da remuneração.</p>

      {comImpacto.length > 0 ? (
        <ol className="space-y-3 flex-1">
          {comImpacto.map((linha) => (
            <li key={linha.nome} className="flex items-center gap-3">
              <span className="w-28 shrink-0 min-w-0 text-sm font-semibold truncate" title={linha.nome}>
                {linha.nome}
              </span>
              <span className="flex-1 h-2.5 bg-muted overflow-hidden min-w-8">
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
              <span className="text-[0.6875rem] text-muted-foreground w-14 text-right shrink-0">
                {linha.changes} alt.
              </span>
            </li>
          ))}
        </ol>
      ) : porQuantidade.length > 0 ? (
        <ol className="space-y-3 flex-1">
          {porQuantidade.map((familia) => (
            <li key={familia.code} className="flex items-center gap-3">
              <span className="w-28 shrink-0 min-w-0 text-sm font-semibold truncate" title={familia.name}>
                {familia.name}
              </span>
              <span className="flex-1 h-2.5 bg-muted overflow-hidden min-w-8">
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

      {(entitiesAdded > 0 || entitiesRemoved > 0) && (
        <p className="text-[0.6875rem] text-muted-foreground border-t pt-3 mt-4">
          {entitiesAdded > 0 && `${entitiesAdded} ${entitiesAdded === 1 ? "ativo entrou" : "ativos entraram"}`}
          {entitiesAdded > 0 && entitiesRemoved > 0 && " · "}
          {entitiesRemoved > 0 && `${entitiesRemoved} ${entitiesRemoved === 1 ? "ativo saiu" : "ativos saíram"}`}
          {" "}na frota, além das alterações de valor.
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
 * alteração usam, para não reescrever a regra de quando um total existe e
 * quando só existe faixa de variação.
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

                return (
                  <tr key={grupo.key} className="border-t hover:bg-accent/30 transition-colors">
                    <td className="px-2 py-2.5 align-top">
                      <Link href={href} className="font-semibold hover:text-brand transition-colors">
                        {grupo.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">{grupo.equipment}</div>
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
// Ranking de unidades — Geral, sempre visível
// ---------------------------------------------------------------------------

/**
 * O ranking de unidades da Visão Geral, sempre visível — nunca atrás de um
 * clique ou de uma gaveta (`Sheet`). É o que substitui, neste modo, as duas
 * colunas "Onde a Ambev alterou" / "Principais alterações": a soma Geral não
 * mescla `families`/`groups` entre unidades (`FamiliesOverview` não os tem —
 * ver o limite documentado em `lib/comparison/src/families-view-overview.ts`),
 * então o que existe para mostrar aqui é a comparação unidade a unidade, e não
 * o detalhe de uma soma que não pode ser aberta.
 *
 * A ordem é a mesma de `unidadesPorImpacto` — maior módulo de impacto
 * primeiro —, e cada linha leva à Dashboard daquela unidade.
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
        <h2 className="text-base font-bold">Unidades, por impacto líquido</h2>
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
// Pendências — faixa secundária, sempre visível, nunca compete com o financeiro
// ---------------------------------------------------------------------------

/**
 * O que ainda falta apurar — de propósito discreta: números pequenos, sem
 * cartão de destaque, para que a régua financeira lá em cima continue sendo a
 * primeira coisa que se lê. É trabalho pendente, não uma falha da tela.
 */
function Pendencias({
  changes,
  notCalculable,
  inconclusive,
}: {
  changes: number;
  notCalculable: number;
  inconclusive: number | null;
}) {
  if (changes === 0) return null;
  const coberturaPercent = ((changes - notCalculable) / changes) * 100;

  return (
    <section className="flex flex-wrap items-center gap-x-8 gap-y-2 px-2 py-1 text-xs text-muted-foreground">
      <span className="font-semibold uppercase tracking-wide text-[0.6875rem]">Pendências</span>
      <span>
        <strong className="text-foreground tabular-nums">{notCalculable.toLocaleString("pt-BR")}</strong>{" "}
        sem preço apurado
      </span>
      {inconclusive !== null && (
        <span>
          <strong className="text-foreground tabular-nums">{inconclusive.toLocaleString("pt-BR")}</strong>{" "}
          {inconclusive === 1 ? "inconclusiva" : "inconclusivas"}
        </span>
      )}
      <span>
        <strong className="text-foreground tabular-nums">
          {coberturaPercent.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
        </strong>{" "}
        de cobertura de apuração
      </span>
    </section>
  );
}
