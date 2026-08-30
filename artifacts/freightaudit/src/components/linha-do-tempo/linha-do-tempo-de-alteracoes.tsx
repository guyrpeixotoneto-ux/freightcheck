import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartLine } from "lucide-react";
import type { TipoDaLinhaDoTempo } from "@workspace/comparison/tipos";
import { opcoesDoIntervalo } from "@/lib/intervalo-da-linha-do-tempo";
import { cn } from "@/lib/utils";
import { vigenciaDoClique, type EstadoDoClique } from "@/lib/clique-na-vigencia";
import { BotaoDeVoltarVigencia } from "@/components/vigencia/voltar-de-vigencia";
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
 *
 * Clicar num ponto de qualquer um dos gráficos abre a tela naquela vigência
 * (`onEscolherVigencia`) — o mesmo que o gráfico do Dashboard faz, e a mesma
 * troca do "Ir para vigência" do cabeçalho. O intervalo desenhado **não** muda
 * junto: `de`/`ate` são a janela que se escolheu comparar, e reduzi-la a cada
 * clique tiraria da tela justamente a curva que fez alguém clicar.
 *
 * A vigência aberta ganha uma guia vertical em todos os gráficos, e não só no
 * que foi clicado: os dois (ou quatro, com o par por atributo) percorrem o
 * mesmo eixo, e é a guia que deixa ler "nesta vigência a quantidade subiu e o
 * valor caiu" sem contar pontos de um gráfico ao outro.
 */
export function LinhaDoTempoDeAlteracoes({
  consulta,
  periods,
  currentPeriod,
  onEscolherVigencia,
  voltarPara = null,
  onVoltar,
  tipo = null,
}: {
  consulta: URLSearchParams;
  periods: { date: string; label: string }[];
  currentPeriod: string;
  /** Quando existe, clicar num ponto leva a tela inteira para aquela vigência. */
  onEscolherVigencia?: (periodo: string) => void;
  /**
   * O caminho de volta, do cartão inteiro e não de cada gráfico: os quatro
   * falam da mesma vigência, e quatro botões seriam quatro cópias do mesmo
   * caminho. A lembrança vem da página — trocar a vigência desmonta este
   * cartão enquanto a consulta nova não responde.
   */
  voltarPara?: { periodo: string; label: string } | null;
  onVoltar?: (periodo: string) => void;
  /** O tipo aberto na aba "Cavalo, Carreta e Trecho". `null` é a aba Geral. */
  tipo?: TipoDaLinhaDoTempo | null;
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
    ...opcoesDoIntervalo(consulta, de, ate, tipo),
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
          <BotaoDeVoltarVigencia destino={voltarPara} onVoltar={(periodo) => onVoltar?.(periodo)} />
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
          <GraficosConsolidados
            dados={movimentos.data}
            vigenciaAtiva={currentPeriod}
            onEscolherVigencia={onEscolherVigencia}
          />
          <GraficosPorAtributo
            dados={movimentos.data}
            vigenciaAtiva={currentPeriod}
            onEscolherVigencia={onEscolherVigencia}
          />
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

/**
 * O que os dois gráficos precisam para virar eixo do tempo navegável: onde a
 * guia da vigência aberta cai, e o que fazer com um clique.
 *
 * Uma função, e não o código repetido nos dois: o gráfico de quantidade e o de
 * valor ficam um embaixo do outro, e um clique que respondesse diferente entre
 * eles seria lido como bug antes de ser lido como diferença.
 *
 * A guia é ancorada pelo **rótulo** do ponto, e não pela data, porque é o
 * rótulo que o `XAxis` desenha (`dataKey="label"`) — uma `ReferenceLine` com a
 * data crua não encontraria categoria nenhuma no eixo e não apareceria. Vem do
 * próprio ponto da série: se a vigência aberta não está na janela comparada,
 * não há rótulo e não há guia, que é honesto — a linha existiria fora do eixo.
 */
function eixoNavegavel<T extends { periodo: string; label: string }>(
  dados: T[],
  vigenciaAtiva: string | null | undefined,
  onEscolherVigencia: ((periodo: string) => void) | undefined,
) {
  const clicavel = typeof onEscolherVigencia === "function" && dados.length > 1;
  return {
    clicavel,
    rotuloAtivo: dados.find((d) => d.periodo === vigenciaAtiva)?.label ?? null,
    aoClicar: (estado: EstadoDoClique) => {
      if (!clicavel) return;
      const periodo = vigenciaDoClique(estado, vigenciaAtiva ?? null);
      if (periodo !== null) onEscolherVigencia!(periodo);
    },
  };
}

/** A guia vertical da vigência aberta — a mesma marca nos dois gráficos. */
const GUIA_DA_VIGENCIA = {
  stroke: "hsl(var(--brand))",
  strokeDasharray: "4 4",
  strokeOpacity: 0.7,
} as const;

function GraficoDeQuantidade({
  dados,
  vigenciaAtiva,
  onEscolherVigencia,
}: {
  dados: PontoDeQuantidade[];
  vigenciaAtiva?: string | null;
  onEscolherVigencia?: (periodo: string) => void;
}) {
  const semAlteracao = dados.every((d) => d.positivas === 0 && d.negativas === 0);
  const { clicavel, rotuloAtivo, aoClicar } = eixoNavegavel(
    dados,
    vigenciaAtiva,
    onEscolherVigencia,
  );
  if (semAlteracao) return null;

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Alterações por vigência — quantidade
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart
          data={dados}
          margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          onClick={aoClicar}
          style={clicavel ? { cursor: "pointer" } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
            allowDecimals={false}
            width={36}
          />
          {rotuloAtivo !== null && <ReferenceLine x={rotuloAtivo} {...GUIA_DA_VIGENCIA} />}
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
  vigenciaAtiva,
  onEscolherVigencia,
}: {
  periodicidade: string;
  dados: PontoDeValor[];
  vigenciaAtiva?: string | null;
  onEscolherVigencia?: (periodo: string) => void;
}) {
  const { clicavel, rotuloAtivo, aoClicar } = eixoNavegavel(
    dados,
    vigenciaAtiva,
    onEscolherVigencia,
  );

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Impacto por vigência em R${periodicitySuffix(periodicidade)}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart
          data={dados}
          margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
          onClick={aoClicar}
          style={clicavel ? { cursor: "pointer" } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
            tickFormatter={(v: number) => formatBrlShort(v)}
            width={92}
          />
          {rotuloAtivo !== null && <ReferenceLine x={rotuloAtivo} {...GUIA_DA_VIGENCIA} />}
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

function GraficosConsolidados({
  dados,
  vigenciaAtiva,
  onEscolherVigencia,
}: {
  dados: Movimentos;
  vigenciaAtiva?: string | null;
  onEscolherVigencia?: (periodo: string) => void;
}) {
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
        <GraficoDeQuantidade
          dados={quantidade}
          vigenciaAtiva={vigenciaAtiva}
          onEscolherVigencia={onEscolherVigencia}
        />
        {periodicidades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma alteração valorada neste intervalo.</p>
        ) : (
          periodicidades.map((p) => (
            <GraficoDeValor
              key={p}
              periodicidade={p}
              dados={valor.get(p) ?? []}
              vigenciaAtiva={vigenciaAtiva}
              onEscolherVigencia={onEscolherVigencia}
            />
          ))
        )}
      </div>
    </div>
  );
}

function GraficosPorAtributo({
  dados,
  vigenciaAtiva,
  onEscolherVigencia,
}: {
  dados: Movimentos;
  vigenciaAtiva?: string | null;
  onEscolherVigencia?: (periodo: string) => void;
}) {
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
        <GraficoDeQuantidade
          dados={quantidade}
          vigenciaAtiva={vigenciaAtiva}
          onEscolherVigencia={onEscolherVigencia}
        />
        {periodicidades.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma alteração valorada deste atributo, neste intervalo.
          </p>
        ) : (
          periodicidades.map((p) => (
            <GraficoDeValor
              key={p}
              periodicidade={p}
              dados={valor.get(p) ?? []}
              vigenciaAtiva={vigenciaAtiva}
              onEscolherVigencia={onEscolherVigencia}
            />
          ))
        )}
      </div>
    </div>
  );
}
