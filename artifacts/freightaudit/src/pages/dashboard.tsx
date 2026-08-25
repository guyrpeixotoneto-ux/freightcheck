import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  CalendarDays,
  FileText,
  GitCompareArrows,
  Info,
  ReceiptText,
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
  ultimasAlteracoes,
} from "@/lib/visao-geral";
import { lerRecorte, nomeDaUnidade } from "@/lib/recorte";
import { VisaoGeralConteudo } from "@/components/inicio/visao-geral-consolidada";
import { ListaDeAlteracoesRecentes } from "@/components/dashboard/lista-de-alteracoes-recentes";
import { LinhaDoTempoDeAlteracoes } from "@/components/linha-do-tempo/linha-do-tempo-de-alteracoes";
import type { FamiliesOverview, FamiliesView, SeriesContext } from "@/components/inicio/types";

/**
 * O Dashboard — a tela de vigilância: o que a Ambev mudou, e o que isso custou.
 *
 * É a mesma leitura do Resumo executivo, recortada para uma pergunta só —
 * "algo mudou sem eu saber?" — e por isso não reimplementa nada da apuração:
 * Geral chama `<VisaoGeralConteudo>` (o mesmo bloco que o Resumo executivo e a
 * Linha do Tempo já usam) e Unidade lê os mesmos campos de `FamiliesView` que
 * `lib/visao-geral.ts` já sabe explicar. O que esta tela acrescenta é a frase
 * de abertura e o botão para a Gestão à Vista — o mesmo recorte, em telão.
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
            {overview && (
              <>
                <FaixaGeral overview={overview} />
                <VisaoGeralConteudo
                  overview={overview}
                  search={search}
                  onTrocar={trocarPara}
                  notaExtra="A linha do tempo e as alterações recentes por unidade abrem dentro de cada unidade — a soma Geral não mescla o histórico entre elas."
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
              <ApiErrorNotice error={vigencia.error} what="Não foi possível montar o Dashboard." />
            )}
            {!vigencia.isLoading && !vigencia.error && view === null && <BancoVazio />}
          </>
        )}

        {view && (
          <>
            <FaixaDaUnidade view={view} />
            <Indicadores view={view} />
            <QuantidadeAfetada view={view} />

            <div className="grid gap-5 lg:grid-cols-2">
              <ComposicaoDasAlteracoes view={view} />
              <div className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
                <h2 className="text-base font-bold mb-1">Alterações recentes</h2>
                <p className="text-xs text-muted-foreground mb-3">
                  As mesmas alterações desta vigência, na ordem do Acompanhamento — dinheiro
                  primeiro, ruído por último.
                </p>
                <ListaDeAlteracoesRecentes linhas={ultimasAlteracoes(view, 6, recorte)} />
              </div>
            </div>

            {view.periods.length > 1 && (
              <LinhaDoTempoDeAlteracoes
                consulta={consulta}
                periods={view.periods}
                currentPeriod={view.period}
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
// Os indicadores da unidade
// ---------------------------------------------------------------------------

function Indicadores({ view }: { view: FamiliesView }) {
  const lados = ladosDoImpacto(view).filter((l) => l.fatiaDeGanho !== null);
  const frota = frotaTotal(view);
  const veiculos = participacao(view.totals.vehiclesTouched, frota);

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Cartao icone={FileText} titulo="Alterações detectadas">
        <p className="text-3xl font-extrabold tabular-nums">
          {view.totals.changes.toLocaleString("pt-BR")}
        </p>
        <p className="text-xs text-muted-foreground mt-3">
          {view.totals.groups} pontos da remuneração tocados
        </p>
      </Cartao>

      <Cartao icone={Truck} titulo="Itens impactados">
        <p className="text-3xl font-extrabold tabular-nums">
          {view.totals.vehiclesTouched.toLocaleString("pt-BR")}
        </p>
        {veiculos !== null && (
          <p className="text-xs text-muted-foreground mt-3">
            {veiculos.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% da frota (
            {frota.toLocaleString("pt-BR")} ativos)
          </p>
        )}
      </Cartao>

      <Cartao icone={ReceiptText} titulo="Impacto líquido">
        {lados.length === 0 ? (
          <p className="text-xl font-extrabold text-muted-foreground">Nenhum valor apurável</p>
        ) : (
          <>
            <p
              className={cn(
                "text-3xl font-extrabold tabular-nums",
                lados[0].liquido < 0 ? "text-red-700" : "text-emerald-700",
              )}
            >
              {formatBrlShort(lados[0].liquido)}
              <span className="text-sm font-normal text-muted-foreground">
                {periodicitySuffix(lados[0].periodicity)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              +{formatBrlShort(lados[0].ganhos)} / {formatBrlShort(lados[0].perdas)}
            </p>
          </>
        )}
      </Cartao>

      <Cartao icone={AlertTriangle} titulo="Sem impacto calculável">
        <p className="text-3xl font-extrabold tabular-nums">
          {view.impact.notCalculable.toLocaleString("pt-BR")}
        </p>
        <p className="text-xs text-muted-foreground mt-3">alterações reais sem preço apurado</p>
      </Cartao>
    </div>
  );
}

function Cartao({
  icone: Icone,
  titulo,
  children,
}: {
  icone: typeof FileText;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn(CARTAO, "p-5 flex flex-col")}>
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
// Quantidade afetada
// ---------------------------------------------------------------------------

function QuantidadeAfetada({ view }: { view: FamiliesView }) {
  const { entitiesAdded, entitiesRemoved, unchanged, inconclusive } = view.totals;

  return (
    <section className={cn(CARTAO, "px-6 py-5")}>
      <h2 className="text-base font-bold mb-4">Quantidade afetada</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Numero rotulo="Entraram" valor={entitiesAdded} />
        <Numero rotulo="Saíram" valor={entitiesRemoved} />
        <Numero rotulo="Sem mudança" valor={unchanged} />
        <Numero rotulo="Inconclusivo" valor={inconclusive} />
      </div>
    </section>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <p className="text-2xl font-extrabold tabular-nums mt-1">{valor.toLocaleString("pt-BR")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composição das alterações, por família
// ---------------------------------------------------------------------------

/**
 * As famílias mais tocadas, na periodicidade dominante da vigência.
 *
 * A mesma disciplina do pódio do Resumo executivo: o ranking existe dentro de
 * uma periodicidade só, nunca somando R$/mês com R$/ano.
 */
function ComposicaoDasAlteracoes({ view }: { view: FamiliesView }) {
  const dominante = impactosDaVigencia(view)[0]?.periodicity ?? null;
  const linhas = (dominante === null
    ? []
    : view.families
        .map((f) => ({ nome: f.name, amount: f.impact.byPeriodicity[dominante] ?? 0 }))
        .filter((f) => f.amount !== 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
  ).slice(0, 8);
  const teto = linhas.reduce((maior, l) => Math.max(maior, Math.abs(l.amount)), 0);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col")}>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-bold">Composição das alterações</h2>
        {dominante && (
          <span className="text-xs font-semibold text-muted-foreground">
            em R${periodicitySuffix(dominante)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">Por família, a de maior impacto primeiro.</p>

      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground flex-1">
          Nenhuma família tem impacto apurado nesta vigência.
        </p>
      ) : (
        <ol className="space-y-3 flex-1">
          {linhas.map((linha) => (
            <li key={linha.nome} className="flex items-center gap-3">
              <span className="w-40 shrink-0 min-w-0 text-sm font-semibold truncate" title={linha.nome}>
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
                  "text-sm font-bold tabular-nums w-28 text-right",
                  linha.amount < 0 ? "text-red-700" : "text-emerald-700",
                )}
              >
                {escreverImpacto({ periodicity: dominante, amount: linha.amount })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
