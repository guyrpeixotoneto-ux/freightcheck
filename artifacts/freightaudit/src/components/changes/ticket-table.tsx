import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A tabela de chamados — a aba irmã da tabela de alterações.
 *
 * Deliberadamente **não** é a mesma tabela com outras linhas. Uma alteração de
 * planilha é uma diferença apurada entre duas vigências, e a pergunta dela é
 * "de quanto para quanto". Um chamado é um pedido com uma resposta, e as
 * perguntas dele são outras: quanto se pediu, quanto voltou, e há quanto tempo
 * está parado. Forçar os dois na mesma grade obrigaria um dos dois a mentir
 * sobre o que é — e a coluna que mais importa aqui, o tempo até o atendimento,
 * simplesmente não existe do outro lado.
 */

export interface TicketRow {
  id: string;
  externalId: string;
  openedAt: string | null;
  closedAt: string | null;
  statusRaw: string | null;
  statusBucket: string;
  parameterLabel: string | null;
  attributeCode: string | null;
  entityLabel: string | null;
  entityType: string | null;
  requestedValueRaw: string | null;
  requestedValueNumeric: number | null;
  appliedValueRaw: string | null;
  appliedValueNumeric: number | null;
  impactAmount: number | null;
  impactConfidence: string;
  impactReason: string | null;
  requestedBy: string | null;
  subject: string | null;
  sourceRowIndex: number;
  ageInDays: number | null;
  stillOpen: boolean;
}

export interface TicketTotals {
  total: number;
  byStatus: { statusBucket: string; count: number }[];
  calculated: number;
  notCalculable: number;
  impactSum: number;
  divergent: number;
  averageDaysToClose: number | null;
  stillOpen: number;
}

export interface TicketFilters {
  statusBucket: string;
  impactConfidence: string;
  search: string;
  minAbsImpact: string;
  onlyDivergent: boolean;
}

export const emptyTicketFilters: TicketFilters = {
  statusBucket: "",
  impactConfidence: "",
  search: "",
  minAbsImpact: "",
  onlyDivergent: false,
};

export function toTicketQuery(
  filters: TicketFilters,
  extra: Record<string, string> = {},
) {
  const params = new URLSearchParams();
  if (filters.statusBucket) params.set("statusBucket", filters.statusBucket);
  if (filters.impactConfidence)
    params.set("impactConfidence", filters.impactConfidence);
  if (filters.search) params.set("search", filters.search);
  if (filters.minAbsImpact) params.set("minAbsImpact", filters.minAbsImpact);
  if (filters.onlyDivergent) params.set("onlyDivergent", "true");
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  params.set("limit", "300");
  return params.toString();
}

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const decimal = (value: number) =>
  value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** ISO para `dd/mm/aaaa`. Sem data, o traço — nunca a data de hoje. */
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export const STATUS_LABELS: Record<string, string> = {
  ABERTO: "aberto",
  EM_ANDAMENTO: "em andamento",
  ATENDIDO: "atendido",
  RECUSADO: "recusado",
  CANCELADO: "cancelado",
  DESCONHECIDO: "sem status",
};

const STATUS_STYLES: Record<string, string> = {
  ABERTO: "bg-sky-100 text-sky-900 border-sky-300",
  EM_ANDAMENTO: "bg-amber-100 text-amber-900 border-amber-300",
  ATENDIDO: "bg-emerald-100 text-emerald-900 border-emerald-300",
  RECUSADO: "bg-red-100 text-red-900 border-red-300",
  CANCELADO: "bg-slate-200 text-slate-800 border-slate-300",
  DESCONHECIDO: "bg-muted text-muted-foreground border-input",
};

/**
 * O status como a fonte escreveu, na caixa em que a tela o agrupa.
 *
 * O texto original é o que aparece quando existe: "Em atendimento — nível 2"
 * diz mais do que "em andamento", e substituí-lo pela nossa caixa seria apagar
 * informação que o arquivo trouxe. A caixa fica no título, para quem precisar
 * entender por que aquele chamado caiu naquele filtro.
 */
function StatusBadge({ row }: { row: TicketRow }) {
  const bucket = row.statusBucket in STATUS_STYLES ? row.statusBucket : "DESCONHECIDO";
  return (
    <Badge
      className={cn(STATUS_STYLES[bucket], "hover:opacity-100 font-normal")}
      title={`agrupado como "${STATUS_LABELS[bucket]}"`}
    >
      {row.statusRaw ?? STATUS_LABELS[bucket]}
    </Badge>
  );
}

/**
 * Um valor do chamado: o número quando é número, o texto quando não é.
 *
 * "sob análise" na coluna de valor continua sendo "sob análise" aqui. Virar
 * zero, traço ou vazio seria trocar uma informação por uma afirmação falsa —
 * e é justamente essa troca que faz uma soma mentir.
 */
function ValueCell({ numeric, raw }: { numeric: number | null; raw: string | null }) {
  if (numeric !== null) {
    return <span className="font-mono tabular-nums">{decimal(numeric)}</span>;
  }
  if (raw && raw.trim() !== "") {
    return (
      <span className="text-xs text-muted-foreground italic" title="não é um número">
        {raw}
      </span>
    );
  }
  return <span className="text-muted-foreground italic">—</span>;
}

/** A mesma porta da aba Planilha: ou o número apurado, ou o motivo de não haver. */
function TicketImpactCell({ row }: { row: TicketRow }) {
  if (row.impactConfidence === "CALCULATED" && row.impactAmount !== null) {
    return (
      <span
        className={cn(
          "font-mono tabular-nums font-medium whitespace-nowrap",
          row.impactAmount < 0
            ? "text-red-700"
            : row.impactAmount > 0
              ? "text-emerald-700"
              : "text-muted-foreground",
        )}
        title={row.impactReason ?? undefined}
      >
        {row.impactAmount > 0 ? "+" : ""}
        {brl(row.impactAmount)}
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

export function TicketTable({ rows, total }: { rows: TicketRow[]; total: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Nenhum chamado com esses filtros.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
            <th className="w-8" />
            <th className="text-left px-4 py-2 font-medium">Chamado</th>
            <th className="text-left px-4 py-2 font-medium">Abertura</th>
            <th className="text-left px-4 py-2 font-medium">Status</th>
            <th className="text-left px-4 py-2 font-medium">Parâmetro</th>
            <th className="text-right px-4 py-2 font-medium">Valor pedido</th>
            <th className="text-right px-4 py-2 font-medium">Valor aplicado</th>
            <th className="text-right px-4 py-2 font-medium">Impacto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <>
              <tr
                key={row.id}
                className={cn(
                  "border-b hover:bg-muted/40 cursor-pointer",
                  // Um chamado atendido por menos do que se pediu é o motivo de
                  // esta aba existir; ele não pode parecer uma linha entre
                  // outras.
                  row.impactConfidence === "CALCULATED" &&
                    row.impactAmount !== null &&
                    row.impactAmount < 0 &&
                    "bg-red-50/60",
                  row.statusBucket === "RECUSADO" && "bg-amber-50/50",
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
                  <div className="font-mono font-medium">{row.externalId}</div>
                  {row.entityLabel && (
                    <div className="font-mono text-xs text-muted-foreground">
                      {row.entityLabel}
                      {row.entityType && (
                        <span className="opacity-70"> · {row.entityType}</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <div className="tabular-nums">{shortDate(row.openedAt)}</div>
                  {row.ageInDays !== null && (
                    <div
                      className={cn(
                        "text-xs",
                        row.stillOpen && row.ageInDays > 30
                          ? "text-amber-700"
                          : "text-muted-foreground",
                      )}
                    >
                      {row.stillOpen
                        ? `${row.ageInDays} d em aberto`
                        : `${row.ageInDays} d até fechar`}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge row={row} />
                </td>
                <td className="px-4 py-2">
                  <div className="font-medium">{row.parameterLabel ?? "—"}</div>
                  {row.attributeCode && (
                    <div
                      className="font-mono text-xs text-muted-foreground"
                      title="reconhecido no dicionário de atributos"
                    >
                      {row.attributeCode}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <ValueCell
                    numeric={row.requestedValueNumeric}
                    raw={row.requestedValueRaw}
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <ValueCell
                    numeric={row.appliedValueNumeric}
                    raw={row.appliedValueRaw}
                  />
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <TicketImpactCell row={row} />
                </td>
              </tr>
              {expanded === row.id && (
                <tr key={`${row.id}-detail`} className="border-b bg-muted/30">
                  <td />
                  <td colSpan={7} className="px-4 py-4">
                    <TicketDetail row={row} />
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

/**
 * O chamado aberto — inclusive a linha do arquivo, como ela veio.
 *
 * A linha original está aqui pela mesma razão que a proveniência célula a
 * célula está na outra aba: o mapeamento de colunas de um export de chamados é
 * um palpite justificado, e quem lê precisa poder conferi-lo sem pedir o
 * arquivo de volta a ninguém.
 */
function TicketDetail({ row }: { row: TicketRow }) {
  // A linha original só é buscada quando alguém abre o chamado: trezentas
  // linhas de arquivo viajando junto com a lista pagariam, em toda abertura de
  // tela, por uma leitura que quase ninguém faz.
  const { data } = useQuery({
    queryKey: ["ticket", row.id, "payload"],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/tickets/${row.id}`));
      if (!response.ok) return null;
      const body = (await response.json()) as {
        payload?: Record<string, unknown>;
      };
      return body.payload ?? null;
    },
  });
  const entries = Object.entries(data ?? {});
  return (
    <div className="space-y-3 text-sm">
      {row.subject && (
        <div className="rounded-md border bg-card px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">
            Assunto
          </div>
          {row.subject}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Solicitante" value={row.requestedBy ?? "—"} />
        <Field label="Abertura" value={shortDate(row.openedAt)} />
        <Field
          label="Fechamento"
          value={row.closedAt ? shortDate(row.closedAt) : "ainda em aberto"}
        />
        <Field
          label="Tempo"
          value={
            row.ageInDays === null
              ? "—"
              : `${row.ageInDays} dia${row.ageInDays === 1 ? "" : "s"}${row.stillOpen ? " (correndo)" : ""}`
          }
        />
      </div>

      {row.impactReason && (
        <div className="text-muted-foreground">
          <strong className="text-foreground">Impacto:</strong> {row.impactReason}
        </div>
      )}

      {entries.length > 0 && (
        <div className="rounded-md border bg-card px-3 py-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
            Linha {row.sourceRowIndex} do arquivo, como veio
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs">
            {entries.map(([header, value]) => (
              <div key={header} className="flex gap-2 min-w-0">
                <span className="text-muted-foreground shrink-0">{header}:</span>
                <span className="truncate">
                  {value === null || value === "" ? "—" : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

export function TicketFilterBar({
  filters,
  onChange,
  totals,
}: {
  filters: TicketFilters;
  onChange: (f: TicketFilters) => void;
  totals?: TicketTotals;
}) {
  const set = <K extends keyof TicketFilters>(key: K, value: TicketFilters[K]) =>
    onChange({
      ...filters,
      [key]: filters[key] === value ? emptyTicketFilters[key] : value,
    });

  const active =
    Boolean(filters.statusBucket) ||
    Boolean(filters.impactConfidence) ||
    Boolean(filters.search) ||
    Boolean(filters.minAbsImpact) ||
    filters.onlyDivergent;

  // A ordem é a do ciclo de vida, e não a da contagem: quem lê procura "os
  // recusados", não "o terceiro maior grupo".
  const ORDER = ["ABERTO", "EM_ANDAMENTO", "ATENDIDO", "RECUSADO", "CANCELADO", "DESCONHECIDO"];
  const present = ORDER.filter((bucket) =>
    totals?.byStatus.some((s) => s.statusBucket === bucket),
  );

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup label="Situação">
          {(present.length > 0 ? present : ORDER.slice(0, 4)).map((bucket) => (
            <Chip
              key={bucket}
              active={filters.statusBucket === bucket}
              onClick={() => set("statusBucket", bucket)}
            >
              {STATUS_LABELS[bucket]}
              {totals && (
                <Count
                  n={totals.byStatus.find((s) => s.statusBucket === bucket)?.count}
                />
              )}
            </Chip>
          ))}
        </FilterGroup>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterGroup label="Atendimento">
          <Chip
            active={filters.onlyDivergent}
            onClick={() => set("onlyDivergent", !filters.onlyDivergent)}
          >
            só divergentes
            {totals && <Count n={totals.divergent} />}
          </Chip>
          <Chip
            active={filters.impactConfidence === "CALCULATED"}
            onClick={() => set("impactConfidence", "CALCULATED")}
          >
            só com impacto apurado
            {totals && <Count n={totals.calculated} />}
          </Chip>
          <Chip
            active={filters.impactConfidence === "NOT_CALCULABLE"}
            onClick={() => set("impactConfidence", "NOT_CALCULABLE")}
          >
            só sem impacto apurado
            {totals && <Count n={totals.notCalculable} />}
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
            placeholder="Buscar chamado, parâmetro ou placa…"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="h-9 w-64"
          />
          {active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(emptyTicketFilters)}
            >
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
    <div className="flex items-center gap-1.5 flex-wrap">
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
