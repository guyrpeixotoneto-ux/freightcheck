import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileDown,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout/layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiUrl } from "@/lib/api";
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

interface PreviewState {
  importRunId: string;
  filename: string;
  report: {
    totals: { errors: number; warnings: number; facts?: number };
    snapshots?: { sourceLabel: string; entityCount: number }[];
  };
}

export default function Importacoes() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState<PreviewState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["imports"],
    queryFn: async () =>
      (await (await fetch(getApiUrl("/imports"))).json()) as ImportRun[],
  });

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const results: PreviewState[] = [];
      for (const file of files) {
        const response = await fetch(getApiUrl("/imports"), {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "x-filename": encodeURIComponent(file.name),
          },
          body: await file.arrayBuffer(),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(`${file.name}: ${body.error}`);
        results.push(body as PreviewState);
      }
      return results;
    },
    onSuccess: (results) => {
      setError(null);
      setPending((current) => [...current, ...results]);
    },
    onError: (err: Error) => setError(err.message),
  });

  const promote = useMutation({
    mutationFn: async (importRunId: string) => {
      const response = await fetch(getApiUrl(`/imports/${importRunId}/promote`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      return body;
    },
    onSuccess: (_result, importRunId) => {
      setError(null);
      setPending((current) => current.filter((p) => p.importRunId !== importRunId));
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <FileDown className="w-6 h-6 text-primary" />
          Importações
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Cada arquivo recebido, o que saiu dele e o que o pipeline apontou. O
          mesmo conteúdo reentregue é reconhecido pelo SHA-256 e recusado como
          duplicata.
        </p>
      </header>

      <div className="p-8 space-y-4">
        <Card>
          <CardContent className="p-6 space-y-4">
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
            <div className="flex items-center gap-4">
              <Button
                onClick={() => fileInput.current?.click()}
                disabled={upload.isPending}
              >
                <Upload className="w-4 h-4 mr-2" />
                {upload.isPending ? "Lendo…" : "Escolher planilhas"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Pode enviar os dois de uma vez. O arquivo é lido e conferido, mas
                <strong> nada entra</strong> antes de você ver o resumo e aprovar.
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            {pending.map((p) => (
              <div
                key={p.importRunId}
                className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 space-y-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm">{p.filename}</p>
                    <p className="text-xs text-amber-900 mt-0.5">
                      Conferido, ainda não importado.{" "}
                      {p.report.totals.errors > 0 ? (
                        <strong>
                          {p.report.totals.errors} erros — corrija a origem antes de
                          aprovar.
                        </strong>
                      ) : (
                        <>
                          {p.report.totals.warnings} avisos, nenhum erro.
                          {p.report.snapshots &&
                            ` ${p.report.snapshots.length} vigências prontas.`}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPending((c) =>
                          c.filter((x) => x.importRunId !== p.importRunId),
                        )
                      }
                    >
                      descartar
                    </Button>
                    <Button
                      size="sm"
                      disabled={promote.isPending || p.report.totals.errors > 0}
                      onClick={() => promote.mutate(p.importRunId)}
                    >
                      {promote.isPending ? "Importando…" : "Aprovar e importar"}
                    </Button>
                  </div>
                </div>
                {p.report.snapshots && p.report.snapshots.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {p.report.snapshots.map((s) => (
                      <span
                        key={s.sourceLabel}
                        className="font-mono text-xs px-2 py-0.5 rounded bg-white/70 text-amber-900"
                      >
                        {s.sourceLabel} · {s.entityCount}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && runs.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground text-sm">
              Nenhuma importação ainda. Rode{" "}
              <code className="font-mono bg-muted px-1.5 py-0.5 rounded">
                pnpm run bootstrap
              </code>{" "}
              para carregar o export do Freightec.
            </CardContent>
          </Card>
        )}

        {runs.map((run) => (
          <Card key={run.importRunId}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle className="text-base truncate">{run.filename}</CardTitle>
                  <p className="font-mono text-xs text-muted-foreground mt-1">
                    sha256 {run.contentSha256.slice(0, 16)}… ·{" "}
                    {(run.byteSize / 1024).toFixed(0)} KB ·{" "}
                    {new Date(run.receivedAt).toLocaleString("pt-BR")}
                    {run.triggeredBy && <> · por {run.triggeredBy}</>}
                  </p>
                </div>
                <Badge
                  className={cn(
                    run.status === "PROMOTED"
                      ? "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                      : run.status === "FAILED"
                        ? "bg-red-100 text-red-900 border-red-300 hover:bg-red-100"
                        : "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100",
                  )}
                >
                  {run.status.toLowerCase()}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {run.failureReason && (
                <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {run.failureReason}
                </p>
              )}

              <div className="grid grid-cols-3 md:grid-cols-6 gap-4 text-sm">
                <Metric label="Abas" value={n(run.sheets)} />
                <Metric label="Células RAW" value={n(run.rawCells)} />
                <Metric label="Fatos" value={n(run.stagedFacts)} />
                <Metric label="Vigências" value={n(run.snapshots)} />
                <Metric
                  label="Erros"
                  value={n(run.errors)}
                  tone={run.errors > 0 ? "bad" : "good"}
                />
                <Metric
                  label="Avisos"
                  value={n(run.warnings)}
                  tone={run.warnings > 0 ? "warn" : "good"}
                />
              </div>

              {run.labels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {run.labels.map((label) => (
                    <span
                      key={label}
                      className="font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}

              <button
                onClick={() =>
                  setExpanded(expanded === run.importRunId ? null : run.importRunId)
                }
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                {expanded === run.importRunId ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                abas do arquivo e por que cada uma foi tratada assim
              </button>

              {expanded === run.importRunId && <SheetList runId={run.importRunId} />}
            </CardContent>
          </Card>
        ))}
      </div>
    </Layout>
  );
}

function SheetList({ runId }: { runId: string }) {
  const { data } = useQuery({
    queryKey: ["imports", runId],
    queryFn: async () =>
      (await (await fetch(getApiUrl(`/imports/${runId}`))).json()) as RunDetail,
  });

  if (!data) return <p className="text-xs text-muted-foreground">Carregando…</p>;

  return (
    <div className="rounded-md border divide-y">
      {data.sheets.map((sheet) => (
        <div key={sheet.sheetName} className="px-3 py-2 text-sm">
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
            <p className="text-xs text-muted-foreground mt-0.5 ml-5.5 pl-0.5">
              {sheet.roleReason}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn" | "muted";
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "font-medium tabular-nums",
          tone === "bad" && "text-red-700",
          tone === "warn" && "text-amber-700",
        )}
      >
        {value}
      </div>
    </div>
  );
}
