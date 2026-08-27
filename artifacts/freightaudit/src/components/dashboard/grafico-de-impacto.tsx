import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBrl, formatBrlShort, periodicitySuffix } from "@/lib/format";
import { seriesDoIntervalo } from "@/components/linha-do-tempo/linha-do-tempo-de-alteracoes";
import type { RangeEntry } from "@/lib/analise";

const COR_POSITIVA = "#059669"; // emerald-600 — o mesmo verde de ganho do resto da tela
const COR_NEGATIVA = "#dc2626"; // red-600 — o mesmo vermelho de perda do resto da tela
const COR_LIQUIDO = "hsl(var(--brand))";

/**
 * O empilhamento das duas barras, e a ordem em que o Recharts as acumula.
 *
 * Exportados porque é isto que o teste prende: ele roda o `getStackedData` do
 * próprio Recharts com estes dois valores e confere as faixas resultantes. Uma
 * cópia da constante no teste provaria que o teste concorda consigo mesmo —
 * lendo daqui, trocar `sign` por outra coisa no JSX quebra o teste.
 */
export const EMPILHAMENTO = "sign" as const;
export const SERIES_DA_BARRA = ["ganhos", "perdas"] as const;

export interface PontoDeImpacto {
  periodo: string;
  label: string;
  ganhos: number;
  perdas: number;
  liquido: number;
}

/**
 * Os pontos do gráfico de impacto — uma **vigência** por linha, na
 * periodicidade dominante da vigência aberta.
 *
 * Uma vigência, e não uma competência: `periodosOrdenados` são as datas de
 * `effective_date` que o contexto entregou, e uma unidade pode entregar duas
 * no mesmo mês. Chamá-las de competência fazia o eixo escrever `agosto/2026`
 * duas vezes e o subtítulo prometer "6 competências" para três meses de
 * calendário. O rótulo que as distingue vem pronto do servidor
 * (`rotuloCurtoDaVigencia`, `@workspace/comparison`), e não de uma segunda
 * régua escrita aqui.
 *
 * Não reimplementa a soma de ganhos/perdas por vigência: `seriesDoIntervalo`
 * (a mesma conta que a linha do tempo antiga usava) já devolve isso por
 * periodicidade; esta função só escolhe a periodicidade certa — a da vigência
 * corrente quando o intervalo tem dado nela, senão a que tiver mais
 * periodicidades disponíveis — e soma o líquido de cada ponto, que é
 * `ganhos + perdas` porque `perdas` já vem negativo.
 *
 * `periodicity` sai `null` quando o intervalo não tem nenhuma alteração
 * valorada — aí não há o que desenhar, e quem chama decide o que mostrar no
 * lugar do gráfico.
 */
export function pontosDeImpacto(
  periodosOrdenados: { date: string; label: string }[],
  entradas: RangeEntry[],
  periodicidadePreferida: string | null,
): { pontos: PontoDeImpacto[]; periodicity: string | null } {
  const { valor, periodicidades } = seriesDoIntervalo(periodosOrdenados, entradas);
  if (periodicidades.length === 0) return { pontos: [], periodicity: null };

  const periodicidade =
    periodicidadePreferida && periodicidades.includes(periodicidadePreferida)
      ? periodicidadePreferida
      : periodicidades[0];

  const base = valor.get(periodicidade) ?? [];
  return {
    pontos: base.map((ponto) => ({
      ...ponto,
      liquido: Number((ponto.ganhos + ponto.perdas).toFixed(2)),
    })),
    periodicity: periodicidade,
  };
}

/**
 * "Impacto das alterações por vigência" — o gráfico que substitui a linha
 * do tempo de duas séries separadas por uma leitura só: barras divergentes de
 * ganho e perda, com a linha do líquido passando por cima das duas.
 *
 * As duas barras somam `stackId` para ocuparem a mesma posição no eixo X, e
 * `stackOffset="sign"` é o que faz cada uma crescer a partir do zero para o
 * seu lado. Os dois andam juntos, e o segundo não é detalhe de estilo:
 *
 * O padrão do Recharts é `stackOffset="none"`, que acumula as séries na ordem
 * declarada **sem olhar o sinal**. Com ganhos positivos e perdas negativas
 * (`perdas` já vem negativo de `seriesDoIntervalo`), a barra vermelha era
 * desenhada de `ganhos` até `ganhos + perdas` — isto é, do topo do verde até o
 * líquido —, e não de zero até `perdas`. O efeito na tela era duplo e os dois
 * lados mentiam:
 *
 * - numa vigência de ganho grande e perda pequena (ganhos 90k, perdas −5k), o
 *   vermelho aparecia **acima do zero**, entre 85k e 90k, como se a perda
 *   fosse um valor positivo empilhado sobre o ganho;
 * - numa vigência de perda grande (ganhos 51k, perdas −123k), o vermelho ia de
 *   +51k a −72k e passava por cima do verde inteiro, que existia e ficava
 *   invisível — a tela mostrava a competência como se não tivesse tido ganho
 *   nenhum.
 *
 * Com `sign`, o Recharts separa a pilha positiva da negativa na mesma base:
 * ganhos ocupam `[0, ganhos]`, perdas ocupam `[perdas, 0]`, e as duas nunca
 * dividem pixel. A linha do líquido cruza o zero por conta própria, que é a
 * leitura que o cartão de Impacto líquido publica.
 */
export function GraficoDeImpacto({
  pontos,
  periodicity,
}: {
  pontos: PontoDeImpacto[];
  periodicity: string | null;
}) {
  if (pontos.length === 0 || periodicity === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma alteração valorada no intervalo recente.
      </p>
    );
  }

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-2">
        Ganhos e perdas por vigência, em R${periodicitySuffix(periodicity)} — últimas{" "}
        {pontos.length} {pontos.length === 1 ? "vigência" : "vigências"} com dado.
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={pontos}
          stackOffset={EMPILHAMENTO}
          margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="hsl(var(--muted-foreground))"
            tickFormatter={(v: number) => formatBrlShort(v)}
            width={92}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Tooltip formatter={(v: number) => formatBrl(v)} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey={SERIES_DA_BARRA[0]}
            name="Ganhos"
            stackId="impacto"
            fill={COR_POSITIVA}
            radius={[3, 3, 0, 0]}
          />
          <Bar
            dataKey={SERIES_DA_BARRA[1]}
            name="Perdas"
            stackId="impacto"
            fill={COR_NEGATIVA}
            radius={[0, 0, 3, 3]}
          />
          <Line
            type="monotone"
            dataKey="liquido"
            name="Líquido"
            stroke={COR_LIQUIDO}
            strokeWidth={2.5}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
