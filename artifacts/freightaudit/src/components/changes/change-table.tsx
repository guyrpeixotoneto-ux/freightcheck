import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The changes table, shared by Alterações and Comparar.
 *
 * Columns follow the question order: Atributo | Antes | Agora | Variação |
 * Impacto | Classificação | Origem. Expanding a row shows both sides down to
 * the originating cell.
 */

export interface ChangeRow {
  id: number;
  category: string;
  changeType: string;
  nature: string | null;
  attributeCode: string | null;
  attributeName: string | null;
  entityLabel: string | null;
  entityType: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  deltaAbsolute: number | null;
  deltaPercent: number | null;
  comparability: string;
  inconclusiveReason: string | null;
  impactConfidence: string;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  impactReason: string | null;
  costClass: string | null;
  taxonomyName: string | null;
  semanticsStatus: string | null;
}

export interface Breakdown {
  byCostClass: { costClass: string; count: number; impact: number | null }[];
  byType: { changeType: string; count: number }[];
  bySemantics: { semanticsStatus: string; count: number }[];
}

export interface Filters {
  costClass: string;
  changeType: string;
  semanticsStatus: string;
  comparability: string;
  impactConfidence: string;
  search: string;
  minAbsImpact: string;
}

export const emptyFilters: Filters = {
  costClass: "",
  changeType: "",
  semanticsStatus: "",
  comparability: "",
  impactConfidence: "",
  search: "",
  minAbsImpact: "",
};

export function toQuery(filters: Filters, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value) params.set(key, value);
  }
  params.set("limit", "300");
  return params.toString();
}

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ImpactCell({ row }: { row: ChangeRow }) {
  if (row.impactConfidence === "CALCULATED" && row.impactAmount !== null) {
    return (
      <span
        className={cn(
          // whitespace-nowrap: a minus sign wrapping onto its own line turns
          // "-R$ 7.700,16" into something that reads as a positive figure.
          "font-mono tabular-nums font-medium whitespace-nowrap",
          row.impactAmount < 0 ? "text-red-700" : "text-emerald-700",
        )}
        title={row.impactReason ?? undefined}
      >
        {brl(row.impactAmount)}
        {row.impactPeriodicity && (
          <span className="text-muted-foreground font-normal whitespace-nowrap">
            {" "}
            /{row.impactPeriodicity.toLowerCase()}
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      className="text-xs text-muted-foreground inline-flex items-center gap-1"
      title={row.impactReason ?? undefined}
    >
      <HelpCircle className="w-3 h-3" />
      não calculável
    </span>
  );
}

function CostClassBadge({ costClass }: { costClass: string | null }) {
  if (costClass === "FIXO")
    return <Badge className="bg-blue-100 text-blue-900 border-blue-300 hover:bg-blue-100">Fixo</Badge>;
  if (costClass === "VARIAVEL")
    return <Badge className="bg-violet-100 text-violet-900 border-violet-300 hover:bg-violet-100">Variável</Badge>;
  return (
    <Badge variant="outline" className="text-muted-foreground">
      sem classe
    </Badge>
  );
}

function NatureBadge({ row }: { row: ChangeRow }) {
  const map: Record<string, { label: string; className: string }> = {
    ENTITY_ADDED: { label: "ativo entrou", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
    ENTITY_REMOVED: { label: "ativo saiu", className: "bg-red-100 text-red-900 border-red-300" },
    ATTRIBUTE_ADDED: { label: "coluna nova", className: "bg-emerald-100 text-emerald-900 border-emerald-300" },
    ATTRIBUTE_REMOVED: { label: "coluna removida", className: "bg-red-100 text-red-900 border-red-300" },
  };
  const byType = map[row.changeType];
  if (byType) {
    return <Badge className={cn(byType.className, "hover:opacity-100")}>{byType.label}</Badge>;
  }
  const natures: Record<string, string> = {
    NUMERIC: "valor",
    TEXT: "texto",
    BOOLEAN: "booleano",
    DATE: "data",
    ZEROING: "zerou",
    FROM_ZERO: "saiu de zero",
    APPEARED: "passou a existir",
    DISAPPEARED: "deixou de existir",
    NULL_REASON: "motivo da ausência",
    TYPE_CHANGE: "mudou de tipo",
  };
  return (
    <Badge variant="outline" className="text-muted-foreground font-normal">
      {natures[row.nature ?? ""] ?? row.nature ?? "—"}
    </Badge>
  );
}

export function ChangeTable({ rows, total }: { rows: ChangeRow[]; total: number }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Nenhuma alteração com esses filtros.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
            <th className="w-8" />
            <th className="text-left px-4 py-2 font-medium">Atributo</th>
            <th className="text-right px-4 py-2 font-medium">Antes</th>
            <th className="text-right px-4 py-2 font-medium">Agora</th>
            <th className="text-right px-4 py-2 font-medium">Variação</th>
            <th className="text-right px-4 py-2 font-medium">Impacto</th>
            <th className="text-left px-4 py-2 font-medium">Classificação</th>
            <th className="text-left px-4 py-2 font-medium">Origem</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <>
              <tr
                key={row.id}
                className={cn(
                  "border-b hover:bg-muted/40 cursor-pointer",
                  row.comparability === "INCONCLUSIVE" && "bg-amber-50/50",
                )}
                onClick={() => setExpanded(expanded === row.id ? null : row.id)}
              >
                <td className="pl-3 text-muted-foreground">
                  {expanded === row.id ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </td>
                <td className="px-4 py-2">
                  <div className="font-mono text-xs text-muted-foreground">
                    {row.attributeCode ?? "—"}
                  </div>
                  <div className="font-medium">{row.attributeName ?? "—"}</div>
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {row.valueBefore ?? <span className="text-muted-foreground italic">—</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {row.valueAfter ?? <span className="text-muted-foreground italic">—</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {row.deltaAbsolute === null ? (
                    <span className="text-xs text-amber-800">inconclusiva</span>
                  ) : (
                    <>
                      <div className={row.deltaAbsolute < 0 ? "text-red-700" : "text-emerald-700"}>
                        {row.deltaAbsolute > 0 ? "+" : ""}
                        {row.deltaAbsolute.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                      </div>
                      {row.deltaPercent !== null && (
                        <div className="text-xs text-muted-foreground">
                          {row.deltaPercent > 0 ? "+" : ""}
                          {row.deltaPercent.toFixed(1)}%
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <ImpactCell row={row} />
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-col gap-1 items-start">
                    <CostClassBadge costClass={row.costClass} />
                    <NatureBadge row={row} />
                  </div>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {row.entityLabel ?? "—"}
                  {row.entityType && (
                    <div className="opacity-70">{row.entityType}</div>
                  )}
                </td>
              </tr>
              {expanded === row.id && (
                <tr key={`${row.id}-detail`} className="border-b bg-muted/30">
                  <td />
                  <td colSpan={7} className="px-4 py-4">
                    <ChangeDetail row={row} />
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      {total > rows.length && (
        <p className="px-4 py-3 text-xs text-muted-foreground border-t">
          Mostrando {rows.length} de {total}. Use os filtros para chegar ao
          restante — nada foi descartado.
        </p>
      )}
    </div>
  );
}

function ChangeDetail({ row }: { row: ChangeRow }) {
  const { data } = useQuery({
    queryKey: ["change", row.id, "provenance"],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/changes/${row.id}/provenance`));
      if (!response.ok) return null;
      return (await response.json()) as Record<string, string | number | null>;
    },
  });

  return (
    <div className="space-y-3 text-sm">
      {row.inconclusiveReason && (
        <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-amber-900">
          <strong className="text-xs uppercase tracking-wide block mb-0.5">
            Comparação inconclusiva
          </strong>
          {row.inconclusiveReason}
        </div>
      )}
      {row.impactReason && (
        <div className="text-muted-foreground">
          <strong className="text-foreground">Impacto:</strong> {row.impactReason}
        </div>
      )}
      <div className="text-muted-foreground">
        <strong className="text-foreground">Semântica:</strong>{" "}
        {row.semanticsStatus ?? "—"}
        {row.taxonomyName && <> · {row.taxonomyName}</>}
      </div>

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ProvenanceSide
            title={`Antes — ${data.snapshot_before}`}
            sheet={data.sheet_before}
            row={data.row_before}
            column={data.column_before}
            header={data.header_before}
            raw={data.raw_before}
            type={data.type_before}
          />
          <ProvenanceSide
            title={`Agora — ${data.snapshot_after}`}
            sheet={data.sheet_after}
            row={data.row_after}
            column={data.column_after}
            header={data.header_after}
            raw={data.raw_after}
            type={data.type_after}
          />
        </div>
      )}
    </div>
  );
}

function ProvenanceSide({
  title,
  sheet,
  row,
  column,
  header,
  raw,
  type,
}: {
  title: string;
  sheet: unknown;
  row: unknown;
  column: unknown;
  header: unknown;
  raw: unknown;
  type: unknown;
}) {
  if (!sheet) {
    return (
      <div className="rounded-md border bg-card px-3 py-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
          {title}
        </div>
        <div className="text-sm text-muted-foreground italic">
          Sem célula de origem deste lado.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-card px-3 py-2 font-mono text-xs">
      <div className="uppercase tracking-wide text-muted-foreground mb-1 font-sans">
        {title}
      </div>
      <div>
        aba <strong>{String(sheet)}</strong> · linha <strong>{String(row)}</strong> ·
        coluna <strong>{String(column)}</strong>
      </div>
      <div className="text-muted-foreground">cabeçalho: {String(header)}</div>
      <div className="text-muted-foreground">
        valor original: {String(raw)} ({String(type)})
      </div>
    </div>
  );
}

export function FilterBar({
  filters,
  onChange,
  breakdown,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  breakdown?: Breakdown;
}) {
  const set = (key: keyof Filters, value: string) =>
    onChange({ ...filters, [key]: filters[key] === value ? "" : value });

  const active = Object.values(filters).some(Boolean);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup label="Classe">
          <Chip active={filters.costClass === "FIXO"} onClick={() => set("costClass", "FIXO")}>
            Custo fixo
            {breakdown && <Count n={breakdown.byCostClass.find((c) => c.costClass === "FIXO")?.count} />}
          </Chip>
          <Chip active={filters.costClass === "VARIAVEL"} onClick={() => set("costClass", "VARIAVEL")}>
            Custo variável
            {breakdown && <Count n={breakdown.byCostClass.find((c) => c.costClass === "VARIAVEL")?.count} />}
          </Chip>
          <Chip active={filters.costClass === "SEM_CLASSE"} onClick={() => set("costClass", "SEM_CLASSE")}>
            Sem classe
            {breakdown && <Count n={breakdown.byCostClass.find((c) => c.costClass === "SEM_CLASSE")?.count} />}
          </Chip>
        </FilterGroup>

        <FilterGroup label="Tipo">
          {[
            ["VALUE_CHANGED", "valor mudou"],
            ["ENTITY_ADDED", "ativo entrou"],
            ["ENTITY_REMOVED", "ativo saiu"],
            ["ATTRIBUTE_ADDED", "coluna nova"],
            ["ATTRIBUTE_REMOVED", "coluna removida"],
          ].map(([value, label]) => (
            <Chip
              key={value}
              active={filters.changeType === value}
              onClick={() => set("changeType", value)}
            >
              {label}
              {breakdown && (
                <Count n={breakdown.byType.find((t) => t.changeType === value)?.count} />
              )}
            </Chip>
          ))}
        </FilterGroup>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup label="Semântica">
          {["CONFIRMED", "PRESUMED", "UNKNOWN"].map((value) => (
            <Chip
              key={value}
              active={filters.semanticsStatus === value}
              onClick={() => set("semanticsStatus", value)}
            >
              {value.toLowerCase()}
              {breakdown && (
                <Count n={breakdown.bySemantics.find((s) => s.semanticsStatus === value)?.count} />
              )}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Comparação">
          <Chip
            active={filters.comparability === "INCONCLUSIVE"}
            onClick={() => set("comparability", "INCONCLUSIVE")}
          >
            só inconclusivas
          </Chip>
          <Chip
            active={filters.impactConfidence === "CALCULATED"}
            onClick={() => set("impactConfidence", "CALCULATED")}
          >
            só com impacto apurado
          </Chip>
        </FilterGroup>

        <div className="flex items-center gap-2 ml-auto">
          <Input
            placeholder="Materialidade mínima (R$)"
            value={filters.minAbsImpact}
            onChange={(e) => onChange({ ...filters, minAbsImpact: e.target.value })}
            className="h-9 w-48"
            inputMode="numeric"
          />
          <Input
            placeholder="Buscar atributo ou placa…"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="h-9 w-56"
          />
          {active && (
            <Button variant="ghost" size="sm" onClick={() => onChange(emptyFilters)}>
              limpar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-xs px-2.5 py-1 rounded-full border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background hover:bg-muted border-input text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Count({ n }: { n?: number }) {
  if (n === undefined) return null;
  return <span className="ml-1 opacity-60 tabular-nums">{n}</span>;
}
