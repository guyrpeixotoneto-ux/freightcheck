/**
 * A AUDITORIA DE SEGURO E APARATO — o que se paga por equipar a carreta.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e o que ele não é
 * ---------------------------------------------------------------------------
 * Ele **não compara nada**, pela mesma razão que `finame.ts` e `ipva.ts` não
 * comparam: comparar duas vigências veículo a veículo, atributo a atributo, é o
 * que `engine.ts` faz desde sempre. E ele **não traduz o motor de novo**: os
 * seis estados, a forma da alteração e a ordem de gravidade vêm de
 * `recorte-de-rubrica.ts`. "Conflito" aqui é, por construção, o mesmo
 * "Conflito" das outras rubricas.
 *
 * O que é próprio deste arquivo são três coisas, todas puras: dizer quais
 * atributos são desta rubrica, agregar os indicadores do topo, e medir o que
 * fica **fora** do custo fixo que o próprio export declara.
 *
 * ---------------------------------------------------------------------------
 * O achado que deu origem a esta tela
 * ---------------------------------------------------------------------------
 * **Nenhuma destas cinco colunas entra no `carreta.custo_fixo`.** Medido nas
 * 657 linhas do acervo: `carreta.custo_fixo` é, ao centavo e em **657 de 657**,
 * `carreta.finame` + `carreta.lucro_fixomodelo_novo_ciclo`. Some-se o aparato a
 * essa conta e ela deixa de fechar em **657 de 657**.
 *
 * Ou seja: entre R$ 391,81 e R$ 1.104,53 por carreta, por vigência, existem na
 * planilha, aparecem na tela de Custo Fixo Total do Freightech — onde
 * SEGURO, RASTREADOR, FAIXAREFLEXIVA, TACOGRAFO e REVESTIMENTO são colunas,
 * batendo por **valor** com o nosso export (ver `catalogo.ts`) — e não estão em
 * nenhum total que o acervo entrega. Esta tela existe para que esse dinheiro
 * tenha onde ser lido.
 *
 * ---------------------------------------------------------------------------
 * As três coisas que o dado real obrigou a escrever
 * ---------------------------------------------------------------------------
 * 1. **A rubrica é só da carreta.** O cavalo não declara nenhuma das cinco
 *    colunas — não é que venham zeradas, é que não existem. Por isso nenhuma
 *    variável tem `codigo.CAVALO`, e a aba Cavalo desta tela abre vazia dizendo
 *    isso. Emparelhar com uma coluna do cavalo porque o nome se pareceria é o
 *    erro que `docs/ACHADO-IPVA.md` já mediu numa rubrica vizinha.
 *
 * 2. **O rastreador é coluna sem dado, e não rastreador de graça.** Zero nas
 *    657 linhas, nas duas pontas, em todas as vigências — a mesma espécie do
 *    montante de ICMS em `impostos.ts`. Ele fica na tabela, marcado, porque
 *    escondê-lo apagaria o achado; e fica fora da soma, porque um total que o
 *    inclui afirma que rastrear custa R$ 0,00.
 *
 * 3. **Três das cinco são taxa, e não preço por ativo.** `revestimento` é
 *    277,94 nas 657; `faixa_reflexiva` é 15,94 nas 657; `tacografo` é 21,03 em
 *    558 e 0 em 99. Só `seguro` varia de verdade — 38 valores distintos, de
 *    R$ 97,93 a R$ 789,62 —, e é por isso que ele é o destaque da placa: é a
 *    única das cinco em que uma diferença entre vigências diz algo sobre
 *    *aquela* carreta, e não sobre a tabela inteira.
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
export type EstadoDaLinhaDeSeguro = EstadoDaLinha;

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * Uma variável desta rubrica, com o código que cada equipamento usa.
 *
 * `codigo.CAVALO` está ausente em **todas** — e isso é o dado, não um descuido:
 * o `Modelo_Cavalo` não tem coluna de seguro, rastreador, tacógrafo,
 * revestimento nem faixa refletiva. Ausente quer dizer que aquele tipo não tem
 * esta variável, nunca que ela caia num código parecido.
 */
export interface VariavelDeSeguro {
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
 * As variáveis do aparato, na ordem em que a tela as lê.
 *
 * Começa no seguro — a única que varia por ativo, e por isso a que resume a
 * placa — e segue pelas taxas, da maior para a menor. O rastreador vem por
 * último entre as monetárias porque é o que não tem valor nenhum: pô-lo no topo
 * daria destaque de tela ao que não tem número.
 */
export const VARIAVEIS_DE_SEGURO: readonly VariavelDeSeguro[] = [
  {
    chave: "seguro",
    rotulo: "Seguro",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.seguro" },
    ajuda:
      "A única das cinco que varia por ativo: 38 valores distintos no acervo, de " +
      "R$ 97,93 a R$ 789,62. É por isso que é ela que resume a placa — uma diferença " +
      "aqui fala daquela carreta, e não da tabela inteira.",
  },
  {
    chave: "revestimento",
    rotulo: "Revestimento",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.revestimento" },
    ajuda:
      "R$ 277,94 nas 657 linhas do acervo — taxa por ativo, e não preço negociado. " +
      "Bate por valor com a coluna REVESTIMENTO da tela de Custo Fixo Total do " +
      "Freightech, que mostra 277,939 nas quatro linhas dela.",
  },
  {
    chave: "tacografo",
    rotulo: "Tacógrafo",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.tacografo" },
    ajuda:
      "R$ 21,03 em 558 linhas e R$ 0,00 em 99. O zero aqui é o único dos cinco que " +
      "convive com valor na mesma coluna — e por isso é ele, e não a coluna, que a " +
      "tela mostra: a carreta sem tacógrafo tarifado é um caso, não uma ausência de dado.",
  },
  {
    chave: "faixa_reflexiva",
    rotulo: "Faixa refletiva",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.faixa_reflexiva" },
    ajuda:
      "R$ 15,94 nas 657 linhas — a menor das taxas, e constante. Bate por valor com " +
      "a coluna FAIXAREFLEXIVA do Freightech (15,943).",
  },
  {
    chave: "rastreador",
    rotulo: "Rastreador",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.rastreador" },
    foraDaSoma:
      "Zero nas 657 linhas do acervo, nas duas pontas e em todas as vigências. É " +
      "coluna sem dado, não rastreamento gratuito: a coluna existe, é declarada, e o " +
      "dinheiro correspondente nunca foi preenchido. Somá-la daria um total que " +
      "afirma que rastrear custa R$ 0,00 — a mesma recusa que o montante de ICMS " +
      "recebe em impostos.ts.",
    ajuda:
      "A tela de Custo Fixo Total do Freightech também mostra RASTREADOR zerado nas " +
      "quatro linhas dela. Os dois lados dizem a mesma coisa: ninguém preencheu.",
  },
] as const;

/**
 * As variáveis que só o detalhe mostra — as duas que falam de **total**.
 *
 * Elas não são desta rubrica: estão aqui porque é aqui que se descobre que o
 * aparato não cabe nelas, e tirá-las da tela deixaria a afirmação sem a prova
 * ao lado.
 */
export const VARIAVEIS_DE_DETALHE_DE_SEGURO: readonly VariavelDeSeguro[] = [
  {
    chave: "custo_fixo",
    rotulo: "Custo fixo do conjunto",
    medida: "DINHEIRO",
    codigo: { CARRETA: "carreta.custo_fixo" },
    foraDaSoma:
      "É total, e não parcela: em 657 de 657 linhas do acervo, ao centavo, " +
      "`carreta.custo_fixo` = `carreta.finame` + `carreta.lucro_fixomodelo_novo_ciclo`. " +
      "Somá-lo com qualquer coisa contaria o mesmo dinheiro duas vezes — a mesma " +
      "espécie do total composto do FINAME (docs/ACHADO-FINAME-TOTAL-COMPOSTO.md). E " +
      "nenhuma das cinco colunas desta tela está dentro dele: acrescente o aparato à " +
      "conta e ela deixa de fechar nas 657.",
    ajuda:
      "Está no detalhe para que a afirmação desta tela possa ser conferida na própria " +
      "tela: é este o total que não contém o aparato.",
  },
  {
    chave: "custo_aluguel",
    rotulo: "Custo de aluguel",
    medida: "DINHEIRO",
    codigo: { CAVALO: "cavalo.custo_aluguel", CARRETA: "carreta.custo_aluguel" },
    foraDaSoma:
      "Zero em todas as linhas do cavalo e em 633 das 657 da carreta. As 18 que não " +
      "são zero são frota alugada, que é outro contrato e outra pergunta — somá-la ao " +
      "aparato misturaria quem se equipa com quem se aluga.",
    ajuda:
      "A única coluna desta tela que o cavalo também declara — e ele a declara zerada " +
      "em todas as linhas.",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_SEGURO, ...VARIAVEIS_DE_DETALHE_DE_SEGURO];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeSeguro(variaveis: readonly VariavelDeSeguro[]): string[] {
  const codigos = new Set<string>();
  for (const v of variaveis) {
    if (v.codigo.CAVALO) codigos.add(v.codigo.CAVALO);
    if (v.codigo.CARRETA) codigos.add(v.codigo.CARRETA);
  }
  return [...codigos].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_SEGURO = codigosDeSeguro(VARIAVEIS_DE_SEGURO);

/**
 * Os códigos de um recorte de equipamento — `TODOS`, `CAVALO` ou `CARRETA`.
 *
 * Existe porque nem toda leitura aceita recortar por `entity_type`: a Evolução
 * por Placa aceita (`tipo`), mas a leitura ponta a ponta só aceita uma lista de
 * atributos, e as duas precisam responder pelo mesmo recorte.
 *
 * Aqui ele devolve **lista vazia para `CAVALO`**, e isso é a resposta certa: o
 * cavalo não tem nenhuma variável desta rubrica. Quem chama lê a lista vazia
 * como "não há o que pedir", e não como "peça tudo".
 */
export function codigosDoRecorteDeSeguro(
  recorte: "TODOS" | "CAVALO" | "CARRETA",
  variaveis: readonly VariavelDeSeguro[] = VARIAVEIS_DE_SEGURO,
): string[] {
  if (recorte === "TODOS") return codigosDeSeguro(variaveis);
  const codigos = new Set<string>();
  for (const v of variaveis) {
    const codigo = v.codigo[recorte];
    if (codigo) codigos.add(codigo);
  }
  return [...codigos].sort();
}

/** O recorte do detalhe: tudo, inclusive os dois totais que não somam. */
export const CODIGOS_DO_DETALHE_DE_SEGURO = codigosDeSeguro(TODAS);

const POR_CODIGO = new Map<string, VariavelDeSeguro>();
for (const v of TODAS) {
  if (v.codigo.CAVALO) POR_CODIGO.set(v.codigo.CAVALO, v);
  if (v.codigo.CARRETA) POR_CODIGO.set(v.codigo.CARRETA, v);
}

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeSeguroDoCodigo(
  code: string | null,
): VariavelDeSeguro | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

/** O código que um tipo de equipamento usa para uma variável, quando existe. */
export function codigoDaVariavelDeSeguro(
  variavel: VariavelDeSeguro,
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
export interface LinhaDeSeguro {
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
  estado: EstadoDaLinhaDeSeguro;
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
 * As colunas que não somam **não** são barradas aqui: elas são o achado desta
 * tela, e escondê-las seria apagá-lo. Passam marcadas, e quem soma
 * ({@link impactoDeSeguro}) as recusa pelo `foraDaSoma`.
 */
export function linhaDeSeguroDaAlteracao(a: AlteracaoDoMotor): LinhaDeSeguro | null {
  const variavel = variavelDeSeguroDoCodigo(a.attributeCode);
  /*
    Entrada e saída de ativo não citam atributo: o motor as grava uma vez por
    veículo, no eixo da frota, e não uma vez por coluna. Elas entram na tabela
    como a linha do veículo inteiro, com a variável em branco — sumir com elas
    seria esconder a metade mais visível do que mudou na frota.
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
export function linhasDeSeguro(
  alteracoes: readonly AlteracaoDoMotor[],
): LinhaDeSeguro[] {
  const linhas: LinhaDeSeguro[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeSeguroDaAlteracao(a);
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
 *
 * Nesta rubrica elas são quase tudo: três das cinco colunas são taxa fixa, e
 * uma comparação em que nada se moveu é o resultado esperado. A tela desligada
 * do alternador diria "nada mudou" e pararia aí; ligada, ela mostra **quanto** é
 * o aparato de cada carreta, que é a outra metade da pergunta.
 */
export function linhaDeSeguroSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeSeguro | null {
  const variavel = variavelDeSeguroDoCodigo(par.attributeCode);
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
export interface ImpactoDeSeguro {
  /**
   * Um número por periodicidade, **nunca um total único**.
   *
   * Mensal e anual não se somam, e a regra vale aqui como vale no produto
   * inteiro. Anualizar é decisão de quem lê, não deste módulo.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar. */
  naoCalculavel: number;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /**
   * Alterações numa das três colunas que são **taxa**, e não preço por ativo.
   *
   * Revestimento, faixa refletiva e tacógrafo têm um valor só para a frota
   * inteira. Quando um deles se move, não se moveu uma carreta: mudou a tabela,
   * e o mesmo delta aparece em todas as placas de uma vez. Contá-las à parte é o
   * que impede alguém de ler "657 alterações" como 657 negociações.
   */
  alteracoesDeTaxa: number;
}

/**
 * Por que esta rubrica pode não publicar dinheiro — a frase, escrita uma vez.
 *
 * Ela não descreve um defeito nem uma conta que deu zero: descreve o portão da
 * curadoria (`viraDinheiro`) recusando somar o que não foi confirmado. Hoje
 * `carreta.seguro` está PRESUMED, e por isso uma carreta pode ir de R$ 180,79 a
 * R$ 631,41 sem que um real apareça em `porPeriodicidade` — o `naoCalculavel`
 * conta essas alterações, e é ele que manda esta frase ao lugar onde o dinheiro
 * estaria.
 *
 * É a irmã de `SEM_IMPACTO_FINANCEIRO` (QLP) e de `SEM_IMPACTO_DE_TMA`, e é
 * própria porque a razão é outra: lá a rubrica inteira não mede dinheiro; aqui
 * ela mede, e a curadoria ainda não confirmou o que estas colunas são. No dia
 * em que confirmar, a frase deixa de ser usada sozinha — ninguém precisa mexer
 * nela, nem em quem a escolhe.
 */
export const SEM_IMPACTO_PRECIFICAVEL_DE_SEGURO =
  "O aparato se moveu, e nenhuma das colunas monetárias desta rubrica tem " +
  "semântica confirmada pela curadoria — somar o que ela não confirmou seria " +
  "adivinhação. Esta comparação conta o que mudou, coluna a coluna, e não " +
  "publica dinheiro enquanto a confirmação não vier.";

/**
 * O impacto do recorte, por periodicidade e sem somar o que não se explica.
 *
 * **Não soma periodicidades diferentes.** Cada balde é uma periodicidade.
 *
 * **Não soma o rastreador nem os dois totais.** O primeiro é coluna sem dado; o
 * `custo_fixo` é composto e já contém FINAME e lucro fixo; o `custo_aluguel` é
 * outro contrato. Os três saem pelo `foraDaSoma`.
 *
 * **Não confunde taxa com preço.** As três taxas entram na soma — o dinheiro é
 * real e sai do mesmo bolso —, mas são contadas à parte, porque uma alteração
 * de tabela e uma renegociação de seguro não querem dizer a mesma coisa.
 */
export function impactoDeSeguro(linhas: readonly LinhaDeSeguro[]): ImpactoDeSeguro {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;
  let alteracoesDeTaxa = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;

    if (TAXAS.has(l.variavel)) alteracoesDeTaxa++;

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
  return { porPeriodicidade, naoCalculavel, foraDaSoma, alteracoesDeTaxa };
}

/**
 * As três colunas que têm um valor só para a frota inteira.
 *
 * Medido no acervo: `revestimento` 277,94 nas 657; `faixa_reflexiva` 15,94 nas
 * 657; `tacografo` 21,03 em 558 e 0 em 99 — dois valores, e nenhum deles
 * negociado por placa. O seguro fica de fora desta lista porque é o oposto
 * disso: 38 valores distintos.
 */
const TAXAS = new Set(["revestimento", "faixa_reflexiva", "tacografo"]);

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos veículos cada vigência entregou — vem da contagem do motor. */
export interface FrotaDoParDeSeguro {
  /** Veículos presentes nas duas vigências. */
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeSeguro {
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
  impacto: ImpactoDeSeguro;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `frota` vem do motor porque **esta lista não sabe** quantos veículos não
 * mudaram: um veículo sem nenhuma alteração não produz linha nenhuma. Derivar
 * "sem alteração" do tamanho da lista daria zero numa comparação em que nada
 * mudou — que nesta rubrica é o caso comum, e justamente quando o número
 * importa.
 */
export function resumirSeguro(
  linhas: readonly LinhaDeSeguro[],
  frota: FrotaDoParDeSeguro,
): ResumoDeSeguro {
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
    dois números.
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
    impacto: impactoDeSeguro(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeSeguro {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeSeguro(
  linhas: readonly LinhaDeSeguro[],
): AlteracoesDaVariavelDeSeguro[] {
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
export interface FatiaDeEstadoDeSeguro {
  estado: EstadoDaLinhaDeSeguro;
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
export function distribuicaoPorEstadoDeSeguro(
  linhas: readonly LinhaDeSeguro[],
  frota: FrotaDoParDeSeguro,
): FatiaDeEstadoDeSeguro[] {
  const pior = new Map<string, EstadoDaLinhaDeSeguro>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeSeguro, number>();
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
// Os totais por vigência — o gráfico, e o número que ninguém tinha
// ---------------------------------------------------------------------------

/**
 * O aparato de um ativo numa ponta, coluna a coluna — e as parcelas do total.
 *
 * As três últimas não são desta rubrica: são o que permite **medir** se o
 * aparato cabe no custo fixo que o export declara, em vez de afirmar que não
 * cabe. Ver {@link conferenciaDoAparato}.
 */
export interface ValorDeSeguro {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  entityLabel: string | null;
  seguro: number | null;
  revestimento: number | null;
  tacografo: number | null;
  faixaReflexiva: number | null;
  rastreador: number | null;
  /** O custo fixo que o export declara para este ativo. */
  custoFixo: number | null;
  /** A parcela de FINAME do conjunto, que compõe o custo fixo declarado. */
  finame: number | null;
  /** A parcela de lucro fixo do conjunto, a outra metade do custo fixo. */
  lucroFixoConjunto: number | null;
}

/** Um ponto do gráfico "aparato total por vigência". */
export interface TotalDeSeguroDaVigencia {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  /** A soma das quatro colunas que têm valor. O rastreador não entra. */
  total: number;
  /** Só o seguro — a parte que é negociada por ativo. */
  seguro: number;
  /** Revestimento + faixa refletiva + tacógrafo: o que é tabela. */
  taxas: number;
  /** Quantos ativos sustentam o total. */
  veiculos: number;
  /**
   * Quantos deles declararam tacógrafo zerado.
   *
   * É o único zero desta rubrica que convive com valor na mesma coluna, e por
   * isso o único que merece contagem: 99 das 657 no acervo.
   */
  semTacografo: number;
}

/**
 * O aparato total de cada ponta, por tipo de equipamento.
 *
 * **O rastreador fica fora do total.** Somá-lo não mudaria o número — ele é zero
 * em toda parte — e mudaria o que o número afirma: um total que o inclui diz que
 * o rastreamento está contado, e ele não está.
 *
 * **Seguro e taxas saem separados**, e não só somados, porque são duas
 * naturezas: um sobe quando a seguradora reajusta aquela carreta; os outros
 * sobem quando a tabela muda para todas. Um total único esconderia qual dos dois
 * se moveu.
 *
 * Os valores vêm da leitura das duas vigências, não do change set, porque um
 * total tem de incluir quem não mudou — e nesta rubrica quase ninguém muda.
 */
export function totaisDeSeguroPorVigencia(
  valores: readonly ValorDeSeguro[],
): TotalDeSeguroDaVigencia[] {
  const acumulado = new Map<string, TotalDeSeguroDaVigencia>();
  for (const v of valores) {
    const chave = `${v.ponta}${v.entityType}`;
    const atual =
      acumulado.get(chave) ??
      ({
        ponta: v.ponta,
        entityType: v.entityType,
        total: 0,
        seguro: 0,
        taxas: 0,
        veiculos: 0,
        semTacografo: 0,
      } as TotalDeSeguroDaVigencia);

    const taxas = (v.revestimento ?? 0) + (v.faixaReflexiva ?? 0) + (v.tacografo ?? 0);
    atual.seguro += v.seguro ?? 0;
    atual.taxas += taxas;
    atual.total += (v.seguro ?? 0) + taxas;
    atual.veiculos += 1;
    if (v.tacografo === 0) atual.semTacografo += 1;
    acumulado.set(chave, atual);
  }

  return [...acumulado.values()]
    .map((t) => ({
      ...t,
      total: Number(t.total.toFixed(2)),
      seguro: Number(t.seguro.toFixed(2)),
      taxas: Number(t.taxas.toFixed(2)),
    }))
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// A conferência que dá nome à tela: o aparato cabe no custo fixo declarado?
// ---------------------------------------------------------------------------

/** O que a conferência de uma ponta revela sobre o custo fixo declarado. */
export type VereditoDoAparato =
  /** O aparato está inteiramente fora do `custo_fixo` — o caso do acervo. */
  | "FORA_DO_TOTAL"
  /** O `custo_fixo` contém o aparato em todos os ativos medidos. */
  | "DENTRO_DO_TOTAL"
  /** Uns sim, outros não — o que seria pior do que qualquer um dos dois. */
  | "MISTO"
  /** Não há ativo com as três parcelas preenchidas para medir. */
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DO_APARATO: Record<VereditoDoAparato, string> = {
  FORA_DO_TOTAL: "Fora do custo fixo declarado",
  DENTRO_DO_TOTAL: "Dentro do custo fixo declarado",
  MISTO: "Dentro em alguns ativos, fora em outros",
  BASE_INSUFICIENTE: "Sem base para medir",
};

/** O resultado da conferência numa ponta e num tipo de equipamento. */
export interface ConferenciaDoAparato {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  /** Ativos com custo fixo, as duas parcelas e algum aparato — os mensuráveis. */
  ativos: number;
  /** Em quantos deles o aparato está dentro do custo fixo declarado. */
  dentro: number;
  /** Quanto de aparato existe fora do total, em reais, nesta ponta. */
  foraEmReais: number;
  veredito: VereditoDoAparato;
}

/**
 * A tolerância da conferência, em reais.
 *
 * Um centavo de folga por coluna somada — são quatro as que têm valor, mais as
 * duas parcelas do total. Abaixo disso a diferença é arredondamento da planilha,
 * e não uma coluna a mais ou a menos.
 */
export const TOLERANCIA_DO_APARATO = 0.06;

/** O aparato de um ativo — as quatro colunas que têm valor. */
function aparatoDe(v: ValorDeSeguro): number {
  return (v.seguro ?? 0) + (v.revestimento ?? 0) + (v.faixaReflexiva ?? 0) + (v.tacografo ?? 0);
}

/**
 * O aparato cabe dentro do custo fixo que o export declara?
 *
 * ---------------------------------------------------------------------------
 * Como se mede, e por que não se mede de outro jeito
 * ---------------------------------------------------------------------------
 * A pergunta **não** é se o `custo_fixo` é maior que o aparato: qualquer total
 * é. É se o aparato está *dentro* dele — e a única forma de saber isso com o que
 * o acervo entrega é olhar o que sobra do total depois das parcelas conhecidas:
 *
 *     sobra = custo_fixo − (finame + lucro_fixo_conjunto)
 *
 * Se a sobra for o aparato, ele estava lá dentro. Se a sobra for zero, o total
 * é só as duas parcelas, e o aparato está fora. No acervo a sobra é zero em
 * 657 de 657 linhas — e é por isso que esta tela existe.
 *
 * ---------------------------------------------------------------------------
 * O que esta função não faz
 * ---------------------------------------------------------------------------
 * Ela **não decide o que é certo**. `DENTRO_DO_TOTAL` não é aprovação nem
 * `FORA_DO_TOTAL` é reprovação: são duas leituras possíveis do mesmo acervo, e a
 * segunda é a que ele hoje entrega. O dia em que a Ambev mudar a composição do
 * `custo_fixo`, esta tela muda de veredito sozinha — que é a razão de ela medir
 * em vez de afirmar.
 *
 * `MISTO` é o veredito que mais importa e o menos provável: se o aparato
 * estivesse dentro em algumas carretas e fora em outras, nenhum total da casa
 * poderia ser somado sem olhar linha a linha.
 *
 * E ela **não conta o ativo que não dá para medir**. Sem custo fixo, sem as duas
 * parcelas ou sem aparato nenhum, não há o que procurar: contá-lo como "fora"
 * inflaria o veredito com linhas que não dizem nada.
 */
export function conferenciaDoAparato(
  valores: readonly ValorDeSeguro[],
): ConferenciaDoAparato[] {
  const grupos = new Map<string, ValorDeSeguro[]>();
  for (const v of valores) {
    const chave = `${v.ponta}${v.entityType}`;
    const lista = grupos.get(chave) ?? [];
    lista.push(v);
    grupos.set(chave, lista);
  }

  return [...grupos.values()]
    .map((lista) => {
      const { ponta, entityType } = lista[0];
      let ativos = 0;
      let dentro = 0;
      let foraEmReais = 0;

      for (const v of lista) {
        const aparato = aparatoDe(v);
        if (
          v.custoFixo === null ||
          v.finame === null ||
          v.lucroFixoConjunto === null ||
          aparato === 0
        ) {
          continue;
        }
        ativos++;
        const sobra = v.custoFixo - (v.finame + v.lucroFixoConjunto);
        if (Math.abs(sobra - aparato) <= TOLERANCIA_DO_APARATO) dentro++;
        else foraEmReais += aparato;
      }

      const veredito: VereditoDoAparato =
        ativos === 0
          ? "BASE_INSUFICIENTE"
          : dentro === ativos
            ? "DENTRO_DO_TOTAL"
            : dentro === 0
              ? "FORA_DO_TOTAL"
              : "MISTO";

      return {
        ponta,
        entityType,
        ativos,
        dentro,
        foraEmReais: Number(foraEmReais.toFixed(2)),
        veredito,
      };
    })
    .sort((a, b) => a.entityType.localeCompare(b.entityType) || a.ponta.localeCompare(b.ponta));
}

// ---------------------------------------------------------------------------
// O agrupamento por veículo — uma linha por placa
// ---------------------------------------------------------------------------

/** Um veículo da tabela: a placa, o que ela moveu, e as linhas por baixo. */
export type VeiculoDeSeguro = VeiculoDaRubrica<LinhaDeSeguro>;

/**
 * A ordem em que a expansão lê as variáveis, e quem é o destaque.
 *
 * A ordem é a do catálogo: o seguro primeiro, as taxas depois, os dois totais
 * por último. `veiculo` vem antes de tudo e fica fora da contagem.
 *
 * O destaque é o **seguro** — a única das cinco que varia por ativo. Usar a
 * soma do aparato daria à placa um número que na maior parte das vezes se move
 * porque a tabela mudou, e não porque aquela carreta mudou.
 */
export const AGRUPAMENTO_DE_SEGURO = {
  ordemDasVariaveis: ["veiculo", ...TODAS.map((v) => v.chave)],
  destaque: "seguro",
  /* A unidade do destaque e a resposta a "esta rubrica tem dinheiro?" saem
     daqui — do mesmo catálogo que define a ordem da expansão, e nunca de
     uma segunda lista escrita à mão. */
  medidas: medidasDoCatalogo(TODAS),
  foraDaContagem: ["veiculo"],
} as const satisfies OpcoesDoAgrupamento;

/** As linhas viradas uma linha por placa. */
export function agruparPorVeiculoDeSeguro(
  linhas: readonly LinhaDeSeguro[],
): VeiculoDeSeguro[] {
  return agruparVeiculos(linhas, AGRUPAMENTO_DE_SEGURO);
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_SEGURO = [
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
 * separador do arquivo. Quem escreve o CSV é `lib/csv.ts`, no cliente.
 *
 * O aviso da linha que não soma viaja junto, e existe no arquivo justamente
 * porque o arquivo sai do produto e vira soma na planilha de outra pessoa: um
 * CSV que exporta a coluna do rastreador sem dizer que ela é zero em todas as
 * linhas é a forma mais fácil de o achado se perder.
 */
export function celulasDoCsvDeSeguro(
  l: LinhaDeSeguro,
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
