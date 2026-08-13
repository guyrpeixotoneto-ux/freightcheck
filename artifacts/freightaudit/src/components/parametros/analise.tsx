import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatBrl, formatBrlShort, periodicitySuffix } from "@/lib/format";
import { TabelaFreightech, type ColunaTabela } from "@/components/parametros/tabela";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * A aba Análise — a metade do cartão que o Freightech não tem.
 *
 * A primeira aba é o espelho: a tela de lá, com a mesma tabela e a mesma ordem
 * de colunas, respondendo "como está hoje". Esta responde a outra pergunta, e é
 * a razão de este produto existir: **entre estas duas vigências, o que o
 * cliente mexeu, quanto custou e quanto rendeu.** Lá isso exige exportar duas
 * planilhas e comparar à mão.
 *
 * **Uma advertência que não é rodapé, é a definição do número.** Uma vigência
 * aqui já é uma comparação — agosto/2026 significa "agosto contra julho".
 * Escolher *de abril até agosto* soma cinco movimentos, e não é o mesmo que pôr
 * a planilha de abril ao lado da de agosto: um valor que foi de 10 para 20 e
 * voltou para 10 dá zero na leitura das duas pontas e dá duas alterações aqui.
 * As duas respostas estão certas para perguntas diferentes; esta tela responde
 * "o que mexeu no caminho", e diz isso em voz alta em vez de deixar o número
 * ser lido como a outra coisa.
 *
 * As recusas de sempre valem aqui inteiras:
 *
 * 1. **Nunca somar periodicidades.** Se houver R$/mês e R$/ano no intervalo,
 *    são dois rankings, com dois títulos. Um ranking único ordenado por número
 *    poria doze mil por ano na frente de mil por mês.
 * 2. **Prejuízo e ganho nunca se cancelam num número só.** O líquido esconde um
 *    intervalo em que meio milhão saiu e meio milhão entrou por outra porta.
 * 3. **Vigência sem comparação é nomeada.** Não vira zero, e o intervalo diz
 *    que ela ficou de fora.
 * 4. **Alteração sem preço continua contada.** O ranking mostra o que tem
 *    valor; a linha abaixo dele diz quantas não têm e por quê.
 */

interface RangeEntry {
  key: string;
  period: string;
  periodLabel: string;
  parameterKey: string;
  parameterName: string;
  family: string;
  attributeCode: string | null;
  title: string;
  equipment: string;
  vehicles: number;
  unit: string | null;
  amount: number | null;
  periodicity: string | null;
  confidence: string;
  reason: string | null;
  badge: string;
  badgeLabel: string;
}

interface RangeMovement {
  period: string;
  label: string;
  comparisons: number;
  changes: number;
  vehicles: number;
  impact: {
    byPeriodicity: Record<string, number>;
    notCalculable: number;
    calculatedChanges: number;
  };
}

interface RangeAnalysis {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  periods: { date: string; label: string }[];
  movements: RangeMovement[];
  gaps: { period: string; label: string; reason: string }[];
  impact: {
    byPeriodicity: Record<string, number>;
    excludedByPeriodicity: Record<string, number>;
    excludedChanges: number;
    notCalculable: number;
    calculatedChanges: number;
  };
  lossesByPeriodicity: Record<string, number>;
  gainsByPeriodicity: Record<string, number>;
  totals: { changes: number; vehiclesTouched: number; comparisons: number };
  entries: RangeEntry[];
}

export function AnaliseCartao({
  nomeDoCartao,
  /** As chaves dos nossos parâmetros por trás deste cartão. Vazio = sem dado. */
  parametros,
  /** Unidade e canal. A vigência **não** entra: quem escolhe o intervalo é esta aba. */
  contexto,
  /** A vigência aberta na outra aba — o ponto de partida do intervalo. */
  periodo,
}: {
  nomeDoCartao: string;
  parametros: { key: string; name: string }[];
  contexto: URLSearchParams;
  periodo: string | null;
}) {
  const [de, setDe] = useState<string | null>(null);
  const [ate, setAte] = useState<string | null>(periodo);

  const query = new URLSearchParams(contexto);
  query.delete("period");
  if (de) query.set("from", de);
  if (ate) query.set("to", ate);

  const { data, isLoading, error } = useQuery({
    queryKey: ["intervalo", query.toString()],
    queryFn: async () => {
      const resposta = await fetch(getApiUrl(`/changes/range?${query}`));
      if (resposta.status === 404) return null;
      if (!resposta.ok) {
        throw new Error((await resposta.json()).error ?? "Falha ao carregar");
      }
      return (await resposta.json()) as RangeAnalysis;
    },
  });

  /*
    O ranking é deste cartão, e não do intervalo inteiro.

    O endpoint devolve tudo o que mexeu entre as duas vigências porque a mesma
    leitura serve a outras telas; aqui ela é recortada pelos parâmetros deste
    cartão. Mostrar o intervalo inteiro sob o título CAVALO seria pendurar o
    movimento da frota inteira no nome de um cartão.
  */
  const chaves = useMemo(() => new Set(parametros.map((p) => p.key)), [parametros]);
  const doCartao = useMemo(
    () => (data?.entries ?? []).filter((e) => chaves.has(e.parameterKey)),
    [data, chaves],
  );

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  if (error) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm">
        {(error as Error).message}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
        Nenhuma vigência importada neste contexto — não há intervalo para ler.
      </div>
    );
  }

  const comPreco = doCartao.filter(
    (e) => e.confidence === "CALCULATED" && e.amount !== null && e.amount !== 0,
  );
  const semPreco = doCartao.filter(
    (e) => e.confidence !== "CALCULATED" || e.amount === null,
  );
  const periodicidades = [
    ...new Set(comPreco.map((e) => e.periodicity ?? "SEM_PERIODICIDADE")),
  ].sort();

  return (
    <div className="space-y-6">
      <SeletorIntervalo
        periodos={data.periods}
        de={data.from}
        ate={data.to}
        onDe={setDe}
        onAte={setAte}
      />

      <p className="text-xs text-muted-foreground flex gap-2 max-w-3xl">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Cada vigência já é uma comparação com a anterior, e o intervalo soma os
          movimentos de <strong className="text-foreground">{data.fromLabel}</strong> até{" "}
          <strong className="text-foreground">{data.toLabel}</strong> —{" "}
          {data.totals.comparisons}{" "}
          {data.totals.comparisons === 1 ? "comparação" : "comparações"}. Não é a
          diferença entre as duas pontas: um valor que subiu e voltou aparece aqui
          como dois movimentos, e some numa leitura de ponta a ponta.
        </span>
      </p>

      {data.gaps.length > 0 && (
        <div className="bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm">
          <p className="font-medium flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-brand-red shrink-0" />
            {data.gaps.length}{" "}
            {data.gaps.length === 1
              ? "vigência do intervalo ficou de fora"
              : "vigências do intervalo ficaram de fora"}
          </p>
          <p className="text-muted-foreground mt-1">
            {data.gaps.map((g) => g.label).join(", ")} — {data.gaps[0].reason}
          </p>
        </div>
      )}

      {parametros.length === 0 ? (
        <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
          Este cartão não tem parâmetro nenhum alimentado pelo export, e por isso não
          há alteração para analisar. A aba Freightech continua mostrando o que a
          planilha traz.
        </div>
      ) : (
        <>
          <Placar entradas={doCartao} nome={nomeDoCartao} />

          {comPreco.length === 0 ? (
            <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
              Nenhuma alteração deste cartão tem impacto apurado neste intervalo.
              {semPreco.length > 0 && (
                <>
                  {" "}
                  {semPreco.length}{" "}
                  {semPreco.length === 1 ? "mudou" : "mudaram"} sem preço — o motivo
                  está na lista abaixo.
                </>
              )}
            </div>
          ) : (
            /*
              Um bloco por periodicidade. Quase sempre há uma só, e o título
              parece redundante; no dia em que houver R$/mês e R$/ano juntos é
              este título que impede o ranking de ordenar as duas grandezas
              numa fila só.
            */
            periodicidades.map((periodicidade) => {
              const doBalde = comPreco.filter(
                (e) => (e.periodicity ?? "SEM_PERIODICIDADE") === periodicidade,
              );
              return (
                <div key={periodicidade} className="grid lg:grid-cols-2 gap-6">
                  <Ranking
                    titulo="Maiores prejuízos"
                    periodicidade={periodicidade}
                    tom="perda"
                    entradas={doBalde.filter((e) => (e.amount ?? 0) < 0)}
                  />
                  <Ranking
                    titulo="Maiores ganhos"
                    periodicidade={periodicidade}
                    tom="ganho"
                    entradas={doBalde.filter((e) => (e.amount ?? 0) > 0)}
                  />
                </div>
              );
            })
          )}

          {semPreco.length > 0 && <SemPreco entradas={semPreco} />}

          <MovimentoPorVigencia
            movimentos={data.movements}
            entradas={doCartao}
            nome={nomeDoCartao}
          />
        </>
      )}
    </div>
  );
}

/**
 * As duas pontas do intervalo.
 *
 * Ambas incluídas, e dito na tela: "de abril até agosto" com abril de fora
 * seria uma leitura a menos do que o rótulo promete, e ninguém confere isso
 * olhando o total.
 */
function SeletorIntervalo({
  periodos,
  de,
  ate,
  onDe,
  onAte,
}: {
  periodos: { date: string; label: string }[];
  de: string;
  ate: string;
  onDe: (valor: string) => void;
  onAte: (valor: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Campo rotulo="De">
        <Select value={de} onValueChange={onDe}>
          <SelectTrigger className="w-56 h-11 rounded-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodos.map((p) => (
              <SelectItem key={p.date} value={p.date}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>

      <ArrowRight className="w-4 h-4 text-muted-foreground mb-3.5 shrink-0" />

      <Campo rotulo="Até">
        <Select value={ate} onValueChange={onAte}>
          <SelectTrigger className="w-56 h-11 rounded-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodos.map((p) => (
              <SelectItem key={p.date} value={p.date}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Campo>

      <p className="text-[0.6875rem] text-muted-foreground mb-3.5">
        as duas vigências entram na leitura
      </p>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-1">{rotulo}</div>
      {children}
    </div>
  );
}

/**
 * Prejuízo e ganho lado a lado, nunca somados.
 *
 * O líquido caberia numa linha e seria a leitura mais confortável possível — e
 * é exatamente por isso que não está aqui: um intervalo em que saíram
 * R$ 500 mil e entraram R$ 480 mil não é "R$ 20 mil de prejuízo", é meio milhão
 * indo e voltando por portas diferentes, e essas duas coisas exigem conversas
 * diferentes com o cliente.
 */
function Placar({ entradas, nome }: { entradas: RangeEntry[]; nome: string }) {
  const perdas: Record<string, number> = {};
  const ganhos: Record<string, number> = {};
  for (const entrada of entradas) {
    if (entrada.confidence !== "CALCULATED" || entrada.amount === null) continue;
    const balde = entrada.periodicity ?? "SEM_PERIODICIDADE";
    if (entrada.amount < 0) perdas[balde] = (perdas[balde] ?? 0) + entrada.amount;
    else if (entrada.amount > 0) ganhos[balde] = (ganhos[balde] ?? 0) + entrada.amount;
  }

  const veiculos = entradas.reduce((soma, e) => soma + e.vehicles, 0);
  const semImpacto = Object.keys(perdas).length === 0 && Object.keys(ganhos).length === 0;

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Bloco titulo="Prejuízo no intervalo" tom="perda">
        {Object.keys(perdas).length === 0 ? (
          <Nada />
        ) : (
          Object.entries(perdas).map(([periodicidade, valor]) => (
            <div key={periodicidade} className="text-xl font-bold text-brand-red">
              {formatBrlShort(valor)}
              <span className="text-sm font-normal">
                {periodicitySuffix(periodicidade)}
              </span>
            </div>
          ))
        )}
      </Bloco>

      <Bloco titulo="Ganho no intervalo" tom="ganho">
        {Object.keys(ganhos).length === 0 ? (
          <Nada />
        ) : (
          Object.entries(ganhos).map(([periodicidade, valor]) => (
            <div key={periodicidade} className="text-xl font-bold text-success">
              {formatBrlShort(valor)}
              <span className="text-sm font-normal">
                {periodicitySuffix(periodicidade)}
              </span>
            </div>
          ))
        )}
      </Bloco>

      <Bloco titulo="Alterações">
        <div className="text-xl font-bold">{entradas.length}</div>
        <p className="text-xs text-muted-foreground mt-1">
          {entradas.length === 1 ? "grupo" : "grupos"} em {nome}
        </p>
      </Bloco>

      <Bloco titulo="Veículos tocados">
        <div className="text-xl font-bold">{veiculos}</div>
        <p className="text-xs text-muted-foreground mt-1">
          somados por grupo — o mesmo ativo pode contar em mais de um
        </p>
      </Bloco>

      {semImpacto && (
        <p className="sm:col-span-2 lg:col-span-4 text-xs text-muted-foreground">
          Nenhuma das alterações deste cartão tem preço apurado no intervalo. O
          movimento existe e está listado abaixo; o que falta é a valoração, não o
          dado.
        </p>
      )}
    </div>
  );
}

function Bloco({
  titulo,
  tom,
  children,
}: {
  titulo: string;
  tom?: "perda" | "ganho";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-card border border-l-[5px] px-5 py-4",
        tom === "perda" && "border-l-brand-red",
        tom === "ganho" && "border-l-success",
        tom === undefined && "border-l-brand",
      )}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {titulo}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Nada() {
  return <div className="text-xl font-bold text-muted-foreground">—</div>;
}

/**
 * O ranking de um lado só, dentro de uma periodicidade.
 *
 * A barra é leitura de relance; o número ao lado é a medida. A escala é a do
 * próprio ranking — a maior barra é o maior item da lista, e não uma fração de
 * um teto qualquer — porque comparar entre si é o que a lista serve para fazer.
 */
function Ranking({
  titulo,
  periodicidade,
  tom,
  entradas,
}: {
  titulo: string;
  periodicidade: string;
  tom: "perda" | "ganho";
  entradas: RangeEntry[];
}) {
  const [tudo, setTudo] = useState(false);
  const ordenadas = [...entradas].sort(
    (a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0),
  );
  const teto = Math.abs(ordenadas[0]?.amount ?? 0);
  /*
    O topo cabe na tela; o resto fica a um clique. Uma lista de quarenta itens
    empurra a tabela de vigências para fora do campo de visão e é lida como se
    fosse tudo o que existe — mas cortar sem dizer o quanto foi cortado é pior,
    e por isso o botão traz o número.
  */
  const TOPO = 8;
  const visiveis = tudo ? ordenadas : ordenadas.slice(0, TOPO);

  const sufixo = periodicitySuffix(periodicidade);

  return (
    <div className="bg-card border">
      <div className="px-5 py-3 border-b flex items-baseline justify-between gap-3">
        <h3 className="text-[0.8125rem] font-bold uppercase tracking-wide">{titulo}</h3>
        <span className="text-xs text-muted-foreground">
          uma linha por vigência · {sufixo ? `R$${sufixo}` : "sem periodicidade"}
        </span>
      </div>

      {ordenadas.length === 0 ? (
        <p className="px-5 py-8 text-sm text-muted-foreground text-center">
          Nenhum {tom === "perda" ? "prejuízo" : "ganho"} apurado neste intervalo.
        </p>
      ) : (
        <ul className="divide-y">
          {visiveis.map((entrada) => (
            <li key={entrada.key} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium truncate">{entrada.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {entrada.periodLabel} · {entrada.vehicles}{" "}
                    {entrada.vehicles === 1 ? "veículo" : "veículos"} ·{" "}
                    {entrada.equipment}
                  </div>
                </div>
                <div
                  className={cn(
                    "text-sm font-bold tabular-nums shrink-0",
                    tom === "perda" ? "text-brand-red" : "text-success",
                  )}
                >
                  {formatBrl(entrada.amount ?? 0)}
                </div>
              </div>
              <span
                className="mt-2 block h-1.5 bg-muted overflow-hidden"
                role="presentation"
              >
                <span
                  className={cn(
                    "block h-full",
                    tom === "perda" ? "bg-brand-red" : "bg-success",
                  )}
                  style={{
                    width: `${teto === 0 ? 0 : (Math.abs(entrada.amount ?? 0) / teto) * 100}%`,
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {ordenadas.length > TOPO && (
        <button
          type="button"
          onClick={() => setTudo((v) => !v)}
          className="w-full px-5 py-3 border-t text-[0.8125rem] font-bold uppercase tracking-wide text-brand hover:bg-accent transition-colors"
        >
          {tudo
            ? `Mostrar só os ${TOPO} maiores`
            : `Ver todos os ${ordenadas.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * O que mudou e não tem preço.
 *
 * Fica **abaixo** do ranking e nunca dentro dele: uma linha sem valor no meio de
 * uma lista ordenada por valor cai no fim e é lida como "pequena", quando o que
 * ela é de fato é *não medida*. O motivo vem junto, porque "sem impacto" e "sem
 * como calcular o impacto" mandam fazer coisas diferentes.
 */
function SemPreco({ entradas }: { entradas: RangeEntry[] }) {
  return (
    <div className="bg-card border">
      <div className="px-5 py-3 border-b">
        <h3 className="text-[0.8125rem] font-bold uppercase tracking-wide">
          Mudou sem preço apurado
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          {entradas.length}{" "}
          {entradas.length === 1
            ? "grupo mudou e não entrou no ranking"
            : "grupos mudaram e não entraram no ranking"}
          . Não é zero: é o que este export não permite valorar.
        </p>
      </div>
      <ul className="divide-y">
        {entradas.map((entrada) => (
          <li key={entrada.key} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium truncate">{entrada.title}</div>
                <div className="text-xs text-muted-foreground">
                  {entrada.periodLabel} · {entrada.vehicles}{" "}
                  {entrada.vehicles === 1 ? "veículo" : "veículos"}
                </div>
              </div>
              <span className="text-xs uppercase tracking-wider text-muted-foreground shrink-0">
                {entrada.badgeLabel}
              </span>
            </div>
            {entrada.reason && (
              <p className="text-xs text-muted-foreground mt-1">{entrada.reason}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Quando aconteceu.
 *
 * O ranking diz o quê e quanto; esta tabela diz *quando*, que é a pergunta
 * seguinte e a que decide se houve um evento único ou um escorregamento mês a
 * mês. As duas colunas de contagem são deste cartão; a coluna de comparações é
 * do intervalo inteiro, e está dita como tal no cabeçalho.
 */
function MovimentoPorVigencia({
  movimentos,
  entradas,
  nome,
}: {
  movimentos: RangeMovement[];
  entradas: RangeEntry[];
  nome: string;
}) {
  interface Linha {
    period: string;
    label: string;
    comparisons: number;
    grupos: number;
    veiculos: number;
    porPeriodicidade: Record<string, number>;
  }

  const linhas: Linha[] = movimentos.map((movimento) => {
    const doPeriodo = entradas.filter((e) => e.period === movimento.period);
    const porPeriodicidade: Record<string, number> = {};
    for (const entrada of doPeriodo) {
      if (entrada.confidence !== "CALCULATED" || entrada.amount === null) continue;
      const balde = entrada.periodicity ?? "SEM_PERIODICIDADE";
      porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + entrada.amount;
    }
    return {
      period: movimento.period,
      label: movimento.label,
      comparisons: movimento.comparisons,
      grupos: doPeriodo.length,
      veiculos: doPeriodo.reduce((soma, e) => soma + e.vehicles, 0),
      porPeriodicidade,
    };
  });

  const colunas: ColunaTabela<Linha>[] = [
    {
      titulo: "Vigência",
      alinhar: "left",
      valor: (l) => l.period,
      celula: (l) => <span className="font-medium">{l.label}</span>,
    },
    {
      titulo: `Grupos em ${nome}`,
      alinhar: "right",
      valor: (l) => l.grupos,
      celula: (l) =>
        l.grupos === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums">{l.grupos}</span>
        ),
    },
    {
      titulo: "Veículos",
      alinhar: "right",
      valor: (l) => l.veiculos,
      celula: (l) =>
        l.veiculos === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums">{l.veiculos}</span>
        ),
    },
    {
      titulo: "Impacto",
      alinhar: "right",
      // Ordena pelo maior valor absoluto **dentro de uma periodicidade**, e
      // nunca por uma soma entre elas: R$/mês e R$/ano não formam uma fila.
      valor: (l) => {
        const valores = Object.values(l.porPeriodicidade).map(Math.abs);
        return valores.length === 0 ? null : Math.max(...valores);
      },
      celula: (l) => {
        const entradas = Object.entries(l.porPeriodicidade);
        if (entradas.length === 0) {
          return <span className="text-muted-foreground text-xs">sem preço apurado</span>;
        }
        return (
          <div className="space-y-0.5">
            {entradas.map(([periodicidade, valor]) => (
              <div
                key={periodicidade}
                className={cn(
                  "tabular-nums font-medium",
                  valor < 0 ? "text-brand-red" : "text-success",
                )}
              >
                {formatBrl(valor)}
                <span className="text-xs font-normal">
                  {periodicitySuffix(periodicidade)}
                </span>
              </div>
            ))}
          </div>
        );
      },
    },
    {
      titulo: "Comparações no intervalo",
      alinhar: "right",
      valor: (l) => l.comparisons,
      celula: (l) => (
        <span className="tabular-nums text-muted-foreground">{l.comparisons}</span>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-[0.8125rem] font-bold uppercase tracking-wide">
        Movimento por vigência
      </h3>
      <TabelaFreightech
        id={`intervalo:${nome}`}
        colunas={colunas}
        linhas={linhas}
        chave={(l) => l.period}
        vazio={
          <span className="text-sm text-muted-foreground">
            Nenhuma vigência com comparação neste intervalo.
          </span>
        }
      />
    </div>
  );
}
