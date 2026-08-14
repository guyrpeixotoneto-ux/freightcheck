import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A tabela de alterações vindas de chamados.
 *
 * O grão é o mesmo da aba Planilha — **um parâmetro que mudou** —, e por isso
 * as colunas centrais são as mesmas: Antes, Agora, Variação, Impacto. Um
 * chamado que mexe em oito parâmetros produz oito linhas aqui, e não uma.
 *
 * Duas colunas são só deste lado, e são elas que justificam a aba existir:
 * **Chamado** (que pedido trouxe esta alteração) e **Situação** (em que pé
 * está, e há quanto tempo). E uma diferença não aparece como coluna, mas como
 * marca no valor: a procedência do "antes" — declarado pelo próprio chamado,
 * ou lido da vigência em vigor. As duas coisas não têm a mesma força de prova,
 * e mostrá-las iguais seria dar a um valor inferido a cara de um declarado.
 */

export interface TicketChangeRow {
  id: string;
  ticketId: string;
  externalId: string;
  openedAt: string | null;
  closedAt: string | null;
  statusRaw: string | null;
  statusBucket: string;
  requestedBy: string | null;
  subject: string | null;

  parameterLabel: string;
  attributeCode: string | null;
  entityLabel: string | null;
  entityType: string | null;

  valueBeforeRaw: string | null;
  valueBeforeNumeric: number | null;
  valueAfterRaw: string | null;
  valueAfterNumeric: number | null;
  beforeSource: string;
  beforeReference: string | null;

  deltaAbsolute: number | null;
  deltaPercent: number | null;
  impactAmount: number | null;
  impactConfidence: string;
  impactReason: string | null;

  ageInDays: number | null;
  stillOpen: boolean;
}

export interface TicketTotals {
  changes: number;
  tickets: number;
  byStatus: { statusBucket: string; count: number }[];
  byBeforeSource: { beforeSource: string; count: number }[];
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
  beforeSource: string;
  parameterLabel: string;
  search: string;
  minAbsImpact: string;
  onlyDivergent: boolean;
}

export const emptyTicketFilters: TicketFilters = {
  statusBucket: "",
  impactConfidence: "",
  beforeSource: "",
  parameterLabel: "",
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
  if (filters.beforeSource) params.set("beforeSource", filters.beforeSource);
  if (filters.parameterLabel) params.set("parameterLabel", filters.parameterLabel);
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

export const BEFORE_SOURCE_LABELS: Record<string, string> = {
  ARQUIVO: "declarado no chamado",
  VIGENCIA: "lido da vigência em vigor",
  AUSENTE: "sem valor anterior",
};

/**
 * O status como a fonte escreveu, na caixa em que a tela o agrupa.
 *
 * O texto original é o que aparece quando existe: "Em atendimento — nível 2"
 * diz mais do que "em andamento", e substituí-lo pela nossa caixa seria apagar
 * informação que o arquivo trouxe.
 */
function StatusBadge({ row }: { row: TicketChangeRow }) {
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
 * Um valor: o número quando é número, o texto quando não é.
 *
 * "sob análise" na coluna de valor continua sendo "sob análise" aqui. Virar
 * zero, traço ou vazio seria trocar uma informação por uma afirmação falsa —
 * e é essa troca que faz uma soma mentir.
 */
function ValueCell({
  numeric,
  raw,
  inferido,
  referencia,
}: {
  numeric: number | null;
  raw: string | null;
  /** True quando o valor não foi declarado pelo chamado, e sim lido por nós. */
  inferido?: boolean;
  referencia?: string | null;
}) {
  const conteudo =
    numeric !== null ? (
      <span className="font-mono tabular-nums">{decimal(numeric)}</span>
    ) : raw && raw.trim() !== "" ? (
      <span className="text-xs text-muted-foreground italic" title="não é um número">
        {raw}
      </span>
    ) : (
      <span className="text-muted-foreground italic">—</span>
    );

  if (!inferido) return conteudo;
  return (
    <span
      // A borda tracejada é a marca de "isto não veio do chamado". Um valor
      // inferido com a mesma cara de um declarado é o começo de toda conta
      // que ninguém consegue sustentar depois.
      className="inline-flex items-center gap-1 border-b border-dashed border-muted-foreground/60"
      title={
        referencia
          ? `valor da vigência em vigor (${referencia}) — o chamado não declarou o anterior`
          : "valor da vigência em vigor — o chamado não declarou o anterior"
      }
    >
      {conteudo}
    </span>
  );
}

/** Ou o número apurado, ou o motivo de não haver. Nunca um espaço em branco. */
function TicketImpactCell({ row }: { row: TicketChangeRow }) {
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

export function TicketChangeTable({
  rows,
  total,
}: {
  rows: TicketChangeRow[];
  total: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Nenhuma alteração de chamado com esses filtros.
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
            <th className="text-left px-4 py-2 font-medium">Parâmetro</th>
            <th className="text-right px-4 py-2 font-medium">Antes</th>
            <th className="text-right px-4 py-2 font-medium">Agora</th>
            <th className="text-right px-4 py-2 font-medium">Variação</th>
            <th className="text-right px-4 py-2 font-medium">Impacto</th>
            <th className="text-left px-4 py-2 font-medium">Situação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <>
              <tr
                key={row.id}
                className={cn(
                  "border-b hover:bg-muted/40 cursor-pointer",
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
                <td className="px-4 py-2 whitespace-nowrap">
                  <div className="font-mono font-medium">{row.externalId}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {shortDate(row.openedAt)}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <div className="font-medium">{row.parameterLabel}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {row.attributeCode ?? (
                      <span
                        className="italic"
                        title="o dicionário de atributos ainda não conhece este nome"
                      >
                        fora do dicionário
                      </span>
                    )}
                    {row.entityLabel && <> · {row.entityLabel}</>}
                  </div>
                </td>
                <td className="px-4 py-2 text-right">
                  <ValueCell
                    numeric={row.valueBeforeNumeric}
                    raw={row.valueBeforeRaw}
                    inferido={row.beforeSource === "VIGENCIA"}
                    referencia={row.beforeReference}
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  <ValueCell
                    numeric={row.valueAfterNumeric}
                    raw={row.valueAfterRaw}
                  />
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {row.deltaAbsolute === null ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <>
                      <div
                        className={
                          row.deltaAbsolute < 0 ? "text-red-700" : "text-emerald-700"
                        }
                      >
                        {row.deltaAbsolute > 0 ? "+" : ""}
                        {decimal(row.deltaAbsolute)}
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
                  <TicketImpactCell row={row} />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge row={row} />
                  {row.ageInDays !== null && (
                    <div
                      className={cn(
                        "text-xs mt-0.5",
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

interface TicketDetailResponse {
  externalId: string;
  requestedBy: string | null;
  subject: string | null;
  closedAt: string | null;
  sourceRowIndex: number;
  changedParameterCount: number;
  payload: Record<string, unknown>;
  changes: {
    parameterLabel: string;
    attributeCode: string | null;
    valueBeforeRaw: string | null;
    valueAfterRaw: string | null;
    beforeSource: string;
    beforeReference: string | null;
    deltaAbsolute: number | null;
    impactAmount: number | null;
    impactConfidence: string;
    impactReason: string | null;
  }[];
}

/**
 * O chamado inteiro por trás de uma linha.
 *
 * A lista responde "o que mudou"; quem abre uma linha quase sempre quer a
 * pergunta inversa — *o que **mais** este chamado alterou?* —, porque um
 * chamado que mexe em oito parâmetros aparece espalhado por oito linhas e
 * nenhuma delas conta a história toda.
 *
 * A linha original do arquivo vem junto pela mesma razão que a proveniência
 * célula a célula está na outra aba: o mapeamento de colunas é um palpite
 * justificado, e quem lê precisa poder conferi-lo sem pedir o arquivo de volta
 * a ninguém.
 */
function TicketDetail({ row }: { row: TicketChangeRow }) {
  const { data, isLoading } = useQuery({
    queryKey: ["ticket", row.ticketId],
    queryFn: async () => {
      const response = await fetch(getApiUrl(`/tickets/${row.ticketId}`));
      if (!response.ok) return null;
      return (await response.json()) as TicketDetailResponse;
    },
  });

  const entries = Object.entries(data?.payload ?? {});

  return (
    <div className="space-y-3 text-sm">
      {row.impactReason && (
        <div className="text-muted-foreground">
          <strong className="text-foreground">Impacto:</strong> {row.impactReason}
        </div>
      )}

      {row.beforeSource === "VIGENCIA" && (
        <div className="rounded-md border-l-4 border-sky-500 bg-sky-50 px-3 py-2 text-sky-900">
          <strong className="text-xs uppercase tracking-wide block mb-0.5">
            O valor anterior não veio do chamado
          </strong>
          O chamado declarou só o valor novo. O &quot;antes&quot; acima foi lido
          da vigência em vigor
          {row.beforeReference && (
            <> (<span className="font-mono">{row.beforeReference}</span>)</>
          )}{" "}
          para <span className="font-mono">{row.entityLabel ?? "este ativo"}</span>.
          É o nosso melhor conhecimento do estado anterior — não uma declaração
          da fonte.
        </div>
      )}

      {isLoading && (
        <p className="text-muted-foreground">Carregando o chamado…</p>
      )}

      {data && (
        <>
          {data.subject && (
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">
                Assunto
              </div>
              {data.subject}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Solicitante" value={data.requestedBy ?? "—"} />
            <Field label="Abertura" value={shortDate(row.openedAt)} />
            <Field
              label="Fechamento"
              value={data.closedAt ? shortDate(data.closedAt) : "ainda em aberto"}
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

          {data.changes.length > 1 && (
            <div className="rounded-md border bg-card px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                Os {data.changes.length} parâmetros deste chamado
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {data.changes.map((c) => (
                    <tr
                      key={c.parameterLabel}
                      className={cn(
                        "border-t first:border-t-0",
                        c.parameterLabel === row.parameterLabel && "font-medium",
                      )}
                    >
                      <td className="py-1 pr-3">{c.parameterLabel}</td>
                      <td className="py-1 pr-3 text-right font-mono text-muted-foreground">
                        {c.valueBeforeRaw ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right font-mono">
                        {c.valueAfterRaw ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "py-1 text-right font-mono tabular-nums",
                          c.deltaAbsolute === null
                            ? "text-muted-foreground"
                            : c.deltaAbsolute < 0
                              ? "text-red-700"
                              : "text-emerald-700",
                        )}
                      >
                        {c.deltaAbsolute === null
                          ? "—"
                          : `${c.deltaAbsolute > 0 ? "+" : ""}${decimal(c.deltaAbsolute)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {entries.length > 0 && (
            <details className="rounded-md border bg-card px-3 py-2">
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground">
                Linha {data.sourceRowIndex} do arquivo, como veio
              </summary>
              <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs">
                {entries.map(([header, value]) => (
                  <div key={header} className="flex gap-2 min-w-0">
                    <span className="text-muted-foreground shrink-0">{header}:</span>
                    <span className="truncate">
                      {value === null || value === "" ? "—" : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
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
    Boolean(filters.beforeSource) ||
    Boolean(filters.parameterLabel) ||
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

        <FilterGroup label="Valor anterior">
          {["ARQUIVO", "VIGENCIA", "AUSENTE"].map((source) => (
            <Chip
              key={source}
              active={filters.beforeSource === source}
              onClick={() => set("beforeSource", source)}
            >
              {BEFORE_SOURCE_LABELS[source]}
              {totals && (
                <Count
                  n={
                    totals.byBeforeSource.find((s) => s.beforeSource === source)
                      ?.count
                  }
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
            só o que variou
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
            placeholder="Variação mínima"
            value={filters.minAbsImpact}
            onChange={(e) => onChange({ ...filters, minAbsImpact: e.target.value })}
            className="h-9 w-40"
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

      {filters.parameterLabel && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          filtrando pelo parâmetro
          <span className="font-medium text-foreground">
            {filters.parameterLabel}
          </span>
          <button
            className="underline"
            onClick={() => onChange({ ...filters, parameterLabel: "" })}
          >
            remover
          </button>
        </div>
      )}
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
