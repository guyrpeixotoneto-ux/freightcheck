/**
 * A AUDITORIA DE AQUISIÇÃO — o que se pagou pelo ativo, e o que essa nota explica.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rubrica ganhou tela, sendo a mais quieta do acervo
 * ---------------------------------------------------------------------------
 * Porque ela é o **denominador**. O valor da nota de compra é a base do
 * PIS/COFINS (9,250% dela, com desvio zero — `docs/ACHADO-IMPOSTOS.md`), do ICMS
 * declarado, do IPVA do cavalo (1,000% nas vigências de 2026 —
 * `docs/ACHADO-IPVA.md`) e do que o FINAME financia. Três telas já a leem, e é
 * exatamente por isso que ela não era rubrica de nenhuma: um código reivindicado
 * por várias sai do mapa de `modulos-de-justificativa.ts`, e a coluna que explica
 * quatro rubricas ficou sem lugar onde ser cobrada.
 *
 * E ela é quieta de verdade, medido nos dois caminhos em
 * `docs/ACHADO-AQUISICAO.md`: no fato, cada ativo tem **um único** valor de nota,
 * de percentual de entrada e de data ao longo das 18 vigências — zero ativos com
 * mais de um valor distinto; no motor, zero linhas de `change` nas 8 comparações
 * calculadas.
 *
 * Isso decide a forma da tela, e está escrito em cada função deste arquivo:
 *
 * 1. **O centro não é "o que mudou"** — viria zerado. O centro é a conferência
 *    da base: quanto custou, com que entrada, em que data, e se o cadastro fecha
 *    consigo mesmo ({@link coerenciaDoCadastro}).
 * 2. **O que se move é o ativo inteiro**: 11 entradas e 11 saídas de frota no
 *    acervo, e cada entrada é uma nota nova que ninguém conferiu.
 * 3. **Uma alteração de nota, se aparecer, é o achado mais caro do produto** —
 *    ela move quatro rubricas de uma vez. A tela existe para o dia em que
 *    aparecer, e até lá diz, com todas as letras, que não apareceu.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo não faz
 * ---------------------------------------------------------------------------
 * **Não compara nada** — `engine.ts` compara, `listChanges` lê, e aqui se
 * traduz. **Não traduz o motor de novo**: os seis estados, a forma da alteração
 * e a ordem de gravidade vêm de `recorte-de-rubrica.ts`, o mesmo módulo do
 * FINAME e do IPVA. E **não reclassifica**: quem diz que a nota e o percentual
 * de entrada são custo fixo, e que data, ano e mês são cadastro, é
 * `attribute.cost_class`, escrito pela curadoria.
 */

import {
  chaveDoVeiculo,
  estadoDaAlteracao,
  GRAVIDADE,
  numero,
  ROTULO_DO_ESTADO,
  type EstadoDaLinha,
  type MedidaDaVariavel,
  type AlteracaoDoMotor,
} from "./recorte-de-rubrica";
import {
  agruparVeiculos,
  type OpcoesDoAgrupamento,
  type VeiculoDaRubrica,
} from "./agrupamento-por-veiculo";

export {
  estadoDaAlteracao,
  ROTULO_DO_ESTADO,
  type AlteracaoDoMotor,
  type MedidaDaVariavel,
};

/** Os seis estados de uma linha de aquisição. O mesmo tipo das demais rubricas. */
export type EstadoDaLinhaDeAquisicao = EstadoDaLinha;

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * O papel de uma coluna nesta rubrica — e a razão de ele ser campo, não comentário.
 *
 * `MONTANTE` é dinheiro e soma; `ALIQUOTA` é percentual e nunca entra numa soma
 * de reais; `CADASTRO` não é custo e não entra em soma nenhuma — a curadoria a
 * marcou `NAO_APLICAVEL`. Vinte por cento e R$ 665.929,99 são duas células
 * numéricas, e somá-las produz um número que não é de nada: é a mesma distinção
 * que `impostos.ts` carrega, pelo mesmo motivo.
 */
export type PapelNaAquisicao = "MONTANTE" | "ALIQUOTA" | "CADASTRO";

/**
 * Uma variável de aquisição, com o código que cada tipo de equipamento usa.
 *
 * `codigo.CAVALO` ou `codigo.CARRETA` ausente quer dizer que **aquele tipo não
 * tem esta variável** — nunca que ela caia num código parecido. Aqui as cinco
 * existem nos dois lados, o que é incomum entre as rubricas e simplifica a
 * leitura; a regra continua escrita porque é ela que impede o emparelhamento por
 * semelhança de nome.
 */
export interface VariavelDeAquisicao {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  papel: PapelNaAquisicao;
  codigo: { CAVALO?: string; CARRETA?: string };
  /**
   * A variável de que esta é uma **derivação**, quando é.
   *
   * `ano` e `mes_de_entrada` são o ano e o mês de `data` — 558 de 558 no cavalo
   * e 1.314 de 1.314 na carreta. Não são dois fatos a mais: são o mesmo fato
   * escrito três vezes, e mostrá-las como variáveis independentes faria uma
   * entrada de ativo parecer três alterações.
   */
  derivadaDe?: string;
  /** Uma coluna que **não entra em soma nenhuma**, e a razão disso. */
  foraDaSoma?: string;
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/**
 * As variáveis da aquisição, na ordem em que a tela as lê.
 *
 * Começa na nota — o número que resume a compra e que as outras telas usam como
 * base —, segue pelo percentual de entrada, que é a única condição negociada que
 * o export traz, e termina na data de entrada, que é o que emoldura as duas.
 * São três, e não cinco, porque `ano` e `mes_de_entrada` são a própria data
 * escrita de novo e descem para o detalhe.
 */
export const VARIAVEIS_DE_AQUISICAO: readonly VariavelDeAquisicao[] = [
  {
    chave: "valor_nf",
    rotulo: "Valor de NF",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    codigo: { CAVALO: "cavalo.valor_nf_compra", CARRETA: "carreta.valor_nf_compra" },
    foraDaSoma:
      "É o preço de compra do ativo, não uma rubrica de custo do período — e esta " +
      "tela não muda isso por ser a dona dela. `finame.ts`, `ipva.ts` e " +
      "`impostos.ts` já a recusavam com esta frase, e " +
      "`__tests__/posse-da-soma-do-custo-fixo.test.ts` prende a decisão: a base de " +
      "compra não tem módulo dono. Ter tela onde ser conferida e ter total onde ser " +
      "somada são duas coisas diferentes.",
    ajuda:
      "O preço de compra do ativo, e a base de quatro rubricas: PIS/COFINS é " +
      "9,250% dela com desvio zero, o ICMS declarado é zero em 100% das linhas, o " +
      "IPVA do cavalo é 1,000% dela nas vigências de 2026, e o FINAME financia o " +
      "que sobra da entrada. Cavalo entre R$ 409.630,71 e R$ 770.000,00; carreta " +
      "entre R$ 0,00 e R$ 493.386,90.",
  },
  {
    chave: "percentual_entrada",
    rotulo: "Entrada",
    medida: "PERCENTUAL",
    papel: "ALIQUOTA",
    codigo: { CAVALO: "cavalo.percentual_entrada", CARRETA: "carreta.percentual_entrada" },
    ajuda:
      "Dois valores no acervo inteiro: 20,00% em 1.854 linhas e 0,00% nas 18 de uma " +
      "carreta alugada. Não é parâmetro por ativo — é constante do modelo.",
  },
  {
    chave: "data_de_entrada",
    rotulo: "Data de entrada",
    medida: "DATA",
    papel: "CADASTRO",
    codigo: { CAVALO: "cavalo.data", CARRETA: "carreta.data" },
    ajuda:
      "Quando o ativo entrou na frota. O ano e o mês de entrada são derivados " +
      "dela, e estão no detalhe.",
  },
] as const;

/**
 * As variáveis que só o detalhe mostra: as duas derivadas da data.
 *
 * Elas estão aqui pelo mesmo motivo que as duplicatas da Manutenção estão lá —
 * o achado é que elas **existem**. Quem confere a planilha vai encontrá-las, e
 * sumir com elas deixaria a pessoa procurando por que o nosso número não bate
 * com o que ela está vendo. Aparecem marcadas, e fora de toda soma.
 */
export const VARIAVEIS_DE_DETALHE_DE_AQUISICAO: readonly VariavelDeAquisicao[] = [
  {
    chave: "ano",
    rotulo: "Ano",
    medida: "ANO",
    papel: "CADASTRO",
    codigo: { CAVALO: "cavalo.ano", CARRETA: "carreta.ano" },
    derivadaDe: "data_de_entrada",
    foraDaSoma:
      "É o ano da data de entrada — 558 de 558 no cavalo e 1.314 de 1.314 na " +
      "carreta —, e não o ano-modelo do veículo. Ver docs/ACHADO-AQUISICAO.md.",
    ajuda: "Derivada da data de entrada. Divergir dela é defeito de cadastro, não alteração.",
  },
  {
    chave: "mes_de_entrada",
    rotulo: "Mês de entrada",
    medida: "MESES",
    papel: "CADASTRO",
    codigo: { CAVALO: "cavalo.mes_de_entrada", CARRETA: "carreta.mes_de_entrada" },
    derivadaDe: "data_de_entrada",
    foraDaSoma:
      "É o mês da data de entrada, nas mesmas 1.872 linhas. Somá-lo ou contá-lo " +
      "como alteração própria contaria o mesmo fato duas vezes.",
    ajuda: "Derivada da data de entrada, e medida como mês do ano — nunca como duração.",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_AQUISICAO, ...VARIAVEIS_DE_DETALHE_DE_AQUISICAO];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeAquisicao(
  variaveis: readonly VariavelDeAquisicao[],
): string[] {
  const codigos = new Set<string>();
  for (const v of variaveis) {
    if (v.codigo.CAVALO) codigos.add(v.codigo.CAVALO);
    if (v.codigo.CARRETA) codigos.add(v.codigo.CARRETA);
  }
  return [...codigos].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_AQUISICAO = codigosDeAquisicao(VARIAVEIS_DE_AQUISICAO);

/** O recorte do detalhe: tudo, inclusive as duas derivadas que não somam. */
export const CODIGOS_DO_DETALHE_DE_AQUISICAO = codigosDeAquisicao(TODAS);

/**
 * Os códigos de um recorte de equipamento — `TODOS`, `CAVALO` ou `CARRETA`.
 *
 * Existe pela mesma razão que em `ipva.ts`: nem toda leitura aceita recortar por
 * `entity_type`, e a leitura ponta a ponta só aceita lista de atributos. As duas
 * precisam responder pelo mesmo recorte quando a aba Cavalo está aberta, ou a
 * tela publica o número do acervo inteiro sob o título de um equipamento só.
 */
export function codigosDoRecorteDeAquisicao(
  recorte: "TODOS" | "CAVALO" | "CARRETA",
  variaveis: readonly VariavelDeAquisicao[] = VARIAVEIS_DE_AQUISICAO,
): string[] {
  if (recorte === "TODOS") return codigosDeAquisicao(variaveis);
  const codigos = new Set<string>();
  for (const v of variaveis) {
    const codigo = v.codigo[recorte];
    if (codigo) codigos.add(codigo);
  }
  return [...codigos].sort();
}

const POR_CODIGO = new Map<string, VariavelDeAquisicao>();
for (const v of TODAS) {
  if (v.codigo.CAVALO) POR_CODIGO.set(v.codigo.CAVALO, v);
  if (v.codigo.CARRETA) POR_CODIGO.set(v.codigo.CARRETA, v);
}

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeAquisicaoDoCodigo(
  code: string | null,
): VariavelDeAquisicao | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

/** O código que um tipo de equipamento usa para uma variável, quando existe. */
export function codigoDaVariavelDeAquisicao(
  variavel: VariavelDeAquisicao,
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
export interface LinhaDeAquisicao {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  papel: PapelNaAquisicao;
  attributeCode: string | null;
  /** O texto do valor na vigência base. Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na vigência comparada. Nulo quando não há. */
  comparada: string | null;
  /** `comparada − base`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em **pontos percentuais**. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinhaDeAquisicao;
  /** A frase da recusa, quando há. Vem do motor, não é escrita aqui. */
  motivo: string | null;
  impactoAmount: number | null;
  impactoPeriodicidade: string | null;
  impactoCalculado: boolean;
  /** O aviso da coluna que não soma, quando esta linha é de uma delas. */
  foraDaSoma: string | null;
  /** A variável de que esta linha é derivada, quando é. */
  derivadaDe: string | null;
}

/**
 * Uma alteração do motor virando linha da tabela.
 *
 * Devolve `null` para o que não é de aquisição — a função é o filtro e o
 * tradutor ao mesmo tempo, de modo que nenhuma tela precise saber quais são os
 * códigos.
 *
 * Entrada e saída de ativo passam, como nas demais rubricas, e nesta tela elas
 * são o **assunto principal**: são as 11 linhas em que uma nota nova entra no
 * acervo. Sumir com elas deixaria a tela vazia num acervo em que a rubrica não
 * se move.
 */
export function linhaDeAquisicaoDaAlteracao(
  a: AlteracaoDoMotor,
): LinhaDeAquisicao | null {
  const variavel = variavelDeAquisicaoDoCodigo(a.attributeCode);
  if (!variavel) {
    if (a.changeType !== "ENTITY_ADDED" && a.changeType !== "ENTITY_REMOVED") return null;
    return {
      id: a.id ?? null,
      entityLabel: a.entityLabel,
      entityType: a.entityType ?? "",
      variavel: "veiculo",
      rotuloDaVariavel: "Veículo na frota",
      medida: "DATA",
      papel: "CADASTRO",
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
      derivadaDe: null,
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
    derivadaDe: variavel.derivadaDe ?? null,
  };
}

/** As linhas de aquisição de uma lista de alterações, na ordem em que vieram. */
export function linhasDeAquisicao(
  alteracoes: readonly AlteracaoDoMotor[],
): LinhaDeAquisicao[] {
  const linhas: LinhaDeAquisicao[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeAquisicaoDaAlteracao(a);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/**
 * Um par de valores iguais virando linha — o alternador "sem alteração".
 *
 * Nesta rubrica ele não é um detalhe de conforto: como nada se move, **é por ele
 * que a tabela tem conteúdo**. Ligado, ele mostra a base inteira — a nota de
 * cada ativo, a entrada e a data —, que é o que esta tela existe para conferir.
 * As linhas não vêm do motor: são montadas das duas leituras de `getEntityTable`,
 * e por isso carregam `id: null`.
 */
export function linhaDeAquisicaoSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeAquisicao | null {
  const variavel = variavelDeAquisicaoDoCodigo(par.attributeCode);
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
    derivadaDe: variavel.derivadaDe ?? null,
  };
}

// ---------------------------------------------------------------------------
// O impacto — e as três coisas que ele se recusa a fazer
// ---------------------------------------------------------------------------

/** O impacto financeiro do recorte, por periodicidade. */
export interface ImpactoDeAquisicao {
  /**
   * Um número por periodicidade — e nesta rubrica ele é **sempre vazio**.
   *
   * O campo existe com a forma das outras rubricas porque o Monitor, as
   * candidatas do par e a tela leem todas pela mesma chave; o que muda aqui é
   * que nada o preenche, e a razão está logo abaixo, em {@link impactoDeAquisicao}.
   *
   * Vazio é diferente de `R$ 0,00`: zero diria que as notas se moveram e se
   * anularam.
   */
  porPeriodicidade: Record<string, number>;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /**
   * Quantas notas de compra mudaram de valor.
   *
   * É o indicador que substitui o total de reais, e é o que a tela publica no
   * lugar dele. No acervo de hoje é sempre zero; qualquer número diferente disso
   * é o achado mais caro do produto, porque a nota é a base de quatro rubricas.
   */
  notasAlteradas: number;
  /**
   * Alterações em que uma das pontas é negativa.
   *
   * No acervo de hoje não há nenhuma — a nota nunca se move, e nenhuma é
   * negativa. O indicador existe porque uma nota negativa é estorno ou erro de
   * cadastro, e nos dois casos distorce qualquer total em silêncio.
   */
  valoresNegativos: number;
}

/**
 * O impacto do recorte de aquisição — que é, por construção, nenhum.
 *
 * ---------------------------------------------------------------------------
 * Por que esta função nunca soma
 * ---------------------------------------------------------------------------
 * Porque **a base de compra não tem módulo dono**, e isso não é escolha desta
 * tela: `finame.ts`, `ipva.ts` e `impostos.ts` recusam somar
 * `valor_nf_compra` com a mesma frase — "preço do ativo não é custo fixo" — e
 * `__tests__/posse-da-soma-do-custo-fixo.test.ts` prende essa recusa como
 * contrato, exigindo que a coluna continue sem dono.
 *
 * Ganhar tela própria não muda a natureza da coluna. **Ter onde ser conferida e
 * ter onde ser somada são duas coisas diferentes**, e confundi-las aqui seria
 * fazer o Monitor publicar, como custo do período, o preço que o ativo teve uma
 * vez — exatamente a dupla contagem que aquele portão existe para impedir (ver
 * `docs/ACHADO-DUPLA-CONTAGEM-CUSTO-FIXO.md`).
 *
 * As outras duas colunas nunca somariam de todo jeito: o percentual de entrada é
 * alíquota, e a data e as suas derivadas são cadastro.
 *
 * O que a função faz, então, é **contar** — quantas linhas ficaram fora da soma,
 * quantas notas mudaram e quantas trazem valor negativo. Contar é o que resta
 * quando somar seria mentir, e é mais do que a tela tinha antes de existir.
 */
export function impactoDeAquisicao(
  linhas: readonly LinhaDeAquisicao[],
): ImpactoDeAquisicao {
  let foraDaSoma = 0;
  let notasAlteradas = 0;
  let valoresNegativos = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;

    const antes = numero(l.base);
    const depois = numero(l.comparada);
    if (l.medida === "DINHEIRO" && ((antes ?? 0) < 0 || (depois ?? 0) < 0)) {
      valoresNegativos++;
    }
    if (l.variavel === "valor_nf") notasAlteradas++;
    if (l.foraDaSoma) foraDaSoma++;
  }

  return { porPeriodicidade: {}, foraDaSoma, notasAlteradas, valoresNegativos };
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos veículos cada vigência entregou — vem da contagem do motor. */
export interface FrotaDoParDeAquisicao {
  /** Veículos presentes nas duas vigências. */
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeAquisicao {
  veiculosComparados: number;
  /** Comparados que não tiveram nenhuma variável de aquisição alterada. */
  semAlteracao: number;
  veiculosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  /** Quantas variáveis se moveram, somando todos os veículos. */
  variaveisAlteradas: number;
  veiculosComDadoIncompleto: number;
  veiculosComConflito: number;
  impacto: ImpactoDeAquisicao;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `frota` vem do motor porque **esta lista não sabe** quantos veículos não
 * mudaram: um veículo sem alteração nenhuma não produz linha. Nesta rubrica isso
 * é a regra e não a exceção — derivar "sem alteração" do tamanho da lista daria
 * zero em todo par de vigências do acervo, que é justamente quando o número
 * importa.
 */
export function resumirAquisicao(
  linhas: readonly LinhaDeAquisicao[],
  frota: FrotaDoParDeAquisicao,
): ResumoDeAquisicao {
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

  /* "Sem alteração" é o que nenhuma linha tocou — a mesma regra do FINAME, que
     nasceu do cartão que contava os 62 em conflito duas vezes. */
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
    impacto: impactoDeAquisicao(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeAquisicao {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeAquisicao(
  linhas: readonly LinhaDeAquisicao[],
): AlteracoesDaVariavelDeAquisicao[] {
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
export interface FatiaDeEstadoDeAquisicao {
  estado: EstadoDaLinhaDeAquisicao;
  rotulo: string;
  veiculos: number;
  /** A fração sobre o total de veículos do recorte. `0.852` para 85,2%. */
  fracao: number;
}

/**
 * Os veículos por estado — a rosca.
 *
 * Um veículo tem um estado só, e a ordem de gravidade decide qual. Nesta rubrica
 * a rosca é, quase toda, "sem alteração" — e é essa a leitura verdadeira do
 * acervo: a frota inteira comprada e cadastrada, e as poucas placas que entraram
 * ou saíram.
 */
export function distribuicaoPorEstadoDeAquisicao(
  linhas: readonly LinhaDeAquisicao[],
  frota: FrotaDoParDeAquisicao,
): FatiaDeEstadoDeAquisicao[] {
  const pior = new Map<string, EstadoDaLinhaDeAquisicao>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeAquisicao, number>();
  for (const estado of pior.values()) {
    contagem.set(estado, (contagem.get(estado) ?? 0) + 1);
  }
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
// Os totais, a conferência da entrada e a coerência do cadastro
// ---------------------------------------------------------------------------

/** Um ativo lido de uma das duas vigências, para as três leituras próprias. */
export interface ValorDeAquisicao {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  entityLabel: string | null;
  /** O valor de nota, em reais. Nulo quando a vigência não o trouxe. */
  valorNf: number | null;
  /** O percentual de entrada. Nulo quando a vigência não o trouxe. */
  percentualEntrada: number | null;
  /** A data de entrada, como a fonte a escreveu. Nula quando falta. */
  dataDeEntrada: string | null;
  /** O ano declarado, que deveria ser o da data. */
  ano: number | null;
  /** O mês de entrada declarado, que deveria ser o da data. */
  mesDeEntrada: number | null;
}

/** Um ponto do gráfico "valor de nota por vigência". */
export interface TotalDeAquisicaoDaVigencia {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  /** A soma das notas do recorte. É patrimônio, não custo do período. */
  total: number;
  /** Quantos ativos sustentam o total. */
  ativos: number;
  /** Quantos deles vieram com nota zerada — frota que não foi comprada. */
  zerados: number;
  /** Quantos vieram negativos. Zero no acervo de hoje; o indicador existe à espera. */
  negativos: number;
}

/**
 * A nota somada de cada ponta, por tipo de equipamento.
 *
 * **Isto é estoque, não fluxo.** A soma das notas é o que a frota custou para
 * ser comprada, e não o que ela custa no mês — por isso o rótulo da tela diz
 * "valor de nota da frota" e nunca "custo". Somar este número a uma rubrica
 * mensal é o erro que o campo `papel` e o balde `PONTUAL` existem para impedir.
 *
 * As notas zeradas entram na contagem e **não** na média implícita de quem lê:
 * elas são frota alugada, e o zero é afirmação, não lacuna.
 */
export function totaisDeAquisicaoPorVigencia(
  valores: readonly ValorDeAquisicao[],
): TotalDeAquisicaoDaVigencia[] {
  const acumulado = new Map<string, TotalDeAquisicaoDaVigencia>();
  for (const v of valores) {
    if (v.valorNf === null) continue;
    const chave = `${v.ponta}${v.entityType}`;
    const atual =
      acumulado.get(chave) ??
      ({
        ponta: v.ponta,
        entityType: v.entityType,
        total: 0,
        ativos: 0,
        zerados: 0,
        negativos: 0,
      } as TotalDeAquisicaoDaVigencia);
    atual.total += v.valorNf;
    atual.ativos += 1;
    if (v.valorNf === 0) atual.zerados += 1;
    if (v.valorNf < 0) atual.negativos += 1;
    acumulado.set(chave, atual);
  }
  return [...acumulado.values()]
    .map((t) => ({ ...t, total: Number(t.total.toFixed(2)) }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

/**
 * O que o percentual de entrada de uma ponta revela.
 *
 * `CONSTANTE_DO_MODELO` é o veredito que o acervo entrega hoje e a razão de a
 * conferência existir: quando todos os ativos declaram o mesmo percentual, aquilo
 * não é condição negociada ativo a ativo — é um parâmetro aplicado em bloco. É a
 * mesma leitura que a Auditoria de Impostos faz do PIS/COFINS de 9,250%, e tem a
 * cor de aviso pelo mesmo motivo: ninguém calculou caso a caso.
 */
export type VereditoDaEntrada =
  | "CONSTANTE_DO_MODELO"
  | "POR_ATIVO"
  | "AUSENTE"
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DA_ENTRADA: Record<VereditoDaEntrada, string> = {
  CONSTANTE_DO_MODELO: "Percentual único do modelo",
  POR_ATIVO: "Negociado ativo a ativo",
  AUSENTE: "Sem entrada declarada",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/** A conferência da entrada numa ponta, por tipo de equipamento. */
export interface ConferenciaDaEntrada {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  veredito: VereditoDaEntrada;
  /** Quantos ativos declararam algum percentual. */
  ativos: number;
  /** Os percentuais distintos encontrados, do maior para o menor. */
  percentuais: number[];
  /** O percentual predominante, quando há um. */
  predominante: number | null;
  /** Quantos ativos declararam zero — frota que não foi comprada. */
  zerados: number;
}

/**
 * O percentual de entrada, conferido por ponta e por tipo.
 *
 * Um percentual distinto (fora o zero) é `CONSTANTE_DO_MODELO`; mais de um é
 * `POR_ATIVO`; só zeros é `AUSENTE`; nenhum ativo é `BASE_INSUFICIENTE`.
 *
 * O zero **não** conta como um percentual distinto, e essa é a única sutileza
 * daqui: ele é a frota alugada, que não tem aquisição — tratá-lo como "um
 * segundo percentual" faria o acervo inteiro virar "negociado ativo a ativo" por
 * causa de uma carreta que não foi comprada.
 */
export function conferenciaDaEntrada(
  valores: readonly ValorDeAquisicao[],
): ConferenciaDaEntrada[] {
  const porChave = new Map<
    string,
    { ponta: "BASE" | "COMPARADA"; entityType: string; valores: number[] }
  >();
  for (const v of valores) {
    if (v.percentualEntrada === null) continue;
    const chave = `${v.ponta}${v.entityType}`;
    const atual =
      porChave.get(chave) ?? { ponta: v.ponta, entityType: v.entityType, valores: [] };
    atual.valores.push(v.percentualEntrada);
    porChave.set(chave, atual);
  }

  return [...porChave.values()]
    .map(({ ponta, entityType, valores: lista }) => {
      const zerados = lista.filter((p) => p === 0).length;
      const naoZerados = lista.filter((p) => p !== 0);
      const distintos = [...new Set(naoZerados)].sort((a, b) => b - a);

      let veredito: VereditoDaEntrada;
      if (lista.length === 0) veredito = "BASE_INSUFICIENTE";
      else if (distintos.length === 0) veredito = "AUSENTE";
      else if (distintos.length === 1) veredito = "CONSTANTE_DO_MODELO";
      else veredito = "POR_ATIVO";

      /* O predominante é o mais frequente entre os não zerados — e não a média:
         média de percentual com um zero dentro inventa um número que nenhum
         ativo declarou. */
      const frequencia = new Map<number, number>();
      for (const p of naoZerados) frequencia.set(p, (frequencia.get(p) ?? 0) + 1);
      let predominante: number | null = null;
      let maior = 0;
      for (const [p, n] of frequencia) {
        if (n > maior) {
          maior = n;
          predominante = p;
        }
      }

      return {
        ponta,
        entityType,
        veredito,
        ativos: lista.length,
        percentuais: distintos,
        predominante,
        zerados,
      };
    })
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

/** Uma divergência entre a data de entrada e as duas colunas derivadas dela. */
export interface DivergenciaDeCadastro {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  entityLabel: string | null;
  dataDeEntrada: string | null;
  /** O que a data diz, e o que a coluna declara. */
  anoDaData: number | null;
  anoDeclarado: number | null;
  mesDaData: number | null;
  mesDeclarado: number | null;
  /** Qual das duas derivadas divergiu — ou as duas. */
  divergencia: "ANO" | "MES" | "ANO_E_MES";
}

/**
 * O ano da data de entrada, ou `null` quando ela não se lê.
 *
 * A data chega como o texto que a fonte escreveu — no acervo, ISO com fuso
 * (`2021-01-01T12:00:00Z`) —, e é por isso que esta função existe em vez de um
 * `new Date(...).getFullYear()` solto na tela: uma data ilegível tem de virar
 * `null` e sumir da conferência, e não virar `NaN` e virar divergência.
 */
function partesDaData(texto: string | null): { ano: number; mes: number } | null {
  if (!texto) return null;
  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) return null;
  /* UTC, e não a hora local: as datas do acervo vêm com Z, e ler no fuso de quem
     abre a tela jogaria `2021-01-01T00:00:00Z` para 31/12/2020 no Brasil — uma
     divergência inventada pelo fuso do navegador. */
  return { ano: data.getUTCFullYear(), mes: data.getUTCMonth() + 1 };
}

/**
 * As linhas em que o cadastro não fecha consigo mesmo.
 *
 * `ano` e `mes_de_entrada` **são** o ano e o mês de `data` — 100% das linhas do
 * acervo, medido em `docs/ACHADO-AQUISICAO.md`. Enquanto isso valer, esta função
 * devolve lista vazia, e é esse o resultado que a tela publica: "as três colunas
 * concordam nos N ativos".
 *
 * No dia em que uma delas divergir, a leitura certa não é "duas alterações": é
 * **defeito de cadastro numa placa**, e a tela precisa dizer qual, o que a data
 * diz e o que a coluna declara. É a única conferência que só esta tela consegue
 * fazer, porque é a única que tem as três colunas na mesma tabela.
 */
export function coerenciaDoCadastro(
  valores: readonly ValorDeAquisicao[],
): DivergenciaDeCadastro[] {
  const divergencias: DivergenciaDeCadastro[] = [];
  for (const v of valores) {
    const partes = partesDaData(v.dataDeEntrada);
    if (!partes) continue;

    const anoDivergiu = v.ano !== null && v.ano !== partes.ano;
    const mesDivergiu = v.mesDeEntrada !== null && v.mesDeEntrada !== partes.mes;
    if (!anoDivergiu && !mesDivergiu) continue;

    divergencias.push({
      ponta: v.ponta,
      entityType: v.entityType,
      entityLabel: v.entityLabel,
      dataDeEntrada: v.dataDeEntrada,
      anoDaData: partes.ano,
      anoDeclarado: v.ano,
      mesDaData: partes.mes,
      mesDeclarado: v.mesDeEntrada,
      divergencia:
        anoDivergiu && mesDivergiu ? "ANO_E_MES" : anoDivergiu ? "ANO" : "MES",
    });
  }
  return divergencias.sort(
    (a, b) =>
      a.entityType.localeCompare(b.entityType) ||
      (a.entityLabel ?? "").localeCompare(b.entityLabel ?? "") ||
      a.ponta.localeCompare(b.ponta),
  );
}

/** Quantos ativos a conferência do cadastro olhou, e quantos fecharam. */
export interface ResultadoDaCoerencia {
  conferidos: number;
  /** Ativos em que data, ano e mês concordam. */
  coerentes: number;
  divergencias: DivergenciaDeCadastro[];
  /** Ativos cuja data não se lê — ficam fora da conferência, e são ditos. */
  semDataLegivel: number;
}

/** A conferência do cadastro com as contagens que a tela escreve. */
export function resumirCoerenciaDoCadastro(
  valores: readonly ValorDeAquisicao[],
): ResultadoDaCoerencia {
  let semDataLegivel = 0;
  let conferidos = 0;
  for (const v of valores) {
    if (partesDaData(v.dataDeEntrada)) conferidos++;
    else semDataLegivel++;
  }
  const divergencias = coerenciaDoCadastro(valores);
  return {
    conferidos,
    coerentes: Math.max(0, conferidos - divergencias.length),
    divergencias,
    semDataLegivel,
  };
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_AQUISICAO = [
  "Veículo",
  "Tipo",
  "Variável",
  "Papel",
  "De",
  "Para",
  "Diferença",
  "Variação %",
  "Status",
  "Motivo",
  "Fora da soma",
  "Justificativa",
] as const;

/** Como o papel de uma coluna se escreve no arquivo. */
const ROTULO_DO_PAPEL: Record<PapelNaAquisicao, string> = {
  MONTANTE: "Montante",
  ALIQUOTA: "Alíquota",
  CADASTRO: "Cadastro",
};

/**
 * Uma linha da tabela como as células do CSV.
 *
 * Devolve texto cru — sem `R$`, sem separador de milhar e sem decidir o
 * separador do arquivo; quem escreve o CSV é `lib/csv.ts`, no cliente.
 *
 * O **papel** viaja no arquivo, e essa é a diferença em relação ao CSV das
 * outras rubricas. Um CSV que entrega "20" e "665.929,99" na mesma coluna de
 * valor, sem dizer que o primeiro é percentual, vira uma soma errada na planilha
 * de outra pessoa — e é justamente para fora do produto que o arquivo vai.
 */
export function celulasDoCsvDeAquisicao(
  l: LinhaDeAquisicao,
  justificativa?: string | null,
): (string | number | null)[] {
  return [
    l.entityLabel,
    l.entityType,
    l.rotuloDaVariavel,
    ROTULO_DO_PAPEL[l.papel],
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
 * Um veículo da tabela de aquisição: a placa, o que ela moveu, e as linhas por
 * baixo.
 *
 * O corpo do agrupamento mora em `agrupamento-por-veiculo.ts`, com as outras
 * rubricas de custo fixo. Cinco cópias da mesma função seriam cinco definições
 * de "o estado de uma placa" livres para divergir.
 */
export type VeiculoDeAquisicao = VeiculoDaRubrica<LinhaDeAquisicao>;

/**
 * A ordem em que a expansão lê as variáveis de uma placa, e quem é o destaque.
 *
 * `veiculo` vem antes de tudo — entrada e saída de ativo explicam todas as
 * outras linhas da placa, e nesta rubrica são quase tudo o que há — e fica fora
 * da contagem, para que uma placa que só entrou na frota não apareça com
 * "1 alteração".
 *
 * O destaque é o valor de nota: **uma** variável, e nunca uma soma. Somar a nota
 * com o percentual de entrada na mesma célula daria o número mais lido e menos
 * verdadeiro da tela.
 */
export const AGRUPAMENTO_DE_AQUISICAO = {
  ordemDasVariaveis: ["veiculo", ...TODAS.map((v) => v.chave)],
  destaque: "valor_nf",
  foraDaContagem: ["veiculo"],
} as const satisfies OpcoesDoAgrupamento;

/**
 * As linhas viradas uma linha por placa.
 *
 * **Não recalcula nada.** Contagem, estado e destaque saem das linhas que o
 * motor já produziu; o que a função faz é juntar por `(placa, tipo)` e ordenar.
 */
export function agruparPorVeiculoDeAquisicao(
  linhas: readonly LinhaDeAquisicao[],
): VeiculoDeAquisicao[] {
  return agruparVeiculos(linhas, AGRUPAMENTO_DE_AQUISICAO);
}
