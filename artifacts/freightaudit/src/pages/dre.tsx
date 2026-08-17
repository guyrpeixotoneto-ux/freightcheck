import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ChevronRight, Search, TriangleAlert } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchJson } from "@/lib/api";
import { formatBrl, formatBrlShort, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AvisoDeCircularidade, Cascata } from "@/components/dre/cascata";
import { Cobertura, Indicadores } from "@/components/dre/indicadores";
import { EvolucaoDoResultado } from "@/components/dre/graficos";
import { BarraDeContexto } from "@/components/contexto/barra-de-contexto";
import {
  CRITERIOS,
  ROTULO_DO_ESCOPO,
  type Alerta,
  type DREDaFrota,
  type EscopoApuravel,
  type HistoricoDaDRE,
  type LinhaDoRanking,
} from "@/components/dre/tipos";

/**
 * DRE — a frota.
 *
 * A tela responde, de cima para baixo e nesta ordem: **quanto a frota deixa**,
 * **quanto disso é confiável**, **como a conta se monta**, **quem precisa de
 * atenção** e **quem está onde no ranking**. A hierarquia é a de §2 — dá dinheiro
 * ou perde, por quê, e o que mudou — aplicada à frota inteira.
 *
 * Três abas de escopo, e não quatro telas. Cavalo, carreta e conjunto são
 * leituras do mesmo dado com regras de alocação diferentes, e trocar entre elas
 * é um filtro, não uma navegação.
 */

const ESCOPOS: EscopoApuravel[] = ["CONJUNTO", "CAVALO", "CARRETA"];

interface Filtros {
  busca: string;
  soNegativos: boolean;
  soIncompletos: boolean;
  ordenarPor: string;
}

const SEM_FILTRO: Filtros = {
  busca: "",
  soNegativos: false,
  soIncompletos: false,
  ordenarPor: "MENOR_RESULTADO",
};

export default function DRE() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);

  const escopoBruto = params.get("escopo") ?? "CONJUNTO";
  const escopo = (ESCOPOS.includes(escopoBruto as EscopoApuravel)
    ? escopoBruto
    : "CONJUNTO") as EscopoApuravel;
  const period = params.get("period") ?? "";
  const [filtros, setFiltros] = useState<Filtros>(SEM_FILTRO);

  const query = useMemo(() => {
    const q = new URLSearchParams({ escopo });
    if (period) q.set("period", period);
    if (filtros.busca) q.set("busca", filtros.busca);
    if (filtros.soNegativos) q.set("soNegativos", "1");
    if (filtros.soIncompletos) q.set("soIncompletos", "1");
    q.set("ordenarPor", filtros.ordenarPor);
    const scopeHash = params.get("scopeHash");
    if (scopeHash) q.set("scopeHash", scopeHash);
    const canal = params.get("canal");
    if (canal !== null) q.set("canal", canal);
    return q.toString();
  }, [escopo, period, filtros, search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dre", "fleet", query],
    queryFn: () => fetchJson<DREDaFrota>(`/dre/fleet?${query}`),
  });

  const historico = useQuery({
    queryKey: ["dre", "history", escopo, params.get("scopeHash"), params.get("canal")],
    queryFn: () => fetchJson<HistoricoDaDRE>(`/dre/history?escopo=${escopo}`),
  });

  const irPara = (mudancas: Record<string, string>) => {
    const next = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === "") next.delete(chave);
      else next.set(chave, valor);
    }
    navigate(`/dre?${next}`);
  };

  return (
    <Layout>
      {data && (
        <BarraDeContexto
          rota="/dre"
          scopeHash={data.contexto.scopeHash}
          canal={data.contexto.canal}
          periodos={data.vigencias.todas.map((v) => ({
            date: v.effectiveDate,
            label: v.periodLabel,
          }))}
          periodoAtual={data.vigencias.alvo.effectiveDate}
          compararCom={
            data.vigencias.anterior ? [data.vigencias.anterior.periodLabel] : []
          }
        />
      )}
      <header className="border-b bg-card px-8 pt-6">
        <div className="flex items-start justify-between gap-8">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">DRE</h1>
            <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
              Quanto cada unidade econômica deixa de resultado nesta vigência, de onde vem
              cada número, e o que o produto ainda não consegue apurar com segurança.
            </p>
          </div>
          {/*
            O seletor de vigência que ficava aqui virou campo da barra de
            contexto — junto de unidade e canal, que é onde a escolha é uma só.
            Mantê-lo aqui daria duas formas de trocar a mesma coisa na mesma
            tela, e elas divergiriam no dia em que uma aprendesse a apagar o
            recorte e a outra não.
          */}
        </div>

        <nav className="flex items-end gap-1 mt-5 -mb-px" aria-label="Escopo da apuração">
          {ESCOPOS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => irPara({ escopo: e })}
              className={cn(
                "px-5 py-2.5 text-sm font-semibold uppercase tracking-wide border-b-2 transition-colors",
                e === escopo
                  ? "border-brand text-brand"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {ROTULO_DO_ESCOPO[e]}s
            </button>
          ))}
        </nav>
      </header>

      <div className="px-8 py-6 space-y-6">
        {error && (
          <ApiErrorNotice error={error} what="A DRE desta vigência não pôde ser carregada." />
        )}

        {isLoading && <Esqueleto />}

        {data && (
          <>
            <Indicadores dre={data.consolidado} anterior={data.consolidadoAnterior} />

            <Cobertura
              cobertura={data.consolidado.cobertura}
              estado={data.consolidado.estado}
            />

            <AvisoDeCircularidade texto={data.aviso} />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] items-start">
              <div className="space-y-6 min-w-0">
                <section>
                  <h2 className="text-sm font-semibold mb-3">
                    Demonstração consolidada — {data.consolidado.unidades}{" "}
                    {data.consolidado.unidades === 1 ? "unidade" : "unidades"},{" "}
                    {data.consolidado.ativos} ativos
                  </h2>
                  <Cascata dre={data.consolidado} />
                </section>

                {historico.data && historico.data.pontos.length > 1 && (
                  <section>
                    <h2 className="text-sm font-semibold mb-3">Evolução do resultado</h2>
                    <EvolucaoDoResultado historico={historico.data} />
                  </section>
                )}
              </div>

              <PrecisamDeAtencao alertas={data.atencao} escopo={escopo} />
            </div>

            {data.consolidado.aguardandoCuradoria.length > 0 && (
              <AguardandoCuradoria itens={data.consolidado.aguardandoCuradoria} />
            )}

            <section>
              <div className="flex items-end justify-between gap-4 mb-3 flex-wrap">
                <h2 className="text-sm font-semibold">
                  Ranking
                  <span className="ml-2 font-normal text-muted-foreground">
                    {data.ranking.length} de {data.totalSemFiltro}
                  </span>
                </h2>
                <BarraDeFiltros filtros={filtros} onMudar={setFiltros} />
              </div>
              <Ranking linhas={data.ranking} escopo={escopo} period={period} />
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------

function VigenciaSelect({
  vigencias,
  atual,
  onEscolher,
}: {
  vigencias: { effectiveDate: string; periodLabel: string }[];
  atual: string;
  onEscolher: (v: string) => void;
}) {
  return (
    <Select value={atual} onValueChange={onEscolher}>
      <SelectTrigger className="w-52 mt-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[...vigencias].reverse().map((v) => (
          <SelectItem key={v.effectiveDate} value={v.effectiveDate}>
            {v.periodLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BarraDeFiltros({
  filtros,
  onMudar,
}: {
  filtros: Filtros;
  onMudar: (f: Filtros) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={filtros.busca}
          onChange={(e) => onMudar({ ...filtros, busca: e.target.value })}
          placeholder="Placa"
          className="pl-8 h-8 w-40 text-sm"
          aria-label="Buscar por placa"
        />
      </div>

      <Select
        value={filtros.ordenarPor}
        onValueChange={(v) => onMudar({ ...filtros, ordenarPor: v })}
      >
        <SelectTrigger className="w-48 h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CRITERIOS.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.rotulo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Alternador
        ativo={filtros.soNegativos}
        onClick={() => onMudar({ ...filtros, soNegativos: !filtros.soNegativos })}
      >
        Só negativos
      </Alternador>
      <Alternador
        ativo={filtros.soIncompletos}
        onClick={() => onMudar({ ...filtros, soIncompletos: !filtros.soIncompletos })}
      >
        Só incompletos
      </Alternador>
    </div>
  );
}

function Alternador({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "h-8 px-3 rounded-md border text-xs font-medium transition-colors",
        ativo
          ? "bg-foreground text-background border-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * O ranking (§14).
 *
 * Tabela densa, e não cartões: são dezenas de linhas comparadas em cinco
 * dimensões numéricas, e é exatamente o caso em que a tabela ganha do cartão.
 * As colunas sem valor mostram "—", nunca zero.
 */
function Ranking({
  linhas,
  escopo,
  period,
}: {
  linhas: LinhaDoRanking[];
  escopo: EscopoApuravel;
  period: string;
}) {
  if (linhas.length === 0) {
    return (
      <div className="border rounded-lg bg-card px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma unidade econômica corresponde a este recorte.
        </p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-card overflow-x-auto">
      <table className="w-full text-sm min-w-[52rem]">
        <thead>
          <tr className="border-b text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
            <th className="text-left font-medium px-4 py-2.5">Unidade</th>
            <th className="text-right font-medium px-4 py-2.5">Receita</th>
            <th className="text-right font-medium px-4 py-2.5">Custo</th>
            <th className="text-right font-medium px-4 py-2.5">Resultado</th>
            <th className="text-right font-medium px-4 py-2.5">Margem</th>
            <th className="text-right font-medium px-4 py-2.5">Δ resultado</th>
            <th className="text-right font-medium px-4 py-2.5">Cobertura</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} className="border-b last:border-b-0 hover:bg-muted/40 transition-colors">
              <td className="px-4 py-2.5">
                <Link
                  href={`/dre/${l.entityIds[0]}?escopo=${escopo}${period ? `&period=${period}` : ""}`}
                  className="font-medium hover:underline"
                >
                  {l.rotulo}
                </Link>
                {l.orfa && (
                  <span className="ml-2 text-[0.6875rem] text-muted-foreground">sem cavalo</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{ouTraco(l.receita)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{ouTraco(l.custo)}</td>
              <td
                className={cn(
                  "px-4 py-2.5 text-right tabular-nums font-medium",
                  l.resultado !== null && l.resultado < 0 && "text-brand-red",
                )}
              >
                {ouTraco(l.resultado)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                {l.margemPercentual === null ? "—" : `${l.margemPercentual.toFixed(1)}%`}
              </td>
              <td
                className={cn(
                  "px-4 py-2.5 text-right tabular-nums",
                  l.variacaoResultado !== null &&
                    (l.variacaoResultado < 0 ? "text-brand-red" : "text-emerald-600"),
                )}
              >
                {l.variacaoResultado === null || l.variacaoResultado === 0
                  ? "—"
                  : `${l.variacaoResultado > 0 ? "+" : "−"}${formatBrl(Math.abs(l.variacaoResultado))}`}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                {l.cobertura.toFixed(0)}%
              </td>
              <td className="px-2">
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ouTraco(valor: number | null): string {
  return valor === null ? "—" : formatBrl(valor);
}

/** Precisam de atenção (§15) — regra sobre número, texto montado a partir dele. */
function PrecisamDeAtencao({ alertas, escopo }: { alertas: Alerta[]; escopo: EscopoApuravel }) {
  if (alertas.length === 0) {
    return (
      <aside className="border rounded-lg bg-card px-5 py-4">
        <h2 className="text-sm font-semibold">Precisam de atenção</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Nenhuma unidade cruzou os limiares desta vigência.
        </p>
      </aside>
    );
  }

  return (
    <aside className="border rounded-lg bg-card">
      <h2 className="text-sm font-semibold px-5 py-3 border-b">
        Precisam de atenção
        <span className="ml-2 font-normal text-muted-foreground">{alertas.length}</span>
      </h2>
      <ul className="max-h-[32rem] overflow-y-auto">
        {alertas.map((a, i) => (
          <li key={`${a.id}-${a.motivo}-${i}`} className="border-b last:border-b-0">
            <Link
              href={`/dre/${a.entityIds[0]}?escopo=${escopo}`}
              className="block px-5 py-3 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "w-2 h-2 rounded-full shrink-0 self-center",
                    a.severidade === "CRITICO" ? "bg-brand-red" : "bg-amber-500",
                  )}
                  aria-label={a.severidade === "CRITICO" ? "Crítico" : "Atenção"}
                />
                <span className="text-sm font-medium">{a.rotulo}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 pl-4">{a.mensagem}</p>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * O que uma confirmação de curadoria destravaria na frota (§23).
 *
 * Fica depois da demonstração e antes do ranking porque é a única lacuna
 * **acionável** da tela: as outras dependem da Ambev entregar um dado que não
 * existe; estas dependem de alguém confirmar o significado de uma coluna que já
 * está no banco.
 */
function AguardandoCuradoria({
  itens,
}: {
  itens: { code: string; titulo: string; oQueFalta: string }[];
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold mb-3">
        Aguardando curadoria
        <span className="ml-2 font-normal text-muted-foreground">
          {itens.length} {itens.length === 1 ? "componente" : "componentes"} que uma
          confirmação traria para a DRE
        </span>
      </h2>
      <div className="border rounded-lg bg-card divide-y">
        {itens.map((i) => (
          <div key={i.code} className="px-5 py-3">
            <div className="text-sm font-medium">{i.titulo}</div>
            <p className="text-xs text-muted-foreground mt-1 max-w-4xl">{i.oQueFalta}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Confirmá-los na{" "}
        <Link href="/curadoria" className="underline">
          Curadoria
        </Link>{" "}
        os traz para a demonstração sem nenhuma outra mudança.
      </p>
    </section>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid gap-px bg-border rounded-lg overflow-hidden md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-card px-5 py-4 space-y-2">
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
            <div className="h-7 w-32 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>
      <div className="h-12 rounded-lg bg-card border animate-pulse" />
      <div className="h-72 rounded-lg bg-card border animate-pulse" />
    </div>
  );
}
