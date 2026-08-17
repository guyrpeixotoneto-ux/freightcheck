import {
  ACIONAVEL_EM_PALAVRAS,
  EFEITO_EM_PALAVRAS,
  type Acionavel,
  type ComportamentoEconomico,
  type EfeitoNaRemuneracao,
  type FonteDeReferencia,
  type PapelEconomico,
  type SentidoEconomico,
  efeitoDaVariacao,
} from "@workspace/knowledge";
import type { ParametroAlterado } from "@workspace/comparison";
import { convertPeriodicity, type Periodicity } from "@workspace/simulation";

/**
 * De uma alteração apurada para uma conversa com o cliente — **ou para o
 * silêncio, quando é isso que a evidência sustenta.**
 *
 * Este arquivo é a decisão, e é uma função pura de propósito: recebe a linha
 * que o panorama já apurou, o comportamento econômico que
 * `@workspace/knowledge` declara e as transições medidas, e devolve o que se
 * pode dizer. Não consulta banco, não soma nada que outra autoridade já some, e
 * não conhece tela.
 *
 * **A regra que organiza tudo o que está abaixo:** o sinal matemático da
 * variação não é o sinal econômico dela. `TJLP` caindo 0,44 ponto derrubou os
 * juros que recebemos; `combustivelVidaCavalo` subindo é o calendário passando.
 * Por isso nada aqui decide pelo delta: o efeito vem do sentido declarado, e o
 * dinheiro vem de `variacao.preco`, que o panorama já separou do tamanho da
 * frota.
 *
 * **E a assimetria de custo é o princípio de projeto.** Uma proposta errada
 * queima a reunião seguinte inteira; uma investigação a mais custa uma
 * pergunta. Na dúvida, investiga.
 */

/** O que fazer com esta alteração. */
export type SituacaoDaRecomendacao =
  /** Há evidência de perda e uma alteração objetiva a pedir. */
  | "PROPOR_AJUSTE"
  /** Há impacto possível e falta informação para dizer qual seria o valor certo. */
  | "INVESTIGAR"
  /** Existe, e não é assunto de cliente: favorável, neutra, cadastral ou legítima. */
  | "NAO_PROPOR"
  /** A semântica ainda não permite ler a alteração economicamente. */
  | "NAO_CALCULAVEL";

export type Confianca = "ALTA" | "MEDIA" | "BAIXA";

/** O impacto, com as duas periodicidades separadas e a projeção marcada. */
export interface ImpactoEstimado {
  /** A variação de preço, na periodicidade declarada do parâmetro. */
  valor: number;
  periodicidade: string | null;
  /** Preenchido só quando a conversão é permitida. Nunca um zero de conforto. */
  mensal: number | null;
  anual: number | null;
  /** Alguma das duas acima passou por fator ≠ 1. */
  projetado: boolean;
  /** A frase de `convertPeriodicity`, para a tela citar a premissa. */
  explicacao: string;
}

/** O que aconteceu, no grão em que se conta para o cliente. */
export interface OQueAconteceu {
  antes: number;
  depois: number;
  unidade: string | null;
  /** A vigência em que a transição apareceu. */
  effectiveDate: string;
  sourceLabel: string;
  /** Ativos que fizeram exatamente esta transição. */
  entidades: number;
  /** Ativos que se moveram no sentido oposto na mesma leitura. */
  entidadesEmSentidoOposto: number;
  /**
   * Quantos padrões distintos de (antes → depois) a série tem.
   *
   * Um é premissa compartilhada — todo mundo saiu do mesmo valor para o mesmo
   * valor. Trinta são valores por ativo, e aí o par acima é ilustração, não
   * resumo. A tela precisa dizer qual dos dois está mostrando.
   */
  padroes: number;
  /**
   * Que fração dos ativos afetados este par explica, de 0 a 1.
   *
   * É o que separa "a premissa mudou de 8,2 para 9,1" de "cada ativo tem o seu
   * número e este é o mais comum". Abaixo de {@link COBERTURA_DE_PREMISSA} não
   * sai proposta com valor: propor um número que vale para um terço da frota
   * seria propor o número errado para os outros dois terços.
   */
  cobertura: number;
}

/** O padrão de transição medido — um par (antes, depois) numa vigência. */
export interface PadraoDeTransicao {
  effectiveDate: string;
  sourceLabel: string;
  antes: number;
  depois: number;
  entidades: number;
}

/** As transições de um parâmetro, com o que a série revela sobre elas. */
export interface TransicoesDoParametro {
  code: string;
  /** Transições de valor entre vigências entregues consecutivas. */
  total: number;
  /** Quantas têm zero de um dos lados. */
  comZero: number;
  /**
   * Ativos que **voltaram** a ter valor depois de zerar — a assinatura de uma
   * coluna que pisca.
   *
   * É o que separa intermitência de ciclo de vida, e sem ela o corte por
   * proporção de zeros erra nos dois sentidos. Medido no export real: as
   * colunas que piscam têm 30, 30, 30 e 15 ativos voltando; o tacógrafo que
   * passou a ser cadastrado, o lucro fixo do novo ciclo entrando e o FINAME do
   * implemento encerrando têm **zero** — todos os zeros deles apontam para o
   * mesmo lado, porque são eventos, não oscilação.
   */
  ativosQueOscilam: number;
  padroes: PadraoDeTransicao[];
}

export interface Recomendacao {
  code: string;
  title: string;
  entityType: string;
  equipment: string;

  situacao: SituacaoDaRecomendacao;
  confianca: Confianca;

  // ---- a leitura econômica ------------------------------------------------
  papel: PapelEconomico | null;
  sentido: SentidoEconomico | null;
  acionavel: Acionavel | null;
  /** A frase do mecanismo, de `@workspace/knowledge`. Vazia sem comportamento. */
  mecanismo: string;
  efeito: EfeitoNaRemuneracao;
  /** Ativos se moveram em direções opostas na mesma leitura. */
  direcoesMistas: boolean;

  // ---- o caso -------------------------------------------------------------
  oQueAconteceu: OQueAconteceu | null;
  /** Por que isso nos prejudica — ou por que não é assunto. Sem jargão. */
  porque: string;
  impacto: ImpactoEstimado | null;
  /** Por que não há impacto. Vazio quando há. */
  impactoMotivo: string;

  // ---- a proposta ---------------------------------------------------------
  valorAtual: number | null;
  valorRecomendado: number | null;
  diferenca: number | null;
  fonte: FonteDeReferencia | null;
  /** A pergunta a levar, quando não há o que propor. */
  oQuePerguntar: string | null;

  // ---- abrangência --------------------------------------------------------
  veiculosAfetados: number;
  veiculosNaSerie: number;
  alteracoes: number;
  /** Em que coluna o dinheiro deste parâmetro aparece, quando ele é driver. */
  alimenta: string[];
  dependeDe: string[];
  /** A medição que sustenta a leitura, para o detalhe técnico. */
  evidencia: string;
  /**
   * O que aconteceu **neste ativo**, quando a leitura é de uma placa só.
   *
   * `null` na leitura de frota, e a diferença importa: a aba lê os dois níveis,
   * e um objeto vazio faria a tela mostrar a camada do ativo sem ter ativo.
   *
   * A avaliação **não** usa este campo — situação, confiança, impacto e pedido
   * continuam saindo do comportamento do parâmetro sobre a série inteira. Ele é
   * leitura, e existe porque o cartão dizia "7 prejudicados" sem dizer se este
   * cavalo era um deles, que é a primeira pergunta de quem abre a tela do ativo.
   */
  noAtivo: MovimentoDoAtivo | null;
}

/** O par do próprio ativo, na vigência em que ele se moveu. */
export interface MovimentoDoAtivo {
  placa: string;
  antes: number;
  depois: number;
  effectiveDate: string;
  sourceLabel: string;
}

/**
 * A partir de qual proporção de transições com zero a série é candidata a
 * intermitente.
 *
 * Calibrado contra o export real, onde o caso não é de fronteira: as colunas de
 * lucro variável previsto e de consumo de referência têm **100%** das
 * transições com zero de um dos lados, e `manutencaoReaisKm` tem 99%. Um
 * parâmetro que de fato zera uma vez — um financiamento que encerra — fica bem
 * abaixo: `finameCavalo` tem 49% e `finame` da carreta, 30%.
 *
 * A proporção sozinha **não** basta, e o tacógrafo é a prova: 8 de 8 transições
 * dele têm zero, e mesmo assim ele não pisca — são implementos que passaram a
 * ter o item cadastrado. Por isso a decisão exige as duas coisas, e a segunda é
 * a que de fato descreve o fenômeno: ver {@link ehIntermitente}.
 */
export const LIMIAR_DE_INTERMITENCIA = 0.7;

/**
 * Que fração dos ativos afetados o padrão dominante precisa explicar para que
 * ele seja tratado como **premissa compartilhada**, e não como valor por ativo.
 *
 * A distinção decide se cabe propor um número. Uma premissa — a taxa, o prazo,
 * o valor do lucro fixo do novo ciclo — muda igual para todo mundo, e propor
 * "voltar para X" faz sentido. Um montante calculado ativo a ativo não: no
 * export real o IPVA do cavalo mudou em 62 placas com 30 pares distintos, e
 * "revisar de R$ 7.210 para R$ 21.259,89" seria o número errado para as outras
 * 32. Ali o que se pede é a **base** — a alíquota —, não o valor.
 */
export const COBERTURA_DE_PREMISSA = 0.6;

/** Onde confirmar o valor proposto, por fonte declarada. */
const FONTE_A_CONFIRMAR: Record<FonteDeReferencia, string> = {
  CONTRATO: "contrato",
  BOOK_OPERADOR: "Book do Operador",
  PARAMETRO_CONFIRMADO: "curadoria do parâmetro",
  REGRA_ECONOMICA: "regra econômica registrada",
  DOCUMENTO_CLIENTE: "documento do cliente",
  BENCHMARK: "benchmark de mercado",
  HISTORICO: "histórico da série",
  VIGENCIA_ANTERIOR: "vigência anterior",
};

const round2 = (v: number) => Math.round(v * 100) / 100;

const ehPeriodicidade = (p: string | null): p is Periodicity =>
  p === "MENSAL" || p === "ANUAL" || p === "PONTUAL";

/**
 * O impacto nas duas periodicidades, sem nunca somar uma com a outra.
 *
 * A conversão passa inteira por `convertPeriodicity` — inclusive a recusa de
 * converter pontual, que é o que impede um valor de aquisição de virar "custo
 * mensal" por uma divisão por doze que ninguém declarou. Quando ela recusa, o
 * campo fica nulo e a explicação diz por quê.
 */
export function projetarImpacto(
  valor: number,
  periodicidade: string | null,
): ImpactoEstimado {
  if (!ehPeriodicidade(periodicidade)) {
    return {
      valor: round2(valor),
      periodicidade,
      mensal: null,
      anual: null,
      projetado: false,
      explicacao:
        "Sem periodicidade confirmada, o valor não é projetado para mês nem " +
        "para ano — seria inventar uma recorrência que a fonte não declarou.",
    };
  }

  const paraMes = convertPeriodicity(periodicidade, "MENSAL");
  const paraAno = convertPeriodicity(periodicidade, "ANUAL");
  const explicacoes = [paraMes, paraAno]
    .filter((c) => c.explanation)
    .map((c) => c.explanation);

  return {
    valor: round2(valor),
    periodicidade,
    mensal: paraMes.allowed ? round2(valor * paraMes.factor) : null,
    anual: paraAno.allowed ? round2(valor * paraAno.factor) : null,
    projetado:
      (paraMes.allowed && paraMes.nature !== "EXATA") ||
      (paraAno.allowed && paraAno.nature !== "EXATA"),
    explicacao: [...new Set(explicacoes)].join(" "),
  };
}

export interface EntradaDaAvaliacao {
  parametro: ParametroAlterado;
  comportamento: ComportamentoEconomico | null;
  transicoes: TransicoesDoParametro | null;
  /** O parâmetro é coluna de conjunto — já contém o outro equipamento. */
  deConjunto?: boolean;
}

/**
 * O padrão que representa o caso, e quantos ativos foram para o outro lado.
 *
 * O representante é o padrão com mais ativos, e não a média: "de 8,2 para 9,1
 * em 73 veículos" é uma frase que alguém confere na planilha, e a média de
 * transições heterogêneas não é. Os que foram para o lado contrário viajam
 * junto porque o líquido esconde exatamente o que a conversa precisa — na
 * virada de Jan para Fev/2026 seis cavalos perderam TJLP e quatro ganharam, com
 * efeito líquido positivo.
 */
function representante(
  transicoes: TransicoesDoParametro | null,
  unidade: string | null,
  ativosAfetados: number,
): { caso: OQueAconteceu; mistas: boolean } | null {
  if (!transicoes || transicoes.padroes.length === 0) return null;

  const ordenados = [...transicoes.padroes].sort(
    (a, b) =>
      b.entidades - a.entidades ||
      Math.abs(b.depois - b.antes) - Math.abs(a.depois - a.antes),
  );
  const principal = ordenados[0];
  const direcao = Math.sign(principal.depois - principal.antes);

  /*
    Os que foram para o lado contrário **na mesma vigência**, e não na série
    inteira.

    A soma sobre todos os padrões contava o mesmo ativo uma vez por vigência em
    que ele se moveu, e o número estourava a frota: no export real o
    `combustivelConsumoNeg` aparecia como "64 de 64 cavalos afetados · 236 para
    o lado contrário", que é uma frase que não se confere em lugar nenhum. Um
    ativo tem um par de valores por vigência, então dentro de uma vigência a
    soma dos padrões conta cada placa no máximo uma vez — e é essa a leitura que
    a frase do cartão promete.
  */
  const opostos = ordenados
    .filter((p) => p.effectiveDate === principal.effectiveDate)
    .filter((p) => Math.sign(p.depois - p.antes) === -direcao)
    .reduce((soma, p) => soma + p.entidades, 0);

  /*
    A detecção de direções mistas, essa continua olhando a série inteira — mas
    **vigência a vigência**, e não no bolo. Subir numa vigência e descer noutra
    é a série andando no tempo, não ativos discordando entre si; o que interessa
    é uma virada em que uns sobem enquanto outros descem, porque é ali que o
    líquido esconde quem perdeu.
  */
  const sentidosPorVigencia = new Map<string, Set<number>>();
  for (const p of ordenados) {
    const sentido = Math.sign(p.depois - p.antes);
    if (sentido === 0) continue;
    const sentidos = sentidosPorVigencia.get(p.effectiveDate) ?? new Set();
    sentidos.add(sentido);
    sentidosPorVigencia.set(p.effectiveDate, sentidos);
  }
  const mistas = [...sentidosPorVigencia.values()].some(
    (s) => s.has(1) && s.has(-1),
  );

  return {
    caso: {
      antes: principal.antes,
      depois: principal.depois,
      unidade,
      effectiveDate: principal.effectiveDate,
      sourceLabel: principal.sourceLabel,
      entidades: principal.entidades,
      entidadesEmSentidoOposto: opostos,
      padroes: ordenados.length,
      cobertura:
        ativosAfetados > 0
          ? Math.min(1, principal.entidades / ativosAfetados)
          : 0,
    },
    mistas,
  };
}

/**
 * A série alterna entre um valor e zero em vez de mudar de preço.
 *
 * Duas condições, e as duas são necessárias. A proporção de zeros diz que a
 * coluna vive perto do zero; **os ativos que voltam depois de zerar** dizem que
 * o zero não foi um evento. Sem a segunda, o tacógrafo que passou a ser
 * cadastrado — 8 de 8 transições com zero, nenhum ativo voltando — seria lido
 * como coluna que pisca, e um ganho viraria uma investigação. Sem a primeira, o
 * FINAME do cavalo — 9 ativos que zeram e voltam com o novo ciclo, mas só 49%
 * de transições com zero — cairia junto.
 */
export function ehIntermitente(t: TransicoesDoParametro | null): boolean {
  if (!t || t.total === 0) return false;
  return (
    t.comZero / t.total >= LIMIAR_DE_INTERMITENCIA && t.ativosQueOscilam > 0
  );
}

/**
 * A avaliação de um parâmetro alterado.
 *
 * A ordem das perguntas é a ordem do risco, e cada porta fecha antes de a
 * seguinte poder errar: primeiro se há leitura econômica, depois se ela diz que
 * a coluna remunera alguma coisa, depois se o número é confiável, e só então se
 * há o que pedir. Uma proposta só sai da última porta.
 */
export function avaliarParametro(entrada: EntradaDaAvaliacao): Recomendacao {
  const { parametro: p, comportamento: c, transicoes } = entrada;

  const rep = representante(transicoes, p.unit, p.entities);
  const base = {
    code: p.code,
    title: p.title,
    entityType: p.entityType,
    equipment: p.equipment,
    papel: c?.papel ?? null,
    sentido: c?.sentido ?? null,
    acionavel: c?.acionavel ?? null,
    mecanismo: c?.mecanismo ?? "",
    direcoesMistas: rep?.mistas ?? false,
    oQueAconteceu: rep?.caso ?? null,
    impactoMotivo: p.impactoCalculavel ? "" : p.impactoMotivo,
    valorAtual: rep?.caso.depois ?? null,
    valorRecomendado: null as number | null,
    diferenca: null as number | null,
    fonte: null as FonteDeReferencia | null,
    oQuePerguntar: null as string | null,
    veiculosAfetados: p.entities,
    veiculosNaSerie: p.entitiesNaSerie,
    alteracoes: p.changes,
    alimenta: c?.alimenta ?? [],
    dependeDe: c?.dependeDe ?? [],
    evidencia: c?.evidencia ?? "",
    /*
      A camada do ativo é anexada pelo motor, depois da avaliação, e é de
      propósito: quem decide entre propor, investigar e não propor não pode ver
      a placa aberta na tela — a mesma linha tem de decidir igual lida da frota
      ou lida de dentro de um cavalo.
    */
    noAtivo: null as MovimentoDoAtivo | null,
  };

  // ---- porta 1: existe leitura econômica? ---------------------------------
  if (!c) {
    return {
      ...base,
      situacao: "NAO_CALCULAVEL",
      confianca: "BAIXA",
      efeito: "INDETERMINADO",
      porque:
        "Este parâmetro ainda não tem comportamento econômico declarado: não " +
        "sabemos se aumentá-lo aumenta ou reduz o que recebemos. Sem isso, " +
        "qualquer recomendação seria um palpite com aparência de conta.",
      impacto: null,
      oQuePerguntar:
        "Registrar o comportamento econômico deste parâmetro em " +
        "lib/knowledge/src/economia.ts, com a evidência que o sustente.",
    };
  }

  // ---- porta 2: a coluna remunera alguma coisa? ---------------------------
  if (c.sentido === "NULO") {
    return {
      ...base,
      situacao: "NAO_PROPOR",
      confianca: "ALTA",
      efeito: "SEM_EFEITO",
      porque:
        c.papel === "RELOGIO"
          ? `${c.mecanismo} Mudou porque o tempo passou — não há premissa a ` +
            `revisar, e pedir para reduzi-lo seria pedir para o ativo ` +
            `rejuvenescer.`
          : `${c.mecanismo} Não entra em nenhuma conta de remuneração, então a ` +
            `alteração não custa nem rende dinheiro.`,
      impacto: null,
    };
  }

  const impacto =
    p.impactoCalculavel && p.variacao
      ? projetarImpacto(p.variacao.preco, p.periodicity)
      : null;

  /*
    De onde sai o efeito, e por que de dois lugares diferentes.

    Num MONTANTE a coluna *é* o dinheiro: o efeito se lê da variação de preço
    que o panorama já separou do tamanho da frota. Num driver — taxa, prazo,
    grandeza física — o dinheiro está em outra coluna, e o que se tem aqui é o
    movimento do próprio parâmetro; aí o efeito vem do sentido declarado
    aplicado a esse movimento. Ler o delta de uma taxa como se fosse dinheiro é
    exatamente o erro que esta aba existe para não cometer.
  */
  const deltaObservado =
    c.papel === "MONTANTE" && impacto
      ? impacto.valor
      : rep
        ? rep.caso.depois - rep.caso.antes
        : null;

  const efeito: EfeitoNaRemuneracao =
    deltaObservado === null
      ? "INDETERMINADO"
      : rep?.mistas && c.papel !== "MONTANTE"
        ? "INDETERMINADO"
        : efeitoDaVariacao(c.sentido, deltaObservado);

  const intermitente = ehIntermitente(transicoes);

  // ---- porta 3: o número é confiável? -------------------------------------
  if (intermitente) {
    return {
      ...base,
      situacao: "INVESTIGAR",
      confianca: "BAIXA",
      efeito: "INDETERMINADO",
      porque:
        `A coluna alterna entre um valor e zero: ${transicoes!.comZero} das ` +
        `${transicoes!.total} transições têm zero de um dos lados. A variação ` +
        `entre duas vigências não é preço mudando — é a coluna aparecendo e ` +
        `sumindo. Pedir de volta esse valor seria cobrar o que ninguém tirou.`,
      // O impacto acompanha, porque ele é o que a aba Impacto mostra e alguém
      // vai perguntar por ele. O que muda é a leitura ao lado, não o número.
      impacto,
      oQuePerguntar:
        "Por que esta coluna vem zerada em algumas vigências? É ausência de " +
        "dado ou o valor de fato deixa de ser devido no período?",
    };
  }

  if (efeito === "AUMENTA") {
    return {
      ...base,
      situacao: "NAO_PROPOR",
      confianca: p.impactoCalculavel ? "ALTA" : "MEDIA",
      efeito,
      porque:
        `${c.mecanismo} Nesta série o movimento foi a nosso favor — ` +
        `${EFEITO_EM_PALAVRAS[efeito]}. Não há o que pedir ao cliente aqui, e ` +
        `levantar o assunto abriria uma revisão que só pode nos custar.`,
      impacto,
    };
  }

  if (efeito === "SEM_EFEITO") {
    return {
      ...base,
      situacao: "NAO_PROPOR",
      confianca: "MEDIA",
      efeito,
      porque: `${c.mecanismo} A alteração não moveu a remuneração.`,
      impacto,
    };
  }

  if (efeito === "INDETERMINADO") {
    const motivo = base.direcoesMistas
      ? `Os ativos se moveram em direções opostas: ${rep!.caso.entidades} foram ` +
        `de ${rep!.caso.antes} para ${rep!.caso.depois} e ` +
        `${rep!.caso.entidadesEmSentidoOposto} foram para o lado contrário. O ` +
        `líquido esconde quem perdeu, então o caso precisa ser lido ativo a ativo.`
      : c.sentido === "DEPENDE_DE_FORMULA"
        ? `${c.mecanismo} Sem a fórmula da fonte, dizer se isto nos prejudica ` +
          `seria adivinhar o sinal.`
        : `${c.mecanismo} Ainda não sabemos para que lado esta coluna empurra a ` +
          `remuneração.`;

    return {
      ...base,
      situacao: "INVESTIGAR",
      confianca: "BAIXA",
      efeito,
      porque: motivo,
      impacto,
      oQuePerguntar: base.direcoesMistas
        ? c.acionavel === "INDEXADO_EXTERNO"
          ? `Quais ativos tiveram o índice reduzido, e o valor aplicado em cada ` +
            `um confere com o publicado na data de ${rep!.caso.sourceLabel}?`
          : "Quais ativos tiveram o parâmetro reduzido, e por quê?"
        : c.dependeDe && c.dependeDe.length > 0
          ? `Obter ${c.dependeDe.join(" e ")} para fechar a conta.`
          : "Levantar a fórmula que a fonte aplica sobre este parâmetro.",
    };
  }

  // ---- daqui para baixo, o efeito é REDUZ ---------------------------------

  if (c.acionavel === "AUTOMATICO" || c.acionavel === "CADASTRAL") {
    return {
      ...base,
      situacao: "NAO_PROPOR",
      confianca: p.impactoCalculavel ? "ALTA" : "MEDIA",
      efeito,
      porque:
        `${c.mecanismo} A queda é consequência desse mecanismo, e não de uma ` +
        `premissa que alguém alterou — ` +
        `${ACIONAVEL_EM_PALAVRAS[c.acionavel]}. Pedir para desfazê-la seria ` +
        `pedir para reverter algo que aconteceu por si.`,
      impacto,
    };
  }

  if (!p.impactoCalculavel) {
    return {
      ...base,
      situacao: "INVESTIGAR",
      confianca: "MEDIA",
      efeito,
      porque:
        `${c.mecanismo} O movimento vai contra nós, mas o impacto em reais não ` +
        `pode ser apurado: ${p.impactoMotivo}.`,
      impacto: null,
      oQuePerguntar:
        c.dependeDe && c.dependeDe.length > 0
          ? `Obter ${c.dependeDe.join(" e ")} para transformar esta variação em ` +
            `dinheiro.`
          : "Confirmar a semântica deste parâmetro na curadoria para que a " +
            "variação vire um número.",
    };
  }

  if (c.acionavel === "INDEXADO_EXTERNO") {
    return {
      ...base,
      situacao: "INVESTIGAR",
      confianca: "MEDIA",
      efeito,
      porque:
        `${c.mecanismo} O valor aplicado caiu e a nossa remuneração caiu junto, ` +
        `mas este número é publicado por terceiro: o que cabe é conferir se o ` +
        `valor usado é o vigente na data, não propor outro.`,
      impacto,
      oQuePerguntar:
        `Conferir o índice publicado na data de ` +
        `${rep?.caso.sourceLabel ?? "vigência"} contra o valor aplicado ` +
        `(${rep?.caso.depois ?? "—"}).`,
    };
  }

  // NEGOCIAVEL, prejudica, e o dinheiro está apurado.
  /*
    O valor a propor é o último praticado — e a frase da tela diz isso, com a
    condição junto. O valor anterior é uma referência, não um valor devido: só
    o contrato ou o parâmetro confirmado sustentam "este é o número certo", e
    nenhum dos dois está neste export. Prometer mais do que se tem aqui é o
    erro que custa a reunião seguinte.
  */
  const anterior = rep?.caso.antes ?? null;
  if (anterior === null || !c.fonteDoValorRecomendado) {
    return {
      ...base,
      situacao: "INVESTIGAR",
      confianca: "MEDIA",
      efeito,
      porque:
        `${c.mecanismo} A alteração reduziu a nossa remuneração, e este é um ` +
        `parâmetro que o cliente parametriza — mas não há referência para ` +
        `dizer qual deveria ser o valor.`,
      impacto,
      oQuePerguntar: "Qual é o valor contratado para este parâmetro?",
    };
  }

  /*
    A última porta, e a que o dado real obrigou a existir.

    Um número só pode ser proposto quando ele é a **premissa**, e não o
    resultado dela. Dois sintomas denunciam o resultado: o valor é calculado a
    partir de outro parâmetro (`dependeDe`), ou os ativos não compartilham o
    mesmo par — no IPVA do cavalo são 62 placas com 30 pares distintos, e
    "revisar de R$ 7.210 para R$ 21.259,89" seria o número errado para as
    outras 32. Nos dois casos o que se pede é a base, e a pergunta diz qual.
  */
  const derivado = (c.dependeDe?.length ?? 0) > 0;
  const premissaCompartilhada =
    (rep?.caso.cobertura ?? 0) >= COBERTURA_DE_PREMISSA;

  if (derivado || !premissaCompartilhada) {
    return {
      ...base,
      situacao: "INVESTIGAR",
      confianca: "MEDIA",
      efeito,
      porque:
        `${c.mecanismo} O movimento reduziu a nossa remuneração, mas o número ` +
        `desta coluna é resultado e não premissa: ` +
        (derivado
          ? `ele é calculado a partir de ${c.dependeDe!.join(" e ")}. `
          : `os ${p.entities} ativos afetados têm ${rep!.caso.padroes} pares ` +
            `distintos de valor, então não há um valor único a propor. `) +
        `Pedir para “voltar ao valor anterior” proporia o número errado para ` +
        `parte da frota.`,
      impacto,
      oQuePerguntar: derivado
        ? `Qual é a base contratual usada no cálculo (${c.dependeDe!.join(", ")})? ` +
          `O que se revisa é a base, não o valor de cada ativo.`
        : `Qual é a regra que define este valor por ativo? Sem ela não há um ` +
          `número único a propor para os ${p.entities} afetados.`,
    };
  }

  return {
    ...base,
    situacao: "PROPOR_AJUSTE",
    confianca: "MEDIA",
    efeito,
    porque:
      `${c.mecanismo} O valor passou de ${anterior} para ${rep!.caso.depois} em ` +
      `${rep!.caso.sourceLabel}, afetando ${rep!.caso.entidades} ` +
      `${rep!.caso.entidades === 1 ? "ativo" : "ativos"}, e isso ` +
      `${EFEITO_EM_PALAVRAS[efeito]}.`,
    impacto,
    valorRecomendado: anterior,
    diferenca: round2(anterior - rep!.caso.depois),
    // A fonte é o que de fato sustenta o número proposto — a vigência anterior
    // —, e não a fonte ideal declarada no comportamento. Aquela é onde
    // confirmar, e a frase abaixo é quem diz isso.
    fonte: "VIGENCIA_ANTERIOR",
    oQuePerguntar:
      `Confirmar em ${FONTE_A_CONFIRMAR[c.fonteDoValorRecomendado]} se ` +
      `${anterior} é o valor devido. A recomendação é revisar de ` +
      `${rep!.caso.depois} para ${anterior} caso seja.`,
  };
}

/**
 * A ordem da lista: prioridade econômica, nunca alfabética.
 *
 * Perda recuperável primeiro, abrangência de frota depois, confiança em
 * seguida, recorrência por último. As investigações **não** vão para um bloco
 * no fim: uma investigação de R$ 731 mil merece mais atenção do que uma
 * proposta de R$ 300, e separá-las por situação enterraria a maior pergunta do
 * mês embaixo da menor proposta.
 */
export function ordenarPorPrioridade(recs: Recomendacao[]): Recomendacao[] {
  const PESO: Record<SituacaoDaRecomendacao, number> = {
    PROPOR_AJUSTE: 0,
    INVESTIGAR: 0,
    NAO_PROPOR: 1,
    NAO_CALCULAVEL: 2,
  };
  const PESO_CONFIANCA: Record<Confianca, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
  const dinheiro = (r: Recomendacao) => Math.abs(r.impacto?.valor ?? 0);

  return [...recs].sort(
    (a, b) =>
      PESO[a.situacao] - PESO[b.situacao] ||
      dinheiro(b) - dinheiro(a) ||
      b.veiculosAfetados - a.veiculosAfetados ||
      PESO_CONFIANCA[a.confianca] - PESO_CONFIANCA[b.confianca] ||
      b.alteracoes - a.alteracoes ||
      a.title.localeCompare(b.title, "pt-BR"),
  );
}
