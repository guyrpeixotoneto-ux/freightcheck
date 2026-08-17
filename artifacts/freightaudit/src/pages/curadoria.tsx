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
  Sparkles,
  Undo2,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { PlanilhaDeAtributos } from "@/components/curadoria/planilha-de-atributos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxCriavel } from "@/components/ui/combobox-criavel";
import {
  classeDaCategoria,
  leituraDe,
  oQueFalta,
  podeConfirmar,
  precisaDoPeriodo,
  previaDaCriacao,
  resumo,
  significadoAtual,
  vigenciaDoDado,
  type CampoEmConfirmacao,
  type Escolhas,
  type OpcaoDeCategoria,
  type OpcaoDeSignificado,
} from "@/lib/interpretacao";
import {
  PERIODOS_EM_ABERTO,
  significadoPara,
} from "@workspace/curation/significado";
import { fetchJson, getApiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  abasDeEquipamento,
  estaDescrito,
  filtrarPorEquipamento,
  normalizarEquipamento,
  rotuloDoEquipamento,
} from "@/lib/curadoria";
import { cn } from "@/lib/utils";

/**
 * Curadoria de Atributos (F2).
 *
 * O que esta tela existe para impedir: um número com aparência de certo.
 * Enquanto um atributo não é confirmado aqui, ele aparece nas telas de
 * mudança mas não entra em nenhuma soma financeira — e o banco recusa
 * qualquer tentativa de confirmar sem responsável e justificativa.
 */

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
  meaningCode: string | null;
  meaningLabel: string | null;
  taxonomyCode: string | null;
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

interface StatusCount {
  status: string;
  count: number;
  monetary: number;
}

interface CurationSummary {
  byStatus: StatusCount[];
  unclassified: number;
  /** O mesmo recorte, por equipamento — é o que as abas leem. */
  byEntity: { entityType: string; byStatus: StatusCount[]; unclassified: number }[];
}

/**
 * O valor da aba "Todos" dentro do `Tabs`, que não aceita string vazia.
 *
 * Fora do componente ele é `null` — "sem recorte" —, e é `null` que some do
 * endereço. Traduzir na fronteira do componente é mais barato do que deixar a
 * palavra "TODOS" virar um tipo de equipamento que não existe.
 */
const TODOS = "__todos__";

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
  /* Vermelho, e não o cinza de antes: a falta de semântica é o que trava a
     fila, e um selo neutro fazia dela um detalhe do card em vez do motivo
     de ele estar ali. Verde quando confirma, acima. */
  return (
    <Badge className="bg-red-100 text-red-800 border-red-300 hover:bg-red-100">
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
  /*
    O equipamento também mora no endereço, e pelo primeiro dos dois motivos: é
    para uma aba que se manda alguém. "Confira as colunas da carreta" vira um
    link, e o mesmo link abre a mesma fila amanhã.
  */
  const equipamento = normalizarEquipamento(
    new URLSearchParams(search).get("equipamento"),
  );

  const irPara = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(patch)) {
      if (valor) params.set(chave, valor);
      else params.delete(chave);
    }
    // `replace`: escolher outro item da fila não é uma tela nova, e voltar tem
    // de sair da Curadoria em vez de percorrer os atributos já abertos.
    navegar(params.toString() ? `/curadoria?${params}` : "/curadoria", {
      replace: true,
    });
  };

  const setSelected = (code: string | null) => irPara({ atributo: code });
  const setEquipamento = (tipo: string | null) => irPara({ equipamento: tipo });

  const [filter, setFilter] = useState("");
  const [showConfirmed, setShowConfirmed] = useState(false);

  const { data: summary } = useQuery({
    queryKey: ["curation", "summary"],
    queryFn: () => fetchJson<CurationSummary>("/curation/summary"),
  });

  const { data: queue = [], isLoading, error } = useQuery({
    queryKey: ["curation", "queue", showConfirmed],
    queryFn: () =>
      fetchJson<QueueItem[]>(`/curation/queue?includeConfirmed=${showConfirmed}`),
  });

  const { data: detail } = useQuery({
    queryKey: ["curation", "attribute", selected],
    queryFn: () => fetchJson<AttributeDetail>(`/curation/attributes/${selected}`),
    enabled: selected !== null,
  });

  /*
    O texto primeiro, o equipamento depois.

    A ordem decide o que os números das abas prometem. Contadas sobre a fila já
    filtrada por texto, elas dizem quantos cards **este** clique abre; contadas
    sobre a fila inteira, uma aba escrita `Carreta 41` abriria três resultados
    porque o filtro "ipva" continuava valendo, e o número viraria decoração.
  */
  const filtradosPorTexto = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return queue;
    return queue.filter(
      (item) =>
        item.code.toLowerCase().includes(needle) ||
        item.sourceName.toLowerCase().includes(needle) ||
        (item.displayName?.toLowerCase().includes(needle) ?? false),
    );
  }, [queue, filter]);

  const abas = useMemo(() => abasDeEquipamento(filtradosPorTexto), [filtradosPorTexto]);
  const visible = useMemo(
    () => filtrarPorEquipamento(filtradosPorTexto, equipamento),
    [filtradosPorTexto, equipamento],
  );

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

  /*
    E a aba segue o atributo, pela mesma razão e com o mesmo limite.

    Um link para `cavalo.ipva` aberto com a aba `Carreta` no endereço mostrava o
    painel de um atributo que a lista ao lado não continha — a contradição que o
    efeito acima já resolvia para o botão Pendentes. A aba anda uma vez, só
    quando o atributo pedido é de outro equipamento; clicar numa aba com um
    atributo aberto continua sendo escolha de quem clicou, e ela não se desfaz
    sozinha.
  */
  useEffect(() => {
    if (selected === null || equipamento === null) return;
    const item = queue.find((i) => i.code === selected);
    const tipo = item ? normalizarEquipamento(item.entityType) : null;
    if (tipo !== null && tipo !== equipamento) setEquipamento(tipo);
    /* `setEquipamento` fica fora das dependências de propósito: ele nasce a
       cada render, porque lê o endereço. O que este efeito observa é o
       endereço, que é o que ele escreve. */
  }, [selected, equipamento, queue]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
    Os números do topo falam da aba aberta.

    Contá-los sempre sobre a base inteira era a contradição óbvia: "73
    aguardando confirmação" acima de uma lista de 41 colunas de carreta. O
    recorte por equipamento vem do servidor, e não da fila da tela, porque a
    fila em "Pendentes" não tem os confirmados — contar daqui zeraria o primeiro
    quadro justamente na aba de quem mais curou.
  */
  const recorte: { byStatus: StatusCount[]; unclassified: number } | undefined =
    summary === undefined
      ? undefined
      : equipamento === null
        ? summary
        : // Equipamento sem nenhuma linha no resumo é zero de verdade, e não
          // ausência de resposta: o resumo chegou e não o listou.
          (summary.byEntity.find((e) => e.entityType === equipamento) ?? {
            byStatus: [],
            unclassified: 0,
          });

  /*
    Quantas colunas o recorte tem na base, de qualquer status — o número que
    separa "este equipamento não existe aqui" de "as colunas dele já estão
    todas confirmadas". `null` enquanto o resumo não chegou: as duas frases
    afirmam coisas sobre a base, e nenhuma pode ser dita por falta de resposta.
  */
  const colunasNaBase =
    recorte === undefined
      ? null
      : recorte.byStatus.reduce((sum, s) => sum + s.count, 0);

  // Aggregate across every non-confirmed status rather than picking one row:
  // the summary is grouped, not ordered, so "the first pending row" is
  // whichever the database happened to return — and PRESUMED and UNKNOWN both
  // count as pending.
  const notConfirmed = recorte?.byStatus.filter((s) => s.status !== "CONFIRMED") ?? [];
  const pendingCount = notConfirmed.reduce((sum, s) => sum + s.count, 0);
  const pendingMonetary = notConfirmed.reduce((sum, s) => sum + s.monetary, 0);
  const confirmedCount =
    recorte?.byStatus.find((s) => s.status === "CONFIRMED")?.count ?? 0;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileSearch className="w-6 h-6 text-primary" />
              Curadoria de Atributos
            </h1>
            <p className="text-muted-foreground mt-1 max-w-3xl">
              O Freightec não diz o que cada variável significa. Enquanto você não
              confirmar aqui, o atributo aparece nas telas de mudança mas{" "}
              <strong>não entra em nenhum cálculo financeiro</strong>.
            </p>
          </div>
          {/* A planilha fica no topo, ao lado do título, e não dentro da fila:
              ela descreve a base inteira de uma vez, e não o atributo aberto. */}
          <PlanilhaDeAtributos />
        </div>

        {/* As abas vêm antes dos quadros porque mandam neles: primeiro se
            escolhe de que equipamento se está falando, depois se lê quanto
            falta nele. Na ordem inversa, os números apareceriam antes de a
            tela dizer sobre o que eles são. */}
        <Tabs
          value={equipamento ?? TODOS}
          onValueChange={(valor) =>
            setEquipamento(valor === TODOS ? null : valor)
          }
          className="mt-5"
        >
          <TabsList>
            {abas.map((aba) => (
              <TabsTrigger key={aba.tipo ?? TODOS} value={aba.tipo ?? TODOS}>
                {aba.rotulo}
                <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                  {aba.total}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* As abas vêm antes dos quadros porque mandam neles: primeiro se
            escolhe de que equipamento se está falando, depois se lê quanto
            falta nele. Na ordem inversa, os números apareceriam antes de a
            tela dizer sobre o que eles são. */}
        <Tabs
          value={equipamento ?? TODOS}
          onValueChange={(valor) =>
            setEquipamento(valor === TODOS ? null : valor)
          }
          className="mt-5"
        >
          <TabsList>
            {abas.map((aba) => (
              <TabsTrigger key={aba.tipo ?? TODOS} value={aba.tipo ?? TODOS}>
                {aba.rotulo}
                <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                  {aba.total}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

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
            value={recorte?.unclassified ?? 0}
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
            <CardTitle className="text-base">
              {/* O título repete a aba porque a lista é o que ela recorta, e
                  quem rolou a página até aqui já não vê as abas lá em cima. */}
              {equipamento === null
                ? "Fila de curadoria"
                : `Fila de curadoria · ${rotuloDoEquipamento(equipamento)}`}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ordenada por materialidade. A soma exibida é bruta e não auditada —
              serve para priorizar, não é resultado. Em verde, o que já tem nome,
              descrição e fórmula escritos — descrever não é confirmar.
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
            {visible.map((item) => {
              const descrito = estaDescrito(item);
              return (
                <button
                  key={item.code}
                  onClick={() => setSelected(item.code)}
                  /* A faixa da esquerda existe em todo card, transparente
                     quando não há o que marcar: assim o verde acende sem
                     empurrar o texto 4px para o lado. */
                  className={cn(
                    "w-full text-left px-4 py-3 border-b border-l-4 border-l-transparent transition-colors",
                    descrito
                      ? "border-l-emerald-500 bg-emerald-50/70 hover:bg-emerald-100/70"
                      : "hover:bg-muted/60",
                    selected === item.code &&
                      (descrito ? "bg-emerald-100" : "bg-muted"),
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
                    {/* O verde sozinho não diz do que é o verde — e neste
                        card, ao lado de um selo de status, seria lido como
                        "confirmado". A palavra impede a leitura errada. */}
                    {descrito && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" />
                          descrito
                        </span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
            {!isLoading && visible.length === 0 && (
              <FilaVazia
                equipamento={equipamento}
                filtrando={filter.trim() !== ""}
                mostrandoConfirmados={showConfirmed}
                colunasNaBase={colunasNaBase}
              />
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

/**
 * A fila vazia, dita pelo motivo de estar vazia.
 *
 * Eram quatro situações debaixo de uma frase só — "Nada pendente com esse
 * filtro" —, e as abas acrescentaram a mais confusa delas: a aba `Trecho` numa
 * base que só tem cavalo e carreta abria vazia, e a frase sobre o filtro
 * mandava conferir um campo de busca que estava em branco. Cada motivo diz o
 * que fazer em seguida, e o de equipamento inexistente diz de onde o tipo vem —
 * é a única resposta que não está na tela.
 */
function FilaVazia({
  equipamento,
  filtrando,
  mostrandoConfirmados,
  colunasNaBase,
}: {
  equipamento: string | null;
  filtrando: boolean;
  mostrandoConfirmados: boolean;
  colunasNaBase: number | null;
}) {
  const rotulo = equipamento === null ? null : rotuloDoEquipamento(equipamento);

  const texto = filtrando
    ? rotulo
      ? `Nenhuma coluna de ${rotulo} com esse filtro.`
      : "Nada pendente com esse filtro."
    : rotulo === null
      ? mostrandoConfirmados
        ? "Nenhum atributo importado nesta base."
        : "Nada aguardando confirmação — a fila está limpa."
      : colunasNaBase === 0
        ? `Nenhuma coluna de ${rotulo} foi importada nesta base. O tipo de ` +
          `equipamento vem do nome da aba da planilha: uma aba "${rotulo}" na ` +
          `próxima importação abre esta fila sozinha.`
        : mostrandoConfirmados
          ? `Nenhuma coluna de ${rotulo} nesta base.`
          : `Nada aguardando confirmação em ${rotulo}` +
            (colunasNaBase === null
              ? "."
              : ` — as ${colunasNaBase} colunas deste equipamento já estão confirmadas.`);

  return <p className="text-sm text-muted-foreground p-4">{texto}</p>;
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
  onConfirmed,
}: {
  detail: AttributeDetail;
  onConfirmed: () => void;
}) {
  const conflicted = detail.semanticsRationale?.startsWith("CONFLITO");

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
            <Metric label="Categoria" value={detail.taxonomyName ?? "—"} />
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

      <ConfirmarInterpretacao detail={detail} onConfirmed={onConfirmed} />

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
 * Confirmar interpretação do campo — o ato que destrava dinheiro.
 *
 * ---------------------------------------------------------------------------
 * O que este card deixou de perguntar, e por quê
 * ---------------------------------------------------------------------------
 * Ele pedia quatro respostas técnicas: unidade, periodicidade, agregação e
 * "é um montante financeiro (entra em somas)". Só a primeira era uma pergunta
 * de verdade — e nem essa, do jeito que estava escrita. Quem sabe que
 * `manutencaoReaisKm` vale R$ 0,38 por quilômetro rodado já disse, com isso,
 * que a unidade é uma razão monetária, que não há periodicidade, que a soma
 * entre veículos não produz grandeza nenhuma e que aquilo não é montante. As
 * outras três eram pedir à pessoa que derivasse à mão o que o sistema deriva —
 * e quatro campos independentes são quatro portas para a contradição entrar.
 *
 * Agora são duas perguntas, e as duas são de negócio:
 *
 * - **O que este valor representa?** — o significado econômico, do cadastro.
 * - **Categoria** — onde ele entra na conta.
 *
 * A derivação é de `@workspace/curation/significado`, **a mesma função que a
 * API usa para gravar**. A tela não tem uma cópia da regra: se tivesse, ela
 * seria a primeira a sair de sincronia, mostrando uma coisa enquanto o banco
 * grava outra.
 *
 * ---------------------------------------------------------------------------
 * A terceira pergunta, que aparece uma vez em muitas
 * ---------------------------------------------------------------------------
 * `R$ por veículo` é dinheiro, é somável na frota, e não diz de que período —
 * e o período decide em qual dos três totais da composição ele cai. Escolher um
 * por conta própria seria inventar; recusar o significado empurraria a pessoa a
 * mentir num rótulo mais específico. Então a tela pergunta, em português, só
 * nesse caso. É estritamente menos do que antes, quando a periodicidade era
 * perguntada para **todas** as colunas.
 */
function ConfirmarInterpretacao({
  detail,
  onConfirmed,
}: {
  detail: AttributeDetail;
  onConfirmed: () => void;
}) {
  const queryClient = useQueryClient();
  const signedInAs = useAuth().user?.email ?? "quem está logado";

  const { data: catalogo = [] } = useQuery({
    queryKey: ["curation", "significados"],
    queryFn: () => fetchJson<OpcaoDeSignificado[]>("/curation/significados"),
  });
  const { data: categorias = [] } = useQuery({
    queryKey: ["curation", "categorias"],
    queryFn: () => fetchJson<OpcaoDeCategoria[]>("/curation/categorias"),
  });

  const campo: CampoEmConfirmacao = {
    meaningCode: detail.meaningCode,
    unit: detail.unit,
    periodicity: detail.periodicity,
    aggregation: detail.aggregation,
    isMonetary: detail.isMonetary,
    taxonomyCode: detail.taxonomyCode,
    semanticsStatus: detail.semanticsStatus,
    dataType: detail.dataType,
    history: detail.history,
  };

  /*
    O significado abre preenchido com o que já se sabe — gravado, ou lido de
    volta dos quatro campos técnicos de quem foi curado antes desta tela
    existir. É o que impede a mudança de interface de parecer, para quem opera,
    perda da curadoria de 10/08/2026.
  */
  const jaSabido = significadoAtual(campo, catalogo);
  const [meaningCode, setMeaningCode] = useState<string | null>(
    detail.meaningCode ?? null,
  );
  const [taxonomyCode, setTaxonomyCode] = useState<string | null>(
    detail.taxonomyCode ?? null,
  );
  const [periodicity, setPeriodicity] = useState<string | null>(detail.periodicity);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [erroDoCadastro, setErroDoCadastro] = useState<string | null>(null);
  const [verAnalise, setVerAnalise] = useState(false);

  /*
    A leitura por IA continua existindo — o que mudou é onde ela cai.

    Antes ela preenchia quatro selects técnicos. Agora ela responde nos mesmos
    quatro campos (é o vocabulário do modelo, e trocá-lo é outra entrega), e é a
    **autoridade** que traduz a resposta em significado: `significadoPara` é a
    mesma função que o servidor usa para reler semântica antiga. O modelo não
    ganhou voto sobre unidade nem agregação; ele opina sobre o campo, e a
    tradução é uma só.

    Categoria e justificativa continuam fora do alcance dela, e por motivos
    diferentes: a categoria não se lê no número, e a justificativa é o que vai
    assinado.
  */
  const [sugestao, setSugestao] = useState<SugestaoDeSemantica | null>(null);
  const [motivoSemSugestao, setMotivoSemSugestao] = useState<string | null>(null);
  const [antes, setAntes] = useState<{
    meaningCode: string | null;
    periodicity: string | null;
  } | null>(null);

  const sugerirComIA = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/semantica/sugestao`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao sugerir");
      return body as { sugestao: SugestaoDeSemantica | null; motivo: string };
    },
    onSuccess: (body) => {
      if (!body.sugestao) {
        setSugestao(null);
        setAntes(null);
        setMotivoSemSugestao(body.motivo);
        return;
      }
      setMotivoSemSugestao(null);
      setAntes({ meaningCode, periodicity });
      setSugestao(body.sugestao);

      const lido = significadoPara({
        unit: body.sugestao.unidade,
        periodicity: body.sugestao.periodicidade,
        aggregation: body.sugestao.agregacao,
        isMonetary: body.sugestao.ehMonetario,
      });
      // Campo que o modelo não soube não apaga o que a pessoa já escolheu — a
      // franqueza dele não pode custar o trabalho dela.
      if (lido) setMeaningCode(lido.code);
      if (body.sugestao.periodicidade) setPeriodicity(body.sugestao.periodicidade);
    },
  });

  /*
    A pré-seleção pela leitura de volta espera o catálogo chegar — e só age
    enquanto ninguém escolheu nada. Sobrescrever depois apagaria a escolha de
    quem está na tela por causa de uma resposta de rede que chegou tarde.
  */
  useEffect(() => {
    if (meaningCode === null && jaSabido) setMeaningCode(jaSabido.code);
  }, [jaSabido, meaningCode]);

  const escolhas: Escolhas = {
    meaningCode,
    taxonomyCode,
    periodicity,
    justificativa: reason,
  };
  const escolhido = catalogo.find((o) => o.code === meaningCode) ?? null;
  const categoriaEscolhida = categorias.find((c) => c.code === taxonomyCode) ?? null;
  const quadro = resumo(campo, escolhas, catalogo);
  const falta = oQueFalta(escolhas, catalogo);
  const pedePeriodo = precisaDoPeriodo(escolhas, catalogo);

  const confirm = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/confirm`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          /*
            Só o significado, a categoria e — quando o significado deixa o
            período em aberto — o período. Unidade, agregação e natureza
            monetária não sobem: elas são derivadas no servidor, e mandá-las
            daqui reabriria pela API a porta que esta tela fechou.

            `actor` continua não indo: quem assina é a sessão.
          */
          body: JSON.stringify({
            meaningCode,
            periodicity: pedePeriodo ? periodicity : undefined,
            taxonomyCode: taxonomyCode ?? undefined,
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

  /** Cadastrar um significado sem sair daqui. Ver `ComboboxCriavel`. */
  const criarSignificadoInline = async (
    label: string,
  ): Promise<OpcaoDeSignificado | null> => {
    setErroDoCadastro(null);
    const response = await fetch(getApiUrl("/curation/significados"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const body = await response.json();
    if (!response.ok) {
      setErroDoCadastro(body.error ?? "Não consegui cadastrar este significado.");
      return null;
    }
    // `JA_EXISTE` não é erro: quem clicou queria aquilo escolhido no campo, e é
    // o que acontece. A frase explica por que o rótulo mudou de "R$/litro" para
    // "R$ por litro" debaixo do dedo dela.
    if (body.desfecho === "JA_EXISTE") setErroDoCadastro(body.mensagem);
    await queryClient.invalidateQueries({ queryKey: ["curation", "significados"] });
    return body.item as OpcaoDeSignificado | null;
  };

  const criarCategoriaInline = async (
    name: string,
  ): Promise<OpcaoDeCategoria | null> => {
    setErroDoCadastro(null);
    const response = await fetch(getApiUrl("/curation/categorias"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json();
    if (!response.ok) {
      setErroDoCadastro(body.error ?? "Não consegui cadastrar esta categoria.");
      return null;
    }
    if (body.desfecho === "JA_EXISTE") setErroDoCadastro(body.mensagem);
    await queryClient.invalidateQueries({ queryKey: ["curation", "categorias"] });
    return body.item as OpcaoDeCategoria | null;
  };

  const vigencia = vigenciaDoDado(detail.history);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base">
              Confirmar interpretação do campo
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              A IA analisou os dados e preencheu o que conseguiu. Revise os itens
              abaixo antes de confirmar.
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => sugerirComIA.mutate()}
            disabled={sugerirComIA.isPending}
            aria-label="Reler os valores importados com IA"
            title="Reler os valores importados com IA"
          >
            <Sparkles
              className={cn("h-4 w-4", sugerirComIA.isPending && "animate-pulse")}
            />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* 1. Resumo — o que já se sabe de um lado, o que falta do outro. Uma
            lista única faria a pessoa ler tudo para descobrir onde ela entra. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Resumo
            titulo="IA identificou"
            itens={quadro.identificado}
            tone="good"
            vazio="Nada foi identificado a partir dos valores."
          />
          <Resumo
            titulo="Falta confirmar"
            itens={quadro.faltaConfirmar}
            tone="warn"
            vazio="Nada — está tudo preenchido."
          />
        </div>

        {/* 2. O que a IA entendeu. Curto, e com o textão recolhido atrás de uma
            ação secundária: a análise completa é útil e não pode dominar a
            tela que existe para receber duas respostas. */}
        {detail.semanticsRationale && (
          <div className="rounded-md border bg-muted/40 px-3 py-3 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              O que a IA entendeu
            </div>
            <p className="text-sm">{entendimentoCurto(detail, jaSabido)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setVerAnalise((v) => !v)}
              >
                {verAnalise ? "Ocultar análise completa" : "Ver análise completa da IA"}
              </Button>
              {/* O `Desfazer` só existe enquanto os campos ainda contêm o que a
                  IA deixou. Depois de a pessoa mexer, restaurar apagaria a
                  escolha dela, e não a do modelo. */}
              {antes &&
                sugestao &&
                (antes.meaningCode !== meaningCode ||
                  antes.periodicity !== periodicity) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setMeaningCode(antes.meaningCode);
                      setPeriodicity(antes.periodicity);
                      setSugestao(null);
                      setAntes(null);
                    }}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Desfazer a leitura da IA
                  </Button>
                )}
            </div>
            {verAnalise && (
              <p className="whitespace-pre-line border-t pt-2 text-sm text-muted-foreground">
                {detail.semanticsRationale}
              </p>
            )}
            {sugerirComIA.isError && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {sugerirComIA.error.message}
              </p>
            )}
            {motivoSemSugestao && (
              <p className="text-sm text-muted-foreground">
                {MOTIVO_SEM_SUGESTAO[motivoSemSugestao] ?? MOTIVO_SEM_SUGESTAO.ERRO}
              </p>
            )}
            {sugestao && <LeituraDaIA sugestao={sugestao} />}
          </div>
        )}

        {/* 3. Confirmado pela IA — só o que já se sabe. "Pode ser somado entre
            veículos?" saiu daqui de propósito: a agregação é consequência da
            semântica, e não uma pergunta nem uma resposta a exibir. */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Confirmado pela IA
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Metric label="Vigência do dado" value={vigencia ?? "—"} />
            <Metric
              label="Natureza do campo"
              value={
                jaSabido?.isMonetary === true || jaSabido?.unit?.startsWith("BRL")
                  ? "Valor financeiro"
                  : jaSabido
                    ? leituraDe(jaSabido).natureza
                    : "—"
              }
            />
          </div>
        </div>

        {/* 4. As duas perguntas. */}
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Precisa da sua confirmação
          </div>

          <Field
            label="O que este valor representa?"
            hint="Escolha a interpretação econômica do valor. O FreightCheck deriva os campos técnicos automaticamente."
          >
            <ComboboxCriavel
              itens={catalogo}
              valor={escolhido}
              aoEscolher={(item) => {
                setMeaningCode(item.code);
                setErroDoCadastro(null);
              }}
              aoCriar={criarSignificadoInline}
              rotuloDe={(item) => item.label}
              chaveDe={(item) => item.code}
              detalheDe={(item) => leituraDe(item).natureza}
              previaDe={(texto) =>
                previaDaCriacao(texto)?.natureza ??
                "Não consegui entender esse formato — tente “R$ por hora”, “Percentual” ou “Quantidade”."
              }
              placeholder="Pesquisar ou cadastrar…"
              erro={erroDoCadastro}
            />
            {escolhido && (
              // A consequência da escolha, dita antes de confirmar. É onde a
              // regra de agregação aparece — como leitura, nunca como campo.
              <p className="text-xs text-muted-foreground">
                {leituraDe(escolhido).agregacao}
              </p>
            )}
          </Field>

          {pedePeriodo && (
            <Field
              label="De quanto em quanto tempo este valor é pago?"
              hint="Este significado é dinheiro que se acumula, e não diz de que período. Sem isso não há em que total colocá-lo."
            >
              <div className="space-y-1.5">
                {PERIODOS_EM_ABERTO.map((opcao) => (
                  <label
                    key={opcao.periodicity}
                    className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <input
                      type="radio"
                      name="periodo"
                      className="mt-1"
                      checked={periodicity === opcao.periodicity}
                      onChange={() => setPeriodicity(opcao.periodicity)}
                    />
                    <span>
                      <span className="font-medium">{opcao.rotulo}</span>
                      <span className="block text-xs text-muted-foreground">
                        {opcao.ajuda}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </Field>
          )}

          <Field
            label="Categoria"
            hint="Onde este valor entra na conta. Pesquise ou cadastre uma nova."
          >
            <ComboboxCriavel
              itens={categorias}
              valor={categoriaEscolhida}
              aoEscolher={(item) => {
                setTaxonomyCode(item.code);
                setErroDoCadastro(null);
              }}
              aoCriar={criarCategoriaInline}
              rotuloDe={(item) => item.caminho}
              detalheDe={(item) => classeDaCategoria(item)}
              previaDe={() =>
                "Entra como categoria nova, ainda sem classe de custo — ela não se lê no nome. " +
                "Você decide isso em Categorias, e até lá as colunas dela ficam fora dos totais de custo fixo e variável."
              }
              rotuloDeCriacao={(texto) => `Criar categoria “${texto}”`}
              placeholder="Pesquisar ou cadastrar…"
              erro={erroDoCadastro}
            />
          </Field>

          <Field
            label="Por que você está confirmando isso?"
            hint={`Essa justificativa ficará registrada no histórico com sua assinatura (${signedInAs}).`}
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: Conforme a tabela de remuneração enviada, este valor representa R$ por litro e pertence à categoria combustível."
              rows={2}
            />
          </Field>
        </div>

        {/* 8. Estado incompleto — dito por extenso, e não por um botão cinza
            que não explica o que falta. */}
        {falta && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {falta}
          </p>
        )}
        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        <Button
          onClick={() => confirm.mutate()}
          disabled={confirm.isPending || !podeConfirmar(escolhas, catalogo)}
        >
          {confirm.isPending ? "Confirmando…" : "Confirmar interpretação"}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Uma coluna do quadro-resumo. Sem item, diz que não há — nunca fica vazia. */
function Resumo({
  titulo,
  itens,
  tone,
  vazio,
}: {
  titulo: string;
  itens: string[];
  tone: "good" | "warn";
  vazio: string;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          tone === "good" ? "text-emerald-700" : "text-amber-700",
        )}
      >
        {titulo}
      </div>
      {itens.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-sm">
          {itens.map((item, indice) => (
            <li key={indice} className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current opacity-40" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * "O que a IA entendeu", em duas frases.
 *
 * Escrito daqui, e não copiado de `semanticsRationale`: aquele texto é a
 * justificativa técnica do motor — cita unidade, agregação e classe da
 * taxonomia — e é exatamente o vocabulário que esta tela deixou de expor. Ele
 * continua inteiro, atrás de "Ver análise completa".
 *
 * A segunda frase é a mais importante da tela e é uma confissão: dizer o que a
 * IA **não** conseguiu decidir é o que evita a confirmação por inércia de um
 * palpite plausível.
 */
function entendimentoCurto(
  detail: AttributeDetail,
  significado: OpcaoDeSignificado | null,
): string {
  const nome = detail.displayName ?? detail.sourceName;
  const entidade = detail.entityType.toLowerCase();

  const primeira = significado
    ? `Este campo parece representar ${leituraDe(significado).natureza.toLowerCase().replace(/\.$/, "")} por ${entidade}.`
    : `Não foi possível ler, a partir dos valores, que grandeza "${nome}" mede.`;

  if (detail.semanticsStatus === "CONFIRMED") {
    return `${primeira} A interpretação já foi confirmada; alterá-la exige uma nova justificativa assinada.`;
  }

  return (
    `${primeira} Não foi possível identificar o significado econômico exato do valor — por exemplo, se ` +
    `representa R$ por litro, R$ por km, R$ por mês, um valor total ou outro formato — nem a qual ` +
    `categoria ele pertence.`
  );
}

interface SugestaoDeSemantica {
  unidade: string | null;
  periodicidade: string | null;
  agregacao: string | null;
  ehMonetario: boolean | null;
  confianca: "ALTA" | "MEDIA" | "BAIXA";
  justificativa: string;
  duvidas: string[];
}

/**
 * O que a IA leu, dito por extenso — ao lado dos campos, nunca dentro deles.
 *
 * Três coisas precisam aparecer aqui, e nenhuma delas cabe num select:
 *
 * - **A confiança**, porque um palpite de confiança baixa preenchido do mesmo
 *   jeito que um de confiança alta é uma armadilha. Ela sai em cor, que é o que
 *   se lê antes de ler.
 * - **O que sustentou o palpite**, para dar o que conferir contra a tabela de
 *   valores logo acima nesta mesma tela.
 * - **O que ela não soube**, com o que resolveria. É a parte mais útil da
 *   resposta e a que um formulário preenchido esconderia: um campo em branco não
 *   diz se ninguém olhou ou se ninguém conseguiu decidir.
 */
function LeituraDaIA({ sugestao }: { sugestao: SugestaoDeSemantica }) {
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
          Leitura da IA
        </span>
        <span
          className={cn(
            "text-xs font-medium",
            sugestao.confianca === "ALTA" && "text-emerald-700",
            sugestao.confianca === "MEDIA" && "text-amber-700",
            sugestao.confianca === "BAIXA" && "text-red-700",
          )}
        >
          confiança {sugestao.confianca.toLowerCase()}
        </span>
      </div>

      <p className="text-sm whitespace-pre-line">{sugestao.justificativa}</p>

      {sugestao.duvidas.length > 0 && (
        <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
          {sugestao.duvidas.map((duvida, index) => (
            <li key={index}>{duvida}</li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Escrita por IA a partir dos valores importados. É um palpite, não uma
        apuração: não confirma nada, não destrava cálculo e não entra na
        justificativa assinada.
      </p>
    </div>
  );
}

/**
 * Por que não houve sugestão, dito para quem está curando a coluna.
 *
 * Nenhuma destas frases é erro do curador, e nenhuma pede ação dele sobre os
 * campos — por isso saem em texto normal, e não em vermelho de erro.
 */
const MOTIVO_SEM_SUGESTAO: Record<string, string> = {
  SEM_DADOS:
    "Este atributo não tem nenhum valor importado. Sem dado, sugerir semântica seria adivinhar pelo nome da coluna — que é justamente o que esta tela existe para não fazer.",
  SEM_CHAVE:
    "A sugestão por IA não está configurada neste ambiente. Os campos continuam funcionando normalmente.",
  RECUSA:
    "O modelo não quis opinar sobre esta coluna. Preencha os campos à mão, olhando os valores acima.",
  ERRO: "Não consegui ler agora. Tente de novo em alguns instantes.",
};


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
  /*
    O que o servidor gravou pela metade, e por quê. Hoje é um caso só: a fórmula
    de cálculo num atributo sem semântica versionada. Não sai em vermelho porque
    não é recusa do que a pessoa fez — o nome e o significado do mesmo clique
    foram salvos, e o texto da fórmula continua na caixa acima, à espera do
    backfill.
  */
  const [pendente, setPendente] = useState<string | null>(null);

  /*
    Só sobe o que a pessoa mexeu. Mandar os três campos em toda gravação fazia
    uma caixa vazia em que ninguém tocou chegar ao servidor como "apague isto",
    e a base de cálculo é o único dos três que exige semântica versionada — era
    por aí que dar um nome legível a uma coluna terminava numa recusa sobre
    backfill, um assunto que não é o de quem está batizando a coluna.

    `undefined` some no JSON.stringify, e é exatamente o que o servidor lê como
    "não mexa neste campo". Limpar continua possível: campo apagado difere do
    guardado e sobe como "", que vira NULL do outro lado.
  */
  const edits: {
    displayName?: string;
    definition?: string;
    calculationBasis?: string;
  } = {};
  if (displayName.trim() !== (detail.displayName ?? "").trim())
    edits.displayName = displayName;
  if (definition.trim() !== (detail.definition ?? "").trim())
    edits.definition = definition;
  if (basis.trim() !== (detail.calculationBasis ?? "").trim())
    edits.calculationBasis = basis;

  const dirty = Object.keys(edits).length > 0;

  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/meaning`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(edits),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao salvar");
      return body as { notWritten: { message: string } | null };
    },
    onSuccess: (body) => {
      setError(null);
      setSaved(true);
      setPendente(body.notWritten?.message ?? null);
      onSaved();
    },
    onError: (err: Error) => {
      setSaved(false);
      setPendente(null);
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
          hint={`Um apelido de leitura, e só isso. A coluna importada continua sendo ${detail.sourceName} — é por ela que a importação encontra o dado, e ela nunca é renomeada nem sai das telas. Em branco, aparece o nome de origem.`}
        >
          <Input
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
            placeholder={detail.sourceName}
          />
          {/* O apelido ao lado da origem, como a tela mostra de verdade: dizer
              "o nome importado continua vinculado" convence menos do que ver o
              par enquanto se digita. */}
          <p className="text-xs text-muted-foreground">
            Nas telas:{" "}
            <span className="font-medium text-foreground">
              {displayName.trim() || detail.sourceName}
            </span>
            {displayName.trim() && (
              <span className="font-mono"> · {detail.sourceName}</span>
            )}
          </p>
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
          <DefinicaoPeloNome
            detail={detail}
            nome={displayName}
            formula={basis}
            definicao={definition}
            onEscrever={(texto) => {
              setDefinition(texto);
              setSaved(false);
            }}
          />
        </Field>

        <Field
          label="Fórmula de cálculo"
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
          <FormulaEmPortugues detail={detail} formula={basis} />
        </Field>

        {error && (
          <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        {pendente && !error && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            {pendente} O texto da fórmula continua na caixa acima.
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

/**
 * "Escreva isso por mim", a partir do nome que a pessoa acabou de dar.
 *
 * Quem escreve "Vida útil do pneu em contrato" no campo de cima já sabe o que a
 * coluna é — só ainda não escreveu a frase. O campo "O que é" ficava em branco
 * por isso: redigir a mesma coisa uma segunda vez, com sujeito e verbo, é
 * digitação, não curadoria. Este botão faz a digitação.
 *
 * Três decisões que a tela precisa deixar claras:
 *
 * - **Escreve no campo, não numa caixa ao lado.** O resultado é rascunho de
 *   quem clicou: entra no textarea aberto, dá para cortar, corrigir e reescrever
 *   antes de salvar. Uma sugestão em caixa separada, com botão "usar", seria um
 *   passo a mais para chegar ao mesmo lugar.
 * - **O que havia antes volta com um clique.** Um botão que apaga texto alheio
 *   sem volta não é ajuda. `Desfazer` fica à vista enquanto o texto for o que a
 *   IA escreveu, e some assim que a pessoa mexe nele — a partir daí restaurar
 *   apagaria o trabalho dela, não o da IA.
 * - **Lê o nome digitado, não o salvo.** O nome sobe no corpo do pedido. Pedir
 *   para salvar antes faria o rascunho custar o ato que ele existe para
 *   adiantar.
 *
 * Nada aqui grava: o campo continua precisando de "Salvar nome e significado",
 * e salvar continua não confirmando semântica nenhuma.
 */
function DefinicaoPeloNome({
  detail,
  nome,
  formula,
  definicao,
  onEscrever,
}: {
  detail: AttributeDetail;
  nome: string;
  formula: string;
  definicao: string;
  onEscrever: (texto: string) => void;
}) {
  /** O que estava escrito antes do rascunho, e o rascunho que o substituiu. */
  const [troca, setTroca] = useState<{ antes: string; depois: string } | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);

  const rascunhar = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/definicao/rascunho`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: nome, calculationBasis: formula }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao escrever o rascunho");
      return body as { texto: string | null; motivo: string };
    },
    onSuccess: (body) => {
      if (!body.texto) {
        setMotivo(body.motivo);
        return;
      }
      setMotivo(null);
      setTroca({ antes: definicao, depois: body.texto });
      onEscrever(body.texto);
    },
  });

  const semNome = !nome.trim();
  // O `Desfazer` só vale enquanto o campo ainda contém o que a IA escreveu:
  // depois de a pessoa mexer, restaurar apagaria o texto dela.
  const podeDesfazer = troca !== null && definicao === troca.depois;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => rascunhar.mutate()}
          disabled={semNome || rascunhar.isPending}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {rascunhar.isPending ? "Escrevendo…" : "Escrever a partir do nome"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {semNome
            ? "Dê o nome gerencial acima para a IA escrever esta descrição."
            : definicao.trim()
              ? "Reescreve o campo acima a partir do nome. Dá para desfazer."
              : "Preenche o campo acima a partir do nome. Nada é gravado."}
        </p>
      </div>

      {rascunhar.isError && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {rascunhar.error.message}
        </p>
      )}

      {motivo && (
        <p className="text-sm text-muted-foreground bg-muted/40 border rounded-md px-3 py-2">
          {MOTIVO_SEM_RASCUNHO[motivo] ?? MOTIVO_SEM_RASCUNHO.ERRO}
        </p>
      )}

      {podeDesfazer && (
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              onEscrever(troca.antes);
              setTroca(null);
            }}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Desfazer
          </Button>
          <p className="text-xs text-muted-foreground">
            {troca.antes.trim()
              ? "Rascunho de IA, escrito por cima do texto anterior. Revise antes de salvar."
              : "Rascunho de IA a partir do nome acima. É um texto seu — corrija o que não estiver certo."}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Por que não houve rascunho, dito para quem está curando a coluna.
 *
 * `SEM_NOME` não deveria chegar pela tela — o botão fica desligado sem nome —,
 * mas a rota também é chamável com o nome guardado em branco, e uma frase é
 * mais barata do que descobrir por que a caixa não apareceu.
 */
const MOTIVO_SEM_RASCUNHO: Record<string, string> = {
  SEM_NOME: "Sem nome gerencial escrito, não há do que partir.",
  SEM_CHAVE:
    "A escrita por IA não está configurada neste ambiente. O campo continua funcionando normalmente.",
  RECUSA: "O modelo não quis escrever sobre este nome. Escreva a descrição à mão.",
  ERRO: "Não consegui escrever agora. Tente de novo em alguns instantes.",
};

/**
 * "O que essa fórmula quer dizer?", respondido em português.
 *
 * O campo acima guarda a regra como a fonte a explicou — "1,000% do valor da
 * nota", "menor entre o preço da ANP e o da operadora". Quem escreveu entende;
 * quem lê meses depois, muitas vezes não. O botão pede ao modelo uma leitura
 * daquele texto, e é só isso que ele faz.
 *
 * Três decisões que a tela precisa deixar claras, porque nenhuma delas é óbvia
 * olhando um botão:
 *
 * - **Lê o que está digitado, não o que está salvo.** A fórmula sobe no corpo
 *   do pedido. Pedir para salvar antes faria a leitura custar um ato que ela
 *   não deveria custar — e num atributo sem semântica versionada a base de
 *   cálculo nem pode ser gravada ainda.
 * - **Não grava e não confere.** Não há onde guardar o resultado e não deve
 *   haver: é paráfrase do que uma pessoa digitou, não apuração. O rodapé diz
 *   isso na tela, e não só aqui.
 * - **Envelhece à vista.** Se o texto muda depois da leitura, a leitura passa a
 *   falar de outra fórmula. Ela continua visível — apagá-la sozinha pareceria
 *   defeito — mas avisando sobre o quê ela foi feita.
 */
function FormulaEmPortugues({
  detail,
  formula,
}: {
  detail: AttributeDetail;
  formula: string;
}) {
  const [leitura, setLeitura] = useState<{
    texto: string | null;
    motivo: string;
    sobre: string;
  } | null>(null);

  const ler = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/attributes/${detail.code}/formula/leitura`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calculationBasis: formula }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao ler a fórmula");
      return body as { texto: string | null; motivo: string };
    },
    onSuccess: (body) => setLeitura({ ...body, sobre: formula.trim() }),
  });

  const vazia = !formula.trim();
  /*
    Só uma leitura de verdade envelhece. Quando não houve texto — o modelo não
    respondeu, não está configurado, recusou —, não existe paráfrase que possa
    "falar da versão anterior", e o aviso aparecia mesmo assim: embaixo de "Não
    consegui ler agora" a tela dizia que a leitura era de outra fórmula, o que
    inventa uma leitura que nunca houve. O motivo em si continua valendo para
    qualquer texto, e por isso continua visível.
  */
  const desatualizada =
    leitura !== null && leitura.texto !== null && leitura.sobre !== formula.trim();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => ler.mutate()}
          disabled={vazia || ler.isPending}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {ler.isPending ? "Lendo…" : "Explicar esta fórmula"}
        </Button>
        <p className="text-xs text-muted-foreground">
          {vazia
            ? "Escreva a fórmula acima para pedir a leitura."
            : "Uma leitura em português do texto acima. Não grava nada."}
        </p>
      </div>

      {ler.isError && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {ler.error.message}
        </p>
      )}

      {leitura && (
        <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1.5">
          {leitura.texto ? (
            <p className="text-sm whitespace-pre-line">{leitura.texto}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {MOTIVO_SEM_LEITURA[leitura.motivo] ?? MOTIVO_SEM_LEITURA.ERRO}
            </p>
          )}
          {desatualizada && (
            <p className="text-xs text-amber-700">
              O texto mudou depois desta leitura — ela fala da versão anterior.
            </p>
          )}
          {leitura.texto && (
            <p className="text-xs text-muted-foreground">
              Escrito por IA a partir do texto acima. É uma leitura, não uma
              conferência: não diz se a fórmula está certa e não confirma nada.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Por que não houve leitura, dito para quem está curando a coluna.
 *
 * Nenhuma destas frases é um erro do curador, e nenhuma pede ação dele sobre a
 * fórmula — por isso saem em texto normal, e não em vermelho de erro.
 */
const MOTIVO_SEM_LEITURA: Record<string, string> = {
  VAZIO: "Não há fórmula escrita para ler.",
  SEM_CHAVE:
    "A leitura por IA não está configurada neste ambiente. O campo continua funcionando normalmente.",
  RECUSA: "O modelo não quis ler este texto. O campo segue salvo do mesmo jeito.",
  ERRO: "Não consegui ler agora. Tente de novo em alguns instantes.",
};

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
