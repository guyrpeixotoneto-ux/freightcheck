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
import {
  periodicidadePrincipal,
  periodicidadesDaLeitura,
  type PeriodicidadeApurada,
} from "@workspace/comparison/contrato-de-impacto";

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

/**
 * Por que uma vigência do recorte não tem número — e nunca um R$ 0 no lugar.
 *
 * Zero é uma afirmação sobre o dinheiro ("apurou-se, e não moveu nada"), e
 * quatro coisas diferentes eram desenhadas como ela: a vigência sem preço
 * apurado, a vigência cujo dinheiro está noutra grandeza, a vigência sem
 * comparação calculada, e o zero de verdade. As três primeiras são lacunas —
 * ausência de medida —, e o gráfico as deixa em branco.
 */
export type MotivoDaLacuna =
  | "SEM_PRECO"
  | "OUTRA_GRANDEZA"
  | "SEM_COMPARACAO"
  /**
   * Apurado, e em R$ 0,00 — sem eixo em que desenhar.
   *
   * É o único dos quatro que **não** é desconhecido: a conta aconteceu e não
   * moveu nada. Ele só vira lacuna quando o recorte inteiro é assim e não há
   * grandeza nenhuma com movimento para servir de eixo; aí o gráfico diz "R$
   * 0,00 apurado", que é o oposto de "não se sabe".
   */
  | "SEM_MOVIMENTO";

export interface LacunaDoPonto {
  motivo: MotivoDaLacuna;
  /** Uma palavra para a tela — "sem preço apurado". */
  curto: string;
  /** A frase inteira, para o `title` e o tooltip. */
  porque: string;
}

export interface PontoDeImpacto {
  periodo: string;
  label: string;
  /**
   * Os três saem `null` na vigência **sem medida** — ver {@link LacunaDoPonto}.
   *
   * `null` e `0` são fatos diferentes, e o Recharts os desenha diferentes: o
   * zero é um ponto na linha de base, o `null` é buraco na linha e barra que
   * não existe. Era isso que faltava para o gráfico parar de afirmar "não
   * moveu nada" sobre o que ninguém apurou.
   */
  ganhos: number | null;
  perdas: number | null;
  liquido: number | null;
  /** `null` quando a vigência tem número. */
  lacuna?: LacunaDoPonto | null;
}

/** Quantas vigências do recorte têm medida, e por que as outras não têm. */
export interface CoberturaDoRecorte {
  desenhadas: number;
  calculadas: number;
  semPreco: number;
  outraGrandeza: number;
  semComparacao: number;
  /** Apuradas, e em R$ 0,00 — ver {@link MotivoDaLacuna}. */
  semMovimento: number;
}

/**
 * O contorno que separa lacuna de zero — o que `entries` sozinho não conta.
 *
 * `entries` traz os grupos de alteração; uma vigência **sem** grupo nenhum
 * pode ser "nada mudou" (zero de verdade) ou "não há comparação calculada"
 * (lacuna), e as duas chegam aqui como lista vazia. Quem lê o intervalo sabe
 * a diferença — `movements` e `gaps` de `/changes/range` — e passa por aqui.
 *
 * Sem contorno, a vigência sem grupo é tratada como **lacuna**, e não como
 * zero: entre afirmar um zero que ninguém apurou e admitir que não se sabe, a
 * régua do produto é admitir.
 */
export interface ContornoDoRecorte {
  movimentos?: readonly { period: string; changes: number }[];
  gaps?: readonly { period: string }[];
  /**
   * A ponta de partida do intervalo lido — `from` de `/changes/range`.
   *
   * Ela não é uma transição: o intervalo são os passos que **vão** dela até o
   * fim, e por isso ela não aparece em `movements`. Sem este campo, ela caía
   * na vala do "não vi alteração" e era desenhada em R$ 0 — um ponto de
   * partida no zero, que o gráfico ligava ao primeiro valor como se a queda
   * tivesse acontecido ali.
   */
  inicio?: string | null;
}

/**
 * Os pontos do gráfico de impacto — uma **vigência** por linha, na grandeza
 * que o **recorte desenhado** elegeu.
 *
 * O recorte, e não o intervalo carregado: `periodosOrdenados` são as vigências
 * que a tela mostra (3, 6 ou 12), e tudo o que esta função decide — o eixo, a
 * unidade, quais vigências ficam em branco — sai delas. Ver a nota no corpo.
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
 * periodicidade; esta função só escolhe a periodicidade certa — pelo contrato
 * (`periodicidadePrincipal`), e nunca por uma régua escrita aqui — e soma o
 * líquido de cada ponto, que é `ganhos + perdas` porque `perdas` já vem
 * negativo.
 *
 * A preferência da vigência aberta continua valendo, com uma condição que
 * faltava: ela precisa **ter movimento** no recorte desenhado. Sem essa
 * condição, um balde apurado em R$ 0,00 ganhava o eixo e escondia o balde onde
 * estava o dinheiro todo — o defeito de 18/09/2026.
 *
 * `periodicity` sai `null` quando o intervalo não tem nenhuma alteração
 * valorada — aí não há o que desenhar, e quem chama decide o que mostrar no
 * lugar do gráfico.
 */
export function pontosDeImpacto(
  periodosOrdenados: { date: string; label: string }[],
  entradas: RangeEntry[],
  periodicidadePreferida: string | null,
  contorno: ContornoDoRecorte = {},
): {
  pontos: PontoDeImpacto[];
  periodicity: string | null;
  /**
   * As grandezas que o recorte desenhado **tem** — todas, na ordem do contrato.
   *
   * Devolvidas para que a tela possa oferecer a troca em vez de o gráfico
   * escolher calado. Enquanto só o eixo saía daqui, R$/mês e R$/ano existiam no
   * mesmo intervalo e quem lia via um só, sem nada dizendo que havia outro.
   */
  disponiveis: PeriodicidadeApurada[];
  /** Quantas do recorte têm medida — e por que as outras não têm. */
  cobertura: CoberturaDoRecorte;
} {
  /*
    O recorte é a população inteira desta função — **a correção de 18/09/2026,
    segunda parte**.

    `entradas` chega com o intervalo carregado (até `TETO_DA_SERIE` vigências),
    e o que a tela desenha são as 3, 6 ou 12 de `periodosOrdenados`. Enquanto
    as entradas não eram filtradas, uma vigência fora do recorte decidia o eixo
    por lá de fora: uma alteração anual de meio milhão em janeiro ganhava a
    magnitude, o eixo saía em R$/ano, e as seis vigências desenhadas — todas
    mensais — viravam seis pontos colados no zero, ao lado de um seletor
    anunciando dezenas de milhares de reais por mês. Fora do recorte é fora da
    conta: do eixo, da unidade e da frase.
  */
  const doRecorte = new Set(periodosOrdenados.map((p) => p.date));
  const noRecorte = entradas.filter((e) => doRecorte.has(e.period));

  /*
    O que cada vigência **apurou**, por grandeza — inclusive em R$ 0,00.

    `seriesDoIntervalo` soma só o que tem sinal (`amount !== 0`), que é o certo
    para a soma e insuficiente para a pergunta desta função: uma vigência
    apurada em R$ 0,00 tem medida, e o zero dela é um zero de verdade. Sem este
    segundo passo, ela cairia na mesma vala da vigência sem preço nenhum.
  */
  const apuradasPorPeriodo = new Map<string, Set<string>>();
  const comAlteracao = new Set<string>();
  for (const entrada of noRecorte) {
    comAlteracao.add(entrada.period);
    if (entrada.confidence !== "CALCULATED" || entrada.amount === null) continue;
    const balde = entrada.periodicity ?? "SEM_PERIODICIDADE";
    const jaTem = apuradasPorPeriodo.get(entrada.period) ?? new Set<string>();
    jaTem.add(balde);
    apuradasPorPeriodo.set(entrada.period, jaTem);
  }
  for (const linha of contorno.movimentos ?? []) {
    if (linha.changes > 0) comAlteracao.add(linha.period);
  }
  const semComparacao = new Set((contorno.gaps ?? []).map((g) => g.period));
  /*
    Sem `movements`, "não vi alteração nenhuma" não prova "não houve alteração
    nenhuma" — ver `ContornoDoRecorte`. A vigência muda para lacuna, nunca para
    zero.
  */
  const sabeQuemNaoMudou = (contorno.movimentos ?? []).length > 0;
  const naoMudou = new Set(
    (contorno.movimentos ?? []).filter((l) => l.changes === 0).map((l) => l.period),
  );
  /*
    Quem o intervalo **mediu**. Uma vigência de dentro do recorte que não está
    aqui não foi medida: é a ponta de partida (`inicio`), ou uma vigência sem
    comparação calculada. Nenhuma das duas é zero.
  */
  const medidas = new Set((contorno.movimentos ?? []).map((l) => l.period));

  const { valor, periodicidades } = seriesDoIntervalo(periodosOrdenados, noRecorte);

  /*
    A escolha é a do contrato, e não uma régua deste arquivo.

    Era `preferida se o balde existir, senão a de maior magnitude`, e as duas
    metades estavam erradas. Existir não é ter dinheiro: um balde apurado
    inteiramente em R$ 0,00 existe, vencia a preferência e desenhava o gráfico
    chapado no zero. E a magnitude sozinha perde para o líquido compensado —
    R$ 120 mil de ganho contra R$ 120 mil de perda é a vigência mais
    movimentada do semestre e sai como zero.

    `periodicidadePrincipal` decide pelas duas coisas certas, na ordem certa:
    quem **tem movimento** primeiro, depois quem moveu mais bruto. E decide
    igual aqui, no seletor, no cartão e na janela — que é o ponto inteiro.
  */
  const disponiveis = periodicidadesDaSerie(valor, periodicidades);
  const periodicidade = periodicidadePrincipal(disponiveis, periodicidadePreferida);

  /*
    Sem grandeza nenhuma apurada, o recorte inteiro é lacuna — e continua sendo
    **um recorte**, com as suas vigências: quem desenha precisa delas para
    dizer quantas são e por que estão em branco. Devolver lista vazia era o que
    fazia a tela cair na frase genérica de intervalo sem dado.
  */
  const lacunaDe = (periodo: string): LacunaDoPonto | null => {
    if (semComparacao.has(periodo))
      return {
        motivo: "SEM_COMPARACAO",
        curto: "sem comparação",
        porque:
          "Vigência importada sem comparação calculada: o que houve aqui não está somado — e não é zero.",
      };
    if (periodicidade !== null && apuradasPorPeriodo.get(periodo)?.has(periodicidade)) return null;
    if ((apuradasPorPeriodo.get(periodo)?.size ?? 0) > 0)
      return periodicidade === null
        ? {
            /*
              Sem eixo nenhum no recorte, esta vigência não está sem preço: ela
              está apurada em R$ 0,00. Chamá-la de desconhecida seria o erro
              simétrico ao que esta entrega corrige.
            */
            motivo: "SEM_MOVIMENTO",
            curto: "apurado em R$ 0,00",
            porque: "A apuração aconteceu nesta vigência e não moveu dinheiro nenhum.",
          }
        : {
            motivo: "OUTRA_GRANDEZA",
            curto: "outra grandeza",
            porque:
              "Esta vigência apurou valor noutra grandeza, que não soma com a deste eixo — por isso ela fica em branco, e não em R$ 0.",
          };
    if (sabeQuemNaoMudou && !medidas.has(periodo))
      return periodo === contorno.inicio
        ? {
            motivo: "SEM_COMPARACAO",
            curto: "ponta de partida",
            porque:
              "É a vigência de onde o intervalo parte: não há transição anterior a ela para somar aqui.",
          }
        : {
            motivo: "SEM_COMPARACAO",
            curto: "sem comparação",
            porque:
              "Vigência importada sem comparação calculada: o que houve aqui não está somado — e não é zero.",
          };
    if (sabeQuemNaoMudou && naoMudou.has(periodo)) return null;
    if (comAlteracao.has(periodo) || !sabeQuemNaoMudou)
      return {
        motivo: "SEM_PRECO",
        curto: "sem preço apurado",
        porque:
          "As alterações desta vigência não têm preço apurado: o resultado é desconhecido, não zero.",
      };
    return null;
  };

  const base = valor.get(periodicidade ?? "") ?? [];
  const somas = new Map(base.map((ponto) => [ponto.periodo, ponto]));
  const pontos = periodosOrdenados.map((periodo) => {
    const lacuna = lacunaDe(periodo.date);
    if (lacuna !== null) {
      return {
        periodo: periodo.date,
        label: periodo.label,
        ganhos: null,
        perdas: null,
        liquido: null,
        lacuna,
      };
    }
    const soma = somas.get(periodo.date) ?? { ganhos: 0, perdas: 0 };
    return {
      periodo: periodo.date,
      label: periodo.label,
      ganhos: soma.ganhos,
      perdas: soma.perdas,
      liquido: Number((soma.ganhos + soma.perdas).toFixed(2)),
      lacuna: null,
    };
  });

  const conta = (motivo: MotivoDaLacuna) =>
    pontos.filter((p) => p.lacuna?.motivo === motivo).length;

  return {
    pontos,
    periodicity: periodicidade,
    disponiveis,
    cobertura: {
      desenhadas: pontos.length,
      calculadas: pontos.filter((p) => p.lacuna === null).length,
      semPreco: conta("SEM_PRECO"),
      outraGrandeza: conta("OUTRA_GRANDEZA"),
      semComparacao: conta("SEM_COMPARACAO"),
      semMovimento: conta("SEM_MOVIMENTO"),
    },
  };
}

/**
 * A série da janela, na forma do contrato — uma `PeriodicidadeApurada` por balde.
 *
 * O adaptador existe porque o gráfico não lê uma leitura pronta: ele lê a série
 * já recortada pela janela aberta (3, 6 ou 12 vigências), e o movimento que
 * decide o eixo é o **do recorte desenhado**, não o da vigência. Montar o
 * contrato aqui é o que faz a decisão do eixo obedecer à mesma régua do resto,
 * sobre a população que a tela de fato mostra.
 */
export function periodicidadesDaSerie(
  valor: Map<string, { ganhos: number; perdas: number }[]>,
  periodicidades: string[],
): PeriodicidadeApurada[] {
  return periodicidadesDaLeitura(
    {
      byPeriodicity: Object.fromEntries(
        periodicidades.map((p) => [
          p,
          (valor.get(p) ?? []).reduce((soma, x) => soma + x.ganhos + x.perdas, 0),
        ]),
      ),
    },
    periodicidades.map((p) => {
      const pontos = valor.get(p) ?? [];
      const ganhos = pontos.reduce((soma, x) => soma + x.ganhos, 0);
      const perdas = pontos.reduce((soma, x) => soma + x.perdas, 0);
      return {
        periodicity: p,
        net: Number((ganhos + perdas).toFixed(2)),
        // A contagem de alterações não é da série; o contrato não a inventa.
        gains: { total: Number(ganhos.toFixed(2)), changes: 0 },
        losses: { total: Number(perdas.toFixed(2)), changes: 0 },
      };
    }),
  );
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
  janela: janelaPedida,
  onJanela,
  carregadas,
  cobertura = null,
  periodicidades = [],
  onPeriodicidade,
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
  /**
   * A janela, quando quem manda nela é a página — e por que isso existe.
   *
   * Ela nasceu como estado do gráfico, e continua sendo isso por padrão: trocar
   * "últimas 6 vigências" por "últimos 12 meses" é um recorte do que já veio na
   * mesma consulta, sem requisição nenhuma, e nenhuma outra tela precisava saber
   * qual recorte estava aberto.
   *
   * O Panorama precisa: lá o gráfico divide a dobra com um cartão que lê o
   * **mesmo** intervalo por parâmetro, e um seletor que mudasse só o desenho
   * deixaria os dois falando de janelas diferentes lado a lado — seis vigências
   * no gráfico e nove no cartão ao lado, sem nada acusando. Passadas as duas
   * pontas, a página é a dona; sem elas, o estado local segue mandando, e o
   * Dashboard não muda.
   */
  janela?: Janela;
  onJanela?: (janela: Janela) => void;
  /**
   * Quantas vigências o intervalo **carregou** — e não quantas estão em tela.
   *
   * Existe por uma razão só: decidir se o seletor de janela aparece. Enquanto
   * o gráfico recebia a série inteira e recortava aqui dentro, `pontos.length`
   * respondia isso sozinho; agora quem recorta é quem lê o intervalo (ver
   * `useSerieDeImpacto`), porque é o recorte que decide a grandeza do eixo, e
   * o gráfico desenha o que recebe. Sem este número ele ofereceria "12
   * vigências" a quem tem seis.
   */
  carregadas?: number;
  /** A cobertura do recorte — a linha que diz quantas vigências ficaram em branco. */
  cobertura?: CoberturaDoRecorte | null;
  /**
   * As grandezas que este recorte tem — de `pontosDeImpacto`.
   *
   * Com mais de uma **com movimento**, o gráfico oferece a troca em vez de
   * publicar uma calada. Não somar as duas continua valendo; o que muda é que
   * a segunda deixa de ser invisível.
   */
  periodicidades?: PeriodicidadeApurada[];
  onPeriodicidade?: (periodicity: string) => void;
}) {
  const [janelaLocal, setJanelaLocal] = useState<Janela>(JANELA_PADRAO);
  const janela = janelaPedida ?? janelaLocal;
  const trocarJanela = onJanela ?? setJanelaLocal;
  /*
    O que chega é o que se desenha. O recorte acontece antes, em quem lê o
    intervalo, porque é ele que decide a grandeza do eixo: recortar aqui
    embaixo fazia a decisão acontecer sobre uma população e o desenho sobre
    outra — o defeito das seis barras no zero em R$/ano.
  */
  const desenhados = pontos;
  const comMedida = desenhados.filter((ponto) => ponto.liquido !== null);
  const totalCarregado = carregadas ?? pontos.length;

  if (pontos.length === 0) {
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
    O recorte inteiro sem medida — e a frase que o diz.

    É o estado que o gráfico não tinha: com todas as vigências do recorte sem
    preço apurado, ele desenhava seis pontos no zero e uma linha reta em cima
    deles, que é a figura de "nada mudou" — a afirmação oposta à verdadeira.
    Aqui não há o que desenhar, e a tela diz o que há: alteração detectada sem
    preço, resultado desconhecido.

    O seletor de janela continua na tela de propósito: o recorte vizinho pode
    ter o dado que falta a este, e tirá-lo daqui seria prender quem chegou no
    recorte vazio. O de grandeza não vem junto porque aqui não há grandeza
    nenhuma a oferecer — seria um botão para uma série que não existe.
  */
  if (comMedida.length === 0 || periodicity === null) {
    /*
      O recorte apurado inteiro em R$ 0,00 não é desconhecido — é zero, e a
      tela diz zero. As duas frases existem porque as duas situações pedem
      ações opostas: uma é trabalho de Curadoria, a outra é notícia.
    */
    const tudoApuradoEmZero = desenhados.every((p) => p.lacuna?.motivo === "SEM_MOVIMENTO");
    return (
      <div className={classeDeAtualizacao(carregando)} data-testid="grafico-sem-apuracao">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold">
              {tudoApuradoEmZero
                ? "Apurado, e sem efeito financeiro"
                : "Impacto financeiro ainda não calculado"}
            </p>
            <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
              {tudoApuradoEmZero
                ? "As alterações deste período foram apuradas em R$ 0,00 — o resultado é zero, e não uma ausência."
                : "As alterações deste período ainda não possuem preço apurado. O resultado é desconhecido, não zero."}
              <EmAtualizacao ativo={carregando} className="ml-2 align-middle" />
            </p>
          </div>
          {totalCarregado > QUANTIDADES[0] && (
            <SeletorDeJanela janela={janela} onJanela={trocarJanela} />
          )}
        </div>
        <ul className="mt-4 flex flex-col gap-1.5 text-xs text-muted-foreground">
          {desenhados.map((ponto) => (
            <li key={ponto.periodo} className="flex items-center justify-between gap-6">
              <span>{ponto.label}</span>
              <span className="italic" title={ponto.lacuna?.porque}>
                {ponto.lacuna?.curto ?? "sem preço apurado"}
              </span>
            </li>
          ))}
        </ul>
      </div>
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
          {/*
            A cobertura do recorte, quando ela não é inteira.

            Um gráfico com duas barras e quatro buracos precisa dizer que os
            buracos são ausência de medida — sem esta linha, quem lê conclui da
            falta o que quiser, e o mais provável é "não houve alteração",
            que é justamente o que não se sabe.
          */}
          <FraseDaCobertura cobertura={cobertura ?? null} periodicity={periodicity} />
        </div>
        {/*
          O seletor só aparece quando há mais dado do que a menor janela mostra:
          com três vigências no banco, todos os botões desenhariam o mesmo
          gráfico e prometeriam uma escolha que não existe.
        */}
        <div className="flex items-center gap-2">
          <SeletorDeGrandeza
            periodicidades={periodicidades}
            escolhida={periodicity}
            onEscolher={onPeriodicidade}
          />
          {totalCarregado > QUANTIDADES[0] && (
            <SeletorDeJanela janela={janela} onJanela={trocarJanela} />
          )}
        </div>
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
          {/*
            `null` não é R$ 0,00 no tooltip tampouco: o Recharts não chama o
            formatter para o ponto ausente, e a linha some da caixa em vez de
            aparecer zerada.
          */}
          <Tooltip
            formatter={(v) => (typeof v === "number" ? formatBrl(v) : "—")}
            contentStyle={{ fontSize: 12 }}
          />
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
          {/*
            `connectNulls` fica **falso** (o padrão, escrito por ser decisão):
            ligar dois pontos por cima de uma vigência sem medida desenharia a
            trajetória que ninguém mediu, que é a mesma mentira do zero, em
            forma de reta.
          */}
          <Line
            type="monotone"
            dataKey="liquido"
            name="Líquido"
            stroke={COR_LIQUIDO}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * A cobertura do recorte, em uma linha — e só quando ela não é inteira.
 *
 * Ela nomeia as três ausências pelo que cada uma é, porque as três pedem
 * conversas diferentes: sem preço apurado é trabalho de Curadoria; apurado
 * noutra grandeza é uma troca de eixo ali no botão ao lado; sem comparação é
 * uma comparação que ainda não foi calculada. Um "parcial" genérico
 * apagaria a diferença, e é ela que diz o que fazer a seguir.
 */
function FraseDaCobertura({
  cobertura,
  periodicity,
}: {
  cobertura: CoberturaDoRecorte | null;
  periodicity: string;
}) {
  if (cobertura === null) return null;
  const faltando = cobertura.desenhadas - cobertura.calculadas;
  if (faltando <= 0) return null;

  const partes: string[] = [];
  if (cobertura.semPreco > 0) partes.push(`${cobertura.semPreco} sem preço apurado`);
  if (cobertura.outraGrandeza > 0)
    partes.push(
      `${cobertura.outraGrandeza} apurada${cobertura.outraGrandeza === 1 ? "" : "s"} só noutra grandeza`,
    );
  if (cobertura.semComparacao > 0)
    partes.push(`${cobertura.semComparacao} sem comparação calculada`);

  return (
    <span className="mt-1 block text-brand-red">
      {cobertura.calculadas} de {cobertura.desenhadas} vigências com valor apurado em R$
      {periodicitySuffix(periodicity)} — {partes.join(", ")}. As demais ficam em branco: o resultado
      delas é desconhecido, não zero.
    </span>
  );
}

/**
 * A troca de grandeza — R$/mês, R$/ano — quando o recorte tem mais de uma.
 *
 * ---------------------------------------------------------------------------
 * Por que não basta escolher bem
 * ---------------------------------------------------------------------------
 * `periodicidadePrincipal` escolhe a certa: a que tem movimento, e entre elas
 * a que mais moveu. Isso resolve o desenho chapado no zero, e **não** resolve o
 * resto: com R$/ano e R$/mês no mesmo intervalo, o gráfico desenha um e o outro
 * continua fora da tela. Somar os dois está fora de questão — não é a mesma
 * grandeza —, e uma nota de rodapé não deixa ninguém *ver* a outra série.
 *
 * Então a escolha vira gesto. O botão só aparece quando há de fato duas
 * grandezas com dinheiro se movendo: com uma só, ele prometeria uma alternativa
 * que não existe, que é o mesmo defeito do seletor de janela ao lado.
 */
function SeletorDeGrandeza({
  periodicidades,
  escolhida,
  onEscolher,
}: {
  periodicidades: PeriodicidadeApurada[];
  escolhida: string | null;
  onEscolher?: (periodicity: string) => void;
}) {
  const comMovimento = periodicidades.filter((p) => p.temMovimento);
  if (comMovimento.length < 2 || typeof onEscolher !== "function") return null;
  return (
    <div
      role="group"
      aria-label="Grandeza do gráfico"
      className="flex items-center gap-1 rounded-full bg-muted/60 p-0.5"
    >
      {comMovimento.map((p) => (
        <button
          key={p.periodicity}
          type="button"
          onClick={() => onEscolher(p.periodicity)}
          aria-pressed={p.periodicity === escolhida}
          className={
            p.periodicity === escolhida
              ? "rounded-full bg-background px-2.5 py-1 text-xs font-semibold shadow-sm"
              : "rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          R${periodicitySuffix(p.periodicity)}
        </button>
      ))}
    </div>
  );
}
