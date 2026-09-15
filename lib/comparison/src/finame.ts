/**
 * A AUDITORIA DE FINAME — o recorte do financiamento sobre o motor que já existe.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e sobretudo o que ele não é
 * ---------------------------------------------------------------------------
 * Ele **não compara nada**. Comparar duas vigências veículo a veículo, atributo
 * a atributo, é o que `engine.ts` faz desde sempre: pareia por
 * `(entity_id, attribute_id)` num FULL OUTER JOIN sobre `fato_visivel`, grava a
 * diferença em `delta_absolute`, a variação em `delta_percent`, a entrada e a
 * saída de ativo nos eixos próprios e o impacto por periodicidade já
 * deduplicado. Um segundo motor aqui seria a forma mais cara de duas telas
 * passarem a discordar sobre o mesmo mês.
 *
 * O que este arquivo faz são três coisas, todas puras:
 *
 * 1. **Diz quais atributos são de FINAME**, por tipo de equipamento, sem forçar
 *    equivalência onde ela não existe ({@link VARIAVEIS_DE_FINAME}).
 * 2. **Traduz o vocabulário do motor para o da tela** — `VALUE_CHANGED`,
 *    `ENTITY_ADDED`, `INCONCLUSIVE` viram os seis estados que a auditoria de
 *    financiamento usa ({@link estadoDaAlteracao}).
 * 3. **Agrega**: os seis indicadores do topo e as séries dos quatro gráficos,
 *    calculados uma vez só e servidos a cartão, gráfico, tabela e CSV
 *    ({@link resumirFiname}).
 *
 * Sem SQL e sem React de propósito: é sobre estas funções que os testes rodam,
 * sem um Postgres de pé, e é este mesmo módulo que o servidor e o navegador
 * importam — a mesma conta nos dois lados, que é a única forma de o cartão e a
 * linha nunca discordarem.
 *
 * ---------------------------------------------------------------------------
 * A regra que atravessa o arquivo: ausência não vira zero
 * ---------------------------------------------------------------------------
 * Um valor que não existe num dos lados não produz diferença, não produz
 * variação e não entra em soma nenhuma. Ele produz um **estado com nome** —
 * `NOVO_NA_VIGENCIA`, `AUSENTE_NA_COMPARADA`, `DADO_INCOMPLETO` — e o motivo
 * tipado que o motor já gravou. Zero no lugar de nulo transformaria uma coluna
 * que ninguém preencheu numa economia de 100%.
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

/*
  O vocabulário comum — o que uma variável mede, os seis estados, a forma da
  alteração do motor e a tradução de uma para a outra — saiu daqui para
  `recorte-de-rubrica.ts` quando a Auditoria de IPVA nasceu do mesmo desenho.
  Nada mudou de sentido e nada mudou de nome: os símbolos continuam sendo
  exportados por este módulo, e quem importava de `@workspace/comparison/finame`
  não mudou uma linha. O que mudou é que agora existe **uma** definição de
  "Conflito" para os dois recortes, em vez de duas cópias livres para divergir.
*/
export {
  estadoDaAlteracao,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type MedidaDaVariavel,
};

/** Os seis estados de uma linha de FINAME. O mesmo tipo dos demais recortes. */
export type EstadoDaLinhaDeFiname = EstadoDaLinha;

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * Uma variável de FINAME, com o código que cada tipo de equipamento usa.
 *
 * `codigo.CAVALO` ou `codigo.CARRETA` ausente quer dizer que **aquele tipo não
 * tem esta variável** — e não que ela caia num código parecido. O produto já
 * pagou o preço de forçar equivalência entre colunas de nome próximo: uma delas
 * é anual e a outra é mensal, e a comparação sai com o número certo sob o
 * rótulo errado.
 */
export interface VariavelDeFiname {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  codigo: { CAVALO?: string; CARRETA?: string };
  /**
   * Um total que embute outra linha do mesmo acervo.
   *
   * Hoje é só `carreta.finame` — que é a parcela do cavalo **mais** a do
   * implemento (`regras.ts`: `carreta.finame − carreta.finame_implemento =
   * cavalo.finame_cavalo`, em 558 de 558 linhas). Ele aparece no detalhe, dito
   * por extenso, e fica fora da tabela e de qualquer soma: somá-lo ao lado da
   * parcela do cavalo contaria o mesmo dinheiro duas vezes.
   */
  totalComposto?: boolean;
  /** As variáveis que compõem esta. Ver {@link impactoPorPeriodicidade}. */
  parcelas?: string[];
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/**
 * As variáveis do financiamento, na ordem em que a tela as lê.
 *
 * A ordem não é alfabética: começa no que a auditoria pergunta primeiro — a
 * parcela e o que a compõe —, segue pelas condições contratadas e termina na
 * base de compra, que é o que menos se move.
 */
export const VARIAVEIS_DE_FINAME: readonly VariavelDeFiname[] = [
  {
    chave: "parcela",
    rotulo: "Parcela FINAME",
    medida: "DINHEIRO",
    codigo: { CAVALO: "cavalo.finame_cavalo", CARRETA: "carreta.finame_implemento" },
    parcelas: ["juros", "amortizacao"],
    ajuda: "Amortização do principal mais juros, no período da vigência.",
  },
  {
    chave: "juros",
    rotulo: "Juros FINAME",
    medida: "DINHEIRO",
    codigo: {
      CAVALO: "cavalo.juros_finame_cavalo",
      CARRETA: "carreta.juros_finame_implemento",
    },
  },
  {
    chave: "amortizacao",
    rotulo: "Amortização",
    medida: "DINHEIRO",
    codigo: {
      CAVALO: "cavalo.amortizacao_cavalo",
      CARRETA: "carreta.amortizacao_implemento",
    },
  },
  {
    chave: "taxa",
    rotulo: "Taxa FINAME",
    medida: "PERCENTUAL",
    codigo: { CAVALO: "cavalo.taxa_finame", CARRETA: "carreta.taxa_finame" },
    ajuda: "Soma dos spreads com a TJLP — ver as três parcelas da taxa no detalhe.",
  },
  {
    chave: "prazo",
    rotulo: "Prazo",
    medida: "MESES",
    codigo: { CAVALO: "cavalo.periodo_finame", CARRETA: "carreta.periodo_finame" },
  },
  {
    chave: "carencia",
    rotulo: "Carência",
    medida: "MESES",
    codigo: { CAVALO: "cavalo.carencia", CARRETA: "carreta.carencia" },
  },
  {
    chave: "entrada",
    rotulo: "% de entrada",
    medida: "PERCENTUAL",
    codigo: {
      CAVALO: "cavalo.percentual_entrada",
      CARRETA: "carreta.percentual_entrada",
    },
  },
  {
    chave: "valor_nf",
    rotulo: "Valor de NF",
    medida: "DINHEIRO",
    codigo: { CAVALO: "cavalo.valor_nf_compra", CARRETA: "carreta.valor_nf_compra" },
  },
  {
    chave: "icms",
    rotulo: "ICMS",
    medida: "DINHEIRO",
    codigo: { CAVALO: "cavalo.valor_icms", CARRETA: "carreta.valor_icms" },
  },
  {
    chave: "pis_cofins",
    rotulo: "PIS/COFINS",
    medida: "DINHEIRO",
    codigo: {
      CAVALO: "cavalo.valor_pis_cofins",
      CARRETA: "carreta.valor_pis_cofins",
    },
  },
  {
    chave: "ano",
    rotulo: "Ano",
    medida: "ANO",
    codigo: { CAVALO: "cavalo.ano", CARRETA: "carreta.ano" },
  },
  {
    chave: "data_de_entrada",
    rotulo: "Data de entrada",
    medida: "DATA",
    codigo: { CAVALO: "cavalo.data", CARRETA: "carreta.data" },
  },
] as const;

/**
 * As variáveis que só o detalhe mostra.
 *
 * `finame_total` é o total composto da carreta, e as três últimas são as
 * parcelas da taxa — elas explicam a taxa quando ela se move, e explicar é
 * trabalho do detalhe, não de uma tabela de doze colunas.
 */
export const VARIAVEIS_DE_DETALHE: readonly VariavelDeFiname[] = [
  {
    chave: "finame_total",
    rotulo: "Total composto: cavalo + implemento",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.finame" },
    totalComposto: true,
    ajuda:
      "A soma da parcela do cavalo com a do implemento. Fica fora da tabela e do " +
      "impacto oficial para o mesmo dinheiro não ser contado duas vezes.",
  },
  {
    chave: "spread_bndes",
    rotulo: "Spread BNDES",
    medida: "PERCENTUAL",
    codigo: { CAVALO: "cavalo.spread_bndes", CARRETA: "carreta.spread_bndes" },
  },
  {
    chave: "spread_banco",
    rotulo: "Spread banco",
    medida: "PERCENTUAL",
    codigo: { CAVALO: "cavalo.spread_banco", CARRETA: "carreta.spread_banco" },
  },
  {
    chave: "tjlp",
    rotulo: "TJLP",
    medida: "PERCENTUAL",
    codigo: { CAVALO: "cavalo.tjlp", CARRETA: "carreta.tjlp" },
  },
  {
    chave: "status_financiamento",
    rotulo: "Status do financiamento",
    medida: "DATA",
    codigo: { CARRETA: "carreta.status_financiamento" },
    ajuda: "Só a carreta declara esta coluna; o cavalo não tem equivalente.",
  },
  {
    chave: "data_fim_contrato",
    rotulo: "Fim do contrato",
    medida: "DATA",
    codigo: { CAVALO: "cavalo.data_fim_contrato", CARRETA: "carreta.data_fim_contrato" },
  },
] as const;

const TODAS = [...VARIAVEIS_DE_FINAME, ...VARIAVEIS_DE_DETALHE];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDe(variaveis: readonly VariavelDeFiname[]): string[] {
  const codigos = new Set<string>();
  for (const v of variaveis) {
    if (v.codigo.CAVALO) codigos.add(v.codigo.CAVALO);
    if (v.codigo.CARRETA) codigos.add(v.codigo.CARRETA);
  }
  return [...codigos].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA = codigosDe(VARIAVEIS_DE_FINAME);

/** O recorte do detalhe: tudo, inclusive o total composto e os spreads. */
export const CODIGOS_DO_DETALHE = codigosDe(TODAS);

const POR_CODIGO = new Map<string, VariavelDeFiname>();
for (const v of TODAS) {
  if (v.codigo.CAVALO) POR_CODIGO.set(v.codigo.CAVALO, v);
  if (v.codigo.CARRETA) POR_CODIGO.set(v.codigo.CARRETA, v);
}

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDoCodigo(code: string | null): VariavelDeFiname | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

/** O código que um tipo de equipamento usa para uma variável, quando existe. */
export function codigoDaVariavel(
  variavel: VariavelDeFiname,
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
export interface LinhaDeFiname {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  attributeCode: string | null;
  /** O texto do valor na vigência base. Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na vigência comparada. Nulo quando não há. */
  comparada: string | null;
  /** `comparada − base`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em **pontos percentuais**. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinhaDeFiname;
  /** A frase da recusa, quando há. Vem do motor, não é escrita aqui. */
  motivo: string | null;
  impactoAmount: number | null;
  impactoPeriodicidade: string | null;
  impactoCalculado: boolean;
}

/**
 * Uma alteração do motor virando linha da tabela.
 *
 * Devolve `null` para o que não é de FINAME — a função é o filtro e o tradutor
 * ao mesmo tempo, de modo que nenhuma tela precise saber quais são os códigos.
 */
export function linhaDaAlteracao(a: AlteracaoDoMotor): LinhaDeFiname | null {
  const variavel = variavelDoCodigo(a.attributeCode);
  /*
    Entrada e saída de ativo não citam atributo: o motor as grava uma vez por
    veículo, no eixo da frota, e não setenta vezes no eixo do valor. Elas entram
    na tabela como a linha do veículo inteiro, com a variável em branco — some
    da tabela seria esconder a metade mais visível do que mudou na frota.
  */
  if (!variavel) {
    if (a.changeType !== "ENTITY_ADDED" && a.changeType !== "ENTITY_REMOVED") return null;
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
    };
  }
  if (variavel.totalComposto) return null;

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
  };
}

/** As linhas de FINAME de uma lista de alterações, na ordem em que vieram. */
export function linhasDeFiname(alteracoes: readonly AlteracaoDoMotor[]): LinhaDeFiname[] {
  const linhas: LinhaDeFiname[] = [];
  for (const a of alteracoes) {
    const linha = linhaDaAlteracao(a);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/**
 * Um par de valores iguais virando linha — o alternador "sem alteração".
 *
 * Estas linhas **não vêm do motor**: o `change_set` só guarda o que mudou. Elas
 * são montadas a partir das duas leituras de `getEntityTable`, uma por vigência,
 * e por isso carregam `id: null`. É o que permite a tela dizer "sem alteração"
 * sobre um veículo específico, em vez de só contá-lo no cartão.
 */
export function linhaSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeFiname | null {
  const variavel = variavelDoCodigo(par.attributeCode);
  if (!variavel || variavel.totalComposto) return null;
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
  };
}

// ---------------------------------------------------------------------------
// O impacto — e as duas coisas que ele se recusa a fazer
// ---------------------------------------------------------------------------

/** O impacto financeiro do recorte, por periodicidade. */
export interface ImpactoDeFiname {
  /**
   * Um número por periodicidade, **nunca um total único**.
   *
   * Mensal e anual não se somam: a parcela do financiamento é mensal e o valor
   * de NF é do ato da compra. Um total único precisaria anualizar um dos dois,
   * e anualizar é decisão de quem lê, não deste módulo.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar, com motivo próprio. */
  naoCalculavel: number;
  /** Linhas retiradas do total por já estarem representadas nas parcelas. */
  cobertasPorParcelas: number;
}

/**
 * O impacto do recorte de FINAME, por periodicidade e sem dupla contagem.
 *
 * ---------------------------------------------------------------------------
 * As duas recusas
 * ---------------------------------------------------------------------------
 * **Não soma periodicidades diferentes.** Cada balde é uma periodicidade, como
 * `resumirImpacto` já faz para o produto inteiro.
 *
 * **Não soma um total junto com as parcelas dele.** A parcela FINAME é
 * amortização mais juros; se os três mudaram no mesmo veículo, somar os três
 * conta o mesmo dinheiro duas vezes. A regra é a mesma que `deduplicacao.ts`
 * aplica — **as parcelas ganham, o total sai** —, e é deliberado que seja a
 * mesma: duas regras de dedupe no mesmo produto produziriam dois impactos para
 * o mesmo mês.
 *
 * O total composto da carreta (`carreta.finame`) nunca chega aqui: ele é
 * barrado antes, em {@link linhaDaAlteracao}.
 */
export function impactoPorPeriodicidade(
  linhas: readonly LinhaDeFiname[],
): ImpactoDeFiname {
  /* Quais parcelas mudaram em cada veículo — a informação que a regra exige e
     que só existe depois de a lista inteira estar à mão. */
  const parcelasPorVeiculo = new Map<string, Set<string>>();
  for (const l of linhas) {
    if (l.estado !== "ALTERADO" || !l.impactoCalculado) continue;
    const chave = `${l.entityLabel}\u001f${l.entityType}`;
    const set = parcelasPorVeiculo.get(chave) ?? new Set<string>();
    set.add(l.variavel);
    parcelasPorVeiculo.set(chave, set);
  }

  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let cobertasPorParcelas = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;
    if (!l.impactoCalculado || l.impactoAmount === null) {
      // Só conta como "não precificado" o que era candidato a dinheiro. Prazo e
      // taxa não são falha de cálculo: não são dinheiro, e dizer que faltou
      // precificá-los seria prometer uma conversão que não existe.
      if (l.medida === "DINHEIRO") naoCalculavel++;
      continue;
    }

    const variavel = VARIAVEIS_DE_FINAME.find((v) => v.chave === l.variavel);
    const parcelas = variavel?.parcelas ?? [];
    if (parcelas.length > 0) {
      const mudaram = parcelasPorVeiculo.get(`${l.entityLabel}\u001f${l.entityType}`);
      const coberto = parcelas.some((p) => mudaram?.has(p));
      if (coberto) {
        cobertasPorParcelas++;
        continue;
      }
    }

    const balde = l.impactoPeriodicidade ?? "SEM_PERIODICIDADE";
    porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + l.impactoAmount;
  }

  for (const balde of Object.keys(porPeriodicidade)) {
    porPeriodicidade[balde] = Number(porPeriodicidade[balde].toFixed(6));
  }
  return { porPeriodicidade, naoCalculavel, cobertasPorParcelas };
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos veículos cada vigência entregou — vem da contagem do motor. */
export interface FrotaDoPar {
  /** Veículos presentes nas duas vigências. */
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeFiname {
  veiculosComparados: number;
  /** Comparados que não tiveram nenhuma variável de FINAME alterada. */
  semAlteracao: number;
  veiculosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  /** Quantas variáveis se moveram, somando todos os veículos. */
  variaveisAlteradas: number;
  veiculosComDadoIncompleto: number;
  veiculosComConflito: number;
  impacto: ImpactoDeFiname;
}

/**
 * Os seis indicadores do topo, de uma passada só.
 *
 * `frota` vem do motor (`entitiesAdded`/`entitiesRemoved` e a contagem de
 * ativos presentes nos dois lados) porque **esta lista não sabe** quantos
 * veículos não mudaram: um veículo sem nenhuma alteração não produz linha
 * nenhuma. Derivar "sem alteração" do tamanho da lista daria zero numa
 * comparação em que nada mudou — que é justamente quando o número importa.
 */
export function resumirFiname(
  linhas: readonly LinhaDeFiname[],
  frota: FrotaDoPar,
): ResumoDeFiname {
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

  const comAlteracaoN = comAlteracao.size;
  /*
    "Sem alteração" é o que **nenhuma** linha tocou — e não só o que não mudou
    de valor.

    Subtrair apenas os alterados foi o defeito que a primeira tela sobre dado
    real mostrou de cara: o cartão dizia "128 sem alteração, 96,2%" enquanto a
    rosca ao lado dizia "71 sem alteração, 62 em conflito". Os 62 estavam nos
    dois números, e no cartão como se estivessem em ordem — um veículo cuja
    coluna a fonte entregou com dois tipos no mesmo import não é um veículo em
    que nada mudou: é um veículo sobre o qual não se pode afirmar isso.
  */
  const tocados = new Set([...comAlteracao, ...comIncompleto, ...comConflito]);
  return {
    veiculosComparados: frota.comparados,
    semAlteracao: Math.max(0, frota.comparados - tocados.size),
    veiculosComAlteracao: comAlteracaoN,
    novosNaVigencia: frota.novos,
    ausentesNaComparada: frota.ausentes,
    variaveisAlteradas,
    veiculosComDadoIncompleto: comIncompleto.size,
    veiculosComConflito: comConflito.size,
    impacto: impactoPorPeriodicidade(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavel {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavel(
  linhas: readonly LinhaDeFiname[],
): AlteracoesDaVariavel[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    if (l.estado !== "ALTERADO" || l.variavel === "veiculo") continue;
    contagem.set(l.variavel, (contagem.get(l.variavel) ?? 0) + 1);
  }
  return VARIAVEIS_DE_FINAME.filter((v) => contagem.has(v.chave))
    .map((v) => ({
      variavel: v.chave,
      rotulo: v.rotulo,
      medida: v.medida,
      alteracoes: contagem.get(v.chave)!,
    }))
    .sort((a, b) => b.alteracoes - a.alteracoes || a.rotulo.localeCompare(b.rotulo));
}

/** Uma fatia do gráfico de status. */
export interface FatiaDeEstado {
  estado: EstadoDaLinhaDeFiname;
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
 * Sem essa regra a soma das fatias passaria do total de veículos, e uma rosca
 * cujas fatias somam 113% é um gráfico que ninguém acredita.
 */
export function distribuicaoPorEstado(
  linhas: readonly LinhaDeFiname[],
  frota: FrotaDoPar,
): FatiaDeEstado[] {
  const pior = new Map<string, EstadoDaLinhaDeFiname>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeFiname, number>();
  for (const estado of pior.values()) {
    contagem.set(estado, (contagem.get(estado) ?? 0) + 1);
  }
  /* Os que não produziram linha nenhuma são, por definição, os sem alteração. */
  const tocados = [...pior.keys()].filter(
    (k) => pior.get(k) !== "NOVO_NA_VIGENCIA" && pior.get(k) !== "AUSENTE_NA_COMPARADA",
  ).length;
  contagem.set("SEM_ALTERACAO", Math.max(0, frota.comparados - tocados));
  contagem.set("NOVO_NA_VIGENCIA", frota.novos);
  contagem.set("AUSENTE_NA_COMPARADA", frota.ausentes);

  const total = frota.comparados + frota.novos + frota.ausentes;
  return GRAVIDADE.filter((e) => (contagem.get(e) ?? 0) > 0)
    .map((estado) => ({
      estado,
      rotulo: ROTULO_DO_ESTADO[estado],
      veiculos: contagem.get(estado)!,
      fracao: total === 0 ? 0 : contagem.get(estado)! / total,
    }))
    .sort((a, b) => b.veiculos - a.veiculos);
}

/** Um ponto do gráfico "valor total por vigência". */
export interface TotalDaVigencia {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  total: number;
  /** Quantos veículos sustentam o total. */
  veiculos: number;
}

/**
 * O total de parcela FINAME de cada ponta, por tipo de equipamento.
 *
 * Soma **só a parcela** — não os juros, não a amortização e não o total
 * composto da carreta —, pela mesma razão que o impacto não os soma junto: são
 * o mesmo dinheiro escrito em três linhas. Os valores vêm da leitura das duas
 * vigências, não do change set, porque um total tem de incluir quem não mudou.
 */
export function totaisPorVigencia(
  valores: readonly {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    attributeCode: string;
    valor: number | null;
  }[],
): TotalDaVigencia[] {
  const acumulado = new Map<string, TotalDaVigencia>();
  for (const v of valores) {
    const variavel = variavelDoCodigo(v.attributeCode);
    if (!variavel || variavel.chave !== "parcela" || v.valor === null) continue;
    const chave = `${v.ponta}\u001f${v.entityType}`;
    const atual =
      acumulado.get(chave) ??
      ({ ponta: v.ponta, entityType: v.entityType, total: 0, veiculos: 0 } as TotalDaVigencia);
    atual.total += v.valor;
    atual.veiculos += 1;
    acumulado.set(chave, atual);
  }
  return [...acumulado.values()]
    .map((t) => ({ ...t, total: Number(t.total.toFixed(2)) }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV = [
  "Veículo",
  "Tipo",
  "Variável",
  "Vigência Base",
  "Vigência Comparada",
  "Diferença",
  "Variação %",
  "Status",
  "Motivo",
] as const;

/**
 * Uma linha da tabela como as nove células do CSV.
 *
 * Devolve texto cru — sem `R$`, sem separador de milhar e sem decidir o
 * separador do arquivo. Quem escreve o CSV é `lib/csv.ts`, no cliente, que já
 * sabe o que o Excel brasileiro espera; repetir aquela decisão aqui daria duas
 * regras para o mesmo arquivo.
 */
export function celulasDoCsv(l: LinhaDeFiname): (string | number | null)[] {
  return [
    l.entityLabel,
    l.entityType,
    l.rotuloDaVariavel,
    l.base,
    l.comparada,
    l.diferenca,
    l.variacao,
    ROTULO_DO_ESTADO[l.estado],
    l.motivo,
  ];
}
