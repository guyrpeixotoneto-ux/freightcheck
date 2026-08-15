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
  Trash2,
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
import { erroDaResposta, fetchJson, getApiUrl, readJson } from "@/lib/api";
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
  /** Equipamentos que esta importação criaria e o dicionário não conhece. */
  pendingIdentities: string[];
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

/**
 * O que sairia do sistema se esta importação fosse excluída.
 *
 * Vem do servidor, e não de uma conta feita aqui: os mesmos números que a
 * exclusão vai executar. Uma tela que estimasse a consequência por conta
 * própria estaria adivinhando exatamente na hora em que não pode.
 */
interface DeletionPlan {
  importRunId: string;
  filename: string;
  contentSha256: string;
  status: string;
  labels: string[];
  /** Revisões anteriores que voltam a valer quando esta sair. */
  restoredLabels: string[];
  /** Por que não dá para excluir agora — null quando dá. */
  refusal: string | null;
  removes: {
    snapshots: number;
    facts: number;
    changeSets: number;
    changes: number;
    entities: number;
    attributes: number;
    attributeSemantics: number;
    rawCells: number;
    rawRows: number;
    rawSheets: number;
    stagedFacts: number;
    validationIssues: number;
    columnMappings: number;
    sourceFile: number;
  };
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
  /** Equipamentos que esta importação criaria e o dicionário não conhece. */
  pendingIdentities: string[];
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
  const [deleteOf, setDeleteOf] = useState<ImportRun | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
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

  /**
   * Uma importação esperando decisão continua esperando depois do F5.
   *
   * `pendingIds` só conhecia os envios feitos **nesta** aba: quem enviava a
   * planilha, recarregava a página e voltava depois não tinha mais botão de
   * aprovar em lugar nenhum. O arquivo ficava parado em PREVIEWED para sempre,
   * a API sabendo dele e a tela sem oferecer o passo que falta — e o cartão do
   * equipamento dizia "esperando aprovação" apontando para uma tela onde não
   * havia o que apertar.
   *
   * O estado de quem espera decisão é do servidor, então é dele que a lista
   * sai. Os ids da sessão continuam entrando porque um envio recém-feito ainda
   * não apareceu na listagem.
   */
  const ESPERANDO = new Set(["PENDING", "READING", "STAGED", "PREVIEWED", "PROMOTING"]);
  const esperandoDecisao = [
    ...new Set([
      ...pendingIds,
      ...runs.filter((r) => ESPERANDO.has(r.status)).map((r) => r.importRunId),
    ]),
  ];

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
        // Um `Error` de uma linha jogava fora o status, o `code` e o
        // diagnóstico — e com eles a diferença entre "este arquivo não serve" e
        // "este banco não tem onde guardar".
        if (!response.ok) throw erroDaResposta(response, body, file.name);
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
    mutationFn: async ({
      importRunId,
      confirmNewEntityTypes,
    }: {
      importRunId: string;
      confirmNewEntityTypes: string[];
    }) => {
      const response = await fetch(getApiUrl(`/imports/${importRunId}/promote`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmNewEntityTypes }),
      });
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body);
      return body;
    },
    onSuccess: (_result, { importRunId }) => {
      setError(null);
      setPendingIds((current) => current.filter((id) => id !== importRunId));
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => setError(err.message),
  });

  /**
   * Excluir apaga de verdade — e mexe em tudo o que lia aquela importação.
   *
   * Por isso o `invalidateQueries()` sem chave: as vigências somem de Dados, as
   * comparações de Alterações, os equipamentos do Início. Invalidar só a lista
   * de importações deixaria o resto da interface mostrando números que já não
   * existem, e essa é a tela onde isso menos pode acontecer.
   */
  const remove = useMutation({
    mutationFn: async ({
      importRunId,
      reason,
    }: {
      importRunId: string;
      reason: string;
    }) => {
      const response = await fetch(getApiUrl(`/imports/${importRunId}`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await readJson(response);
      if (!response.ok) throw erroDaResposta(response, body);
      return body as unknown as DeletionPlan;
    },
    onSuccess: (result) => {
      setError(null);
      setDeleteOf(null);
      setPendingIds((current) =>
        current.filter((id) => id !== result.importRunId),
      );
      setRemoved(
        `"${result.filename}" foi excluída: ${n(result.removes.facts)} fatos e ` +
          `${plural(result.removes.snapshots, "vigência", "vigências")} saíram do sistema.` +
          (result.removes.sourceFile > 0
            ? " Este arquivo pode ser enviado de novo."
            : ""),
      );
      queryClient.invalidateQueries();
    },
    onError: (err: Error) => {
      setRemoved(null);
      setError(err.message);
    },
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
              <br className="hidden sm:inline" /> O mesmo arquivo reentregue é
              reconhecido pelo SHA-256. O mesmo <em>dado</em>, num arquivo
              diferente, é reconhecido pela identidade da vigência — e nenhum dos
              dois entra duas vezes.
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

        {removed && (
          <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            {removed}
          </p>
        )}

        {esperandoDecisao.map((id) => (
          <PendingRun
            key={id}
            importRunId={id}
            onDiscard={() => setPendingIds((c) => c.filter((x) => x !== id))}
            onPromote={(confirmNewEntityTypes) =>
              promote.mutate({ importRunId: id, confirmNewEntityTypes })
            }
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
        {!isLoading && !listError && runs.length === 0 && esperandoDecisao.length === 0 && (
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
            onDelete={() => {
              setRemoved(null);
              setDeleteOf(run);
            }}
          />
        ))}

        <div className="rounded-2xl border bg-card px-6 py-5 shadow-sm flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-sm">Segurança e deduplicação</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Duas camadas. O SHA-256 reconhece o arquivo idêntico antes de
              lê-lo. A identidade canônica da vigência — unidade, canal, data e
              família, todas normalizadas — reconhece o mesmo dado ainda que o
              arquivo seja outro: rótulo escrito de outro jeito, CNPJ com ou sem
              máscara, placa com ou sem hífen, linhas ou abas em outra ordem. O
              banco garante uma única versão ativa por vigência.
            </p>
          </div>
        </div>
      </div>

      <RunDetailDialog run={detailOf} onClose={() => setDetailOf(null)} />
      <DeleteDialog
        /* Uma caixa por importação: o motivo digitado para uma não pode
           aparecer preenchido na próxima. */
        key={deleteOf?.importRunId ?? "nenhuma"}
        run={deleteOf}
        onClose={() => setDeleteOf(null)}
        onConfirm={(reason) =>
          deleteOf &&
          remove.mutate({ importRunId: deleteOf.importRunId, reason })
        }
        deleting={remove.isPending}
      />
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
  onDelete,
}: {
  run: ImportRun;
  expanded: boolean;
  onToggle: () => void;
  onDetails: () => void;
  onDelete: () => void;
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
        <p
          className={cn(
            "text-sm border rounded-xl px-4 py-3",
            TONS[estadoDaImportacao(run.status).tom],
          )}
        >
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
        <div className="flex items-center gap-2 shrink-0">
          {/*
            Excluir fica ao lado de "Ver detalhes", e não escondido atrás de um
            menu: é uma ação legítima — a planilha errada, o mês repetido — e
            esconder o desfazer é o que faz alguém conviver com o erro. O que a
            protege não é a dificuldade de achar o botão, e sim a tela seguinte,
            que diz quantos fatos e quais vigências saem antes de perguntar.
          */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-red-700 hover:text-red-800 hover:bg-red-50"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Excluir
          </Button>
          <Button variant="outline" size="sm" onClick={onDetails}>
            Ver detalhes
            <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </div>

      {expanded && <SheetList runId={run.importRunId} />}
    </div>
  );
}

/**
 * Como cada estado se chama e o que ele significa, para quem opera.
 *
 * "Duplicata" era uma palavra só, e ela escondia três situações que pedem
 * reações diferentes: o mesmo arquivo de novo (não faça nada), o mesmo dado num
 * arquivo diferente (não faça nada, e saiba que o número não vai mudar) e uma
 * vigência que já existe (decida se é correção). O estado do run distingue as
 * duas primeiras; a terceira chega como recusa da aprovação.
 */
const ESTADOS: Record<string, { rotulo: string; tom: "ok" | "erro" | "neutro" | "espera" }> = {
  PROMOTED: { rotulo: "aprovada", tom: "ok" },
  PREVIEWED: { rotulo: "conferida", tom: "espera" },
  PENDING: { rotulo: "na fila", tom: "espera" },
  READING: { rotulo: "lendo", tom: "espera" },
  STAGED: { rotulo: "preparada", tom: "espera" },
  PROMOTING: { rotulo: "aprovando", tom: "espera" },
  FAILED: { rotulo: "falhou", tom: "erro" },
  ABORTED: { rotulo: "abortada", tom: "erro" },
  VALIDATION_ERROR: { rotulo: "dado não fecha", tom: "erro" },
  SKIPPED_DUPLICATE: { rotulo: "arquivo já recebido", tom: "neutro" },
  SKIPPED_DUPLICATE_DATA: { rotulo: "dados já registrados", tom: "neutro" },
};

const TONS = {
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  erro: "bg-red-50 text-red-800 border-red-200",
  // Duplicata não é erro: é o sistema tendo feito o trabalho dele. Pintá-la de
  // vermelho ensina o operador a procurar culpa onde não há.
  neutro: "bg-slate-100 text-slate-700 border-slate-300",
  espera: "bg-amber-50 text-amber-800 border-amber-200",
} as const;

export function estadoDaImportacao(status: string) {
  return ESTADOS[status] ?? { rotulo: status.toLowerCase(), tom: "espera" as const };
}

function StatusPill({ status }: { status: string }) {
  const estado = estadoDaImportacao(status);
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs font-medium",
        TONS[estado.tom],
      )}
    >
      {estado.rotulo}
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

/**
 * A confirmação de uma exclusão, escrita com o que ela de fato apaga.
 *
 * "Tem certeza?" é uma pergunta que ninguém consegue responder: quem está aqui
 * não sabe de cabeça que aquele arquivo sustenta nove vigências e quarenta mil
 * fatos, nem que apagá-lo derruba as comparações que os usam. O servidor conta
 * isso antes — é a mesma conta que a exclusão vai executar —, e é essa lista
 * que vai para a tela. Só depois vem o botão vermelho.
 *
 * A caixa também é onde as recusas aparecem: uma vigência corrigida por uma
 * importação posterior não pode sair antes dela, e o motivo chega inteiro,
 * nomeando o arquivo mais novo em vez de dizer que não foi possível.
 */
function DeleteDialog({
  run,
  onClose,
  onConfirm,
  deleting,
}: {
  run: ImportRun | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  deleting: boolean;
}) {
  const [reason, setReason] = useState("");

  const { data: plan, error } = useQuery({
    queryKey: ["imports", run?.importRunId, "deletion"],
    queryFn: () => fetchJson<DeletionPlan>(`/imports/${run!.importRunId}/deletion`),
    enabled: run !== null,
    // O que sai depende do resto do banco — outra importação promovida no
    // meio-tempo muda a conta. Sem cache: esta prévia é lida uma vez e agida
    // em seguida.
    staleTime: 0,
    gcTime: 0,
  });

  const linhas: [string, number][] = plan
    ? [
        ["Fatos", plan.removes.facts],
        ["Vigências", plan.removes.snapshots],
        ["Comparações já calculadas", plan.removes.changeSets],
        ["Alterações dentro delas", plan.removes.changes],
        ["Equipamentos que ficam sem nenhum dado", plan.removes.entities],
        ["Colunas que ficam sem nenhum dado", plan.removes.attributes],
        ["Células RAW (a evidência do arquivo)", plan.removes.rawCells],
        ["Fatos em staging", plan.removes.stagedFacts],
        ["Apontamentos do pipeline", plan.removes.validationIssues],
      ].filter((linha): linha is [string, number] => (linha[1] as number) > 0)
    : [];

  return (
    <Dialog open={run !== null} onOpenChange={(open) => !open && onClose()}>
      {run && (
        <>
          <DialogHeader>
            <DialogTitle>Excluir "{run.filename}"?</DialogTitle>
            <DialogDescription>
              Isto apaga a importação e tudo o que só ela sustenta. Não há
              desfazer: fica o registro de que foi excluída — quem, quando e o
              que saiu —, não os dados.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              Não foi possível calcular o que sairia: {(error as Error).message}
            </p>
          )}

          {!plan && !error && (
            <p className="text-sm text-muted-foreground">
              Calculando o que sairia…
            </p>
          )}

          {plan?.refusal && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              {plan.refusal}
            </p>
          )}

          {plan && !plan.refusal && (
            <div className="space-y-4">
              {linhas.length > 0 ? (
                <dl className="rounded-xl border divide-y overflow-hidden text-sm">
                  {linhas.map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 px-4 py-2 bg-muted/30"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-semibold tabular-nums">{n(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Esta importação não chegou a produzir nada — nenhum fato,
                  nenhuma vigência. Sai só o registro dela.
                </p>
              )}

              {plan.labels.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Vigências que somem
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {plan.labels.map((label) => (
                      <span
                        key={label}
                        className="font-mono text-[0.6875rem] px-2.5 py-1 rounded-lg border border-red-200 bg-red-50 text-red-900"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Excluir uma correção devolve ao ar o que ela tinha
                  substituído. É consequência, e não efeito colateral: quem
                  apaga a revisão 2 precisa saber que a 1 volta a valer. */}
              {plan.restoredLabels.length > 0 && (
                <p className="text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  A revisão anterior de{" "}
                  <span className="font-mono">
                    {plan.restoredLabels.join(", ")}
                  </span>{" "}
                  volta a valer no lugar desta.
                </p>
              )}

              {plan.removes.sourceFile > 0 && (
                <p className="text-sm text-muted-foreground">
                  O arquivo sai do registro de recebidos, então o mesmo conteúdo
                  poderá ser enviado de novo — hoje ele é recusado como
                  duplicata pelo SHA-256.
                </p>
              )}

              <label className="block space-y-1.5">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Motivo (opcional)
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="ex.: planilha de teste enviada por engano"
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-background"
                />
                <span className="text-xs text-muted-foreground">
                  Vai para o registro da exclusão, ao lado do seu nome.
                </span>
              </label>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!plan || plan.refusal !== null || deleting}
              onClick={() => onConfirm(reason)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              {deleting ? "Excluindo…" : "Excluir importação"}
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
  onPromote: (confirmNewEntityTypes: string[]) => void;
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

  /*
    A única coisa nesta tela que exige decisão, e não leitura.

    Um equipamento que o dicionário não conhece é o começo de uma frota
    paralela — foi assim que a mesma carreta passou a existir duas vezes, com
    dados certos e identidade errada, sem que nada falhasse. Criar equipamento
    continua permitido; o que deixa de existir é criá-lo sem que ninguém tenha
    dito que era isso. Enquanto a caixa não for marcada, aprovar fica travado,
    e a API recusaria de todo jeito: o pipeline exige a mesma declaração.
  */
  const identidadesNovas = data?.pendingIdentities ?? [];
  const [identidadeDeclarada, setIdentidadeDeclarada] = useState(false);
  const travadoPorIdentidade = identidadesNovas.length > 0 && !identidadeDeclarada;
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
          {/* "descartar" prometia o que este botão nunca fez: ele só tira o
              cartão da frente, e a importação continua na lista abaixo,
              esperando decisão. Agora que existe excluir de verdade — no
              cartão de baixo, com a conta do que sai —, as duas palavras não
              podiam continuar sendo a mesma. */}
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            ocultar
          </Button>
          <Button
            size="sm"
            disabled={
              !ready || promoting || (data?.errors ?? 0) > 0 || travadoPorIdentidade
            }
            onClick={() => onPromote(identidadesNovas)}
          >
            {promoting ? "Importando…" : "Aprovar e importar"}
          </Button>
        </div>
      </div>

      {ready && identidadesNovas.length > 0 && (
        <label className="flex gap-3 items-start bg-white/70 border border-amber-300 rounded-lg px-4 py-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={identidadeDeclarada}
            onChange={(e) => setIdentidadeDeclarada(e.target.checked)}
          />
          <span>
            <strong>
              Esta importação criaria{" "}
              {identidadesNovas.length === 1
                ? "um equipamento novo"
                : "equipamentos novos"}
              : <span className="font-mono">{identidadesNovas.join(", ")}</span>.
            </strong>{" "}
            As colunas desta planilha não bateram com nenhum equipamento que já
            existe, então a identidade veio do nome da aba. Se for equipamento novo
            mesmo, confirme. Se for um que já existe com a aba nomeada de outro
            jeito, cancele e confira as colunas — aprovar aqui cria uma frota
            paralela, com os dados certos e a identidade errada.
          </span>
        </label>
      )}

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
