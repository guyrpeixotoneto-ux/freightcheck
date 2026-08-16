import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  ChevronRight,
  Clock,
  Columns3,
  DollarSign,
  FileSpreadsheet,
  Folder,
  Headset,
  Loader2,
  Lock,
  SlidersHorizontal,
  TrendingDown,
  Upload,
  Zap,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { erroDaResposta, fetchJson, getApiUrl, readJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ChangeTable,
  FilterBar,
  type ChangeRow,
  type Breakdown,
  type Filters,
  emptyFilters,
  toQuery,
} from "@/components/changes/change-table";
import {
  TicketChangeTable,
  TicketFilterBar,
  TicketQuickFilters,
  emptyTicketFilters,
  toTicketQuery,
  type TicketChangeRow,
  type TicketFilters as TicketFilterState,
  type TicketTotals,
} from "@/components/changes/ticket-table";

/**
 * Alterações — o que mudou, pelos dois caminhos por onde a mudança chega.
 *
 * **Planilha** é a comparação entre vigências: o que a Ambev mexeu no cadastro
 * entre um export e o seguinte, apurado célula a célula. **Chamados** é o
 * outro lado da mesma história — o que nós pedimos pelo Freightech e o que
 * voltou aplicado.
 *
 * As duas abas nunca somam nada uma com a outra, e isso é a decisão de projeto
 * central desta tela. O impacto da planilha é uma diferença apurada entre dois
 * estados fechados; o do chamado é a distância entre um pedido e uma resposta,
 * ambos declarados pela própria fonte. Adicioná-los daria um número que não se
 * sustenta em lugar nenhum — e contaria em dobro toda mudança que foi pedida
 * por chamado e depois apareceu na planilha. Duas contas, duas réguas, lado a
 * lado.
 */

type Aba = "planilha" | "chamados";

export default function Alteracoes() {
  const [aba, setAba] = useState<Aba>("planilha");

  // Só a contagem, para a aba dizer o tamanho do assunto antes de ser aberta.
  // `limit=1` porque a lista em si é da aba; o que interessa aqui é o total.
  const resumoChamados = useQuery({
    queryKey: ["tickets", "resumo"],
    queryFn: () =>
      fetchJson<{ totals: TicketTotals | null }>("/tickets?limit=1"),
  });

  return (
    <Layout>
      <div className="border-b bg-card px-8 pt-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          Alterações
        </h1>
        <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
          A remuneração muda por dois caminhos, e cada um se confere de um
          jeito. Os números de uma aba nunca somam com os da outra.
        </p>

        <nav className="flex items-center gap-1 mt-4" role="tablist">
          <AbaBotao
            active={aba === "planilha"}
            onClick={() => setAba("planilha")}
            icon={<FileSpreadsheet className="w-4 h-4" />}
            label="Planilha"
            hint="o que a Ambev mexeu entre duas vigências"
          />
          <AbaBotao
            active={aba === "chamados"}
            onClick={() => setAba("chamados")}
            icon={<Headset className="w-4 h-4" />}
            label="Chamados"
            hint="o que pedimos e o que voltou aplicado"
            count={resumoChamados.data?.totals?.changes}
          />
        </nav>
      </div>

      {aba === "planilha" ? <AbaPlanilha /> : <AbaChamados />}
    </Layout>
  );
}

function AbaBotao({
  active,
  onClick,
  icon,
  label,
  hint,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  count?: number;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-input",
      )}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span
          className={cn(
            "text-xs tabular-nums rounded-full px-1.5 py-0.5",
            active ? "bg-primary/10 text-primary" : "bg-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Aba Planilha
// ---------------------------------------------------------------------------

interface ConsolidatedResponse {
  view: {
    period: string;
    present: {
      entityTypeSet: string;
      sourceLabel: string;
      previousLabel: string | null;
      reason: string | null;
    }[];
    missing: string[];
    complete: boolean;
    totals: {
      valueChanges: number;
      entitiesAdded: number;
      entitiesRemoved: number;
      attributesAdded: number;
      attributesRemoved: number;
      inconclusive: number;
      impactNotCalculable: number;
    };
    impactByPeriodicity: Record<string, number>;
  };
  breakdown: Breakdown;
  periods: { effective_date: string; series: string[] }[];
  total: number;
  rows: ChangeRow[];
}

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
  series: { entityTypeSet: string; vigencias: number; latestLabel: string }[];
  selectedSeries: string;
  total: number;
  rows: ChangeRow[];
}

/**
 * A tela responde, em ordem: o que mudou, de quanto para quanto, quanto isso
 * vale, em que parte da remuneração, e de onde veio. Materialidade ordena a
 * lista; nunca a filtra por conta própria.
 */
function AbaPlanilha() {
  /*
    `?search=` chega preenchido quando alguém vem do Acompanhamento pedindo a
    lista de um parâmetro específico. É estado inicial, não filtro fixo: a
    barra de filtros continua mandando daí em diante, e limpar o campo devolve
    a lista inteira. O termo cobre código, nome do atributo e placa — ver
    `buildWhere` em `lib/comparison/src/query.ts`.
  */
  const buscaInicial = new URLSearchParams(useSearch()).get("search") ?? "";
  const [filters, setFilters] = useState<Filters>({
    ...emptyFilters,
    search: buscaInicial,
  });
  /** null = visão consolidada da frota; caso contrário, uma série. */
  const [series, setSeries] = useState<string | null>(null);

  const consolidated = useQuery({
    queryKey: ["changes", "consolidated", filters],
    queryFn: () =>
      fetchJson<ConsolidatedResponse>(
        `/changes/consolidated?${toQuery(filters)}`,
      ),
    enabled: series === null,
  });

  const single = useQuery({
    queryKey: ["changes", "latest", filters, series],
    queryFn: () =>
      fetchJson<LatestResponse>(
        `/changes/latest?${toQuery(filters)}&entityTypeSet=${series}`,
      ),
    enabled: series !== null,
  });

  const isLoading = series === null ? consolidated.isLoading : single.isLoading;
  const error = series === null ? consolidated.error : single.error;
  const cv = consolidated.data?.view;
  const data = single.data;

  // Séries conhecidas, para os botões. Vêm do consolidado, que enxerga todas.
  const known = [
    ...(cv?.present.map((p) => p.entityTypeSet) ?? []),
    ...(cv?.missing ?? []),
    ...(data?.series.map((s) => s.entityTypeSet) ?? []),
  ].filter((v, i, a) => a.indexOf(v) === i).sort();

  const rows = series === null ? consolidated.data?.rows : data?.rows;
  const total = series === null ? consolidated.data?.total : data?.total;
  const breakdown = series === null ? consolidated.data?.breakdown : data?.breakdown;
  const totals =
    series === null
      ? cv?.totals
      : data && {
          valueChanges: data.set.valueChanges,
          entitiesAdded: data.set.entitiesAdded,
          entitiesRemoved: data.set.entitiesRemoved,
          attributesAdded: data.set.attributesAdded,
          attributesRemoved: data.set.attributesRemoved,
          inconclusive: data.set.inconclusive,
          impactNotCalculable: data.set.impactNotCalculable,
        };
  const impact =
    series === null
      ? (cv?.impactByPeriodicity ?? {})
      : (data?.set.calculatedImpactByPeriodicity ?? {});

  return (
    <>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            {series === null ? (
              cv && <span className="font-mono">período {cv.period}</span>
            ) : (
              data && (
                <>
                  <span className="font-mono">{data.set.snapshotALabel}</span>
                  <ArrowRight className="w-4 h-4" />
                  <span className="font-mono">{data.set.snapshotBLabel}</span>
                </>
              )
            )}
          </p>

          {/* Consolidado é agrupamento de tela e API: soma as séries que
              entregaram no período. Nenhuma vigência é fundida no banco. */}
          {known.length > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSeries(null)}
                className={cn(
                  "text-xs px-2.5 py-1 rounded-full border transition-colors",
                  series === null
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-muted border-input text-muted-foreground",
                )}
              >
                frota
              </button>
              {known.map((s) => (
                <button
                  key={s}
                  onClick={() => setSeries(s)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full border transition-colors",
                    series === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted border-input text-muted-foreground",
                  )}
                >
                  {s.replace("+", " · ").toLowerCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
            <Tile label="Valores alterados" value={totals.valueChanges} />
            <Tile
              label="Ativos entraram / saíram"
              value={`+${totals.entitiesAdded} / −${totals.entitiesRemoved}`}
            />
            <Tile
              label="Colunas novas / removidas"
              value={`+${totals.attributesAdded} / −${totals.attributesRemoved}`}
            />
            <ImpactTile buckets={impact} outside={totals.impactNotCalculable} />
            <Tile
              label="Inconclusivas"
              value={totals.inconclusive}
              hint="listadas, não escondidas"
              tone={totals.inconclusive > 0 ? "warn" : "muted"}
            />
          </div>
        )}
      </header>

      <div className="p-8 space-y-6">
        {series === null && cv && !cv.complete && (
          <div className="flex gap-3 rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              <strong>Visão consolidada parcial.</strong> Para o período{" "}
              <span className="font-mono">{cv.period}</span> chegou apenas{" "}
              {cv.present.map((p) => p.entityTypeSet.toLowerCase()).join(", ")}.
              Falta <strong>{cv.missing.join(", ").toLowerCase()}</strong> — os
              números abaixo cobrem só o que foi entregue, e a série ausente não
              está contada como zero.
            </p>
          </div>
        )}

        {series === null && cv && cv.present.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Consolidado de{" "}
            {cv.present
              .map((p) =>
                p.previousLabel
                  ? `${p.entityTypeSet.toLowerCase()} (${p.previousLabel} → ${p.sourceLabel})`
                  : `${p.entityTypeSet.toLowerCase()} (${p.reason})`,
              )
              .join(" · ")}
            . Cada série é comparada com a anterior dela mesma; nada é fundido.
          </p>
        )}

        {totals && totals.impactNotCalculable > 0 && (
          <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              <strong>{totals.impactNotCalculable}</strong> alterações estão
              fora da soma de impacto porque a semântica do atributo ainda não
              foi confirmada, ou porque ele não é um montante somável. Elas
              continuam na lista — o que falta é o preço, não o fato.
            </p>
          </div>
        )}

        <FilterBar
          filters={filters}
          onChange={setFilters}
          breakdown={breakdown}
        />

        {error && (
          <ApiErrorNotice
            error={error}
            what="As alterações da planilha não puderam ser carregadas."
          />
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {total !== undefined ? `${total} alterações` : "Alterações"}
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
            {rows && total !== undefined && (
              <ChangeTable rows={rows} total={total} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Aba Chamados
// ---------------------------------------------------------------------------

interface TicketImportSummary {
  id: string;
  filename: string;
  status: string;
  receivedAt: string;
  receivedBy: string | null;
  rowCount: number;
  ticketCount: number;
  ignoredRowCount: number;
  unmappedColumns: string[];
  parameterColumns: string[];
  columnMapping: Record<string, { header: string; match: string; reason: string }>;
  failureReason: string | null;
}

interface TicketsResponse {
  import: TicketImportSummary | null;
  imports: TicketImportSummary[];
  totals: TicketTotals | null;
  byParameter: {
    parameterLabel: string;
    attributeCode: string | null;
    count: number;
    impactSum: number | null;
  }[];
  total: number;
  rows: TicketChangeRow[];
}

/** Os nomes dos campos, para a tela explicar o mapeamento sem jargão. */
const NOMES_DE_CAMPO: Record<string, string> = {
  externalId: "número do chamado",
  openedAt: "abertura",
  closedAt: "fechamento",
  statusRaw: "status",
  parameterLabel: "parâmetro",
  entityLabel: "placa",
  entityType: "tipo de equipamento",
  requestedValueRaw: "valor pedido",
  appliedValueRaw: "valor aplicado",
  requestedBy: "solicitante",
  subject: "assunto",
};

/**
 * Chamados — os parâmetros que os chamados mexeram.
 *
 * O grão é o mesmo da aba Planilha: um parâmetro que mudou. Um chamado que
 * mexe em oito parâmetros produz oito linhas — o export vem no formato largo,
 * com dezenas de colunas de parâmetro por linha, e cada célula preenchida é
 * uma alteração.
 *
 * A régua é que é outra. Lá o "antes" é a vigência anterior, apurada célula a
 * célula; aqui ele é declarado pelo chamado ou lido da vigência em vigor, e a
 * tela marca qual dos dois. E o impacto só é afirmado depois de o chamado ser
 * atendido — antes disso existe variação, não dinheiro que mudou de mãos.
 */
/**
 * Qual disclosure está aberta abaixo da fileira de avisos.
 *
 * Um só de cada vez, e nenhuma por padrão: os avisos dizem o tamanho do
 * problema em uma linha, e o detalhe — que é longo — só ocupa a tela de quem
 * pediu para vê-lo.
 */
type Painel = "falhas" | "colunas" | "ignoradas" | null;

function AbaChamados() {
  const [filters, setFilters] = useState<TicketFilterState>(emptyTicketFilters);
  const [envio, setEnvio] = useState<string | null>(null);
  // O erro inteiro, e não a frase dele: `ApiErrorNotice` precisa do status e do
  // `code` para separar "o arquivo não serve" de "o banco deste ambiente ainda
  // não tem as tabelas".
  const [erroUpload, setErroUpload] = useState<unknown>(null);
  const [painel, setPainel] = useState<Painel>(null);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["tickets", filters, envio],
    queryFn: () =>
      fetchJson<TicketsResponse>(
        `/tickets?${toTicketQuery(filters, envio ? { ticketImportId: envio } : {})}`,
      ),
    /**
     * A leitura roda fora da requisição que recebeu o arquivo, então quem
     * acabou de enviar veria a tela parada em "está sendo lido" até apertar
     * F5. Enquanto houver envio em leitura a tela pergunta de novo sozinha; no
     * resto do tempo não pergunta nada.
     */
    refetchInterval: (query) => {
      const lendo = query.state.data?.imports.some(
        (i) => i.status === "PENDING" || i.status === "READING",
      );
      return lendo ? 1500 : false;
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // base64 dentro de JSON, igual à importação de vigência: é a requisição
      // mais banal da web, e nenhum proxy a recusa.
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const CHUNK = 32768;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      const response = await fetch(getApiUrl("/ticket-imports"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentBase64: btoa(binary),
        }),
      });
      const body = await readJson(response);
      /*
        `erroDaResposta` e não um `ApiError` montado aqui: esta linha construía
        o erro com status e `code` e deixava `contexto` e `diagnostico` para
        trás. Era justamente neste caminho — o do upload de chamados — que o
        diagnóstico estruturado se perdia, e a tela voltava a mostrar o texto
        cru da rota ao lado do aviso do `/healthz`, dizendo coisas diferentes.
      */
      if (!response.ok) throw erroDaResposta(response, body, file.name);
      return body.ticketImportId as string;
    },
    onSuccess: () => {
      setErroUpload(null);
      // A leitura roda fora da requisição, então o resultado ainda não está
      // pronto quando isto volta. Recarregar já mostra o envio em leitura, e o
      // `refetchInterval` abaixo cuida do resto.
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (err: unknown) => setErroUpload(err),
  });

  const data = query.data;
  const run = data?.import ?? null;
  const totals = data?.totals ?? null;

  const escolherArquivo = () => fileInput.current?.click();

  const falhas = data?.imports.filter((i) => i.status === "FAILED") ?? [];
  const emLeitura =
    data?.imports.filter((i) => i.status === "PENDING" || i.status === "READING") ??
    [];
  const naoMapeadas = run?.unmappedColumns ?? [];
  const ignoradas = run?.ignoredRowCount ?? 0;
  const temAviso =
    falhas.length > 0 || emLeitura.length > 0 || naoMapeadas.length > 0 || ignoradas > 0;

  /*
    O dinheiro pinta os dois cartões que falam dele. "Com impacto" é uma
    contagem, mas é a contagem das linhas que custaram — e mostrá-la em preto
    ao lado de um total vermelho faria o olho procurar duas vezes onde está o
    problema.
  */
  const tomDoDinheiro =
    totals && totals.calculated > 0
      ? totals.impactSum < 0
        ? "bad"
        : totals.impactSum > 0
          ? "good"
          : "muted"
      : "muted";

  const abrirPainel = (alvo: Painel) =>
    setPainel((atual) => (atual === alvo ? null : alvo));

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = "";
        }}
      />

      <div className="p-8 space-y-5">
        {/* De que arquivo saiu tudo o que está abaixo. Fica numa linha, e não
            num cartão: é a procedência da tela, não um número dela. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {run ? (
              <>
                <span className="font-mono">{run.filename}</span> · lido em{" "}
                {new Date(run.receivedAt).toLocaleDateString("pt-BR")}
                {run.receivedBy && <> · enviado por {run.receivedBy}</>}
              </>
            ) : (
              "Nenhum export de chamados importado ainda."
            )}
          </p>

          <div className="flex items-center gap-2">
            {run && Object.keys(run.columnMapping).length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => abrirPainel("colunas")}
                aria-expanded={painel === "colunas"}
                className={cn(
                  painel === "colunas" ? "text-blue-700" : "text-muted-foreground",
                )}
              >
                <Columns3 className="w-4 h-4 mr-1.5" />
                Mapeamento de colunas
              </Button>
            )}
            {data && data.imports.length > 1 && (
              <select
                value={envio ?? run?.id ?? ""}
                onChange={(e) => setEnvio(e.target.value || null)}
                className="text-xs h-8 rounded-md border border-input bg-background px-2"
              >
                {data.imports
                  .filter((i) => i.status === "READ")
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.filename} · {new Date(i.receivedAt).toLocaleDateString("pt-BR")}
                    </option>
                  ))}
              </select>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={escolherArquivo}
              disabled={upload.isPending}
            >
              <Upload className="w-4 h-4 mr-1.5" />
              {upload.isPending ? "Enviando…" : "Importar chamados"}
            </Button>
          </div>
        </div>

        {/*
          O upload falha por dois motivos muito diferentes — o arquivo não
          serve, ou o banco deste ambiente não tem onde guardar — e a frase do
          servidor sozinha não os distingue. `ApiErrorNotice` pergunta ao
          /healthz e escreve a diferença.
        */}
        {erroUpload != null && (
          <ApiErrorNotice
            error={erroUpload}
            what="O export de chamados não pôde ser enviado."
          />
        )}

        {query.error && (
          <ApiErrorNotice
            error={query.error}
            what="Os chamados não puderam ser carregados."
          />
        )}

        {totals && (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              tone="blue"
              icon={<SlidersHorizontal className="w-6 h-6" />}
              label="Parâmetros alterados"
              value={totals.changes.toLocaleString("pt-BR")}
              hint={`em ${totals.tickets.toLocaleString("pt-BR")} chamado${totals.tickets === 1 ? "" : "s"}`}
            />
            <MetricCard
              tone="green"
              icon={<Folder className="w-6 h-6" />}
              label="Em aberto"
              value={totals.stillOpen.toLocaleString("pt-BR")}
              hint="chamados sem data de fechamento"
              valueTone={totals.stillOpen > 0 ? "warn" : "muted"}
            />
            <MetricCard
              tone="orange"
              icon={<Zap className="w-6 h-6" />}
              label="Com impacto"
              value={totals.calculated.toLocaleString("pt-BR")}
              hint={`${totals.notCalculable.toLocaleString("pt-BR")} sem impacto apurado`}
              valueTone={tomDoDinheiro}
            />
            {/*
              Impacto dos chamados — uma soma só, e por que ela é diferente da
              outra. Aqui não há periodicidade a separar: `aplicado − pedido` é
              uma diferença entre duas quantias declaradas na mesma unidade pelo
              próprio arquivo. É por isso que este número **não** entra no
              cartão da aba Planilha: lá a régua é outra.
            */}
            <MetricCard
              tone="red"
              icon={<TrendingDown className="w-6 h-6" />}
              label="Impacto"
              value={
                totals.calculated === 0
                  ? "não calculável"
                  : `${totals.impactSum > 0 ? "+" : ""}${brl0(totals.impactSum)}`
              }
              hint={`${totals.notCalculable.toLocaleString("pt-BR")} alterações fora desta soma`}
              valueTone={totals.calculated === 0 ? "muted" : tomDoDinheiro}
            />
            <MetricCard
              tone="purple"
              icon={<Clock className="w-6 h-6" />}
              label="TMA"
              value={
                totals.averageDaysToClose === null
                  ? "—"
                  : `${totals.averageDaysToClose} d`
              }
              hint={
                totals.averageDaysToClose === null
                  ? "sem chamado fechado com as duas datas"
                  : "tempo médio, só os que já fecharam"
              }
            />
          </div>
        )}

        {/* Os avisos do arquivo, em uma linha cada: o tamanho do problema à
            vista, e o detalhe atrás de um clique. Nenhum deles some quando é
            inconveniente — some quando não existe. */}
        {/* O cartão também aparece sem aviso nenhum quando alguém pede o
            mapeamento de colunas pelo botão do topo: o painel aberto precisa de
            onde morar, e um arquivo perfeito não tem faixa vermelha. */}
        {(temAviso || painel !== null) && (
          <Card className="rounded-2xl p-5 space-y-4">
            <div className={cn("gap-4 md:grid-cols-2", temAviso ? "grid" : "hidden")}>
              {falhas.length > 0 && (
                <Aviso
                  tone="red"
                  titulo={`${falhas.length} arquivo${falhas.length === 1 ? "" : "s"} com problema`}
                  detalhe={falhas[0].failureReason ?? "O arquivo não pôde ser lido."}
                  acao="Revisar"
                  aberto={painel === "falhas"}
                  onClick={() => abrirPainel("falhas")}
                />
              )}
              {naoMapeadas.length > 0 && (
                <Aviso
                  tone="amber"
                  icone={<Columns3 className="w-6 h-6" />}
                  titulo={`${naoMapeadas.length} colunas não mapeadas`}
                  detalhe="Dados preservados no arquivo original"
                  acao="Ver detalhes"
                  aberto={painel === "colunas"}
                  onClick={() => abrirPainel("colunas")}
                />
              )}
              {ignoradas > 0 && run && (
                <Aviso
                  tone="amber"
                  titulo={`${ignoradas.toLocaleString("pt-BR")} linhas fora da leitura`}
                  detalhe="Sem número de chamado — e a conta fecha"
                  acao="Ver detalhes"
                  aberto={painel === "ignoradas"}
                  onClick={() => abrirPainel("ignoradas")}
                />
              )}
              {emLeitura.length > 0 && (
                <Aviso
                  tone="sky"
                  icone={<Loader2 className="w-6 h-6 animate-spin" />}
                  titulo={`${emLeitura.length} envio${emLeitura.length === 1 ? "" : "s"} em leitura`}
                  detalhe={emLeitura.map((i) => i.filename).join(", ")}
                />
              )}
            </div>

            {painel === "falhas" && (
              <div className="rounded-xl border bg-muted/30 p-4 space-y-2 text-sm">
                {falhas.map((i) => (
                  <div key={i.id} className="flex flex-wrap gap-x-2">
                    <span className="font-mono font-medium">{i.filename}</span>
                    <span className="text-muted-foreground">
                      · {new Date(i.receivedAt).toLocaleDateString("pt-BR")}
                      {i.receivedBy && ` · ${i.receivedBy}`}
                    </span>
                    <p className="w-full text-muted-foreground">
                      {i.failureReason ?? "Sem motivo registrado."}
                    </p>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  Nada deste envio foi gravado — o arquivo continua inteiro onde
                  estava, e reenviá-lo corrigido não duplica nada.
                </p>
              </div>
            )}

            {painel === "colunas" && run && (
              <div className="rounded-xl border bg-muted/30 p-4 space-y-4 text-sm">
                {naoMapeadas.length > 0 && (
                  <div>
                    <div className="font-medium">
                      {naoMapeadas.length} colunas do arquivo não têm campo
                      correspondente aqui
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {naoMapeadas.map((coluna) => (
                        <span
                          key={coluna}
                          className="rounded border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
                        >
                          {coluna}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Elas continuam inteiras na linha de origem — abra qualquer
                      chamado para vê-las.
                    </p>
                  </div>
                )}

                {/* A conta que protege o modo de falha desta leitura: um
                    mapeamento errado não estoura, só produz menos alterações —
                    e "menos" é indistinguível de "o chamado mexeu em pouca
                    coisa" a olho nu. */}
                {run.parameterColumns.length > 0 && totals && (
                  <div>
                    <div className="font-medium">
                      {run.parameterColumns.length} colunas de parâmetro
                      reconhecidas, com {totals.changes.toLocaleString("pt-BR")}{" "}
                      células preenchidas em{" "}
                      {totals.tickets.toLocaleString("pt-BR")} chamados
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {run.parameterColumns.map((coluna) => (
                        <span
                          key={coluna}
                          className="rounded border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
                        >
                          {coluna}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Uma célula vazia quer dizer que aquele chamado não mexeu
                      naquele parâmetro — é o normal, e por isso nenhuma
                      alteração é criada para ela. As colunas com{" "}
                      <span className="font-mono">↔</span> são pares
                      antes/depois que o próprio arquivo trouxe.
                    </p>
                  </div>
                )}

                {Object.keys(run.columnMapping).length > 0 && (
                  <div>
                    <div className="font-medium">
                      De que coluna do arquivo saiu cada campo
                    </div>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
                      {Object.entries(run.columnMapping).map(([campo, ligacao]) => (
                        <div key={campo} className="flex items-baseline gap-2 min-w-0">
                          <span className="text-muted-foreground shrink-0">
                            {NOMES_DE_CAMPO[campo] ?? campo}:
                          </span>
                          <span className="font-mono text-xs truncate">
                            {ligacao.header}
                          </span>
                          {ligacao.match === "aproximado" && (
                            <span
                              className="text-xs text-amber-700 shrink-0"
                              title={ligacao.reason}
                            >
                              por aproximação
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {painel === "ignoradas" && run && (
              <div className="rounded-xl border bg-muted/30 p-4 text-sm">
                O arquivo trazia{" "}
                <strong>{run.rowCount.toLocaleString("pt-BR")}</strong> linhas de
                dados;{" "}
                <strong>{run.ticketCount.toLocaleString("pt-BR")}</strong>{" "}
                viraram chamado e{" "}
                <strong>{run.ignoredRowCount.toLocaleString("pt-BR")}</strong>{" "}
                ficaram de fora por não terem número de chamado. A conta fecha, e
                nada foi descartado em silêncio.
              </div>
            )}
          </Card>
        )}

        {!run && !query.isLoading && (
          <Card className="rounded-2xl">
            <CardContent className="p-10 text-center space-y-3">
              <Headset className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                Esta aba mostra o que foi pedido pelo Freightech e o que voltou
                aplicado. Ela vive de um export da fila de chamados —{" "}
                <strong>.xlsx</strong> ou <strong>.csv</strong> — e o único
                requisito é ter uma coluna que identifique o chamado
                (&quot;Chamado&quot;, &quot;Nº do chamado&quot;,
                &quot;Protocolo&quot;). As demais colunas são reconhecidas pelo
                nome, e o que não for reconhecido aparece listado em vez de
                sumir.
              </p>
              <Button onClick={escolherArquivo} disabled={upload.isPending}>
                <Upload className="w-4 h-4 mr-1.5" />
                {upload.isPending ? "Enviando…" : "Importar export de chamados"}
              </Button>
            </CardContent>
          </Card>
        )}

        {run && (
          <Card className="rounded-2xl p-4 space-y-4">
            <TicketQuickFilters
              filters={filters}
              onChange={setFilters}
              totals={totals ?? undefined}
              avancadoAberto={filtrosAbertos}
              onToggleAvancado={() => setFiltrosAbertos((v) => !v)}
            />
            {filtrosAbertos && (
              <TicketFilterBar
                filters={filters}
                onChange={setFilters}
                totals={totals ?? undefined}
              />
            )}
          </Card>
        )}

        {data && data.byParameter.length > 0 && (
          <Card className="rounded-2xl">
            <div className="grid md:grid-cols-2 md:divide-x">
              <ParametrosMaisPedidos
                itens={data.byParameter}
                selecionado={filters.parameterLabel}
                onSelecionar={(parameterLabel) =>
                  setFilters({
                    ...filters,
                    parameterLabel:
                      filters.parameterLabel === parameterLabel ? "" : parameterLabel,
                  })
                }
              />
              <ImpactosRelevantes
                itens={data.byParameter}
                selecionado={filters.parameterLabel}
                naoApuradas={totals?.notCalculable ?? 0}
                onSelecionar={(parameterLabel) =>
                  setFilters({
                    ...filters,
                    parameterLabel:
                      filters.parameterLabel === parameterLabel ? "" : parameterLabel,
                  })
                }
              />
            </div>
          </Card>
        )}

        {run && (
          <Card className="rounded-2xl overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 border-b">
              <CardTitle className="text-sm font-semibold">
                {data
                  ? `${data.total.toLocaleString("pt-BR")} alterações de chamado`
                  : "Alterações de chamado"}
              </CardTitle>
              <p
                className="text-xs text-muted-foreground"
                title="Um chamado que altera oito parâmetros aparece em oito linhas. Nada é omitido por ser pequeno."
              >
                Uma linha por parâmetro que um chamado mexeu · sem ordenação
                pedida, vêm por materialidade
              </p>
            </div>
            {query.isLoading && (
              <p className="p-6 text-sm text-muted-foreground">Lendo…</p>
            )}
            {data && <TicketChangeTable rows={data.rows} total={data.total} />}
          </Card>
        )}
      </div>
    </>
  );
}

/** Reais sem centavos — a régua dos cartões, onde o centavo não decide nada. */
const brl0 = (valor: number) =>
  valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

const LADRILHO: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600",
  green: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600",
  red: "bg-red-50 text-red-600",
  purple: "bg-violet-50 text-violet-600",
};

/**
 * Um número do topo: o ícone que o identifica, o nome, o valor, e a ressalva.
 *
 * A ressalva é a linha pequena, e ela não é enfeite: um total de impacto sem
 * "quantas alterações ficaram de fora desta soma" é um número que parece cobrir
 * o arquivo inteiro quando cobre uma parte dele. Toda soma desta tela carrega o
 * seu complemento junto.
 */
function MetricCard({
  icon,
  tone,
  label,
  value,
  hint,
  valueTone = "muted",
}: {
  icon: React.ReactNode;
  tone: keyof typeof LADRILHO;
  label: string;
  value: string;
  hint?: string;
  valueTone?: "good" | "bad" | "warn" | "muted";
}) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm px-5 py-5 flex items-center gap-4">
      <div
        className={cn(
          "h-14 w-14 rounded-2xl grid place-content-center shrink-0",
          LADRILHO[tone],
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        <div
          className={cn(
            "text-3xl font-bold tracking-tight tabular-nums mt-1 truncate",
            valueTone === "good" && "text-emerald-700",
            valueTone === "bad" && "text-red-600",
            valueTone === "warn" && "text-amber-600",
          )}
        >
          {value}
        </div>
        {hint && (
          <div className="text-xs text-muted-foreground mt-1">{hint}</div>
        )}
      </div>
    </div>
  );
}

const AVISO: Record<string, { caixa: string; bolha: string; titulo: string }> = {
  red: {
    caixa: "border-red-100 bg-red-50",
    bolha: "bg-red-600 text-white",
    titulo: "text-red-600",
  },
  amber: {
    caixa: "border-amber-100 bg-amber-50",
    bolha: "bg-amber-500 text-white",
    titulo: "text-amber-700",
  },
  sky: {
    caixa: "border-sky-100 bg-sky-50",
    bolha: "bg-sky-500 text-white",
    titulo: "text-sky-700",
  },
};

/** Um problema do arquivo em uma linha: o quê, o quanto, e por onde ver. */
function Aviso({
  tone,
  icone,
  titulo,
  detalhe,
  acao,
  aberto,
  onClick,
}: {
  tone: keyof typeof AVISO;
  icone?: React.ReactNode;
  titulo: string;
  detalhe: string;
  acao?: string;
  aberto?: boolean;
  onClick?: () => void;
}) {
  const estilo = AVISO[tone];
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-xl border px-5 py-4",
        estilo.caixa,
      )}
    >
      <div
        className={cn(
          "h-12 w-12 rounded-full grid place-content-center shrink-0",
          estilo.bolha,
        )}
      >
        {icone ?? <AlertTriangle className="w-6 h-6" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("font-bold", estilo.titulo)}>{titulo}</div>
        <div className="text-sm text-muted-foreground line-clamp-1" title={detalhe}>
          {detalhe}
        </div>
      </div>
      {acao && onClick && (
        <button
          onClick={onClick}
          aria-expanded={aberto}
          className={cn(
            "inline-flex items-center gap-1 text-sm font-medium shrink-0 hover:underline",
            estilo.titulo,
          )}
        >
          {acao}
          <ChevronRight
            className={cn("w-4 h-4 transition-transform", aberto && "rotate-90")}
          />
        </button>
      )}
    </div>
  );
}

function TituloDePainel({
  icone,
  children,
}: {
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl bg-blue-50 text-blue-600 grid place-content-center shrink-0">
        {icone}
      </div>
      <h3 className="text-lg font-bold tracking-tight">{children}</h3>
    </div>
  );
}

type ParametroRollup = {
  parameterLabel: string;
  attributeCode: string | null;
  count: number;
  impactSum: number | null;
};

/**
 * Onde os chamados se concentram.
 *
 * Contagem, e só contagem: é a pergunta "o que mais se pede", que não tem nada
 * a ver com "o que mais custa" — o painel ao lado responde essa, e os dois
 * quase nunca têm o mesmo primeiro colocado.
 */
function ParametrosMaisPedidos({
  itens,
  selecionado,
  onSelecionar,
}: {
  itens: ParametroRollup[];
  selecionado: string;
  onSelecionar: (parameterLabel: string) => void;
}) {
  const topo = itens.slice(0, 5);
  return (
    <div className="p-6">
      <TituloDePainel icone={<BarChart3 className="w-5 h-5" />}>
        Parâmetros mais pedidos
      </TituloDePainel>

      <div className="mt-4">
        {topo.map((p, i) => (
          <button
            key={`${p.parameterLabel}-${p.attributeCode}`}
            onClick={() => onSelecionar(p.parameterLabel)}
            title={`filtrar a lista por ${p.parameterLabel}`}
            className={cn(
              "w-full flex items-center gap-4 px-2 py-3 text-left border-b last:border-b-0 rounded-md transition-colors",
              selecionado === p.parameterLabel
                ? "bg-blue-50 text-blue-800"
                : "hover:bg-muted/50",
            )}
          >
            <span className="w-4 shrink-0 text-blue-600 font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 truncate">{p.parameterLabel}</span>
            <span className="font-bold tabular-nums shrink-0">
              {p.count.toLocaleString("pt-BR")}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Um parâmetro que aparece aqui <em>e</em> na aba Planilha é a mesma
        história contada dos dois lados.
      </p>
    </div>
  );
}

/**
 * O que os chamados custaram, por parâmetro.
 *
 * Só entra aqui o que tem impacto apurado — e a linha do rodapé diz quantas
 * alterações ficaram de fora por não terem. Uma lista de "impactos relevantes"
 * que cala o tamanho do que não sabe medir é a que faz alguém concluir que o
 * resto é zero.
 */
function ImpactosRelevantes({
  itens,
  selecionado,
  naoApuradas,
  onSelecionar,
}: {
  itens: ParametroRollup[];
  selecionado: string;
  naoApuradas: number;
  onSelecionar: (parameterLabel: string) => void;
}) {
  const comImpacto = itens
    .filter((p) => p.impactSum !== null && p.impactSum !== 0)
    .sort((a, b) => Math.abs(b.impactSum ?? 0) - Math.abs(a.impactSum ?? 0))
    .slice(0, 5);

  return (
    <div className="p-6">
      <TituloDePainel icone={<DollarSign className="w-5 h-5" />}>
        Impactos relevantes
      </TituloDePainel>

      {comImpacto.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nenhum parâmetro deste envio tem impacto apurado. Não quer dizer que
          os chamados não custaram nada — quer dizer que o valor pedido e o
          aplicado não permitiram apurar a diferença.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {comImpacto.map((p) => {
            const soma = p.impactSum ?? 0;
            const perda = soma < 0;
            return (
              <button
                key={`${p.parameterLabel}-${p.attributeCode}`}
                onClick={() => onSelecionar(p.parameterLabel)}
                title={`filtrar a lista por ${p.parameterLabel}`}
                className={cn(
                  "w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
                  perda ? "bg-red-50 hover:bg-red-100" : "bg-emerald-50 hover:bg-emerald-100",
                  selecionado === p.parameterLabel &&
                    (perda ? "ring-1 ring-red-300" : "ring-1 ring-emerald-300"),
                )}
              >
                <span
                  className={cn(
                    "h-8 w-8 rounded-full grid place-content-center shrink-0 bg-card border",
                    perda ? "text-red-600 border-red-200" : "text-emerald-600 border-emerald-200",
                  )}
                >
                  {perda ? (
                    <ArrowDown className="w-4 h-4" />
                  ) : (
                    <ArrowUp className="w-4 h-4" />
                  )}
                </span>
                <span className="flex-1 truncate">{p.parameterLabel}</span>
                <span
                  className={cn(
                    "font-bold tabular-nums shrink-0",
                    perda ? "text-red-600" : "text-emerald-700",
                  )}
                >
                  {soma > 0 ? "+" : ""}
                  {brl0(soma)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {naoApuradas > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {naoApuradas.toLocaleString("pt-BR")} alterações não têm impacto
          apurado e não entram nesta lista.
        </p>
      )}
    </div>
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
