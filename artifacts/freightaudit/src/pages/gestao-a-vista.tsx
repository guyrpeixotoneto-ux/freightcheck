import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { ArrowLeft, FileText, ReceiptText, TrendingDown, TrendingUp, Truck } from "lucide-react";
import { ApiError, fetchJson } from "@/lib/api";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { DASHBOARD } from "@/lib/ambiente";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { escreverImpacto, ladosDoImpacto, ultimasAlteracoes } from "@/lib/visao-geral";
import { lerRecorte, nomeDaUnidade } from "@/lib/recorte";
import { unidadesPorImpacto } from "@/components/inicio/visao-geral-consolidada";
import { ListaDeAlteracoesRecentes } from "@/components/dashboard/lista-de-alteracoes-recentes";
import type { FamiliesOverview, FamiliesView } from "@/components/inicio/types";

/**
 * A Gestão à Vista — o mesmo recorte do Dashboard, em formato de telão.
 *
 * Sem `<Layout>`: esta tela existe para ficar aberta numa TV, e a lateral e o
 * cabeçalho vermelho não servem a ninguém a três metros de distância. O
 * precedente é `ApresentacaoVideo` (`/apresentacao`), que sai da casca pela
 * mesma razão.
 *
 * Lê exatamente o que o Dashboard lê — `/changes/families/overview` ou
 * `/changes/families`, o mesmo `scopeHash`/`canal`/`period`/`visaoGeral` da
 * URL — e não inventa uma terceira fonte: o que muda é o `refetchInterval` de
 * 30s, que mantém o telão sozinho sem que ninguém precise tocar nele.
 */
export default function GestaoAVista() {
  const search = useSearch();
  const parametros = new URLSearchParams(search);

  const consulta = new URLSearchParams();
  for (const chave of ["period", "scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }
  const sufixo = consulta.toString() ? `?${consulta}` : "";
  const visaoGeral = parametros.get("visaoGeral") === "1";
  const recorte = lerRecorte(search);

  const vigencia = useQuery({
    queryKey: ["families", "gestao-a-vista", consulta.toString()],
    enabled: !visaoGeral,
    refetchInterval: 30_000,
    queryFn: async () => {
      try {
        return await fetchJson<FamiliesView>(`/changes/families${sufixo}`);
      } catch (erro) {
        if (erro instanceof ApiError && erro.status === 404) return null;
        throw erro;
      }
    },
  });

  const periodoPedido = parametros.get("period");
  const overviewQuery = useFamiliesOverviewQuery(periodoPedido, {
    enabled: visaoGeral,
    refetchInterval: 30_000,
  });

  const view = visaoGeral ? null : (vigencia.data ?? null);
  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;
  const atualizadaEm = visaoGeral ? overviewQuery.dataUpdatedAt : vigencia.dataUpdatedAt;

  const paraDashboard = consulta.toString() ? `${DASHBOARD}?${consulta}` : DASHBOARD;

  return (
    <div className="w-full min-h-[100dvh] bg-slate-950 text-slate-50 font-sans">
      <div className="px-10 py-8 max-w-[1800px] mx-auto space-y-8">
        <Topo
          titulo={visaoGeral ? "Visão Geral" : view ? nomeDaUnidade(view.context) : "Gestão à Vista"}
          competencia={visaoGeral ? overview?.period : view?.periodLabel}
          paraDashboard={paraDashboard}
          atualizadaEm={atualizadaEm}
        />

        {visaoGeral ? (
          overview ? (
            <ConteudoGeral overview={overview} />
          ) : (
            <MensagemDeEstado
              carregando={overviewQuery.isLoading}
              erro={overviewQuery.error !== null}
            />
          )
        ) : view ? (
          <ConteudoDaUnidade view={view} recorte={recorte} />
        ) : (
          <MensagemDeEstado carregando={vigencia.isLoading} erro={vigencia.error !== null} />
        )}
      </div>
    </div>
  );
}

function Topo({
  titulo,
  competencia,
  paraDashboard,
  atualizadaEm,
}: {
  titulo: string;
  competencia?: string | null;
  paraDashboard: string;
  atualizadaEm: number;
}) {
  return (
    <header className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
          Gestão à Vista
        </p>
        <h1 className="text-4xl font-extrabold tracking-tight truncate">
          {titulo}
          {competencia && <span className="text-slate-400 font-normal"> · {competencia}</span>}
        </h1>
      </div>
      <div className="flex items-center gap-5 shrink-0">
        <Relogio atualizadaEm={atualizadaEm} />
        <Link
          href={paraDashboard}
          className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar ao Dashboard
        </Link>
      </div>
    </header>
  );
}

/**
 * O relógio que só sabe o que a consulta confirmou.
 *
 * `dataUpdatedAt` é zero antes da primeira resposta — não há "última
 * atualização" nesse instante, e a tela diz isso em vez de fabricar um horário.
 * O texto se atualiza por conta própria a cada minuto, e não só a cada
 * refetch, porque "há 4min" precisa envelhecer mesmo entre uma consulta e outra.
 */
function Relogio({ atualizadaEm }: { atualizadaEm: number }) {
  const [, forcarRenderizacao] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forcarRenderizacao((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (atualizadaEm === 0) {
    return <p className="text-sm text-slate-400">aguardando a primeira resposta…</p>;
  }

  return (
    <div className="text-right">
      <p className="text-[0.6875rem] uppercase tracking-wide text-slate-400">Última atualização</p>
      <p className="text-lg font-bold tabular-nums">
        {new Date(atualizadaEm).toLocaleTimeString("pt-BR")}
      </p>
    </div>
  );
}

function MensagemDeEstado({ carregando, erro }: { carregando: boolean; erro: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-8 py-16 text-center">
      <p className="text-2xl font-bold">
        {carregando
          ? "Carregando…"
          : erro
            ? "Não foi possível ler esta competência agora."
            : "Nenhuma vigência para mostrar nesta competência."}
      </p>
      {erro && (
        <p className="text-slate-400 mt-2">O telão tenta de novo sozinho na próxima atualização.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geral
// ---------------------------------------------------------------------------

function ConteudoGeral({ overview }: { overview: FamiliesOverview }) {
  const impactos = Object.entries(overview.summary.impact.byPeriodicity)
    .map(([periodicity, amount]) => ({ periodicity, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const total = overview.unitsIncluded.length + overview.unitsExcluded.length;
  const unidades = unidadesPorImpacto(overview);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <Ladrilho icone={FileText} rotulo="Alterações identificadas" valor={overview.summary.changes.toLocaleString("pt-BR")} />
        <Ladrilho icone={Truck} rotulo="Unidades monitoradas" valor={`${overview.unitsIncluded.length} de ${total}`} />
        <LadrilhoDeImpacto rotulo="Impacto líquido" impacto={impactos[0] ?? null} />
        <Ladrilho icone={Truck} rotulo="Veículos afetados" valor={overview.summary.vehiclesTouched.toLocaleString("pt-BR")} />
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 px-8 py-7">
        <h2 className="text-xl font-bold mb-5">Unidades que exigem atenção</h2>
        {unidades.length === 0 ? (
          <p className="text-slate-400">Nenhuma unidade entrou na soma desta competência.</p>
        ) : (
          <ol className="space-y-4">
            {unidades.slice(0, 8).map(({ unidade, impacto }, indice) => (
              <li key={unidade.unidade} className="flex items-center gap-5">
                <span className="w-8 h-8 rounded-full border border-slate-700 text-sm font-bold flex items-center justify-center shrink-0">
                  {indice + 1}
                </span>
                <span className="min-w-0 flex-1 text-lg font-semibold truncate">{unidade.label}</span>
                <span className="text-slate-400 text-sm tabular-nums shrink-0">
                  {unidade.summary.changes} alt.
                </span>
                <span
                  className={cn(
                    "text-xl font-extrabold tabular-nums shrink-0 w-40 text-right",
                    impacto === null
                      ? "text-slate-500 font-normal text-base"
                      : impacto.amount < 0
                        ? "text-red-400"
                        : "text-emerald-400",
                  )}
                >
                  {impacto ? escreverImpacto(impacto) : "—"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="text-sm text-slate-500">
        A linha do tempo e as alterações recentes só existem dentro de uma unidade — a soma
        Geral não mescla histórico nem linhas de alteração entre unidades. Abra uma unidade no
        Dashboard para ver as duas.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unidade
// ---------------------------------------------------------------------------

function ConteudoDaUnidade({
  view,
  recorte,
}: {
  view: FamiliesView;
  recorte: ReturnType<typeof lerRecorte>;
}) {
  const lados = ladosDoImpacto(view).filter((l) => l.fatiaDeGanho !== null);
  const linhas = ultimasAlteracoes(view, 8, recorte);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <Ladrilho icone={FileText} rotulo="Alterações identificadas" valor={view.totals.changes.toLocaleString("pt-BR")} />
        <Ladrilho icone={Truck} rotulo="Itens impactados" valor={view.totals.vehiclesTouched.toLocaleString("pt-BR")} />
        {lados.length > 0 ? (
          <>
            <Ladrilho
              icone={TrendingUp}
              rotulo={`Ganhos${periodicitySuffix(lados[0].periodicity)}`}
              valor={formatBrlShort(lados[0].ganhos)}
              tom="favoravel"
            />
            <Ladrilho
              icone={TrendingDown}
              rotulo={`Perdas${periodicitySuffix(lados[0].periodicity)}`}
              valor={formatBrlShort(lados[0].perdas)}
              tom="desfavoravel"
            />
          </>
        ) : (
          <Ladrilho icone={ReceiptText} rotulo="Impacto líquido" valor="Nenhum valor apurável" />
        )}
      </div>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 px-8 py-7">
        <h2 className="text-xl font-bold mb-5">Últimas mudanças</h2>
        <div className="text-slate-50 [&_a]:text-slate-50 [&_a:hover]:bg-slate-800">
          <ListaDeAlteracoesRecentes
            linhas={linhas}
            vazio="O cliente não mexeu em nada nesta vigência."
          />
        </div>
      </section>
    </div>
  );
}

function Ladrilho({
  icone: Icone,
  rotulo,
  valor,
  tom,
}: {
  icone: typeof FileText;
  rotulo: string;
  valor: string;
  tom?: "favoravel" | "desfavoravel";
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-6">
      <div className="flex items-center gap-2 text-slate-400">
        <Icone className="w-5 h-5" />
        <span className="text-xs font-semibold uppercase tracking-wide">{rotulo}</span>
      </div>
      <p
        className={cn(
          "text-4xl font-extrabold tabular-nums mt-3",
          tom === "favoravel" && "text-emerald-400",
          tom === "desfavoravel" && "text-red-400",
        )}
      >
        {valor}
      </p>
    </div>
  );
}

function LadrilhoDeImpacto({
  rotulo,
  impacto,
}: {
  rotulo: string;
  impacto: { periodicity: string | null; amount: number } | null;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-6">
      <div className="flex items-center gap-2 text-slate-400">
        <ReceiptText className="w-5 h-5" />
        <span className="text-xs font-semibold uppercase tracking-wide">{rotulo}</span>
      </div>
      {impacto ? (
        <p
          className={cn(
            "text-4xl font-extrabold tabular-nums mt-3",
            impacto.amount < 0 ? "text-red-400" : "text-emerald-400",
          )}
        >
          {formatBrlShort(impacto.amount)}
          <span className="text-sm font-normal text-slate-400">
            {periodicitySuffix(impacto.periodicity)}
          </span>
        </p>
      ) : (
        <p className="text-2xl font-extrabold text-slate-500 mt-3">Nenhum valor apurável</p>
      )}
    </div>
  );
}
