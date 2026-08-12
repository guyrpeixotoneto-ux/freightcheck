import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, GitBranch, PenLine, Radio } from "lucide-react";
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
import { cn } from "@/lib/utils";

/**
 * Curadoria de Versões.
 *
 * The screen exists to keep two acts apart, because they have opposite
 * consequences and one of them is irreversible in the worst way: reporting a
 * contract change the Freightec never made.
 *
 * The separation is structural, not a label. The curator picks the *act* first,
 * on two cards that state what will happen; only then does a form appear. There
 * is no shared form with a mode switch, because a switch is exactly where the
 * distinction gets lost. The asymmetry helps: a source change needs a date, a
 * correction has none — it applies to the whole stretch.
 */

const UNITS = ["BRL", "BRL_KM", "KM_L", "PERCENT", "KM", "LITROS", "MESES", "ANO", "QTD"];
const PERIODICITIES = ["MENSAL", "ANUAL", "PONTUAL"];
const AGGREGATIONS = ["SUM", "AVG", "WEIGHTED_AVG", "NONE"];

interface VersionedAttribute {
  code: string;
  sourceName: string;
  entityType: string;
  versions: number;
  currentStatus: string;
  currentPeriodicity: string | null;
  currentUnit: string | null;
  isMonetary: boolean | null;
  calculationBasis: string | null;
  hasSourceChange: boolean;
}

interface SemanticsVersion {
  id: string;
  version: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  calculationBasis: string | null;
  semanticsStatus: string;
  confirmedBy: string | null;
  rationale: string | null;
  changeOrigin: string;
}

type Act = "source" | "correction" | null;

export default function Versoes() {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const { data: attributes = [], error } = useQuery({
    queryKey: ["versions"],
    queryFn: () => fetchJson<VersionedAttribute[]>("/curation/versions"),
  });

  const visible = attributes.filter((a) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return (
      a.code.toLowerCase().includes(needle) ||
      a.sourceName.toLowerCase().includes(needle)
    );
  });

  const withSourceChange = attributes.filter((a) => a.hasSourceChange).length;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <GitBranch className="w-6 h-6 text-primary" />
          Curadoria de Versões
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          O significado de uma coluna pode mudar ao longo da série. Aqui você
          registra <strong>quando</strong> mudou e <strong>por quê</strong> — e,
          separadamente, corrige um entendimento nosso que estava errado desde
          sempre.
        </p>
        {withSourceChange > 0 && (
          <p className="text-sm text-muted-foreground mt-2">
            <strong>{withSourceChange}</strong> atributos tiveram o significado
            alterado pela Freightec em algum ponto da série.
          </p>
        )}
      </header>

      {error && (
        <div className="px-8 pt-6">
          <ApiErrorNotice
            error={error}
            what="Os atributos versionados não puderam ser carregados."
          />
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-6 p-8 items-start">
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Atributos</CardTitle>
            <Input
              placeholder="Filtrar…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 mt-2"
            />
          </CardHeader>
          <CardContent className="p-0 max-h-[70vh] overflow-y-auto">
            {visible.map((a) => (
              <button
                key={a.code}
                onClick={() => setSelected(a.code)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b hover:bg-muted/60 transition-colors",
                  selected === a.code && "bg-muted",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-muted-foreground truncate">
                      {a.code}
                    </div>
                    <div className="font-medium text-sm truncate">{a.sourceName}</div>
                  </div>
                  {a.hasSourceChange ? (
                    <Badge className="bg-violet-100 text-violet-900 border-violet-300 hover:bg-violet-100 shrink-0">
                      <Radio className="w-3 h-3 mr-1" />
                      {a.versions} versões
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {a.versions} versão
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 font-mono">
                  {a.currentUnit ?? "—"} · {a.currentPeriodicity ?? "sem periodicidade"}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {selected ? (
          <AttributeVersions code={selected} />
        ) : (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              Escolha um atributo para ver a linha do tempo do significado dele.
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function AttributeVersions({ code }: { code: string }) {
  const queryClient = useQueryClient();
  const [act, setAct] = useState<Act>(null);

  const { data: history = [] } = useQuery({
    queryKey: ["versions", code],
    queryFn: () => fetchJson<SemanticsVersion[]>(`/curation/versions/${code}`),
  });

  const current = history.find((v) => v.effectiveUntil === null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="font-mono text-lg">{code}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Linha do tempo do significado. Cada versão foi verdade no trecho dela.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {history.map((v) => (
              <div key={v.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">versão {v.version}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {v.effectiveFrom} → {v.effectiveUntil ?? "hoje"}
                      </span>
                      {v.effectiveUntil === null && (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100">
                          em vigor
                        </Badge>
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground mt-1">
                      {v.unit ?? "sem unidade"} · {v.periodicity ?? "sem periodicidade"} ·{" "}
                      {v.aggregation ?? "sem agregação"}
                      {v.calculationBasis && <> · base: {v.calculationBasis}</>}
                    </div>
                    {v.rationale && (
                      <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
                        {v.rationale}
                      </p>
                    )}
                  </div>
                  <OriginBadge origin={v.changeOrigin} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {act === null && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Duas portas separadas. O curador escolhe o ato antes de ver
              qualquer campo, e cada cartão diz a consequência de antemão. */}
          <button
            onClick={() => setAct("source")}
            className="text-left rounded-lg border-2 border-violet-300 bg-violet-50/50 p-5 hover:bg-violet-50 transition-colors"
          >
            <div className="flex items-center gap-2 font-semibold text-violet-900">
              <Radio className="w-5 h-5" />
              A Freightec mudou a regra
            </div>
            <p className="text-sm text-violet-900/80 mt-2">
              O significado passou a ser outro <strong>a partir de uma vigência</strong>.
              Cria a versão {(current?.version ?? 1) + 1}, fecha a atual naquela data e
              preserva o passado.
            </p>
            <p className="text-xs text-violet-900/70 mt-2">
              → Aparece em Alterações como mudança da fonte, e bloqueia comparações
              que cruzem a data.
            </p>
          </button>

          <button
            onClick={() => setAct("correction")}
            className="text-left rounded-lg border-2 border-amber-300 bg-amber-50/50 p-5 hover:bg-amber-50 transition-colors"
          >
            <div className="flex items-center gap-2 font-semibold text-amber-900">
              <PenLine className="w-5 h-5" />
              Nós entendemos errado
            </div>
            <p className="text-sm text-amber-900/80 mt-2">
              O significado <strong>nunca mudou</strong>; a interpretação é que estava
              errada. Corrige a versão inteira, do início ao fim do trecho dela.
            </p>
            <p className="text-xs text-amber-900/70 mt-2">
              → Não gera alteração nenhuma. Fica registrado como curadoria nossa,
              com quem corrigiu e por quê.
            </p>
          </button>
        </div>
      )}

      {act === "source" && current && (
        <SourceChangeForm
          code={code}
          current={current}
          onCancel={() => setAct(null)}
          onDone={() => {
            setAct(null);
            queryClient.invalidateQueries();
          }}
        />
      )}

      {act === "correction" && current && (
        <CorrectionForm
          code={code}
          current={current}
          onCancel={() => setAct(null)}
          onDone={() => {
            setAct(null);
            queryClient.invalidateQueries();
          }}
        />
      )}
    </div>
  );
}

function OriginBadge({ origin }: { origin: string }) {
  if (origin === "SOURCE_SEMANTICS_CHANGE")
    return (
      <Badge className="bg-violet-100 text-violet-900 border-violet-300 hover:bg-violet-100 shrink-0">
        mudança da fonte
      </Badge>
    );
  if (origin === "CURATION_CORRECTION")
    return (
      <Badge className="bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100 shrink-0">
        correção nossa
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-muted-foreground shrink-0">
      inicial
    </Badge>
  );
}

interface FormProps {
  code: string;
  current: SemanticsVersion;
  onCancel: () => void;
  onDone: () => void;
}

function useSemanticsFields(current: SemanticsVersion) {
  const [unit, setUnit] = useState(current.unit ?? "");
  const [periodicity, setPeriodicity] = useState(current.periodicity ?? "");
  const [aggregation, setAggregation] = useState(current.aggregation ?? "");
  const [basis, setBasis] = useState(current.calculationBasis ?? "");
  const [actor, setActor] = useState("");
  const [reason, setReason] = useState("");
  return {
    unit, setUnit, periodicity, setPeriodicity, aggregation, setAggregation,
    basis, setBasis, actor, setActor, reason, setReason,
    payload: {
      unit: unit || null,
      periodicity: periodicity || null,
      aggregation: aggregation || null,
      calculationBasis: basis || null,
      actor,
      reason,
    },
  };
}

function SemanticsFields({ f }: { f: ReturnType<typeof useSemanticsFields> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Unidade">
        <Select value={f.unit} onValueChange={f.setUnit}>
          <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
          <SelectContent>
            {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Periodicidade">
        <Select value={f.periodicity} onValueChange={f.setPeriodicity}>
          <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
          <SelectContent>
            {PERIODICITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Agregação">
        <Select value={f.aggregation} onValueChange={f.setAggregation}>
          <SelectTrigger><SelectValue placeholder="Selecionar…" /></SelectTrigger>
          <SelectContent>
            {AGGREGATIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field
        label="Base de cálculo"
        hint="A regra que produz o número, quando ela é conhecida e pode mudar sozinha."
      >
        <Input
          value={f.basis}
          onChange={(e) => f.setBasis(e.target.value)}
          placeholder="ex.: 1,000% do valor da NF"
        />
      </Field>
    </div>
  );
}

function Attribution({ f }: { f: ReturnType<typeof useSemanticsFields> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Responsável">
        <Input
          value={f.actor}
          onChange={(e) => f.setActor(e.target.value)}
          placeholder="seu.nome@empresa"
        />
      </Field>
      <Field label="Justificativa">
        <Textarea
          value={f.reason}
          onChange={(e) => f.setReason(e.target.value)}
          rows={2}
          placeholder="Com base em quê?"
        />
      </Field>
    </div>
  );
}

function SourceChangeForm({ code, current, onCancel, onDone }: FormProps) {
  const f = useSemanticsFields(current);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        getApiUrl(`/curation/versions/${code}/source-change`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...f.payload, effectiveFrom, status: "CONFIRMED" }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      return body;
    },
    onSuccess: onDone,
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Card className="border-2 border-violet-300">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-violet-900">
          <Radio className="w-5 h-5" />
          A Freightec mudou a regra
        </CardTitle>
        <p className="text-sm text-violet-900/80">
          Vai criar a <strong>versão {current.version + 1}</strong>. A versão{" "}
          {current.version} é fechada na data informada e continua valendo para o
          período dela. Isso <strong>aparece em Alterações</strong> como mudança da
          fonte.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label="A partir de qual vigência"
          hint="A data da vigência em que o novo significado passou a valer."
        >
          <Input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="w-56"
          />
        </Field>

        <SemanticsFields f={f} />
        <Attribution f={f} />

        {error && (
          <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            onClick={() => submit.mutate()}
            disabled={
              submit.isPending || !effectiveFrom || !f.actor.trim() || !f.reason.trim()
            }
          >
            {submit.isPending ? "Registrando…" : `Criar versão ${current.version + 1}`}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CorrectionForm({ code, current, onCancel, onDone }: FormProps) {
  const f = useSemanticsFields(current);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const response = await fetch(getApiUrl(`/curation/versions/${code}/correction`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f.payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      return body;
    },
    onSuccess: onDone,
    onError: (err: Error) => setError(err.message),
  });

  return (
    <Card className="border-2 border-amber-300">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-amber-900">
          <PenLine className="w-5 h-5" />
          Nós entendemos errado
        </CardTitle>
        <p className="text-sm text-amber-900/80">
          Vai corrigir a <strong>versão {current.version}</strong> inteira —{" "}
          <span className="font-mono">
            {current.effectiveFrom} → {current.effectiveUntil ?? "hoje"}
          </span>
          . Nenhuma versão nova é criada e <strong>nada aparece em Alterações</strong>,
          porque o significado nunca mudou.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Se o significado mudou <strong>a partir de uma data</strong>, isso não é
            correção — é mudança da fonte, e o caminho é o outro.
          </p>
        </div>

        <SemanticsFields f={f} />
        <Attribution f={f} />

        {error && (
          <p className="text-sm text-red-900 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !f.actor.trim() || !f.reason.trim()}
          >
            {submit.isPending ? "Corrigindo…" : `Corrigir versão ${current.version}`}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            cancelar
          </Button>
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
