import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  HelpCircle,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A tabela de alterações vindas de chamados.
 *
 * O grão é o mesmo da aba Planilha — **um parâmetro que mudou**. Um chamado
 * que mexe em oito parâmetros produz oito linhas aqui, e não uma.
 *
 * A tabela tem cinco colunas, e nenhuma delas é "Antes" ou "Agora": o par
 * antes → agora mora embaixo do nome do parâmetro, junto do código do atributo
 * e da placa, porque é ali que ele se lê como uma frase só — *este chamado
 * mexeu neste parâmetro deste ativo, de tanto para tanto*. As colunas ficam
 * para as perguntas que se fazem sobre a lista inteira, e que por isso ordenam:
 * que tipo de mexida foi, quanto custou, em que pé está o chamado, e quando a
 * alteração passou a valer.
 *
 * Duas coisas são só deste lado, e são elas que justificam a aba existir:
 * o **chamado** que trouxe a alteração e a **situação** dele. E uma terceira não
 * aparece como coluna, mas como marca no valor: a procedência do "antes" —
 * declarado pelo próprio chamado, ou lido da vigência em vigor. As duas não têm
 * a mesma força de prova, e mostrá-las iguais seria dar a um valor inferido a
 * cara de um declarado.
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
  vigenciaLabel: string | null;
  entityDescription: string | null;

  parameterLabel: string;
  changeKind: string | null;
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
  byChangeKind: { changeKind: string | null; count: number }[];
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
  changeKind: string;
  parameterLabel: string;
  /** O assunto do chamado, exato. É por onde a visão por tipo abre uma folha. */
  subject: string;
  /**
   * Só os chamados sem assunto.
   *
   * Separado de `subject` porque vazio já quer dizer "sem filtro" em todo o
   * resto desta interface — e o grupo dos sem assunto é uma folha de verdade da
   * árvore por tipo, que sem isto seria a única que não abriria.
   */
  subjectMissing: boolean;
  search: string;
  minAbsImpact: string;
  onlyDivergent: boolean;
}

export const emptyTicketFilters: TicketFilters = {
  statusBucket: "",
  impactConfidence: "",
  beforeSource: "",
  changeKind: "",
  parameterLabel: "",
  subject: "",
  subjectMissing: false,
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
  if (filters.changeKind) params.set("changeKind", filters.changeKind);
  if (filters.parameterLabel) params.set("parameterLabel", filters.parameterLabel);
  if (filters.subjectMissing) params.set("subjectMissing", "true");
  else if (filters.subject) params.set("subject", filters.subject);
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
 * O que o chamado fez com o parâmetro, em português.
 *
 * Isto não é enfeite: num export real, `FORM_THIS` é 85% das linhas. Sem esta
 * etiqueta a tabela mostra centenas de alterações com as colunas de valor
 * vazias e nada explicando por quê — e quem lê conclui, com razão, que o
 * sistema perdeu o dado. A etiqueta é o que transforma "vazio" em "não é sobre
 * um valor".
 */
export const CHANGE_KIND_LABELS: Record<string, string> = {
  SET: "valor",
  FORM_THIS: "fórmula",
  ADD: "inclusão",
  REMOVE: "remoção",
};

const CHANGE_KIND_STYLES: Record<string, string> = {
  SET: "bg-blue-100 text-blue-900 border-blue-300",
  FORM_THIS: "bg-violet-100 text-violet-900 border-violet-300",
  ADD: "bg-emerald-100 text-emerald-900 border-emerald-300",
  REMOVE: "bg-red-100 text-red-900 border-red-300",
};

export function changeKindLabel(kind: string | null): string {
  if (!kind) return "—";
  return CHANGE_KIND_LABELS[kind] ?? kind.toLowerCase();
}

function ChangeKindBadge({ kind }: { kind: string | null }) {
  if (!kind) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-normal text-[11px] px-1.5 py-0",
        CHANGE_KIND_STYLES[kind] ?? "text-muted-foreground",
      )}
      title={`operação declarada pelo chamado: ${kind}`}
    >
      {changeKindLabel(kind)}
    </Badge>
  );
}

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

/**
 * A régua de ordenação que o cabeçalho oferece — e a que vale quando ninguém
 * clicou em nada.
 *
 * Sem clique, a ordem é a que o servidor devolveu: materialidade, primeiro o
 * que tem impacto apurado e depois pelo tamanho da variação. Cada coluna
 * oferece a sua régua, e o terceiro clique na mesma coluna devolve a de casa —
 * porque uma lista ordenada por data já não responde "o que é grande", e
 * voltar não pode custar recarregar a tela.
 */
type SortKey = "chamado" | "tipo" | "impacto" | "situacao" | "data";
type SortDir = "asc" | "desc";
type SortState = { key: SortKey; dir: SortDir } | null;

/** O primeiro clique de cada coluna abre pelo lado que interessa. */
const PRIMEIRO_SENTIDO: Record<SortKey, SortDir> = {
  chamado: "asc",
  tipo: "asc",
  // Ascendente em número negativo é o maior prejuízo primeiro, que é o que se
  // procura numa auditoria — não o maior valor absoluto.
  impacto: "asc",
  situacao: "asc",
  data: "desc",
};

/** A ordem do ciclo de vida, para a coluna Situação não ordenar por alfabeto. */
const ORDEM_SITUACAO = [
  "ABERTO",
  "EM_ANDAMENTO",
  "ATENDIDO",
  "RECUSADO",
  "CANCELADO",
  "DESCONHECIDO",
];

function chaveDeOrdenacao(
  row: TicketChangeRow,
  key: SortKey,
): string | number | null {
  switch (key) {
    case "chamado":
      // O ` ` mantém a segunda régua dentro da primeira: o mesmo chamado
      // aparece com os seus parâmetros em ordem, e não espalhado.
      return `${row.externalId} ${row.parameterLabel}`;
    case "tipo":
      return row.changeKind ? changeKindLabel(row.changeKind) : null;
    case "impacto":
      // "Não calculável" não é zero: fica fora da régua, nos dois sentidos.
      return row.impactConfidence === "CALCULATED" ? row.impactAmount : null;
    case "situacao": {
      const posicao = ORDEM_SITUACAO.indexOf(row.statusBucket);
      return posicao === -1 ? ORDEM_SITUACAO.length : posicao;
    }
    case "data": {
      const iso = row.closedAt ?? row.openedAt;
      if (!iso) return null;
      const tempo = new Date(iso).getTime();
      return Number.isNaN(tempo) ? null : tempo;
    }
  }
}

/**
 * A caixa de seleção veste o azul da própria tabela, e não o laranja de ação.
 *
 * Marcar uma linha não é executar nada — é apontar. O laranja do sistema é o
 * clique que faz acontecer, e usá-lo aqui deixaria a linha marcada dizendo duas
 * cores ao mesmo tempo: a da caixa e a do fundo que ela acende.
 */
const ESTILO_CAIXA =
  "border-input data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 data-[state=checked]:text-white";

function SortHeader({
  label,
  chave,
  sort,
  onSort,
  className,
}: {
  label: string;
  chave: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const ativa = sort?.key === chave;
  return (
    <th className={cn("px-4 py-3 font-medium", className)}>
      <button
        onClick={() => onSort(chave)}
        title={
          ativa
            ? "ordenar pelo outro sentido — o terceiro clique volta à ordem por materialidade"
            : `ordenar por ${label.toLowerCase()}`
        }
        className={cn(
          "inline-flex items-center gap-1.5 transition-colors hover:text-foreground",
          ativa ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {!ativa ? (
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />
        ) : sort.dir === "asc" ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
      </button>
    </th>
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
  const [sort, setSort] = useState<SortState>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

  const ordenadas = useMemo(() => {
    if (!sort) return rows;
    const sentido = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = chaveDeOrdenacao(a, sort.key);
      const vb = chaveDeOrdenacao(b, sort.key);
      // Sem valor não é o menor valor: essas linhas ficam no fim dos dois
      // sentidos, em vez de fingirem um zero que ninguém apurou.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return va.localeCompare(vb, "pt-BR") * sentido;
      }
      return ((va as number) - (vb as number)) * sentido;
    });
  }, [rows, sort]);

  const alternarOrdem = (chave: SortKey) =>
    setSort((atual) => {
      if (!atual || atual.key !== chave) {
        return { key: chave, dir: PRIMEIRO_SENTIDO[chave] };
      }
      if (atual.dir === PRIMEIRO_SENTIDO[chave]) {
        return { key: chave, dir: atual.dir === "asc" ? "desc" : "asc" };
      }
      return null;
    });

  const alternarLinha = (id: string) =>
    setSelecionadas((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });

  const todasSelecionadas =
    ordenadas.length > 0 && ordenadas.every((r) => selecionadas.has(r.id));

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Nenhuma alteração de chamado com esses filtros.
      </p>
    );
  }

  return (
    <div>
      {selecionadas.size > 0 && (
        <SelectionBar
          rows={ordenadas.filter((r) => selecionadas.has(r.id))}
          onClear={() => setSelecionadas(new Set())}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-sm">
              <th className="w-12 px-4 py-3">
                <Checkbox
                  className={ESTILO_CAIXA}
                  checked={todasSelecionadas}
                  onCheckedChange={(marcado) =>
                    setSelecionadas(
                      marcado === true
                        ? new Set(ordenadas.map((r) => r.id))
                        : new Set(),
                    )
                  }
                  aria-label="selecionar todas as linhas visíveis"
                />
              </th>
              <SortHeader
                label="Chamado / Parâmetro"
                chave="chamado"
                sort={sort}
                onSort={alternarOrdem}
                className="text-left"
              />
              <SortHeader
                label="Tipo"
                chave="tipo"
                sort={sort}
                onSort={alternarOrdem}
                className="text-left"
              />
              <SortHeader
                label="Impacto"
                chave="impacto"
                sort={sort}
                onSort={alternarOrdem}
                className="text-right"
              />
              <SortHeader
                label="Situação"
                chave="situacao"
                sort={sort}
                onSort={alternarOrdem}
                className="text-left"
              />
              <SortHeader
                label="Alterado em"
                chave="data"
                sort={sort}
                onSort={alternarOrdem}
                className="text-left"
              />
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((row) => (
              <Fragment key={row.id}>
                <tr
                  className={cn(
                    "border-b hover:bg-muted/40 cursor-pointer",
                    row.impactConfidence === "CALCULATED" &&
                      row.impactAmount !== null &&
                      row.impactAmount < 0 &&
                      "bg-red-50/50",
                    row.statusBucket === "RECUSADO" && "bg-amber-50/50",
                    selecionadas.has(row.id) && "bg-blue-50/70",
                  )}
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                >
                  <td
                    className="px-4 py-3 align-top"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      className={ESTILO_CAIXA}
                      checked={selecionadas.has(row.id)}
                      onCheckedChange={() => alternarLinha(row.id)}
                      aria-label={`selecionar ${row.externalId} · ${row.parameterLabel}`}
                    />
                  </td>

                  {/* Chamado e parâmetro na mesma coluna, e o "de → para"
                      logo abaixo: é a linha inteira da história num relance,
                      sem escolher entre saber de que chamado veio e saber o
                      que ele fez com o valor. */}
                  <td className="px-4 py-3">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">
                        {row.externalId}
                      </span>
                      <span className="font-medium">{row.parameterLabel}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                      <span className="font-mono">
                        {row.attributeCode ?? (
                          <span
                            className="italic"
                            title="o dicionário de atributos ainda não conhece este nome"
                          >
                            fora do dicionário
                          </span>
                        )}
                      </span>
                      {row.entityLabel && <span>· {row.entityLabel}</span>}
                      <span className="inline-flex items-center gap-1.5">
                        <ValueCell
                          numeric={row.valueBeforeNumeric}
                          raw={row.valueBeforeRaw}
                          inferido={row.beforeSource === "VIGENCIA"}
                          referencia={row.beforeReference}
                        />
                        <ArrowRight className="w-3 h-3 shrink-0" />
                        <ValueCell
                          numeric={row.valueAfterNumeric}
                          raw={row.valueAfterRaw}
                        />
                      </span>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <ChangeKindBadge kind={row.changeKind} />
                  </td>

                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <TicketImpactCell row={row} />
                    {row.deltaAbsolute !== null && (
                      <div className="text-xs text-muted-foreground font-mono tabular-nums mt-0.5">
                        {row.deltaAbsolute > 0 ? "+" : ""}
                        {decimal(row.deltaAbsolute)}
                        {row.deltaPercent !== null && (
                          <>
                            {" "}
                            ({row.deltaPercent > 0 ? "+" : ""}
                            {row.deltaPercent.toFixed(1)}%)
                          </>
                        )}
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-3">
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

                  {/* "Alterado em" é a data de fechamento, e não a de hoje nem
                      a de abertura: é quando o pedido virou alteração. Enquanto
                      o chamado corre, não existe essa data — e dizer "—" é mais
                      honesto do que carimbar a abertura no lugar dela. */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.closedAt ? (
                      <div className="tabular-nums">{shortDate(row.closedAt)}</div>
                    ) : (
                      <div className="text-muted-foreground italic">
                        ainda em aberto
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground tabular-nums mt-0.5">
                      aberto em {shortDate(row.openedAt)}
                    </div>
                  </td>

                  <td className="px-2 text-muted-foreground">
                    {expanded === row.id ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </td>
                </tr>
                {expanded === row.id && (
                  <tr className="border-b bg-muted/30">
                    <td />
                    <td colSpan={6} className="px-4 py-4">
                      <TicketDetail row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

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
 * O que a seleção vale.
 *
 * A caixa de seleção existe para responder "quanto custa este conjunto de
 * linhas" sem exportar nada: marcam-se as que interessam e a soma aparece. E
 * aparece com a mesma ressalva de todos os outros números desta tela — quantas
 * das marcadas ficaram de fora dela, porque não têm impacto apurado. Uma soma
 * de 12 linhas que na verdade somou 3 é o começo de toda conta que ninguém
 * consegue sustentar depois.
 */
function SelectionBar({
  rows,
  onClear,
}: {
  rows: TicketChangeRow[];
  onClear: () => void;
}) {
  const apuradas = rows.filter(
    (r) => r.impactConfidence === "CALCULATED" && r.impactAmount !== null,
  );
  const soma = apuradas.reduce((total, r) => total + (r.impactAmount ?? 0), 0);
  const fora = rows.length - apuradas.length;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-blue-50 px-4 py-2.5 text-sm">
      <span className="font-medium">
        {rows.length} linha{rows.length === 1 ? "" : "s"} selecionada
        {rows.length === 1 ? "" : "s"}
      </span>
      {apuradas.length > 0 ? (
        <span className="text-muted-foreground">
          impacto apurado{" "}
          <span
            className={cn(
              "font-mono tabular-nums font-medium",
              soma < 0 ? "text-red-700" : soma > 0 ? "text-emerald-700" : "text-foreground",
            )}
          >
            {soma > 0 ? "+" : ""}
            {brl(soma)}
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">
          nenhuma delas tem impacto apurado
        </span>
      )}
      {fora > 0 && apuradas.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {fora} fora desta soma, por não ter impacto apurado
        </span>
      )}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        limpar seleção
      </Button>
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

const capitalizar = (texto: string) =>
  texto.charAt(0).toUpperCase() + texto.slice(1);

/**
 * A fileira da frente: o tipo da alteração, se ela tem preço, e a busca.
 *
 * São os três cortes que quem abre esta aba faz antes de qualquer outro — e a
 * ordem dos chips é a do assunto, não a da contagem: num export real `fórmula`
 * é 85% das linhas, e deixá-la em primeiro por ser a maior empurraria para o
 * fim justamente `valor`, que é onde estão os números.
 *
 * O resto dos filtros — situação, procedência do "antes", variação mínima —
 * continua existindo inteiro atrás do botão Filtros. Não sumiu: saiu da frente,
 * porque cinco grupos de chips abertos de uma vez são uma tela que se lê antes
 * de se usar.
 */
const ORDEM_OPERACAO = ["FORM_THIS", "SET", "ADD", "REMOVE"];

export function TicketQuickFilters({
  filters,
  onChange,
  totals,
  avancadoAberto,
  onToggleAvancado,
}: {
  filters: TicketFilters;
  onChange: (f: TicketFilters) => void;
  totals?: TicketTotals;
  avancadoAberto: boolean;
  onToggleAvancado: () => void;
}) {
  const operacoes = ORDEM_OPERACAO.filter((kind) =>
    totals?.byChangeKind.some((k) => k.changeKind === kind),
  );

  const semCorte = !filters.changeKind && !filters.impactConfidence;

  /** Quantos filtros vivem atrás do botão — para ele dizer que estão ligados. */
  const avancadosAtivos = [
    filters.statusBucket,
    filters.beforeSource,
    filters.parameterLabel,
    filters.subjectMissing ? "sem assunto" : filters.subject,
    filters.minAbsImpact,
    filters.onlyDivergent ? "sim" : "",
  ].filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <QuickChip
        active={semCorte}
        onClick={() =>
          onChange({ ...filters, changeKind: "", impactConfidence: "" })
        }
      >
        Todos
      </QuickChip>

      {operacoes.map((kind) => (
        <QuickChip
          key={kind}
          active={filters.changeKind === kind}
          onClick={() =>
            onChange({
              ...filters,
              changeKind: filters.changeKind === kind ? "" : kind,
            })
          }
        >
          {capitalizar(changeKindLabel(kind))}
        </QuickChip>
      ))}

      <QuickChip
        active={filters.impactConfidence === "CALCULATED"}
        onClick={() =>
          onChange({
            ...filters,
            impactConfidence:
              filters.impactConfidence === "CALCULATED" ? "" : "CALCULATED",
          })
        }
      >
        Com impacto
      </QuickChip>
      <QuickChip
        active={filters.impactConfidence === "NOT_CALCULABLE"}
        onClick={() =>
          onChange({
            ...filters,
            impactConfidence:
              filters.impactConfidence === "NOT_CALCULABLE"
                ? ""
                : "NOT_CALCULABLE",
          })
        }
      >
        Sem impacto
      </QuickChip>

      <div className="flex items-center gap-2 ml-auto">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            placeholder="Buscar chamado ou parâmetro"
            title="a busca também encontra pela placa do equipamento"
            className="h-11 pl-9 rounded-xl bg-background"
          />
        </div>
        <Button
          variant="outline"
          onClick={onToggleAvancado}
          aria-expanded={avancadoAberto}
          className={cn(
            "h-11 rounded-xl gap-2",
            (avancadoAberto || avancadosAtivos > 0) && "border-blue-600 text-blue-700",
          )}
        >
          Filtros
          {avancadosAtivos > 0 && (
            <span className="rounded-full bg-blue-600 px-1.5 text-xs tabular-nums text-white">
              {avancadosAtivos}
            </span>
          )}
          <SlidersHorizontal className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function QuickChip({
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
      aria-pressed={active}
      className={cn(
        "h-11 rounded-full border px-5 text-sm font-medium transition-colors",
        active
          ? "bg-blue-600 border-blue-600 text-white shadow-sm"
          : "bg-background border-input text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
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
    Boolean(filters.changeKind) ||
    Boolean(filters.parameterLabel) ||
    Boolean(filters.subject) ||
    filters.subjectMissing ||
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
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
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
        </FilterGroup>

        <div className="flex items-center gap-2 ml-auto">
          <Input
            placeholder="Variação mínima"
            value={filters.minAbsImpact}
            onChange={(e) => onChange({ ...filters, minAbsImpact: e.target.value })}
            className="h-9 w-40"
            inputMode="numeric"
          />
          {active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(emptyTicketFilters)}
            >
              limpar tudo
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

      {/* O corte que a visão por tipo deixa para trás quando alguém volta ao
          Resumo por uma folha da árvore. Sem esta linha, a lista viria recortada
          por um filtro que não aparece em chip nenhum. */}
      {(filters.subject || filters.subjectMissing) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          filtrando pelo assunto
          <span className="font-medium text-foreground">
            {filters.subjectMissing ? "chamados sem assunto" : filters.subject}
          </span>
          <button
            className="underline"
            onClick={() =>
              onChange({ ...filters, subject: "", subjectMissing: false })
            }
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
