import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ApiError, fetchJson, fetchJsonOrNull } from "@/lib/api";
import { useFamiliesOverviewQuery } from "@/lib/families-overview";
import { DASHBOARD, GESTAO_A_VISTA } from "@/lib/ambiente";
import { cn } from "@/lib/utils";
import { formatBrlShort, formatPercent, periodicitySuffix } from "@/lib/format";
import { escreverImpacto, ladosDoImpacto, type Impacto } from "@/lib/visao-geral";
import { lerRecorte, linkDeAlteracoes, nomeDaUnidade, type Recorte } from "@/lib/recorte";
import { juntarPrioridades, SEVERITY_LABEL } from "@/lib/cockpit";
import { unidadesPorImpacto, impactoDominante } from "@/components/inicio/visao-geral-consolidada";
import { seriesDoIntervalo } from "@/components/linha-do-tempo/linha-do-tempo-de-alteracoes";
import { lerIntervaloSegundos, montarSequenciaDoAutoplay } from "@/lib/gestao-a-vista-autoplay";
import type {
  ExecutiveSummary,
  FamiliesOverview,
  FamiliesView,
} from "@/components/inicio/types";
import type { Movimentos } from "@/lib/analise";

/**
 * A Gestão à Vista — um wallboard, não um resumo do Dashboard.
 *
 * A pergunta que a tela responde em poucos segundos, a alguns metros de
 * distância: o que a Ambev mudou que está fazendo a operação ganhar ou perder
 * dinheiro, onde, e o que ainda falta apurar. Cada bloco existe porque
 * responde a um pedaço dessa pergunta — não porque o Dashboard já o tinha.
 *
 * Continua lendo exatamente o que o Dashboard lê (`/changes/families` ou
 * `/changes/families/overview`, o mesmo `scopeHash`/`canal`/`period`/`visaoGeral`
 * da URL) com `refetchInterval: 30s`. O que muda aqui é só a composição da
 * tela sobre esses mesmos dados.
 */
export default function GestaoAVista() {
  const search = useSearch();
  const [, navegar] = useLocation();
  const parametros = new URLSearchParams(search);

  const periodoPedido = parametros.get("period");
  const visaoGeralPedida = parametros.get("visaoGeral") === "1";

  /*
    O autoplay — a rotação automática entre unidades, para quem pendura a tela
    e não fica trocando de recorte na mão. `?autoplay=1` liga a volta: a
    Visão Geral primeiro, depois cada unidade incluída na soma, sozinho.
    Enquanto ele está ligado, o `scopeHash`/`canal`/`visaoGeral` do endereço
    não decidem mais o que aparece — quem decide é o slide da vez
    (`lib/gestao-a-vista-autoplay.ts`), e por isso a Visão Geral precisa do
    overview mesmo fora do modo Geral: é dela que a sequência sai.
  */
  const autoplay = parametros.get("autoplay") === "1";
  const intervaloSegundos = lerIntervaloSegundos(parametros.get("intervalo"));

  const overviewQuery = useFamiliesOverviewQuery(periodoPedido, {
    enabled: visaoGeralPedida || autoplay,
    refetchInterval: 30_000,
  });

  const sequencia = useMemo(
    () => montarSequenciaDoAutoplay(overviewQuery.data),
    [overviewQuery.data],
  );

  const [indiceDoSlide, setIndiceDoSlide] = useState(0);

  // Trocar de slide na mão reinicia a contagem até o próximo — sem isto o
  // autoplay poderia avançar de novo poucos segundos depois de alguém já ter
  // ido para a tela seguinte, ou voltar sozinho logo após um "anterior".
  const [reinicioDoAutoplay, setReinicioDoAutoplay] = useState(0);

  useEffect(() => {
    if (!autoplay || sequencia.length <= 1) return;
    const id = setInterval(() => {
      setIndiceDoSlide((indice) => (indice + 1) % sequencia.length);
    }, intervaloSegundos * 1000);
    return () => clearInterval(id);
  }, [autoplay, sequencia.length, intervaloSegundos, reinicioDoAutoplay]);

  // A volta pode encolher entre uma leitura do overview e outra (uma unidade
  // saiu da soma) — sem isto o índice ficaria apontando para um slide que não
  // existe mais em vez de voltar ao começo da volta.
  useEffect(() => {
    setIndiceDoSlide((indice) => (indice < sequencia.length ? indice : 0));
  }, [sequencia.length]);

  const slideDoAutoplay = autoplay ? (sequencia[indiceDoSlide] ?? { tipo: "geral" as const }) : null;

  const visaoGeral = autoplay ? slideDoAutoplay?.tipo !== "unidade" : visaoGeralPedida;

  const consulta = new URLSearchParams();
  if (periodoPedido !== null) consulta.set("period", periodoPedido);
  if (autoplay) {
    if (slideDoAutoplay?.tipo === "unidade") {
      consulta.set("scopeHash", slideDoAutoplay.scopeHash);
      if (slideDoAutoplay.canal !== null) consulta.set("canal", slideDoAutoplay.canal);
    }
  } else {
    for (const chave of ["scopeHash", "canal"]) {
      const valor = parametros.get(chave);
      if (valor !== null) consulta.set(chave, valor);
    }
  }
  const sufixo = consulta.toString() ? `?${consulta}` : "";
  const recorte = lerRecorte(consulta);

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

  const view = visaoGeral ? null : (vigencia.data ?? null);
  const overview = visaoGeral ? (overviewQuery.data ?? null) : null;
  const atualizadaEm = visaoGeral ? overviewQuery.dataUpdatedAt : vigencia.dataUpdatedAt;

  // O botão de voltar ao Dashboard leva o recorte de origem do telão — o que
  // a URL pediu, nunca o slide da vez, porque o autoplay é um jeito de olhar
  // a Gestão à Vista, e não uma escolha para o Dashboard herdar.
  const consultaDeOrigem = new URLSearchParams();
  for (const chave of ["period", "scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consultaDeOrigem.set(chave, valor);
  }
  const paraDashboard = consultaDeOrigem.toString()
    ? `${DASHBOARD}?${consultaDeOrigem}`
    : DASHBOARD;

  const alternarAutoplay = () => {
    const proximo = new URLSearchParams(search);
    if (autoplay) proximo.delete("autoplay");
    else proximo.set("autoplay", "1");
    const texto = proximo.toString();
    navegar(texto ? `${GESTAO_A_VISTA}?${texto}` : GESTAO_A_VISTA, { replace: true });
  };

  const irParaSlide = (calcularProximoIndice: (indice: number) => number) => {
    setIndiceDoSlide(calcularProximoIndice);
    setReinicioDoAutoplay((n) => n + 1);
  };
  const irParaSlideAnterior = () =>
    irParaSlide((indice) => (indice - 1 + sequencia.length) % sequencia.length);
  const irParaProximoSlide = () => irParaSlide((indice) => (indice + 1) % sequencia.length);

  const status: StatusGeral = visaoGeral
    ? overview
      ? statusDaVisaoGeral(overview)
      : "NORMAL"
    : view
      ? statusDaUnidade(view)
      : "NORMAL";

  return (
    <div className="w-full min-h-[100dvh] bg-slate-950 text-slate-50 font-sans">
      <div className="px-10 py-7 max-w-[1800px] mx-auto space-y-6">
        <Topo
          titulo={visaoGeral ? "Visão Geral" : view ? nomeDaUnidade(view.context) : "Gestão à Vista"}
          competencia={visaoGeral ? overview?.period : view?.periodLabel}
          paraDashboard={paraDashboard}
          atualizadaEm={atualizadaEm}
          status={status}
          autoplay={autoplay}
          onAlternarAutoplay={alternarAutoplay}
          navegacaoDeSlides={autoplay && sequencia.length > 1}
          onSlideAnterior={irParaSlideAnterior}
          onProximoSlide={irParaProximoSlide}
        />

        {autoplay && sequencia.length > 1 && (
          <BarraDoAutoplay chave={indiceDoSlide} intervaloSegundos={intervaloSegundos} />
        )}

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
          <ConteudoDaUnidade view={view} recorte={recorte} consulta={consulta} />
        ) : (
          <MensagemDeEstado carregando={vigencia.isLoading} erro={vigencia.error !== null} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status geral — NORMAL / ATENÇÃO / CRÍTICO
// ---------------------------------------------------------------------------

type StatusGeral = "NORMAL" | "ATENCAO" | "CRITICO";

const STATUS_LABEL: Record<StatusGeral, string> = {
  NORMAL: "Normal",
  ATENCAO: "Atenção",
  CRITICO: "Crítico",
};

const STATUS_ESTILO: Record<StatusGeral, string> = {
  NORMAL: "bg-emerald-500/15 text-emerald-400",
  ATENCAO: "bg-amber-500/15 text-amber-400",
  CRITICO: "bg-red-500/15 text-red-400",
};

const STATUS_PONTO: Record<StatusGeral, string> = {
  NORMAL: "bg-emerald-400",
  ATENCAO: "bg-amber-400",
  CRITICO: "bg-red-400",
};

/**
 * O status de uma unidade — primeira versão, e é decisão de produto em
 * aberto: hoje não existe um "status da unidade" calculado em lugar nenhum do
 * produto, só a severidade por alteração (`cockpit.panorama.bySeverity`). A
 * regra aqui é a mais simples que já responde à tela: alguma alteração
 * CRÍTICA presente vira crítico; alguma ALTA, ou o líquido dominante negativo
 * sem nenhuma crítica, vira atenção; o resto é normal.
 */
function statusDaUnidade(view: FamiliesView): StatusGeral {
  const baldes = view.cockpit.panorama.bySeverity;
  const criticas = baldes.find((b) => b.severity === "CRITICO")?.changes ?? 0;
  const altas = baldes.find((b) => b.severity === "ALTO")?.changes ?? 0;
  if (criticas > 0) return "CRITICO";
  const liquido = ladosDoImpacto(view)[0]?.liquido ?? null;
  if (altas > 0 || (liquido !== null && liquido < 0)) return "ATENCAO";
  return "NORMAL";
}

/**
 * O status da soma de todas as unidades — mais pobre que o de uma unidade,
 * porque a Visão Geral não carrega severidade por alteração (a v1 não mescla
 * `cockpit` entre unidades). O que sobra é o sinal do impacto líquido
 * dominante: negativo é atenção, positivo ou nulo é normal. Sem crítico aqui,
 * de propósito — "crítico" exigiria saber qual unidade está crítica, e isso
 * só se descobre entrando nela.
 */
function statusDaVisaoGeral(overview: FamiliesOverview): StatusGeral {
  const dominante = impactoDominante(overview.summary);
  return dominante !== null && dominante.amount < 0 ? "ATENCAO" : "NORMAL";
}

// ---------------------------------------------------------------------------
// Topo
// ---------------------------------------------------------------------------

function Topo({
  titulo,
  competencia,
  paraDashboard,
  atualizadaEm,
  status,
  autoplay,
  onAlternarAutoplay,
  navegacaoDeSlides,
  onSlideAnterior,
  onProximoSlide,
}: {
  titulo: string;
  competencia?: string | null;
  paraDashboard: string;
  atualizadaEm: number;
  status: StatusGeral;
  autoplay: boolean;
  onAlternarAutoplay: () => void;
  navegacaoDeSlides: boolean;
  onSlideAnterior: () => void;
  onProximoSlide: () => void;
}) {
  return (
    <header className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Gestão à Vista
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight truncate">
          {titulo}
          {competencia && <span className="text-slate-400 font-normal"> · {competencia}</span>}
        </h1>
      </div>
      <div className="flex items-center gap-5 shrink-0">
        <span
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-5 py-2.5 text-lg font-extrabold tracking-wide",
            STATUS_ESTILO[status],
          )}
        >
          <span className={cn("w-2.5 h-2.5 rounded-full", STATUS_PONTO[status])} />
          {STATUS_LABEL[status]}
        </span>
        <Relogio atualizadaEm={atualizadaEm} />
        {navegacaoDeSlides && (
          <button
            type="button"
            onClick={onSlideAnterior}
            title="Tela anterior"
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-800 text-slate-500 hover:text-slate-200 hover:bg-slate-900 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onAlternarAutoplay}
          title={autoplay ? "Parar a rotação automática" : "Girar entre unidades automaticamente"}
          className={cn(
            "flex items-center justify-center w-9 h-9 rounded-lg border transition-colors",
            autoplay
              ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/15"
              : "border-slate-800 text-slate-500 hover:text-slate-200 hover:bg-slate-900",
          )}
        >
          {autoplay ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        {navegacaoDeSlides && (
          <button
            type="button"
            onClick={onProximoSlide}
            title="Próxima tela"
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-800 text-slate-500 hover:text-slate-200 hover:bg-slate-900 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
        <Link
          href={paraDashboard}
          title="Voltar ao Dashboard"
          className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-800 text-slate-500 hover:text-slate-200 hover:bg-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
}

/**
 * O tempo até o próximo slide, em barra — a única pista de que o telão está
 * girando sozinho, para quem chega no meio de uma volta.
 *
 * `chave` é o índice do slide: trocá-la remonta a barra do zero a cada
 * troca, que é o jeito mais simples de reiniciar uma animação CSS sem
 * orquestrar `requestAnimationFrame` para um detalhe puramente decorativo.
 */
function BarraDoAutoplay({ chave, intervaloSegundos }: { chave: number; intervaloSegundos: number }) {
  return (
    <div className="h-0.5 -mt-3 bg-slate-800/60 rounded-full overflow-hidden">
      <div
        key={chave}
        className="h-full bg-slate-500 origin-left"
        style={{
          animation: `gestao-a-vista-autoplay ${intervaloSegundos}s linear forwards`,
        }}
      />
      <style>{`
        @keyframes gestao-a-vista-autoplay {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}

/**
 * O relógio que só sabe o que a consulta confirmou.
 *
 * `dataUpdatedAt` é zero antes da primeira resposta — não há "última
 * atualização" nesse instante, e a tela diz isso em vez de fabricar um horário.
 */
function Relogio({ atualizadaEm }: { atualizadaEm: number }) {
  const [, forcarRenderizacao] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forcarRenderizacao((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (atualizadaEm === 0) {
    return <p className="text-sm text-slate-500">aguardando a primeira resposta…</p>;
  }

  return (
    <div className="text-right">
      <p className="text-[0.6875rem] uppercase tracking-wide text-slate-500">Última atualização</p>
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
// Visão Geral — todas as unidades
// ---------------------------------------------------------------------------

/**
 * A Visão Geral não tem `groups`/`series` entre unidades (a v1 não mescla
 * drill-down nem histórico entre elas — ver `FamiliesOverview` em
 * `components/inicio/types.ts`). Por isso ela só tem o número protagonista e o
 * ranking de unidades: o ranking de mudanças, as mudanças recentes, as
 * pendências e a tendência só existem dentro de uma unidade específica.
 */
function ConteudoGeral({ overview }: { overview: FamiliesOverview }) {
  const dominante = impactoDominante(overview.summary);
  const unidades = unidadesPorImpacto(overview);

  return (
    <div className="space-y-6">
      <NumeroProtagonista
        impacto={dominante}
        alteracoes={overview.summary.changes}
        veiculos={overview.summary.vehiclesTouched}
        semImpactoApurado={false}
      />

      <section className="rounded-2xl border border-slate-800 bg-slate-900 px-7 py-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400 mb-4">
          Unidades em atenção
        </h2>
        {unidades.length === 0 ? (
          <p className="text-slate-400">Nenhuma unidade entrou na soma desta competência.</p>
        ) : (
          <TabelaDeUnidades unidades={unidades} />
        )}
      </section>

      <p className="text-xs text-slate-600">
        O ranking de alterações, as mudanças recentes, as pendências e a tendência só existem
        dentro de uma unidade — a soma Geral não mescla histórico nem grupos entre unidades.
      </p>
    </div>
  );
}

function TabelaDeUnidades({
  unidades,
}: {
  unidades: ReturnType<typeof unidadesPorImpacto>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-slate-500">
            <th className="pb-2.5 pr-4 font-semibold">Unidade</th>
            <th className="pb-2.5 px-4 font-semibold text-right">Alterações</th>
            <th className="pb-2.5 px-4 font-semibold text-right">Perdas</th>
            <th className="pb-2.5 px-4 font-semibold text-right">Ganhos</th>
            <th className="pb-2.5 px-4 font-semibold text-right">Impacto líquido</th>
            <th className="pb-2.5 pl-4 font-semibold text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {unidades.map(({ unidade, impacto }) => {
            const lados = ladosDoResumo(unidade.summary).find(
              (l) => l.periodicity === impacto?.periodicity,
            );
            // Sem severidade por alteração entre unidades (a v1 não mescla `cockpit`
            // entre elas — ver o comentário de `FamiliesOverview`), o status por linha
            // não sabe distinguir Atenção de Crítico: só o sinal do impacto.
            const status: Extract<StatusGeral, "NORMAL" | "ATENCAO"> =
              impacto === null ? "NORMAL" : impacto.amount < 0 ? "ATENCAO" : "NORMAL";
            return (
              <tr
                key={unidade.unidade}
                className={cn(
                  "border-t border-slate-800/80",
                  status === "ATENCAO" && "bg-amber-500/[0.05]",
                )}
              >
                <td className="py-3 pr-4 font-semibold truncate max-w-[16rem]" title={unidade.label}>
                  {unidade.label}
                </td>
                <td className="py-3 px-4 text-right tabular-nums text-slate-300">
                  {unidade.summary.changes.toLocaleString("pt-BR")}
                </td>
                <td className="py-3 px-4 text-right tabular-nums font-semibold text-red-400">
                  {lados ? formatBrlShort(lados.perdas) : "—"}
                </td>
                <td className="py-3 px-4 text-right tabular-nums font-semibold text-emerald-400">
                  {lados ? formatBrlShort(lados.ganhos) : "—"}
                </td>
                <td
                  className={cn(
                    "py-3 px-4 text-right tabular-nums font-extrabold",
                    impacto === null
                      ? "text-slate-500 font-normal"
                      : impacto.amount < 0
                        ? "text-red-400"
                        : "text-emerald-400",
                  )}
                >
                  {impacto ? escreverImpacto(impacto) : "—"}
                </td>
                <td className="py-3 pl-4 text-right">
                  <span
                    className={cn(
                      "inline-flex rounded px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide",
                      STATUS_ESTILO[status],
                    )}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** `ladosDoImpacto`, mas a partir de um `ExecutiveSummary` solto — o que uma linha da tabela de unidades tem na mão. */
function ladosDoResumo(summary: ExecutiveSummary) {
  return summary.sides.map((lado) => ({
    periodicity: lado.periodicity,
    ganhos: lado.gains.total,
    perdas: lado.losses.total,
  }));
}

// ---------------------------------------------------------------------------
// Número protagonista
// ---------------------------------------------------------------------------

function NumeroProtagonista({
  impacto,
  alteracoes,
  veiculos,
  ganhos,
  perdas,
  semImpactoApurado,
  apuradas,
}: {
  impacto: Impacto | null;
  alteracoes: number;
  veiculos: number;
  ganhos?: number;
  perdas?: number;
  semImpactoApurado: boolean;
  apuradas?: number;
}) {
  if (semImpactoApurado) {
    return (
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-8 py-7">
        <p className="text-xl font-bold text-amber-300">
          {alteracoes.toLocaleString("pt-BR")}{" "}
          {alteracoes === 1 ? "alteração aguardando" : "alterações aguardando"} precificação
        </p>
        <p className="text-sm text-amber-400/80 mt-1.5">
          {(apuradas ?? 0).toLocaleString("pt-BR")} de {alteracoes.toLocaleString("pt-BR")} com
          impacto financeiro calculado — pendência operacional, não ausência de informação.
        </p>
        <div className="flex items-center gap-8 mt-6 pt-5 border-t border-amber-500/20">
          <NumeroSecundario rotulo="Alterações identificadas" valor={alteracoes.toLocaleString("pt-BR")} />
          <NumeroSecundario rotulo="Veículos afetados" valor={veiculos.toLocaleString("pt-BR")} />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 px-8 py-7">
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
        Impacto líquido mensal
      </p>
      <p
        className={cn(
          "text-7xl font-extrabold tabular-nums tracking-tight mt-1",
          impacto === null ? "text-slate-500" : impacto.amount < 0 ? "text-red-400" : "text-emerald-400",
        )}
      >
        {impacto ? formatBrlShort(impacto.amount) : "—"}
        {impacto && (
          <span className="text-2xl font-semibold text-slate-500 ml-1">
            {periodicitySuffix(impacto.periodicity)}
          </span>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-x-10 gap-y-4 mt-6 pt-5 border-t border-slate-800">
        {perdas !== undefined && (
          <NumeroSecundario rotulo="Perdas mensais" valor={formatBrlShort(perdas)} tom="desfavoravel" />
        )}
        {ganhos !== undefined && (
          <NumeroSecundario rotulo="Ganhos mensais" valor={formatBrlShort(ganhos)} tom="favoravel" />
        )}
        <NumeroSecundario rotulo="Alterações identificadas" valor={alteracoes.toLocaleString("pt-BR")} />
        <NumeroSecundario rotulo="Veículos afetados" valor={veiculos.toLocaleString("pt-BR")} />
      </div>
    </section>
  );
}

function NumeroSecundario({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: string;
  tom?: "favoravel" | "desfavoravel";
}) {
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">{rotulo}</p>
      <p
        className={cn(
          "text-2xl font-extrabold tabular-nums mt-0.5",
          tom === "favoravel" && "text-emerald-400",
          tom === "desfavoravel" && "text-red-400",
        )}
      >
        {valor}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uma unidade
// ---------------------------------------------------------------------------

function ConteudoDaUnidade({
  view,
  recorte,
  consulta,
}: {
  view: FamiliesView;
  recorte: Recorte;
  consulta: URLSearchParams;
}) {
  const lados = ladosDoImpacto(view).filter((l) => l.fatiaDeGanho !== null);
  const ladoDominante = lados[0] ?? null;
  const pricing = view.cockpit.panorama.pricing;
  const alteracoesComPreco = pricing.calculatedChanges;
  const semImpactoApurado = ladoDominante === null;

  return (
    <div className="space-y-6">
      <NumeroProtagonista
        impacto={ladoDominante ? { periodicity: ladoDominante.periodicity, amount: ladoDominante.liquido } : null}
        ganhos={ladoDominante?.ganhos}
        perdas={ladoDominante?.perdas}
        alteracoes={view.totals.changes}
        veiculos={view.totals.vehiclesTouched}
        semImpactoApurado={semImpactoApurado}
        apuradas={alteracoesComPreco}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankingDeMudancas view={view} recorte={recorte} />
        <MudancasRecentes view={view} recorte={recorte} />
      </div>

      <PendenciasCriticas view={view} recorte={recorte} />

      <TendenciaCompacta view={view} consulta={consulta} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onde estamos perdendo ou ganhando
// ---------------------------------------------------------------------------

function RankingDeMudancas({ view, recorte }: { view: FamiliesView; recorte: Recorte }) {
  const ranking = useMemo(() => {
    const comPreco = view.groups.filter(
      (g) => g.impact.confidence === "CALCULATED" && g.impact.amount !== null,
    );
    const teto = comPreco.reduce((maior, g) => Math.max(maior, Math.abs(g.impact.amount ?? 0)), 0);
    return comPreco
      .sort((a, b) => Math.abs(b.impact.amount ?? 0) - Math.abs(a.impact.amount ?? 0))
      .slice(0, 5)
      .map((grupo) => ({ grupo, proporcao: teto === 0 ? 0 : Math.abs(grupo.impact.amount ?? 0) / teto }));
  }, [view]);

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 px-7 py-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400 mb-4">
        Onde estamos perdendo ou ganhando
      </h2>
      {ranking.length === 0 ? (
        <p className="text-slate-500 text-sm">Nenhuma alteração com impacto apurado nesta vigência.</p>
      ) : (
        <ol className="space-y-4">
          {ranking.map(({ grupo, proporcao }, indice) => {
            const perde = (grupo.impact.amount ?? 0) < 0;
            const daVigencia: Recorte = { ...recorte, period: view.period };
            const href = linkDeAlteracoes({
              recorte: daVigencia,
              filtros: {
                ...(grupo.attributeCode ? { attributeCode: grupo.attributeCode } : {}),
                ...(grupo.entityType ? { entityType: grupo.entityType } : {}),
              },
            });
            return (
              <li key={grupo.key}>
                <Link href={href} className="block group">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold truncate group-hover:text-slate-200">
                        {grupo.title} — {grupo.equipment}
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">
                        {grupo.dominantPattern?.before ?? "—"} → {grupo.dominantPattern?.after ?? "—"}
                        {" · "}
                        {grupo.vehicles.toLocaleString("pt-BR")}{" "}
                        {grupo.vehicles === 1 ? "veículo" : "veículos"}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-lg font-extrabold tabular-nums shrink-0",
                        perde ? "text-red-400" : "text-emerald-400",
                      )}
                    >
                      {escreverImpacto({ periodicity: grupo.impact.periodicity, amount: grupo.impact.amount ?? 0 })}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-slate-800 overflow-hidden mt-2">
                    <div
                      className={cn("h-full rounded-full", perde ? "bg-red-400" : "bg-emerald-400")}
                      style={{ width: `${Math.max(3, proporcao * 100)}%` }}
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mudanças recentes — no máximo 5, em linguagem de negócio
// ---------------------------------------------------------------------------

/**
 * Cor de tempo desta seção: o campo mais próximo de "quando" que existe é
 * `changeSet.computedAt`, que fica por **lote de comparação**, não por linha —
 * a vigência inteira é apurada num processamento só. Não existe timestamp por
 * mudança individual, e por isso a linha mostra a vigência apurada, e não um
 * horário fabricado.
 */
function MudancasRecentes({ view, recorte }: { view: FamiliesView; recorte: Recorte }) {
  const linhas = useMemo(() => juntarPrioridades(view).slice(0, 5), [view]);
  const daVigencia: Recorte = { ...recorte, period: view.period };

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 px-7 py-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400 mb-4">
        Mudanças recentes
      </h2>
      {linhas.length === 0 ? (
        <p className="text-slate-500 text-sm">O cliente não mexeu em nada nesta vigência.</p>
      ) : (
        <ol className="divide-y divide-slate-800/80">
          {linhas.map(({ group }) => {
            const comPreco = group.impact.confidence === "CALCULATED" && group.impact.amount !== null;
            const href = linkDeAlteracoes({
              recorte: daVigencia,
              filtros: {
                ...(group.attributeCode ? { attributeCode: group.attributeCode } : {}),
                ...(group.entityType ? { entityType: group.entityType } : {}),
              },
            });
            return (
              <li key={group.key} className="py-3 first:pt-0 last:pb-0">
                <Link href={href} className="flex items-start justify-between gap-4 group">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate group-hover:text-slate-200">
                      {group.title} — {group.equipment}
                    </p>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                      <span>
                        {group.dominantPattern?.before ?? "—"} → {group.dominantPattern?.after ?? "—"}
                      </span>
                      {group.aggregate.deltaPercent !== null && (
                        <span
                          className={cn(
                            "font-semibold rounded px-1.5 py-0.5",
                            group.aggregate.deltaPercent < 0
                              ? "bg-red-500/10 text-red-400"
                              : "bg-emerald-500/10 text-emerald-400",
                          )}
                        >
                          {formatPercent(group.aggregate.deltaPercent, 0)}
                        </span>
                      )}
                      <span>· apurado na vigência {view.periodLabel}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={cn(
                        "text-base font-extrabold tabular-nums",
                        !comPreco
                          ? "text-slate-500 text-sm font-semibold"
                          : (group.impact.amount ?? 0) < 0
                            ? "text-red-400"
                            : "text-emerald-400",
                      )}
                    >
                      {comPreco
                        ? escreverImpacto({ periodicity: group.impact.periodicity, amount: group.impact.amount ?? 0 })
                        : "Sem preço"}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {group.vehicles.toLocaleString("pt-BR")} {group.vehicles === 1 ? "veículo" : "veículos"}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pendências críticas
// ---------------------------------------------------------------------------

interface CurationSummary {
  byStatus: { status: string; count: number; monetary: number }[];
  unclassified: number;
}

function PendenciasCriticas({ view, recorte }: { view: FamiliesView; recorte: Recorte }) {
  const curadoria = useQuery({
    queryKey: ["curation-summary", "gestao-a-vista"],
    queryFn: () => fetchJsonOrNull<CurationSummary>("/curation/summary"),
    staleTime: 5 * 60_000,
  });

  const daVigencia: Recorte = { ...recorte, period: view.period };
  const semPreco = view.cockpit.panorama.pricing.notCalculableChanges;
  const semCorrespondencia = view.totals.inconclusive;
  const aguardandoRevisao = curadoria.data?.unclassified ?? null;
  const criticas = view.cockpit.panorama.bySeverity.find((b) => b.severity === "CRITICO")?.changes ?? 0;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 px-7 py-6">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400 mb-4">
        Pendências críticas
      </h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CartaoDePendencia
          numero={semPreco}
          rotulo="sem preço"
          detalhe="impacto ainda não calculável"
          tom="amarelo"
          href={
            semPreco > 0
              ? linkDeAlteracoes({ recorte: daVigencia, filtros: { impactConfidence: "NOT_CALCULABLE" } })
              : undefined
          }
        />
        <CartaoDePendencia
          numero={semCorrespondencia}
          rotulo="sem correspondência"
          detalhe="os dois lados não são comparáveis"
          tom="amarelo"
          href={
            semCorrespondencia > 0
              ? linkDeAlteracoes({ recorte: daVigencia, filtros: { comparability: "INCONCLUSIVE" } })
              : undefined
          }
        />
        <CartaoDePendencia
          numero={aguardandoRevisao}
          rotulo="aguardando revisão"
          detalhe="semântica não confirmada, no produto todo"
          tom="amarelo"
          href={aguardandoRevisao !== null && aguardandoRevisao > 0 ? "/curadoria" : undefined}
        />
        <CartaoDePendencia
          numero={criticas}
          rotulo={`alterações ${SEVERITY_LABEL.CRITICO.toLowerCase()}s`}
          detalhe="maior severidade nesta vigência"
          tom="vermelho"
          href={criticas > 0 ? "/acompanhamento" : undefined}
        />
      </div>
    </section>
  );
}

function CartaoDePendencia({
  numero,
  rotulo,
  detalhe,
  tom,
  href,
}: {
  numero: number | null;
  rotulo: string;
  detalhe: string;
  tom: "amarelo" | "vermelho";
  href?: string;
}) {
  const conteudo = (
    <div
      className={cn(
        "rounded-xl border-l-4 border border-slate-800 bg-slate-950/40 px-4 py-3.5 h-full",
        tom === "amarelo" ? "border-l-amber-400" : "border-l-red-400",
        href && "hover:bg-slate-900 transition-colors",
      )}
    >
      <p
        className={cn(
          "text-3xl font-extrabold tabular-nums",
          numero === null ? "text-slate-600" : tom === "amarelo" ? "text-amber-400" : "text-red-400",
        )}
      >
        {numero === null ? "—" : numero.toLocaleString("pt-BR")}
      </p>
      <p className="text-sm font-semibold text-slate-300 mt-1">{rotulo}</p>
      <p className="text-xs text-slate-500 mt-0.5 leading-snug">{detalhe}</p>
    </div>
  );

  return href ? <Link href={href}>{conteudo}</Link> : conteudo;
}

// ---------------------------------------------------------------------------
// Tendência entre competências
// ---------------------------------------------------------------------------

function TendenciaCompacta({ view, consulta }: { view: FamiliesView; consulta: URLSearchParams }) {
  const ordenadas = useMemo(
    () => [...view.periods].sort((a, b) => a.date.localeCompare(b.date)),
    [view],
  );

  const query = new URLSearchParams(consulta);
  query.delete("period");
  if (ordenadas.length > 0) {
    query.set("from", ordenadas[0].date);
    query.set("to", view.period);
  }

  const movimentos = useQuery({
    queryKey: ["tendencia-compacta", query.toString()],
    queryFn: () => fetchJsonOrNull<Movimentos>(`/changes/range?${query}`),
    enabled: ordenadas.length > 1,
    staleTime: 60_000,
  });

  if (ordenadas.length <= 1) return null;

  const dados = movimentos.data;
  if (movimentos.isLoading || !dados || dados.entries.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-800 bg-slate-900 px-7 py-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400 mb-4">
          Tendência entre competências
        </h2>
        <p className="text-slate-500 text-sm">
          {movimentos.isLoading
            ? "Carregando o intervalo…"
            : "Sem alterações com sinal apurado no intervalo disponível."}
        </p>
      </section>
    );
  }

  const periodosOrdenados = [...dados.periods].sort((a, b) => a.date.localeCompare(b.date));
  const { valor, periodicidades } = seriesDoIntervalo(periodosOrdenados, dados.entries);

  // A periodicidade dominante do intervalo — o mesmo critério de `maioresImpactos`:
  // a que concentra o maior movimento (ganhos + |perdas|) em algum ponto da série.
  const dominante = [...periodicidades].sort((a, b) => {
    const movimento = (p: string) =>
      (valor.get(p) ?? []).reduce((soma, ponto) => soma + ponto.ganhos + Math.abs(ponto.perdas), 0);
    return movimento(b) - movimento(a);
  })[0];

  const pontos = (valor.get(dominante) ?? []).map((p) => ({
    ...p,
    liquido: p.ganhos + p.perdas,
  }));

  const ultimo = pontos[pontos.length - 1];
  const penultimo = pontos[pontos.length - 2];
  const variacao = ultimo && penultimo ? ultimo.liquido - penultimo.liquido : null;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 px-7 py-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">
          Tendência entre competências
        </h2>
        <span className="text-xs text-slate-500">em R${periodicitySuffix(dominante)}</span>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-stretch">
        <div className="flex-1 min-w-0">
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={pontos} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(v: number) => formatBrlShort(v)}
                contentStyle={{
                  fontSize: 12,
                  background: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: 8,
                }}
                labelStyle={{ color: "#e2e8f0" }}
              />
              <Line type="monotone" dataKey="perdas" name="Perdas" stroke="#f87171" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="ganhos" name="Ganhos" stroke="#34d399" strokeWidth={2} dot={{ r: 2 }} />
              <Line
                type="monotone"
                dataKey="liquido"
                name="Impacto líquido"
                stroke="#60a5fa"
                strokeWidth={2.5}
                strokeDasharray="4 3"
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-5 text-xs text-slate-400 mt-2">
            <Legenda cor="#f87171" rotulo="Perdas" />
            <Legenda cor="#34d399" rotulo="Ganhos" />
            <Legenda cor="#60a5fa" rotulo="Impacto líquido" />
          </div>
        </div>

        {variacao !== null && (
          <div className="lg:w-52 shrink-0 lg:border-l lg:border-slate-800 lg:pl-6 flex lg:flex-col gap-6 lg:gap-5 justify-center">
            <NumeroSecundario
              rotulo="Variação vs. vigência anterior"
              valor={`${variacao >= 0 ? "↑" : "↓"} ${formatBrlShort(Math.abs(variacao))}`}
              tom={variacao < 0 ? "desfavoravel" : "favoravel"}
            />
            <NumeroSecundario
              rotulo="Tendência do intervalo"
              valor={variacao < 0 ? "Deteriorando" : variacao > 0 ? "Melhorando" : "Estável"}
              tom={variacao < 0 ? "desfavoravel" : variacao > 0 ? "favoravel" : undefined}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function Legenda({ cor, rotulo }: { cor: string; rotulo: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-0.5 rounded-full" style={{ background: cor }} />
      {rotulo}
    </span>
  );
}
