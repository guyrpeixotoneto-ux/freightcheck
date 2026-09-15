/**
 * A AUDITORIA DE VELOCIDADE MÉDIA — o tempo do ciclo do trecho, aberto entre o
 * que roda e o que espera.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e sobretudo o que ele não é
 * ---------------------------------------------------------------------------
 * Ele **não compara nada**, pela mesma razão dos cinco recortes anteriores:
 * comparar duas vigências linha a linha é o que `engine.ts` faz desde sempre. E
 * ele **não traduz o motor de novo**: os seis estados e a forma da alteração vêm
 * de `recorte-de-rubrica.ts`.
 *
 * O grão é o **trecho**, como na Auditoria de Km Rodado e pela mesma razão:
 * velocidade é uma propriedade de um percurso, não de um ativo parado no pátio.
 *
 * ---------------------------------------------------------------------------
 * O verbete pedia duas coisas. O acervo, neste grão, dá as duas — e nenhuma
 * delas é a que ele imaginava
 * ---------------------------------------------------------------------------
 * O verbete desta rota dizia depender de:
 *
 * 1. **distância e tempo na mesma linha**, porque velocidade é a razão entre os
 *    dois; e
 * 2. **a separação entre tempo rodando e tempo parado**, porque "o ativo
 *    esperando carga não abaixa a velocidade de quem dirigiu".
 *
 * As duas existem na tabela de frete, e é isso que torna esta tela possível sem
 * uma coluna nova no banco. O ciclo do trecho é declarado por extenso —
 * `cargaHorariaPorTrajetoMinuto` é "deslocamento ida e volta + TMA na origem +
 * TMA no destino + refeição" —, e cada uma dessas parcelas tem coluna própria.
 * Subtraindo as paradas do ciclo sobra **o tempo rodando**, que é exatamente a
 * separação que o verbete dizia faltar.
 *
 * **O que continua faltando é o realizado, e é outra coisa.** Estes são o tempo
 * e a distância **contratados** do trecho: o que o modelo de remuneração
 * parametriza, não o que um motorista praticou numa quinzena. A tela não afirma
 * a que velocidade alguém dirigiu; ela afirma a que velocidade o contrato supõe
 * que se dirija — e diz a diferença por extenso.
 *
 * ---------------------------------------------------------------------------
 * As três decisões que o dicionário da tabela de frete obrigou a escrever
 * ---------------------------------------------------------------------------
 * Todas em `docs/ACHADO-VELOCIDADE-MEDIA.md`:
 *
 * 1. **O ciclo se decompõe, e a decomposição é conferível.** Ciclo menos as três
 *    paradas dá o tempo de deslocamento; esse tempo com o km do ciclo dá uma
 *    velocidade — que tem de ser a declarada em `velocidadeMediaKmH`. Quando não
 *    é, a linha discorda de si mesma sobre quanto tempo se roda nela.
 * 2. **Tempo pago e tempo real são duas medidas, e a diferença é o assunto.** O
 *    dicionário é explícito: os pares `…Lucro` existem porque o tempo pago e o
 *    tempo real podem divergir, e "a diferença entre os dois é exatamente onde a
 *    conversa comercial acontece — não a apague escolhendo um só". As colunas da
 *    versão lucro ficam **fora de toda soma** — somá-las às operacionais contaria
 *    o mesmo minuto duas vezes — e a folga entre elas ganha painel próprio.
 * 3. **Velocidade não se soma, e não se tira média de trecho como se tira de
 *    dinheiro.** Velocidade é uma razão: a média das velocidades de dois trechos
 *    não é a velocidade média dos dois juntos. A tela mostra a média entre
 *    trechos dizendo que é isso, e nunca a chama de velocidade da operação.
 */

import {
  chaveDoVeiculo,
  estadoDaAlteracao,
  GRAVIDADE,
  numero,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type EstadoDaLinha,
  type MedidaDaVariavel,
} from "./recorte-de-rubrica";

export {
  estadoDaAlteracao,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type MedidaDaVariavel,
};

/** Os seis estados de uma linha de velocidade. O mesmo tipo dos demais. */
export type EstadoDaLinhaDeVelocidade = EstadoDaLinha;

/** O tipo de entidade desta rubrica — o mesmo do Km Rodado. */
export const TIPO_DA_VELOCIDADE = "TRECHO";

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * O que a coluna é dentro do ciclo do trecho.
 *
 * - `VELOCIDADE` — a razão declarada entre distância e tempo.
 * - `TEMPO_TOTAL` — o ciclo inteiro. Não soma com as parcelas dele: já as contém.
 * - `TEMPO_RODANDO` — deslocamento puro.
 * - `TEMPO_PARADO` — TMA de origem, TMA de destino e refeição. São as três
 *   parcelas que, subtraídas do ciclo, deixam o tempo rodando.
 * - `DISTANCIA` — o km que, com o tempo, produz a velocidade.
 * - `FATOR` — quantos motoristas por conjunto o trecho exige. É a ponte entre o
 *   tempo de ciclo e o custo de pessoal, e a única coluna desta tela que o
 *   dicionário liga a dinheiro.
 * - `CONTEXTO` — origem, destino, e o que mais situa sem medir.
 */
export type PapelDoTempo =
  | "VELOCIDADE"
  | "TEMPO_TOTAL"
  | "TEMPO_RODANDO"
  | "TEMPO_PARADO"
  | "DISTANCIA"
  | "FATOR"
  | "CONTEXTO";

/** Uma variável de velocidade média, com o código único que o trecho usa. */
export interface VariavelDeVelocidade {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelDoTempo;
  /** O código do atributo. Um só: `TRECHO` é o único tipo que o declara. */
  codigo: string;
  /**
   * A coluna é da versão **lucro** — o tempo que remunera, não o que a operação
   * pratica.
   */
  versaoLucro?: boolean;
  /**
   * Uma coluna que **não entra em soma nenhuma**, e a razão disso.
   *
   * Três famílias aqui, e cada uma por um motivo diferente: o ciclo, porque já
   * contém as parcelas; as da versão lucro, porque são o mesmo minuto medido
   * noutra régua; e as projeções de dia e mês, porque são o ciclo multiplicado
   * por uma frequência esperada.
   */
  foraDaSoma?: string;
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/**
 * As variáveis do tempo do trecho, na ordem em que a tela as lê.
 *
 * Começa na velocidade — que é a pergunta —, segue pelo ciclo e pelas três
 * paradas que o compõem, e termina na distância e no fator motorista, que são o
 * que a velocidade explica de cada lado: o percurso de um lado, o custo de
 * pessoal do outro.
 */
export const VARIAVEIS_DE_VELOCIDADE: readonly VariavelDeVelocidade[] = [
  {
    chave: "velocidade",
    rotulo: "Velocidade média declarada",
    medida: "VELOCIDADE",
    papel: "VELOCIDADE",
    codigo: "trecho.velocidade_media_km_h",
    ajuda:
      "A velocidade que o trecho declara. Com o km, ela produz o tempo de deslocamento — " +
      "e é essa identidade que a conferência desta tela fecha.",
  },
  {
    chave: "ciclo",
    rotulo: "Tempo total de ciclo",
    medida: "MINUTOS",
    papel: "TEMPO_TOTAL",
    codigo: "trecho.carga_horaria_por_trajeto_minuto",
    foraDaSoma:
      "É o ciclo inteiro — deslocamento de ida e volta mais TMA de origem, TMA de destino " +
      "e refeição. Somá-lo às parcelas que ele contém contaria o mesmo minuto duas vezes; " +
      "o que se faz com ele é o contrário, subtrair as parcelas para achar o tempo rodando.",
  },
  {
    chave: "trajeto",
    rotulo: "Tempo de deslocamento fábrica → CD",
    medida: "MINUTOS",
    papel: "TEMPO_RODANDO",
    codigo: "trecho.tempo_trajeto_fabrica_cd_minuto",
    ajuda:
      "Deslocamento puro, sem tempos internos. O dicionário diz que é o que a velocidade " +
      "média e o km produzem — e a tela mede sobre qual distância ele foi calculado, em " +
      "vez de supor.",
  },
  {
    chave: "tma_origem",
    rotulo: "TMA na origem",
    medida: "MINUTOS",
    papel: "TEMPO_PARADO",
    codigo: "trecho.tempo_interno_origem",
    ajuda: "Da chegada à saída carregado — fila e carregamento inclusos.",
  },
  {
    chave: "tma_destino",
    rotulo: "TMA no destino",
    medida: "MINUTOS",
    papel: "TEMPO_PARADO",
    codigo: "trecho.tempo_interno_destino",
    ajuda: "Da chegada à liberação — fila e descarga inclusas.",
  },
  {
    chave: "refeicao",
    rotulo: "Tempo de refeição",
    medida: "MINUTOS",
    papel: "TEMPO_PARADO",
    codigo: "trecho.tempo_refeicao_minuto",
    ajuda:
      "Minutos de refeição reconhecidos dentro do ciclo. Entram na jornada, e por ela no " +
      "dimensionamento de motoristas — é tempo parado que custa.",
  },
  {
    chave: "km_ciclo",
    rotulo: "Km do ciclo",
    medida: "DISTANCIA",
    papel: "DISTANCIA",
    codigo: "trecho.km_rodado",
    ajuda: "Ida mais volta. É a distância que, com o tempo rodando, produz a velocidade.",
  },
  {
    chave: "fator_ajustado",
    rotulo: "Fator motorista ajustado",
    medida: "FATOR",
    papel: "FATOR",
    codigo: "trecho.fator_motorista_ajustado",
    ajuda:
      "Quantos motoristas por conjunto o trecho exige de fato, dada a jornada e o tempo de " +
      "ciclo. É por aqui que o tempo parado vira custo de pessoal.",
  },
  {
    chave: "fator_indicado",
    rotulo: "Fator motorista de referência",
    medida: "FATOR",
    papel: "FATOR",
    codigo: "trecho.fator_motorista_indicado",
    ajuda:
      "O fator de referência para o tipo de trecho. Comparado ao ajustado, diz se a " +
      "operação está acima ou abaixo do padrão — a comparação é do próprio dicionário.",
  },
] as const;

/**
 * As variáveis que só o detalhe mostra.
 *
 * Três famílias, e nenhuma delas soma com o que está na tabela:
 *
 * - **a versão lucro** do ciclo e dos dois TMAs — o tempo que remunera, e não o
 *   que a operação pratica. O dicionário pede que a diferença entre as duas não
 *   seja apagada, e a tela lhe dá um painel próprio;
 * - **as projeções** de deslocamento por dia e por mês, que são o ciclo
 *   multiplicado por uma frequência esperada;
 * - **o km de ida e o contexto**, que existem para que a gaveta seja legível e
 *   para que a conferência saiba sobre qual distância o tempo de trajeto foi
 *   calculado.
 */
export const VARIAVEIS_DE_DETALHE_DE_VELOCIDADE: readonly VariavelDeVelocidade[] = [
  {
    chave: "ciclo_lucro",
    rotulo: "Tempo total de ciclo · versão lucro",
    medida: "MINUTOS",
    papel: "TEMPO_TOTAL",
    codigo: "trecho.carga_horaria_por_trajeto_minuto_lucro",
    versaoLucro: true,
    foraDaSoma:
      "É o mesmo ciclo calculado com os tempos internos da versão lucro — a base de tempo " +
      "que remunera, não a que a operação pratica. Somá-lo ao ciclo operacional contaria o " +
      "mesmo minuto duas vezes; a diferença entre os dois é que é o assunto.",
  },
  {
    chave: "tma_origem_lucro",
    rotulo: "TMA na origem · versão lucro",
    medida: "MINUTOS",
    papel: "TEMPO_PARADO",
    codigo: "trecho.tempo_interno_origem_lucro",
    versaoLucro: true,
    foraDaSoma:
      "O TMA de origem usado na conta de remuneração. Quando difere do operacional, a " +
      "diferença é entre o tempo pago e o tempo real — e é ela, não a soma, que interessa.",
  },
  {
    chave: "tma_destino_lucro",
    rotulo: "TMA no destino · versão lucro",
    medida: "MINUTOS",
    papel: "TEMPO_PARADO",
    codigo: "trecho.tempo_interno_destino_lucro",
    versaoLucro: true,
    foraDaSoma:
      "O TMA de destino usado na conta de remuneração. Quando difere do operacional, a " +
      "diferença é entre o tempo pago e o tempo real.",
  },
  {
    chave: "trajeto_dia",
    rotulo: "Deslocamento acumulado no dia",
    medida: "MINUTOS",
    papel: "TEMPO_RODANDO",
    codigo: "trecho.carga_horario_trajeto_dia",
    foraDaSoma:
      "É o deslocamento do ciclo multiplicado pelos ciclos que cabem na jornada — " +
      "projeção, não medição. Somá-lo ao tempo do ciclo misturaria um dia inteiro com " +
      "uma viagem.",
  },
  {
    chave: "trajeto_mes",
    rotulo: "Deslocamento acumulado no mês",
    medida: "MINUTOS",
    papel: "TEMPO_RODANDO",
    codigo: "trecho.carga_horario_trajeto_mes",
    foraDaSoma:
      "O tempo do dia projetado para o mês pelos dias úteis. Mesma razão da linha acima, " +
      "uma escala adiante.",
  },
  {
    chave: "jornada_mensal",
    rotulo: "Carga horária mensal do motorista",
    medida: "MINUTOS",
    papel: "CONTEXTO",
    codigo: "trecho.carga_horaria_motorista_puxada_mensal",
    ajuda:
      "Horas mensais que um motorista de puxada tem disponíveis. Dividida pelo tempo de " +
      "ciclo, é o que dá o fator motorista — a ponte entre esta tela e o custo de pessoal.",
  },
  {
    chave: "km_ida",
    rotulo: "Km de ida",
    medida: "DISTANCIA",
    papel: "DISTANCIA",
    codigo: "trecho.km_ida",
    ajuda:
      "Entra aqui porque a conferência precisa dele: é contra a ida e contra o ciclo que a " +
      "tela mede sobre qual distância o tempo de trajeto foi calculado.",
  },
  {
    chave: "origem",
    rotulo: "Origem",
    medida: "TEXTO",
    papel: "CONTEXTO",
    codigo: "trecho.origem",
  },
  {
    chave: "destino",
    rotulo: "Destino",
    medida: "TEXTO",
    papel: "CONTEXTO",
    codigo: "trecho.destino",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_VELOCIDADE, ...VARIAVEIS_DE_DETALHE_DE_VELOCIDADE];

/** As três parcelas de tempo parado que o ciclo contém. */
export const PARADAS_DO_CICLO = VARIAVEIS_DE_VELOCIDADE.filter(
  (v) => v.papel === "TEMPO_PARADO",
);

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeVelocidade(
  variaveis: readonly VariavelDeVelocidade[],
): string[] {
  return [...new Set(variaveis.map((v) => v.codigo))].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_VELOCIDADE = codigosDeVelocidade(VARIAVEIS_DE_VELOCIDADE);

/** O recorte do detalhe: tudo, inclusive a versão lucro e as projeções. */
export const CODIGOS_DO_DETALHE_DE_VELOCIDADE = codigosDeVelocidade(TODAS);

const POR_CODIGO = new Map(TODAS.map((v) => [v.codigo, v]));

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeVelocidadeDoCodigo(
  code: string | null,
): VariavelDeVelocidade | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

// ---------------------------------------------------------------------------
// A linha da tabela
// ---------------------------------------------------------------------------

/** Uma linha da tabela: um trecho, uma variável, os dois lados. */
export interface LinhaDeVelocidade {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  /** A chave do trecho, como o motor a gravou. Identifica, mas não se lê. */
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  papel: PapelDoTempo;
  /** A linha é da versão lucro — o tempo que remunera. */
  versaoLucro: boolean;
  attributeCode: string | null;
  /** O texto do valor na vigência base. Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na vigência comparada. Nulo quando não há. */
  comparada: string | null;
  /** `comparada − base`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em **pontos percentuais**. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinhaDeVelocidade;
  /** A frase da recusa, quando há. Vem do motor, não é escrita aqui. */
  motivo: string | null;
  impactoAmount: number | null;
  impactoPeriodicidade: string | null;
  impactoCalculado: boolean;
  /** O aviso da coluna que não soma, quando esta linha é de uma delas. */
  foraDaSoma: string | null;
}

/**
 * Uma alteração do motor virando linha da tabela.
 *
 * Devolve `null` para o que não é de velocidade — a função é o filtro e o
 * tradutor ao mesmo tempo, de modo que nenhuma tela precise saber os códigos.
 */
export function linhaDeVelocidadeDaAlteracao(
  a: AlteracaoDoMotor,
): LinhaDeVelocidade | null {
  const variavel = variavelDeVelocidadeDoCodigo(a.attributeCode);
  /*
    Entrada e saída não citam atributo: o motor as grava uma vez por entidade,
    no eixo da malha, e não uma vez por coluna.
  */
  if (!variavel) {
    if (a.changeType !== "ENTITY_ADDED" && a.changeType !== "ENTITY_REMOVED") return null;
    return {
      id: a.id ?? null,
      entityLabel: a.entityLabel,
      entityType: a.entityType ?? "",
      variavel: "trecho",
      rotuloDaVariavel: "Trecho na tabela",
      medida: "TEXTO",
      papel: "CONTEXTO",
      versaoLucro: false,
      attributeCode: null,
      base: a.valueBefore,
      comparada: a.valueAfter,
      diferenca: null,
      variacao: null,
      estado: estadoDaAlteracao(a),
      motivo: a.inconclusiveReason ?? null,
      impactoAmount: null,
      impactoPeriodicidade: null,
      impactoCalculado: false,
      foraDaSoma: null,
    };
  }

  return {
    id: a.id ?? null,
    entityLabel: a.entityLabel,
    entityType: a.entityType ?? "",
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    papel: variavel.papel,
    versaoLucro: Boolean(variavel.versaoLucro),
    attributeCode: a.attributeCode,
    base: a.valueBefore,
    comparada: a.valueAfter,
    diferenca: numero(a.deltaAbsolute),
    variacao: numero(a.deltaPercent),
    estado: estadoDaAlteracao(a),
    motivo: a.inconclusiveReason ?? null,
    impactoAmount: numero(a.impactAmount),
    impactoPeriodicidade: a.impactPeriodicity ?? null,
    impactoCalculado: a.impactConfidence === "CALCULATED",
    foraDaSoma: variavel.foraDaSoma ?? null,
  };
}

/** As linhas de velocidade de uma lista de alterações, na ordem em que vieram. */
export function linhasDeVelocidade(
  alteracoes: readonly AlteracaoDoMotor[],
): LinhaDeVelocidade[] {
  const linhas: LinhaDeVelocidade[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeVelocidadeDaAlteracao(a);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/**
 * Um par de valores iguais virando linha — o alternador "sem alteração".
 *
 * Estas linhas **não vêm do motor**: o `change_set` só guarda o que mudou. Elas
 * são montadas a partir das duas leituras de `getEntityTable`, uma por vigência,
 * e por isso carregam `id: null`.
 */
export function linhaDeVelocidadeSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeVelocidade | null {
  const variavel = variavelDeVelocidadeDoCodigo(par.attributeCode);
  if (!variavel) return null;
  return {
    id: null,
    entityLabel: par.entityLabel,
    entityType: par.entityType,
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    papel: variavel.papel,
    versaoLucro: Boolean(variavel.versaoLucro),
    attributeCode: par.attributeCode,
    base: par.valor,
    comparada: par.valor,
    diferenca: null,
    variacao: null,
    estado: "SEM_ALTERACAO",
    motivo: null,
    impactoAmount: null,
    impactoPeriodicidade: null,
    impactoCalculado: false,
    foraDaSoma: variavel.foraDaSoma ?? null,
  };
}

// ---------------------------------------------------------------------------
// O impacto — que aqui é inteiramente recusa
// ---------------------------------------------------------------------------

/** O que o recorte moveu, separado pelo que cada coluna é. */
export interface ImpactoDeVelocidade {
  /**
   * Um número por periodicidade, e nesta rubrica **sempre vazio na prática**.
   *
   * Nenhuma coluna desta tela é dinheiro: minuto é tempo, km/h é razão, km é
   * distância e fator motorista é uma contagem de gente por conjunto. O que
   * ficaria aqui é o que o motor tiver conseguido precificar — e a tela diz por
   * extenso por que o número não existe, em vez de mostrar R$ 0,00.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar, com motivo próprio. */
  naoCalculavel: number;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /** Minutos de tempo parado que se moveram — TMA e refeição. */
  paradasAlteradas: number;
  /** Velocidades declaradas que se moveram. */
  velocidadesAlteradas: number;
  /**
   * Alterações na **versão lucro** — o tempo que remunera.
   *
   * Contadas à parte porque uma mudança que acontece só do lado pago, sem a
   * operação se mover, é a conversa comercial inteira num número.
   */
  versaoLucroAlterada: number;
}

/**
 * O impacto do recorte de velocidade, e as três coisas que ele se recusa a fazer.
 *
 * **Não transforma minuto em dinheiro.** O tempo vira custo pelo fator motorista
 * e pela jornada, que são outra conta — e que dependem de quantas viagens a
 * operação de fato rodou, que este export não traz.
 *
 * **Não soma o ciclo com as parcelas dele.** O ciclo já as contém; somar seria
 * contar o mesmo minuto duas vezes.
 *
 * **Não soma a versão lucro com a operacional.** É o mesmo minuto medido em duas
 * réguas, e o dicionário pede explicitamente que a diferença não seja apagada.
 */
export function impactoDeVelocidade(
  linhas: readonly LinhaDeVelocidade[],
): ImpactoDeVelocidade {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;
  let paradasAlteradas = 0;
  let velocidadesAlteradas = 0;
  let versaoLucroAlterada = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;

    if (l.versaoLucro) versaoLucroAlterada++;
    if (l.papel === "TEMPO_PARADO" && !l.versaoLucro) paradasAlteradas++;
    if (l.papel === "VELOCIDADE") velocidadesAlteradas++;

    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    if (l.medida !== "DINHEIRO") continue;
    if (!l.impactoCalculado || l.impactoAmount === null) {
      naoCalculavel++;
      continue;
    }
    const balde = l.impactoPeriodicidade ?? "SEM_PERIODICIDADE";
    porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + l.impactoAmount;
  }

  for (const balde of Object.keys(porPeriodicidade)) {
    porPeriodicidade[balde] = Number(porPeriodicidade[balde].toFixed(6));
  }
  return {
    porPeriodicidade,
    naoCalculavel,
    foraDaSoma,
    paradasAlteradas,
    velocidadesAlteradas,
    versaoLucroAlterada,
  };
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos trechos cada vigência entregou — vem da contagem do motor. */
export interface TrechosDoParDeVelocidade {
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeVelocidade {
  trechosComparados: number;
  semAlteracao: number;
  trechosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  variaveisAlteradas: number;
  trechosComDadoIncompleto: number;
  trechosComConflito: number;
  impacto: ImpactoDeVelocidade;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `trechos` vem do motor porque **esta lista não sabe** quantos trechos não
 * mudaram: um trecho sem nenhuma alteração não produz linha nenhuma.
 */
export function resumirVelocidade(
  linhas: readonly LinhaDeVelocidade[],
  trechos: TrechosDoParDeVelocidade,
): ResumoDeVelocidade {
  const comAlteracao = new Set<string>();
  const comIncompleto = new Set<string>();
  const comConflito = new Set<string>();
  let variaveisAlteradas = 0;

  for (const l of linhas) {
    if (l.variavel === "trecho") continue;
    switch (l.estado) {
      case "ALTERADO":
        variaveisAlteradas++;
        comAlteracao.add(chaveDoVeiculo(l));
        break;
      case "DADO_INCOMPLETO":
        comIncompleto.add(chaveDoVeiculo(l));
        break;
      case "CONFLITO":
        comConflito.add(chaveDoVeiculo(l));
        break;
      default:
        break;
    }
  }

  const tocados = new Set([...comAlteracao, ...comIncompleto, ...comConflito]);
  return {
    trechosComparados: trechos.comparados,
    semAlteracao: Math.max(0, trechos.comparados - tocados.size),
    trechosComAlteracao: comAlteracao.size,
    novosNaVigencia: trechos.novos,
    ausentesNaComparada: trechos.ausentes,
    variaveisAlteradas,
    trechosComDadoIncompleto: comIncompleto.size,
    trechosComConflito: comConflito.size,
    impacto: impactoDeVelocidade(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeVelocidade {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelDoTempo;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeVelocidade(
  linhas: readonly LinhaDeVelocidade[],
): AlteracoesDaVariavelDeVelocidade[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    if (l.estado !== "ALTERADO" || l.variavel === "trecho") continue;
    contagem.set(l.variavel, (contagem.get(l.variavel) ?? 0) + 1);
  }
  return TODAS.filter((v) => contagem.has(v.chave))
    .map((v) => ({
      variavel: v.chave,
      rotulo: v.rotulo,
      medida: v.medida,
      papel: v.papel,
      alteracoes: contagem.get(v.chave)!,
    }))
    .sort((a, b) => b.alteracoes - a.alteracoes || a.rotulo.localeCompare(b.rotulo));
}

/** Uma fatia do gráfico de status. */
export interface FatiaDeEstadoDeVelocidade {
  estado: EstadoDaLinhaDeVelocidade;
  rotulo: string;
  trechos: number;
  fracao: number;
}

/**
 * Os trechos por estado — a rosca.
 *
 * Um trecho tem um estado só, e a ordem de gravidade decide qual. Sem essa regra
 * a soma das fatias passaria do total.
 */
export function distribuicaoPorEstadoDeVelocidade(
  linhas: readonly LinhaDeVelocidade[],
  trechos: TrechosDoParDeVelocidade,
): FatiaDeEstadoDeVelocidade[] {
  const pior = new Map<string, EstadoDaLinhaDeVelocidade>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeVelocidade, number>();
  for (const estado of pior.values()) {
    contagem.set(estado, (contagem.get(estado) ?? 0) + 1);
  }
  const tocados = [...pior.keys()].filter(
    (k) => pior.get(k) !== "NOVO_NA_VIGENCIA" && pior.get(k) !== "AUSENTE_NA_COMPARADA",
  ).length;
  contagem.set("SEM_ALTERACAO", Math.max(0, trechos.comparados - tocados));
  contagem.set("NOVO_NA_VIGENCIA", trechos.novos);
  contagem.set("AUSENTE_NA_COMPARADA", trechos.ausentes);

  const total = trechos.comparados + trechos.novos + trechos.ausentes;
  return GRAVIDADE.filter((e) => (contagem.get(e) ?? 0) > 0)
    .map((estado) => ({
      estado,
      rotulo: ROTULO_DO_ESTADO[estado],
      trechos: contagem.get(estado)!,
      fracao: total === 0 ? 0 : contagem.get(estado)! / total,
    }))
    .sort((a, b) => b.trechos - a.trechos);
}

// ---------------------------------------------------------------------------
// A leitura de um trecho — o tempo aberto, a velocidade conferida
// ---------------------------------------------------------------------------

/** Um trecho lido de uma das duas vigências. */
export interface ValorDeVelocidade {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  entityLabel: string | null;
  origem: string | null;
  destino: string | null;
  /** Em km/h, como o trecho a declara. */
  velocidade: number | null;
  /** Em minutos: o ciclo inteiro. */
  ciclo: number | null;
  /** Em minutos: o deslocamento puro que a fonte declara. */
  trajeto: number | null;
  tmaOrigem: number | null;
  tmaDestino: number | null;
  refeicao: number | null;
  kmCiclo: number | null;
  kmIda: number | null;
  /** A versão lucro, que remunera. */
  cicloLucro: number | null;
  tmaOrigemLucro: number | null;
  tmaDestinoLucro: number | null;
}

/**
 * O que a leitura de um trecho revelou sobre o tempo dele.
 *
 * `CICLO_NAO_COMPORTA_PARADAS` é o achado mais duro: as três paradas declaradas
 * somam mais do que o ciclo inteiro, o que faria o tempo rodando ser negativo. A
 * linha discorda de si mesma sobre quanto tempo ela dura.
 *
 * `VELOCIDADE_DIVERGE` é o segundo: o tempo rodando e o km do ciclo produzem uma
 * velocidade, e ela não é a declarada. Ou o ciclo foi montado com outro tempo de
 * deslocamento, ou a velocidade declarada não é a que o modelo usou.
 */
export type VereditoDaVelocidade =
  | "CONFERE"
  | "CICLO_NAO_COMPORTA_PARADAS"
  | "VELOCIDADE_DIVERGE"
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DA_VELOCIDADE: Record<VereditoDaVelocidade, string> = {
  CONFERE: "Tempo e velocidade fecham",
  CICLO_NAO_COMPORTA_PARADAS: "As paradas não cabem no ciclo",
  VELOCIDADE_DIVERGE: "A velocidade declarada não é a do ciclo",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/** Sobre qual distância o tempo de trajeto declarado foi calculado. */
export type BaseDoTrajeto = "IDA" | "CICLO" | "OUTRA" | "SEM_BASE";

export const ROTULO_DA_BASE_DO_TRAJETO: Record<BaseDoTrajeto, string> = {
  IDA: "sobre o km de ida",
  CICLO: "sobre o km do ciclo",
  OUTRA: "sobre outra distância",
  SEM_BASE: "sem base para dizer",
};

/**
 * Dois por cento de folga entre a velocidade declarada e a medida.
 *
 * O tempo rodando sai de uma **subtração** entre quatro tempos declarados em
 * minutos, cada um com seu arredondamento; a velocidade declarada costuma vir
 * com uma casa decimal. Somados, esses arredondamentos ficam abaixo de um por
 * cento num ciclo típico de algumas horas — dois por cento cobre isso com folga
 * e continua acusando o que importa: um ciclo montado sobre o trajeto de ida em
 * vez do de ida e volta erra por um fator de dois, não por dois por cento.
 */
export const TOLERANCIA_DA_VELOCIDADE = 0.02;

/** A leitura completa de um trecho — o tempo aberto e a velocidade conferida. */
export interface LeituraDoTrecho {
  /** A soma das três paradas declaradas, em minutos. */
  parado: number | null;
  /** `ciclo − parado`, em minutos. É o tempo rodando do ciclo inteiro. */
  rodando: number | null;
  /** Que fração do ciclo é tempo rodando. `0.62` para 62%. */
  fracaoRodando: number | null;
  /** A velocidade que o tempo rodando e o km do ciclo produzem, em km/h. */
  velocidadeMedida: number | null;
  /** A declarada, repetida aqui para que a frase da tela não a busque de novo. */
  velocidadeDeclarada: number | null;
  /** `medida − declarada`, em km/h. */
  diferencaDeVelocidade: number | null;
  /** Sobre qual distância o tempo de trajeto declarado parece ter sido calculado. */
  baseDoTrajeto: BaseDoTrajeto;
  /** `cicloLucro − ciclo`, em minutos. Positivo = paga-se mais tempo do que se roda. */
  folgaDoCiclo: number | null;
  /** A folga somada dos dois TMAs, em minutos. */
  folgaDosTmas: number | null;
  veredito: VereditoDaVelocidade;
}

/** A soma de uma lista em que um nulo contamina o total — ausência não é zero. */
function somaEstrita(valores: readonly (number | null)[]): number | null {
  let total = 0;
  for (const v of valores) {
    if (v === null) return null;
    total += v;
  }
  return total;
}

/**
 * A leitura de um trecho: abre o ciclo e confere a velocidade.
 *
 * ---------------------------------------------------------------------------
 * A separação que o verbete pedia
 * ---------------------------------------------------------------------------
 * `rodando = ciclo − (TMA origem + TMA destino + refeição)`. É a separação entre
 * tempo rodando e tempo parado que o verbete desta rota dizia faltar, e ela sai
 * da própria definição que o dicionário dá ao ciclo — não de uma suposição.
 *
 * **Uma parada ausente não vira zero.** Se qualquer das três não veio, o tempo
 * parado é nulo e o rodando também: tratar o ausente como zero inflaria o tempo
 * rodando e produziria uma velocidade alta e falsa, que é exatamente o número
 * que esta tela existe para não mostrar.
 *
 * ---------------------------------------------------------------------------
 * A conferência, e a ordem que a torna verdadeira
 * ---------------------------------------------------------------------------
 * 1. **Sem ciclo, sem paradas ou sem km** → `BASE_INSUFICIENTE`. Sem os três não
 *    há velocidade a medir, e afirmar qualquer coisa seria afirmar sobre nada.
 * 2. **As paradas não cabem no ciclo** → `CICLO_NAO_COMPORTA_PARADAS`, e decide
 *    antes da velocidade: um tempo rodando negativo ou nulo não produz
 *    velocidade nenhuma, e conferir contra ele seria conferir contra um absurdo.
 * 3. **A velocidade medida não é a declarada** → `VELOCIDADE_DIVERGE`.
 * 4. Caso contrário, `CONFERE`.
 *
 * ---------------------------------------------------------------------------
 * A base do trajeto é medida, não suposta
 * ---------------------------------------------------------------------------
 * O dicionário diz que `tempoTrajetoFabricaCDMinuto` é "o que a velocidade média
 * e o km produzem", mas não diz **qual** km — o de ida ou o do ciclo. Em vez de
 * escolher, a função multiplica a velocidade pelo tempo declarado e vê em qual
 * das duas distâncias o resultado cai. É a diferença entre uma suposição e uma
 * medição, e ela importa: lida como ciclo quando é ida, a conferência acusaria
 * metade da tabela de divergir.
 */
export function leituraDoTrecho(valor: ValorDeVelocidade): LeituraDoTrecho {
  const parado = somaEstrita([valor.tmaOrigem, valor.tmaDestino, valor.refeicao]);
  const rodando =
    parado === null || valor.ciclo === null ? null : Number((valor.ciclo - parado).toFixed(4));
  const fracaoRodando =
    rodando === null || valor.ciclo === null || valor.ciclo === 0
      ? null
      : Number((rodando / valor.ciclo).toFixed(4));

  const velocidadeMedida =
    rodando === null || rodando <= 0 || valor.kmCiclo === null
      ? null
      : Number((valor.kmCiclo / (rodando / 60)).toFixed(4));

  const velocidadeDeclarada = valor.velocidade;
  const diferencaDeVelocidade =
    velocidadeMedida === null || velocidadeDeclarada === null
      ? null
      : Number((velocidadeMedida - velocidadeDeclarada).toFixed(4));

  /*
    A distância que o tempo de trajeto declarado cobre, medida contra as duas
    candidatas. `OUTRA` é uma resposta legítima e não uma falha: quer dizer que
    aquele tempo não foi calculado nem sobre a ida nem sobre o ciclo.
  */
  let baseDoTrajeto: BaseDoTrajeto = "SEM_BASE";
  if (valor.trajeto !== null && velocidadeDeclarada !== null && velocidadeDeclarada > 0) {
    const distanciaDoTrajeto = (valor.trajeto / 60) * velocidadeDeclarada;
    const perto = (alvo: number | null) =>
      alvo !== null &&
      alvo !== 0 &&
      Math.abs(distanciaDoTrajeto - alvo) / alvo <= TOLERANCIA_DA_VELOCIDADE;
    baseDoTrajeto = perto(valor.kmIda)
      ? "IDA"
      : perto(valor.kmCiclo)
        ? "CICLO"
        : valor.kmIda === null && valor.kmCiclo === null
          ? "SEM_BASE"
          : "OUTRA";
  }

  const folgaDoCiclo =
    valor.cicloLucro === null || valor.ciclo === null
      ? null
      : Number((valor.cicloLucro - valor.ciclo).toFixed(4));
  const operacionais = somaEstrita([valor.tmaOrigem, valor.tmaDestino]);
  const pagos = somaEstrita([valor.tmaOrigemLucro, valor.tmaDestinoLucro]);
  const folgaDosTmas =
    operacionais === null || pagos === null ? null : Number((pagos - operacionais).toFixed(4));

  const veredito: VereditoDaVelocidade =
    valor.ciclo === null || parado === null || valor.kmCiclo === null
      ? "BASE_INSUFICIENTE"
      : rodando === null || rodando <= 0
        ? "CICLO_NAO_COMPORTA_PARADAS"
        : velocidadeMedida === null || velocidadeDeclarada === null || velocidadeDeclarada === 0
          ? "BASE_INSUFICIENTE"
          : Math.abs(velocidadeMedida - velocidadeDeclarada) / velocidadeDeclarada >
              TOLERANCIA_DA_VELOCIDADE
            ? "VELOCIDADE_DIVERGE"
            : "CONFERE";

  return {
    parado,
    rodando,
    fracaoRodando,
    velocidadeMedida,
    velocidadeDeclarada,
    diferencaDeVelocidade,
    baseDoTrajeto,
    folgaDoCiclo,
    folgaDosTmas,
    veredito,
  };
}

// ---------------------------------------------------------------------------
// As três séries da vigência
// ---------------------------------------------------------------------------

/** Como o ciclo médio de uma ponta se reparte entre rodar e esperar. */
export interface ParticaoDaVigencia {
  ponta: "BASE" | "COMPARADA";
  /** Trechos em que o ciclo se deixou abrir — os três tempos vieram. */
  trechos: number;
  /** Trechos em que as paradas não couberam no ciclo. */
  trechosSemDecomposicao: number;
  /** Médias simples entre trechos, em minutos. */
  cicloMedio: number | null;
  rodandoMedio: number | null;
  paradoMedio: number | null;
  tmaOrigemMedio: number | null;
  tmaDestinoMedio: number | null;
  refeicaoMedia: number | null;
  /** A fração média do ciclo que é tempo rodando. `0.62` para 62%. */
  fracaoRodandoMedia: number | null;
}

/** A média simples de uma lista, ou `null` quando ela está vazia. */
function media(xs: readonly number[], casas = 2): number | null {
  if (xs.length === 0) return null;
  return Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(casas));
}

/**
 * A partição do ciclo em cada ponta — a resposta ao segundo `depende` do verbete.
 *
 * "O ativo esperando carga não abaixa a velocidade de quem dirigiu": é
 * exatamente isso que esta série separa. O ciclo médio abre em tempo rodando e
 * tempo parado, e o parado abre nas três causas que o modelo declara.
 *
 * As médias são **simples entre trechos**, e a tela diz isso: um ciclo médio
 * ponderado exigiria saber quantas viagens cada trecho roda, que é o realizado
 * que não existe.
 */
export function particaoDoCicloPorVigencia(
  valores: readonly ValorDeVelocidade[],
): ParticaoDaVigencia[] {
  const porPonta = new Map<
    "BASE" | "COMPARADA",
    {
      ciclos: number[];
      rodando: number[];
      parado: number[];
      origem: number[];
      destino: number[];
      refeicao: number[];
      fracoes: number[];
      semDecomposicao: number;
    }
  >();

  for (const v of valores) {
    const leitura = leituraDoTrecho(v);
    const atual =
      porPonta.get(v.ponta) ??
      {
        ciclos: [],
        rodando: [],
        parado: [],
        origem: [],
        destino: [],
        refeicao: [],
        fracoes: [],
        semDecomposicao: 0,
      };

    if (leitura.veredito === "CICLO_NAO_COMPORTA_PARADAS") atual.semDecomposicao++;

    if (leitura.rodando !== null && leitura.rodando > 0 && v.ciclo !== null) {
      atual.ciclos.push(v.ciclo);
      atual.rodando.push(leitura.rodando);
      if (leitura.parado !== null) atual.parado.push(leitura.parado);
      if (leitura.fracaoRodando !== null) atual.fracoes.push(leitura.fracaoRodando);
      if (v.tmaOrigem !== null) atual.origem.push(v.tmaOrigem);
      if (v.tmaDestino !== null) atual.destino.push(v.tmaDestino);
      if (v.refeicao !== null) atual.refeicao.push(v.refeicao);
    }
    porPonta.set(v.ponta, atual);
  }

  return [...porPonta.entries()]
    .map(([ponta, a]) => ({
      ponta,
      trechos: a.ciclos.length,
      trechosSemDecomposicao: a.semDecomposicao,
      cicloMedio: media(a.ciclos),
      rodandoMedio: media(a.rodando),
      paradoMedio: media(a.parado),
      tmaOrigemMedio: media(a.origem),
      tmaDestinoMedio: media(a.destino),
      refeicaoMedia: media(a.refeicao),
      fracaoRodandoMedia: media(a.fracoes, 4),
    }))
    .sort((a, b) => a.ponta.localeCompare(b.ponta));
}

/** A conferência da velocidade numa ponta. */
export interface VelocidadeDaVigencia {
  ponta: "BASE" | "COMPARADA";
  trechos: number;
  confere: number;
  divergem: number;
  cicloNaoComportaParadas: number;
  baseInsuficiente: number;
  /** Médias simples entre trechos, em km/h. */
  declaradaMedia: number | null;
  medidaMedia: number | null;
  medidaMinima: number | null;
  medidaMaxima: number | null;
  /** A maior distância entre a medida e a declarada, em km/h. */
  maiorDiferenca: number | null;
  /** Quantos trechos calculam o tempo de trajeto sobre cada distância. */
  trajetoSobreIda: number;
  trajetoSobreCiclo: number;
  trajetoSobreOutra: number;
}

/**
 * A conferência da velocidade em cada ponta — nunca um veredito único.
 *
 * O que interessa é **quantos** trechos caem em cada leitura: cinco trechos com
 * a velocidade divergindo num universo de quatrocentos é uma fila de trabalho, e
 * não um diagnóstico da tabela inteira.
 *
 * As médias de velocidade são simples entre trechos, e a tela diz isso. A média
 * de duas velocidades não é a velocidade média de dois percursos — para isso
 * seria preciso ponderar por tempo ou por distância rodada, e a distância rodada
 * depende de quantas viagens cada trecho fez.
 */
export function velocidadePorVigencia(
  valores: readonly ValorDeVelocidade[],
): VelocidadeDaVigencia[] {
  const porPonta = new Map<
    "BASE" | "COMPARADA",
    {
      resumo: VelocidadeDaVigencia;
      declaradas: number[];
      medidas: number[];
    }
  >();

  for (const v of valores) {
    const leitura = leituraDoTrecho(v);
    const atual =
      porPonta.get(v.ponta) ??
      {
        resumo: {
          ponta: v.ponta,
          trechos: 0,
          confere: 0,
          divergem: 0,
          cicloNaoComportaParadas: 0,
          baseInsuficiente: 0,
          declaradaMedia: null,
          medidaMedia: null,
          medidaMinima: null,
          medidaMaxima: null,
          maiorDiferenca: null,
          trajetoSobreIda: 0,
          trajetoSobreCiclo: 0,
          trajetoSobreOutra: 0,
        } as VelocidadeDaVigencia,
        declaradas: [] as number[],
        medidas: [] as number[],
      };

    atual.resumo.trechos += 1;
    if (leitura.veredito === "CONFERE") atual.resumo.confere += 1;
    if (leitura.veredito === "VELOCIDADE_DIVERGE") atual.resumo.divergem += 1;
    if (leitura.veredito === "CICLO_NAO_COMPORTA_PARADAS") {
      atual.resumo.cicloNaoComportaParadas += 1;
    }
    if (leitura.veredito === "BASE_INSUFICIENTE") atual.resumo.baseInsuficiente += 1;

    if (leitura.baseDoTrajeto === "IDA") atual.resumo.trajetoSobreIda += 1;
    if (leitura.baseDoTrajeto === "CICLO") atual.resumo.trajetoSobreCiclo += 1;
    if (leitura.baseDoTrajeto === "OUTRA") atual.resumo.trajetoSobreOutra += 1;

    if (v.velocidade !== null) atual.declaradas.push(v.velocidade);
    if (leitura.velocidadeMedida !== null) atual.medidas.push(leitura.velocidadeMedida);
    if (leitura.diferencaDeVelocidade !== null) {
      const d = Math.abs(leitura.diferencaDeVelocidade);
      if (atual.resumo.maiorDiferenca === null || d > atual.resumo.maiorDiferenca) {
        atual.resumo.maiorDiferenca = Number(d.toFixed(4));
      }
    }

    porPonta.set(v.ponta, atual);
  }

  return [...porPonta.values()]
    .map(({ resumo, declaradas, medidas }) => ({
      ...resumo,
      declaradaMedia: media(declaradas),
      medidaMedia: media(medidas),
      medidaMinima: medidas.length === 0 ? null : Number(Math.min(...medidas).toFixed(2)),
      medidaMaxima: medidas.length === 0 ? null : Number(Math.max(...medidas).toFixed(2)),
    }))
    .sort((a, b) => a.ponta.localeCompare(b.ponta));
}

/** A folga entre o tempo pago e o tempo praticado, numa ponta. */
export interface TempoPagoDaVigencia {
  ponta: "BASE" | "COMPARADA";
  /** Trechos que declararam as duas versões do ciclo. */
  trechos: number;
  /** Trechos em que o ciclo pago é maior que o operacional. */
  pagaMais: number;
  /** Trechos em que ele é menor. */
  pagaMenos: number;
  /** Trechos em que os dois são iguais. */
  iguais: number;
  /** A folga média do ciclo, em minutos. Positiva = paga-se mais do que se roda. */
  folgaMediaDoCiclo: number | null;
  /** A maior folga observada, em minutos, com sinal. */
  maiorFolga: number | null;
  /** A folga média somada dos dois TMAs, em minutos. */
  folgaMediaDosTmas: number | null;
}

/**
 * A folga entre o tempo que remunera e o tempo que a operação pratica.
 *
 * Existe porque o dicionário da tabela de frete pede que ela exista, com todas
 * as letras: os pares `…Lucro` estão lá porque o tempo pago e o tempo real podem
 * divergir, e *"a diferença entre os dois é exatamente onde a conversa comercial
 * acontece — não a apague escolhendo um só"*.
 *
 * Esta série é essa diferença, e ela **não tem lado bom por si**: um ciclo pago
 * maior que o operacional pode ser uma folga negociada ou um tempo que a
 * operação deixou de praticar. A tela mostra os dois lados e o tamanho, e não
 * chama nenhum dos dois de erro.
 */
export function tempoPagoPorVigencia(
  valores: readonly ValorDeVelocidade[],
): TempoPagoDaVigencia[] {
  const porPonta = new Map<
    "BASE" | "COMPARADA",
    { resumo: TempoPagoDaVigencia; folgas: number[]; folgasTma: number[] }
  >();

  for (const v of valores) {
    const leitura = leituraDoTrecho(v);
    if (leitura.folgaDoCiclo === null && leitura.folgaDosTmas === null) continue;

    const atual =
      porPonta.get(v.ponta) ??
      {
        resumo: {
          ponta: v.ponta,
          trechos: 0,
          pagaMais: 0,
          pagaMenos: 0,
          iguais: 0,
          folgaMediaDoCiclo: null,
          maiorFolga: null,
          folgaMediaDosTmas: null,
        } as TempoPagoDaVigencia,
        folgas: [] as number[],
        folgasTma: [] as number[],
      };

    if (leitura.folgaDoCiclo !== null) {
      atual.resumo.trechos += 1;
      atual.folgas.push(leitura.folgaDoCiclo);
      if (leitura.folgaDoCiclo > 0) atual.resumo.pagaMais += 1;
      else if (leitura.folgaDoCiclo < 0) atual.resumo.pagaMenos += 1;
      else atual.resumo.iguais += 1;

      if (
        atual.resumo.maiorFolga === null ||
        Math.abs(leitura.folgaDoCiclo) > Math.abs(atual.resumo.maiorFolga)
      ) {
        atual.resumo.maiorFolga = leitura.folgaDoCiclo;
      }
    }
    if (leitura.folgaDosTmas !== null) atual.folgasTma.push(leitura.folgaDosTmas);

    porPonta.set(v.ponta, atual);
  }

  return [...porPonta.values()]
    .map(({ resumo, folgas, folgasTma }) => ({
      ...resumo,
      folgaMediaDoCiclo: media(folgas),
      folgaMediaDosTmas: media(folgasTma),
    }))
    .sort((a, b) => a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_VELOCIDADE = [
  "Trecho",
  "Variável",
  "Unidade",
  "Versão",
  "De",
  "Para",
  "Diferença",
  "Variação %",
  "Status",
  "Motivo",
  "Fora da soma",
] as const;

/**
 * Como o CSV escreve a unidade de cada coluna, por extenso.
 *
 * A coluna existe por causa do arquivo, e não da tela: aberto numa planilha,
 * `58`, `412` e `1,4` são três células numéricas na mesma coluna, e uma soma de
 * coluna junta km/h, minutos e motoristas sem avisar.
 */
const UNIDADE_NO_CSV: Record<PapelDoTempo, string> = {
  VELOCIDADE: "km/h",
  TEMPO_TOTAL: "minutos",
  TEMPO_RODANDO: "minutos",
  TEMPO_PARADO: "minutos",
  DISTANCIA: "km",
  FATOR: "motoristas por conjunto",
  CONTEXTO: "texto",
};

/**
 * Uma linha da tabela como as onze células do CSV.
 *
 * A coluna "Versão" separa o tempo que a operação pratica do tempo que
 * remunera. Sem ela, um arquivo com as duas versões lado a lado é uma lista de
 * minutos em que ninguém distingue os dois — e a diferença entre eles é
 * justamente o que o dicionário pede que não se apague.
 */
export function celulasDoCsvDeVelocidade(
  l: LinhaDeVelocidade,
): (string | number | null)[] {
  return [
    l.entityLabel,
    l.rotuloDaVariavel,
    UNIDADE_NO_CSV[l.papel],
    l.versaoLucro ? "Remuneração" : "Operação",
    l.base,
    l.comparada,
    l.diferenca,
    l.variacao,
    ROTULO_DO_ESTADO[l.estado],
    l.motivo,
    l.foraDaSoma,
  ];
}
