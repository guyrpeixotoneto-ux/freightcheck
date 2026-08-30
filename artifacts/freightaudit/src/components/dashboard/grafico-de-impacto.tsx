import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
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
import { EmAtualizacao, classeDeAtualizacao } from "@/components/ui/em-atualizacao";
import { seriesDoIntervalo } from "@/components/linha-do-tempo/linha-do-tempo-de-alteracoes";
import { vigenciaDoClique, type EstadoDoClique } from "@/lib/clique-na-vigencia";
import { SeletorDeJanela } from "@/components/ui/seletor-de-janela";
import {
  JANELA_PADRAO,
  QUANTIDADES,
  recorteDaJanela as recorteDeVigencias,
  type Janela,
} from "@/lib/janela-de-vigencias";
import type { RangeEntry } from "@/lib/analise";

/*
  A janela — "quantas, e de quê" — mora em `lib/janela-de-vigencias.ts`, junto
  com o corte que ela produz: a Linha do Tempo oferece a mesma escolha sobre o
  mesmo histórico, e duas cópias da regra discordariam sobre onde "3 meses"
  começa. Os nomes seguem exportados daqui porque é daqui que a tela e os
  testes deste gráfico os leem.
*/
export {
  JANELA_PADRAO,
  QUANTIDADES,
  TETO_DA_SERIE,
  UNIDADES,
  competenciaInicial,
  rotuloDaUnidade,
  type Janela,
  type UnidadeDaJanela,
} from "@/lib/janela-de-vigencias";

/** O corte da série pela janela aberta — a vigência de cada ponto é `periodo`. */
export function recorteDaJanela(pontos: PontoDeImpacto[], janela: Janela): PontoDeImpacto[] {
  return recorteDeVigencias(pontos, janela, (ponto) => ponto.periodo);
}

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
 *
 * O gráfico também é o eixo do tempo navegável da tela: clicar numa vigência
 * abre a tela **inteira** nela (`onEscolherVigencia`), e a vigência aberta é a
 * única acesa entre as barras (`vigenciaAtiva`). Quem lê o gráfico está
 * justamente comparando vigências — vir da barra de agosto até o menu "Trocar
 * vigência", no canto oposto do cabeçalho, para reencontrar ali a mesma data
 * que se acabou de apontar era o caminho longo para o pedido óbvio.
 */
export function GraficoDeImpacto({
  pontos,
  periodicity,
  carregando = false,
  vigenciaAtiva = null,
  onEscolherVigencia,
}: {
  pontos: PontoDeImpacto[];
  periodicity: string | null;
  /**
   * A série ainda está a caminho — ou o que há em tela é a do recorte
   * anterior. Sem este sinal, a espera e o intervalo sem nada valorado
   * desenhavam a mesma frase, e o gráfico afirmava "nenhuma alteração
   * valorada" a respeito de um dado que ainda não tinha chegado.
   */
  carregando?: boolean;
  /** A vigência que a tela está mostrando — é ela que fica acesa entre as barras. */
  vigenciaAtiva?: string | null;
  /** Quando existe, clicar numa barra leva a tela inteira para aquela vigência. */
  onEscolherVigencia?: (periodo: string) => void;
}) {
  /*
    A janela é estado do gráfico, não da página: trocar "últimas 6 vigências"
    por "últimos 12 meses" é um recorte do que já veio na mesma consulta — a
    série é buscada até `TETO_DA_SERIE` e cortada aqui. Trocar a janela não
    dispara requisição nenhuma, e por isso o gráfico não pisca na troca.
  */
  const [janela, setJanela] = useState<Janela>(JANELA_PADRAO);
  const desenhados = recorteDaJanela(pontos, janela);

  if (pontos.length === 0 || periodicity === null) {
    /*
      Sem série ainda, a moldura fica no lugar com a altura que o gráfico vai
      ter (os 300px do `ResponsiveContainer` mais a linha do subtítulo): a tela
      não pula quando as barras chegam, e a frase sobre o intervalo só aparece
      quando há intervalo lido para falar dele.
    */
    if (carregando) {
      return (
        <div
          data-testid="grafico-carregando"
          role="status"
          aria-label="Carregando o gráfico de impacto"
          className="h-[326px] rounded-md bg-muted/40 animate-pulse"
        />
      );
    }
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma alteração valorada no intervalo recente.
      </p>
    );
  }

  /*
    Só há o que escolher se houver mais de uma vigência desenhada: com uma
    barra só, o clique levaria à mesma tela e o cursor de mão prometeria uma
    navegação que não acontece.
  */
  const clicavel = typeof onEscolherVigencia === "function" && desenhados.length > 1;

  const aoClicar = (estado: EstadoDoClique) => {
    if (!clicavel) return;
    const periodo = vigenciaDoClique(estado, vigenciaAtiva);
    if (periodo !== null) onEscolherVigencia!(periodo);
  };

  /*
    A vigência aberta fica opaca e as outras desbotam. É o que faz o gráfico
    responder "onde eu estou" além de "o que aconteceu" — depois de um clique,
    a tela inteira muda e a barra acesa é a única confirmação visual de que
    ela mudou para a vigência que se pediu, e não para outra.

    Sem `vigenciaAtiva` na janela desenhada (a Visão Geral numa competência
    que nenhuma unidade entregou, por exemplo) nada desbota: acender ninguém é
    honesto, desbotar todo mundo só apagaria o gráfico.
  */
  const temAtiva = desenhados.some((ponto) => ponto.periodo === vigenciaAtiva);
  const opacidade = (ponto: PontoDeImpacto) =>
    !temAtiva || ponto.periodo === vigenciaAtiva ? 1 : 0.35;

  /*
    Com série em tela e leitura a caminho, o gráfico mostra a **anterior** — e
    diz isso, com o mesmo par que o resto da tela usa na troca de recorte
    (`components/ui/em-atualizacao.tsx`): desbotado, e com o selo ao lado do
    subtítulo. Manter o gráfico da unidade anterior sem declará-lo seria trocar
    um vazio por uma afirmação falsa, que é o que aquele contrato proíbe.
  */
  return (
    <div className={classeDeAtualizacao(carregando)}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="text-xs text-muted-foreground">
          Ganhos e perdas por vigência, em R${periodicitySuffix(periodicity)} — últimas{" "}
          {desenhados.length} {desenhados.length === 1 ? "vigência" : "vigências"} com dado.
          {clicavel && " Clique numa vigência para abrir a tela inteira nela."}
          <EmAtualizacao ativo={carregando} className="ml-2 align-middle" />
        </div>
        {/*
          O seletor só aparece quando há mais dado do que a menor janela mostra:
          com três vigências no banco, todos os botões desenhariam o mesmo
          gráfico e prometeriam uma escolha que não existe.
        */}
        {pontos.length > QUANTIDADES[0] && (
          <SeletorDeJanela janela={janela} onJanela={setJanela} />
        )}
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart
          data={desenhados}
          stackOffset={EMPILHAMENTO}
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
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <Tooltip formatter={(v: number) => formatBrl(v)} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey={SERIES_DA_BARRA[0]}
            name="Ganhos"
            stackId="impacto"
            fill={COR_POSITIVA}
            radius={[3, 3, 0, 0]}
          >
            {desenhados.map((ponto) => (
              <Cell key={ponto.periodo} fillOpacity={opacidade(ponto)} />
            ))}
          </Bar>
          <Bar
            dataKey={SERIES_DA_BARRA[1]}
            name="Perdas"
            stackId="impacto"
            fill={COR_NEGATIVA}
            radius={[0, 0, 3, 3]}
          >
            {desenhados.map((ponto) => (
              <Cell key={ponto.periodo} fillOpacity={opacidade(ponto)} />
            ))}
          </Bar>
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
