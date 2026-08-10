import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, GitCompareArrows } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiUrl } from "@/lib/api";
import {
  ChangeTable,
  FilterBar,
  emptyFilters,
  toQuery,
  type Breakdown,
  type ChangeRow,
  type Filters,
} from "@/components/changes/change-table";

/**
 * Comparar Vigências — duas quaisquer, escolhidas por você.
 *
 * A mesma tabela de Alterações, com o par definido à mão em vez de "a última
 * contra a anterior".
 */

interface Snapshot {
  id: string;
  sourceLabel: string;
  effectiveDate: string;
  entityTypeSet: string;
  entityCount: number;
  factCount: number;
}

interface ChangeSet {
  id: string;
  valueChanges: number;
  entitiesAdded: number;
  entitiesRemoved: number;
  attributesAdded: number;
  attributesRemoved: number;
  unchanged: number;
  inconclusive: number;
  calculatedImpactByPeriodicity: Record<string, number>;
  impactNotCalculable: number;
}

export default function Comparar() {
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [set, setSet] = useState<ChangeSet | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: snapshots = [] } = useQuery({
    queryKey: ["snapshots"],
    queryFn: async () =>
      (await (await fetch(getApiUrl("/snapshots"))).json()) as Snapshot[],
  });

  // Default to the two most recent, which is the comparison people want most.
  useEffect(() => {
    if (snapshots.length >= 2 && !aId && !bId) {
      setAId(snapshots[snapshots.length - 2].id);
      setBId(snapshots[snapshots.length - 1].id);
    }
  }, [snapshots, aId, bId]);

  const compare = useMutation({
    mutationFn: async () => {
      const response = await fetch(getApiUrl("/change-sets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotAId: aId, snapshotBId: bId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao comparar");
      return body as ChangeSet;
    },
    onSuccess: (result) => {
      setError(null);
      setSet(result);
    },
    onError: (err: Error) => {
      setSet(null);
      setError(err.message);
    },
  });

  const { data: changes } = useQuery({
    queryKey: ["change-set", set?.id, filters],
    queryFn: async () => {
      const response = await fetch(
        getApiUrl(`/change-sets/${set!.id}/changes?${toQuery(filters)}`),
      );
      return (await response.json()) as {
        breakdown: Breakdown;
        total: number;
        rows: ChangeRow[];
      };
    },
    enabled: set !== null,
  });

  const label = (id: string) => {
    const s = snapshots.find((x) => x.id === id);
    return s ? `${s.entityTypeSet} · ${s.sourceLabel}` : "—";
  };

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <GitCompareArrows className="w-6 h-6 text-primary" />
          Comparar Vigências
        </h1>
        <p className="text-muted-foreground mt-1">
          Duas vigências quaisquer, comparadas pela identidade do ativo e do
          atributo — nunca pela posição da linha na planilha.
        </p>

        <div className="flex flex-wrap items-end gap-3 mt-6">
          <SnapshotPicker
            label="Vigência anterior"
            value={aId}
            onChange={setAId}
            snapshots={snapshots}
          />
          <ArrowRight className="w-5 h-5 text-muted-foreground mb-2.5" />
          <SnapshotPicker
            label="Vigência nova"
            value={bId}
            onChange={setBId}
            snapshots={snapshots}
          />
          <Button
            onClick={() => compare.mutate()}
            disabled={!aId || !bId || aId === bId || compare.isPending}
          >
            {compare.isPending ? "Comparando…" : "Comparar"}
          </Button>
        </div>
      </header>

      <div className="p-8 space-y-6">
        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
        )}

        {set && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <Tile label="Valores alterados" value={set.valueChanges} />
              <Tile label="Sem alteração" value={set.unchanged} />
              <Tile label="Ativos entraram" value={`+${set.entitiesAdded}`} />
              <Tile label="Ativos saíram" value={`−${set.entitiesRemoved}`} />
              <Tile
                label="Colunas +/−"
                value={`+${set.attributesAdded} / −${set.attributesRemoved}`}
              />
              <Tile
                label="Impacto apurado"
                value={
                  Object.keys(set.calculatedImpactByPeriodicity).length === 0
                    ? "não calculável"
                    : Object.entries(set.calculatedImpactByPeriodicity)
                        .map(
                          ([p, v]) =>
                            `${v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}/${p.toLowerCase()}`,
                        )
                        .join("  ")
                }
                hint={`${set.impactNotCalculable} fora destes valores`}
              />
            </div>

            <FilterBar
              filters={filters}
              onChange={setFilters}
              breakdown={changes?.breakdown}
            />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {label(aId)} → {label(bId)}
                  {changes && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {changes.total} alterações
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {changes && (
                  <ChangeTable rows={changes.rows} total={changes.total} />
                )}
              </CardContent>
            </Card>
          </>
        )}

        {!set && !error && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              Escolha duas vigências e clique em Comparar.
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function SnapshotPicker({
  label,
  value,
  onChange,
  snapshots,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  snapshots: Snapshot[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Selecionar vigência…" />
        </SelectTrigger>
        <SelectContent>
          {snapshots.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {/* A série entra no rótulo porque carreta e cavalo usam o mesmo
                  nome de vigência: sem isso não há como escolher, e dá para
                  pedir uma comparação entre séries que o motor vai recusar. */}
              {s.entityTypeSet.replace("+", "·")} · {s.sourceLabel} ·{" "}
              {s.entityCount} ativos
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
