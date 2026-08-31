import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { escreverImpacto } from "@/lib/visao-geral";
import type { DegrauDaPonte, PonteDoImpacto } from "@/lib/impacto-apurado";

/**
 * A ponte — de onde veio o líquido apurado, família a família.
 *
 * É o gráfico principal do Impacto Apurado, e responde a pergunta que o número
 * grande deixa em aberto: *o resultado é a soma de quê?* Cada barra é uma
 * família de remuneração, começando onde a anterior terminou, e a última barra
 * é o líquido — que, por construção, é a altura em que a escada parou.
 *
 * **O desenho não calcula nada.** As alturas vêm de `ponteDoImpacto`
 * (`lib/impacto-apurado.ts`), que projeta `ExecutiveSummary.sides`; aqui só se
 * escolhe a cor e o rótulo. É por isso que a soma das barras é o número da
 * manchete, e não uma segunda conta que poderia divergir dela.
 *
 * A barra é uma **faixa** (`[base, topo]`) e não um valor solto: é assim que o
 * Recharts desenha um degrau que flutua no ar, e é o que permite ao eixo cruzar
 * o zero uma vez só. Verde sobe, vermelho desce, azul fecha — as mesmas cores
 * do resto do produto, sem nenhuma nova.
 */

const COR_GANHO = "#059669"; // emerald-600 — o mesmo verde de ganho do Dashboard
const COR_PERDA = "#dc2626"; // red-600 — o mesmo vermelho de perda
const COR_TOTAL = "hsl(var(--brand))";

interface LinhaDaPonte {
  code: string | null;
  nome: string;
  faixa: [number, number];
  valor: number;
  ganhos: number | null;
  perdas: number | null;
  alteracoes: number | null;
  total: boolean;
}

/** Os degraus mais a barra de fechamento, na forma que o Recharts desenha. */
export function linhasDaPonte(ponte: PonteDoImpacto): LinhaDaPonte[] {
  const degraus = ponte.degraus.map((d) => ({
    code: d.code,
    nome: d.name,
    faixa: [d.base, d.topo] as [number, number],
    valor: d.valor,
    ganhos: d.ganhos,
    perdas: d.perdas,
    alteracoes: d.alteracoes,
    total: false,
  }));
  return [
    ...degraus,
    {
      code: null,
      nome: "Impacto líquido",
      faixa: [0, ponte.total] as [number, number],
      valor: ponte.total,
      ganhos: null,
      perdas: null,
      alteracoes: null,
      total: true,
    },
  ];
}

/** O rótulo do eixo, cortado onde ele deixaria de caber. O nome inteiro fica na dica. */
const encurtar = (nome: string) => (nome.length > 16 ? `${nome.slice(0, 15)}…` : nome);

const corDa = (linha: LinhaDaPonte) =>
  linha.total ? COR_TOTAL : linha.valor >= 0 ? COR_GANHO : COR_PERDA;

export function PonteDoImpactoGrafico({
  ponte,
  onAbrirFamilia,
  className,
}: {
  ponte: PonteDoImpacto;
  /** `null` quando não há gaveta a abrir — a Visão Geral não tem unidade a quem perguntar. */
  onAbrirFamilia: ((code: string) => void) | null;
  className?: string;
}) {
  const linhas = linhasDaPonte(ponte);
  const sufixo = periodicitySuffix(ponte.periodicity);

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={linhas} margin={{ top: 24, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--card-border))" />
          <XAxis
            dataKey="nome"
            tick={{ fontSize: 11 }}
            /*
              Todos os degraus, sempre: o Recharts esconde rótulos quando eles
              não cabem, e um degrau sem nome é uma barra que ninguém sabe ler.
              O nome longo é encurtado com reticências — o completo continua na
              dica ao passar o mouse.
            */
            interval={0}
            tickFormatter={encurtar}
            height={54}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--card-border))" }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(valor: number) => formatBrlShort(valor)}
            width={86}
            tickLine={false}
            axisLine={false}
          />
          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
          <Tooltip
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const linha = payload[0].payload as LinhaDaPonte;
              return (
                <div className="rounded-lg border bg-card px-3 py-2 shadow-md text-xs">
                  <p className="font-bold text-sm">{linha.nome}</p>
                  <p className="tabular-nums mt-1">
                    {escreverImpacto({ periodicity: ponte.periodicity, amount: linha.valor })}
                  </p>
                  {/*
                    O saldo de uma família esconde as duas parcelas — o mesmo
                    motivo pelo qual `ImpactoDeFamilia` carrega os dois lados.
                    Uma barra verde curta pode ser R$ 40 mil de cada lado.
                  */}
                  {linha.ganhos !== null && linha.perdas !== null && (
                    <p className="text-muted-foreground mt-1 tabular-nums">
                      {formatBrlShort(linha.ganhos)} somaram · {formatBrlShort(linha.perdas)} saíram
                    </p>
                  )}
                  {linha.alteracoes !== null && (
                    <p className="text-muted-foreground mt-0.5 tabular-nums">
                      {linha.alteracoes.toLocaleString("pt-BR")}{" "}
                      {linha.alteracoes === 1 ? "alteração com preço" : "alterações com preço"}
                    </p>
                  )}
                  {onAbrirFamilia && !linha.total && (
                    <p className="text-brand font-semibold mt-1.5">Clique para abrir a família</p>
                  )}
                </div>
              );
            }}
          />
          <Bar
            dataKey="faixa"
            radius={[3, 3, 3, 3]}
            isAnimationActive={false}
            onClick={(dado: unknown) => {
              const linha = (dado as { payload?: LinhaDaPonte }).payload;
              if (onAbrirFamilia && linha?.code) onAbrirFamilia(linha.code);
            }}
          >
            {linhas.map((linha) => (
              <Cell
                key={linha.code ?? "total"}
                fill={corDa(linha)}
                cursor={onAbrirFamilia && linha.code ? "pointer" : "default"}
              />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>

      <Legenda sufixo={sufixo} />
      {/*
        A ponte fecha com o número da manchete por construção. O resto fica
        escrito, e não escondido: um gráfico que silencia a diferença entre a
        própria soma e o número que ele explica é pior do que não ter gráfico.
      */}
      {Math.abs(ponte.resto) >= 0.01 && (
        <p className="text-xs text-red-700 mt-2">
          As famílias somam {formatBrlShort(ponte.total - ponte.resto)} e o líquido apurado é{" "}
          {formatBrlShort(ponte.total)} — diferença de {formatBrlShort(ponte.resto)}.
        </p>
      )}
      {ponte.outras.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          Esta ponte é de {sufixo.replace("/", "") || "valor único"}. A vigência também tem valor em{" "}
          {ponte.outras.join(", ").toLowerCase()} — grandezas que não somam entre si.
        </p>
      )}
    </div>
  );
}

function Legenda({ sufixo }: { sufixo: string }) {
  const itens = [
    { cor: COR_GANHO, texto: "Aumenta" },
    { cor: COR_PERDA, texto: "Diminui" },
    { cor: COR_TOTAL, texto: "Total" },
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 mt-1 text-xs text-muted-foreground">
      {itens.map((item) => (
        <span key={item.texto} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.cor }} />
          {item.texto}
        </span>
      ))}
      {sufixo && <span className="tabular-nums">valores {sufixo.replace("/", "por ")}</span>}
    </div>
  );
}

export type { DegrauDaPonte };
