/**
 * A AUDITORIA DE IPVA — o recorte do tributo sobre o motor que já existe.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e sobretudo o que ele não é
 * ---------------------------------------------------------------------------
 * Ele **não compara nada**, pela mesma razão que `finame.ts` não compara:
 * comparar duas vigências veículo a veículo, atributo a atributo, é o que
 * `engine.ts` faz desde sempre. Um segundo motor aqui seria a forma mais cara
 * de duas telas passarem a discordar sobre o mesmo mês.
 *
 * E ele **não traduz o motor de novo**: os seis estados, a forma da alteração e
 * a ordem de gravidade vêm de `recorte-de-rubrica.ts`, o mesmo módulo que o
 * recorte de FINAME usa. "Conflito" aqui é, por construção, o mesmo "Conflito"
 * de lá.
 *
 * O que é próprio deste arquivo são quatro coisas, todas puras:
 *
 * 1. **Diz quais atributos são de IPVA**, por tipo de equipamento
 *    ({@link VARIAVEIS_DE_IPVA}) — e diz quais **não somam**, que nesta rubrica
 *    é a decisão mais cara do acervo.
 * 2. **Agrega** os indicadores do topo e as séries dos gráficos
 *    ({@link resumirIpva}).
 * 3. **Mede a alíquota implícita** — o IPVA como percentual do valor de nota —,
 *    que é o que separa um IPVA alto de um IPVA errado ({@link aliquotaImplicita}).
 * 4. **Conta os valores negativos**, porque nesta rubrica eles existem e
 *    entram calados em qualquer soma ({@link ImpactoDeIpva}).
 *
 * ---------------------------------------------------------------------------
 * As três decisões que o dado real obrigou a escrever
 * ---------------------------------------------------------------------------
 * Todas as três estão medidas em `docs/ACHADO-IPVA.md`, sobre o acervo:
 *
 * 1. **`carreta.ipva_licenciamento_mensal` não é 1/12 de
 *    `carreta.ipva_licenciamento`, e não soma com ela.** A razão entre as duas,
 *    carreta a carreta, vai de −3,01× a 5,23×, com 63% de dispersão — se fossem
 *    a mesma grandeza medida em duas escalas, a razão seria constante. São duas
 *    grandezas diferentes que compartilham o prefixo do nome, e a segunda a
 *    Ambev ainda não explicou. Ela aparece **só no detalhe**, dita por extenso,
 *    e fora de toda soma: somá-la ao lado da anual seria inventar um total de
 *    duas coisas que ninguém sabe se são a mesma.
 *
 * 2. **A alíquota implícita é a conferência que o acervo sustenta hoje.** O
 *    verbete da tela em preparo pedia ano-modelo, valor venal e UF do
 *    emplacamento; o acervo não tem a UF nem a categoria, e não vai passar a ter
 *    porque a tela existe. Tem o valor de nota — e o IPVA dividido por ele é uma
 *    alíquota que se lê. Foi assim que a troca de fórmula apareceu: de Janeiro a
 *    Junho de 2026 todas as 62 placas ficaram em **exatamente 1,000% da nota,
 *    com desvio zero**. Desvio zero não é dado, é fórmula — e um recorte que só
 *    mostrasse o delta em reais teria chamado de "queda de R$ 720 mil" o que é
 *    uma troca de critério. O que falta continua escrito na tela.
 *
 * 3. **Valor negativo é achado, não ruído.** São 15 linhas negativas em
 *    `carreta.ipva_licenciamento`, até −R$ 1.709,86. Ou é estorno, ou é erro de
 *    cadastro; nos dois casos entra numa soma e a distorce em silêncio. Eles
 *    continuam somando — esconder da soma o que a planilha declarou seria
 *    maquiar —, mas são **contados à parte** e ditos por extenso.
 */

import {
  chaveDoVeiculo,
  ehEntradaOuSaidaDoGrao,
  estadoDaAlteracao,
  GRAVIDADE,
  numero,
  ROTULO_DO_ESTADO,
  TIPOS_DE_EQUIPAMENTO,
  type EstadoDaLinha,
  type MedidaDaVariavel,
  type AlteracaoDoMotor,
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

/** Os seis estados de uma linha de IPVA. O mesmo tipo do recorte de FINAME. */
export type EstadoDaLinhaDeIpva = EstadoDaLinha;

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * Uma variável de IPVA, com o código que cada tipo de equipamento usa.
 *
 * `codigo.CAVALO` ou `codigo.CARRETA` ausente quer dizer que **aquele tipo não
 * tem esta variável** — e não que ela caia num código parecido. É a mesma regra
 * do recorte de FINAME, e aqui ela custa caro: `ipva_licenciamento_mensal` só
 * existe na carreta, e emparelhá-la com a coluna anual do cavalo porque os
 * nomes se parecem é exatamente o erro que `docs/ACHADO-IPVA.md` mediu.
 */
export interface VariavelDeIpva {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  codigo: { CAVALO?: string; CARRETA?: string };
  /**
   * Uma coluna que **não entra em soma nenhuma**, e a razão disso.
   *
   * Hoje é só `carreta.ipva_licenciamento_mensal`. Diferente do total composto
   * do FINAME — que sai da soma por já estar nas parcelas —, esta sai por um
   * motivo pior: não se sabe o que ela é. A razão dela para a coluna anual
   * varia de −3,01× a 5,23× entre as carretas, o que descarta ser a mesma
   * grandeza noutra escala. Ela aparece no detalhe, com o aviso, e em lugar
   * nenhum mais.
   */
  foraDaSoma?: string;
  /**
   * A coluna que serve de base para a alíquota implícita desta variável.
   *
   * Só a rubrica de IPVA tem uma; é o valor de nota do próprio equipamento, e é
   * o que transforma "R$ 2.450" em "1,000% da nota" — a única leitura que
   * distingue um IPVA alto de um IPVA errado com o que o acervo tem hoje.
   */
  base?: { CAVALO?: string; CARRETA?: string };
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/**
 * As variáveis do tributo, na ordem em que a tela as lê.
 *
 * Começa na rubrica, segue pela base que a confere e termina no cadastro do
 * ativo, que é o que menos se move. São quatro, e não catorze, porque é o que o
 * acervo tem: uma coluna de IPVA por equipamento, o valor de nota que serve de
 * base, o ano e a data de entrada. Inflar a lista com colunas de outro assunto
 * faria a tabela parecer completa sem responder mais nada.
 */
export const VARIAVEIS_DE_IPVA: readonly VariavelDeIpva[] = [
  {
    chave: "ipva",
    rotulo: "IPVA / Licenciamento",
    medida: "DINHEIRO",
    codigo: {
      CAVALO: "cavalo.ipva_licenciamento",
      CARRETA: "carreta.ipva_licenciamento",
    },
    base: { CAVALO: "cavalo.valor_nf_compra", CARRETA: "carreta.valor_nf_compra" },
    ajuda:
      "No cavalo é IPVA de verdade — 1% do valor da nota nas vigências de 2026. " +
      "Na carreta é taxa fixa de licenciamento (R$ 140–152), o que é coerente com " +
      "semirreboque isento de IPVA na maior parte dos estados.",
  },
  {
    chave: "valor_nf",
    rotulo: "Valor de NF",
    medida: "DINHEIRO",
    codigo: { CAVALO: "cavalo.valor_nf_compra", CARRETA: "carreta.valor_nf_compra" },
    ajuda: "A base da alíquota implícita. Entra na tabela porque é o que confere o IPVA.",
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
 * Uma só, e é a mais importante desta tela: a coluna "mensal" da carreta, que
 * não é 1/12 da anual e que ninguém sabe o que é. Ela existe no acervo, e por
 * isso é mostrada; ela não se explica, e por isso não soma.
 */
export const VARIAVEIS_DE_DETALHE_DE_IPVA: readonly VariavelDeIpva[] = [
  {
    chave: "ipva_mensal",
    rotulo: "IPVA / Licenciamento (coluna “mensal”)",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.ipva_licenciamento_mensal" },
    foraDaSoma:
      "Não é 1/12 da coluna anual: a razão entre as duas varia de −3,01× a 5,23× " +
      "entre as carretas, com 63% de dispersão. São grandezas diferentes com nomes " +
      "parecidos, e a segunda a Ambev ainda não explicou — ver docs/ACHADO-IPVA.md.",
    ajuda: "Só a carreta declara esta coluna; o cavalo não tem equivalente.",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_IPVA, ...VARIAVEIS_DE_DETALHE_DE_IPVA];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeIpva(variaveis: readonly VariavelDeIpva[]): string[] {
  const codigos = new Set<string>();
  for (const v of variaveis) {
    if (v.codigo.CAVALO) codigos.add(v.codigo.CAVALO);
    if (v.codigo.CARRETA) codigos.add(v.codigo.CARRETA);
  }
  return [...codigos].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_IPVA = codigosDeIpva(VARIAVEIS_DE_IPVA);

/**
 * Os códigos de um recorte de equipamento — `TODOS`, `CAVALO` ou `CARRETA`.
 *
 * Existe porque nem toda leitura aceita recortar por `entity_type`. A Evolução
 * por Placa aceita (`tipo`), mas a leitura ponta a ponta (`end-to-end.ts`) só
 * aceita uma lista de atributos — e as duas precisam responder pelo **mesmo**
 * recorte quando a aba Cavalo está aberta, ou a tela publica a variação ponta a
 * ponta do acervo inteiro sob o título de um equipamento só.
 *
 * A tradução é exata, e não uma aproximação: cada variável tem um código por
 * equipamento (`cavalo.ipva_licenciamento` e `carreta.ipva_licenciamento` são atributos distintos), então filtrar pelos
 * códigos de um lado é o mesmo conjunto de linhas que filtrar pelo `entity_type`
 * daquele lado.
 */
export function codigosDoRecorteDeIpva(
  recorte: "TODOS" | "CAVALO" | "CARRETA",
  variaveis: readonly VariavelDeIpva[] = VARIAVEIS_DE_IPVA,
): string[] {
  if (recorte === "TODOS") return codigosDeIpva(variaveis);
  const codigos = new Set<string>();
  for (const v of variaveis) {
    const codigo = v.codigo[recorte];
    if (codigo) codigos.add(codigo);
  }
  return [...codigos].sort();
}

/** O recorte do detalhe: tudo, inclusive a coluna que não soma. */
export const CODIGOS_DO_DETALHE_DE_IPVA = codigosDeIpva(TODAS);

const POR_CODIGO = new Map<string, VariavelDeIpva>();
for (const v of TODAS) {
  if (v.codigo.CAVALO) POR_CODIGO.set(v.codigo.CAVALO, v);
  if (v.codigo.CARRETA) POR_CODIGO.set(v.codigo.CARRETA, v);
}

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeIpvaDoCodigo(code: string | null): VariavelDeIpva | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

/** O código que um tipo de equipamento usa para uma variável, quando existe. */
export function codigoDaVariavelDeIpva(
  variavel: VariavelDeIpva,
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
export interface LinhaDeIpva {
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
  estado: EstadoDaLinhaDeIpva;
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
 * Devolve `null` para o que não é de IPVA — a função é o filtro e o tradutor ao
 * mesmo tempo, de modo que nenhuma tela precise saber quais são os códigos.
 *
 * A coluna que não soma **não** é barrada aqui, e essa é a diferença em relação
 * ao total composto do FINAME: aquele é dinheiro já contado noutro lugar, e
 * mostrá-lo na tabela convidaria a somar duas vezes; esta é uma pergunta em
 * aberto, e escondê-la seria apagar o achado. Ela passa, marcada, e quem soma
 * ({@link impactoDeIpva}) a recusa pelo `foraDaSoma`.
 */
export function linhaDeIpvaDaAlteracao(a: AlteracaoDoMotor): LinhaDeIpva | null {
  const variavel = variavelDeIpvaDoCodigo(a.attributeCode);
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

/** As linhas de IPVA de uma lista de alterações, na ordem em que vieram. */
export function linhasDeIpva(alteracoes: readonly AlteracaoDoMotor[]): LinhaDeIpva[] {
  const linhas: LinhaDeIpva[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeIpvaDaAlteracao(a);
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
export function linhaDeIpvaSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeIpva | null {
  const variavel = variavelDeIpvaDoCodigo(par.attributeCode);
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

/** O impacto financeiro do recorte, por periodicidade. */
export interface ImpactoDeIpva {
  /**
   * Um número por periodicidade, **nunca um total único**.
   *
   * Mensal e anual não se somam, e aqui isso não é teoria: o IPVA do cavalo é
   * 1% da nota **ao ano** — se fosse mensal daria 12% a.a., que não existe —, e
   * há colunas de outra periodicidade no mesmo recorte. Anualizar é decisão de
   * quem lê, não deste módulo.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar, com motivo próprio. */
  naoCalculavel: number;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /**
   * Alterações em que uma das pontas é **negativa**.
   *
   * Elas continuam na soma — a planilha declarou aquele valor, e tirá-lo seria
   * maquiar —, mas são contadas à parte porque um licenciamento negativo ou é
   * estorno, ou é erro de cadastro, e nos dois casos distorce um total em
   * silêncio. São 15 no acervo, até −R$ 1.709,86.
   */
  valoresNegativos: number;
}

/**
 * O impacto do recorte de IPVA, por periodicidade e sem somar o inexplicado.
 *
 * ---------------------------------------------------------------------------
 * As três recusas
 * ---------------------------------------------------------------------------
 * **Não soma periodicidades diferentes.** Cada balde é uma periodicidade, como
 * `resumirImpacto` já faz para o produto inteiro.
 *
 * **Não soma a coluna que não se explica.** `carreta.ipva_licenciamento_mensal`
 * não é 1/12 da anual — a razão entre as duas varia de −3,01× a 5,23× —, e
 * juntá-las daria o total de duas grandezas diferentes sob um rótulo só.
 *
 * **Não esconde o negativo, e não o deixa passar calado.** Ele entra na soma,
 * como a planilha o declarou, e sai contado no indicador próprio.
 */
export function impactoDeIpva(linhas: readonly LinhaDeIpva[]): ImpactoDeIpva {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;
  let valoresNegativos = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;

    const antes = numero(l.base);
    const depois = numero(l.comparada);
    if (l.medida === "DINHEIRO" && ((antes ?? 0) < 0 || (depois ?? 0) < 0)) {
      valoresNegativos++;
    }

    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    if (!l.impactoCalculado || l.impactoAmount === null) {
      /*
        Só conta como "não precificado" o que era candidato a dinheiro. Ano e
        data não são falha de cálculo: não são dinheiro, e dizer que faltou
        precificá-los seria prometer uma conversão que não existe.
      */
      if (l.medida === "DINHEIRO") naoCalculavel++;
      continue;
    }
    /*
      O valor de nota está na tabela para conferir o IPVA, **não para somar com
      ele**: é o preço de compra do ativo, e o IPVA é o tributo sobre ele. Os
      dois no mesmo balde dariam um impacto que não é de rubrica nenhuma.
    */
    if (l.variavel !== "ipva") continue;

    const balde = l.impactoPeriodicidade ?? "SEM_PERIODICIDADE";
    porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + l.impactoAmount;
  }

  for (const balde of Object.keys(porPeriodicidade)) {
    porPeriodicidade[balde] = Number(porPeriodicidade[balde].toFixed(6));
  }
  return { porPeriodicidade, naoCalculavel, foraDaSoma, valoresNegativos };
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos veículos cada vigência entregou — vem da contagem do motor. */
export interface FrotaDoParDeIpva {
  /** Veículos presentes nas duas vigências. */
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeIpva {
  veiculosComparados: number;
  /** Comparados que não tiveram nenhuma variável de IPVA alterada. */
  semAlteracao: number;
  veiculosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  /** Quantas variáveis se moveram, somando todos os veículos. */
  variaveisAlteradas: number;
  veiculosComDadoIncompleto: number;
  veiculosComConflito: number;
  impacto: ImpactoDeIpva;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `frota` vem do motor porque **esta lista não sabe** quantos veículos não
 * mudaram: um veículo sem nenhuma alteração não produz linha nenhuma. Derivar
 * "sem alteração" do tamanho da lista daria zero numa comparação em que nada
 * mudou — que é justamente quando o número importa.
 */
export function resumirIpva(
  linhas: readonly LinhaDeIpva[],
  frota: FrotaDoParDeIpva,
): ResumoDeIpva {
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
    FINAME sobre dado real mostrou: o cartão dizia "128 sem alteração" ao lado
    de uma rosca dizendo "71 sem alteração, 62 em conflito", e os 62 estavam nos
    dois números. A regra nasceu lá e vale igual aqui.
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
    impacto: impactoDeIpva(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeIpva {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeIpva(
  linhas: readonly LinhaDeIpva[],
): AlteracoesDaVariavelDeIpva[] {
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
export interface FatiaDeEstadoDeIpva {
  estado: EstadoDaLinhaDeIpva;
  rotulo: string;
  veiculos: number;
  /** A fração sobre o total de veículos do recorte. `0.852` para 85,2%. */
  fracao: number;
}

/**
 * Os veículos por estado — a rosca.
 *
 * Um veículo tem um estado só, e a ordem de gravidade (`GRAVIDADE`, no módulo
 * comum) decide qual: quem tem conflito aparece como conflito ainda que também
 * tenha uma variável alterada. Sem essa regra a soma das fatias passaria do
 * total de veículos.
 */
export function distribuicaoPorEstadoDeIpva(
  linhas: readonly LinhaDeIpva[],
  frota: FrotaDoParDeIpva,
): FatiaDeEstadoDeIpva[] {
  const pior = new Map<string, EstadoDaLinhaDeIpva>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeIpva, number>();
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

// ---------------------------------------------------------------------------
// Os totais e a alíquota implícita
// ---------------------------------------------------------------------------

/** Um valor lido de uma das duas vigências, para os totais e a alíquota. */
export interface ValorDeIpva {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  entityLabel: string | null;
  /** O IPVA declarado, em reais. Nulo quando a vigência não o trouxe. */
  ipva: number | null;
  /** O valor de nota do mesmo ativo, base da alíquota. Nulo quando falta. */
  valorNf: number | null;
}

/** Um ponto do gráfico "valor total por vigência". */
export interface TotalDeIpvaDaVigencia {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  total: number;
  /** Quantos veículos sustentam o total. */
  veiculos: number;
  /** Quantos deles vieram com valor negativo. */
  negativos: number;
}

/**
 * O total de IPVA de cada ponta, por tipo de equipamento.
 *
 * Soma **só a coluna anual** — nunca a "mensal" da carreta, que não é 1/12 dela.
 * Os valores vêm da leitura das duas vigências, não do change set, porque um
 * total tem de incluir quem não mudou.
 *
 * Os negativos entram na soma e saem contados: um total de R$ 10.875,69 que
 * embute quinze estornos é um número diferente de um total de R$ 10.875,69 que
 * não embute nenhum, e quem lê tem direito de saber em qual dos dois está.
 */
export function totaisDeIpvaPorVigencia(
  valores: readonly ValorDeIpva[],
): TotalDeIpvaDaVigencia[] {
  const acumulado = new Map<string, TotalDeIpvaDaVigencia>();
  for (const v of valores) {
    if (v.ipva === null) continue;
    const chave = `${v.ponta}${v.entityType}`;
    const atual =
      acumulado.get(chave) ??
      ({
        ponta: v.ponta,
        entityType: v.entityType,
        total: 0,
        veiculos: 0,
        negativos: 0,
      } as TotalDeIpvaDaVigencia);
    atual.total += v.ipva;
    atual.veiculos += 1;
    if (v.ipva < 0) atual.negativos += 1;
    acumulado.set(chave, atual);
  }
  return [...acumulado.values()]
    .map((t) => ({ ...t, total: Number(t.total.toFixed(2)) }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

/**
 * O que a alíquota implícita de uma ponta revela.
 *
 * `FORMULA_UNICA` é o veredito que só existe nesta tela e é a razão de ela
 * existir: quando todas as placas caem no mesmo percentual com desvio
 * praticamente zero, aquilo não é dado — é uma fórmula aplicada em bloco, e uma
 * queda de R$ 720 mil ao lado dela é troca de critério, não economia.
 */
export type VereditoDaAliquota =
  | "FORMULA_UNICA"
  | "VALOR_FIXO"
  | "POR_VEICULO"
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO: Record<VereditoDaAliquota, string> = {
  FORMULA_UNICA: "Percentual único da nota",
  VALOR_FIXO: "Taxa fixa por ativo",
  POR_VEICULO: "Calculado veículo a veículo",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/** A alíquota implícita de uma ponta, por tipo de equipamento. */
export interface AliquotaDaVigencia {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  /**
   * Quantos ativos sustentam as medidas: têm IPVA, têm valor de nota, e o IPVA
   * é **positivo**. É a população do veredito, e não a da rubrica — os estornos
   * estão contados ao lado, em {@link estornos}.
   */
  veiculos: number;
  /**
   * Quantos lançamentos negativos foram separados desta medida.
   *
   * Eles não somem: continuam na tabela, no impacto, no total da vigência e no
   * indicador de negativos. O que eles não fazem é **medir dispersão** — ver
   * {@link aliquotaImplicita}.
   */
  estornos: number;
  /** Em pontos percentuais: `1.0` para 1,000% da nota. */
  minima: number | null;
  media: number | null;
  maxima: number | null;
  /** O desvio-padrão populacional, em pontos percentuais. */
  desvio: number | null;
  veredito: VereditoDaAliquota;
}

/**
 * Abaixo deste desvio, em pontos percentuais, a alíquota é fórmula e não dado.
 *
 * O acervo não deixa margem para escolher um número apertado demais: nas seis
 * vigências de Janeiro a Junho de 2026 o desvio é **exatamente zero** nas 62
 * placas, e nas vigências de regime variável ele é 0,119 e 0,849. Meio ponto
 * percentual separa os dois mundos com folga dos dois lados; um limiar colado
 * no zero quebraria no primeiro centavo de arredondamento da fonte.
 */
const DESVIO_DE_FORMULA = 0.005;

/**
 * Abaixo deste coeficiente de variação, o **valor em reais** é que é fixo.
 *
 * É o veredito simétrico ao de cima, e ele existe porque sem ele a carreta era
 * lida errado. `carreta.ipva_licenciamento` é praticamente constante em
 * R$ 140–152 por carreta — 438 de 657 linhas são exatamente R$ 150,00 —,
 * independente de o implemento valer R$ 156 mil ou R$ 283 mil. Uma taxa fixa
 * sobre notas diferentes produz percentuais diferentes, e sem este teste a
 * alíquota espalhada dizia "calculado veículo a veículo": exatamente o
 * contrário do que acontece, porque ninguém calculou nada por veículo — é a
 * mesma taxa para todos. É também o que a rubrica da carreta de fato é:
 * licenciamento, não IPVA, coerente com semirreboque isento na maior parte dos
 * estados.
 *
 * Cinco por cento de dispersão sobre a média separa os dois casos com folga: a
 * carreta fica perto de 3%, e um IPVA que é percentual de notas que vão de
 * R$ 156 mil a R$ 283 mil fica muito acima disso.
 */
const VARIACAO_DE_TAXA_FIXA = 0.05;

/**
 * Quantos ativos **positivos** uma ponta precisa ter para o veredito valer.
 *
 * Positivos, e não lançamentos: uma vigência com quatro licenciamentos e onze
 * estornos não conhece o critério de ninguém, e dizer "taxa fixa" ali seria
 * afirmar sobre quatro linhas uma regra da frota inteira. Abaixo do mínimo o
 * veredito é `BASE_INSUFICIENTE`, que é a resposta honesta.
 */
const MINIMO_PARA_VEREDITO = 5;

/**
 * A alíquota implícita — o IPVA como percentual do valor de nota.
 *
 * É a conferência que o acervo sustenta **hoje**, e ela não é a que o verbete da
 * tela em preparo pedia: ele pedia ano-modelo, valor venal e a UF do
 * emplacamento, e a UF continua não existindo. O que existe é o valor de nota, e
 * a razão entre dois valores em reais não tem ambiguidade de escala — que é
 * exatamente o argumento de `docs/ACHADO-IPVA.md` para preferi-la a uma coluna
 * de percentual declarado, que pode vir em pontos ou em fração sem que se saiba
 * qual.
 *
 * Um ativo sem valor de nota, ou com nota zero, **não entra**: dividir por zero
 * não produz alíquota nenhuma, e tratá-lo como 0% faria a média cair por um
 * cadastro em branco.
 *
 * ---------------------------------------------------------------------------
 * O estorno sai da medida, e só da medida
 * ---------------------------------------------------------------------------
 * Um IPVA negativo não é uma alíquota baixa: é um crédito, um lançamento de
 * natureza contrária ao que esta função mede. Dois deles bastavam para inverter
 * o veredito da carreta — o mínimo ia a −0,604%, o desvio estourava, e uma
 * rubrica que é a mesma taxa de R$ 150 para todas as 71 carretas passava a ser
 * anunciada como "calculado veículo a veículo". O critério da vigência ficava
 * ilegível por causa de duas linhas que não são critério nenhum.
 *
 * Então **as medidas — mínima, média, máxima e desvio — e o veredito olham só os
 * positivos.** É a mesma regra que esta tela já aplica em outro lugar: ausência
 * não vira zero, e agora crédito não vira alíquota.
 *
 * O que os estornos continuam fazendo é tudo o resto, e é deliberado: continuam
 * somando no impacto, continuam no total da vigência, continuam contados em
 * `valoresNegativos`, continuam marcados na linha da tabela, ditos no
 * diagnóstico e a um alternador de distância. E aparecem **aqui também**, em
 * {@link AliquotaDaVigencia.estornos}, para que a coluna de ativos não fique
 * dizendo 69 onde a vigência tem 71 sem explicar os dois que faltam. Tirá-los da
 * régua é uma decisão sobre como se mede; escondê-los seria maquiar.
 */
export function aliquotaImplicita(
  valores: readonly ValorDeIpva[],
): AliquotaDaVigencia[] {
  const porPonta = new Map<
    string,
    {
      ponta: "BASE" | "COMPARADA";
      entityType: string;
      percentuais: number[];
      reais: number[];
      estornos: number;
    }
  >();

  for (const v of valores) {
    if (v.ipva === null || v.valorNf === null || v.valorNf === 0) continue;
    const chave = `${v.ponta}${v.entityType}`;
    const atual =
      porPonta.get(chave) ??
      { ponta: v.ponta, entityType: v.entityType, percentuais: [], reais: [], estornos: 0 };
    /*
      O crédito é contado e não medido. Zero entra pelo caminho dos positivos —
      é uma isenção declarada, não um lançamento de natureza contrária —, e um
      zero não desloca o coeficiente de variação como um negativo desloca.
    */
    if (v.ipva < 0) {
      atual.estornos += 1;
    } else {
      atual.percentuais.push((v.ipva / v.valorNf) * 100);
      atual.reais.push(v.ipva);
    }
    porPonta.set(chave, atual);
  }

  return [...porPonta.values()]
    .map(({ ponta, entityType, percentuais, reais, estornos }) => {
      const veiculos = percentuais.length;
      if (veiculos === 0) {
        return {
          ponta,
          entityType,
          veiculos,
          estornos,
          minima: null,
          media: null,
          maxima: null,
          desvio: null,
          veredito: "BASE_INSUFICIENTE" as VereditoDaAliquota,
        };
      }
      const media = percentuais.reduce((acc, p) => acc + p, 0) / veiculos;
      const desvio = Math.sqrt(
        percentuais.reduce((acc, p) => acc + (p - media) ** 2, 0) / veiculos,
      );
      /*
        A ordem dos três testes é o que os torna verdadeiros.

        O percentual decide primeiro: quando ele é único, o valor em reais varia
        junto com a nota, e chamar isso de taxa fixa seria o erro inverso. Só
        depois se pergunta pelos reais — e é essa segunda pergunta que salva a
        carreta de ser lida como cálculo por veículo. "Calculado veículo a
        veículo" é o que sobra: nem um percentual único, nem uma taxa única, e
        por isso alguém de fato olhou cada ativo.
      */
      const mediaEmReais = reais.reduce((acc, r) => acc + r, 0) / veiculos;
      const desvioEmReais = Math.sqrt(
        reais.reduce((acc, r) => acc + (r - mediaEmReais) ** 2, 0) / veiculos,
      );
      const variacaoEmReais =
        mediaEmReais === 0
          ? Number.POSITIVE_INFINITY
          : desvioEmReais / Math.abs(mediaEmReais);

      const veredito: VereditoDaAliquota =
        veiculos < MINIMO_PARA_VEREDITO
          ? "BASE_INSUFICIENTE"
          : desvio <= DESVIO_DE_FORMULA
            ? "FORMULA_UNICA"
            : variacaoEmReais <= VARIACAO_DE_TAXA_FIXA
              ? "VALOR_FIXO"
              : "POR_VEICULO";
      return {
        ponta,
        entityType,
        veiculos,
        estornos,
        minima: Number(Math.min(...percentuais).toFixed(4)),
        media: Number(media.toFixed(4)),
        maxima: Number(Math.max(...percentuais).toFixed(4)),
        desvio: Number(desvio.toFixed(4)),
        veredito,
      };
    })
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_IPVA = [
  "Veículo",
  "Tipo",
  "Variável",
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
 * Uma linha da tabela como as células do CSV.
 *
 * Devolve texto cru — sem `R$`, sem separador de milhar e sem decidir o
 * separador do arquivo. Quem escreve o CSV é `lib/csv.ts`, no cliente, que já
 * sabe o que o Excel brasileiro espera.
 *
 * O aviso da linha que não soma viaja junto, e existe no arquivo justamente
 * porque o arquivo sai do produto e vira soma na planilha de outra pessoa. Um CSV que exporta a coluna "mensal" sem dizer que ela não é 1/12 da
 * anual é a forma mais fácil de o achado se perder.
 *
 * A justificativa entra por parâmetro porque **não é da linha**: ela é do
 * gestor, mora em `justificativa` e é lida por `change_id` numa segunda
 * consulta. Guardá-la dentro da linha faria a comparação carregar um texto que o
 * motor não produziu — e que muda sem a comparação mudar. É a mesma escolha de
 * `celulasDoCsv`, no FINAME. No arquivo ela é a última coluna, e é boa parte do
 * motivo de o CSV existir para além da tela: quem recebe a planilha lê o que
 * mudou e, na mesma linha, por que mudou.
 */
export function celulasDoCsvDeIpva(
  l: LinhaDeIpva,
  justificativa?: string | null,
): (string | number | null)[] {
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
    l.foraDaSoma,
    justificativa ?? null,
  ];
}


// ---------------------------------------------------------------------------
// O agrupamento por veículo — uma linha por placa
// ---------------------------------------------------------------------------

/**
 * Um veículo da tabela de IPVA: a placa, o que ela moveu, e as linhas
 * por baixo.
 *
 * O corpo do agrupamento mora em `agrupamento-por-veiculo.ts`, com as outras
 * rubricas de custo fixo — inclusive o FINAME, que foi onde ele nasceu. Quatro
 * cópias da mesma função seriam quatro definições de "o estado de uma placa"
 * livres para divergir.
 */
export type VeiculoDeIpva = VeiculoDaRubrica<LinhaDeIpva>;

/**
 * A ordem em que a expansão lê as variáveis de uma placa, e quem é o destaque.
 *
 * A ordem é a do catálogo, e não a que o motor entrega: o catálogo começa pela
 * variável que a tela resume e segue pelo que a explica, e é essa a leitura que
 * a expansão quer. `veiculo` vem antes de tudo, porque entrada e saída de ativo
 * explicam todas as outras linhas da placa; e por isso mesmo fica **fora da
 * contagem**, em vez de fazer uma placa que só entrou na frota aparecer com
 * "1 alteração".
 *
 * O destaque é o IPVA/licenciamento anual — **uma** variável, e nunca a soma das monetárias.
 * É a coluna anual, e nunca a "mensal" da carreta: aquela não é 1/12 desta, ninguém sabe o que ela é, e é justamente por isso que ela fica fora de toda soma — inclusive desta. Somar as duas na mesma célula daria o número mais lido e menos verdadeiro da tela.
 */
export const AGRUPAMENTO_DE_IPVA = {
  ordemDasVariaveis: ["veiculo", ...TODAS.map((v) => v.chave)],
  destaque: "ipva",
  /* A unidade do destaque e a resposta a "esta rubrica tem dinheiro?" saem
     daqui — do mesmo catálogo que define a ordem da expansão, e nunca de
     uma segunda lista escrita à mão. */
  medidas: medidasDoCatalogo(TODAS),
  foraDaContagem: ["veiculo"],
} as const satisfies OpcoesDoAgrupamento;

/**
 * As linhas viradas uma linha por placa.
 *
 * A tabela nasceu por variável — uma linha por (veículo × variável) —, e a mesma
 * placa aparecia tantas vezes quantas são as variáveis do catálogo, espalhada
 * por várias páginas: ler "o que aconteceu com a QYW6D15" era procurar as linhas
 * dela na lista. Agrupar responde essa pergunta de uma vez, e a lista de baixo
 * continua inteira dentro da placa.
 *
 * **Não recalcula nada.** Contagem, estado e destaque saem das linhas que o
 * motor já produziu; o que a função faz é juntar por `(placa, tipo)` e ordenar.
 */
export function agruparPorVeiculoDeIpva(
  linhas: readonly LinhaDeIpva[],
): VeiculoDeIpva[] {
  return agruparVeiculos(linhas, AGRUPAMENTO_DE_IPVA);
}

// ---------------------------------------------------------------------------
// O recorte da tela — e por que ele mora aqui
// ---------------------------------------------------------------------------

/**
 * Os filtros da Auditoria de IPVA — busca, tipo, variável, estado e negativos.
 *
 * Eles nasceram em `lib/ipva.ts`, do lado da interface, e era o lugar certo
 * enquanto o recorte só precisava produzir uma tabela. Deixou de ser quando a
 * justificativa em lote passou a poder dizer "todos os resultados deste
 * filtro": ali o cliente manda **o filtro**, e não milhares de ids, e é o
 * servidor que reabre o universo para saber o que está gravando.
 *
 * Reabri-lo com uma segunda escrita da mesma regra seria a pior versão disto:
 * as duas concordariam no dia em que fossem escritas e discordariam no
 * seguinte — e a discordância apareceria como uma justificativa gravada em
 * linhas que quem clicou nunca viu em tela. Uma função só, importada pelos
 * dois lados, é o que impede isso por construção.
 */
export type FiltrosDeIpva = {
  busca: string;
  /** `TODOS`, ou um `entity_type` — o recorte de equipamento. */
  tipo: string;
  /** `TODAS`, ou a chave da variável. */
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeIpva;
  /** Só as linhas em que uma das pontas é negativa — o achado do acervo. */
  soNegativos: boolean;
}

export const FILTROS_DE_IPVA_VAZIOS: FiltrosDeIpva = {
  busca: "",
  tipo: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
  soNegativos: false,
};

/** Uma das pontas desta linha é negativa? Só em dinheiro: ano não é estorno. */
export function temValorNegativoDeIpva(l: LinhaDeIpva): boolean {
  if (l.medida !== "DINHEIRO") return false;
  const antes = Number(l.base);
  const depois = Number(l.comparada);
  return (Number.isFinite(antes) && antes < 0) || (Number.isFinite(depois) && depois < 0);
}

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas, o CSV e o
 * universo do lote.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" sobre uma tabela
 * de 9 linhas é o defeito que aparece quando o filtro é reescrito em vez de
 * reutilizado, e no lote ele seria pior — gravaria a frase em linhas fora do
 * recorte.
 */
export function filtrarLinhasDeIpva(
  linhas: readonly LinhaDeIpva[],
  filtros: FiltrosDeIpva,
): LinhaDeIpva[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.tipo !== "TODOS" && l.entityType !== filtros.tipo) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
    if (filtros.soNegativos && !temValorNegativoDeIpva(l)) return false;
    if (busca) {
      const alvo = `${l.entityLabel ?? ""} ${l.rotuloDaVariavel}`.toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/**
 * Os filtros como o corpo de uma requisição os traz — nunca confiados como
 * chegam.
 *
 * O universo de um lote é decidido por estes cinco campos, e é ele que decide o
 * que recebe justificativa: um `estado` que o cliente inventasse não pode
 * virar um recorte que ninguém viu. O que não é reconhecido cai no valor vazio,
 * que é o recorte mais largo — e o mais largo é, por construção, o que a tela
 * mostra quando ninguém filtrou nada.
 */
export function lerFiltrosDeIpva(bruto: unknown): FiltrosDeIpva {
  const objeto = (bruto ?? {}) as Record<string, unknown>;
  const texto = (chave: string, padrao: string): string =>
    typeof objeto[chave] === "string" ? (objeto[chave] as string) : padrao;
  const estado = texto("estado", "TODAS");
  return {
    busca: texto("busca", ""),
    tipo: texto("tipo", "TODOS"),
    variavel: texto("variavel", "TODAS"),
    estado:
      estado === "TODAS" || GRAVIDADE.includes(estado as EstadoDaLinhaDeIpva)
        ? (estado as FiltrosDeIpva["estado"])
        : "TODAS",
    soNegativos: objeto.soNegativos === true,
  };
}
