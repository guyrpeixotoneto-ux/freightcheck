import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  ArrowRight,
  FileSearch,
  LayoutDashboard,
  Lock,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Painel de Impacto — o estado do sistema, sem projeção.
 *
 * Tudo aqui é medido, nada é previsto. Os impactos aparecem separados por
 * periodicidade e nunca somados entre si: R$/mês e R$/ano são grandezas
 * diferentes, e juntá-las é o erro que este produto existe para pegar.
 * Converter as duas para uma base comum é trabalho de F4.
 */

interface Overview {
  totals: Record<string, string>;
  latest: {
    id: string;
    snapshot_a_label: string;
    snapshot_b_label: string;
    value_changes: number;
    entities_added: number;
    entities_removed: number;
    inconclusive: number;
    impact_not_calculable: number;
    calculated_impact_by_periodicity: Record<string, number>;
  } | null;
  impactByPeriodicity: {
    periodicity: string;
    changes: number;
    total: number | null;
  }[];
}

const num = (v: string | number | undefined) =>
  v === undefined ? "—" : Number(v).toLocaleString("pt-BR");

const brl = (v: number) =>
  v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

export default function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview"],
    queryFn: () => fetchJson<Overview>("/overview"),
  });

  const t = data?.totals ?? {};
  const pending = Number(t.monetarios_pendentes ?? 0);
  const changes = Number(t.alteracoes ?? 0);
  const priced = Number(t.com_impacto ?? 0);
  const coverage = changes > 0 ? Math.round((priced / changes) * 100) : 0;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6 text-primary" />
          Painel de Impacto
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          O que o sistema sabe hoje. Tudo aqui é medido — nada é projetado, e
          nenhum valor de periodicidades diferentes é somado.
        </p>
      </header>

      <div className="p-8 space-y-6">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {error && (
          <ApiErrorNotice error={error} what="O painel não pôde ser carregado." />
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Tile
                label="Vigências"
                value={num(t.vigencias)}
                hint={`${t.primeira_vigencia ?? "—"} → ${t.ultima_vigencia ?? "—"}`}
              />
              <Tile label="Ativos" value={num(t.ativos)} hint="cavalos e carretas" />
              <Tile label="Fatos" value={num(t.fatos)} hint="valores rastreáveis" />
              <Tile
                label="Alterações"
                value={num(t.alteracoes)}
                hint={`${num(t.comparacoes)} comparações`}
              />
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Impacto apurado até aqui</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Somado dentro de cada periodicidade, nunca entre elas.
                </p>
              </CardHeader>
              <CardContent>
                {data.impactByPeriodicity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nada calculável ainda — nenhuma semântica monetária confirmada.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-8">
                    {data.impactByPeriodicity.map((row) => (
                      <div key={row.periodicity}>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">
                          por {row.periodicity.toLowerCase()}
                        </div>
                        <div
                          className={cn(
                            "text-2xl font-bold tabular-nums",
                            (row.total ?? 0) < 0 ? "text-red-700" : "text-emerald-700",
                          )}
                        >
                          {row.total === null ? "—" : brl(row.total)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.changes} alterações
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Quanto da remuneração já dá para precificar
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${coverage}%` }}
                  />
                </div>
                <p className="text-sm">
                  <strong className="tabular-nums">{num(priced)}</strong> de{" "}
                  <strong className="tabular-nums">{num(changes)}</strong> alterações
                  têm impacto apurado ({coverage}%). As outras aparecem na lista, com
                  o motivo — o que falta é o preço, não o fato.
                </p>
                {pending > 0 && (
                  <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>
                      <strong>{pending}</strong> atributos monetários ainda sem
                      semântica confirmada. Cada um deles é um impacto que o
                      sistema se recusa a estimar.{" "}
                      <Link href="/curadoria" className="underline font-medium">
                        Ir para a Curadoria
                      </Link>
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {num(t.atributos_confirmados)} de {num(t.atributos)} atributos com
                  semântica confirmada · {num(t.inconclusivas)} comparações
                  inconclusivas
                </p>
              </CardContent>
            </Card>

            {data.latest && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    Última comparação
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="font-mono text-sm flex items-center gap-2">
                    {data.latest.snapshot_a_label}
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                    {data.latest.snapshot_b_label}
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <Metric label="Valores alterados" value={num(data.latest.value_changes)} />
                    <Metric
                      label="Ativos"
                      value={`+${data.latest.entities_added} / −${data.latest.entities_removed}`}
                    />
                    <Metric label="Inconclusivas" value={num(data.latest.inconclusive)} />
                    <Metric
                      label="Sem preço"
                      value={num(data.latest.impact_not_calculable)}
                    />
                  </div>
                  <Link
                    href="/alteracoes"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Ver as alterações
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </CardContent>
              </Card>
            )}

            <div className="flex gap-4 text-sm">
              <Link
                href="/curadoria"
                className="inline-flex items-center gap-2 text-primary hover:underline"
              >
                <FileSearch className="w-4 h-4" />
                Curadoria
              </Link>
              <Link
                href="/comparar"
                className="inline-flex items-center gap-2 text-primary hover:underline"
              >
                <Activity className="w-4 h-4" />
                Comparar vigências
              </Link>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
