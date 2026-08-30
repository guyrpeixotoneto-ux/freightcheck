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
import type { RangeEntry } from "@/lib/analise";
import { cn } from "@/lib/utils";

/**
 * As duas maneiras de encurtar o gráfico, e por que são duas.
 *
 * **Vigências** conta barras: "as últimas 6 entregues", sem perguntar quando
 * foram. É a janela que sempre desenha alguma coisa, e por isso é o padrão.
 *
 * **Meses** conta calendário: "os últimos 6 meses de vigência". Responde a
 * outra pergunta — não "as últimas seis", e sim "o que mudou desde o meio do
 * ano" —, e as duas divergem exatamente quando a leitura fica interessante: um
 * mês com duas vigências gasta duas barras da janela por vigências e um mês só
 * da janela por meses.
 *
 * O que o gráfico não oferece é janela em **dias**: o eixo é a vigência
 * entregue, e "últimos 7 dias" sobre competências mensais desenharia quase
 * sempre nenhuma barra — um recorte que responde "não houve movimento" quando
 * o que falta é vigência no intervalo, não alteração no contrato.
 */
export const QUANTIDADES = [3, 6, 12] as const;

export const UNIDADES = ["vigencias", "meses"] as const;

export type UnidadeDaJanela = (typeof UNIDADES)[number];

/** O rótulo do botão de unidade — sempre no plural, que é como o seletor lê. */
export const rotuloDaUnidade = (unidade: UnidadeDaJanela) =>
  unidade === "meses" ? "meses" : "vigências";

export interface Janela {
  unidade: UnidadeDaJanela;
  quantidade: number;
}

/** A janela aberta por padrão — a mesma que o gráfico desenhava antes do seletor. */
export const JANELA_PADRAO: Janela = { unidade: "vigencias", quantidade: 6 };

/**
 * Quantas vigências a série precisa carregar para qualquer janela caber.
 *
 * Não são as 12 da maior janela por vigências: doze **meses** podem conter
 * mais de doze vigências — duas no mesmo mês são o caso que o próprio gráfico
 * desenha separadas —, e a série cortada em doze deixaria a janela de 12 meses
 * mentindo por baixo, escondendo vigências que existem dentro do intervalo que
 * ela promete. O dobro cobre um ano inteiro de vigências quinzenais.
 */
export const TETO_DA_SERIE = 2 * Math.max(...QUANTIDADES);

/** A competência (`YYYY-MM`) de uma data `YYYY-MM-DD`. */
const competencia = (data: string) => data.slice(0, 7);

/**
 * A primeira competência que uma janela de `meses` aceita, contada de trás
 * para frente a partir de `ancora` — **incluindo** o mês da âncora: "últimos 3
 * meses" com âncora em agosto começa em junho, e não em maio. É a leitura de
 * quem pede três meses e espera três meses na tela.
 */
export function competenciaInicial(ancora: string, meses: number): string {
  const [ano, mes] = competencia(ancora).split("-").map(Number);
  const deslocado = (ano * 12 + (mes - 1)) - (meses - 1);
  const anoInicial = Math.floor(deslocado / 12);
  const mesInicial = (deslocado % 12) + 1;
  return `${String(anoInicial).padStart(4, "0")}-${String(mesInicial).padStart(2, "0")}`;
}

/**
 * O recorte que vai para a tela.
 *
 * A janela por meses é ancorada na **última vigência da série**, e não em
 * hoje. Um contrato cuja vigência mais recente é de três meses atrás não tem
 * nada de errado — ele só não mudou desde então —, e ancorar no relógio faria
 * o gráfico dele apagar por completo, respondendo "nada aconteceu" a quem
 * perguntou "o que aconteceu". Ancorado na série, "últimos 6 meses" é sempre
 * meio ano de história a partir do último movimento conhecido.
 */
export function recorteDaJanela(pontos: PontoDeImpacto[], janela: Janela): PontoDeImpacto[] {
  if (janela.unidade === "vigencias") return pontos.slice(-janela.quantidade);
  const ancora = pontos[pontos.length - 1];
  if (!ancora) return [];
  const inicial = competenciaInicial(ancora.periodo, janela.quantidade);
  return pontos.filter((ponto) => competencia(ponto.periodo) >= inicial);
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

          São dois grupos e não seis botões soltos: o número e a unidade são
          duas perguntas independentes ("quantas?" e "de quê?"), e trocar de
          unidade preserva o número já escolhido — quem está em 6 vigências e
          quer 6 meses dá um clique, não dois.
        */}
        {pontos.length > QUANTIDADES[0] && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1" role="group" aria-label="Tamanho da janela">
              {QUANTIDADES.map((quantidade) => (
                <button
                  key={quantidade}
                  type="button"
                  onClick={() => setJanela((atual) => ({ ...atual, quantidade }))}
                  aria-pressed={janela.quantidade === quantidade}
                  title={`Mostrar ${quantidade} ${rotuloDaUnidade(janela.unidade)}`}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-xs font-semibold transition-colors",
                    janela.quantidade === quantidade
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {quantidade}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="Unidade da janela">
              {UNIDADES.map((unidade) => (
                <button
                  key={unidade}
                  type="button"
                  onClick={() => setJanela((atual) => ({ ...atual, unidade }))}
                  aria-pressed={janela.unidade === unidade}
                  title={`Contar a janela em ${rotuloDaUnidade(unidade)}`}
                  className={cn(
                    "rounded-lg border px-2 py-1 text-xs font-semibold transition-colors",
                    janela.unidade === unidade
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {rotuloDaUnidade(unidade)}
                </button>
              ))}
            </div>
          </div>
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
