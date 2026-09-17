/**
 * A AUDITORIA DE ALUGUEL DE FROTA — o implemento que se aluga em vez de financiar.
 *
 * ---------------------------------------------------------------------------
 * A frase que desenha esta tela
 * ---------------------------------------------------------------------------
 * É da própria curadoria, na entrada que confirmou a coluna
 * (`lib/db/src/semantica-confirmada.ts`): o aluguel *"fica na classe do
 * financiamento porque é o que ocupa o lugar dele: são os implementos que a
 * frota aluga em vez de financiar"*.
 *
 * Isso decide tudo o que vem abaixo. O aluguel não é uma despesa avulsa ao lado
 * do FINAME — ele **é** a parcela, nos implementos em que não há financiamento:
 * nas 36 linhas alugadas do acervo, amortização e juros são zero e
 * `finame_implemento` é exatamente o aluguel (`docs/ACHADO-ALUGUEL.md`).
 *
 * ---------------------------------------------------------------------------
 * Quem soma, e por que isto não conta o mesmo dinheiro duas vezes
 * ---------------------------------------------------------------------------
 * A parcela FINAME contém o aluguel, então somar os dois seria dupla contagem —
 * a mesma que `docs/ACHADO-DUPLA-CONTAGEM-CUSTO-FIXO.md` documenta.
 *
 * O que impede é a máquina que o FINAME já tinha: **o total sai do impacto
 * quando uma parcela dele se move** (`cobertasPorParcelasEm`). Com `aluguel`
 * declarado como terceira parcela de `parcela`, uma alteração de aluguel tira a
 * parcela do total daquele veículo, e quem soma o aluguel é este módulo. Nenhuma
 * compensação nova: a parcela que faltava na regra que já existia.
 *
 * Do lado do FINAME a recusa é explícita (`foraDaSoma` na variável `aluguel`),
 * como já era para o ICMS, e `__tests__/posse-da-soma-do-custo-fixo.test.ts`
 * nomeia este módulo como dono de `carreta.custo_aluguel`.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo não faz
 * ---------------------------------------------------------------------------
 * **Não compara nada** — `engine.ts` compara, `listChanges` lê, e aqui se
 * traduz. **Não traduz o motor de novo**: os seis estados, a forma da alteração
 * e a ordem de gravidade vêm de `recorte-de-rubrica.ts`. E **não reclassifica**:
 * quem diz que a coluna da carreta é FIXO, BRL e MENSAL é a curadoria.
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

/** Os seis estados de uma linha de aluguel. O mesmo tipo das demais rubricas. */
export type EstadoDaLinhaDeAluguel = EstadoDaLinha;

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * Uma variável de aluguel, com o código que cada tipo de equipamento usa.
 *
 * `codigo.CAVALO` ou `codigo.CARRETA` ausente quer dizer que **aquele tipo não
 * tem esta variável** — e aqui a regra decide a tela inteira: a rubrica é da
 * carreta, porque a identidade do cavalo (`finame_cavalo = amortização + juros
 * + lucro fixo`, em `composition.ts`) não tem aluguel nenhum.
 */
export interface VariavelDeAluguel {
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
 * As variáveis do aluguel: **uma**, e a razão de ser uma só.
 *
 * A parcela FINAME do implemento é o que **confere** o aluguel — nos alugados as
 * duas são o mesmo número, ao centavo — e por um tempo ela esteve neste
 * catálogo, marcada como fora da soma. O acervo real mostrou o preço disso: a
 * linha deste módulo no Monitor Custo Fixo passou a contar **33 alterações**,
 * todas de parcela de frota *financiada*, sob o rótulo "Aluguel de Frota". O
 * número estava certo e a leitura, errada.
 *
 * A regra que a rota desta tela já escrevia vale aqui: *uma tela não reivindica
 * a coluna de outra só porque precisa lê-la*. A amortização e os juros nunca
 * estiveram neste catálogo, e são lidos para a conferência do mesmo jeito; a
 * parcela passou a ser tratada como eles.
 *
 * O que se perde: a parcela deixa de aparecer como linha ao lado do aluguel na
 * tabela por placa. O que se ganha: a contagem deste módulo, em toda tela que a
 * publica, é o número de contratos de locação que se moveram — e nada mais.
 * A conferência continua inteira, e num lugar melhor: o painel próprio, que
 * compara as quatro colunas por vigência ({@link conferenciaDoAluguel}).
 */
export const VARIAVEIS_DE_ALUGUEL: readonly VariavelDeAluguel[] = [
  {
    chave: "aluguel",
    rotulo: "Aluguel do implemento",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.custo_aluguel" },
    ajuda:
      "O que se paga por mês pelo implemento que a frota aluga em vez de " +
      "financiar. Confirmado BRL/MENSAL pela curadoria, por base aritmética: é a " +
      "terceira parcela de `finame_implemento`, e nos alugados é a parcela inteira.",
  },
] as const;

/**
 * As variáveis que só o detalhe mostra.
 *
 * Uma: a coluna de aluguel do **cavalo**. Ela é zero nas 558 linhas do acervo e
 * a semântica dela é presumida, não confirmada — mas ela existe no export, e
 * quem confere a planilha vai encontrá-la. Aparece dita por extenso, e fora de
 * toda soma, pela mesma decisão que `seguro.ts` tomou para o rastreador.
 */
export const VARIAVEIS_DE_DETALHE_DE_ALUGUEL: readonly VariavelDeAluguel[] = [
  {
    chave: "aluguel_cavalo",
    rotulo: "Aluguel do cavalo",
    medida: "DINHEIRO",
    codigo: { CAVALO: "cavalo.custo_aluguel" },
    foraDaSoma:
      "Zero em 558 de 558 linhas do acervo, e com semântica **presumida**, não " +
      "confirmada. É coluna sem dado, não aluguel de graça — e a identidade do " +
      "cavalo (`finame_cavalo = amortização + juros + lucro fixo`) não tem lugar " +
      "para ela. Somá-la afirmaria que alugar cavalo custa R$ 0,00.",
    ajuda:
      "A frota deste acervo não aluga cavalo. A coluna aparece para que quem " +
      "confere a planilha a encontre aqui, com a razão de ela não contar.",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_ALUGUEL, ...VARIAVEIS_DE_DETALHE_DE_ALUGUEL];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeAluguel(variaveis: readonly VariavelDeAluguel[]): string[] {
  const codigos = new Set<string>();
  for (const v of variaveis) {
    if (v.codigo.CAVALO) codigos.add(v.codigo.CAVALO);
    if (v.codigo.CARRETA) codigos.add(v.codigo.CARRETA);
  }
  return [...codigos].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_ALUGUEL = codigosDeAluguel(VARIAVEIS_DE_ALUGUEL);

/** O recorte do detalhe: tudo, inclusive a coluna que não soma. */
export const CODIGOS_DO_DETALHE_DE_ALUGUEL = codigosDeAluguel(TODAS);

/**
 * Os códigos de um recorte de equipamento — `TODOS`, `CAVALO` ou `CARRETA`.
 *
 * Existe pela mesma razão que nas irmãs: a leitura ponta a ponta só aceita lista
 * de atributos, e ela precisa responder pelo mesmo recorte que a aba aberta.
 */
export function codigosDoRecorteDeAluguel(
  recorte: "TODOS" | "CAVALO" | "CARRETA",
  variaveis: readonly VariavelDeAluguel[] = VARIAVEIS_DE_ALUGUEL,
): string[] {
  if (recorte === "TODOS") return codigosDeAluguel(variaveis);
  const codigos = new Set<string>();
  for (const v of variaveis) {
    const codigo = v.codigo[recorte];
    if (codigo) codigos.add(codigo);
  }
  return [...codigos].sort();
}

const POR_CODIGO = new Map<string, VariavelDeAluguel>();
for (const v of TODAS) {
  if (v.codigo.CAVALO) POR_CODIGO.set(v.codigo.CAVALO, v);
  if (v.codigo.CARRETA) POR_CODIGO.set(v.codigo.CARRETA, v);
}

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeAluguelDoCodigo(
  code: string | null,
): VariavelDeAluguel | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

/** O código que um tipo de equipamento usa para uma variável, quando existe. */
export function codigoDaVariavelDeAluguel(
  variavel: VariavelDeAluguel,
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
export interface LinhaDeAluguel {
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
  estado: EstadoDaLinhaDeAluguel;
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
 * Devolve `null` para o que não é de aluguel — a função é o filtro e o tradutor
 * ao mesmo tempo, de modo que nenhuma tela precise saber quais são os códigos.
 */
export function linhaDeAluguelDaAlteracao(a: AlteracaoDoMotor): LinhaDeAluguel | null {
  const variavel = variavelDeAluguelDoCodigo(a.attributeCode);
  if (!variavel) {
    /* Entrada e saída de ativo não citam atributo: o motor as grava uma vez por
       veículo. Nesta rubrica elas importam duas vezes — um implemento alugado
       que entra traz um custo mensal novo, e um que sai leva embora um. */
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

/** As linhas de aluguel de uma lista de alterações, na ordem em que vieram. */
export function linhasDeAluguel(
  alteracoes: readonly AlteracaoDoMotor[],
): LinhaDeAluguel[] {
  const linhas: LinhaDeAluguel[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeAluguelDaAlteracao(a);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/**
 * Um par de valores iguais virando linha — o alternador "sem alteração".
 *
 * Nesta rubrica ele tem um papel que as irmãs não têm: a frota alugada é uma
 * minoria, e a lista de alterações pode estar vazia num par em que **existem**
 * implementos alugados. Ligado, o alternador mostra quais são e quanto custam.
 */
export function linhaDeAluguelSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeAluguel | null {
  const variavel = variavelDeAluguelDoCodigo(par.attributeCode);
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
export interface ImpactoDeAluguel {
  /**
   * Um número por periodicidade, **nunca um total único**.
   *
   * O balde desta rubrica é `MENSAL`, confirmado pela curadoria. Ele não se soma
   * ao `PONTUAL` da aquisição nem ao `ANUAL` do IPVA, e anualizar é decisão de
   * quem lê.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar, com motivo próprio. */
  naoCalculavel: number;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /**
   * Quantos aluguéis mudaram de valor.
   *
   * Contado à parte do total em reais porque as duas leituras respondem
   * perguntas diferentes: "quanto isto custou a mais no mês" e "em quantos
   * contratos alguém mexeu".
   */
  alugueisAlterados: number;
}

/**
 * O impacto do recorte de aluguel, por periodicidade.
 *
 * ---------------------------------------------------------------------------
 * As três recusas
 * ---------------------------------------------------------------------------
 * **Não soma periodicidades diferentes.** Cada balde é uma periodicidade, como
 * `resumirImpacto` já faz para o produto inteiro.
 *
 * **Não vê a parcela FINAME.** Ela contém este aluguel nos implementos alugados,
 * e somar as duas seria contar o mesmo dinheiro duas vezes — por isso ela não é
 * variável deste catálogo (é lida só para a conferência). Do outro lado, a regra
 * de parcelas do FINAME tira a parcela do total de lá quando o aluguel se move.
 *
 * **Não soma o aluguel do cavalo.** Zero em todas as linhas e com semântica
 * presumida: um total que o inclui afirma que alugar cavalo custa R$ 0,00.
 */
export function impactoDeAluguel(linhas: readonly LinhaDeAluguel[]): ImpactoDeAluguel {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;
  let alugueisAlterados = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;
    if (l.variavel === "aluguel") alugueisAlterados++;

    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    if (!l.impactoCalculado || l.impactoAmount === null) {
      /* Só conta como "não precificado" o que era candidato a dinheiro. */
      if (l.medida === "DINHEIRO") naoCalculavel++;
      continue;
    }

    const balde = l.impactoPeriodicidade ?? "SEM_PERIODICIDADE";
    porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + l.impactoAmount;
  }

  for (const balde of Object.keys(porPeriodicidade)) {
    porPeriodicidade[balde] = Number(porPeriodicidade[balde].toFixed(6));
  }
  return { porPeriodicidade, naoCalculavel, foraDaSoma, alugueisAlterados };
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos veículos cada vigência entregou — vem da contagem do motor. */
export interface FrotaDoParDeAluguel {
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeAluguel {
  veiculosComparados: number;
  semAlteracao: number;
  veiculosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  variaveisAlteradas: number;
  veiculosComDadoIncompleto: number;
  veiculosComConflito: number;
  impacto: ImpactoDeAluguel;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `frota` vem do motor porque **esta lista não sabe** quantos veículos não
 * mudaram: um veículo sem alteração nenhuma não produz linha.
 */
export function resumirAluguel(
  linhas: readonly LinhaDeAluguel[],
  frota: FrotaDoParDeAluguel,
): ResumoDeAluguel {
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

  /* "Sem alteração" é o que nenhuma linha tocou — a mesma regra do FINAME. */
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
    impacto: impactoDeAluguel(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeAluguel {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeAluguel(
  linhas: readonly LinhaDeAluguel[],
): AlteracoesDaVariavelDeAluguel[] {
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
export interface FatiaDeEstadoDeAluguel {
  estado: EstadoDaLinhaDeAluguel;
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
export function distribuicaoPorEstadoDeAluguel(
  linhas: readonly LinhaDeAluguel[],
  frota: FrotaDoParDeAluguel,
): FatiaDeEstadoDeAluguel[] {
  const pior = new Map<string, EstadoDaLinhaDeAluguel>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeAluguel, number>();
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
// Os totais e a conferência da parcela
// ---------------------------------------------------------------------------

/** Um ativo lido de uma das duas vigências, para as duas leituras próprias. */
export interface ValorDeAluguel {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  entityLabel: string | null;
  /** O aluguel mensal declarado. Nulo quando a vigência não o trouxe. */
  aluguel: number | null;
  /** A parcela FINAME do mesmo implemento — o que confere o aluguel. */
  parcela: number | null;
  /** A amortização do mesmo implemento. Zero nos alugados. */
  amortizacao: number | null;
  /** Os juros do mesmo implemento. Zero nos alugados. */
  juros: number | null;
}

/** Um ponto do gráfico "aluguel por vigência". */
export interface TotalDeAluguelDaVigencia {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  /** A soma dos aluguéis do recorte, por mês. */
  total: number;
  /** Quantos ativos o recorte leu. */
  ativos: number;
  /** Quantos deles declaram aluguel — a frota alugada. */
  alugados: number;
  /** A fração alugada da frota lida. `0.025` para 2,5%. */
  fracaoAlugada: number;
}

/**
 * O aluguel somado de cada ponta, por tipo de equipamento.
 *
 * **É mensal, e o rótulo da tela diz isso.** O número é o que a frota alugada
 * custa por mês naquela vigência — não no ano, não no contrato.
 *
 * A fração alugada viaja junto porque o total sozinho não se lê: R$ 11.777,92
 * pode ser duas carretas de oitenta ou vinte de oitenta, e as duas leituras
 * pedem conversas diferentes com o cliente.
 */
export function totaisDeAluguelPorVigencia(
  valores: readonly ValorDeAluguel[],
): TotalDeAluguelDaVigencia[] {
  const acumulado = new Map<
    string,
    { ponta: "BASE" | "COMPARADA"; entityType: string; total: number; ativos: number; alugados: number }
  >();
  for (const v of valores) {
    const chave = `${v.ponta}${v.entityType}`;
    const atual =
      acumulado.get(chave) ??
      { ponta: v.ponta, entityType: v.entityType, total: 0, ativos: 0, alugados: 0 };
    atual.ativos += 1;
    if (v.aluguel !== null && v.aluguel > 0) {
      atual.total += v.aluguel;
      atual.alugados += 1;
    }
    acumulado.set(chave, atual);
  }
  return [...acumulado.values()]
    .map((t) => ({
      ...t,
      total: Number(t.total.toFixed(2)),
      fracaoAlugada: t.ativos === 0 ? 0 : t.alugados / t.ativos,
    }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

/**
 * O que a conferência da parcela revela sobre a frota alugada de uma ponta.
 *
 * `ALUGUEL_INTEGRAL` é o que o acervo entrega hoje, e é o esperado: no implemento
 * alugado não há financiamento, então amortização e juros são zero e a parcela
 * FINAME **é** o aluguel, ao centavo.
 *
 * `MISTO` é o veredito que mais importa e o menos provável: um implemento que
 * declarasse aluguel **e** financiamento ao mesmo tempo. Se aparecer, nenhum
 * total desta casa pode ser lido sem olhar placa a placa — porque a parcela
 * deixaria de ser explicada pelas três partes de um jeito só.
 */
export type VereditoDoAluguel =
  | "ALUGUEL_INTEGRAL"
  | "MISTO"
  | "SEM_ALUGUEL"
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DO_ALUGUEL: Record<VereditoDoAluguel, string> = {
  ALUGUEL_INTEGRAL: "A parcela é o aluguel",
  MISTO: "Aluguel e financiamento no mesmo ativo",
  SEM_ALUGUEL: "Nenhum implemento alugado",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/** A conferência da parcela numa ponta, por tipo de equipamento. */
export interface ConferenciaDoAluguel {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  veredito: VereditoDoAluguel;
  /** Quantos ativos declaram aluguel nesta ponta. */
  alugados: number;
  /** Em quantos deles a parcela FINAME é exatamente o aluguel. */
  parcelaEhOAluguel: number;
  /** Quantos declaram aluguel **e** amortização ou juros — os mistos. */
  mistos: number;
  /** Quanto os alugados somam por mês nesta ponta. */
  totalMensal: number;
}

/**
 * A conferência é feita em **centavos**, e não em reais.
 *
 * "Tolerância de um centavo" comparada em ponto flutuante não tolera um centavo:
 * `Math.abs(5363.56 - 5363.55)` vale `0.010000000000218` em IEEE 754, que é
 * maior do que `0.01` — e um implemento que fecha por arredondamento apareceria
 * como "misto", que é o veredito mais grave desta tela.
 *
 * Arredondar os dois lados para centavos antes de subtrair é o que faz a regra
 * escrita ser a regra aplicada. O defeito apareceu no teste desta função, e não
 * na tela.
 */
const centavos = (valor: number) => Math.round(valor * 100);

/** Diferença máxima, em centavos, para um total e as partes dele serem iguais. */
const TOLERANCIA_EM_CENTAVOS = 1;

/**
 * A parcela dos implementos alugados, conferida por ponta e por tipo.
 *
 * Só olha quem declara aluguel: perguntar "a parcela é o aluguel?" sobre um
 * implemento financiado seria cobrar uma identidade que não é a dele.
 */
export function conferenciaDoAluguel(
  valores: readonly ValorDeAluguel[],
): ConferenciaDoAluguel[] {
  const grupos = new Map<string, ValorDeAluguel[]>();
  for (const v of valores) {
    const chave = `${v.ponta}${v.entityType}`;
    const lista = grupos.get(chave) ?? [];
    lista.push(v);
    grupos.set(chave, lista);
  }

  return [...grupos.values()]
    .map((lista) => {
      const ponta = lista[0].ponta;
      const entityType = lista[0].entityType;
      const alugados = lista.filter((v) => v.aluguel !== null && v.aluguel > 0);

      let parcelaEhOAluguel = 0;
      let mistos = 0;
      let totalMensal = 0;
      for (const v of alugados) {
        totalMensal += v.aluguel ?? 0;
        const financiamento = centavos((v.amortizacao ?? 0) + (v.juros ?? 0));
        if (financiamento > TOLERANCIA_EM_CENTAVOS) mistos++;
        if (
          v.parcela !== null &&
          Math.abs(centavos(v.parcela) - centavos(v.aluguel ?? 0)) <= TOLERANCIA_EM_CENTAVOS
        ) {
          parcelaEhOAluguel++;
        }
      }

      let veredito: VereditoDoAluguel;
      if (lista.length === 0) veredito = "BASE_INSUFICIENTE";
      else if (alugados.length === 0) veredito = "SEM_ALUGUEL";
      else if (mistos > 0) veredito = "MISTO";
      else if (parcelaEhOAluguel === alugados.length) veredito = "ALUGUEL_INTEGRAL";
      else veredito = "MISTO";

      return {
        ponta,
        entityType,
        veredito,
        alugados: alugados.length,
        parcelaEhOAluguel,
        mistos,
        totalMensal: Number(totalMensal.toFixed(2)),
      };
    })
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_ALUGUEL = [
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
 * separador do arquivo; quem escreve o CSV é `lib/csv.ts`, no cliente.
 *
 * O aviso da linha que não soma viaja junto, e existe no arquivo justamente
 * porque o arquivo sai do produto e vira soma na planilha de outra pessoa: um
 * CSV que entrega o aluguel e a parcela FINAME lado a lado, sem dizer que a
 * segunda contém o primeiro, é a forma mais fácil de dobrar o custo da frota
 * alugada numa célula do Excel.
 */
export function celulasDoCsvDeAluguel(
  l: LinhaDeAluguel,
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

/** Um veículo da tabela de aluguel: a placa, o que ela moveu, e as linhas. */
export type VeiculoDeAluguel = VeiculoDaRubrica<LinhaDeAluguel>;

/**
 * A ordem em que a expansão lê as variáveis de uma placa, e quem é o destaque.
 *
 * O destaque é o aluguel — **uma** variável, e nunca a soma com a parcela, que o
 * contém. `veiculo` vem antes de tudo e fica fora da contagem, para que uma
 * placa que só entrou na frota não apareça com "1 alteração".
 */
export const AGRUPAMENTO_DE_ALUGUEL = {
  ordemDasVariaveis: ["veiculo", ...TODAS.map((v) => v.chave)],
  destaque: "aluguel",
  foraDaContagem: ["veiculo"],
} as const satisfies OpcoesDoAgrupamento;

/**
 * As linhas viradas uma linha por placa.
 *
 * **Não recalcula nada.** Contagem, estado e destaque saem das linhas que o
 * motor já produziu; o que a função faz é juntar por `(placa, tipo)` e ordenar.
 */
export function agruparPorVeiculoDeAluguel(
  linhas: readonly LinhaDeAluguel[],
): VeiculoDeAluguel[] {
  return agruparVeiculos(linhas, AGRUPAMENTO_DE_ALUGUEL);
}
