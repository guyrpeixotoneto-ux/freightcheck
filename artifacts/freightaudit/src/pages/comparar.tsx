import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, GitCompareArrows } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchJson, getApiUrl } from "@/lib/api";
import {
  ChangeTable,
  FilterBar,
  emptyFilters,
  toQuery,
  type Breakdown,
  type ChangeRow,
  type Filters,
} from "@/components/changes/change-table";
import { primeiraPagina, type Janela } from "@/lib/paginacao";

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
  /**
   * O impacto desta comparação. `oficial` é o que a tela publica; `bruto` é
   * conferência técnica e nunca aparece rotulado "Impacto apurado".
   */
  impacto: {
    oficial: Record<string, number>;
    bruto: Record<string, number>;
    mudancasForaDoTotal: number;
  };
  impactNotCalculable: number;
}

export default function Comparar() {
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [set, setSet] = useState<ChangeSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [janela, setJanela] = useState<Janela>(primeiraPagina);

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => {
    setJanela((atual) => (atual.pagina === 1 ? atual : { ...atual, pagina: 1 }));
  }, [filters, set?.id]);

  const { data: snapshots = [], error: snapshotsError } = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<Snapshot[]>("/snapshots"),
  });

  /**
   * A vigência mais recente contra a anterior **da mesma série**.
   *
   * Pegar simplesmente as duas últimas da lista emparelhava Cavalo com Carreta
   * assim que as duas séries passaram a existir: elas compartilham as mesmas
   * datas, então as duas últimas linhas são o mesmo mês em séries diferentes. O
   * motor recusava o par, corretamente, e a tela abria com um erro que não era
   * culpa de quem estava olhando.
   */
  useEffect(() => {
    if (snapshots.length >= 2 && !aId && !bId) {
      const latest = snapshots[snapshots.length - 1];
      const previous = [...snapshots]
        .reverse()
        .find(
          (s) => s.entityTypeSet === latest.entityTypeSet && s.id !== latest.id,
        );
      if (!previous) return;
      setAId(previous.id);
      setBId(latest.id);
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
    queryKey: ["change-set", set?.id, filters, janela],
    queryFn: () =>
      fetchJson<{
        breakdown: Breakdown;
        total: number;
        rows: ChangeRow[];
      }>(`/change-sets/${set!.id}/changes?${toQuery(filters, {}, janela)}`),
    enabled: set !== null,
  });

  /**
   * Carreta e Cavalo são séries independentes, com frotas e colunas próprias.
   * Comparar uma com a outra não produz uma alteração — produz a diferença
   * entre dois cadastros distintos. O motor recusa esse par; a tela avisa
   * antes, para o operador não descobrir isso por um erro.
   */
  const seriesA = snapshots.find((s) => s.id === aId)?.entityTypeSet;
  const seriesB = snapshots.find((s) => s.id === bId)?.entityTypeSet;
  const seriesMismatch = Boolean(seriesA && seriesB && seriesA !== seriesB);

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
            disabled={
              !aId || !bId || aId === bId || seriesMismatch || compare.isPending
            }
          >
            {compare.isPending ? "Comparando…" : "Comparar"}
          </Button>
        </div>

        {seriesMismatch && (
          <p className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-md px-3 py-2 max-w-3xl">
            <strong>{seriesA}</strong> e <strong>{seriesB}</strong> são séries
            independentes — frotas e colunas diferentes. A diferença entre elas
            não é uma alteração da fonte. Escolha duas vigências da mesma série.
          </p>
        )}
      </header>

      <div className="p-8 space-y-6">
        {snapshotsError && (
          <ApiErrorNotice
            error={snapshotsError}
            what="As vigências disponíveis não puderam ser carregadas."
          />
        )}

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
                  Object.keys(set.impacto.oficial).length === 0
                    ? "não calculável"
                    : Object.entries(set.impacto.oficial)
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
              comClasse
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
                  <ChangeTable
                    rows={changes.rows}
                    total={changes.total}
                    janela={janela}
                    onJanela={setJanela}
                  />
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
