import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartLine } from "lucide-react";
import { opcoesDoIntervalo } from "@/lib/intervalo-da-linha-do-tempo";
import { cn } from "@/lib/utils";
import { formatBrl, formatBrlShort, periodicitySuffix } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Movimentos, RangeEntry } from "@/lib/analise";

const CARTAO = "bg-card border rounded-xl shadow-sm";
const COR_POSITIVA = "#059669"; // emerald-600, a mesma cor de ganho do resto da tela
const COR_NEGATIVA = "#dc2626"; // red-600, a mesma cor de perda do resto da tela

/**
 * As mesmas alterações da linha do tempo, agora como linha do tempo — uma
 * série por vigência, em vez de uma barra por vigência.
 *
 * O cartão de Impacto líquido acima responde "quanto" cada vigência somou ou
 * tirou; este cartão responde "como isso se moveu" — se o número de
 * alterações positivas vem crescendo, se o valor delas oscila, se um
 * atributo específico puxou o intervalo para um lado. O período do gráfico
 * é escolhido aqui dentro, independente da vigência aberta na tela.
 */
export function LinhaDoTempoDeAlteracoes({
  consulta,
  periods,
  currentPeriod,
}: {
  consulta: URLSearchParams;
  periods: { date: string; label: string }[];
  currentPeriod: string;
}) {
  const ordenadas = useMemo(
    () => [...periods].sort((a, b) => a.date.localeCompare(b.date)),
    [periods],
  );

  const [de, setDe] = useState(ordenadas[0]?.date ?? currentPeriod);
  const [ate, setAte] = useState(currentPeriod);

  /*
    Mesma chave de `LinhaDoTempoDeImpacto` e `useAlteracoesPorVigencia` — ver a
    nota lá. No carregamento inicial `de`/`ate` cobrem o histórico inteiro,
    igual às outras duas leituras; montar a chave pelo mesmo
    `opcoesDoIntervalo` faz o React Query reaproveitar essa primeira chamada em
    vez de repeti-la.
  */
  const movimentos = useQuery({
    ...opcoesDoIntervalo(consulta, de, ate),
    enabled: ordenadas.length > 1,
  });

  if (ordenadas.length <= 1) return null;

  const opcoesDe = ordenadas.filter((p) => p.date <= ate);
  const opcoesAte = ordenadas.filter((p) => p.date >= de);

  return (
    <section className={cn(CARTAO, "p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-accent">
            <ChartLine className="w-[1.125rem] h-[1.125rem] text-brand" strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[0.8125rem] font-bold leading-tight">
              Alterações ao longo do tempo
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Positivas e negativas, vigência a vigência
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <SeletorDePeriodo
            label="De"
            valor={de}
            opcoes={opcoesDe}
            onChange={setDe}
          />
          <span className="text-muted-foreground">→</span>
          <SeletorDePeriodo
            label="Até"
            valor={ate}
            opcoes={opcoesAte}
            onChange={setAte}
          />
        </div>
      </div>

      {movimentos.isLoading && (
        <p className="text-sm text-muted-foreground">Carregando o intervalo…</p>
      )}

      {!movimentos.isLoading && (!movimentos.data || movimentos.data.entries.length === 0) && (
        <p className="text-sm text-muted-foreground">
          Nenhuma alteração encontrada entre estas duas vigências.
        </p>
      )}

      {movimentos.data && movimentos.data.entries.length > 0 && (
        <div className="space-y-8">
          <GraficosConsolidados dados={movimentos.data} />
          <GraficosPorAtributo dados={movimentos.data} />
        </div>
      )}
    </section>
  );
}

function SeletorDePeriodo({
  label,
  valor,
  opcoes,
  onChange,
}: {
  label: string;
  valor: string;
  opcoes: { date: string; label: string }[];
  onChange: (valor: string) => void;
}) {
  return (
    <Select value={valor} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-40 text-xs" aria-label={label}>
        <span className="text-muted-foreground mr-1">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {opcoes.map((p) => (
          <SelectItem key={p.date} value={p.date} className="text-xs">
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// A construção das séries — a mesma lógica serve o consolidado e o atributo
// ---------------------------------------------------------------------------

export interface PontoDeQuantidade {
  periodo: string;
  label: string;
  positivas: number;
  negativas: number;
}

export interface PontoDeValor {
  periodo: string;
  label: string;
  ganhos: number;
  perdas: number;
}

/** Só entra na conta quem tem sinal apurado — o resto não é positivo nem negativo, é desconhecido. */
function comSinal(entradas: RangeEntry[]): RangeEntry[] {
  return entradas.filter((e) => e.confidence === "CALCULATED" && e.amount !== null && e.amount !== 0);
}

/**
 * As séries de quantidade e valor de um intervalo, por periodicidade.
 *
 * Exportada porque a Gestão à Vista lê a mesma conta para o seu gráfico de
 * tendência compacto — sem selects nem detalhe por atributo, mas sobre o
 * mesmo `/changes/range` e com a mesma régua de "só sinal apurado entra".
 */
export function seriesDoIntervalo(
  periodosOrdenados: { date: string; label: string }[],
  entradas: RangeEntry[],
): {
  quantidade: PontoDeQuantidade[];
  valor: Map<string, PontoDeValor[]>;
  periodicidades: string[];
} {
  const porPeriodo = new Map<string, RangeEntry[]>();
  for (const e of entradas) {
    if (!porPeriodo.has(e.period)) porPeriodo.set(e.period, []);
    porPeriodo.get(e.period)!.push(e);
  }

  const quantidade = periodosOrdenados.map((p) => {
    const linhas = comSinal(porPeriodo.get(p.date) ?? []);
    return {
      periodo: p.date,
      label: p.label,
      positivas: linhas.filter((e) => (e.amount ?? 0) > 0).length,
      negativas: linhas.filter((e) => (e.amount ?? 0) < 0).length,
    };
  });

  const periodicidades = [
    ...new Set(comSinal(entradas).map((e) => e.periodicity ?? "SEM_PERIODICIDADE")),
  ].sort();

  const valor = new Map<string, PontoDeValor[]>();
  for (const periodicidade of periodicidades) {
    valor.set(
      periodicidade,
      periodosOrdenados.map((p) => {
        const linhas = comSinal(porPeriodo.get(p.date) ?? []).filter(
          (e) => (e.periodicity ?? "SEM_PERIODICIDADE") === periodicidade,
        );
        return {
          periodo: p.date,
          label: p.label,
          ganhos: linhas.filter((e) => (e.amount ?? 0) > 0).reduce((s, e) => s + (e.amount ?? 0), 0),
          perdas: linhas.filter((e) => (e.amount ?? 0) < 0).reduce((s, e) => s + (e.amount ?? 0), 0),
        };
      }),
    );
  }

  return { quantidade, valor, periodicidades };
}

// ---------------------------------------------------------------------------
// Os dois gráficos, quantidade e valor
// ---------------------------------------------------------------------------

function GraficoDeQuantidade({ dados }: { dados: PontoDeQuantidade[] }) {
  const semAlteracao = dados.every((d) => d.positivas === 0 && d.negativas === 0);
  if (semAlteracao) return null;

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Alterações por vigência — quantidade
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={dados} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
            allowDecimals={false}
            width={36}
          />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="positivas"
            name="Positivas"
            stroke={COR_POSITIVA}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="negativas"
            name="Negativas"
            stroke={COR_NEGATIVA}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function GraficoDeValor({
  periodicidade,
  dados,
}: {
  periodicidade: string;
  dados: PontoDeValor[];
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Impacto por vigência em R${periodicitySuffix(periodicidade)}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={dados} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
            tickFormatter={(v: number) => formatBrlShort(v)}
            width={92}
          />
          <Tooltip formatter={(v: number) => formatBrl(v)} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="ganhos"
            name="Ganhos"
            stroke={COR_POSITIVA}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="perdas"
            name="Perdas"
            stroke={COR_NEGATIVA}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O consolidado, e o mesmo par de gráficos por atributo
// ---------------------------------------------------------------------------

function GraficosConsolidados({ dados }: { dados: Movimentos }) {
  const ordenadas = useMemo(
    () => [...dados.periods].sort((a, b) => a.date.localeCompare(b.date)),
    [dados],
  );
  const { quantidade, valor, periodicidades } = useMemo(
    () => seriesDoIntervalo(ordenadas, dados.entries),
    [ordenadas, dados],
  );

  return (
    <div>
      <h3 className="text-sm font-bold mb-3">Consolidado</h3>
      <div className="space-y-6">
        <GraficoDeQuantidade dados={quantidade} />
        {periodicidades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma alteração valorada neste intervalo.</p>
        ) : (
          periodicidades.map((p) => (
            <GraficoDeValor key={p} periodicidade={p} dados={valor.get(p) ?? []} />
          ))
        )}
      </div>
    </div>
  );
}

function GraficosPorAtributo({ dados }: { dados: Movimentos }) {
  const atributos = useMemo(
    () => [...dados.byParameter].sort((a, b) => b.changes - a.changes),
    [dados],
  );
  const [selecionado, setSelecionado] = useState(atributos[0]?.parameterKey ?? "");

  const ordenadas = useMemo(
    () => [...dados.periods].sort((a, b) => a.date.localeCompare(b.date)),
    [dados],
  );

  const atributo = atributos.find((a) => a.parameterKey === selecionado) ?? atributos[0];

  const { quantidade, valor, periodicidades } = useMemo(() => {
    if (!atributo) return { quantidade: [], valor: new Map(), periodicidades: [] };
    const entradasDoAtributo = dados.entries.filter((e) => e.parameterKey === atributo.parameterKey);
    return seriesDoIntervalo(ordenadas, entradasDoAtributo);
  }, [ordenadas, dados, atributo]);

  if (atributos.length === 0 || !atributo) return null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-bold">Por atributo</h3>
        <Select value={atributo.parameterKey} onValueChange={setSelecionado}>
          <SelectTrigger className="h-8 w-72 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {atributos.map((a) => (
              <SelectItem key={a.parameterKey} value={a.parameterKey} className="text-xs">
                {a.parameterName} · {a.changes.toLocaleString("pt-BR")}{" "}
                {a.changes === 1 ? "alteração" : "alterações"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-6">
        <GraficoDeQuantidade dados={quantidade} />
        {periodicidades.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma alteração valorada deste atributo, neste intervalo.
          </p>
        ) : (
          periodicidades.map((p) => (
            <GraficoDeValor key={p} periodicidade={p} dados={valor.get(p) ?? []} />
          ))
        )}
      </div>
    </div>
  );
}
