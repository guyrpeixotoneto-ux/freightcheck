import {
  Area,
  ComposedChart,
  CartesianGrid,
  Dot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { SeletorDeJanela } from "@/components/ui/seletor-de-janela";
import { recorteDaJanela, type PontoDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import type { Janela } from "@/lib/janela-de-vigencias";
import { extremosDaSerie } from "@/lib/impacto-apurado";

/**
 * A evolução do impacto apurado, vigência a vigência.
 *
 * O eixo é a **vigência entregue**, e não o mês de calendário: uma unidade pode
 * entregar duas vigências no mesmo mês, e chamá-las de competência faria o eixo
 * escrever agosto duas vezes. É a mesma série do Impacto Líquido
 * (`useSerieDeImpacto`), lida da mesma consulta e do mesmo cache — o que muda é
 * o desenho, não o dado.
 *
 * A linha é **reta entre os pontos** de propósito. Uma curva suavizada
 * desenharia valores entre duas vigências, e entre duas vigências não existe
 * medida nenhuma: existe o intervalo em que o contrato não mudou. Os pontos
 * ficam marcados um a um pela mesma razão.
 *
 * A janela ("3 | 6 | 12", em vigências ou meses) é a mesma escolha que o
 * gráfico do Impacto Líquido e a Linha do Tempo oferecem, e o corte é o mesmo
 * (`lib/janela-de-vigencias.ts`) — três telas discordando sobre onde "3 meses"
 * começa é o defeito que aquele arquivo existe para não ter.
 */
export function EvolucaoPorVigencia({
  pontos,
  periodicity,
  janela,
  onJanela,
  vigenciaAberta,
  onEscolherVigencia,
  carregando,
  className,
}: {
  pontos: PontoDeImpacto[];
  periodicity: string | null;
  janela: Janela;
  onJanela: (janela: Janela) => void;
  vigenciaAberta: string | null;
  onEscolherVigencia: ((periodo: string) => void) | null;
  carregando: boolean;
  className?: string;
}) {
  const naJanela = recorteDaJanela(pontos, janela);
  const extremos = extremosDaSerie(naJanela);
  const sufixo = periodicitySuffix(periodicity);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-bold">Evolução por vigência</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Impacto líquido apurado{sufixo ? ` (R$${sufixo})` : ""}
          </p>
        </div>
        {pontos.length > 3 && <SeletorDeJanela janela={janela} onJanela={onJanela} />}
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground py-16 text-center">Carregando a série…</p>
      ) : naJanela.length === 0 ? (
        <p className="text-sm text-muted-foreground py-16 text-center">
          Nenhuma vigência com valor apurado no intervalo.
        </p>
      ) : naJanela.length === 1 ? (
        /*
          Um ponto só não é uma evolução. Desenhá-lo como gráfico prometeria
          uma tendência que a série não tem — a leitura honesta é o valor
          daquela vigência, dito por extenso.
        */
        <div className="py-12 text-center">
          <p className="text-2xl font-extrabold tabular-nums">
            {formatBrlShort(naJanela[0].liquido)}
            {sufixo && <span className="text-sm font-normal text-muted-foreground">{sufixo}</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {naJanela[0].label} é a única vigência com valor apurado no intervalo — não há evolução
            a desenhar ainda.
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={216} className="mt-3">
          <ComposedChart data={naJanela} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--card-border))" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "hsl(var(--card-border))" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => formatBrlShort(v)}
              width={78}
              tickLine={false}
              axisLine={false}
            />
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
            <Tooltip
              cursor={{ stroke: "hsl(var(--brand))", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const ponto = payload[0].payload as PontoDeImpacto;
                return (
                  <div className="rounded-lg border bg-card px-3 py-2 shadow-md text-xs">
                    <p className="font-bold">{ponto.label}</p>
                    <p className="tabular-nums mt-1">
                      {formatBrlShort(ponto.liquido)}
                      {sufixo}
                    </p>
                    {/*
                      Só o líquido, e é decisão de reconciliação, não de espaço.
                      A série parte de `/changes/range`, que separa ganho de
                      perda pelo sinal **do grupo**; a manchete separa pelo sinal
                      **da linha** (`ExecutiveSummary.sides`). Os líquidos são o
                      mesmo número — as duas somam as mesmas linhas
                      desduplicadas —, mas os dois lados não batem quando um
                      grupo se moveu nos dois sentidos. Publicar aqui um "somaram
                      / saíram" diferente do cartão acima, sobre a mesma
                      vigência, seria a tela se contradizendo a dois palmos de
                      distância.
                    */}
                  </div>
                );
              }}
            />
            <Area
              type="linear"
              dataKey="liquido"
              stroke="hsl(var(--brand))"
              strokeWidth={2}
              fill="hsl(var(--brand))"
              fillOpacity={0.08}
              isAnimationActive={false}
              activeDot={{ r: 5 }}
              dot={(props: { cx?: number; cy?: number; payload?: PontoDeImpacto; index?: number }) => {
                const aberta = props.payload?.periodo === vigenciaAberta;
                return (
                  <Dot
                    key={props.payload?.periodo ?? props.index}
                    cx={props.cx}
                    cy={props.cy}
                    r={aberta ? 5 : 3.5}
                    fill={aberta ? "hsl(var(--brand))" : "hsl(var(--card))"}
                    stroke="hsl(var(--brand))"
                    strokeWidth={2}
                    style={{ cursor: onEscolherVigencia ? "pointer" : "default" }}
                    onClick={() => {
                      if (onEscolherVigencia && props.payload) {
                        onEscolherVigencia(props.payload.periodo);
                      }
                    }}
                  />
                );
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      {extremos && (
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t">
          <Extremo
            titulo="Melhor vigência"
            label={extremos.melhor.label}
            valor={extremos.melhor.liquido}
            sufixo={sufixo}
          />
          <Extremo
            titulo="Pior vigência"
            label={extremos.pior.label}
            valor={extremos.pior.liquido}
            sufixo={sufixo}
          />
        </div>
      )}
    </div>
  );
}

function Extremo({
  titulo,
  label,
  valor,
  sufixo,
}: {
  titulo: string;
  label: string;
  valor: number;
  sufixo: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="text-sm font-semibold truncate">{label}</p>
      <p
        className={cn(
          "text-base font-extrabold tabular-nums",
          valor < 0 ? "text-red-700" : "text-emerald-700",
        )}
      >
        {formatBrlShort(valor)}
        {sufixo && <span className="text-xs font-normal text-muted-foreground">{sufixo}</span>}
      </p>
    </div>
  );
}
