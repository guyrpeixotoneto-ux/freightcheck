/**
 * A AUDITORIA DE CONSUMO — quantos quilômetros o litro faz, e quanto o litro
 * custa segundo a própria tabela de frete.
 *
 * ---------------------------------------------------------------------------
 * A rubrica que faltava, e o preço que ninguém via
 * ---------------------------------------------------------------------------
 * O diesel é a maior parcela do preço do quilômetro — é a primeira das nove que
 * a Auditoria de Km Rodado soma —, e até aqui este produto o mostrava por um
 * número só: `trecho.frete_reais_km_diesel`, o R$/km que entra no frete. De onde
 * esse R$/km vem, nenhuma tela dizia.
 *
 * Ele vem de duas coisas, e as duas estão no acervo: **o rendimento** (quantos
 * quilômetros o conjunto faz por litro naquele percurso) e **o preço do litro**.
 * O primeiro é declarado em duas colunas — a média do trecho e a média ajustada
 * pela carga. O segundo não é declarado em coluna nenhuma.
 *
 * E é justamente por isso que esta tela existe. O preço do litro **é
 * recuperável**, por uma identidade que a própria estrutura da tabela publica:
 *
 *     R$/km = preço do litro ÷ (km por litro)   ⟹   preço do litro = R$/km × km/l
 *
 * Multiplicando as duas colunas que o trecho declara, o preço do litro sobre o
 * qual aquele trecho foi precificado aparece. E aí vem o achado que nenhuma outra
 * leitura deste produto alcança: **numa mesma vigência, esse preço tem de ser um
 * só**. Quando um punhado de trechos devolve um diesel de outro preço, aqueles
 * trechos foram montados sobre outra premissa de combustível — e nenhuma coluna
 * do export diz isso em lugar nenhum.
 *
 * Um delta entre vigências nunca veria essa divergência: as duas colunas de cada
 * trecho continuam coerentes entre si, cada uma na sua linha. Só o produto delas,
 * comparado entre trechos da mesma vigência, a enxerga.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela responde, e o que ela recusa responder
 * ---------------------------------------------------------------------------
 * Ela responde **quanto combustível o contrato supõe** — rendimento, perdas e o
 * preço do litro embutido no preço. Ela **não** responde quanto diesel a
 * operação queimou: isso exigiria o abastecimento realizado por quinzena, que
 * este export não traz — o mesmo realizado que falta a Km Rodado, a Velocidade
 * Média e ao TMA.
 *
 * É a distinção que dá nome às coisas na tela inteira: o rendimento aqui é o
 * **parametrizado**, e não o medido. Um rendimento parametrizado acima do
 * praticado é diesel que a operação gasta e ninguém remunera; abaixo, é
 * combustível pago que não foi queimado. As duas conversas existem hoje, e nenhuma
 * delas se resolve inventando o litro que ninguém importou.
 *
 * ---------------------------------------------------------------------------
 * As colunas de combustível do cavalo ficam de fora, e por quê
 * ---------------------------------------------------------------------------
 * O `Modelo_Cavalo` declara seis colunas de combustível — a média do veículo
 * benchmark, a média negociada na revisão trimestral, o check dessa média, a
 * perda por vida do veículo, a vida do cavalo e o tipo de modelo de consumo. Elas
 * estão em {@link COLUNAS_DE_EQUIPAMENTO_DE_CONSUMO}, publicadas como aviso, e não na
 * tabela: são de **outro grão**. O rendimento que precifica o frete é o do
 * trecho, porque quem gasta diesel é o percurso — carga, relevo e região —, e
 * misturar uma tabela por trecho com linhas por placa não é uma tabela, são duas
 * coladas. É a mesma separação que a Auditoria de Pneu faz com as colunas de
 * pneu do equipamento.
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

/** Os seis estados de uma linha de consumo. O mesmo tipo dos demais recortes. */
export type EstadoDaLinhaDeConsumo = EstadoDaLinha;

/** O tipo de entidade desta rubrica. Um só: quem gasta diesel é o percurso. */
export const TIPO_DO_CONSUMO = "TRECHO";

// ---------------------------------------------------------------------------
// As colunas de combustível do equipamento — declaradas, e de outro grão
// ---------------------------------------------------------------------------

/** Uma coluna de combustível que o cavalo declara e que esta tela não compara. */
export interface ColunaDeEquipamentoDeConsumo {
  code: string;
  rotulo: string;
  entityType: "CAVALO";
  /** O que ela é, e por que não entra na tabela por trecho. */
  achado: string;
}

/**
 * As seis colunas de combustível do cavalo.
 *
 * Elas são o modelo de consumo **do veículo** — a média de referência, a média
 * negociada, o desgaste que a idade impõe. O que precifica o frete é o
 * rendimento **do trecho**, e é ele que esta tela compara. As seis ficam aqui,
 * nomeadas, para que quem for procurar consumo no `Modelo_Cavalo` saiba que elas
 * existem e por que este recorte não as usa.
 */
export const COLUNAS_DE_EQUIPAMENTO_DE_CONSUMO: readonly ColunaDeEquipamentoDeConsumo[] = [
  {
    code: "cavalo.combustivel_consumo_benchmark",
    rotulo: "Média do veículo benchmark",
    entityType: "CAVALO",
    achado:
      "O rendimento de referência do modelo do caminhão — a régua contra a qual a média " +
      "negociada é discutida. É do veículo, não do percurso.",
  },
  {
    code: "cavalo.combustivel_consumo_neg",
    rotulo: "Média negociada na revisão trimestral",
    entityType: "CAVALO",
    achado:
      "O rendimento que a revisão trimestral fixou para aquele caminhão. Move-se por " +
      "negociação, e não por trecho.",
  },
  {
    code: "cavalo.combustivel_consumo_neg_inteiro",
    rotulo: "Check da média negociada",
    entityType: "CAVALO",
    achado: "A conferência da média negociada — coluna de verificação, não de medida.",
  },
  {
    code: "cavalo.combustivel_percentual_perda_vida",
    rotulo: "Perda de consumo por vida do veículo",
    entityType: "CAVALO",
    achado:
      "Quanto rendimento a idade do caminhão custa. É a perda do **ativo**; as três " +
      "perdas desta tela — km, região e descartável — são do **percurso**, e as quatro " +
      "não se somam entre si sem saber em que ordem o modelo as aplica.",
  },
  {
    code: "cavalo.combustivel_vida_cavalo",
    rotulo: "Vida do cavalo",
    entityType: "CAVALO",
    achado: "A idade que alimenta a perda acima. Direcionador operacional, não custo.",
  },
  {
    code: "cavalo.tipo_combustivel_empurrada",
    rotulo: "Tipo de modelo de consumo",
    entityType: "CAVALO",
    achado:
      "Qual modelo de consumo aquele caminhão segue. É o que explicaria por que dois " +
      "trechos iguais têm rendimentos diferentes — e é cadastral, não numérico.",
  },
] as const;

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * O que a coluna é dentro da conta do consumo.
 *
 * - `RENDIMENTO` — km por litro. É razão, e o sentido dela é o **inverso** do de
 *   um custo: rendimento que sobe é dinheiro que desce. É por isso que ela tem
 *   papel próprio, e não é tratada como mais uma razão.
 * - `RAZAO` — R$/km. Vira dinheiro multiplicada por uma quilometragem.
 * - `POR_VIAGEM` — reais por ciclo. É a `RAZAO` já multiplicada pelo km.
 * - `PERDA` — percentual de perda de rendimento. Não é dinheiro e não soma com
 *   R$/km; ela **reduz** o km por litro, e é aí que vira custo.
 * - `CONTEXTO` — origem, destino e o km do ciclo.
 */
export type PapelDaColunaDeConsumo =
  | "RENDIMENTO"
  | "RAZAO"
  | "POR_VIAGEM"
  | "PERDA"
  | "CONTEXTO";

/** Uma variável de consumo, com o código único que o trecho usa. */
export interface VariavelDeConsumo {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelDaColunaDeConsumo;
  /** O código do atributo. Um só: `TRECHO` é o único tipo que o declara. */
  codigo: string;
  /** Uma coluna que não entra em soma nenhuma, e a razão disso. */
  foraDaSoma?: string;
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/**
 * As variáveis do consumo, na ordem em que a tela as lê.
 *
 * Começa nos dois rendimentos — o do trecho e o ajustado pela carga, que são o
 * eixo da rubrica —, segue pelos dois R$/km que eles produzem (o apurado e o que
 * entra no preço), e termina nas três perdas, que são o que separa um rendimento
 * do outro.
 */
export const VARIAVEIS_DE_CONSUMO: readonly VariavelDeConsumo[] = [
  {
    chave: "km_litro",
    rotulo: "Consumo do trecho",
    medida: "RENDIMENTO",
    papel: "RENDIMENTO",
    codigo: "trecho.diesel_consumo_km_l",
    ajuda:
      "Quantos quilômetros o conjunto faz por litro neste percurso — parametrizado, e " +
      "não medido. É o rendimento antes do ajuste da carga.",
  },
  {
    chave: "consumo_ajustado",
    rotulo: "Consumo ajustado pela carga",
    medida: "RENDIMENTO",
    papel: "RENDIMENTO",
    codigo: "trecho.consumo_diesel_ajustado",
    ajuda:
      "O rendimento depois do ajuste que a carga impõe. É ele, e não o do trecho, que " +
      "costuma ser o denominador do R$/km do diesel.",
  },
  {
    chave: "diesel_reais_km",
    rotulo: "Diesel R$/km apurado",
    medida: "REAIS_POR_KM",
    papel: "RAZAO",
    codigo: "trecho.diesel_consumo_diesel_reais_km",
    ajuda:
      "O custo do diesel por quilômetro que o modelo calcula. Multiplicado pelo km por " +
      "litro, ele devolve o preço do litro embutido neste trecho — que é a leitura " +
      "própria desta tela.",
  },
  {
    chave: "frete_reais_km_diesel",
    rotulo: "Diesel no preço do frete R$/km",
    medida: "REAIS_POR_KM",
    papel: "RAZAO",
    codigo: "trecho.frete_reais_km_diesel",
    ajuda:
      "A parcela de diesel que entra no preço do frete — a maior das nove que a " +
      "Auditoria de Km Rodado soma. Aqui ela é conferida contra o custo apurado ao lado.",
  },
  {
    chave: "perda_km",
    rotulo: "Perda por quilometragem",
    medida: "PERCENTUAL",
    papel: "PERDA",
    codigo: "trecho.percentual_perda_km",
    ajuda: "Quanto rendimento a distância do percurso custa.",
  },
  {
    chave: "perda_regiao",
    rotulo: "Perda por região",
    medida: "PERCENTUAL",
    papel: "PERDA",
    codigo: "trecho.percentual_perda_regiao",
    ajuda: "Quanto rendimento o relevo e o trânsito da região custam.",
  },
  {
    chave: "perda_descartavel",
    rotulo: "Perda descartável",
    medida: "PERCENTUAL",
    papel: "PERDA",
    codigo: "trecho.percentual_perda_descartavel",
    ajuda: "A parcela de perda que o modelo trata como descartável.",
  },
] as const;

/**
 * As variáveis que só o detalhe mostra.
 *
 * O R$/viagem do diesel, que é o mesmo dinheiro noutra forma e existe aqui para
 * conferir o km; o km do ciclo, que é o denominador dessa conferência; e a origem
 * e o destino, para que a gaveta seja legível.
 */
export const VARIAVEIS_DE_DETALHE_DE_CONSUMO: readonly VariavelDeConsumo[] = [
  {
    chave: "frete_reais_viagem_diesel",
    rotulo: "Diesel no preço do frete R$/viagem",
    medida: "DINHEIRO",
    papel: "POR_VIAGEM",
    codigo: "trecho.frete_reais_viagem_diesel",
    foraDaSoma:
      "É o R$/km de diesel multiplicado pelo km do ciclo — o dicionário da tabela de " +
      "frete avisa que somar as duas formas conta o mesmo dinheiro duas vezes. Ela " +
      "aparece aqui para conferir o km, nunca para somar.",
  },
  {
    chave: "km_ciclo",
    rotulo: "Km do ciclo",
    medida: "DISTANCIA",
    papel: "CONTEXTO",
    codigo: "trecho.km_rodado",
    ajuda:
      "Ida mais volta. Não é uma medida de consumo: está aqui porque é o denominador da " +
      "conferência — R$/viagem ÷ R$/km tem de devolver este número.",
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

const TODAS = [...VARIAVEIS_DE_CONSUMO, ...VARIAVEIS_DE_DETALHE_DE_CONSUMO];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeConsumo(variaveis: readonly VariavelDeConsumo[]): string[] {
  return [...new Set(variaveis.map((v) => v.codigo))].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_CONSUMO = codigosDeConsumo(VARIAVEIS_DE_CONSUMO);

/** O recorte do detalhe: tudo, inclusive o que não soma. */
export const CODIGOS_DO_DETALHE_DE_CONSUMO = codigosDeConsumo(TODAS);

const POR_CODIGO = new Map(TODAS.map((v) => [v.codigo, v]));

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeConsumoDoCodigo(
  code: string | null,
): VariavelDeConsumo | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

// ---------------------------------------------------------------------------
// A linha da tabela
// ---------------------------------------------------------------------------

/** Uma linha da tabela: um trecho, uma variável, os dois lados. */
export interface LinhaDeConsumo {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  /** A chave do trecho, como o motor a gravou. Identifica, mas não se lê. */
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  papel: PapelDaColunaDeConsumo;
  attributeCode: string | null;
  /** O texto do valor na vigência base. Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na vigência comparada. Nulo quando não há. */
  comparada: string | null;
  /** `comparada − base`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em **pontos percentuais**. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinhaDeConsumo;
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
 * Devolve `null` para o que não é de consumo — a função é o filtro e o tradutor
 * ao mesmo tempo, de modo que nenhuma tela precise saber quais são os códigos.
 */
export function linhaDeConsumoDaAlteracao(a: AlteracaoDoMotor): LinhaDeConsumo | null {
  const variavel = variavelDeConsumoDoCodigo(a.attributeCode);
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

/** As linhas de consumo de uma lista de alterações, na ordem em que vieram. */
export function linhasDeConsumo(
  alteracoes: readonly AlteracaoDoMotor[],
): LinhaDeConsumo[] {
  const linhas: LinhaDeConsumo[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeConsumoDaAlteracao(a);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/**
 * Um par de valores iguais virando linha — o alternador "sem alteração".
 *
 * Estas linhas **não vêm do motor**: o `change_set` só guarda o que mudou.
 */
export function linhaDeConsumoSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeConsumo | null {
  const variavel = variavelDeConsumoDoCodigo(par.attributeCode);
  if (!variavel) return null;
  return {
    id: null,
    entityLabel: par.entityLabel,
    entityType: par.entityType,
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    papel: variavel.papel,
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
// O impacto
// ---------------------------------------------------------------------------

/** O que o recorte moveu, separado pelo que cada coluna é. */
export interface ImpactoDeConsumo {
  /**
   * Um número por periodicidade, **nunca um total único** — e quase sempre
   * vazio, pela razão de sempre: nenhuma coluna desta tela é dinheiro do
   * período.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar. */
  naoCalculavel: number;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /** Parcelas de R$/km que se moveram. */
  razoesAlteradas: number;
  /**
   * Rendimentos que se moveram — e o indicador que esta tela tem a mais.
   *
   * Um rendimento que muda move o R$/km do diesel sem que nenhuma coluna de
   * dinheiro tenha sido tocada. Contá-lo à parte é o que impede que uma
   * renegociação de consumo passe por "nada mudou no custo".
   */
  rendimentosAlterados: number;
  /** Perdas de rendimento que se moveram. */
  perdasAlteradas: number;
}

/**
 * O impacto do recorte de consumo, e as três coisas que ele se recusa a fazer.
 *
 * **Não multiplica razão por quilometragem inventada** — a recusa comum às três
 * telas de trecho.
 *
 * **Não soma R$/km com R$/viagem**, que é o mesmo dinheiro em duas formas.
 *
 * **Não converte rendimento em dinheiro.** Um km/l que caiu 5% só vira reais
 * multiplicado por um preço do litro e por uma quilometragem — o primeiro esta
 * tela recupera, o segundo não existe no acervo. Meia conta não é conta.
 */
export function impactoDeConsumo(linhas: readonly LinhaDeConsumo[]): ImpactoDeConsumo {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;
  let razoesAlteradas = 0;
  let rendimentosAlterados = 0;
  let perdasAlteradas = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;

    if (l.papel === "RAZAO") {
      razoesAlteradas++;
      continue;
    }
    if (l.papel === "RENDIMENTO") {
      rendimentosAlterados++;
      continue;
    }
    if (l.papel === "PERDA") {
      perdasAlteradas++;
      continue;
    }
    if (l.papel === "CONTEXTO") continue;

    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    if (!l.impactoCalculado || l.impactoAmount === null) {
      if (l.medida === "DINHEIRO") naoCalculavel++;
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
    razoesAlteradas,
    rendimentosAlterados,
    perdasAlteradas,
  };
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos trechos cada vigência entregou — vem da contagem do motor. */
export interface TrechosDoParDeConsumo {
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeConsumo {
  trechosComparados: number;
  semAlteracao: number;
  trechosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  variaveisAlteradas: number;
  trechosComDadoIncompleto: number;
  trechosComConflito: number;
  impacto: ImpactoDeConsumo;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `trechos` vem do motor porque **esta lista não sabe** quantos trechos não
 * mudaram: um trecho sem nenhuma alteração não produz linha nenhuma.
 */
export function resumirConsumo(
  linhas: readonly LinhaDeConsumo[],
  trechos: TrechosDoParDeConsumo,
): ResumoDeConsumo {
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
    impacto: impactoDeConsumo(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeConsumo {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelDaColunaDeConsumo;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeConsumo(
  linhas: readonly LinhaDeConsumo[],
): AlteracoesDaVariavelDeConsumo[] {
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
export interface FatiaDeEstadoDeConsumo {
  estado: EstadoDaLinhaDeConsumo;
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
export function distribuicaoPorEstadoDeConsumo(
  linhas: readonly LinhaDeConsumo[],
  trechos: TrechosDoParDeConsumo,
): FatiaDeEstadoDeConsumo[] {
  const pior = new Map<string, EstadoDaLinhaDeConsumo>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeConsumo, number>();
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
// O preço do litro — a leitura própria desta tela
// ---------------------------------------------------------------------------

/** Um trecho lido de uma das duas vigências, no recorte do consumo. */
export interface ValorDeConsumo {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. */
  ponta: "BASE" | "COMPARADA";
  entityLabel: string | null;
  origem: string | null;
  destino: string | null;
  kmLitro: number | null;
  consumoAjustado: number | null;
  dieselReaisKm: number | null;
  freteReaisKmDiesel: number | null;
  freteReaisViagemDiesel: number | null;
  perdaKm: number | null;
  perdaRegiao: number | null;
  perdaDescartavel: number | null;
  kmCiclo: number | null;
}

/**
 * O preço do litro que um trecho embute, e de qual rendimento ele saiu.
 *
 * `rendimentoUsado` viaja junto porque **a conta muda de sentido conforme a
 * coluna**: o R$/km do diesel é montado sobre o rendimento ajustado pela carga, e
 * quando essa coluna não veio a conta cai no rendimento do trecho — o que produz
 * um preço do litro sistematicamente diferente. Sem dizer qual foi usado, os dois
 * apareceriam lado a lado na mesma série como se fossem a mesma medida.
 */
export interface PrecoDoLitroDoTrecho {
  /** `R$/km × km/l`. Nulo quando falta uma das duas pontas. */
  precoDoLitro: number | null;
  rendimentoUsado: "AJUSTADO" | "DO_TRECHO" | null;
}

/**
 * O preço do litro embutido num trecho.
 *
 * `R$/km = preço do litro ÷ (km por litro)`, então `preço = R$/km × km/l`. Os
 * dois fatores são colunas declaradas do mesmo trecho; o produto delas não é
 * declarado em lugar nenhum, e é a única forma de o preço do combustível aparecer
 * neste banco.
 *
 * O rendimento ajustado tem precedência porque é ele que o modelo usa: o ajuste
 * pela carga existe justamente para corrigir o rendimento antes de virar custo.
 * O do trecho é a queda quando o ajustado não veio, e sai **marcado** para que a
 * série não some as duas contas como se fossem uma.
 */
export function precoDoLitroDoTrecho(valor: ValorDeConsumo): PrecoDoLitroDoTrecho {
  const reaisKm = valor.dieselReaisKm;
  if (reaisKm === null || reaisKm === 0) {
    return { precoDoLitro: null, rendimentoUsado: null };
  }
  const ajustado = valor.consumoAjustado;
  const doTrecho = valor.kmLitro;
  const rendimento = ajustado !== null && ajustado > 0 ? ajustado : doTrecho;
  if (rendimento === null || rendimento <= 0) {
    return { precoDoLitro: null, rendimentoUsado: null };
  }
  return {
    precoDoLitro: Number((reaisKm * rendimento).toFixed(4)),
    rendimentoUsado: ajustado !== null && ajustado > 0 ? "AJUSTADO" : "DO_TRECHO",
  };
}

/**
 * Dois por cento de folga em torno do preço do litro de referência.
 *
 * O preço sai de um produto entre duas colunas já arredondadas — um R$/km com
 * quatro casas e um km/l com duas —, e o erro relativo dos dois se soma. Dois por
 * cento absorve esse arredondamento com sobra e continua acusando o que importa:
 * um trecho precificado sobre outra premissa de diesel erra por muito mais do que
 * dois por cento, porque o preço do combustível se move em degraus de centavos
 * sobre uma base de poucos reais.
 */
export const TOLERANCIA_DO_PRECO_DO_LITRO = 0.02;

/**
 * Meio centavo por quilômetro de folga entre o custo apurado e o preço cobrado.
 *
 * A mesma régua da Auditoria de Pneu, e pela mesma razão: as duas colunas são
 * R$/km escritos pela mesma fonte, e a única folga de que precisam é a do
 * arredondamento com que cada uma é publicada.
 */
export const TOLERANCIA_DO_DIESEL_EM_REAIS_POR_KM = 0.005;

/** Um por cento de folga entre o km implícito no preço e o km declarado. */
export const TOLERANCIA_DO_PRECO_DE_DIESEL = 0.01;

/**
 * O que a conferência de um trecho revelou.
 *
 * `PRECO_DO_LITRO_DESTOA` é a leitura que só esta tela faz: numa mesma vigência o
 * diesel tem um preço, e um trecho que devolve outro foi montado sobre outra
 * premissa de combustível.
 *
 * `FRETE_DIVERGE_DO_CUSTO` compara as duas colunas de R$/km — a apurada e a que
 * entra no preço —, como a Auditoria de Pneu faz com as dela.
 *
 * `PRECO_USA_OUTRO_KM` é a identidade do dicionário: `R$/viagem = R$/km × km`.
 */
export type VereditoDoConsumo =
  | "CONFERE"
  | "FRETE_DIVERGE_DO_CUSTO"
  | "PRECO_DO_LITRO_DESTOA"
  | "PRECO_USA_OUTRO_KM"
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DO_CONSUMO: Record<VereditoDoConsumo, string> = {
  CONFERE: "As contas fecham",
  FRETE_DIVERGE_DO_CUSTO: "O preço não é o custo apurado",
  PRECO_DO_LITRO_DESTOA: "O diesel embutido é de outro preço",
  PRECO_USA_OUTRO_KM: "O preço foi montado sobre outro km",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/** A conferência de um trecho numa ponta. */
export interface ConferenciaDoTrechoDeConsumo {
  precoDoLitro: number | null;
  rendimentoUsado: "AJUSTADO" | "DO_TRECHO" | null;
  /** O preço de referência contra o qual este trecho foi lido. */
  precoDeReferencia: number | null;
  /** `precoDoLitro − precoDeReferencia`, em reais por litro. */
  diferencaDoLitro: number | null;
  dieselReaisKm: number | null;
  freteReaisKmDiesel: number | null;
  /** `frete − apurado`, em R$/km. Negativo é preço abaixo do custo apurado. */
  diferencaDoPreco: number | null;
  kmImplicito: number | null;
  kmDeclarado: number | null;
  veredito: VereditoDoConsumo;
}

/**
 * As três contas do consumo, para um trecho.
 *
 * ---------------------------------------------------------------------------
 * A ordem dos testes é o que os torna verdadeiros
 * ---------------------------------------------------------------------------
 * 1. **Sem R$/km apurado e sem rendimento** → `BASE_INSUFICIENTE`. Sem os dois
 *    fatores não há preço do litro, e não há o que conferir.
 * 2. **Preço ≠ custo apurado** → `FRETE_DIVERGE_DO_CUSTO`, e decide antes do
 *    resto: é a divergência sobre o dinheiro que o trecho cobra, e ela vale
 *    qualquer que seja a premissa de diesel por trás.
 * 3. **O litro embutido destoa do da vigência** → `PRECO_DO_LITRO_DESTOA`.
 * 4. **O R$/viagem embute outro km** → `PRECO_USA_OUTRO_KM`.
 * 5. Caso contrário, `CONFERE`.
 *
 * `precoDeReferencia` entra por parâmetro, e não é calculado aqui, porque ele é
 * **da vigência e não do trecho**: é a mediana dos preços do litro de todos os
 * trechos da mesma ponta. Um trecho não sabe sozinho se destoa.
 */
export function conferenciaDoTrechoDeConsumo(
  valor: ValorDeConsumo,
  precoDeReferencia: number | null,
): ConferenciaDoTrechoDeConsumo {
  const { precoDoLitro, rendimentoUsado } = precoDoLitroDoTrecho(valor);

  const diferencaDoPreco =
    valor.dieselReaisKm === null || valor.freteReaisKmDiesel === null
      ? null
      : Number((valor.freteReaisKmDiesel - valor.dieselReaisKm).toFixed(6));

  const kmImplicito =
    valor.freteReaisKmDiesel === null ||
    valor.freteReaisKmDiesel === 0 ||
    valor.freteReaisViagemDiesel === null ||
    valor.freteReaisViagemDiesel === 0
      ? null
      : Number((valor.freteReaisViagemDiesel / valor.freteReaisKmDiesel).toFixed(4));

  const diferencaDoLitro =
    precoDoLitro === null || precoDeReferencia === null
      ? null
      : Number((precoDoLitro - precoDeReferencia).toFixed(4));

  const divergeDoCusto =
    diferencaDoPreco !== null &&
    Math.abs(diferencaDoPreco) > TOLERANCIA_DO_DIESEL_EM_REAIS_POR_KM;

  const litroDestoa =
    precoDoLitro !== null &&
    precoDeReferencia !== null &&
    precoDeReferencia !== 0 &&
    Math.abs(precoDoLitro - precoDeReferencia) / precoDeReferencia >
      TOLERANCIA_DO_PRECO_DO_LITRO;

  const km = valor.kmCiclo;
  const usaOutroKm =
    km !== null &&
    km !== 0 &&
    kmImplicito !== null &&
    Math.abs(kmImplicito - km) / km > TOLERANCIA_DO_PRECO_DE_DIESEL;

  const veredito: VereditoDoConsumo =
    precoDoLitro === null
      ? "BASE_INSUFICIENTE"
      : divergeDoCusto
        ? "FRETE_DIVERGE_DO_CUSTO"
        : litroDestoa
          ? "PRECO_DO_LITRO_DESTOA"
          : usaOutroKm
            ? "PRECO_USA_OUTRO_KM"
            : "CONFERE";

  return {
    precoDoLitro,
    rendimentoUsado,
    precoDeReferencia,
    diferencaDoLitro,
    dieselReaisKm: valor.dieselReaisKm,
    freteReaisKmDiesel: valor.freteReaisKmDiesel,
    diferencaDoPreco,
    kmImplicito,
    kmDeclarado: km,
    veredito,
  };
}

/** A mediana de uma lista não vazia. */
function mediana(xs: readonly number[]): number {
  const ordenados = [...xs].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 0
    ? (ordenados[meio - 1] + ordenados[meio]) / 2
    : ordenados[meio];
}

/**
 * O preço do litro de referência de uma ponta — a **mediana** entre os trechos.
 *
 * Mediana, e não média, pela razão de sempre neste produto: basta um punhado de
 * trechos precificado sobre outra premissa de diesel para a média sair no meio do
 * caminho entre duas respostas certas, e passar a acusar como desviantes
 * justamente os trechos corretos. A mediana devolve o preço que a maioria dos
 * trechos concorda em usar, que é a pergunta.
 *
 * Só os trechos com o rendimento **ajustado** entram na referência quando há
 * algum: misturar as duas contas moveria a referência conforme quantas colunas
 * ajustadas vieram, e não conforme o diesel.
 */
export function precoDoLitroDeReferencia(
  valores: readonly ValorDeConsumo[],
): number | null {
  const ajustados: number[] = [];
  const todos: number[] = [];
  for (const v of valores) {
    const { precoDoLitro, rendimentoUsado } = precoDoLitroDoTrecho(v);
    if (precoDoLitro === null) continue;
    todos.push(precoDoLitro);
    if (rendimentoUsado === "AJUSTADO") ajustados.push(precoDoLitro);
  }
  const base = ajustados.length > 0 ? ajustados : todos;
  return base.length === 0 ? null : Number(mediana(base).toFixed(4));
}

/** A conferência de uma ponta inteira — quantos trechos caem em cada veredito. */
export interface ConferenciaDaVigenciaDeConsumo {
  ponta: "BASE" | "COMPARADA";
  trechos: number;
  confere: number;
  divergeDoCusto: number;
  litroDestoa: number;
  precoUsaOutroKm: number;
  baseInsuficiente: number;
  /** O preço do litro que a vigência pratica — a mediana entre os trechos. */
  precoDoLitroDeReferencia: number | null;
  /** O menor e o maior preço do litro embutido, em reais. */
  precoDoLitroMinimo: number | null;
  precoDoLitroMaximo: number | null;
  /** Quantos trechos caíram na queda do rendimento do trecho, sem o ajustado. */
  semRendimentoAjustado: number;
}

/**
 * A conferência de cada ponta, trecho a trecho.
 *
 * Nunca um veredito único da vigência: o que interessa é **quantos** trechos caem
 * em cada leitura. Um diesel de outro preço em cinco trechos de quatrocentos é
 * uma fila de trabalho; em trezentos, é a tabela que mudou de premissa e ninguém
 * anotou.
 */
export function conferenciaDoConsumo(
  valores: readonly ValorDeConsumo[],
): ConferenciaDaVigenciaDeConsumo[] {
  const porPonta = new Map<"BASE" | "COMPARADA", ValorDeConsumo[]>();
  for (const v of valores) {
    const lista = porPonta.get(v.ponta) ?? [];
    lista.push(v);
    porPonta.set(v.ponta, lista);
  }

  const saida: ConferenciaDaVigenciaDeConsumo[] = [];
  for (const [ponta, lista] of porPonta) {
    const referencia = precoDoLitroDeReferencia(lista);
    const resumo: ConferenciaDaVigenciaDeConsumo = {
      ponta,
      trechos: 0,
      confere: 0,
      divergeDoCusto: 0,
      litroDestoa: 0,
      precoUsaOutroKm: 0,
      baseInsuficiente: 0,
      precoDoLitroDeReferencia: referencia,
      precoDoLitroMinimo: null,
      precoDoLitroMaximo: null,
      semRendimentoAjustado: 0,
    };

    for (const v of lista) {
      const c = conferenciaDoTrechoDeConsumo(v, referencia);
      resumo.trechos += 1;
      if (c.veredito === "CONFERE") resumo.confere += 1;
      if (c.veredito === "FRETE_DIVERGE_DO_CUSTO") resumo.divergeDoCusto += 1;
      if (c.veredito === "PRECO_DO_LITRO_DESTOA") resumo.litroDestoa += 1;
      if (c.veredito === "PRECO_USA_OUTRO_KM") resumo.precoUsaOutroKm += 1;
      if (c.veredito === "BASE_INSUFICIENTE") resumo.baseInsuficiente += 1;
      if (c.rendimentoUsado === "DO_TRECHO") resumo.semRendimentoAjustado += 1;
      if (c.precoDoLitro !== null) {
        resumo.precoDoLitroMinimo =
          resumo.precoDoLitroMinimo === null
            ? c.precoDoLitro
            : Math.min(resumo.precoDoLitroMinimo, c.precoDoLitro);
        resumo.precoDoLitroMaximo =
          resumo.precoDoLitroMaximo === null
            ? c.precoDoLitro
            : Math.max(resumo.precoDoLitroMaximo, c.precoDoLitro);
      }
    }
    saida.push(resumo);
  }

  return saida.sort((a, b) => a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// O rendimento por vigência
// ---------------------------------------------------------------------------

/** O rendimento de uma ponta, lido sobre os trechos dela. */
export interface RendimentoDaVigencia {
  ponta: "BASE" | "COMPARADA";
  /** Trechos com rendimento declarado. */
  trechos: number;
  /** A média simples do km/l do trecho. */
  kmLitroMedio: number | null;
  /** A média simples do km/l ajustado pela carga, sobre quem o declara. */
  ajustadoMedio: number | null;
  kmLitroMinimo: number | null;
  kmLitroMaximo: number | null;
  /**
   * A perda de rendimento que o ajuste impõe, medida — não a declarada.
   *
   * `1 − ajustado ÷ do trecho`, em pontos percentuais, sobre os trechos que têm
   * as duas colunas. É a única forma de ler as perdas sem supor em que ordem o
   * modelo aplica as três que ele declara.
   */
  perdaMedidaEmPontos: number | null;
  /** A média simples do R$/km do diesel apurado. */
  dieselReaisKmMedio: number | null;
}

/**
 * O rendimento de cada ponta — média simples entre trechos, pela razão de
 * sempre: ponderar pelo km do ciclo suporia que todos os trechos rodam o mesmo
 * número de viagens, que é o realizado que o acervo não tem.
 *
 * **A perda sai medida, e não somada.** O trecho declara três perdas — km, região
 * e descartável — e não declara em que ordem elas entram: somá-las produziria um
 * número diferente de multiplicá-las, e nenhum dos dois é o que o modelo fez. A
 * distância entre o rendimento do trecho e o ajustado é o efeito que de fato
 * ficou, e essa não depende de suposição nenhuma.
 */
export function rendimentoPorVigencia(
  valores: readonly ValorDeConsumo[],
): RendimentoDaVigencia[] {
  const porPonta = new Map<
    "BASE" | "COMPARADA",
    { km: number[]; ajustado: number[]; perdas: number[]; diesel: number[] }
  >();

  for (const v of valores) {
    const atual =
      porPonta.get(v.ponta) ?? { km: [], ajustado: [], perdas: [], diesel: [] };
    if (v.kmLitro !== null && v.kmLitro > 0) atual.km.push(v.kmLitro);
    if (v.consumoAjustado !== null && v.consumoAjustado > 0) {
      atual.ajustado.push(v.consumoAjustado);
    }
    if (
      v.kmLitro !== null &&
      v.kmLitro > 0 &&
      v.consumoAjustado !== null &&
      v.consumoAjustado > 0
    ) {
      atual.perdas.push((1 - v.consumoAjustado / v.kmLitro) * 100);
    }
    if (v.dieselReaisKm !== null) atual.diesel.push(v.dieselReaisKm);
    porPonta.set(v.ponta, atual);
  }

  const media = (xs: number[], casas = 2) =>
    xs.length === 0 ? null : Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(casas));

  return [...porPonta.entries()]
    .map(([ponta, a]) => ({
      ponta,
      trechos: a.km.length,
      kmLitroMedio: media(a.km),
      ajustadoMedio: media(a.ajustado),
      kmLitroMinimo: a.km.length === 0 ? null : Number(Math.min(...a.km).toFixed(2)),
      kmLitroMaximo: a.km.length === 0 ? null : Number(Math.max(...a.km).toFixed(2)),
      perdaMedidaEmPontos: media(a.perdas),
      dieselReaisKmMedio: media(a.diesel, 4),
    }))
    .sort((a, b) => a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_CONSUMO = [
  "Trecho",
  "Variável",
  "Unidade",
  "De",
  "Para",
  "Diferença",
  "Variação %",
  "Status",
  "Motivo",
  "Fora da soma",
  "Justificativa",
] as const;

/**
 * Como o CSV escreve a unidade de cada coluna, por extenso.
 *
 * Aqui a coluna decide um mal-entendido caro: `2,40` e `1,84` na mesma coluna são
 * um rendimento e um custo, e **sobem em sentidos opostos**. Sem a unidade
 * escrita, a planilha de outra pessoa lê as duas como "subiu 0,5" e conclui o
 * contrário do que aconteceu numa delas.
 */
export const UNIDADE_NO_CSV_DE_CONSUMO: Record<PapelDaColunaDeConsumo, string> = {
  RENDIMENTO: "km/l",
  RAZAO: "R$/km",
  POR_VIAGEM: "R$/viagem",
  PERDA: "%",
  CONTEXTO: "texto",
};

/**
 * Uma linha da tabela como as células do CSV.
 *
 * A justificativa entra por parâmetro porque **não é da linha**: ela é do gestor,
 * mora em `justificativa` e é lida por `change_id` numa segunda consulta.
 */
export function celulasDoCsvDeConsumo(
  l: LinhaDeConsumo,
  justificativa?: string | null,
): (string | number | null)[] {
  return [
    l.entityLabel,
    l.rotuloDaVariavel,
    UNIDADE_NO_CSV_DE_CONSUMO[l.papel],
    l.base,
    l.comparada,
    l.diferenca,
    l.variacao,
    ROTULO_DO_ESTADO[l.estado],
    l.motivo,
    l.foraDaSoma,
    justificativa ?? null,
  ];
}
