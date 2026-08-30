import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { daLinhaDoBanco, type Deduplicador } from "./deduplicacao";
import { FAMILIES, placementOf, type FamilyCode } from "./families";
import type { RawChange } from "./grouped";
import { abrirJanelaDeComparacoes } from "./janela-de-comparacoes";
import { rotuloCurtoDaVigencia } from "./labels";
import type { TipoDaLinhaDoTempo } from "./tipos";
import { contextFilter, type ContextInfo, type RequestedContext } from "./series";

/**
 * Evolução por Placa — o histórico lido **pelo ativo**, e não pela vigência.
 *
 * O Dashboard e a Linha do Tempo respondem "o que aconteceu em cada vigência?".
 * Esta leitura responde a outra pergunta, com os mesmos dados e sem uma segunda
 * régua: *quais placas estão sendo afetadas ao longo do tempo, como estão
 * evoluindo, e quais merecem atenção agora?*
 *
 * ---------------------------------------------------------------------------
 * Cinco decisões, e nenhuma delas é nova
 * ---------------------------------------------------------------------------
 *
 * 1. **A identidade do ativo é `entity.id`, e a placa é só o nome dele.**
 *    `entity_identifier` guarda histórico: um reemplacamento fecha a linha
 *    antiga e abre outra, e `entity.id` — com todos os fatos e alterações
 *    pendurados nele — não se move (ver `lib/db/src/schema/canonical.ts`).
 *    Agrupar a matriz pela placa escrita na linha de alteração
 *    (`change.entity_label`, que é denormalizada no dia da comparação) partiria
 *    o histórico de um ativo reemplacado em duas linhas da matriz, cada uma com
 *    metade da perda. Então a linha é o ativo, o rótulo é a placa **corrente**,
 *    e as placas que ele já teve viajam em `placasAnteriores` — informação, e
 *    nunca uma segunda linha.
 *
 * 2. **A janela e o dinheiro vêm da mesma autoridade que a Linha do Tempo usa.**
 *    `abrirJanelaDeComparacoes` decide quais comparações pertencem a quais
 *    vigências, quais linhas existem dentro delas e qual índice de dupla
 *    contagem decide o que entra na soma. Nada aqui reimplementa impacto:
 *    `precoDaLinha` é a mesma régua de `precoDe` (`deduplicacao.ts`) e a
 *    exclusão é a mesma `dedup.foraDoTotal`. É isso que faz a soma das células
 *    de uma placa fechar com o acumulado dela, e a soma dos acumulados fechar,
 *    ao centavo, com o impacto que a Linha do Tempo publica para o mesmo
 *    intervalo — há teste para as duas igualdades.
 *
 * 3. **Periodicidade não soma, aqui como em lugar nenhum.** A matriz inteira é
 *    desenhada numa periodicidade de cada vez ({@link EvolucaoPorPlaca.periodicidade}),
 *    porque somar R$/mês com R$/ano numa célula produziria o número mais lido e
 *    menos verdadeiro do produto. Quais existem no intervalo, e o peso de cada
 *    uma, vêm em `periodicidades` — a tela oferece a troca, nunca a fusão.
 *
 * 4. **Sem valoração não é R$ 0.** Uma alteração sem preço apurado é contada em
 *    `semValoracao` e **nunca** entra como zero no líquido. Uma célula que só
 *    tem alterações sem preço sai com `net = null` e `estado = "SEM_VALORACAO"`,
 *    que é uma cor própria na tela — não a cor do neutro.
 *
 * 5. **Ausência não é zero.** Uma placa sem alteração numa vigência não tem
 *    célula nenhuma (as células são esparsas, e a tela desenha "—"). Uma
 *    vigência sem comparação calculada é um `gap` nomeado, e não uma coluna de
 *    zeros.
 *
 * ---------------------------------------------------------------------------
 * O que **não** mora aqui
 * ---------------------------------------------------------------------------
 * A régua do que é uma alteração, o preço dela, a dupla contagem, a
 * visibilidade da importação e a definição de "vigência anterior" continuam
 * onde sempre estiveram — no motor, em `deduplicacao.ts`, na view
 * `alteracao_visivel` e em `change_set`. Esta leitura é uma **projeção**.
 */

/** Quanto tempo de sinal negativo consecutivo já é padrão, e não um tropeço. */
export const VIGENCIAS_PARA_PIORA_CONSECUTIVA = 2;

/**
 * Em quantas vigências uma placa precisa aparecer para ser "recorrente".
 *
 * Três, e o número está aqui em vez de espalhado pela tela porque ele é uma
 * regra de negócio: duas vigências seguidas é o que a piora consecutiva já
 * mede (um movimento e a confirmação dele); a terceira é o que separa "mexeu de
 * novo" de "mexe sempre". A tela lê esta constante e escreve o número na
 * legenda do filtro — quem lê a pastilha "Recorrentes" vê a definição junto.
 */
export const VIGENCIAS_PARA_RECORRENCIA = 3;

/**
 * O que uma célula da matriz é, antes de ser um número.
 *
 * O nome carrega o "DaPlaca" porque `impacto.ts` já tem um `EstadoDaCelula`, e
 * são coisas diferentes: lá a célula é um parâmetro num ativo numa vigência (e
 * "fora da frota" é um estado); aqui ela é o **impacto** de um ativo numa
 * vigência. Dois tipos com o mesmo nome no mesmo pacote deixariam qualquer um
 * dos dois entrar no lugar do outro sem o compilador dizer nada.
 */
export type EstadoDaCelulaDaPlaca =
  /** Houve alteração com preço apurado. `net` é o líquido dela. */
  | "VALORADA"
  /** Houve alteração, e nenhuma delas tem preço. `net` é null. */
  | "SEM_VALORACAO";

/** Uma célula: uma placa, numa vigência. Só existe quando houve alteração. */
export interface CelulaDaPlaca {
  period: string;
  label: string;
  estado: EstadoDaCelulaDaPlaca;
  /** Alterações do ativo naquela vigência — todas, valoradas ou não. */
  alteracoes: number;
  /** Quantas têm preço apurado e entraram na conta. */
  valoradas: number;
  /** Quantas não têm preço. Nunca viram zero. */
  semValoracao: number;
  /** Quantas saíram da soma por dupla contagem. Contagem, nunca dinheiro. */
  foraDoTotal: number;
  /**
   * Quantas têm preço em **outra** periodicidade, e por isso não entram nesta
   * matriz.
   *
   * Existe porque a conta tem de fechar: `valoradas + semValoracao +
   * foraDoTotal + outraPeriodicidade = alteracoes`, sempre. Sem este balde, uma
   * alteração em R$/ano numa matriz desenhada em R$/mês simplesmente sumiria da
   * célula — a tela diria "7 alterações" e explicaria seis. Ela não é pendência
   * (tem preço) e não é dinheiro daqui (é outra grandeza): é a terceira coisa, e
   * aparece como a terceira coisa.
   */
  outraPeriodicidade: number;
  /** Só o que somou, na periodicidade em foco. */
  ganho: number;
  /** Só o que reduziu, na periodicidade em foco. Negativo. */
  perda: number;
  /** `ganho + perda`. Null quando nada ali tem preço nesta periodicidade. */
  net: number | null;
  /**
   * As rubricas que se mexeram **nesta célula**, a maior em módulo primeiro.
   *
   * É o último degrau da tela: do acumulado da placa para a vigência, e da
   * vigência para o que aconteceu dentro dela. Sem isto, o histórico completo
   * pararia em "−R$ 3.200 em agosto" e quem precisa cobrar a diferença teria de
   * sair da tela para descobrir de onde ela veio.
   *
   * Vem por célula e não por consulta nova de propósito: a alternativa é uma
   * chamada por (placa, vigência) no clique — o N+1 que uma matriz de 131
   * linhas transformaria em centenas de idas ao banco.
   */
  rubricas: RubricaDaCelula[];
}

/** Uma rubrica dentro de uma célula — o grão mais fino que a tela mostra. */
export interface RubricaDaCelula {
  parameterKey: string;
  nome: string;
  alteracoes: number;
  semValoracao: number;
  /** Null quando nenhuma das alterações dela tem preço nesta grandeza. */
  impacto: number | null;
}

/** Como o ativo se moveu no intervalo — a régua de "Piorando"/"Melhorando". */
export type Tendencia = "PIORANDO" | "MELHORANDO" | "ESTAVEL" | "SEM_VALORACAO";

/** A faixa de prioridade, derivada do score. Rótulo, nunca uma sexta régua. */
export type Prioridade = "CRITICA" | "MONITORAR" | "ATENCAO" | "POSITIVO" | "NEUTRA";

/** Um componente do score, com os pontos que ele deu e por quê. */
export interface MotivoDaPrioridade {
  chave: "IMPACTO" | "RECORRENCIA" | "PIORA_CONSECUTIVA" | "PENDENCIA" | "RECENCIA";
  rotulo: string;
  pontos: number;
  detalhe: string;
}

/** Uma rubrica que se mexeu — no escopo inteiro, ou dentro de uma placa. */
export interface RubricaAlterada {
  parameterKey: string;
  nome: string;
  family: FamilyCode;
  familyName: string;
  alteracoes: number;
  semValoracao: number;
  /** Ativos distintos em que ela se mexeu. */
  ativos: number;
  /** Vigências do intervalo em que ela se mexeu. */
  vigencias: number;
  /** O impacto acumulado dela na periodicidade em foco. Null sem preço. */
  impacto: number | null;
}

export interface AtivoNaEvolucao {
  entityId: string;
  /** A placa corrente. Null quando o ativo não tem identificador de placa. */
  plate: string | null;
  /** Como chamá-lo na tela: a placa, ou o rótulo da alteração, ou o id. */
  rotulo: string;
  entityType: string | null;
  /** Placas que este mesmo ativo já teve dentro do intervalo. Evidência. */
  placasAnteriores: string[];
  /** Uma por vigência em que houve alteração. Esparsas de propósito. */
  celulas: CelulaDaPlaca[];
  /** Soma das células, na periodicidade em foco. Null quando nenhuma valorou. */
  acumulado: number | null;
  ganho: number;
  perda: number;
  alteracoes: number;
  semValoracao: number;
  foraDoTotal: number;
  /** Alterações com preço em outra periodicidade — ver {@link CelulaDaPlaca}. */
  outraPeriodicidade: number;
  /** Em quantas vigências do intervalo o ativo teve alteração. */
  vigenciasAfetadas: number;
  vigenciasNegativas: number;
  vigenciasPositivas: number;
  /** A maior sequência de vigências consecutivas com líquido negativo. */
  pioraConsecutiva: number;
  /** Rubricas que se mexeram neste ativo em duas ou mais vigências. */
  rubricasRecorrentes: number;
  /** A vigência mais recente em que ele se mexeu. */
  ultimaVigencia: string | null;
  tendencia: Tendencia;
  score: number;
  prioridade: Prioridade;
  motivos: MotivoDaPrioridade[];
  /** As rubricas deste ativo, a maior em módulo primeiro. */
  rubricas: RubricaAlterada[];
}

/** Um insight do bloco "O que merece sua atenção". Determinístico e clicável. */
export interface InsightDaEvolucao {
  chave:
    | "PIORA_CONSECUTIVA"
    | "CONCENTRACAO_DA_PERDA"
    | "SEM_VALORACAO"
    | "RUBRICA_REPETIDA";
  tom: "PERDA" | "PENDENCIA" | "NEUTRO";
  /** Quantas placas o insight nomeia. */
  placas: number;
  /** O texto pronto, com os números já dentro. */
  texto: string;
  /** As placas a que ele se refere — é o que o clique filtra. */
  entityIds: string[];
}

export interface TotaisDaEvolucao {
  /** Ativos com pelo menos uma alteração no intervalo. */
  ativos: number;
  /** Ativos presentes na frota do intervalo — o denominador de "100% da frota". */
  frota: number;
  comPerda: number;
  comGanho: number;
  /** Ativos com pelo menos uma alteração sem preço apurado. */
  comPendencia: number;
  /** Alterações sem preço, somadas. Nunca zero disfarçado. */
  alteracoesSemValoracao: number;
  /** Alterações com preço em outra periodicidade que não a em foco. */
  alteracoesEmOutraPeriodicidade: number;
  alteracoes: number;
  /** Só o que reduziu, na periodicidade em foco. Negativo. */
  perda: number;
  /** Só o que somou. */
  ganho: number;
  /** `ganho + perda` — o impacto líquido do escopo, na periodicidade em foco. */
  liquido: number;
}

export interface EvolucaoPorPlaca {
  context: ContextInfo;
  /** A ponta de partida. Não entra na soma — ver `janela-de-comparacoes.ts`. */
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  /** Todo o histórico do contexto, para o seletor. */
  periods: { date: string; label: string }[];
  /** As colunas da matriz, da mais antiga à mais recente. */
  colunas: { period: string; label: string; comparisons: number; alteracoes: number }[];
  /** Vigências do intervalo sem comparação. Nomeadas, nunca zero. */
  gaps: { period: string; label: string; reason: string }[];
  /** A periodicidade em que a matriz inteira está desenhada. */
  periodicidade: string;
  /** As que existem no intervalo, a de maior peso primeiro. */
  periodicidades: { periodicity: string; peso: number }[];
  ativos: AtivoNaEvolucao[];
  totais: TotaisDaEvolucao;
  insights: InsightDaEvolucao[];
  /** As rubricas do escopo inteiro, a maior em módulo primeiro. */
  rubricas: RubricaAlterada[];
}

// ---------------------------------------------------------------------------
// As contas, puras — testáveis sem banco
// ---------------------------------------------------------------------------

const round = (v: number) => Number(v.toFixed(2));

/**
 * O preço de uma linha, ou `null` quando ela não tem.
 *
 * A mesma régua de `precoDe`, em `deduplicacao.ts`: `CALCULATED` **e** valor
 * numérico. Duplicada em forma, não em decisão — aquela função é interna ao
 * módulo, e o que importa é que as duas recusem exatamente as mesmas linhas.
 * `impacto-por-placa-real.test.ts` prende a igualdade contra o total oficial.
 */
function precoDaLinha(linha: RawChange): number | null {
  if (linha.impact_confidence !== "CALCULATED") return null;
  if (linha.impact_amount === null || linha.impact_amount === undefined) return null;
  const valor = Number(linha.impact_amount);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * A tendência do ativo — a régua explícita por trás de "Piorando".
 *
 * Não é uma curva ajustada nem uma projeção: é a contagem de vigências em que o
 * líquido caiu contra as em que ele subiu, com o sinal do acumulado como
 * desempate. Escrita assim porque é a única forma de a pastilha "Piorando" ser
 * conferível pelo próprio usuário olhando a linha da matriz.
 *
 * - **PIORANDO**: o acumulado é negativo e as vigências negativas não são
 *   menos que as positivas.
 * - **MELHORANDO**: o acumulado é positivo e as positivas não são menos que as
 *   negativas.
 * - **SEM_VALORACAO**: houve alteração e nenhuma delas tem preço — o ativo não
 *   é estável, é desconhecido, e chamá-lo de estável seria transformar
 *   pendência em calmaria.
 * - **ESTAVEL**: o resto — acumulado zero, ou movimento que se desfez.
 */
export function tendenciaDoAtivo(entrada: {
  acumulado: number | null;
  vigenciasNegativas: number;
  vigenciasPositivas: number;
  alteracoes: number;
}): Tendencia {
  if (entrada.acumulado === null) {
    return entrada.alteracoes > 0 ? "SEM_VALORACAO" : "ESTAVEL";
  }
  if (entrada.acumulado < 0 && entrada.vigenciasNegativas >= entrada.vigenciasPositivas) {
    return "PIORANDO";
  }
  if (entrada.acumulado > 0 && entrada.vigenciasPositivas >= entrada.vigenciasNegativas) {
    return "MELHORANDO";
  }
  return "ESTAVEL";
}

/** A maior sequência de vigências consecutivas com líquido negativo. */
export function maiorSequenciaNegativa(celulas: { net: number | null }[]): number {
  let maior = 0;
  let atual = 0;
  for (const celula of celulas) {
    if (celula.net !== null && celula.net < 0) {
      atual += 1;
      if (atual > maior) maior = atual;
    } else {
      atual = 0;
    }
  }
  return maior;
}

/**
 * O score de atenção — **a fórmula está escrita, e cada parcela é conferível.**
 *
 * O pedido era um ranking que não fosse "ordene por maior perda", e a recusa
 * que o acompanha é igualmente importante: **nenhum peso escondido**. São cinco
 * parcelas, somando no máximo 100 pontos, e cada uma volta em `motivos` com os
 * pontos que deu e a frase que a explica — é isso que o painel mostra quando
 * alguém pergunta "por que esta placa está em primeiro?".
 *
 * ```
 * IMPACTO            até 50  |acumulado negativo| ÷ maior perda da frota
 * RECORRENCIA        até 20  vigências negativas ÷ vigências com comparação
 * PIORA_CONSECUTIVA  até 15  sequência negativa ÷ 3, limitada a 1
 * PENDENCIA          até 10  alterações sem preço ÷ maior pendência da frota
 * RECENCIA            0 ou 5 mexeu-se na vigência mais recente do intervalo
 * ```
 *
 * Três recusas deliberadas:
 *
 * - **Ganho não pontua.** Uma placa que só ganhou tem 0 na parcela de impacto —
 *   ela pode entrar no ranking pela pendência ou pela recência, e não pelo
 *   tamanho do ganho. O ranking é de *atenção*, e ganho não é problema.
 * - **Normalização pela frota, e não por um teto arbitrário.** Dividir por
 *   "R$ 10.000" fixaria uma régua que envelhece com o cliente. Dividir pela
 *   maior perda do próprio recorte mantém o score comparável dentro da tela, e
 *   diz o que ele é: uma ordem, não uma nota absoluta.
 * - **Determinístico.** Mesmas entradas, mesmo número; nenhuma aleatoriedade,
 *   nenhum modelo, nenhuma data de hoje entrando na conta.
 */
export function pontuarAtivo(
  ativo: {
    acumulado: number | null;
    vigenciasNegativas: number;
    pioraConsecutiva: number;
    semValoracao: number;
    ultimaVigencia: string | null;
  },
  escala: {
    /** A maior perda (valor absoluto) do recorte. Zero quando não há perda. */
    maiorPerda: number;
    /** A maior quantidade de alterações sem preço num ativo do recorte. */
    maiorPendencia: number;
    /** Quantas vigências do intervalo têm comparação. */
    colunas: number;
    /** A vigência mais recente do intervalo. */
    ultimaColuna: string | null;
  },
): { score: number; motivos: MotivoDaPrioridade[] } {
  const motivos: MotivoDaPrioridade[] = [];

  const perda = ativo.acumulado !== null && ativo.acumulado < 0 ? -ativo.acumulado : 0;
  const pontosImpacto =
    escala.maiorPerda > 0 ? Math.min(1, perda / escala.maiorPerda) * 50 : 0;
  if (pontosImpacto > 0) {
    motivos.push({
      chave: "IMPACTO",
      rotulo: "Impacto acumulado",
      pontos: round(pontosImpacto),
      detalhe: `Perde ${((perda / escala.maiorPerda) * 100).toFixed(0)}% do que perde a placa mais afetada do recorte.`,
    });
  }

  const pontosRecorrencia =
    escala.colunas > 0 ? Math.min(1, ativo.vigenciasNegativas / escala.colunas) * 20 : 0;
  if (pontosRecorrencia > 0) {
    motivos.push({
      chave: "RECORRENCIA",
      rotulo: "Vigências negativas",
      pontos: round(pontosRecorrencia),
      detalhe: `Perdeu em ${ativo.vigenciasNegativas} de ${escala.colunas} vigências comparadas.`,
    });
  }

  const pontosPiora = Math.min(1, ativo.pioraConsecutiva / 3) * 15;
  if (pontosPiora > 0) {
    motivos.push({
      chave: "PIORA_CONSECUTIVA",
      rotulo: "Piora consecutiva",
      pontos: round(pontosPiora),
      detalhe: `Piorou em ${ativo.pioraConsecutiva} vigências seguidas.`,
    });
  }

  const pontosPendencia =
    escala.maiorPendencia > 0
      ? Math.min(1, ativo.semValoracao / escala.maiorPendencia) * 10
      : 0;
  if (pontosPendencia > 0) {
    motivos.push({
      chave: "PENDENCIA",
      rotulo: "Sem valoração",
      pontos: round(pontosPendencia),
      detalhe: `${ativo.semValoracao} ${ativo.semValoracao === 1 ? "alteração ainda sem" : "alterações ainda sem"} impacto apurado.`,
    });
  }

  const pontosRecencia =
    escala.ultimaColuna !== null && ativo.ultimaVigencia === escala.ultimaColuna ? 5 : 0;
  if (pontosRecencia > 0) {
    motivos.push({
      chave: "RECENCIA",
      rotulo: "Mexeu agora",
      pontos: pontosRecencia,
      detalhe: "Teve alteração na vigência mais recente do intervalo.",
    });
  }

  return {
    score: round(
      pontosImpacto + pontosRecorrencia + pontosPiora + pontosPendencia + pontosRecencia,
    ),
    motivos,
  };
}

/**
 * A faixa que a tela pinta — um rótulo do score, e não uma sexta régua.
 *
 * Os cortes estão aqui, e não espalhados em `className`s: mudá-los é uma
 * decisão de produto, e ela tem de acontecer num lugar só.
 */
export function prioridadeDoScore(score: number, acumulado: number | null): Prioridade {
  if (score >= 60) return "CRITICA";
  if (score >= 30) return "MONITORAR";
  if (score > 0) return "ATENCAO";
  return acumulado !== null && acumulado > 0 ? "POSITIVO" : "NEUTRA";
}

/**
 * Quantas placas explicam a maior parte da perda — a régua de Pareto do
 * insight de concentração.
 *
 * Devolve as placas, da maior perda para a menor, até cobrir `alvo` da perda
 * total. Sem perda nenhuma, lista vazia — e o insight não aparece, em vez de
 * aparecer dizendo "0% em 0 placas".
 */
export function concentracaoDaPerda(
  perdas: { entityId: string; perda: number }[],
  alvo = 0.8,
): { entityIds: string[]; percentual: number } {
  const negativas = perdas
    .filter((p) => p.perda < 0)
    .sort((a, b) => a.perda - b.perda);
  const total = negativas.reduce((soma, p) => soma + p.perda, 0);
  if (total === 0) return { entityIds: [], percentual: 0 };

  const entityIds: string[] = [];
  let acumulado = 0;
  for (const p of negativas) {
    entityIds.push(p.entityId);
    acumulado += p.perda;
    if (acumulado / total >= alvo) break;
  }
  return { entityIds, percentual: round((acumulado / total) * 100) };
}

/**
 * Os insights do bloco de atenção — derivados, nunca escritos à mão.
 *
 * Cada um carrega as placas a que se refere, e é isso que faz o clique filtrar
 * a matriz em vez de abrir outra tela: o número na frase e a lista embaixo são
 * o mesmo conjunto, por construção.
 */
export function insightsDaEvolucao(
  ativos: AtivoNaEvolucao[],
  periodicidade: string,
): InsightDaEvolucao[] {
  const insights: InsightDaEvolucao[] = [];

  const piorando = ativos.filter(
    (a) => a.pioraConsecutiva >= VIGENCIAS_PARA_PIORA_CONSECUTIVA,
  );
  if (piorando.length > 0) {
    insights.push({
      chave: "PIORA_CONSECUTIVA",
      tom: "PERDA",
      placas: piorando.length,
      texto:
        `${piorando.length} ${piorando.length === 1 ? "placa piorou" : "placas pioraram"} em ` +
        `${VIGENCIAS_PARA_PIORA_CONSECUTIVA} ou mais vigências consecutivas.`,
      entityIds: piorando.map((a) => a.entityId),
    });
  }

  const concentracao = concentracaoDaPerda(
    ativos.map((a) => ({ entityId: a.entityId, perda: a.perda })),
  );
  if (concentracao.entityIds.length > 0) {
    insights.push({
      chave: "CONCENTRACAO_DA_PERDA",
      tom: "PERDA",
      placas: concentracao.entityIds.length,
      texto:
        `${concentracao.percentual.toFixed(0)}% da perda em ${periodicidade.toLowerCase()} está ` +
        `concentrada em ${concentracao.entityIds.length} ` +
        `${concentracao.entityIds.length === 1 ? "placa" : "placas"}.`,
      entityIds: concentracao.entityIds,
    });
  }

  const pendentes = ativos.filter((a) => a.semValoracao > 0);
  if (pendentes.length > 0) {
    const alteracoes = pendentes.reduce((soma, a) => soma + a.semValoracao, 0);
    insights.push({
      chave: "SEM_VALORACAO",
      tom: "PENDENCIA",
      placas: pendentes.length,
      texto:
        `${pendentes.length} ${pendentes.length === 1 ? "placa possui" : "placas possuem"} ` +
        `${alteracoes} ${alteracoes === 1 ? "alteração" : "alterações"} sem valoração.`,
      entityIds: pendentes.map((a) => a.entityId),
    });
  }

  const repetidas = ativos.filter((a) => a.rubricasRecorrentes > 0);
  if (repetidas.length > 0) {
    insights.push({
      chave: "RUBRICA_REPETIDA",
      tom: "NEUTRO",
      placas: repetidas.length,
      texto:
        `${repetidas.length} ${repetidas.length === 1 ? "placa teve" : "placas tiveram"} a mesma ` +
        `rubrica alterada repetidamente.`,
      entityIds: repetidas.map((a) => a.entityId),
    });
  }

  return insights;
}

/**
 * As periodicidades presentes, a de maior peso primeiro.
 *
 * "Peso" é a soma dos módulos — a grandeza que mais se mexeu abre a tela. Sem
 * nenhuma linha com preço, devolve lista vazia, e a leitura cai em
 * `SEM_PERIODICIDADE`, que é o balde que a autoridade já usa.
 */
export function periodicidadesDoIntervalo(
  linhas: RawChange[],
  dedup: Deduplicador,
): { periodicity: string; peso: number }[] {
  const pesos = new Map<string, number>();
  for (const linha of linhas) {
    const preco = precoDaLinha(linha);
    if (preco === null) continue;
    if (dedup.foraDoTotal(daLinhaDoBanco(linha)) !== null) continue;
    const balde = (linha.impact_periodicity as string | null) ?? "SEM_PERIODICIDADE";
    pesos.set(balde, (pesos.get(balde) ?? 0) + Math.abs(preco));
  }
  return [...pesos.entries()]
    .map(([periodicity, peso]) => ({ periodicity, peso: round(peso) }))
    .sort((a, b) => b.peso - a.peso || a.periodicity.localeCompare(b.periodicity));
}

// ---------------------------------------------------------------------------
// A leitura
// ---------------------------------------------------------------------------

interface EmConstrucao {
  entityId: string;
  entityType: string | null;
  rotulos: Set<string>;
  celulas: Map<string, CelulaDaPlaca>;
  rubricas: Map<
    string,
    {
      nome: string;
      family: FamilyCode;
      alteracoes: number;
      semValoracao: number;
      vigencias: Set<string>;
      impacto: number | null;
    }
  >;
  alteracoes: number;
  semValoracao: number;
  foraDoTotal: number;
  outraPeriodicidade: number;
}

export interface OpcoesDaEvolucao {
  from?: string;
  to?: string;
  context?: RequestedContext;
  tipo?: TipoDaLinhaDoTempo;
  /** A periodicidade pedida. Fora das existentes, cai na de maior peso. */
  periodicidade?: string;
  contextosCarregados?: ContextInfo[];
}

/**
 * A matriz placa × vigência do intervalo pedido.
 *
 * Devolve `null` quando não há contexto ou vigência — 404 na rota, e o convite
 * a importar no lugar de uma matriz vazia.
 *
 * **Uma varredura de linhas, e nenhuma consulta por placa.** A única consulta
 * além da janela é a das placas correntes dos ativos tocados, feita de uma vez
 * por `ANY(...)` — o N+1 que uma tela de 131 linhas convidaria a escrever custa
 * 131 idas ao banco para responder o que uma responde.
 */
export async function evolucaoPorPlaca(
  db: Database,
  options: OpcoesDaEvolucao = {},
): Promise<EvolucaoPorPlaca | null> {
  const janela = await abrirJanelaDeComparacoes(
    db,
    options.from,
    options.to,
    options.context,
    options.contextosCarregados,
    options.tipo,
  );
  if (!janela) return null;

  const { context, datas, inicio, fim, sets, periodoDoSet, dedup } = janela;
  const rotulo = (data: string) => rotuloCurtoDaVigencia(data, datas);

  /*
    O recorte por tipo é pelo `entity_type` da linha, como em `getRangeAnalysis`
    — e pelo mesmo motivo: uma coluna da carreta que embute o cavalo conta na
    carreta, que é a linha em que ela chega. TRECHO já saiu recortado da
    consulta da janela.
  */
  const linhas = janela.linhas.filter(
    (r) =>
      !options.tipo ||
      options.tipo === "TRECHO" ||
      r.entity_type === options.tipo,
  );

  const periodicidades = periodicidadesDoIntervalo(linhas, dedup);
  const periodicidade =
    options.periodicidade && periodicidades.some((p) => p.periodicity === options.periodicidade)
      ? options.periodicidade
      : (periodicidades[0]?.periodicity ?? "SEM_PERIODICIDADE");

  // ---- as colunas ---------------------------------------------------------
  const comComparacao = janela.noIntervalo.filter((periodo) =>
    sets.some((s) => s.period === periodo),
  );
  const colunasOrdenadas = [...comComparacao].sort();

  const gaps = janela.noIntervalo
    .filter((periodo) => !sets.some((s) => s.period === periodo))
    .map((periodo) => ({
      period: periodo,
      label: rotulo(periodo),
      reason:
        "Vigência importada sem comparação: é a primeira da série, ou a " +
        "comparação ainda não foi calculada. O que houve aqui não está " +
        "somado — e não está contado como zero.",
    }));

  // ---- uma varredura, e tudo sai dela -------------------------------------
  const emConstrucao = new Map<string, EmConstrucao>();
  const rubricasDoEscopo = new Map<
    string,
    {
      nome: string;
      family: FamilyCode;
      alteracoes: number;
      semValoracao: number;
      ativos: Set<string>;
      vigencias: Set<string>;
      impacto: number | null;
    }
  >();
  const alteracoesPorColuna = new Map<string, number>();
  /** As rubricas de cada célula, indexadas por `ativo|vigência`. */
  const porCelula = new Map<string, Map<string, RubricaDaCelula>>();

  for (const linha of linhas) {
    const periodo = periodoDoSet.get(linha.change_set_id as string);
    if (periodo === undefined) continue;

    alteracoesPorColuna.set(periodo, (alteracoesPorColuna.get(periodo) ?? 0) + 1);

    /*
      Uma alteração sem `entity_id` não é de ativo nenhum — são as linhas de
      eixo de atributo (coluna que entrou ou saiu do layout). Ela conta na
      vigência, e não numa placa: inventar uma linha "(sem placa)" na matriz
      seria criar um ativo que não existe.
    */
    const entityId = linha.entity_id as string | null;
    if (entityId === null) continue;

    const ativo =
      emConstrucao.get(entityId) ??
      {
        entityId,
        entityType: (linha.entity_type as string | null) ?? null,
        rotulos: new Set<string>(),
        celulas: new Map<string, CelulaDaPlaca>(),
        rubricas: new Map(),
        alteracoes: 0,
        semValoracao: 0,
        foraDoTotal: 0,
        outraPeriodicidade: 0,
      };
    emConstrucao.set(entityId, ativo);
    const etiqueta = linha.entity_label as string | null;
    if (etiqueta !== null) ativo.rotulos.add(etiqueta);

    const celula =
      ativo.celulas.get(periodo) ??
      {
        period: periodo,
        label: rotulo(periodo),
        estado: "SEM_VALORACAO" as EstadoDaCelulaDaPlaca,
        alteracoes: 0,
        valoradas: 0,
        semValoracao: 0,
        foraDoTotal: 0,
        outraPeriodicidade: 0,
        ganho: 0,
        perda: 0,
        net: null,
        rubricas: [],
      };
    ativo.celulas.set(periodo, celula);
    const rubricasDaCelula =
      porCelula.get(`${entityId}|${periodo}`) ??
      new Map<string, RubricaDaCelula>();
    porCelula.set(`${entityId}|${periodo}`, rubricasDaCelula);

    const placement = placementOf(linha.attribute_code as string | null);
    const rubricaDoAtivo =
      ativo.rubricas.get(placement.parameterKey) ??
      {
        nome: placement.parameter,
        family: placement.family,
        alteracoes: 0,
        semValoracao: 0,
        vigencias: new Set<string>(),
        impacto: null,
      };
    ativo.rubricas.set(placement.parameterKey, rubricaDoAtivo);
    const rubricaDoEscopo =
      rubricasDoEscopo.get(placement.parameterKey) ??
      {
        nome: placement.parameter,
        family: placement.family,
        alteracoes: 0,
        semValoracao: 0,
        ativos: new Set<string>(),
        vigencias: new Set<string>(),
        impacto: null,
      };
    rubricasDoEscopo.set(placement.parameterKey, rubricaDoEscopo);

    const rubricaDaCelula =
      rubricasDaCelula.get(placement.parameterKey) ??
      {
        parameterKey: placement.parameterKey,
        nome: placement.parameter,
        alteracoes: 0,
        semValoracao: 0,
        impacto: null,
      };
    rubricasDaCelula.set(placement.parameterKey, rubricaDaCelula);

    ativo.alteracoes += 1;
    celula.alteracoes += 1;
    rubricaDaCelula.alteracoes += 1;
    rubricaDoAtivo.alteracoes += 1;
    rubricaDoAtivo.vigencias.add(periodo);
    rubricaDoEscopo.alteracoes += 1;
    rubricaDoEscopo.ativos.add(entityId);
    rubricaDoEscopo.vigencias.add(periodo);

    const preco = precoDaLinha(linha);
    if (preco === null) {
      ativo.semValoracao += 1;
      celula.semValoracao += 1;
      rubricaDoAtivo.semValoracao += 1;
      rubricaDoEscopo.semValoracao += 1;
      rubricaDaCelula.semValoracao += 1;
      continue;
    }
    if (dedup.foraDoTotal(daLinhaDoBanco(linha)) !== null) {
      /*
        Fora da soma por dupla contagem — a mesma decisão que a vigência toma.
        Não é pendência (o preço existe) e não é dinheiro (já está contado nas
        parcelas): é contagem, e aparece como contagem.
      */
      ativo.foraDoTotal += 1;
      celula.foraDoTotal += 1;
      continue;
    }
    if (((linha.impact_periodicity as string | null) ?? "SEM_PERIODICIDADE") !== periodicidade) {
      /*
        Outra grandeza. Não entra na matriz desenhada em R$/mês, e **não** vira
        pendência: ela tem preço, só não neste eixo. A tela oferece a troca de
        periodicidade; somar as duas é que não é uma opção. Contada num balde
        próprio para que a célula continue explicando cada uma das alterações
        que ela anuncia.
      */
      ativo.outraPeriodicidade += 1;
      celula.outraPeriodicidade += 1;
      continue;
    }

    celula.valoradas += 1;
    celula.estado = "VALORADA";
    if (preco < 0) celula.perda += preco;
    else celula.ganho += preco;
    celula.net = (celula.net ?? 0) + preco;
    rubricaDoAtivo.impacto = (rubricaDoAtivo.impacto ?? 0) + preco;
    rubricaDoEscopo.impacto = (rubricaDoEscopo.impacto ?? 0) + preco;
    rubricaDaCelula.impacto = (rubricaDaCelula.impacto ?? 0) + preco;
  }

  // ---- as placas correntes, numa consulta só ------------------------------
  const entityIds = [...emConstrucao.keys()];
  const placas = new Map<string, string>();
  if (entityIds.length > 0) {
    const { rows } = await db.execute<{ entity_id: string; identifier_value: string }>(sql`
      SELECT ei.entity_id::text AS entity_id, ei.identifier_value
        FROM entity_identifier ei
       WHERE ei.identifier_type = 'PLACA'
         AND ei.is_current
         AND ei.entity_id = ANY(${sql`ARRAY[${sql.join(
           entityIds.map((id) => sql`${id}::uuid`),
           sql`, `,
         )}]`})
    `);
    for (const r of rows) placas.set(r.entity_id, r.identifier_value);
  }

  /*
    Quantos ativos existem na frota do intervalo — o denominador de "N% da
    frota ativa". Vem da presença (`fato_visivel`), e não da lista de
    alterações: um ativo parado no pátio continua na frota, e medir a frota
    pelas alterações diria que ela encolheu quando o que houve foi calmaria.
  */
  const { rows: frotaRows } = await db.execute<{ frota: number }>(sql`
    SELECT count(DISTINCT f.entity_id)::int AS frota
      FROM fato_visivel f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity e   ON e.id = f.entity_id
     WHERE s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.effective_date > ${inicio}::date
       AND s.effective_date <= ${fim}::date
       AND ${contextFilter("s", context)}
       AND ${options.tipo ? sql`e.entity_type = ${options.tipo}` : sql`e.entity_type <> 'TRECHO'`}
  `);

  // ---- os ativos, montados ------------------------------------------------
  const semEscala: (Omit<AtivoNaEvolucao, "score" | "prioridade" | "motivos"> & {
    perdaAbsoluta: number;
  })[] = [];

  for (const bruto of emConstrucao.values()) {
    const celulas = [...bruto.celulas.values()].sort((a, b) =>
      a.period.localeCompare(b.period),
    );
    for (const celula of celulas) {
      celula.ganho = round(celula.ganho);
      celula.perda = round(celula.perda);
      celula.net = celula.net === null ? null : round(celula.net);
      celula.rubricas = [
        ...(porCelula.get(`${bruto.entityId}|${celula.period}`)?.values() ?? []),
      ]
        .map((r) => ({ ...r, impacto: r.impacto === null ? null : round(r.impacto) }))
        .sort(
          (a, b) =>
            Math.abs(b.impacto ?? 0) - Math.abs(a.impacto ?? 0) ||
            b.alteracoes - a.alteracoes ||
            a.nome.localeCompare(b.nome, "pt-BR"),
        );
    }

    const valoradas = celulas.filter((c) => c.net !== null);
    const acumulado =
      valoradas.length === 0
        ? null
        : round(valoradas.reduce((soma, c) => soma + (c.net ?? 0), 0));
    const placa = placas.get(bruto.entityId) ?? null;
    const anteriores = [...bruto.rotulos].filter((r) => r !== placa).sort();

    const rubricas: RubricaAlterada[] = [...bruto.rubricas.entries()]
      .map(([parameterKey, r]) => ({
        parameterKey,
        nome: r.nome,
        family: r.family,
        familyName: FAMILIES[r.family]?.name ?? r.family,
        alteracoes: r.alteracoes,
        semValoracao: r.semValoracao,
        ativos: 1,
        vigencias: r.vigencias.size,
        impacto: r.impacto === null ? null : round(r.impacto),
      }))
      .sort(compararRubricas);

    const vigenciasNegativas = celulas.filter((c) => c.net !== null && c.net < 0).length;
    const vigenciasPositivas = celulas.filter((c) => c.net !== null && c.net > 0).length;
    const ultimaVigencia = celulas.length > 0 ? celulas[celulas.length - 1].period : null;

    semEscala.push({
      entityId: bruto.entityId,
      plate: placa,
      rotulo: placa ?? [...bruto.rotulos][0] ?? bruto.entityId,
      entityType: bruto.entityType,
      placasAnteriores: anteriores,
      celulas,
      acumulado,
      ganho: round(celulas.reduce((soma, c) => soma + c.ganho, 0)),
      perda: round(celulas.reduce((soma, c) => soma + c.perda, 0)),
      alteracoes: bruto.alteracoes,
      semValoracao: bruto.semValoracao,
      foraDoTotal: bruto.foraDoTotal,
      outraPeriodicidade: bruto.outraPeriodicidade,
      vigenciasAfetadas: celulas.length,
      vigenciasNegativas,
      vigenciasPositivas,
      pioraConsecutiva: maiorSequenciaNegativa(
        // A sequência é sobre as colunas do intervalo, e não sobre as células:
        // uma vigência sem alteração **interrompe** a sequência, e ignorá-la
        // faria "duas vigências seguidas" descrever meses distantes.
        colunasOrdenadas.map(
          (periodo) => bruto.celulas.get(periodo) ?? { net: null },
        ),
      ),
      rubricasRecorrentes: rubricas.filter((r) => r.vigencias >= 2).length,
      ultimaVigencia,
      tendencia: tendenciaDoAtivo({
        acumulado,
        vigenciasNegativas,
        vigenciasPositivas,
        alteracoes: bruto.alteracoes,
      }),
      rubricas,
      perdaAbsoluta: acumulado !== null && acumulado < 0 ? -acumulado : 0,
    });
  }

  const escala = {
    maiorPerda: semEscala.reduce((maior, a) => Math.max(maior, a.perdaAbsoluta), 0),
    maiorPendencia: semEscala.reduce((maior, a) => Math.max(maior, a.semValoracao), 0),
    colunas: colunasOrdenadas.length,
    ultimaColuna: colunasOrdenadas[colunasOrdenadas.length - 1] ?? null,
  };

  const ativos: AtivoNaEvolucao[] = semEscala
    .map(({ perdaAbsoluta: _perdaAbsoluta, ...ativo }) => {
      const { score, motivos } = pontuarAtivo(ativo, escala);
      return {
        ...ativo,
        score,
        prioridade: prioridadeDoScore(score, ativo.acumulado),
        motivos,
      };
    })
    /*
      A ordem padrão é a do ranking de atenção — e não a alfabética. Quem abre a
      tela quer a placa que precisa investigar na primeira linha; a busca e a
      ordenação por outros critérios ficam na tela, sobre a lista já pronta.
    */
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.acumulado ?? 0) - (b.acumulado ?? 0) ||
        b.alteracoes - a.alteracoes ||
        a.rotulo.localeCompare(b.rotulo, "pt-BR", { numeric: true }),
    );

  const totais: TotaisDaEvolucao = {
    ativos: ativos.length,
    frota: frotaRows[0]?.frota ?? 0,
    comPerda: ativos.filter((a) => a.acumulado !== null && a.acumulado < 0).length,
    comGanho: ativos.filter((a) => a.acumulado !== null && a.acumulado > 0).length,
    comPendencia: ativos.filter((a) => a.semValoracao > 0).length,
    alteracoesSemValoracao: ativos.reduce((soma, a) => soma + a.semValoracao, 0),
    alteracoesEmOutraPeriodicidade: ativos.reduce(
      (soma, a) => soma + a.outraPeriodicidade,
      0,
    ),
    alteracoes: ativos.reduce((soma, a) => soma + a.alteracoes, 0),
    perda: round(ativos.reduce((soma, a) => soma + a.perda, 0)),
    ganho: round(ativos.reduce((soma, a) => soma + a.ganho, 0)),
    liquido: round(ativos.reduce((soma, a) => soma + (a.acumulado ?? 0), 0)),
  };

  return {
    context,
    from: inicio,
    fromLabel: rotulo(inicio),
    to: fim,
    toLabel: rotulo(fim),
    periods: datas.map((d) => ({ date: d, label: rotulo(d) })),
    colunas: colunasOrdenadas.map((periodo) => ({
      period: periodo,
      label: rotulo(periodo),
      comparisons: sets.filter((s) => s.period === periodo).length,
      alteracoes: alteracoesPorColuna.get(periodo) ?? 0,
    })),
    gaps,
    periodicidade,
    periodicidades,
    ativos,
    totais,
    insights: insightsDaEvolucao(ativos, periodicidade),
    rubricas: [...rubricasDoEscopo.entries()]
      .map(([parameterKey, r]) => ({
        parameterKey,
        nome: r.nome,
        family: r.family,
        familyName: FAMILIES[r.family]?.name ?? r.family,
        alteracoes: r.alteracoes,
        semValoracao: r.semValoracao,
        ativos: r.ativos.size,
        vigencias: r.vigencias.size,
        impacto: r.impacto === null ? null : round(r.impacto),
      }))
      .sort(compararRubricas),
  };
}

/** Maior impacto absoluto primeiro; sem impacto, mais alterações primeiro. */
function compararRubricas(a: RubricaAlterada, b: RubricaAlterada): number {
  const peso = (r: RubricaAlterada) => (r.impacto === null ? 0 : Math.abs(r.impacto));
  return (
    peso(b) - peso(a) ||
    b.alteracoes - a.alteracoes ||
    a.nome.localeCompare(b.nome, "pt-BR")
  );
}
