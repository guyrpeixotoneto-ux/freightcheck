import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, HelpCircle, Lock, X } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/lib/api";
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
  total: number;
  rows: ChangeRow[];
}

export default function Alteracoes() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);

  const { data, isLoading, error } = useQuery({
    queryKey: ["changes", "latest", filters],
    queryFn: async () => {
      const response = await fetch(
        getApiUrl(`/changes/latest?${toQuery(filters)}`),
      );
      if (!response.ok) throw new Error((await response.json()).error ?? "Falha");
      return (await response.json()) as LatestResponse;
    },
  });

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          Alterações
        </h1>
        {data && (
          <p className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
            <span className="font-mono">{data.set.snapshotALabel}</span>
            <ArrowRight className="w-4 h-4" />
            <span className="font-mono">{data.set.snapshotBLabel}</span>
          </p>
        )}

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
            <Tile label="Valores alterados" value={data.set.valueChanges} />
            <Tile
              label="Ativos entraram / saíram"
              value={`+${data.set.entitiesAdded} / −${data.set.entitiesRemoved}`}
            />
            <Tile
              label="Colunas novas / removidas"
              value={`+${data.set.attributesAdded} / −${data.set.attributesRemoved}`}
            />
            <ImpactTile
              buckets={data.set.calculatedImpactByPeriodicity}
              outside={data.set.impactNotCalculable}
            />
            <Tile
              label="Inconclusivas"
              value={data.set.inconclusive}
              hint="listadas, não escondidas"
              tone={data.set.inconclusive > 0 ? "warn" : "muted"}
            />
          </div>
        )}
      </header>

      <div className="p-8 space-y-6">
        {data && data.set.impactNotCalculable > 0 && (
          <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              <strong>{data.set.impactNotCalculable}</strong> alterações estão
              fora da soma de impacto porque a semântica do atributo ainda não
              foi confirmada, ou porque ele não é um montante somável. Elas
              continuam na lista — o que falta é o preço, não o fato.
            </p>
          </div>
        )}

        <FilterBar
          filters={filters}
          onChange={setFilters}
          breakdown={data?.breakdown}
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
              {data ? `${data.total} alterações` : "Alterações"}
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
            {data && <ChangeTable rows={data.rows} total={data.total} />}
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
