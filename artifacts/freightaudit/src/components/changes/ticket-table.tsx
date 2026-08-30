import { Fragment, useEffect, useRef, useState } from "react";
import { impactEntries } from "@/lib/format";
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
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Paginacao } from "@/components/ui/paginacao";
import { getApiUrl } from "@/lib/api";
import {
  TAMANHOS_DE_PAGINA,
  aplicarJanela,
  primeiraPagina,
  type Janela,
} from "@/lib/paginacao";
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

/*
  O tipo da linha é o do servidor — inclusive a `regua`, que é o que autoriza
  a soma de seleção a tratar `impactAmount` como dinheiro.
*/
export type { TicketChangeRow } from "@workspace/comparison";
import type { TicketChangeRow } from "@workspace/comparison";

/*
  O tipo é o do servidor, não uma cópia — a cópia que morava aqui carregou um
  `impactSum` escalar que somava mensal com anual. `import type` é apagado na
  compilação (nada do servidor entra no bundle), e o typecheck acusa o drift.
*/
export type { TicketTotals } from "@workspace/comparison";
import type { TicketTotals } from "@workspace/comparison";

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

/**
 * O número que alguém digitou, à brasileira ou à americana.
 *
 * A rota faz `Number(valor)` e descarta o que der `NaN` — sem dizer nada. Quem
 * escreve `1,5`, que é como se escreve um decimal em português, via o filtro
 * simplesmente não acontecer: a lista continuava inteira e nenhum aviso
 * explicava por quê. A conversão é feita aqui, de um lado só: com vírgula, o
 * ponto é separador de milhar; sem vírgula, o ponto é o decimal.
 */
export function numeroDigitado(texto: string): number | null {
  const bruto = texto.trim().replace(/\s/g, "");
  if (bruto === "") return null;
  const normalizado = bruto.includes(",")
    ? bruto.replace(/\./g, "").replace(",", ".")
    : bruto;
  const valor = Number(normalizado);
  // O corte é por tamanho da variação, e não por sinal: um parâmetro que caiu
  // 300 é tão material quanto um que subiu 300.
  return Number.isFinite(valor) ? Math.abs(valor) : null;
}

/**
 * O corte de materialidade que está de fato ligado.
 *
 * `0` não é um corte — deixa tudo passar —, e texto que não é número também
 * não. Nos dois casos o filtro não vai ao servidor e não se anuncia como
 * ativo, para o painel não afirmar um recorte que ninguém aplicou.
 */
export function variacaoMinima(filters: TicketFilters): number | null {
  const valor = numeroDigitado(filters.minAbsImpact);
  return valor !== null && valor > 0 ? valor : null;
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
 *
 * A ordenação viaja com a página para o servidor, e não é feita aqui, porque a
 * lista agora vem paginada: ordenar em JavaScript o que chegou reordenaria cem
 * linhas de mil e duzentas, e o cabeçalho "Impacto ↓" passaria a significar
 * "o maior desta página" — uma frase parecida com a verdadeira o bastante para
 * ninguém desconfiar dela. Era o preço escondido de paginar a lista sem mexer
 * na ordenação: quanto menor a página, mais estreita a verdade do cabeçalho.
 */
export type OrdemChamados = { key: SortKey; dir: SortDir } | null;

export function toTicketQuery(
  filters: TicketFilters,
  extra: Record<string, string> = {},
  janela: Janela = primeiraPagina,
  ordem: OrdemChamados = null,
) {
  const params = new URLSearchParams();
  const busca = filters.search.trim();
  const minimo = variacaoMinima(filters);
  if (filters.statusBucket) params.set("statusBucket", filters.statusBucket);
  if (filters.impactConfidence)
    params.set("impactConfidence", filters.impactConfidence);
  if (filters.beforeSource) params.set("beforeSource", filters.beforeSource);
  if (filters.changeKind) params.set("changeKind", filters.changeKind);
  if (filters.parameterLabel) params.set("parameterLabel", filters.parameterLabel);
  if (filters.subjectMissing) params.set("subjectMissing", "true");
  else if (filters.subject) params.set("subject", filters.subject);
  if (busca) params.set("search", busca);
  if (minimo !== null) params.set("minAbsImpact", String(minimo));
  if (filters.onlyDivergent) params.set("onlyDivergent", "true");
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  if (ordem) {
    params.set("sort", ordem.key);
    params.set("dir", ordem.dir);
  }
  aplicarJanela(params, janela);
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
        "font-normal text-2xs px-1.5 py-0",
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
export type SortKey = "chamado" | "tipo" | "impacto" | "situacao" | "data";
export type SortDir = "asc" | "desc";

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

/**
 * A ordem do ciclo de vida, e não a do alfabeto nem a da contagem.
 *
 * É a régua dos chips de Situação: quem lê procura "os recusados", nunca "o
 * terceiro maior grupo". A da coluna mora no servidor desde que a ordenação
 * passou a viajar com a página.
 */
const ORDEM_SITUACAO = [
  "ABERTO",
  "EM_ANDAMENTO",
  "ATENDIDO",
  "RECUSADO",
  "CANCELADO",
  "DESCONHECIDO",
];

/**
 * O próximo estado do cabeçalho: sentido de estreia, inverso, e de volta.
 *
 * A régua em si — que ordem tem "situação", onde cai o que não tem impacto
 * apurado — mora no servidor, junto do `ORDER BY` que a aplica. Aqui fica só o
 * ciclo do clique, que é o que a tabela de fato decide.
 */
export function proximaOrdem(
  atual: OrdemChamados,
  chave: SortKey,
): OrdemChamados {
  if (!atual || atual.key !== chave) {
    return { key: chave, dir: PRIMEIRO_SENTIDO[chave] };
  }
  if (atual.dir === PRIMEIRO_SENTIDO[chave]) {
    return { key: chave, dir: atual.dir === "asc" ? "desc" : "asc" };
  }
  return null;
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
  sort: OrdemChamados;
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
  janela,
  onJanela,
  ordem = null,
  onOrdem,
}: {
  rows: TicketChangeRow[];
  total: number;
  /** Sem estes dois a tabela é a página única de antes. */
  janela?: Janela;
  onJanela?: (janela: Janela) => void;
  /** A ordem pedida ao servidor. Sem `onOrdem`, o cabeçalho não ordena. */
  ordem?: OrdemChamados;
  onOrdem?: (ordem: OrdemChamados) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  /*
    A seleção guarda a linha inteira, e não só o id, porque ela atravessa a
    paginação: quem marca três linhas na página 1 e duas na página 4 quer a
    soma das cinco. Guardando só o id, as três primeiras sairiam da conta ao
    virar a página — e sairiam caladas, que é o pior jeito de uma soma
    encolher.
  */
  const [selecionadas, setSelecionadas] = useState<Map<string, TicketChangeRow>>(
    new Map(),
  );

  const alternarOrdem = (chave: SortKey) =>
    onOrdem?.(proximaOrdem(ordem, chave));

  const alternarLinha = (row: TicketChangeRow) =>
    setSelecionadas((atual) => {
      const proxima = new Map(atual);
      if (proxima.has(row.id)) proxima.delete(row.id);
      else proxima.set(row.id, row);
      return proxima;
    });

  const marcarPagina = (marcado: boolean) =>
    setSelecionadas((atual) => {
      const proxima = new Map(atual);
      // Desmarcar o cabeçalho limpa esta página, e não a seleção inteira: as
      // linhas marcadas em outras páginas não estão à vista para serem
      // desmarcadas por engano.
      for (const row of rows) {
        if (marcado) proxima.set(row.id, row);
        else proxima.delete(row.id);
      }
      return proxima;
    });

  const todasSelecionadas =
    rows.length > 0 && rows.every((r) => selecionadas.has(r.id));

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
          rows={[...selecionadas.values()]}
          nestaPagina={rows.filter((r) => selecionadas.has(r.id)).length}
          onClear={() => setSelecionadas(new Map())}
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
                  onCheckedChange={(marcado) => marcarPagina(marcado === true)}
                  aria-label="selecionar todas as linhas visíveis"
                />
              </th>
              <SortHeader
                label="Chamado / Parâmetro"
                chave="chamado"
                sort={ordem}
                onSort={alternarOrdem}
                className="text-left"
              />
              <SortHeader
                label="Tipo"
                chave="tipo"
                sort={ordem}
                onSort={alternarOrdem}
                className="text-left"
              />
              <SortHeader
                label="Impacto"
                chave="impacto"
                sort={ordem}
                onSort={alternarOrdem}
                className="text-right"
              />
              <SortHeader
                label="Situação"
                chave="situacao"
                sort={ordem}
                onSort={alternarOrdem}
                className="text-left"
              />
              <SortHeader
                label="Alterado em"
                chave="data"
                sort={ordem}
                onSort={alternarOrdem}
                className="text-left"
              />
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
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
                      onCheckedChange={() => alternarLinha(row)}
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

      {janela && onJanela ? (
        <Paginacao
          total={total}
          pagina={janela.pagina}
          porPagina={janela.porPagina}
          onPagina={(pagina) => onJanela({ ...janela, pagina })}
          onPorPagina={(porPagina) => onJanela({ porPagina, pagina: 1 })}
          tamanhos={TAMANHOS_DE_PAGINA}
          unidade="alterações"
        />
      ) : (
        total > rows.length && (
          <p className="px-4 py-3 text-xs text-muted-foreground border-t">
            Mostrando {rows.length} de {total}. Use os filtros para chegar ao
            restante — nada foi descartado.
          </p>
        )
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
  nestaPagina,
  onClear,
}: {
  /** Todas as linhas marcadas, inclusive as de outras páginas. */
  rows: TicketChangeRow[];
  nestaPagina: number;
  onClear: () => void;
}) {
  /*
    A soma da seleção atravessa parâmetros, então obedece à mesma régua de
    todos os totais do produto: só entra linha apurada CUJO parâmetro é
    monetário e confirmado, e cada periodicidade tem o seu balde — somar
    mensal com anual num escalar era exatamente o número que ninguém
    conseguiria sustentar depois.
  */
  const apuradas = rows.filter(
    (r) =>
      r.impactConfidence === "CALCULATED" &&
      r.impactAmount !== null &&
      r.regua?.somavel === true,
  );
  const porPeriodicidade: Record<string, number> = {};
  for (const r of apuradas) {
    const balde = r.regua?.periodicidade ?? "SEM_PERIODICIDADE";
    porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + (r.impactAmount ?? 0);
  }
  const somas = impactEntries(porPeriodicidade).sort(
    (a, b) => Math.abs(b.amount) - Math.abs(a.amount),
  );
  const negativo = (somas[0]?.amount ?? 0) < 0;
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
              negativo ? "text-red-700" : "text-emerald-700",
            )}
          >
            {somas.map((e) => e.label).join(" · ")}
          </span>
        </span>
      ) : (
        <span className="text-muted-foreground">
          nenhuma delas entra na régua financeira
        </span>
      )}
      {fora > 0 && apuradas.length > 0 && (
        <span className="text-xs text-muted-foreground">
          {fora} fora desta soma — sem apuração ou fora da régua financeira
        </span>
      )}
      {/* A seleção atravessa a paginação, então a barra diz quantas das
          marcadas não estão à vista. Sem essa linha, a soma seria maior do que
          tudo o que a tela mostra, e quem lê procuraria o erro na conta. */}
      {rows.length > nestaPagina && (
        <span className="text-xs text-muted-foreground">
          {rows.length - nestaPagina} fora desta página
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

/* ------------------------------------------------------------------ *
 * O filtro da aba Chamados
 * ------------------------------------------------------------------ */

/**
 * O que o chamado fez com o parâmetro, na ordem do assunto.
 *
 * Não é a ordem da contagem: num export real `fórmula` é 85% das linhas, e
 * pô-la em primeiro por ser a maior empurraria para o fim justamente `valor`,
 * que é onde estão os números.
 */
const ORDEM_OPERACAO = ["FORM_THIS", "SET", "ADD", "REMOVE"];

/** De onde veio o valor anterior — do mais provado para o menos. */
const ORDEM_PROCEDENCIA = ["ARQUIVO", "VIGENCIA", "AUSENTE"];

const IMPACTO_LABELS: Record<string, string> = {
  CALCULATED: "com impacto",
  NOT_CALCULABLE: "sem impacto",
};

/**
 * Um recorte ligado, em palavras — o suficiente para ser lido e desfeito.
 *
 * `avancado` separa os que vivem atrás do botão Filtros dos que se leem na
 * própria fileira da frente. Só os primeiros precisam ser repetidos quando o
 * painel está fechado; repetir os outros seria dizer duas vezes a mesma coisa.
 */
export interface FiltroAtivo {
  id: string;
  grupo: string;
  valor: string;
  avancado: boolean;
  /** O que zerar para tirar só este, sem levar os outros junto. */
  patch: Partial<TicketFilters>;
}

export function filtrosAtivos(filters: TicketFilters): FiltroAtivo[] {
  const lista: FiltroAtivo[] = [];

  if (filters.changeKind) {
    lista.push({
      id: "changeKind",
      grupo: "tipo",
      valor: changeKindLabel(filters.changeKind),
      avancado: false,
      patch: { changeKind: "" },
    });
  }
  if (filters.impactConfidence) {
    lista.push({
      id: "impactConfidence",
      grupo: "impacto",
      valor:
        IMPACTO_LABELS[filters.impactConfidence] ?? filters.impactConfidence,
      avancado: false,
      patch: { impactConfidence: "" },
    });
  }
  if (filters.search.trim()) {
    lista.push({
      id: "search",
      grupo: "busca",
      valor: `“${filters.search.trim()}”`,
      avancado: false,
      patch: { search: "" },
    });
  }
  if (filters.statusBucket) {
    lista.push({
      id: "statusBucket",
      grupo: "situação",
      valor: STATUS_LABELS[filters.statusBucket] ?? filters.statusBucket,
      avancado: true,
      patch: { statusBucket: "" },
    });
  }
  if (filters.beforeSource) {
    lista.push({
      id: "beforeSource",
      grupo: "valor anterior",
      valor: BEFORE_SOURCE_LABELS[filters.beforeSource] ?? filters.beforeSource,
      avancado: true,
      patch: { beforeSource: "" },
    });
  }
  if (filters.onlyDivergent) {
    lista.push({
      id: "onlyDivergent",
      grupo: "atendimento",
      valor: "só o que variou",
      avancado: true,
      patch: { onlyDivergent: false },
    });
  }
  const minimo = variacaoMinima(filters);
  if (minimo !== null) {
    lista.push({
      id: "minAbsImpact",
      grupo: "variação de pelo menos",
      valor: decimal(minimo),
      avancado: true,
      patch: { minAbsImpact: "" },
    });
  }
  if (filters.parameterLabel) {
    lista.push({
      id: "parameterLabel",
      grupo: "parâmetro",
      valor: filters.parameterLabel,
      avancado: true,
      patch: { parameterLabel: "" },
    });
  }
  // O assunto vem da visão por tipos, e não de nenhum chip desta barra — o que
  // faz dele o recorte mais fácil de esquecer que está ligado.
  if (filters.subjectMissing || filters.subject) {
    lista.push({
      id: "subject",
      grupo: "assunto",
      valor: filters.subjectMissing ? "chamados sem assunto" : filters.subject,
      avancado: true,
      patch: { subject: "", subjectMissing: false },
    });
  }

  return lista;
}

/**
 * Um campo de texto que só vira filtro quando quem digita faz uma pausa.
 *
 * `filters` é a chave da consulta, então cada tecla era uma ida ao servidor:
 * escrever "bomba" pedia a lista cinco vezes e mostrava quatro resultados que
 * ninguém pediu. O rascunho fica aqui e só sobe depois da pausa.
 *
 * O `useEffect` de cima é o caminho de volta: quando o filtro muda por fora —
 * um chip removido, "limpar tudo" — o campo acompanha em vez de continuar
 * exibindo o que já não está valendo.
 */
function useCampoAdiado(
  valorExterno: string,
  aplicar: (valor: string) => void,
  atraso = 300,
) {
  const [rascunho, setRascunho] = useState(valorExterno);
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;

  useEffect(() => {
    setRascunho(valorExterno);
  }, [valorExterno]);

  useEffect(() => {
    if (rascunho === valorExterno) return;
    const id = setTimeout(() => aplicarRef.current(rascunho), atraso);
    return () => clearTimeout(id);
  }, [rascunho, valorExterno, atraso]);

  /**
   * Manda agora o que estiver escrito, sem esperar a pausa.
   *
   * É o que o `onBlur` chama. Sem isto, digitar um número e fechar o painel no
   * mesmo movimento perdia o número: o campo desmonta, o `clearTimeout` da
   * limpeza cancela o envio, e nada na tela diz que o corte não foi aplicado.
   */
  const aplicarAgora = () => {
    if (rascunho !== valorExterno) aplicarRef.current(rascunho);
  };

  return [rascunho, setRascunho, aplicarAgora] as const;
}

/**
 * Os filtros da aba, em três faixas.
 *
 * **A da frente** tem os dois cortes que se fazem antes de qualquer outro, e
 * tem-nos separados: o *tipo* da alteração e se ela tem *impacto* apurado são
 * duas perguntas independentes que se combinam — `fórmula` **e** `com
 * impacto` é um recorte legítimo. Desenhados como uma fileira só de pastilhas
 * iguais, como estavam, liam-se como abas mutuamente exclusivas, e quem lia
 * concluía que escolher uma desfazia a outra.
 *
 * **A do meio** só aparece quando há recorte escondido: repete em palavras o
 * que o painel fechado está filtrando, com um × em cada. Sem ela, fechar o
 * botão Filtros escondia a razão de a lista estar curta atrás de um número.
 *
 * **A de baixo** é o painel inteiro — situação, procedência do "antes",
 * atendimento e materialidade —, que continua fechado por padrão porque cinco
 * grupos de chips abertos de uma vez são uma tela que se lê antes de se usar.
 */
export function TicketFilterPanel({
  filters,
  onChange,
  totals,
}: {
  filters: TicketFilters;
  onChange: (f: TicketFilters) => void;
  totals?: TicketTotals;
}) {
  const [avancadoAberto, setAvancadoAberto] = useState(false);

  const ativos = filtrosAtivos(filters);
  const avancados = ativos.filter((f) => f.avancado);

  const operacoes = ORDEM_OPERACAO.filter((kind) =>
    totals?.byChangeKind.some((k) => k.changeKind === kind),
  );

  const contarOperacao = (kind: string) =>
    totals?.byChangeKind.find((k) => k.changeKind === kind)?.count;

  return (
    /*
      `@container`: quem manda na fileira é a largura deste painel, não a da
      janela. Ele mora dentro de um cartão que já perdeu para as margens da
      página, e a mesma janela dá aqui larguras diferentes conforme a tela em
      que a aba está montada.
    */
    <div className="@container space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/*
          As pastilhas num bloco só, e não soltas ao lado da busca.

          Soltas, cada grupo disputava a linha por conta própria, e o que
          quebrava era o que sobrasse no fim. Juntas, a quebra tem um lugar
          certo — entre as pastilhas e a busca —, que é a única costura desta
          faixa onde separar não separa nada: são as duas perguntas de um lado
          e as duas ferramentas do outro.
        */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <GrupoRapido label="Tipo">
            <QuickChip
              active={!filters.changeKind}
              onClick={() => onChange({ ...filters, changeKind: "" })}
            >
              Todos
              <Contagem n={totals?.changes} />
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
                <Contagem n={contarOperacao(kind)} />
              </QuickChip>
            ))}
          </GrupoRapido>

          {/* A divisória é o que diz que daqui para a frente é outra pergunta. */}
          <span className="hidden h-7 w-px bg-border sm:block" aria-hidden />

          <GrupoRapido label="Impacto">
            <QuickChip
              active={filters.impactConfidence === "CALCULATED"}
              onClick={() =>
                onChange({
                  ...filters,
                  impactConfidence:
                    filters.impactConfidence === "CALCULATED"
                      ? ""
                      : "CALCULATED",
                })
              }
            >
              Com impacto
              <Contagem n={totals?.calculated} />
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
              <Contagem n={totals?.notCalculable} />
            </QuickChip>
          </GrupoRapido>
        </div>

        {/*
          A busca e os botões andam grudados, e quem desce de linha é o bloco
          inteiro.

          O defeito que isto conserta: o bloco declarava um mínimo à mão
          (`18rem`) menor do que a soma do que ele carrega, e tinha
          `flex-wrap` por dentro. Numa janela intermediária ele cabia na
          fileira das pastilhas por esse mínimo declarado — e então quebrava
          por dentro: a busca ficava lá em cima e o Filtros descia sozinho,
          encavalado debaixo dela, com a fileira das pastilhas inteira vazia
          ao lado.

          Sem `flex-wrap` e sem mínimo à mão, o mínimo do bloco passa a ser o
          `min-content` que o navegador calcula — a busca no seu piso mais os
          botões, quaisquer que sejam os textos deles —, e o flex decide a
          linha com esse número: cabe ao lado das pastilhas, ou desce inteiro
          para uma linha só sua, onde estica. Nunca no meio.

          Abaixo de `@lg` — telefone, ou este cartão numa coluna estreita —
          esse mínimo não cabe em linha nenhuma, e aí quebrar por dentro volta
          a ser a resposta certa: busca em cima, botões embaixo.
        */}
        <div className="flex w-full flex-wrap items-center gap-2 @lg:w-auto @lg:flex-1 @lg:flex-nowrap">
          <CampoDeBusca
            valor={filters.search}
            onChange={(search) => onChange({ ...filters, search })}
          />
          <Button
            variant="outline"
            onClick={() => setAvancadoAberto((v) => !v)}
            aria-expanded={avancadoAberto}
            className={cn(
              "h-11 shrink-0 rounded-xl gap-2",
              (avancadoAberto || avancados.length > 0) &&
                "border-blue-600 text-blue-700",
            )}
          >
            Filtros
            {avancados.length > 0 && (
              <span className="rounded-full bg-blue-600 px-1.5 text-xs tabular-nums text-white">
                {avancados.length}
              </span>
            )}
            <SlidersHorizontal className="w-4 h-4" />
          </Button>
          {ativos.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => onChange(emptyTicketFilters)}
              className="h-11 shrink-0 rounded-xl text-muted-foreground"
            >
              limpar tudo
            </Button>
          )}
        </div>
      </div>

      {!avancadoAberto && avancados.length > 0 && (
        <ResumoDeFiltros
          itens={avancados}
          onRemover={(item) => onChange({ ...filters, ...item.patch })}
        />
      )}

      {avancadoAberto && (
        <PainelAvancado filters={filters} onChange={onChange} totals={totals} />
      )}
    </div>
  );
}

/** A busca, com o × que a desfaz sem ter de apagar letra a letra. */
function CampoDeBusca({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (valor: string) => void;
}) {
  const [rascunho, setRascunho, aplicarAgora] = useCampoAdiado(valor, onChange);

  const limpar = () => {
    // Os dois juntos de propósito: o × é uma decisão pronta, e esperar a pausa
    // do `useCampoAdiado` para uma decisão pronta é só atraso.
    setRascunho("");
    onChange("");
  };

  return (
    <div className="relative min-w-[14rem] flex-1">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
      <Input
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={aplicarAgora}
        placeholder="Buscar chamado ou parâmetro"
        aria-label="buscar chamado ou parâmetro"
        title="encontra também pela placa do equipamento, pelo código do atributo, pelo solicitante e pelo assunto do chamado"
        className="h-11 pl-9 pr-9 rounded-xl bg-background"
      />
      {rascunho !== "" && (
        <button
          type="button"
          onClick={limpar}
          // Sem o `preventDefault` o campo perde o foco antes do clique, o
          // `onBlur` manda a busca que o × veio justamente desfazer, e a lista
          // é pedida duas vezes para acabar no mesmo lugar.
          onMouseDown={(e) => e.preventDefault()}
          aria-label="limpar a busca"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/** O que o painel fechado está filtrando, em palavras e com um × em cada. */
function ResumoDeFiltros({
  itens,
  onRemover,
}: {
  itens: FiltroAtivo[];
  onRemover: (item: FiltroAtivo) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Filtrando também por</span>
      {itens.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onRemover(item)}
          aria-label={`remover o filtro ${item.grupo} ${item.valor}`}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 py-1 pl-2.5 pr-1.5 text-blue-900 transition-colors hover:bg-blue-100"
        >
          <span className="text-blue-700/70">{item.grupo}</span>
          <span className="truncate font-medium">{item.valor}</span>
          <X className="w-3 h-3 shrink-0" />
        </button>
      ))}
    </div>
  );
}

/** Os filtros que não cabem na fileira da frente sem a encher. */
function PainelAvancado({
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

  // Só as situações que este envio tem. Enquanto os totais não chegam, a régua
  // inteira — nunca um pedaço arbitrário dela.
  const situacoes = totals
    ? ORDEM_SITUACAO.filter((bucket) =>
        totals.byStatus.some((s) => s.statusBucket === bucket),
      )
    : ORDEM_SITUACAO;

  return (
    <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <FilterGroup label="Situação">
          {situacoes.map((bucket) => (
            <Chip
              key={bucket}
              active={filters.statusBucket === bucket}
              onClick={() => set("statusBucket", bucket)}
            >
              {STATUS_LABELS[bucket]}
              <Contagem
                n={totals?.byStatus.find((s) => s.statusBucket === bucket)?.count}
              />
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Valor anterior">
          {ORDEM_PROCEDENCIA.map((source) => (
            <Chip
              key={source}
              active={filters.beforeSource === source}
              onClick={() => set("beforeSource", source)}
            >
              {BEFORE_SOURCE_LABELS[source]}
              <Contagem
                n={
                  totals?.byBeforeSource.find((s) => s.beforeSource === source)
                    ?.count
                }
              />
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Atendimento">
          <Chip
            active={filters.onlyDivergent}
            onClick={() =>
              onChange({ ...filters, onlyDivergent: !filters.onlyDivergent })
            }
          >
            só o que variou
            <Contagem n={totals?.divergent} />
          </Chip>
        </FilterGroup>
      </div>

      <CampoDeVariacao filters={filters} onChange={onChange} />

      {filters.parameterLabel && (
        <FilterGroup label="Parâmetro">
          <Chip
            active
            onClick={() => onChange({ ...filters, parameterLabel: "" })}
          >
            {filters.parameterLabel}
            <X className="ml-1 inline w-3 h-3 align-[-1px]" />
          </Chip>
        </FilterGroup>
      )}

      {/* O corte que a visão por tipo deixa para trás quando alguém volta ao
          Resumo por uma folha da árvore. Sem ele aqui, a lista viria recortada
          por um filtro que não aparece em chip nenhum — e com o painel fechado
          é a fileira do resumo, logo acima, que o diz. */}
      {(filters.subject || filters.subjectMissing) && (
        <FilterGroup label="Assunto">
          <Chip
            active
            onClick={() =>
              onChange({ ...filters, subject: "", subjectMissing: false })
            }
          >
            {filters.subjectMissing ? "chamados sem assunto" : filters.subject}
            <X className="ml-1 inline w-3 h-3 align-[-1px]" />
          </Chip>
        </FilterGroup>
      )}
    </div>
  );
}

/**
 * O corte de materialidade.
 *
 * O rótulo diz "variação" e não "impacto" porque é o que o servidor compara:
 * a diferença entre o antes e o agora **do próprio parâmetro**, na unidade
 * dele. Um campo sem rótulo, encostado à direita de um grupo de chips com que
 * nada tinha a ver, deixava quem lê supor reais — e um filtro que se supõe em
 * reais e corta em coeficientes esconde linhas sem avisar.
 */
function CampoDeVariacao({
  filters,
  onChange,
}: {
  filters: TicketFilters;
  onChange: (f: TicketFilters) => void;
}) {
  const [rascunho, setRascunho, aplicarAgora] = useCampoAdiado(
    filters.minAbsImpact,
    (minAbsImpact) => onChange({ ...filters, minAbsImpact }),
  );

  const digitado = rascunho.trim() !== "";
  const naoEhNumero = digitado && numeroDigitado(rascunho) === null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <label
        htmlFor="variacao-minima"
        className="text-xs uppercase tracking-wide text-muted-foreground mr-1"
      >
        Variação mínima
      </label>
      <Input
        id="variacao-minima"
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value)}
        onBlur={aplicarAgora}
        placeholder="0"
        inputMode="decimal"
        aria-describedby="variacao-minima-ajuda"
        aria-invalid={naoEhNumero}
        className={cn(
          "h-9 w-28 tabular-nums",
          naoEhNumero && "border-amber-500 focus-visible:ring-amber-500",
        )}
      />
      <p
        id="variacao-minima-ajuda"
        className={cn(
          "text-xs",
          naoEhNumero ? "text-amber-700" : "text-muted-foreground",
        )}
      >
        {naoEhNumero
          ? `“${rascunho.trim()}” não é um número — nada está sendo cortado.`
          : "esconde o que variou menos que isto, na unidade do próprio parâmetro — não em reais."}
      </p>
    </div>
  );
}

/**
 * Os dois grupos da fileira da frente, sem rótulo pintado.
 *
 * O rótulo existia para dizer que ali começa outra pergunta, e dizia — mas
 * custava a fileira: com ele e as contagens, a barra não cabia numa linha e a
 * busca descia sozinha para a de baixo. Quem separa é a divisória, e as
 * palavras dos próprios chips fazem o resto — "Custo fixo" e "Com impacto" não
 * se confundem. O `aria-label` fica, porque quem ouve a tela não vê divisória
 * nenhuma.
 */
function GrupoRapido({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-1.5"
    >
      {children}
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-1.5 flex-wrap"
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
        {label}
      </span>
      {children}
    </div>
  );
}

/** A pastilha grande da fileira da frente. */
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-11 items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
        active
          ? "bg-blue-600 border-blue-600 text-white shadow-sm"
          : "bg-background border-input text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/** A pastilha pequena do painel. */
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
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

/**
 * Quantas linhas existem daquele lado — no envio inteiro, e não no que sobrou.
 *
 * É o que o servidor devolve, de propósito: uma contagem que encolhe a cada
 * clique deixa de dizer "quanto existe" e passa a dizer "quanto sobrou", que é
 * a pergunta que o cabeçalho da lista já responde. O `title` diz isso, porque
 * um número ao lado de um filtro é lido como previsão do resultado.
 */
function Contagem({ n }: { n?: number }) {
  if (n === undefined) return null;
  return (
    <span
      className="ml-1.5 opacity-60 tabular-nums"
      title="quantas existem no envio inteiro — os outros filtros não mexem nesta conta"
    >
      {n.toLocaleString("pt-BR")}
    </span>
  );
}
