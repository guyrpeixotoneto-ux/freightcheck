import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FileSearch,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchJson, getApiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

/**
 * Curadoria de Atributos (F2).
 *
 * O que esta tela existe para impedir: um número com aparência de certo.
 * Enquanto um atributo não é confirmado aqui, ele aparece nas telas de
 * mudança mas não entra em nenhuma soma financeira — e o banco recusa
 * qualquer tentativa de confirmar sem responsável e justificativa.
 */

/**
 * Os códigos são o que o banco guarda; o texto ao lado é o que evita confirmar
 * a unidade errada por não saber o que a sigla queria dizer.
 */
const UNITS: [code: string, meaning: string][] = [
  ["BRL", "reais"],
  ["BRL_KM", "reais por quilômetro"],
  ["KM_L", "quilômetros por litro"],
  ["PERCENT", "percentual"],
  ["KM", "quilômetros"],
  ["LITROS", "litros"],
  ["MESES", "meses"],
  ["ANO", "ano de calendário"],
  ["QTD", "quantidade"],
];
const PERIODICITIES = ["MENSAL", "ANUAL", "PONTUAL"];
const AGGREGATIONS: [code: string, meaning: string][] = [
  ["SUM", "soma na frota"],
  ["AVG", "média simples"],
  ["WEIGHTED_AVG", "média ponderada"],
  ["NONE", "não agrega"],
];

interface QueueItem {
  code: string;
  sourceName: string;
  displayName: string | null;
  entityType: string;
  dataType: string;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  semanticsRationale: string | null;
  definition: string | null;
  calculationBasis: string | null;
  taxonomyPath: string | null;
  taxonomyName: string | null;
  costClass: string | null;
  valueCount: number;
  nullCount: number;
  magnitude: number | null;
}

interface AttributeDetail extends QueueItem {
  samples: {
    snapshotLabel: string;
    effectiveDate: string;
    value: string | null;
    isNull: boolean;
    nullReason: string | null;
    sheet: string;
    row: number;
    column: string;
    columnHeader: string | null;
    originalValue: string | null;
    originalType: string;
  }[];
  history: { snapshotLabel: string; effectiveDate: string; sum: number | null; count: number }[];
  events: {
    field: string;
    valueBefore: string | null;
    valueAfter: string | null;
    actor: string;
    reason: string | null;
    createdAt: string;
  }[];
}

interface TaxonomyNode {
  id: string;
  code: string;
  name: string;
  costClass: string | null;
  depth: number;
  path: string;
}

const brl = (value: number) =>
  value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

function StatusBadge({ status }: { status: string }) {
  if (status === "CONFIRMED") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100">
        <ShieldCheck className="w-3 h-3 mr-1" />
        Confirmado
      </Badge>
    );
  }
  if (status === "PRESUMED") {
    return (
      <Badge className="bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100">
        <CircleHelp className="w-3 h-3 mr-1" />
        Presumido
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <AlertTriangle className="w-3 h-3 mr-1" />
      Desconhecido
    </Badge>
  );
}

export default function Curadoria() {
  const queryClient = useQueryClient();
  const search = useSearch();
  const [, navegar] = useLocation();

  /*
    O atributo aberto mora no endereço; o recorte da fila, no estado.

    A divisão é a mesma da aba Planilha, e pela mesma razão. **Qual atributo se
    está lendo** é o que as outras telas apontam: seis lugares do produto dizem
    "falta confirmar isto" e mandavam para cá sem dizer o quê — a pessoa chegava
    numa fila de 121 itens e tinha de procurar o nome que acabara de ler. Agora
    o endereço carrega o código, e a mesma URL leva outra pessoa ao mesmo lugar.

    **Como a fila é encurtada** — o texto do filtro e o botão Pendentes/Todos —
    continua em `useState`: ninguém aponta para "a fila filtrada por 'ipva'", e
    reescrever o endereço a cada tecla encheria o histórico sem que nada tivesse
    sido lido.
  */
  const selected = new URLSearchParams(search).get("atributo");
  const setSelected = (code: string | null) => {
    const params = new URLSearchParams(search);
    if (code) params.set("atributo", code);
    else params.delete("atributo");
    // `replace`: escolher outro item da fila não é uma tela nova, e voltar tem
    // de sair da Curadoria em vez de percorrer os atributos já abertos.
    navegar(params.toString() ? `/curadoria?${params}` : "/curadoria", {
      replace: true,
    });
  };

  const [filter, setFilter] = useState("");
  const [showConfirmed, setShowConfirmed] = useState(false);

  const { data: summary } = useQuery({
    queryKey: ["curation", "summary"],
    queryFn: () => fetchJson<{ byStatus: { status: string; count: number; monetary: number }[]; unclassified: number }>("/curation/summary"),
  });

  const { data: queue = [], isLoading, error } = useQuery({
    queryKey: ["curation", "queue", showConfirmed],
    queryFn: () =>
      fetchJson<QueueItem[]>(`/curation/queue?includeConfirmed=${showConfirmed}`),
  });

  const { data: taxonomy = [] } = useQuery({
    queryKey: ["curation", "taxonomy"],
    queryFn: () => fetchJson<TaxonomyNode[]>("/curation/taxonomy?flat=true"),
  });

  const { data: detail } = useQuery({
    queryKey: ["curation", "attribute", selected],
    queryFn: () => fetchJson<AttributeDetail>(`/curation/attributes/${selected}`),
    enabled: selected !== null,
  });

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return queue;
    return queue.filter(
      (item) =>
        item.code.toLowerCase().includes(needle) ||
        item.sourceName.toLowerCase().includes(needle) ||
        (item.displayName?.toLowerCase().includes(needle) ?? false),
    );
  }, [queue, filter]);

  /*
    Quem chegou por link a um atributo já confirmado precisa vê-lo na fila.

    A fila abre em "Pendentes", e um atributo confirmado não está nela: o painel
    da direita mostrava o atributo pedido enquanto a lista da esquerda não o
    continha, e a tela se contradizia em silêncio. O botão vira "Todos" uma vez,
    só quando o endereço pediu alguém que a fila atual não tem — trocá-lo por
    conta própria em qualquer outra situação seria desfazer uma escolha de quem
    está lendo.
  */
  useEffect(() => {
    if (selected === null || showConfirmed || queue.length === 0) return;
    if (!queue.some((item) => item.code === selected)) setShowConfirmed(true);
  }, [selected, queue, showConfirmed]);

  // Aggregate across every non-confirmed status rather than picking one row:
  // the summary is grouped, not ordered, so "the first pending row" is
  // whichever the database happened to return — and PRESUMED and UNKNOWN both
  // count as pending.
  const notConfirmed = summary?.byStatus.filter((s) => s.status !== "CONFIRMED") ?? [];
  const pendingCount = notConfirmed.reduce((sum, s) => sum + s.count, 0);
  const pendingMonetary = notConfirmed.reduce((sum, s) => sum + s.monetary, 0);
  const confirmedCount =
    summary?.byStatus.find((s) => s.status === "CONFIRMED")?.count ?? 0;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileSearch className="w-6 h-6 text-primary" />
          Curadoria de Atributos
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          O Freightec não diz o que cada variável significa. Enquanto você não
          confirmar aqui, o atributo aparece nas telas de mudança mas{" "}
          <strong>não entra em nenhum cálculo financeiro</strong>.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <SummaryTile
            label="Confirmados"
            value={confirmedCount}
            tone="good"
            icon={<CheckCircle2 className="w-4 h-4" />}
          />
          <SummaryTile
            label="Aguardando confirmação"
            value={pendingCount}
            tone="warn"
            icon={<CircleHelp className="w-4 h-4" />}
          />
          <SummaryTile
            label="Monetários sem confirmar"
            value={pendingMonetary}
            tone="warn"
            icon={<Lock className="w-4 h-4" />}
          />
          <SummaryTile
            label="Fora da taxonomia"
            value={summary?.unclassified ?? 0}
            tone="neutral"
            icon={<AlertTriangle className="w-4 h-4" />}
          />
        </div>
      </header>

      {error && (
        <div className="px-8 pt-6">
          <ApiErrorNotice
            error={error}
            what="A fila de curadoria não pôde ser carregada."
          />
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6 p-8 items-start">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Fila de curadoria</CardTitle>
            <p className="text-xs text-muted-foreground">
              Ordenada por materialidade. A soma exibida é bruta e não auditada —
              serve para priorizar, não é resultado.
            </p>
            <div className="flex gap-2 pt-2">
              <Input
                placeholder="Filtrar por nome ou código…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-9"
              />
              <Button
                variant={showConfirmed ? "default" : "outline"}
                size="sm"
                onClick={() => setShowConfirmed((v) => !v)}
                className="shrink-0"
              >
                {showConfirmed ? "Todos" : "Pendentes"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 max-h-[70vh] overflow-y-auto">
            {isLoading && (
              <p className="text-sm text-muted-foreground p-4">Carregando…</p>
            )}
            {visible.map((item) => (
              <button
                key={item.code}
                onClick={() => setSelected(item.code)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b hover:bg-muted/60 transition-colors",
                  selected === item.code && "bg-muted",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-muted-foreground truncate">
                      {item.displayName ? `${item.sourceName} · ` : ""}
                      {item.code}
                    </div>
                    <div className="font-medium text-sm truncate">
                      {item.displayName ?? item.sourceName}
                    </div>
                  </div>
                  <StatusBadge status={item.semanticsStatus} />
                </div>
                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <span className="font-mono">{item.unit ?? "sem unidade"}</span>
                  <span>·</span>
                  <span className="font-mono">{item.aggregation ?? "sem agregação"}</span>
                  {item.magnitude !== null && item.magnitude !== 0 && (
                    <>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{brl(item.magnitude)}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
            {!isLoading && visible.length === 0 && (
              <p className="text-sm text-muted-foreground p-4">
                Nada pendente com esse filtro.
              </p>
            )}
          </CardContent>
        </Card>

        {detail ? (
          /* Chaveado pelo código: sem isto o painel é a mesma instância ao
             trocar de atributo, e os campos — que nascem de `useState(detail…)`
             — continuariam mostrando as respostas do atributo anterior. */
          <AttributePanel
            key={detail.code}
            detail={detail}
            taxonomy={taxonomy}
            onConfirmed={() => {
              queryClient.invalidateQueries({ queryKey: ["curation"] });
            }}
          />
        ) : (
          <Card className="h-full">
            <CardContent className="p-12 text-center text-muted-foreground">
              Selecione um atributo para ver os valores reais e confirmar o que
              ele significa.
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function SummaryTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "neutral";
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          tone === "good" && "text-emerald-700",
          tone === "warn" && "text-amber-700",
          tone === "neutral" && "text-muted-foreground",
        )}
      >
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums mt-1">{value}</div>
    </div>
  );
}

function AttributePanel({
  detail,
  taxonomy,
  onConfirmed,
}: {
  detail: AttributeDetail;
  taxonomy: TaxonomyNode[];
  onConfirmed: () => void;
}) {
  const [unit, setUnit] = useState(detail.unit ?? "");
  const [periodicity, setPeriodicity] = useState(detail.periodicity ?? "");
  const [aggregation, setAggregation] = useState(detail.aggregation ?? "");
  const [taxonomyCode, setTaxonomyCode] = useState(
    taxonomy.find((n) => n.path === detail.taxonomyPath)?.code ?? "",
  );
  const [isMonetary, setIsMonetary] = useState(detail.isMonetary === true);
  const [reason, setReason] = useState("");
  /** Quem assina esta confirmação. Vem da sessão; a tela só o exibe. */
  const signedInAs = useAuth().user?.email ?? "quem está logado";
  const [error, setError] = useState<string | null>(null);

  const confirm = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/confirm`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            unit: unit || null,
            periodicity: periodicity || null,
            aggregation: aggregation || null,
            isMonetary,
            taxonomyCode: taxonomyCode || undefined,
            // `actor` não vai daqui: quem assina é a sessão, e o servidor o lê
            // de lá. Um nome digitado na tela nunca provou nada.
            reason,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao confirmar");
      return body;
    },
    onSuccess: () => {
      setError(null);
      onConfirmed();
    },
    onError: (err: Error) => setError(err.message),
  });

  const conflicted = detail.semanticsRationale?.startsWith("CONFLITO");
  const blocked = isMonetary && (!unit || !periodicity || !aggregation);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              {/* O nome gerencial manda no título quando existe; o de origem
                  nunca some, porque é por ele que se acha a coluna no export. */}
              <CardTitle className={cn("text-lg", !detail.displayName && "font-mono")}>
                {detail.displayName ?? detail.sourceName}
              </CardTitle>
              <p className="font-mono text-xs text-muted-foreground mt-1">
                {detail.displayName && <>{detail.sourceName} · </>}
                {detail.code} · {detail.entityType} · tipo {detail.dataType}
              </p>
            </div>
            <StatusBadge status={detail.semanticsStatus} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {detail.semanticsRationale && (
            <div
              className={cn(
                "rounded-md border-l-4 px-4 py-3 text-sm",
                conflicted
                  ? "bg-red-50 border-red-500 text-red-900"
                  : "bg-muted border-primary",
              )}
            >
              {/* Depois de confirmar, `semanticsRationale` deixa de ser a
                  proposta do motor: a confirmação a sobrescreve com a
                  justificativa de quem assinou. Chamar as duas de "proposta do
                  sistema" atribuía ao motor uma frase escrita por uma pessoa —
                  e é justamente a confusão entre os campos em prosa que o card
                  "Significado" existe para desfazer. */}
              <div className="font-semibold text-xs uppercase tracking-wide mb-1">
                {conflicted
                  ? "Conflito detectado"
                  : detail.semanticsStatus === "CONFIRMED"
                    ? "Justificativa da confirmação"
                    : "Proposta do sistema"}
              </div>
              {detail.semanticsRationale}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Metric label="Valores" value={detail.valueCount.toLocaleString("pt-BR")} />
            <Metric label="Ausentes" value={detail.nullCount.toLocaleString("pt-BR")} />
            <Metric
              label="Taxonomia"
              value={detail.taxonomyName ?? "—"}
            />
            <Metric label="Classe" value={detail.costClass ?? "—"} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Valores reais e origem</CardTitle>
          <p className="text-xs text-muted-foreground">
            Decida olhando o dado, não o nome da coluna.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Vigência</th>
                  <th className="text-right px-4 py-2 font-medium">Valor</th>
                  <th className="text-left px-4 py-2 font-medium">Origem</th>
                  <th className="text-left px-4 py-2 font-medium">Original</th>
                </tr>
              </thead>
              <tbody>
                {detail.samples.map((sample, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{sample.snapshotLabel}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {sample.isNull ? (
                        <span className="text-muted-foreground italic">
                          {sample.nullReason}
                        </span>
                      ) : (
                        sample.value
                      )}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {sample.sheet} · L{sample.row} · {sample.column}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {sample.originalValue} <span className="opacity-60">({sample.originalType})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <MeaningCard detail={detail} onSaved={onConfirmed} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Confirmar semântica</CardTitle>
          <p className="text-xs text-muted-foreground">
            Uma confirmação é um ato seu, com nome e justificativa. O banco
            recusa qualquer outra coisa.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Unidade">
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                <SelectContent>
                  {UNITS.map(([code, meaning]) => (
                    <SelectItem key={code} value={code}>
                      <span className="font-mono">{code}</span>
                      <span className="text-muted-foreground"> · {meaning}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Periodicidade"
              hint="O sistema nunca propõe: os nomes de coluna deste export não são confiáveis."
            >
              <Select value={periodicity} onValueChange={setPeriodicity}>
                <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                <SelectContent>
                  {PERIODICITIES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Agregação">
              <Select value={aggregation} onValueChange={setAggregation}>
                <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                <SelectContent>
                  {AGGREGATIONS.map(([code, meaning]) => (
                    <SelectItem key={code} value={code}>
                      <span className="font-mono">{code}</span>
                      <span className="text-muted-foreground"> · {meaning}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Nó da taxonomia">
              <Select value={taxonomyCode} onValueChange={setTaxonomyCode}>
                <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                <SelectContent>
                  {taxonomy
                    .filter((n) => n.depth > 0)
                    .map((n) => (
                      <SelectItem key={n.code} value={n.code}>
                        {"— ".repeat(Math.max(0, n.depth - 1))}
                        {n.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isMonetary}
              onChange={(e) => setIsMonetary(e.target.checked)}
              className="rounded border-input"
            />
            É um montante financeiro (entra em somas)
          </label>

          <Field
            label="Justificativa"
            hint={`Vai para o histórico assinada por ${signedInAs}.`}
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Com base em quê você está confirmando isso?"
              rows={2}
            />
          </Field>

          {blocked && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              Atributo monetário exige unidade, periodicidade e agregação. Sem
              os três, somar isso é adivinhação.
            </p>
          )}
          {error && (
            <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending || !reason.trim() || blocked}
          >
            {confirm.isPending ? "Confirmando…" : "Confirmar semântica"}
          </Button>
        </CardContent>
      </Card>

      {detail.events.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Histórico de curadoria</CardTitle>
            <p className="text-xs text-muted-foreground">
              Alterações nossas, registradas como CURATION_CHANGE. Nenhuma delas
              toca um fato da Ambev.
            </p>
          </CardHeader>
          <CardContent className="p-0 max-h-72 overflow-y-auto">
            {detail.events.map((event, index) => (
              <div key={index} className="px-4 py-2 border-b last:border-0 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-xs">{event.field}</span>
                  <span className="text-xs text-muted-foreground">{event.actor}</span>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {event.valueBefore ?? "—"} → {event.valueAfter ?? "—"}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Como a coluna se chama e o que ela significa — o passo barato da curadoria.
 *
 * Fica **acima** de "Confirmar semântica" porque são as perguntas que se
 * respondem primeiro: dizer "vidaCombustivel é a vida útil considerada em
 * contrato" não exige ter decidido se o número é mensal, e nem chamá-la de
 * "Vida útil do combustível". O card abaixo continua exigindo, como deve — a
 * diferença é que agora não é preciso passar por ele para registrar o que se
 * sabe.
 *
 * O nome mora aqui, e não no card de baixo, pela mesma razão: batizar é
 * vocabulário, não é afirmação sobre aritmética. `sourceName` nunca é
 * substituído — é por ele que a importação casa a coluna, e ele continua à
 * vista ao lado do apelido em toda tela.
 *
 * Salvar aqui não confirma nada e não destrava cálculo nenhum. O texto ao pé do
 * botão diz isso na tela, e não só aqui, porque um campo que parece destravar
 * dinheiro e não destrava é pior do que campo nenhum.
 */
function MeaningCard({
  detail,
  onSaved,
}: {
  detail: AttributeDetail;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(detail.displayName ?? "");
  const [definition, setDefinition] = useState(detail.definition ?? "");
  const [basis, setBasis] = useState(detail.calculationBasis ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    displayName.trim() !== (detail.displayName ?? "").trim() ||
    definition.trim() !== (detail.definition ?? "").trim() ||
    basis.trim() !== (detail.calculationBasis ?? "").trim();

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/meaning`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName,
            definition,
            calculationBasis: basis,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao salvar");
      return body;
    },
    onSuccess: () => {
      setError(null);
      setSaved(true);
      onSaved();
    },
    onError: (err: Error) => {
      setSaved(false);
      setError(err.message);
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Significado</CardTitle>
        <p className="text-xs text-muted-foreground">
          Como esta coluna se chama e o que ela é, nas suas palavras. Pode ser
          escrito antes de saber a unidade ou a periodicidade — e é independente
          da confirmação.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label="Nome gerencial"
          hint={`Como o atributo aparece nas telas. A importação continua casando por ${detail.sourceName}, que é o nome exibido enquanto este campo estiver vazio.`}
        >
          <Input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
            placeholder={detail.sourceName}
          />
        </Field>

        <Field
          label="O que é"
          hint="A descrição que você daria a alguém que nunca viu esta planilha."
        >
          <Textarea
            value={definition}
            onChange={(e) => {
              setDefinition(e.target.value);
              setSaved(false);
            }}
            placeholder="Ex.: vida útil, em meses, considerada em contrato para o pneu."
            rows={3}
          />
        </Field>

        <Field
          label="Como a fonte calcula"
          hint="Quando se sabe. É o campo que faltava no caso do IPVA, que trocou de base de cálculo duas vezes sem mudar de unidade."
        >
          <Textarea
            value={basis}
            onChange={(e) => {
              setBasis(e.target.value);
              setSaved(false);
            }}
            placeholder="Ex.: 1,000% do valor da nota de compra."
            rows={2}
          />
        </Field>

        {error && (
          <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => save.mutate()}
            disabled={save.isPending || !dirty}
          >
            {save.isPending ? "Salvando…" : "Salvar nome e significado"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {saved && !dirty ? (
              <span className="text-emerald-700 font-medium">
                Salvo. O status não mudou — isto não é uma confirmação.
              </span>
            ) : (
              <>Não confirma nem destrava cálculo financeiro.</>
            )}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
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
