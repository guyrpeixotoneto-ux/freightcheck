import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileDown,
  FileSpreadsheet,
  Layers,
  ShieldCheck,
  Table2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout/layout";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { fetchJson, getApiUrl, readJson } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Importações — o histórico do que entrou.
 *
 * Os números vêm do que cada execução de fato produziu, gravados pelo pipeline
 * enquanto rodava. O SHA-256 fica à vista porque é ele que transforma "esse
 * arquivo já entrou" em fato verificável, e não em opinião.
 */

interface ImportRun {
  importRunId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  triggeredBy: string | null;
  failureReason: string | null;
  filename: string;
  byteSize: number;
  contentSha256: string;
  receivedAt: string;
  sheets: number;
  rawRows: number;
  rawCells: number;
  stagedFacts: number;
  snapshots: number;
  errors: number;
  warnings: number;
  labels: string[];
}

interface RunDetail {
  sheets: {
    sheetName: string;
    role: string;
    roleReason: string | null;
    rowCount: number;
    columnCount: number;
    headerRowIndex: number | null;
  }[];
}

const n = (v: number) => v.toLocaleString("pt-BR");

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-BR");

/** "1 aba", "2 abas" — o número é lido junto com a palavra, e concordam. */
const plural = (count: number, one: string, many: string) =>
  `${n(count)} ${count === 1 ? one : many}`;

interface RunStatus {
  importRunId: string;
  status: string;
  filename: string;
  failureReason: string | null;
  sheets: number;
  rawCells: number;
  facts: number;
  snapshots: number;
  errors: number;
  warnings: number;
  labels: string[];
}

/**
 * Read a response without assuming it is JSON.
 *
 * A proxy that times out, or any layer between the browser and the API,
 * answers with an empty body or an HTML error page. Calling `.json()` on that
 * throws "Unexpected end of JSON input", which tells the person nothing about
 * what went wrong. Reading the text first turns that into a message that at
 * least names the status.
 */
export default function Importacoes() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailOf, setDetailOf] = useState<ImportRun | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const {
    data: runs = [],
    isLoading,
    error: listError,
  } = useQuery({
    queryKey: ["imports"],
    // `.json()` direto transformava a API fora do ar em lista vazia, e a tela
    // dizia "nenhuma importação ainda" — a mesma frase de um banco limpo. A
    // ausência de resposta passava por ausência de dados. `fetchJson` é essa
    // checagem, agora feita por toda a interface.
    queryFn: () => fetchJson<ImportRun[]>("/imports"),
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const ids: string[] = [];
      for (const file of files) {
        // base64 dentro de JSON: é a requisição mais banal da web, e nenhum
        // proxy recusa. O envio binário cru dava 502 sem chegar ao servidor.
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        const CHUNK = 32768;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const response = await fetch(getApiUrl("/imports"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentBase64: btoa(binary),
          }),
        });
        const body = await readJson(response);
        if (!response.ok) throw new Error(`${file.name}: ${body.error}`);
        ids.push(body.importRunId as string);
      }
      return ids;
    },
    onSuccess: (ids) => {
      setError(null);
      setPendingIds((current) => [...current, ...ids]);
    },
    onError: (err: Error) => {
      setError(err.message);
      // Uma duplicata recusada também vira um import_run. A tentativa é um
      // evento que vale registrar, então a lista é recarregada para mostrá-la
      // sem depender de o operador dar reload.
      queryClient.invalidateQueries({ queryKey: ["imports"] });
    },
  });

  const promote = useMutation({
    mutationFn: async (importRunId: string) => {
      const response = await fetch(getApiUrl(`/imports/${importRunId}/promote`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error as string);
      return body;
    },
    onSuccess: (_result, importRunId) => {
      setError(null);
      setPendingIds((current) => current.filter((id) => id !== importRunId));
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <FileDown className="w-6 h-6 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">Importações</h1>
            <p className="text-muted-foreground mt-1 max-w-3xl leading-relaxed">
              Cada arquivo recebido, o que saiu dele e o que o pipeline apontou.
              <br className="hidden sm:inline" /> O mesmo conteúdo reentregue é
              reconhecido pelo SHA-256 e recusado como duplicata.
            </p>
          </div>
        </div>
      </header>

      <div className="p-8 space-y-5">
        <input
          ref={fileInput}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) upload.mutate(files);
            e.target.value = "";
          }}
        />
        <Dropzone
          busy={upload.isPending}
          onFiles={(files) => upload.mutate(files)}
          onPick={() => fileInput.current?.click()}
        />

        {error && (
          <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        {pendingIds.map((id) => (
          <PendingRun
            key={id}
            importRunId={id}
            onDiscard={() => setPendingIds((c) => c.filter((x) => x !== id))}
            onPromote={() => promote.mutate(id)}
            promoting={promote.isPending}
          />
        ))}

        {isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {!isLoading && listError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-sm text-red-900">
            Não foi possível ler o histórico de importações:{" "}
            {(listError as Error).message} Esta lista pode não estar vazia — o
            que falhou foi perguntar.
          </div>
        )}
        {/* "Nenhuma importação ainda" ao lado de um arquivo sendo lido é falso
            de um jeito que confunde: o que falta é aprovar, não enviar. */}
        {!isLoading && !listError && runs.length === 0 && pendingIds.length === 0 && (
          <div className="rounded-2xl border bg-card px-8 py-10 text-center text-sm text-muted-foreground shadow-sm">
            Nenhuma importação ainda. Use{" "}
            <strong className="text-foreground">Escolher planilhas</strong> acima
            para enviar o export do Freightec.
          </div>
        )}

        {runs.map((run) => (
          <RunCard
            key={run.importRunId}
            run={run}
            expanded={expanded === run.importRunId}
            onToggle={() =>
              setExpanded(expanded === run.importRunId ? null : run.importRunId)
            }
            onDetails={() => setDetailOf(run)}
          />
        ))}

        <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">Segurança e deduplicação</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Usamos SHA-256 para reconhecer arquivos já processados e evitar
              duplicidade.
            </p>
          </div>
        </div>
      </div>

      <RunDetailDialog run={detailOf} onClose={() => setDetailOf(null)} />
    </Layout>
  );
}

/**
 * The upload target: one dashed area that both clicks and receives a drop.
 *
 * The whole rectangle is the control, not a button inside it — the dashed edge
 * is a promise that dropping there works, and a decorative one would be a lie.
 */
function Dropzone({
  busy,
  onFiles,
  onPick,
}: {
  busy: boolean;
  onFiles: (files: File[]) => void;
  onPick: () => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onPick}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          f.name.toLowerCase().endsWith(".xlsx"),
        );
        if (files.length > 0) onFiles(files);
      }}
      className={cn(
        "w-full text-left rounded-2xl border-2 border-dashed px-6 py-5",
        "flex items-center gap-4 transition-colors",
        "disabled:cursor-progress",
        over
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-primary/[0.03]",
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Upload className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold">
          {busy ? "Lendo…" : "Escolher planilhas"}
        </p>
        <p className="text-sm text-muted-foreground">
          Pode enviar os dois de uma vez. O arquivo é lido e conferido, mas
          <strong className="text-foreground"> nada entra</strong> antes de você
          ver o resumo e aprovar.
        </p>
      </div>
    </button>
  );
}

function RunCard({
  run,
  expanded,
  onToggle,
  onDetails,
}: {
  run: ImportRun;
  expanded: boolean;
  onToggle: () => void;
  onDetails: () => void;
}) {
  return (
    <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">{run.filename}</h2>
            <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-[0.6875rem] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
                sha256
              </span>
              <span className="font-mono">
                {run.contentSha256.slice(0, 16)}…
              </span>
              <span aria-hidden>·</span>
              <span>{(run.byteSize / 1024).toFixed(0)} KB</span>
              <span aria-hidden>·</span>
              <span>{dateTime(run.receivedAt)}</span>
              {run.triggeredBy && (
                <>
                  <span aria-hidden>·</span>
                  <span>por {run.triggeredBy}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <StatusPill status={run.status} />
      </div>

      {run.failureReason && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {run.failureReason}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Metric icon={Table2} accent="indigo" label="Abas" value={n(run.sheets)} />
        <Metric
          icon={Database}
          accent="emerald"
          label="Células RAW"
          value={n(run.rawCells)}
        />
        <Metric
          icon={Layers}
          accent="blue"
          label="Fatos"
          value={n(run.stagedFacts)}
        />
        <Metric
          icon={CalendarClock}
          accent="violet"
          label="Vigências"
          value={n(run.snapshots)}
        />
        <Metric
          icon={ShieldCheck}
          accent="red"
          label="Erros"
          value={n(run.errors)}
          tone={run.errors > 0 ? "bad" : "muted"}
        />
        <Metric
          icon={AlertTriangle}
          accent="amber"
          label="Avisos"
          value={n(run.warnings)}
          tone={run.warnings > 0 ? "warn" : "muted"}
        />
      </div>

      {run.labels.length > 0 && (
        <div className="space-y-2">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Vigências ({run.labels.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {run.labels.map((label) => (
              <span
                key={label}
                className="font-mono text-[0.6875rem] px-2.5 py-1 rounded-lg border bg-muted/50 text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 pt-1">
        <button
          onClick={onToggle}
          className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 font-medium"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          Ver abas do arquivo e como cada uma foi tratada
        </button>
        <Button variant="outline" size="sm" onClick={onDetails}>
          Ver detalhes
          <ChevronRight className="w-3.5 h-3.5 ml-1" />
        </Button>
      </div>

      {expanded && <SheetList runId={run.importRunId} />}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium",
        status === "PROMOTED"
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : status === "FAILED"
            ? "bg-red-50 text-red-800 border-red-200"
            : "bg-amber-50 text-amber-800 border-amber-200",
      )}
    >
      {status.toLowerCase()}
    </span>
  );
}

/**
 * The whole record of one run, for when the summary is not enough.
 *
 * The SHA-256 appears here in full: truncated it identifies a file for a person
 * reading the list, but only the complete digest lets someone conferir contra o
 * arquivo que tem em mãos.
 */
function RunDetailDialog({
  run,
  onClose,
}: {
  run: ImportRun | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={run !== null} onOpenChange={(open) => !open && onClose()}>
      {run && (
        <>
          <DialogHeader>
            <DialogTitle>{run.filename}</DialogTitle>
            <DialogDescription>
              O registro completo desta execução, como o pipeline a gravou.
            </DialogDescription>
          </DialogHeader>

          <dl className="space-y-3 text-sm">
            <Field label="SHA-256">
              <span className="font-mono text-xs break-all">
                {run.contentSha256}
              </span>
            </Field>
            <Field label="Situação">{run.status.toLowerCase()}</Field>
            <Field label="Tamanho">{n(run.byteSize)} bytes</Field>
            <Field label="Recebido">{dateTime(run.receivedAt)}</Field>
            <Field label="Início">{dateTime(run.startedAt)}</Field>
            <Field label="Fim">
              {run.finishedAt ? dateTime(run.finishedAt) : "—"}
            </Field>
            <Field label="Enviado por">{run.triggeredBy ?? "—"}</Field>
            <Field label="Produziu">
              {plural(run.sheets, "aba", "abas")} ·{" "}
              {plural(run.rawRows, "linha", "linhas")} ·{" "}
              {plural(run.rawCells, "célula", "células")} ·{" "}
              {plural(run.stagedFacts, "fato", "fatos")} ·{" "}
              {plural(run.snapshots, "vigência", "vigências")}
            </Field>
            <Field label="Apontamentos">
              {plural(run.errors, "erro", "erros")} ·{" "}
              {plural(run.warnings, "aviso", "avisos")}
            </Field>
            {run.failureReason && (
              <Field label="Motivo da falha">
                <span className="text-red-800">{run.failureReason}</span>
              </Field>
            )}
          </dl>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Fechar
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3">
      <dt className="text-xs uppercase tracking-wider text-muted-foreground pt-0.5">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * One upload in flight: polls until the pipeline finishes reading it.
 *
 * The card shows what the run has produced so far, then the preview summary
 * and the approval button. Approving stays disabled while there are errors,
 * because an error is fixed at the source, not approved.
 */
function PendingRun({
  importRunId,
  onDiscard,
  onPromote,
  promoting,
}: {
  importRunId: string;
  onDiscard: () => void;
  onPromote: () => void;
  promoting: boolean;
}) {
  const { data } = useQuery({
    queryKey: ["imports", importRunId, "status"],
    queryFn: () => fetchJson<RunStatus>(`/imports/${importRunId}/status`),
    // Stops polling once the pipeline has finished or given up.
    refetchInterval: (query) => {
      const s = (query.state.data as RunStatus | undefined)?.status;
      return s === "PREVIEWED" || s === "FAILED" || s === "PROMOTED" ? false : 1200;
    },
  });

  const ready = data?.status === "PREVIEWED";
  const failed = data?.status === "FAILED";

  return (
    <div
      className={cn(
        "rounded-2xl border px-6 py-5 space-y-4",
        failed ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
              failed ? "bg-red-100" : "bg-amber-100",
            )}
          >
            {failed ? (
              <AlertTriangle className="w-5 h-5 text-red-700" />
            ) : ready ? (
              <CheckCircle2 className="w-5 h-5 text-amber-700" />
            ) : (
              <Upload className="w-5 h-5 text-amber-700" />
            )}
          </div>
          <div className="min-w-0">
            {/* O nome vem antes do estado: enviando dois arquivos de uma vez,
                dois cartões dizendo "Conferido" não dizem qual é qual. */}
            {data?.filename && (
              <p className="font-bold text-sm truncate">{data.filename}</p>
            )}
            <p className="font-semibold text-sm">
              {ready
                ? "Conferido, ainda não importado."
                : failed
                  ? "Falhou ao ler o arquivo."
                  : "Lendo o arquivo…"}
            </p>
            <p className="text-xs mt-0.5 text-amber-900">
              {failed ? (
                <span className="text-red-900">{data?.failureReason}</span>
              ) : ready ? (
                data!.errors > 0 ? (
                  <strong>
                    {data!.errors} erros — corrija a origem antes de aprovar.
                  </strong>
                ) : (
                  <>
                    {/* labels.length, não snapshots: o contador do run só é
                        preenchido na promoção, e antes dela seria sempre zero. */}
                    {n(data!.facts)} fatos · {data!.labels.length} vigências ·{" "}
                    {n(data!.warnings)} avisos, nenhum erro.
                  </>
                )
              ) : (
                <>
                  {data ? `${data.status.toLowerCase()}…` : "recebido…"} nada entra
                  sem sua aprovação.
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            descartar
          </Button>
          <Button
            size="sm"
            disabled={!ready || promoting || (data?.errors ?? 0) > 0}
            onClick={onPromote}
          >
            {promoting ? "Importando…" : "Aprovar e importar"}
          </Button>
        </div>
      </div>

      {ready && data!.labels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data!.labels.map((label) => (
            <span
              key={label}
              className="font-mono text-[0.6875rem] px-2.5 py-1 rounded-lg bg-white/70 border border-amber-200 text-amber-900"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SheetList({ runId }: { runId: string }) {
  const { data, error } = useQuery({
    queryKey: ["imports", runId],
    queryFn: () => fetchJson<RunDetail>(`/imports/${runId}`),
  });

  if (error) {
    return (
      <p className="text-xs text-red-700">
        As abas deste arquivo não puderam ser lidas: {error.message}
      </p>
    );
  }

  if (!data) return <p className="text-xs text-muted-foreground">Carregando…</p>;

  // Um run recusado como duplicata — ou que falhou antes da leitura — não tem
  // abas. Uma moldura vazia deixaria isso parecendo carregamento travado.
  if (data.sheets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nenhuma aba foi lida: este arquivo não chegou a ser aberto.
      </p>
    );
  }

  return (
    <div className="rounded-xl border divide-y overflow-hidden">
      {data.sheets.map((sheet) => (
        <div key={sheet.sheetName} className="px-4 py-3 text-sm bg-muted/30">
          <div className="flex items-center gap-2">
            {sheet.role === "SOURCE" ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )}
            <span className="font-mono text-xs">{sheet.sheetName}</span>
            <span className="text-xs text-muted-foreground">
              {sheet.rowCount} linhas · {sheet.columnCount} colunas
            </span>
          </div>
          {sheet.roleReason && (
            <p className="text-xs text-muted-foreground mt-1 ml-5.5 pl-0.5">
              {sheet.roleReason}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

const ACCENTS = {
  indigo: "bg-indigo-50 text-indigo-600",
  emerald: "bg-emerald-50 text-emerald-600",
  blue: "bg-blue-50 text-blue-600",
  violet: "bg-violet-50 text-violet-600",
  red: "bg-red-50 text-red-500",
  amber: "bg-amber-50 text-amber-600",
} as const;

/**
 * One produced quantity, as a tile.
 *
 * The icon is decoration; the number is the claim. Erros e Avisos só ganham cor
 * quando são maiores que zero — um zero pintado de vermelho vira alarme onde não
 * há nada a fazer.
 */
function Metric({
  icon: Icon,
  accent,
  label,
  value,
  tone = "muted",
}: {
  icon: typeof Table2;
  accent: keyof typeof ACCENTS;
  label: string;
  value: string;
  tone?: "bad" | "warn" | "muted";
}) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-3 flex items-center gap-3">
      <div
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
          ACCENTS[accent],
        )}
      >
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </div>
        <div
          className={cn(
            "text-lg font-bold tabular-nums leading-tight",
            tone === "bad" && "text-red-600",
            tone === "warn" && "text-orange-500",
          )}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
