/**
 * A AUDITORIA DE MANUTENÇÃO E PNEU — o que se paga por rodar, e não por ter.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rubrica é de custo **variável**
 * ---------------------------------------------------------------------------
 * Porque ela não é medida em reais: é medida em **reais por quilômetro**. O
 * FINAME, o IPVA e o seguro custam o mesmo com o caminhão na garagem; a
 * manutenção só vira dinheiro quando o odômetro anda. É a mesma família de
 * Km Rodado e Velocidade Média, e não a de Custo Fixo — e a diferença não é de
 * arrumação de menu: um R$/km escrito como "R$ 0,34" numa tela de custo fixo é
 * trinta e quatro centavos lidos como se fossem a parcela do mês.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e o que ele não é
 * ---------------------------------------------------------------------------
 * Ele **não compara nada** — `engine.ts` faz isso desde sempre — e **não traduz
 * o motor de novo**: os seis estados vêm de `recorte-de-rubrica.ts`, como em
 * todas as rubricas. O que é próprio daqui é dizer quais atributos são de
 * manutenção, agregar os indicadores, e nomear as três duplicatas que o export
 * entrega.
 *
 * ---------------------------------------------------------------------------
 * As quatro coisas que o dado real obrigou a escrever
 * ---------------------------------------------------------------------------
 * Todas medidas nas 558 linhas de `Modelo_Cavalo` do acervo:
 *
 * 1. **`cavalo.valor_reajustado` é `cavalo.manutencao_contrato`.** O mesmo
 *    número, em 558 de 558 linhas. São duas colunas com dois nomes para um dado
 *    só, e somá-las contaria o contrato duas vezes. A segunda fica no detalhe,
 *    marcada, e fora de toda soma — o achado é que ela existe, não o valor dela.
 *
 * 2. **`cavalo.free_maintenance` é `cavalo.manutencao_free_maintenance`.**
 *    Idem: idênticas em 558 de 558. A tela mostra uma.
 *
 * 3. **O R$/km resolvido tem duas origens, e o export só explica uma.** Nas 126
 *    linhas que têm contrato, `manutencao_reais_km` é **exatamente** o
 *    `manutencao_contrato` — 126 de 126. Nas 432 sem contrato, ele não é o BID
 *    nem o contrato: é um terceiro número, e nenhuma coluna do export diz de
 *    onde ele vem. A tela mostra as três lado a lado e **não afirma a fórmula**,
 *    porque sugerir não é ver.
 *
 * ---------------------------------------------------------------------------
 * O pneu saiu daqui, e o que ficou é só manutenção
 * ---------------------------------------------------------------------------
 * Esta rubrica já se chamou "Manutenção e Pneu", e o pneu dela eram três colunas
 * do equipamento: `cavalo.valor_pneu` e `carreta.valor_pneus`, zeradas em 100%
 * das linhas dos dois lados, e `pneu_medida_empurrada`, a mesma medida para a
 * frota inteira. Com isso, pneu não era uma rubrica — era uma ressalva no rodapé
 * desta.
 *
 * O pneu **com dado** está na tabela de frete, por trecho, e agora tem tela
 * própria (`pneu.ts`): quantos pneus o conjunto leva, quanto custa cada um,
 * quanto custa a recapagem, quanto a carcaça devolve, quanto ela dura, e o R$/km
 * que sai disso. As três colunas de equipamento continuam declaradas lá, em
 * `COLUNAS_DE_EQUIPAMENTO_DE_PNEU`, com o que se mediu sobre cada uma.
 *
 * O que sobrou aqui é de um grão só e de um assunto só: **o contrato de
 * manutenção de um cavalo**. O `Modelo_Carreta` não declara coluna de manutenção
 * nenhuma — não é que venham zeradas, é que não existem —, e por isso esta
 * rubrica não tem mais recorte de carreta: `codigosDoRecorteDeManutencao`
 * devolve lista vazia para ela, que é a resposta certa.
 */

import {
  chaveDoVeiculo,
  ehEntradaOuSaidaDoGrao,
  estadoDaAlteracao,
  GRAVIDADE,
  numero,
  ROTULO_DO_ESTADO,
  TIPOS_DE_EQUIPAMENTO,
  type AlteracaoDoMotor,
  type EstadoDaLinha,
  type MedidaDaVariavel,
} from "./recorte-de-rubrica";
import {
  agruparVeiculos,
  medidasDoCatalogo,
  type OpcoesDoAgrupamento,
  type VeiculoDaRubrica,
} from "./agrupamento-por-veiculo";

export {
  estadoDaAlteracao,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type MedidaDaVariavel,
};

/** Os seis estados de uma linha desta rubrica. O mesmo tipo das demais. */
export type EstadoDaLinhaDeManutencao = EstadoDaLinha;

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/** Uma variável desta rubrica, com o código que cada equipamento usa. */
export interface VariavelDeManutencao {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  codigo: { CAVALO?: string; CARRETA?: string };
  /** Uma coluna que **não entra em soma nenhuma**, e a razão disso. */
  foraDaSoma?: string;
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/**
 * As variáveis da rubrica, na ordem em que a tela as lê.
 *
 * Começa no R$/km resolvido — o número que o contrato de manutenção daquele
 * caminhão custa hoje, e o que resume a placa —, segue pelas duas origens que o
 * explicam (BID e contrato), e termina no que emoldura os três: quanto tempo de
 * vida ainda há, quantos meses de free maintenance, e qual reajuste foi
 * aplicado.
 *
 * **Nenhuma delas é da carreta.** O `Modelo_Carreta` não tem coluna de
 * manutenção nenhuma — não é que venham zeradas, é que não existem. Desde que o
 * pneu saiu para `pneu.ts`, a carreta não declara variável nenhuma desta
 * rubrica, e o catálogo mostra isso: nenhum `codigo` tem chave `CARRETA`.
 */
export const VARIAVEIS_DE_MANUTENCAO: readonly VariavelDeManutencao[] = [
  {
    chave: "reais_km",
    rotulo: "Manutenção R$/km",
    medida: "REAIS_POR_KM",
    codigo: { CAVALO: "cavalo.manutencao_reais_km" },
    ajuda:
      "O R$/km que vale para este caminhão. Nas 126 linhas com contrato ele é " +
      "exatamente o R$/km do contrato; nas 432 sem contrato ele não é o BID nem o " +
      "contrato, e nenhuma coluna do export diz de onde vem. As três aparecem lado a " +
      "lado nesta tabela justamente para que a diferença seja visível.",
  },
  {
    chave: "bid",
    rotulo: "R$/km do BID",
    medida: "REAIS_POR_KM",
    codigo: { CAVALO: "cavalo.manutencao_bid" },
    ajuda:
      "O R$/km que saiu da concorrência: 10 valores distintos no acervo, de R$ 0,16 a " +
      "R$ 0,54, preenchido em todas as 558 linhas e nunca zero.",
  },
  {
    chave: "contrato",
    rotulo: "R$/km do contrato",
    medida: "REAIS_POR_KM",
    codigo: { CAVALO: "cavalo.manutencao_contrato" },
    ajuda:
      "Preenchido em 126 das 558 linhas, sempre com o mesmo valor (R$ 0,34); zero nas " +
      "demais. Onde ele existe, é ele que vira o R$/km resolvido — 126 de 126.",
  },
  {
    chave: "vida_meses",
    rotulo: "Vida em meses",
    medida: "MESES",
    codigo: { CAVALO: "cavalo.manutencao_vida_meses" },
    ajuda:
      "Quanto de vida útil o contrato ainda reconhece neste caminhão: 108 valores " +
      "distintos, de 0,5 a 67,9 meses. É a coluna que mais se move desta rubrica.",
  },
  {
    chave: "free_maintenance",
    rotulo: "Free maintenance",
    medida: "MESES",
    codigo: { CAVALO: "cavalo.manutencao_free_maintenance" },
    ajuda:
      "Os meses de manutenção inclusa na compra: 6 ou 0, e nada entre os dois. É o que " +
      "explica boa parte dos R$/km zerados — 102 dos 122.",
  },
  {
    chave: "percentual_reajuste",
    rotulo: "Reajuste aplicado",
    medida: "PERCENTUAL",
    codigo: { CAVALO: "cavalo.percentual_reajuste_aplicado" },
    ajuda:
      "O reajuste que já entrou no valor: 18 valores distintos, de 0 a 20,56%. É " +
      "percentual, e nunca entra numa soma de reais nem de R$/km.",
  },
] as const;

/**
 * As variáveis que só o detalhe mostra.
 *
 * Três duplicatas e três colunas de contexto. As duplicatas estão aqui porque o
 * achado é que elas existem: quem confere a planilha vai encontrá-las lá, e
 * sumir com elas deixaria a pessoa procurando por que o nosso número não bate
 * com o dela.
 */
export const VARIAVEIS_DE_DETALHE_DE_MANUTENCAO: readonly VariavelDeManutencao[] = [
  {
    chave: "valor_reajustado",
    rotulo: "Valor reajustado",
    medida: "REAIS_POR_KM",
    codigo: { CAVALO: "cavalo.valor_reajustado" },
    foraDaSoma:
      "É `cavalo.manutencao_contrato` com outro nome: o mesmo número em 558 de 558 " +
      "linhas do acervo. Duas colunas, um dado — somá-las contaria o contrato duas " +
      "vezes.",
  },
  {
    chave: "reaiskm_solto",
    rotulo: "R$/km (coluna solta)",
    medida: "REAIS_POR_KM",
    codigo: { CAVALO: "cavalo.reaiskm" },
    foraDaSoma:
      "Uma terceira coluna de R$/km, preenchida nas mesmas 126 linhas do contrato mas " +
      "com outro valor (R$ 0,32 contra R$ 0,34). Coincide com o R$/km resolvido em " +
      "apenas 122 das 558 — e essas 122 são justamente as zeradas. Não se sabe o que " +
      "ela é, e por isso ela não soma com nada.",
  },
  {
    chave: "manutencao_ano",
    rotulo: "Ano da manutenção",
    medida: "ANO",
    codigo: { CAVALO: "cavalo.manutencao_ano" },
    ajuda: "2021, 2022 ou 2025 — o ano de referência do contrato daquele caminhão.",
  },
  {
    chave: "faixa_km",
    rotulo: "Faixa de odômetro",
    medida: "TEXTO",
    codigo: { CAVALO: "cavalo.faixa_km" },
    ajuda:
      "A faixa em que o caminhão está — ATE_120000 a ATE_480000 no acervo. No " +
      "Freightech o contrato tem um R$/km por faixa; o export traz só a faixa atual e " +
      "o R$/km já resolvido, e não a linha inteira de faixas.",
  },
  {
    chave: "odometro_entrada",
    rotulo: "Odômetro de entrada",
    medida: "DISTANCIA",
    codigo: { CAVALO: "cavalo.odometro_entrada" },
    ajuda:
      "Com quantos quilômetros o caminhão entrou: de 2.000 a 544.061 no acervo. É o " +
      "contexto que diz se uma faixa alta é desgaste ou cadastro antigo.",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_MANUTENCAO, ...VARIAVEIS_DE_DETALHE_DE_MANUTENCAO];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeManutencao(
  variaveis: readonly VariavelDeManutencao[],
): string[] {
  const codigos = new Set<string>();
  for (const v of variaveis) {
    if (v.codigo.CAVALO) codigos.add(v.codigo.CAVALO);
    if (v.codigo.CARRETA) codigos.add(v.codigo.CARRETA);
  }
  return [...codigos].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_MANUTENCAO = codigosDeManutencao(VARIAVEIS_DE_MANUTENCAO);

/**
 * Os códigos de um recorte de equipamento — `TODOS`, `CAVALO` ou `CARRETA`.
 *
 * Existe porque nem toda leitura aceita recortar por `entity_type`: a Evolução
 * por Placa aceita (`tipo`), mas a leitura ponta a ponta só aceita uma lista de
 * atributos, e as duas precisam responder pelo mesmo recorte.
 *
 * Em `CARRETA` ele devolve **lista vazia**, e isso é a resposta certa: o
 * `Modelo_Carreta` não declara coluna de manutenção nenhuma. Enquanto o pneu
 * morava nesta rubrica, a carreta tinha uma variável — a zerada —, e a tela
 * abria uma aba para ela; com o pneu em `pneu.ts`, a aba deixou de ter o que
 * mostrar e deixou de existir. A função continua aceitando o recorte porque
 * quem chama não deve precisar saber disso para perguntar.
 */
export function codigosDoRecorteDeManutencao(
  recorte: "TODOS" | "CAVALO" | "CARRETA",
  variaveis: readonly VariavelDeManutencao[] = VARIAVEIS_DE_MANUTENCAO,
): string[] {
  if (recorte === "TODOS") return codigosDeManutencao(variaveis);
  const codigos = new Set<string>();
  for (const v of variaveis) {
    const codigo = v.codigo[recorte];
    if (codigo) codigos.add(codigo);
  }
  return [...codigos].sort();
}

/** O recorte do detalhe: tudo, inclusive as duplicatas e o contexto. */
export const CODIGOS_DO_DETALHE_DE_MANUTENCAO = codigosDeManutencao(TODAS);

const POR_CODIGO = new Map<string, VariavelDeManutencao>();
for (const v of TODAS) {
  if (v.codigo.CAVALO) POR_CODIGO.set(v.codigo.CAVALO, v);
  if (v.codigo.CARRETA) POR_CODIGO.set(v.codigo.CARRETA, v);
}

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeManutencaoDoCodigo(
  code: string | null,
): VariavelDeManutencao | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

/** O código que um tipo de equipamento usa para uma variável, quando existe. */
export function codigoDaVariavelDeManutencao(
  variavel: VariavelDeManutencao,
  entityType: string,
): string | undefined {
  const tipo = entityType.trim().toUpperCase();
  if (tipo === "CAVALO") return variavel.codigo.CAVALO;
  if (tipo === "CARRETA") return variavel.codigo.CARRETA;
  return undefined;
}

// ---------------------------------------------------------------------------
// A linha da tabela
// ---------------------------------------------------------------------------

/** Uma linha da tabela: um veículo, uma variável, os dois lados. */
export interface LinhaDeManutencao {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  attributeCode: string | null;
  /** O texto do valor na ponta "De". Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na ponta "Para". Nulo quando não há. */
  comparada: string | null;
  /** `Para − De`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em **pontos percentuais**. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinhaDeManutencao;
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
 * Devolve `null` para o que não é desta rubrica — a função é o filtro e o
 * tradutor ao mesmo tempo, de modo que nenhuma tela precise saber os códigos.
 *
 * As duplicatas **não** são barradas aqui: são o achado desta tela, e escondê-las
 * seria apagá-lo. Passam marcados, e quem soma
 * ({@link impactoDeManutencao}) os recusa pelo `foraDaSoma`.
 */
export function linhaDeManutencaoDaAlteracao(
  a: AlteracaoDoMotor,
): LinhaDeManutencao | null {
  const variavel = variavelDeManutencaoDoCodigo(a.attributeCode);
  /*
    Entrada e saída de ativo não citam atributo: o motor as grava uma vez por
    veículo, no eixo da frota, e não uma vez por coluna. Elas entram na tabela
    como a linha do veículo inteiro, com a variável em branco — sumir com elas
    seria esconder a metade mais visível do que mudou na frota.
  */
  if (!variavel) {
    if (!ehEntradaOuSaidaDoGrao(a, TIPOS_DE_EQUIPAMENTO)) return null;
    return {
      id: a.id ?? null,
      entityLabel: a.entityLabel,
      entityType: a.entityType ?? "",
      variavel: "veiculo",
      rotuloDaVariavel: "Veículo na frota",
      medida: "DATA",
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

/** As linhas desta rubrica numa lista de alterações, na ordem em que vieram. */
export function linhasDeManutencao(
  alteracoes: readonly AlteracaoDoMotor[],
): LinhaDeManutencao[] {
  const linhas: LinhaDeManutencao[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeManutencaoDaAlteracao(a);
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
export function linhaDeManutencaoSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeManutencao | null {
  const variavel = variavelDeManutencaoDoCodigo(par.attributeCode);
  if (!variavel) return null;
  return {
    id: null,
    entityLabel: par.entityLabel,
    entityType: par.entityType,
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
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
// O impacto — e as três coisas que ele se recusa a fazer
// ---------------------------------------------------------------------------

/** O impacto do recorte, por periodicidade. */
export interface ImpactoDeManutencao {
  /**
   * Um número por periodicidade, **nunca um total único**.
   *
   * Nesta rubrica o balde costuma vir vazio, e isso é honesto: R$/km não é
   * dinheiro até ser multiplicado por quilômetro rodado, e o quilômetro mora em
   * outra leitura. Ver {@link variacaoDoReaisKm} para o que esta tela mede no
   * lugar.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar. */
  naoCalculavel: number;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /**
   * Alterações em R$/km — o que de fato se move nesta rubrica.
   *
   * Elas não entram em `porPeriodicidade` porque não são reais: são reais por
   * quilômetro. Contá-las à parte é o que impede a tela de dizer "sem impacto"
   * sobre uma comparação em que o custo por quilômetro de meia frota mudou.
   */
  alteracoesDeReaisKm: number;
}

/**
 * O impacto do recorte, sem transformar R$/km em reais.
 *
 * **Não soma periodicidades diferentes.** Cada balde é uma periodicidade.
 *
 * **Não soma o que é duplicata nem o que é coluna sem dado.** O valor
 * reajustado e o R$/km solto saem pelo `foraDaSoma`.
 *
 * **Não multiplica R$/km por quilometragem.** A quilometragem é de outra
 * leitura (`km-rodado.ts`), de outra vigência e de outro grão; fazer a conta
 * aqui produziria um "impacto da manutenção" que nenhuma outra tela do produto
 * conseguiria reproduzir. O que se move em R$/km é contado, e dito em R$/km.
 */
export function impactoDeManutencao(
  linhas: readonly LinhaDeManutencao[],
): ImpactoDeManutencao {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;
  let alteracoesDeReaisKm = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;

    if (l.medida === "REAIS_POR_KM" && !l.foraDaSoma) alteracoesDeReaisKm++;

    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    if (!l.impactoCalculado || l.impactoAmount === null) {
      /*
        Só conta como "não precificado" o que era candidato a dinheiro. R$/km,
        meses, percentual e texto não são falha de cálculo: não são reais, e
        dizer que faltou precificá-los prometeria uma conversão que não existe.
      */
      if (l.medida === "DINHEIRO") naoCalculavel++;
      continue;
    }

    const balde = l.impactoPeriodicidade ?? "SEM_PERIODICIDADE";
    porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + l.impactoAmount;
  }

  for (const balde of Object.keys(porPeriodicidade)) {
    porPeriodicidade[balde] = Number(porPeriodicidade[balde].toFixed(6));
  }
  return { porPeriodicidade, naoCalculavel, foraDaSoma, alteracoesDeReaisKm };
}

/**
 * Quanto o R$/km da frota se moveu entre as duas pontas.
 *
 * É o número que esta tela tem no lugar do impacto em reais, e ele é dito na
 * unidade em que foi medido: **R$/km**, somado sobre os veículos do recorte.
 * Multiplicá-lo por uma quilometragem daria reais — e daria um número que nem
 * `km-rodado.ts` nem o fechamento reconheceriam, porque a quilometragem que
 * entraria na conta é de outro grão e de outra vigência.
 *
 * `veiculos` acompanha a soma porque um delta de R$ 0,06 espalhado por 200
 * caminhões e o mesmo R$ 0,06 num caminhão só não são a mesma notícia.
 */
export function variacaoDoReaisKm(linhas: readonly LinhaDeManutencao[]): {
  soma: number;
  veiculos: number;
  subiram: number;
  cairam: number;
} {
  const veiculos = new Set<string>();
  let soma = 0;
  let subiram = 0;
  let cairam = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO" || l.variavel !== "reais_km") continue;
    if (l.diferenca === null) continue;
    soma += l.diferenca;
    veiculos.add(chaveDoVeiculo(l));
    if (l.diferenca > 0) subiram++;
    if (l.diferenca < 0) cairam++;
  }

  return { soma: Number(soma.toFixed(4)), veiculos: veiculos.size, subiram, cairam };
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos veículos cada vigência entregou — vem da contagem do motor. */
export interface FrotaDoParDeManutencao {
  /** Veículos presentes nas duas vigências. */
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeManutencao {
  veiculosComparados: number;
  /** Comparados que não tiveram nenhuma variável desta rubrica alterada. */
  semAlteracao: number;
  veiculosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  /** Quantas variáveis se moveram, somando todos os veículos. */
  variaveisAlteradas: number;
  veiculosComDadoIncompleto: number;
  veiculosComConflito: number;
  impacto: ImpactoDeManutencao;
  /** O que a tela mostra no lugar do impacto em reais. */
  reaisKm: ReturnType<typeof variacaoDoReaisKm>;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `frota` vem do motor porque **esta lista não sabe** quantos veículos não
 * mudaram: um veículo sem nenhuma alteração não produz linha nenhuma.
 */
export function resumirManutencao(
  linhas: readonly LinhaDeManutencao[],
  frota: FrotaDoParDeManutencao,
): ResumoDeManutencao {
  const comAlteracao = new Set<string>();
  const comIncompleto = new Set<string>();
  const comConflito = new Set<string>();
  let variaveisAlteradas = 0;

  for (const l of linhas) {
    if (l.variavel === "veiculo") continue;
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

  /*
    "Sem alteração" é o que **nenhuma** linha tocou — e não só o que não mudou
    de valor. Subtrair apenas os alterados foi o defeito que a primeira tela de
    FINAME sobre dado real mostrou, e a regra vale igual aqui.
  */
  const tocados = new Set([...comAlteracao, ...comIncompleto, ...comConflito]);
  return {
    veiculosComparados: frota.comparados,
    semAlteracao: Math.max(0, frota.comparados - tocados.size),
    veiculosComAlteracao: comAlteracao.size,
    novosNaVigencia: frota.novos,
    ausentesNaComparada: frota.ausentes,
    variaveisAlteradas,
    veiculosComDadoIncompleto: comIncompleto.size,
    veiculosComConflito: comConflito.size,
    impacto: impactoDeManutencao(linhas),
    reaisKm: variacaoDoReaisKm(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeManutencao {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeManutencao(
  linhas: readonly LinhaDeManutencao[],
): AlteracoesDaVariavelDeManutencao[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    if (l.estado !== "ALTERADO" || l.variavel === "veiculo") continue;
    contagem.set(l.variavel, (contagem.get(l.variavel) ?? 0) + 1);
  }
  return TODAS.filter((v) => contagem.has(v.chave))
    .map((v) => ({
      variavel: v.chave,
      rotulo: v.rotulo,
      medida: v.medida,
      alteracoes: contagem.get(v.chave)!,
    }))
    .sort((a, b) => b.alteracoes - a.alteracoes || a.rotulo.localeCompare(b.rotulo));
}

/** Uma fatia do gráfico de status. */
export interface FatiaDeEstadoDeManutencao {
  estado: EstadoDaLinhaDeManutencao;
  rotulo: string;
  veiculos: number;
  /** A fração sobre o total de veículos do recorte. `0.852` para 85,2%. */
  fracao: number;
}

/**
 * Os veículos por estado — a rosca.
 *
 * Um veículo tem um estado só, e a ordem de gravidade decide qual: quem tem
 * conflito aparece como conflito ainda que também tenha uma variável alterada.
 */
export function distribuicaoPorEstadoDeManutencao(
  linhas: readonly LinhaDeManutencao[],
  frota: FrotaDoParDeManutencao,
): FatiaDeEstadoDeManutencao[] {
  const pior = new Map<string, EstadoDaLinhaDeManutencao>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeManutencao, number>();
  for (const estado of pior.values()) {
    contagem.set(estado, (contagem.get(estado) ?? 0) + 1);
  }
  /* Os que não produziram linha nenhuma são, por definição, os sem alteração. */
  const tocados = [...pior.values()].filter(
    (e) => e !== "NOVO_NA_VIGENCIA" && e !== "AUSENTE_NA_COMPARADA",
  ).length;
  const semAlteracao = Math.max(0, frota.comparados - tocados);
  if (semAlteracao > 0) {
    contagem.set("SEM_ALTERACAO", (contagem.get("SEM_ALTERACAO") ?? 0) + semAlteracao);
  }

  const total = [...contagem.values()].reduce((s, n) => s + n, 0);
  return GRAVIDADE.filter((e) => (contagem.get(e) ?? 0) > 0)
    .map((estado) => ({
      estado,
      rotulo: ROTULO_DO_ESTADO[estado],
      veiculos: contagem.get(estado)!,
      fracao: total === 0 ? 0 : Number((contagem.get(estado)! / total).toFixed(4)),
    }))
    .reverse();
}

// ---------------------------------------------------------------------------
// Os totais por vigência — o gráfico
// ---------------------------------------------------------------------------

/** A manutenção de um ativo numa ponta, coluna a coluna. */
export interface ValorDeManutencao {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  entityLabel: string | null;
  /** O R$/km resolvido. Nulo quando a vigência não o trouxe. */
  reaisKm: number | null;
  /** O R$/km do BID. */
  bid: number | null;
  /** O R$/km do contrato, onde há contrato. */
  contrato: number | null;
  /** A vida útil restante reconhecida, em meses. */
  vidaMeses: number | null;
  /** Os meses de manutenção inclusa. */
  freeMaintenance: number | null;
}

/** Um ponto do gráfico "R$/km médio por vigência". */
export interface TotalDeManutencaoDaVigencia {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  /**
   * A **média** do R$/km, e não a soma.
   *
   * Somar R$/km entre caminhões daria um número sem significado: dois caminhões
   * a R$ 0,30 não custam R$ 0,60 por quilômetro. A média é a única leitura que
   * sobrevive à agregação, e mesmo ela precisa do denominador ao lado — que vem
   * em `veiculos`.
   */
  mediaReaisKm: number;
  /** A média do R$/km do BID, para comparar com o resolvido. */
  mediaBid: number;
  /** Quantos ativos sustentam a média. */
  veiculos: number;
  /** Quantos vieram com R$/km zerado — free maintenance, na maior parte. */
  zerados: number;
  /** Quantos têm contrato, e portanto R$/km explicado pelo export. */
  comContrato: number;
}

/**
 * O R$/km médio de cada ponta, por tipo de equipamento.
 *
 * **Média, e nunca soma** — ver {@link TotalDeManutencaoDaVigencia.mediaReaisKm}.
 *
 * **Os zeros entram na média e saem contados.** Um R$/km zero é quase sempre
 * free maintenance, que é um caminhão de verdade custando zero de manutenção
 * naquele mês: tirá-lo da média inflaria o custo da frota. Mas uma média de
 * R$ 0,22 que embute 122 zeros é outra notícia que uma que não embute nenhum, e
 * quem lê tem direito de saber em qual das duas está.
 *
 * Os valores vêm da leitura das duas vigências, não do change set, porque uma
 * média tem de incluir quem não mudou.
 */
export function totaisDeManutencaoPorVigencia(
  valores: readonly ValorDeManutencao[],
): TotalDeManutencaoDaVigencia[] {
  const acumulado = new Map<
    string,
    { ponta: "BASE" | "COMPARADA"; entityType: string; soma: number; somaBid: number; veiculos: number; zerados: number; comContrato: number }
  >();

  for (const v of valores) {
    if (v.reaisKm === null) continue;
    const chave = `${v.ponta}${v.entityType}`;
    const atual =
      acumulado.get(chave) ??
      {
        ponta: v.ponta,
        entityType: v.entityType,
        soma: 0,
        somaBid: 0,
        veiculos: 0,
        zerados: 0,
        comContrato: 0,
      };
    atual.soma += v.reaisKm;
    atual.somaBid += v.bid ?? 0;
    atual.veiculos += 1;
    if (v.reaisKm === 0) atual.zerados += 1;
    if ((v.contrato ?? 0) > 0) atual.comContrato += 1;
    acumulado.set(chave, atual);
  }

  return [...acumulado.values()]
    .map((t) => ({
      ponta: t.ponta,
      entityType: t.entityType,
      mediaReaisKm: t.veiculos === 0 ? 0 : Number((t.soma / t.veiculos).toFixed(4)),
      mediaBid: t.veiculos === 0 ? 0 : Number((t.somaBid / t.veiculos).toFixed(4)),
      veiculos: t.veiculos,
      zerados: t.zerados,
      comContrato: t.comContrato,
    }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// A conferência: de onde vem o R$/km que vale?
// ---------------------------------------------------------------------------

/** O que a conferência de uma ponta revela sobre a origem do R$/km. */
export type VereditoDaOrigem =
  /** O R$/km resolvido é o do contrato em todos os ativos que têm contrato. */
  | "DO_CONTRATO"
  /** O R$/km resolvido é o do BID em todos os ativos medidos. */
  | "DO_BID"
  /** Nem um nem outro: o export não explica de onde o número vem. */
  | "NAO_EXPLICADO"
  /** Uns do contrato, outros de origem nenhuma — o caso do acervo. */
  | "MISTO"
  /** Não há ativo com R$/km e as duas origens para medir. */
  | "BASE_INSUFICIENTE";

export const ROTULO_DA_ORIGEM: Record<VereditoDaOrigem, string> = {
  DO_CONTRATO: "Vem do contrato",
  DO_BID: "Vem do BID",
  NAO_EXPLICADO: "Origem não explicada pelo export",
  MISTO: "Do contrato onde há contrato; sem origem nos demais",
  BASE_INSUFICIENTE: "Sem base para medir",
};

/** O resultado da conferência numa ponta e num tipo de equipamento. */
export interface ConferenciaDaOrigem {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  /** Ativos com R$/km resolvido e as duas origens preenchidas. */
  ativos: number;
  /** Em quantos o resolvido é exatamente o do contrato. */
  doContrato: number;
  /** Em quantos o resolvido é exatamente o do BID. */
  doBid: number;
  /** Em quantos ele não é nem um nem outro. */
  semOrigem: number;
  veredito: VereditoDaOrigem;
}

/**
 * A tolerância da conferência, em R$/km.
 *
 * Meio centavo por quilômetro. O acervo publica estes valores com duas casas, e
 * abaixo disso a diferença é arredondamento — não uma origem diferente.
 */
export const TOLERANCIA_DA_ORIGEM = 0.005;

/**
 * De onde vem o R$/km que vale para cada caminhão?
 *
 * ---------------------------------------------------------------------------
 * Por que esta função existe
 * ---------------------------------------------------------------------------
 * Porque o R$/km resolvido é o número que a tela resume, e um número que resume
 * sem dizer de onde vem é a forma mais fácil de uma auditoria ser contestada. No
 * acervo a resposta é **MISTO**, e ela é o achado: onde há contrato, o resolvido
 * é o contrato, em 126 de 126; onde não há, ele não é o BID nem o contrato, e
 * **nenhuma coluna do export diz o que é**.
 *
 * Ela não escolhe uma fórmula nem preenche o buraco. Medir e dizer "não
 * explicado" é mais útil, e muito mais barato de corrigir, do que publicar uma
 * regra inventada que passa a valer como se fosse do cliente.
 */
export function conferenciaDaOrigem(
  valores: readonly ValorDeManutencao[],
): ConferenciaDaOrigem[] {
  const grupos = new Map<string, ValorDeManutencao[]>();
  for (const v of valores) {
    const chave = `${v.ponta}${v.entityType}`;
    const lista = grupos.get(chave) ?? [];
    lista.push(v);
    grupos.set(chave, lista);
  }

  const perto = (a: number, b: number) => Math.abs(a - b) <= TOLERANCIA_DA_ORIGEM;

  return [...grupos.values()]
    .map((lista) => {
      const { ponta, entityType } = lista[0];
      let ativos = 0;
      let doContrato = 0;
      let doBid = 0;
      let semOrigem = 0;

      for (const v of lista) {
        if (v.reaisKm === null || v.bid === null || v.contrato === null) continue;
        /*
          O caminhão de R$/km zerado não entra: ele é free maintenance, e
          perguntar de onde vem um zero que ninguém cobrou não é a pergunta.
        */
        if (v.reaisKm === 0) continue;
        ativos++;
        if (v.contrato > 0 && perto(v.reaisKm, v.contrato)) doContrato++;
        else if (perto(v.reaisKm, v.bid)) doBid++;
        else semOrigem++;
      }

      const veredito: VereditoDaOrigem =
        ativos === 0
          ? "BASE_INSUFICIENTE"
          : doContrato === ativos
            ? "DO_CONTRATO"
            : doBid === ativos
              ? "DO_BID"
              : semOrigem === ativos
                ? "NAO_EXPLICADO"
                : "MISTO";

      return { ponta, entityType, ativos, doContrato, doBid, semOrigem, veredito };
    })
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// O agrupamento por veículo — uma linha por placa
// ---------------------------------------------------------------------------

/** Um veículo da tabela: a placa, o que ela moveu, e as linhas por baixo. */
export type VeiculoDeManutencao = VeiculoDaRubrica<LinhaDeManutencao>;

/**
 * A ordem em que a expansão lê as variáveis, e quem é o destaque.
 *
 * A ordem é a do catálogo: o R$/km resolvido primeiro, as duas origens que o
 * explicam logo abaixo, e o contexto por último.
 *
 * O destaque é o **R$/km resolvido** — e ele é medido em R$/km, não em reais.
 * Quem diz isso é `medidas`, tirado do catálogo: dele a tela sabe que a coluna
 * não pode escrever "R$ 0,34" onde a fonte disse trinta e quatro centavos por
 * quilômetro, que uma variável alterada em R$/km pode assumir a linha-mãe
 * quando o R$/km resolvido não está no recorte, e que esta rubrica não tem
 * variável nenhuma em reais.
 */
export const AGRUPAMENTO_DE_MANUTENCAO = {
  ordemDasVariaveis: ["veiculo", ...TODAS.map((v) => v.chave)],
  destaque: "reais_km",
  /* A unidade do destaque e a resposta a "esta rubrica tem dinheiro?" saem
     daqui — do mesmo catálogo que define a ordem da expansão, e nunca de
     uma segunda lista escrita à mão. */
  medidas: medidasDoCatalogo(TODAS),
  foraDaContagem: ["veiculo"],
} as const satisfies OpcoesDoAgrupamento;

/** As linhas viradas uma linha por placa. */
export function agruparPorVeiculoDeManutencao(
  linhas: readonly LinhaDeManutencao[],
): VeiculoDeManutencao[] {
  return agruparVeiculos(linhas, AGRUPAMENTO_DE_MANUTENCAO);
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_MANUTENCAO = [
  "Veículo",
  "Tipo",
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
 * Como cada unidade se escreve no arquivo.
 *
 * O CSV desta rubrica tem uma coluna que os outros não têm — **Unidade** —, e
 * ela não é enfeite: as linhas do mesmo arquivo trazem R$/km, meses, percentual
 * e reais, e quem abre a planilha no Excel vê quatro números sem saber que são
 * de quatro grandezas. Foi assim que a coluna "mensal" do IPVA virou soma na
 * planilha de outra pessoa.
 */
export const UNIDADE_NO_CSV: Partial<Record<MedidaDaVariavel, string>> = {
  DINHEIRO: "R$",
  REAIS_POR_KM: "R$/km",
  MESES: "meses",
  PERCENTUAL: "%",
  ANO: "ano",
  DISTANCIA: "km",
  TEXTO: "",
  DATA: "",
};

/**
 * Uma linha da tabela como as células do CSV.
 *
 * Devolve texto cru — sem `R$`, sem separador de milhar e sem decidir o
 * separador do arquivo. Quem escreve o CSV é `lib/csv.ts`, no cliente.
 */
export function celulasDoCsvDeManutencao(
  l: LinhaDeManutencao,
  justificativa?: string | null,
): (string | number | null)[] {
  return [
    l.entityLabel,
    l.entityType,
    l.rotuloDaVariavel,
    UNIDADE_NO_CSV[l.medida] ?? "",
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
