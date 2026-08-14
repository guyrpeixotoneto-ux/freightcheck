import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Activity, AlertTriangle, ArrowRight, Lock } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ChangeTable,
  FilterBar,
  ImpactCell,
  type ChangeRow,
  type Breakdown,
  type Filters,
  emptyFilters,
  toQuery,
} from "@/components/changes/change-table";

/**
 * Alterações — o que mudou desde a vigência anterior.
 *
 * A tela responde, em ordem: o que mudou, de quanto para quanto, quanto isso
 * vale, em que parte da remuneração, e de onde veio. Materialidade ordena a
 * lista; nunca a filtra por conta própria.
 */

interface ConsolidatedResponse {
  view: {
    period: string;
    present: {
      entityTypeSet: string;
      sourceLabel: string;
      previousLabel: string | null;
      reason: string | null;
    }[];
    missing: string[];
    complete: boolean;
    totals: {
      valueChanges: number;
      entitiesAdded: number;
      entitiesRemoved: number;
      attributesAdded: number;
      attributesRemoved: number;
      inconclusive: number;
      impactNotCalculable: number;
    };
    impactByPeriodicity: Record<string, number>;
  };
  breakdown: Breakdown;
  periods: { effective_date: string; series: string[] }[];
  total: number;
  rows: ChangeRow[];
}

interface LatestResponse {
  set: {
    id: string;
    snapshotALabel: string;
    snapshotBLabel: string;
    valueChanges: number;
    entitiesAdded: number;
    entitiesRemoved: number;
    attributesAdded: number;
    attributesRemoved: number;
    unchanged: number;
    inconclusive: number;
    calculatedImpactByPeriodicity: Record<string, number>;
    impactNotCalculable: number;
  };
  breakdown: Breakdown;
  series: { entityTypeSet: string; vigencias: number; latestLabel: string }[];
  selectedSeries: string;
  total: number;
  rows: ChangeRow[];
}

export default function Alteracoes() {
  /*
    `?search=` chega preenchido quando alguém vem do Acompanhamento pedindo a
    lista de um parâmetro específico. É estado inicial, não filtro fixo: a
    barra de filtros continua mandando daí em diante, e limpar o campo devolve
    a lista inteira. O termo cobre código, nome do atributo e placa — ver
    `buildWhere` em `lib/comparison/src/query.ts`.
  */
  const buscaInicial = new URLSearchParams(useSearch()).get("search") ?? "";
  const [filters, setFilters] = useState<Filters>({
    ...emptyFilters,
    search: buscaInicial,
  });
  /** null = visão consolidada da frota; caso contrário, uma série. */
  const [series, setSeries] = useState<string | null>(null);

  const consolidated = useQuery({
    queryKey: ["changes", "consolidated", filters],
    queryFn: () =>
      fetchJson<ConsolidatedResponse>(
        `/changes/consolidated?${toQuery(filters)}`,
      ),
    enabled: series === null,
  });

  const single = useQuery({
    queryKey: ["changes", "latest", filters, series],
    queryFn: () =>
      fetchJson<LatestResponse>(
        `/changes/latest?${toQuery(filters)}&entityTypeSet=${series}`,
      ),
    enabled: series !== null,
  });

  const isLoading = series === null ? consolidated.isLoading : single.isLoading;
  const error = series === null ? consolidated.error : single.error;
  const cv = consolidated.data?.view;
  const data = single.data;

  // Séries conhecidas, para os botões. Vêm do consolidado, que enxerga todas.
  const known = [
    ...(cv?.present.map((p) => p.entityTypeSet) ?? []),
    ...(cv?.missing ?? []),
    ...(data?.series.map((s) => s.entityTypeSet) ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i).sort();

  const rows = series === null ? consolidated.data?.rows : data?.rows;
  const total = series === null ? consolidated.data?.total : data?.total;
  const breakdown = series === null ? consolidated.data?.breakdown : data?.breakdown;
  const totals =
    series === null
      ? cv?.totals
      : data && {
          valueChanges: data.set.valueChanges,
          entitiesAdded: data.set.entitiesAdded,
          entitiesRemoved: data.set.entitiesRemoved,
          attributesAdded: data.set.attributesAdded,
          attributesRemoved: data.set.attributesRemoved,
          inconclusive: data.set.inconclusive,
          impactNotCalculable: data.set.impactNotCalculable,
        };
  const impact =
    series === null
      ? (cv?.impactByPeriodicity ?? {})
      : (data?.set.calculatedImpactByPeriodicity ?? {});

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          Alterações
        </h1>
        <div className="flex flex-wrap items-center gap-3 mt-1">
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            {series === null ? (
              cv && <span className="font-mono">período {cv.period}</span>
            ) : (
              data && (
                <>
                  <span className="font-mono">{data.set.snapshotALabel}</span>
                  <ArrowRight className="w-4 h-4" />
                  <span className="font-mono">{data.set.snapshotBLabel}</span>
                </>
              )
            )}
          </p>

          {/* Consolidado é agrupamento de tela e API: soma as séries que
              entregaram no período. Nenhuma vigência é fundida no banco. */}
          {known.length > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSeries(null)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors",
                  series === null
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted border-input text-muted-foreground",
                )}
              >
                frota
              </button>
              {known.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeries(s)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors",
                    series === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted border-input text-muted-foreground",
                  )}
                >
                  {s.replace("+", " · ").toLowerCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
            <Tile label="Valores alterados" value={totals.valueChanges} />
            <Tile
              label="Ativos entraram / saíram"
              value={`+${totals.entitiesAdded} / −${totals.entitiesRemoved}`}
            />
            <Tile
              label="Colunas novas / removidas"
              value={`+${totals.attributesAdded} / −${totals.attributesRemoved}`}
            />
            <ImpactTile buckets={impact} outside={totals.impactNotCalculable} />
            <Tile
              label="Inconclusivas"
              value={totals.inconclusive}
              hint="listadas, não escondidas"
              tone={totals.inconclusive > 0 ? "warn" : "muted"}
            />
          </div>
        )}
      </header>

      <div className="p-8 space-y-6">
        {series === null && cv && !cv.complete && (
          <div className="flex gap-3 rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              <strong>Visão consolidada parcial.</strong> Para o período{" "}
              <span className="font-mono">{cv.period}</span> chegou apenas{" "}
              {cv.present.map((p) => p.entityTypeSet.toLowerCase()).join(", ")}.
              Falta <strong>{cv.missing.join(", ").toLowerCase()}</strong> — os
              números abaixo cobrem só o que foi entregue, e a série ausente não
              está contada como zero.
            </p>
          </div>
        )}

        {series === null && cv && cv.present.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Consolidado de{" "}
            {cv.present
              .map((p) =>
                p.previousLabel
                  ? `${p.entityTypeSet.toLowerCase()} (${p.previousLabel} → ${p.sourceLabel})`
                  : `${p.entityTypeSet.toLowerCase()} (${p.reason})`,
              )
              .join(" · ")}
            . Cada série é comparada com a anterior dela mesma; nada é fundido.
          </p>
        )}

        {totals && totals.impactNotCalculable > 0 && (
          <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              <strong>{totals.impactNotCalculable}</strong> alterações estão
              fora da soma de impacto porque a semântica do atributo ainda não
              foi confirmada, ou porque ele não é um montante somável. Elas
              continuam na lista — o que falta é o preço, não o fato.
            </p>
          </div>
        )}

        <FilterBar
          filters={filters}
          onChange={setFilters}
          breakdown={breakdown}
        />

        {error && (
          <Card>
            <CardContent className="p-6 text-sm text-red-800">
              {(error as Error).message}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {total !== undefined ? `${total} alterações` : "Alterações"}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ordenadas por materialidade: primeiro o que tem impacto apurado,
              depois pelo tamanho da variação. Nada é omitido por ser pequeno.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <p className="p-6 text-sm text-muted-foreground">Comparando…</p>
            )}
            {rows && total !== undefined && (
              <ChangeTable rows={rows} total={total} />
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

/**
 * Impacto apurado, uma linha por periodicidade.
 *
 * Nunca um número só: R$/mês e R$/ano são grandezas diferentes, e somá-las
 * seria exatamente o erro que este produto existe para pegar. Anualizar as
 * duas numa figura comparável é trabalho de F4, com regras próprias.
 */
function ImpactTile({
  buckets,
  outside,
}: {
  buckets: Record<string, number>;
  outside: number;
}) {
  const entries = Object.entries(buckets);
  const brl = (v: number) =>
    v.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">
        Impacto apurado
      </div>
      {entries.length === 0 ? (
        <div className="text-xl font-bold tabular-nums mt-1 text-muted-foreground">
          não calculável
        </div>
      ) : (
        <div className="mt-1 space-y-0.5">
          {entries.map(([periodicity, amount]) => (
            <div key={periodicity} className="flex items-baseline gap-1.5">
              <span
                className={cn(
                  "text-lg font-bold tabular-nums",
                  amount < 0 ? "text-red-700" : "text-emerald-700",
                )}
              >
                {brl(amount)}
              </span>
              <span className="text-xs text-muted-foreground">
                /{periodicity.toLowerCase()}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="text-xs text-muted-foreground mt-0.5">
        {outside} alterações fora destes valores
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = "muted",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "bad" | "warn" | "muted";
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-xl font-bold tabular-nums mt-1",
          tone === "good" && "text-emerald-700",
          tone === "bad" && "text-red-700",
          tone === "warn" && "text-amber-700",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
