import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Columns3,
  FileSpreadsheet,
  Headset,
  Lock,
  Upload,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson, getApiUrl, readJson } from "@/lib/api";
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
  const [filters, setFilters] = useState<Filters>(emptyFilters);
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
          <Card>
            <CardContent className="p-6 text-sm text-red-800">
              {(error as Error).message}
            </CardContent>
          </Card>
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
function AbaChamados() {
  const [filters, setFilters] = useState<TicketFilterState>(emptyTicketFilters);
  const [envio, setEnvio] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
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
      if (!response.ok) throw new Error(`${file.name}: ${body.error}`);
      return body.ticketImportId as string;
    },
    onSuccess: () => {
      setErro(null);
      // A leitura roda fora da requisição, então o resultado ainda não está
      // pronto quando isto volta. Recarregar já mostra o envio em leitura, e o
      // `refetchInterval` abaixo cuida do resto.
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (err: Error) => setErro(err.message),
  });

  const data = query.data;
  const run = data?.import ?? null;
  const totals = data?.totals ?? null;

  const escolherArquivo = () => fileInput.current?.click();

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

      <header className="border-b bg-card px-8 py-6">
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

        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
            <Tile
              label="Parâmetros alterados"
              value={totals.changes}
              hint={`em ${totals.tickets} chamado${totals.tickets === 1 ? "" : "s"}`}
            />
            <Tile
              label="Chamados em aberto"
              value={totals.stillOpen}
              tone={totals.stillOpen > 0 ? "warn" : "muted"}
            />
            <Tile
              label="Alterações que variaram"
              value={totals.divergent}
              hint="agora diferente de antes"
              tone={totals.divergent > 0 ? "bad" : "muted"}
            />
            <TicketImpactTile totals={totals} />
            <Tile
              label="Tempo médio de atendimento"
              value={
                totals.averageDaysToClose === null
                  ? "—"
                  : `${totals.averageDaysToClose} d`
              }
              hint={
                totals.averageDaysToClose === null
                  ? "sem chamado fechado com as duas datas"
                  : "só os que já fecharam"
              }
            />
          </div>
        )}
      </header>

      <div className="p-8 space-y-6">
        {erro && (
          <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-md px-4 py-3">
            {erro}
          </p>
        )}

        {query.error && (
          <Card>
            <CardContent className="p-6 text-sm text-red-800">
              {(query.error as Error).message}
            </CardContent>
          </Card>
        )}

        {/* Envios que falharam ou estão em leitura: quem mandou o arquivo
            precisa ver o que aconteceu com ele sem trocar de tela. */}
        {data?.imports
          .filter((i) => i.status === "FAILED" || i.status === "READING" || i.status === "PENDING")
          .slice(0, 3)
          .map((i) => (
            <div
              key={i.id}
              className={cn(
                "flex gap-3 rounded-md border px-4 py-3 text-sm",
                i.status === "FAILED"
                  ? "border-red-300 bg-red-50 text-red-900"
                  : "border-sky-300 bg-sky-50 text-sky-900",
              )}
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>
                <strong className="font-mono">{i.filename}</strong>{" "}
                {i.status === "FAILED" ? (
                  <>não pôde ser lido. {i.failureReason}</>
                ) : (
                  <>está sendo lido agora.</>
                )}
              </p>
            </div>
          ))}

        {!run && !query.isLoading && (
          <Card>
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

        {run && run.ignoredRowCount > 0 && (
          <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              O arquivo trazia <strong>{run.rowCount}</strong> linhas de dados;{" "}
              <strong>{run.ticketCount}</strong> viraram chamado e{" "}
              <strong>{run.ignoredRowCount}</strong> ficaram de fora por não
              terem número de chamado. A conta fecha, e nada foi descartado em
              silêncio.
            </p>
          </div>
        )}

        {/* A conta que protege o modo de falha desta leitura: um mapeamento
            errado não estoura, só produz menos alterações — e "menos" é
            indistinguível de "o chamado mexeu em pouca coisa" a olho nu. */}
        {run && run.parameterColumns.length > 0 && totals && (
          <details className="rounded-md border bg-card px-4 py-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              <span className="text-foreground font-medium">
                {run.parameterColumns.length} colunas de parâmetro
              </span>{" "}
              reconhecidas no arquivo, com {totals.changes} células preenchidas
              em {totals.tickets} chamados
            </summary>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {run.parameterColumns.map((coluna) => (
                <span
                  key={coluna}
                  className="rounded border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
                >
                  {coluna}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Uma célula vazia quer dizer que aquele chamado não mexeu naquele
              parâmetro — é o normal, e por isso nenhuma alteração é criada para
              ela. As colunas com <span className="font-mono">↔</span> são pares
              antes/depois que o próprio arquivo trouxe.
            </p>
          </details>
        )}

        {run && run.unmappedColumns.length > 0 && (
          <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Columns3 className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              <strong>{run.unmappedColumns.length}</strong> colunas do arquivo
              não têm campo correspondente aqui:{" "}
              <span className="font-mono text-xs">
                {run.unmappedColumns.join(", ")}
              </span>
              . Elas continuam inteiras na linha de origem — abra qualquer
              chamado para vê-las.
            </p>
          </div>
        )}

        {run && Object.keys(run.columnMapping).length > 0 && (
          <details className="rounded-md border bg-card px-4 py-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">
              De que coluna do arquivo saiu cada campo
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
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
          </details>
        )}

        {run && <TicketFilterBar filters={filters} onChange={setFilters} totals={totals ?? undefined} />}

        {data && data.byParameter.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Parâmetros mais pedidos</CardTitle>
              <p className="text-xs text-muted-foreground">
                Onde os chamados se concentram. Um parâmetro que aparece aqui{" "}
                <em>e</em> na aba Planilha é a mesma história contada dos dois
                lados.
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {data.byParameter.map((p) => (
                <button
                  key={`${p.parameterLabel}-${p.attributeCode}`}
                  onClick={() =>
                    setFilters({
                      ...filters,
                      parameterLabel:
                        filters.parameterLabel === p.parameterLabel
                          ? ""
                          : p.parameterLabel,
                    })
                  }
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs transition-colors",
                    filters.parameterLabel === p.parameterLabel
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted",
                  )}
                >
                  <span className="font-medium">{p.parameterLabel}</span>
                  <span className="ml-1.5 tabular-nums opacity-70">
                    {p.count}
                  </span>
                  {p.impactSum !== null && p.impactSum !== 0 && (
                    <span
                      className={cn(
                        "ml-1.5 tabular-nums font-mono",
                        filters.parameterLabel === p.parameterLabel
                          ? ""
                          : p.impactSum < 0
                            ? "text-red-700"
                            : "text-emerald-700",
                      )}
                    >
                      {p.impactSum > 0 ? "+" : ""}
                      {p.impactSum.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                        maximumFractionDigits: 0,
                      })}
                    </span>
                  )}
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {run && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {data ? `${data.total} alterações de chamado` : "Alterações de chamado"}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Uma linha por parâmetro que um chamado mexeu — um chamado que
                altera oito parâmetros aparece em oito linhas. Ordenadas por
                materialidade: primeiro o que tem impacto apurado, depois pelo
                tamanho da variação. Nada é omitido por ser pequeno.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {query.isLoading && (
                <p className="p-6 text-sm text-muted-foreground">Lendo…</p>
              )}
              {data && (
                <TicketChangeTable rows={data.rows} total={data.total} />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

/**
 * Impacto dos chamados — uma soma só, e por que ela é diferente da outra.
 *
 * Aqui não há periodicidade a separar: `aplicado − pedido` é uma diferença
 * entre duas quantias declaradas na mesma unidade pelo próprio arquivo. É
 * exatamente por isso que este número **não** entra no cartão da aba Planilha:
 * lá a régua é outra, e as duas somas medem coisas diferentes.
 */
function TicketImpactTile({ totals }: { totals: TicketTotals }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">
        Impacto apurado
      </div>
      {totals.calculated === 0 ? (
        <div className="text-xl font-bold tabular-nums mt-1 text-muted-foreground">
          não calculável
        </div>
      ) : (
        <div
          className={cn(
            "text-xl font-bold tabular-nums mt-1",
            totals.impactSum < 0
              ? "text-red-700"
              : totals.impactSum > 0
                ? "text-emerald-700"
                : "",
          )}
        >
          {totals.impactSum > 0 ? "+" : ""}
          {totals.impactSum.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
            maximumFractionDigits: 0,
          })}
        </div>
      )}
      <div className="text-xs text-muted-foreground mt-0.5">
        {totals.notCalculable} alterações fora deste valor
      </div>
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
