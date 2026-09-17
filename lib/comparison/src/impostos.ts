/**
 * A AUDITORIA DE IMPOSTOS — o tributo sobre a compra do ativo, e o que o acervo
 * não tem para falar do tributo sobre a prestação.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo é, e sobretudo o que ele não é
 * ---------------------------------------------------------------------------
 * Ele **não compara nada**, pela mesma razão que `finame.ts`, `ipva.ts` e
 * `lucro-fixo.ts` não comparam: comparar duas vigências veículo a veículo,
 * atributo a atributo, é o que `engine.ts` faz desde sempre. Um quarto motor
 * aqui seria a forma mais cara de duas telas passarem a discordar sobre o mesmo
 * mês.
 *
 * E ele **não traduz o motor de novo**: os seis estados, a forma da alteração e
 * a ordem de gravidade vêm de `recorte-de-rubrica.ts`, o mesmo módulo dos três
 * recortes anteriores. "Conflito" aqui é, por construção, o mesmo "Conflito" de
 * lá.
 *
 * O que é próprio deste arquivo são quatro coisas, todas puras:
 *
 * 1. **Diz quais atributos são de imposto**, por tipo de equipamento
 *    ({@link VARIAVEIS_DE_IMPOSTOS}) — e diz, para cada um, se ele é o
 *    **montante** ou a **alíquota**, que nesta rubrica é a distinção que decide
 *    tudo o mais.
 * 2. **Agrega** os indicadores do topo e as séries dos gráficos
 *    ({@link resumirImpostos}).
 * 3. **Confere a alíquota declarada contra a medida** — o imposto em reais
 *    dividido pelo valor de nota do mesmo ativo ({@link conferenciaDeAliquotas}).
 *    É a pergunta que o verbete desta tela pedia, e a única que o acervo
 *    sustenta hoje.
 * 4. **Separa os dois tributos**, ICMS e PIS/COFINS, em baldes que nunca somam
 *    entre si ({@link totaisDeImpostosPorVigencia}).
 *
 * ---------------------------------------------------------------------------
 * As quatro decisões que o dado real obrigou a escrever
 * ---------------------------------------------------------------------------
 * Todas as quatro estão medidas em `docs/ACHADO-IMPOSTOS.md`, que por sua vez
 * cita as medições já publicadas no acervo (`docs/AUDITORIA-PERIODICIDADE.md`,
 * `docs/CLASSIFICACAO-DOS-NAO-APURADOS.md`, `docs/DRE-DIAGNOSTICO.md` e os dois
 * dicionários de tabela):
 *
 * 1. **Alíquota não é montante, e é por isso que esta tela existe.** O acervo
 *    declara quatro alíquotas de imposto (`cavalo.percentual_icms`,
 *    `carreta.percentual_icms`, `carreta.icms`, `carreta.pis_cofins`) e dois
 *    montantes (`valor_icms`, `valor_pis_cofins`). Uma alíquota nunca entra numa
 *    soma de dinheiro — 12 e 9,3 num total de reais é um número que não é de
 *    nada. O que ela faz é **conferir**: o montante dividido pela nota é uma
 *    alíquota medida, e a razão entre dois valores em reais não tem ambiguidade
 *    de escala, enquanto uma coluna de percentual pode vir em pontos ou em
 *    fração sem que se saiba qual.
 *
 * 2. **`valor_icms` é coluna sem dado, não imposto zero.** Ela é zero nas 1.215
 *    linhas do acervo — 558 do cavalo e 657 da carreta. As alíquotas de ICMS
 *    existem e são declaradas; o dinheiro correspondente nunca foi preenchido.
 *    Somá-la daria um total de ICMS de R$ 0,00 sob o rótulo de uma medição, que
 *    é a forma mais fácil de o produto afirmar que não há ICMS. Ela fica **fora
 *    de toda soma**, aparece na tabela e no detalhe com o aviso, e produz o
 *    veredito próprio "alíquota declarada, montante ausente".
 *
 * 3. **`valor_pis_cofins` é tributo de aquisição, e não dedução do mês.** É
 *    exatamente 9,250% de `valor_nf_compra`, com desvio 0,0000 nos 132 ativos, e
 *    nunca varia ao longo das nove vigências: PONTUAL, como
 *    `CONFIRMED_SEMANTICS` já o declara. Ele não se soma com rubrica mensal
 *    nenhuma, e por isso o impacto sai **por periodicidade**, nunca num total
 *    único.
 *
 * 4. **O imposto do frete não está aqui, e a tela diz isso.** A dedução de
 *    PIS/COFINS e de ICMS/ISS sobre a prestação mora na tabela de frete
 *    (`fretePisCofins`, `impostosIcmsIss`, `percentualIcmsIss`), que **não é a
 *    fonte que este banco apura** — o dicionário dela diz isso na primeira
 *    página. Somar o imposto da compra do ativo com o imposto da prestação sob
 *    um rótulo só daria o total de duas grandezas diferentes, que é exatamente a
 *    segunda linha do `depende` do verbete desta rota.
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

/** Os seis estados de uma linha de imposto. O mesmo tipo dos demais recortes. */
export type EstadoDaLinhaDeImpostos = EstadoDaLinha;

// ---------------------------------------------------------------------------
// Os dois tributos, e os dois papéis de uma coluna
// ---------------------------------------------------------------------------

/**
 * Os dois tributos que o acervo declara sobre a compra do ativo.
 *
 * Dois baldes, e nunca um só. ICMS e PIS/COFINS são tributos diferentes, com
 * alíquotas diferentes e regimes diferentes; um total de "impostos" que os
 * juntasse esconderia justamente o achado — um deles tem montante medido e o
 * outro só tem alíquota declarada.
 */
export type Tributo = "ICMS" | "PIS_COFINS";

export const ROTULO_DO_TRIBUTO: Record<Tributo, string> = {
  ICMS: "ICMS",
  PIS_COFINS: "PIS/COFINS",
};

/**
 * O papel de uma coluna dentro do tributo: o dinheiro, a taxa, ou a base.
 *
 * É a distinção mais cara desta rubrica, e a razão de ela ser um campo e não um
 * comentário: `MONTANTE` soma, `ALIQUOTA` nunca soma e serve para conferir, e
 * `BASE` não é imposto nenhum — é o preço do ativo sobre o qual o imposto
 * incide. Uma tela que tratasse os três como "valores de imposto" somaria 12
 * (por cento) com R$ 37.890,84 e chamaria o resultado de total.
 */
export type PapelDaColuna = "MONTANTE" | "ALIQUOTA" | "BASE";

// ---------------------------------------------------------------------------
// O catálogo das variáveis
// ---------------------------------------------------------------------------

/**
 * Uma variável de imposto, com o código que cada tipo de equipamento usa.
 *
 * `codigo.CAVALO` ou `codigo.CARRETA` ausente quer dizer que **aquele tipo não
 * tem esta variável** — e não que ela caia num código parecido. É a mesma regra
 * dos três recortes anteriores, e aqui ela custa caro duas vezes: só a carreta
 * declara alíquota de PIS/COFINS, e só a carreta declara a segunda alíquota de
 * ICMS (a da entrada do implemento).
 */
export interface VariavelDeImpostos {
  /** A chave estável desta variável na tela e na API. Nunca muda de sentido. */
  chave: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  /** A que tributo esta coluna pertence. `null` na base, que não é tributo. */
  tributo: Tributo | null;
  papel: PapelDaColuna;
  codigo: { CAVALO?: string; CARRETA?: string };
  /**
   * Uma coluna que **não entra em soma nenhuma**, e a razão disso.
   *
   * Hoje é só o montante de ICMS. Diferente do total composto do FINAME — que
   * sai da soma por já estar nas parcelas — e da coluna "mensal" do IPVA — que
   * sai por ninguém saber o que ela é —, esta sai por um motivo que é o próprio
   * achado: ela é **zero nas 1.215 linhas**. Somá-la produziria um total de
   * R$ 0,00 com cara de medição, quando o que existe é uma coluna que ninguém
   * preencheu. Ela aparece na tabela e no detalhe, com o aviso, e em soma
   * nenhuma.
   */
  foraDaSoma?: string;
  /**
   * A coluna que serve de base para a alíquota medida desta variável.
   *
   * É o valor de nota do próprio equipamento, e é o que transforma
   * "R$ 37.890,84" em "9,250% da nota" — a leitura que confere a alíquota
   * declarada em vez de acreditar nela.
   */
  base?: { CAVALO?: string; CARRETA?: string };
  /** Uma linha de contexto para o ⓘ da tela. */
  ajuda?: string;
}

/**
 * As variáveis do imposto, na ordem em que a tela as lê.
 *
 * Começa no montante — que é o que de fato é dinheiro —, segue pelas alíquotas
 * que o acervo declara e termina na base que as confere. É esta ordem que faz a
 * tabela se ler como a pergunta: *quanto foi, a que taxa, sobre o quê.*
 */
export const VARIAVEIS_DE_IMPOSTOS: readonly VariavelDeImpostos[] = [
  {
    chave: "pis_cofins",
    rotulo: "PIS/COFINS da compra",
    medida: "DINHEIRO",
    tributo: "PIS_COFINS",
    papel: "MONTANTE",
    codigo: {
      CAVALO: "cavalo.valor_pis_cofins",
      CARRETA: "carreta.valor_pis_cofins",
    },
    base: { CAVALO: "cavalo.valor_nf_compra", CARRETA: "carreta.valor_nf_compra" },
    ajuda:
      "PIS/COFINS sobre a nota de compra do ativo — 9,250% dela, com desvio 0,0000 " +
      "nos 132 ativos. É tributo de aquisição, PONTUAL: não é a dedução de PIS/COFINS " +
      "sobre a prestação do mês, que continua faltando no acervo.",
  },
  {
    chave: "icms",
    rotulo: "ICMS da compra",
    medida: "DINHEIRO",
    tributo: "ICMS",
    papel: "MONTANTE",
    codigo: { CAVALO: "cavalo.valor_icms", CARRETA: "carreta.valor_icms" },
    base: { CAVALO: "cavalo.valor_nf_compra", CARRETA: "carreta.valor_nf_compra" },
    foraDaSoma:
      "Zero nas 1.215 linhas do acervo — 558 do cavalo e 657 da carreta. É coluna sem " +
      "dado, não imposto zero: as alíquotas de ICMS existem e são declaradas, e o " +
      "dinheiro correspondente nunca foi preenchido. Somá-la daria um total de R$ 0,00 " +
      "com cara de medição — ver docs/ACHADO-IMPOSTOS.md.",
    ajuda:
      "No cavalo a coluna é declarada como crédito de ICMS sobre insumos; na carreta, " +
      "como valor de ICMS conforme a compra. Nenhuma das duas foi preenchida.",
  },
  {
    chave: "percentual_icms",
    rotulo: "ICMS declarado",
    medida: "PERCENTUAL",
    tributo: "ICMS",
    papel: "ALIQUOTA",
    codigo: {
      CAVALO: "cavalo.percentual_icms",
      CARRETA: "carreta.percentual_icms",
    },
    ajuda:
      "Os dois tipos declaram esta coluna, e o nome gerencial de cada um diz coisas " +
      "diferentes: no cavalo é “conforme a compra do veículo”, na carreta é “conforme o " +
      "parâmetro da região da operação”. A tela mostra cada uma na sua linha e não " +
      "afirma que são a mesma grandeza.",
  },
  {
    chave: "percentual_pis_cofins",
    rotulo: "PIS/COFINS declarado",
    medida: "PERCENTUAL",
    tributo: "PIS_COFINS",
    papel: "ALIQUOTA",
    codigo: { CARRETA: "carreta.pis_cofins" },
    ajuda:
      "Só a carreta declara esta alíquota (faixa observada de 0 a 9,3); o cavalo não " +
      "tem equivalente, e por isso o PIS/COFINS dele só se confere pela medida.",
  },
  {
    chave: "valor_nf",
    rotulo: "Valor de NF",
    medida: "DINHEIRO",
    tributo: null,
    papel: "BASE",
    codigo: { CAVALO: "cavalo.valor_nf_compra", CARRETA: "carreta.valor_nf_compra" },
    ajuda:
      "A base das alíquotas medidas. Entra na tabela porque é o que confere o imposto — " +
      "nunca para somar com ele.",
  },
] as const;

/**
 * As variáveis que só o detalhe mostra.
 *
 * Uma só, e ela é a segunda alíquota de ICMS da carreta: `carreta.icms`, o "ICMS
 * de entrada do implemento", que convive com `carreta.percentual_icms`, o "ICMS
 * conforme o parâmetro da região". São duas taxas declaradas para o mesmo ativo,
 * com origens que os próprios nomes dizem ser diferentes — e, como o montante de
 * ICMS nunca foi preenchido, **não há medida que diga qual delas foi aplicada**.
 *
 * Escolher uma para a conferência seria adivinhar; escondê-la seria apagar o
 * fato de que há duas. Ela aparece no detalhe, dita por extenso, e fica fora da
 * conferência, que usa `percentual_icms` — a coluna que os dois tipos têm.
 */
export const VARIAVEIS_DE_DETALHE_DE_IMPOSTOS: readonly VariavelDeImpostos[] = [
  {
    chave: "icms_entrada",
    rotulo: "ICMS de entrada do implemento",
    medida: "PERCENTUAL",
    tributo: "ICMS",
    papel: "ALIQUOTA",
    codigo: { CARRETA: "carreta.icms" },
    ajuda:
      "A segunda alíquota de ICMS da carreta (faixa observada de 0 a 12), ao lado da " +
      "declarada por parâmetro de região. Com o montante de ICMS zerado, nenhuma medida " +
      "diz qual das duas foi aplicada — e a tela não escolhe por conta própria.",
  },
] as const;

const TODAS = [...VARIAVEIS_DE_IMPOSTOS, ...VARIAVEIS_DE_DETALHE_DE_IMPOSTOS];

/** Os códigos de atributo de um conjunto de variáveis. Sem repetição, ordenados. */
export function codigosDeImpostos(variaveis: readonly VariavelDeImpostos[]): string[] {
  const codigos = new Set<string>();
  for (const v of variaveis) {
    if (v.codigo.CAVALO) codigos.add(v.codigo.CAVALO);
    if (v.codigo.CARRETA) codigos.add(v.codigo.CARRETA);
  }
  return [...codigos].sort();
}

/** O recorte que a tabela pede ao motor. */
export const CODIGOS_DA_TABELA_DE_IMPOSTOS = codigosDeImpostos(VARIAVEIS_DE_IMPOSTOS);

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
 * equipamento (`cavalo.valor_pis_cofins` e `carreta.valor_pis_cofins` são atributos distintos), então filtrar pelos
 * códigos de um lado é o mesmo conjunto de linhas que filtrar pelo `entity_type`
 * daquele lado.
 */
export function codigosDoRecorteDeImpostos(
  recorte: "TODOS" | "CAVALO" | "CARRETA",
  variaveis: readonly VariavelDeImpostos[] = VARIAVEIS_DE_IMPOSTOS,
): string[] {
  if (recorte === "TODOS") return codigosDeImpostos(variaveis);
  const codigos = new Set<string>();
  for (const v of variaveis) {
    const codigo = v.codigo[recorte];
    if (codigo) codigos.add(codigo);
  }
  return [...codigos].sort();
}

/** O recorte do detalhe: tudo, inclusive a segunda alíquota da carreta. */
export const CODIGOS_DO_DETALHE_DE_IMPOSTOS = codigosDeImpostos(TODAS);

const POR_CODIGO = new Map<string, VariavelDeImpostos>();
for (const v of TODAS) {
  if (v.codigo.CAVALO) POR_CODIGO.set(v.codigo.CAVALO, v);
  if (v.codigo.CARRETA) POR_CODIGO.set(v.codigo.CARRETA, v);
}

/** A variável a que um código de atributo pertence, ou `undefined`. */
export function variavelDeImpostosDoCodigo(
  code: string | null,
): VariavelDeImpostos | undefined {
  return code === null ? undefined : POR_CODIGO.get(code);
}

/** O código que um tipo de equipamento usa para uma variável, quando existe. */
export function codigoDaVariavelDeImpostos(
  variavel: VariavelDeImpostos,
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
export interface LinhaDeImpostos {
  /** O `change.id`, quando a linha veio do motor. Ausente nas linhas iguais. */
  id: number | null;
  entityLabel: string | null;
  entityType: string;
  variavel: string;
  rotuloDaVariavel: string;
  medida: MedidaDaVariavel;
  /** O tributo desta linha. Nulo na base, que não é tributo. */
  tributo: Tributo | null;
  papel: PapelDaColuna;
  attributeCode: string | null;
  /** O texto do valor na vigência base. Nulo quando não havia. */
  base: string | null;
  /** O texto do valor na vigência comparada. Nulo quando não há. */
  comparada: string | null;
  /** `comparada − base`. Nula sempre que o motor não a produziu. */
  diferenca: number | null;
  /** A variação em **pontos percentuais**. Nula quando a base é zero. */
  variacao: number | null;
  estado: EstadoDaLinhaDeImpostos;
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
 * Devolve `null` para o que não é de imposto — a função é o filtro e o tradutor
 * ao mesmo tempo, de modo que nenhuma tela precise saber quais são os códigos.
 *
 * A coluna que não soma **não** é barrada aqui, pela mesma razão que a coluna
 * "mensal" do IPVA não é: ela é uma pergunta em aberto, e escondê-la apagaria o
 * achado. Ela passa, marcada, e quem soma ({@link impactoDeImpostos}) a recusa
 * pelo `foraDaSoma`.
 */
export function linhaDeImpostosDaAlteracao(a: AlteracaoDoMotor): LinhaDeImpostos | null {
  const variavel = variavelDeImpostosDoCodigo(a.attributeCode);
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
      tributo: null,
      papel: "BASE",
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
    tributo: variavel.tributo,
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

/** As linhas de imposto de uma lista de alterações, na ordem em que vieram. */
export function linhasDeImpostos(
  alteracoes: readonly AlteracaoDoMotor[],
): LinhaDeImpostos[] {
  const linhas: LinhaDeImpostos[] = [];
  for (const a of alteracoes) {
    const linha = linhaDeImpostosDaAlteracao(a);
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
 * Nesta rubrica o alternador vale mais do que nas outras três, e é medido: o
 * PIS/COFINS de aquisição **nunca varia** ao longo das nove vigências. Sem ele,
 * a tela de um par qualquer abre vazia — o que é a verdade sobre o que mudou, e
 * não sobre o que a frota paga.
 */
export function linhaDeImpostosSemAlteracao(par: {
  entityLabel: string | null;
  entityType: string;
  attributeCode: string;
  valor: string | null;
}): LinhaDeImpostos | null {
  const variavel = variavelDeImpostosDoCodigo(par.attributeCode);
  if (!variavel) return null;
  return {
    id: null,
    entityLabel: par.entityLabel,
    entityType: par.entityType,
    variavel: variavel.chave,
    rotuloDaVariavel: variavel.rotulo,
    medida: variavel.medida,
    tributo: variavel.tributo,
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
// O impacto — e as quatro coisas que ele se recusa a fazer
// ---------------------------------------------------------------------------

/** O impacto financeiro do recorte, por periodicidade. */
export interface ImpactoDeImpostos {
  /**
   * Um número por periodicidade, **nunca um total único**.
   *
   * Aqui isso não é teoria: o PIS/COFINS de aquisição é `PONTUAL` em
   * `CONFIRMED_SEMANTICS` — incide uma vez, sobre a nota de compra —, e somá-lo
   * com uma rubrica mensal daria um número que não descreve nem o mês nem a
   * compra. Anualizar, mensalizar ou juntar é decisão de quem lê.
   */
  porPeriodicidade: Record<string, number>;
  /** Alterações monetárias que o motor não soube precificar, com motivo próprio. */
  naoCalculavel: number;
  /** Linhas retiradas do total por não haver o que somar nelas com segurança. */
  foraDaSoma: number;
  /**
   * Alíquotas declaradas que se moveram.
   *
   * Elas não viram dinheiro nenhum — uma taxa não soma —, e mesmo assim são o
   * indicador mais acionável desta tela: uma alíquota que muda sem que o
   * montante mude é ou uma taxa declarada e não aplicada, ou um montante que
   * ficou para trás. Contá-las à parte é o que impede que "R$ 0,00 de impacto"
   * seja lido como "nada mudou no imposto".
   */
  aliquotasAlteradas: number;
}

/**
 * O impacto do recorte de impostos, por periodicidade e sem somar o que não é
 * dinheiro.
 *
 * ---------------------------------------------------------------------------
 * As quatro recusas
 * ---------------------------------------------------------------------------
 * **Não soma periodicidades diferentes.** Cada balde é uma periodicidade, como
 * `resumirImpacto` já faz para o produto inteiro.
 *
 * **Não soma alíquota.** Doze por cento não é doze reais, e uma taxa dentro de
 * um total de dinheiro é um número que não é de nada. As alíquotas saem contadas
 * em {@link ImpactoDeImpostos.aliquotasAlteradas}, que é onde elas informam.
 *
 * **Não soma a coluna sem dado.** `valor_icms` é zero nas 1.215 linhas: o total
 * de ICMS que ela produziria — R$ 0,00 — teria cara de medição e é ausência.
 *
 * **Não soma a base com o tributo.** O valor de nota é o preço do ativo, e o
 * imposto é o que incide sobre ele; os dois no mesmo balde dariam um impacto que
 * não é de rubrica nenhuma.
 */
export function impactoDeImpostos(
  linhas: readonly LinhaDeImpostos[],
): ImpactoDeImpostos {
  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let foraDaSoma = 0;
  let aliquotasAlteradas = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;

    if (l.papel === "ALIQUOTA") {
      aliquotasAlteradas++;
      continue;
    }
    if (l.papel === "BASE") continue;

    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    if (!l.impactoCalculado || l.impactoAmount === null) {
      /*
        Só conta como "não precificado" o que era candidato a dinheiro — e
        chegar aqui já garante isso: alíquota e base saíram acima.
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
  return { porPeriodicidade, naoCalculavel, foraDaSoma, aliquotasAlteradas };
}

// ---------------------------------------------------------------------------
// O movimento da alíquota — a grandeza que esta rubrica tem quando não tem dinheiro
// ---------------------------------------------------------------------------

/**
 * Quanto uma alíquota declarada andou entre duas vigências, por tributo.
 *
 * Existe porque nesta rubrica a coluna de dinheiro do seletor é a menos
 * informativa das duas: o montante de ICMS é zero nas 1.215 linhas do acervo
 * (ver `foraDaSoma` em {@link VARIAVEIS_DE_IMPOSTOS}) e o PIS/COFINS de
 * aquisição é fórmula sobre a nota — então `R$ 0,00` é o que o menu escreve em
 * toda linha, mudando a alíquota ou não. Num módulo de imposto a pergunta é
 * **em quantos pontos a taxa andou**, e era exatamente ela que a linha não
 * respondia.
 *
 * Três recusas, e as três são as mesmas do impacto logo acima:
 *
 * **Não soma pontos.** Setenta carretas que sobem 2 p.p. cada não somam 140
 * p.p. — soma de alíquota é o mesmo número que não é de nada que
 * {@link impactoDeImpostos} recusa. O que sai é o **maior** movimento e quantas
 * linhas se moveram, que é a forma em que a confusão não cabe.
 *
 * **Não mistura tributos.** ICMS e PIS/COFINS são taxas de regimes diferentes;
 * um "movimento de alíquota" único juntaria as duas sob um número que nenhuma
 * das duas reconhece. Um balde por tributo, como nos totais.
 *
 * **Não inventa direção.** Quando uma alíquota sobe num ativo e cai noutro, o
 * maior movimento sozinho diria que a frota inteira andou para aquele lado —
 * daí `ambasDirecoes`, e o sinal que a tela omite quando ele é verdadeiro.
 *
 * O ponto vem de `diferenca` (o `deltaAbsolute` do motor), e nunca de
 * `variacao`: a segunda é a variação **relativa** — de 10% para 12% ela diz
 * +20%, que numa coluna de imposto se lê como vinte pontos de alíquota.
 */
export interface MovimentoDeAliquota {
  tributo: Tributo;
  /** Quantas linhas de alíquota daquele tributo se moveram no par. */
  alteradas: number;
  /**
   * O maior movimento do tributo, em pontos percentuais, com sinal.
   *
   * `null` quando nenhuma das linhas alteradas trouxe medida — o motor recusa
   * o delta quando os dois lados não são comparáveis (semântica que derivou,
   * valor que virou texto). A tela escreve a contagem e diz que o movimento não
   * foi medido; escrever `0,000 p.p.` ali afirmaria uma medição que não houve.
   */
  maior: number | null;
  /** Subiu num ativo e caiu noutro — `maior` sozinho mentiria sobre a direção. */
  ambasDirecoes: boolean;
}

/**
 * A ordem em que os tributos saem — fixa, e não a de aparição nas linhas.
 *
 * Duas candidatas do mesmo menu têm de listar os tributos na mesma ordem, ou a
 * coluna da direita troca de assunto de linha para linha e quem compara duas
 * vigências passa a comparar ICMS com PIS/COFINS.
 */
const ORDEM_DOS_TRIBUTOS: readonly Tributo[] = ["ICMS", "PIS_COFINS"];

/**
 * O movimento das alíquotas de um par, um balde por tributo que se moveu.
 *
 * Tributo que não moveu nenhuma alíquota **não produz balde** — a lista vazia é
 * a resposta "nenhuma alíquota andou", e é ela que a tela escreve por extenso.
 */
export function movimentoDeAliquotas(
  linhas: readonly LinhaDeImpostos[],
): MovimentoDeAliquota[] {
  const porTributo = new Map<
    Tributo,
    { alteradas: number; maior: number | null; subiu: boolean; caiu: boolean }
  >();

  for (const l of linhas) {
    if (l.papel !== "ALIQUOTA" || l.estado !== "ALTERADO" || l.tributo === null) continue;

    const balde = porTributo.get(l.tributo) ?? {
      alteradas: 0,
      maior: null,
      subiu: false,
      caiu: false,
    };
    balde.alteradas++;

    if (l.diferenca !== null && l.diferenca !== 0) {
      if (l.diferenca > 0) balde.subiu = true;
      else balde.caiu = true;
      if (balde.maior === null || Math.abs(l.diferenca) > Math.abs(balde.maior)) {
        balde.maior = Number(l.diferenca.toFixed(6));
      }
    }

    porTributo.set(l.tributo, balde);
  }

  return ORDEM_DOS_TRIBUTOS.filter((t) => porTributo.has(t)).map((tributo) => {
    const balde = porTributo.get(tributo)!;
    return {
      tributo,
      alteradas: balde.alteradas,
      maior: balde.maior,
      ambasDirecoes: balde.subiu && balde.caiu,
    };
  });
}

// ---------------------------------------------------------------------------
// Os indicadores e as séries
// ---------------------------------------------------------------------------

/** Quantos veículos cada vigência entregou — vem da contagem do motor. */
export interface FrotaDoParDeImpostos {
  /** Veículos presentes nas duas vigências. */
  comparados: number;
  novos: number;
  ausentes: number;
}

export interface ResumoDeImpostos {
  veiculosComparados: number;
  /** Comparados que não tiveram nenhuma variável de imposto alterada. */
  semAlteracao: number;
  veiculosComAlteracao: number;
  novosNaVigencia: number;
  ausentesNaComparada: number;
  /** Quantas variáveis se moveram, somando todos os veículos. */
  variaveisAlteradas: number;
  veiculosComDadoIncompleto: number;
  veiculosComConflito: number;
  impacto: ImpactoDeImpostos;
}

/**
 * Os indicadores do topo, de uma passada só.
 *
 * `frota` vem do motor porque **esta lista não sabe** quantos veículos não
 * mudaram: um veículo sem nenhuma alteração não produz linha nenhuma. Derivar
 * "sem alteração" do tamanho da lista daria zero numa comparação em que nada
 * mudou — que, nesta rubrica, é o caso mais provável de todos.
 */
export function resumirImpostos(
  linhas: readonly LinhaDeImpostos[],
  frota: FrotaDoParDeImpostos,
): ResumoDeImpostos {
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
    FINAME sobre dado real mostrou, e a regra vale igual nos quatro recortes.
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
    impacto: impactoDeImpostos(linhas),
  };
}

/** Uma barra do gráfico "alterações por variável". */
export interface AlteracoesDaVariavelDeImpostos {
  variavel: string;
  rotulo: string;
  medida: MedidaDaVariavel;
  tributo: Tributo | null;
  alteracoes: number;
}

/** Quantas alterações cada variável teve, da maior para a menor. */
export function alteracoesPorVariavelDeImpostos(
  linhas: readonly LinhaDeImpostos[],
): AlteracoesDaVariavelDeImpostos[] {
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
      tributo: v.tributo,
      alteracoes: contagem.get(v.chave)!,
    }))
    .sort((a, b) => b.alteracoes - a.alteracoes || a.rotulo.localeCompare(b.rotulo));
}

/** Uma fatia do gráfico de status. */
export interface FatiaDeEstadoDeImpostos {
  estado: EstadoDaLinhaDeImpostos;
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
export function distribuicaoPorEstadoDeImpostos(
  linhas: readonly LinhaDeImpostos[],
  frota: FrotaDoParDeImpostos,
): FatiaDeEstadoDeImpostos[] {
  const pior = new Map<string, EstadoDaLinhaDeImpostos>();
  for (const l of linhas) {
    const chave = chaveDoVeiculo(l);
    const atual = pior.get(chave);
    if (atual === undefined || GRAVIDADE.indexOf(l.estado) < GRAVIDADE.indexOf(atual)) {
      pior.set(chave, l.estado);
    }
  }

  const contagem = new Map<EstadoDaLinhaDeImpostos, number>();
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
// Os totais e a conferência da alíquota
// ---------------------------------------------------------------------------

/** Um ativo lido de uma das duas vigências, com os dois tributos e a base. */
export interface ValorDeImposto {
  /** `BASE` ou `COMPARADA` — a ponta, não a data. A data é do contexto. */
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  entityLabel: string | null;
  /** O valor de nota do ativo, base das alíquotas medidas. Nulo quando falta. */
  valorNf: number | null;
  /** O montante de PIS/COFINS declarado, em reais. Nulo quando não veio. */
  pisCofins: number | null;
  /** O montante de ICMS declarado, em reais. Nulo quando não veio. */
  icms: number | null;
  /** A alíquota de PIS/COFINS que o ativo declara, em pontos. Só a carreta tem. */
  percentualPisCofins: number | null;
  /** A alíquota de ICMS que o ativo declara, em pontos. */
  percentualIcms: number | null;
}

/** Um ponto do gráfico "valor total por vigência". */
export interface TotalDeImpostosDaVigencia {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  tributo: Tributo;
  total: number;
  /** Quantos ativos declararam um montante — zero inclusive. */
  ativos: number;
  /** Quantos deles vieram exatamente zero, que aqui é ausência e não valor. */
  zerados: number;
}

/**
 * O total de cada tributo em cada ponta, por tipo de equipamento.
 *
 * **Um balde por tributo, sempre.** ICMS e PIS/COFINS não somam entre si: são
 * tributos diferentes, e neste acervo um deles tem montante e o outro não. Um
 * total único de "impostos" esconderia exatamente isso.
 *
 * Os valores vêm da leitura das duas vigências, não do change set, porque um
 * total tem de incluir quem não mudou — e nesta rubrica quase ninguém muda.
 *
 * Os zeros entram na contagem e **não** somem do total: um total de R$ 0,00 com
 * 657 ativos zerados é a informação, e escondê-la deixaria a linha de ICMS
 * simplesmente ausente, como se o tributo não existisse no modelo.
 */
export function totaisDeImpostosPorVigencia(
  valores: readonly ValorDeImposto[],
): TotalDeImpostosDaVigencia[] {
  const acumulado = new Map<string, TotalDeImpostosDaVigencia>();

  const somar = (v: ValorDeImposto, tributo: Tributo, montante: number | null): void => {
    if (montante === null) return;
    const chave = `${v.ponta}${v.entityType}${tributo}`;
    const atual =
      acumulado.get(chave) ??
      ({
        ponta: v.ponta,
        entityType: v.entityType,
        tributo,
        total: 0,
        ativos: 0,
        zerados: 0,
      } as TotalDeImpostosDaVigencia);
    atual.total += montante;
    atual.ativos += 1;
    if (montante === 0) atual.zerados += 1;
    acumulado.set(chave, atual);
  };

  for (const v of valores) {
    somar(v, "PIS_COFINS", v.pisCofins);
    somar(v, "ICMS", v.icms);
  }

  return [...acumulado.values()]
    .map((t) => ({ ...t, total: Number(t.total.toFixed(2)) }))
    .sort(
      (a, b) =>
        a.tributo.localeCompare(b.tributo) ||
        a.entityType.localeCompare(b.entityType) ||
        a.ponta.localeCompare(b.ponta),
    );
}

/**
 * O que a conferência de um tributo, numa ponta, revelou.
 *
 * `SEM_MONTANTE` é o veredito que só existe nesta tela e é metade da razão de
 * ela existir: há alíquota declarada e não há um centavo de montante. É o estado
 * do ICMS no acervo inteiro — 1.215 linhas zeradas —, e ele não é "imposto
 * zero": é uma coluna que ninguém preencheu, com taxas que alguém declarou.
 *
 * `DIVERGEM` é a outra metade: a alíquota que o ativo declara e a que o dinheiro
 * dele revela não são a mesma. É o que o verbete desta rota pedia ao dizer que o
 * percentual declarado e o imposto em reais discordam.
 */
export type VereditoDoTributo =
  | "SEM_MONTANTE"
  | "DIVERGEM"
  | "CONFEREM"
  | "FORMULA_UNICA"
  | "POR_VEICULO"
  | "BASE_INSUFICIENTE";

export const ROTULO_DO_VEREDITO_DO_TRIBUTO: Record<VereditoDoTributo, string> = {
  SEM_MONTANTE: "Alíquota declarada, montante ausente",
  DIVERGEM: "Declarada diverge da medida",
  CONFEREM: "Declarada confere com a medida",
  FORMULA_UNICA: "Percentual único da nota",
  POR_VEICULO: "Medida varia por ativo",
  BASE_INSUFICIENTE: "Base insuficiente",
};

/** A conferência de um tributo numa ponta, por tipo de equipamento. */
export interface ConferenciaDaAliquota {
  ponta: "BASE" | "COMPARADA";
  entityType: string;
  tributo: Tributo;
  /**
   * Quantos ativos sustentam a medida: têm valor de nota positivo e um montante
   * **maior que zero**. É a população da régua, e não a da rubrica — os zerados
   * estão contados ao lado.
   */
  ativos: number;
  /**
   * Quantos ativos declararam o montante exatamente zero.
   *
   * Eles não somem: continuam na tabela, no total da vigência e neste número. O
   * que eles não fazem é **medir alíquota** — zero dividido pela nota é 0%, e
   * uma frota inteira em 0% não é uma alíquota de zero por cento: é uma coluna
   * em branco fingindo uma medição.
   */
  zerados: number;
  /** Quantos ativos trazem a alíquota declarada — a outra metade da conferência. */
  comDeclarada: number;
  /** Em pontos percentuais: `9.25` para 9,250% da nota. */
  medidaMinima: number | null;
  medidaMedia: number | null;
  medidaMaxima: number | null;
  /** O desvio-padrão populacional da medida, em pontos percentuais. */
  medidaDesvio: number | null;
  /** A média das alíquotas declaradas, em pontos percentuais. */
  declaradaMedia: number | null;
  /**
   * Quantos ativos têm as duas coisas e discordam além da tolerância.
   *
   * Só conta quem tem medida **e** declarada: um ativo sem taxa declarada não
   * diverge de nada, e contá-lo como divergente transformaria a ausência da
   * coluna num achado que não existe.
   */
  divergentes: number;
  /** Quantos ativos têm medida e declarada ao mesmo tempo. */
  conferidos: number;
  /** A maior distância medida entre declarada e medida, em pontos percentuais. */
  maiorDiferenca: number | null;
  veredito: VereditoDoTributo;
}

/**
 * Abaixo desta distância, em pontos percentuais, declarada e medida são a mesma.
 *
 * Meio décimo de ponto, e o argumento é a própria escrita da declaração: as
 * alíquotas chegam com uma casa decimal — 9,3; 12; 0 —, e uma taxa publicada com
 * uma casa não pode ser conferida mais fino do que metade da última dela.
 * `valor_pis_cofins / valor_nf_compra` dá 9,250%, e a carreta declara 9,3: a
 * distância é 0,05 p.p., que é o mesmo número escrito com menos dígitos, não uma
 * discordância. Um limiar mais apertado acusaria arredondamento como achado — e
 * um achado que aparece em toda linha deixa de ser lido.
 */
export const TOLERANCIA_DA_CONFERENCIA = 0.05;

/**
 * A alíquota medida de um ativo — o montante sobre a base, em pontos.
 *
 * `null` quando falta o montante, falta a nota, ou a nota é zero. Nenhum dos três
 * vira 0%: dividir por zero não produz alíquota nenhuma, e um cadastro em branco
 * lido como zero por cento puxaria a média para baixo sem que ninguém tivesse
 * medido coisa alguma.
 *
 * **O montante zero também não vira 0%**, e é o cuidado próprio desta rubrica:
 * no ICMS deste acervo ele é o estado de todas as 1.215 linhas, e lê-lo como
 * medida produziria "0,000% da nota, desvio zero" — uma frase tecnicamente
 * verdadeira que descreveria como fórmula aplicada o que é coluna nunca
 * preenchida.
 *
 * Está exportada porque a gaveta do detalhe faz a mesma conta para um ativo só, e
 * duas cópias dela divergiriam no dia em que o zero deixasse de ser tratado do
 * mesmo jeito nos dois lugares.
 */
export function aliquotaMedida(
  montante: number | null,
  valorNf: number | null,
): number | null {
  if (montante === null || montante === 0) return null;
  if (valorNf === null || valorNf === 0) return null;
  return (montante / valorNf) * 100;
}

/**
 * A conferência de um ativo só: a medida, a declarada e a distância entre elas.
 *
 * `null` quando falta qualquer das duas — um ativo sem taxa declarada não diverge
 * de nada, e tratá-lo como divergente transformaria a ausência da coluna num
 * achado que não existe.
 */
export function conferenciaDoAtivo(
  montante: number | null,
  valorNf: number | null,
  declarada: number | null,
): { medida: number; declarada: number; distancia: number; divergem: boolean } | null {
  const medida = aliquotaMedida(montante, valorNf);
  if (medida === null || declarada === null) return null;
  const distancia = Math.abs(medida - declarada);
  return {
    medida,
    declarada,
    distancia,
    divergem: distancia > TOLERANCIA_DA_CONFERENCIA,
  };
}

/**
 * Abaixo deste desvio, em pontos percentuais, a medida é fórmula e não dado.
 *
 * O mesmo limiar da alíquota implícita de IPVA, pela mesma razão: o acervo mede
 * desvio **0,0000** no PIS/COFINS de aquisição dos 132 ativos, e meio centésimo
 * de ponto separa isso de qualquer regime que varie de verdade, com folga dos
 * dois lados.
 */
const DESVIO_DE_FORMULA = 0.005;

/**
 * Quantos ativos uma ponta precisa ter para o veredito valer.
 *
 * Abaixo do mínimo o veredito é `BASE_INSUFICIENTE`, que é a resposta honesta:
 * afirmar "confere" sobre três ativos é afirmar sobre a frota uma regra que três
 * linhas não sustentam.
 */
const MINIMO_PARA_VEREDITO = 5;

/**
 * A conferência entre a alíquota declarada e a medida — a razão desta tela.
 *
 * ---------------------------------------------------------------------------
 * Por que a medida, e não a declarada
 * ---------------------------------------------------------------------------
 * Porque a razão entre dois valores em reais não tem ambiguidade de escala. Uma
 * coluna de percentual pode vir em pontos (9,3) ou em fração (0,093) sem que se
 * saiba qual, e o produto já pagou esse preço noutras colunas; `valor_pis_cofins
 * / valor_nf_compra` não tem essa dúvida — é dinheiro sobre dinheiro.
 *
 * Isso não torna a declarada descartável: é ela que diz o que **deveria** ser
 * cobrado. A conferência é a diferença entre as duas, e é a diferença que é o
 * achado — não cada uma delas isolada.
 *
 * ---------------------------------------------------------------------------
 * O zero sai da régua, e só da régua
 * ---------------------------------------------------------------------------
 * Um montante zero não é uma alíquota de zero por cento. No ICMS deste acervo
 * ele é o estado de **todas** as 1.215 linhas, e lê-lo como medida produziria
 * "0,000% da nota, desvio zero, percentual único" — uma frase tecnicamente
 * verdadeira e inteiramente enganosa, porque descreveria como fórmula aplicada o
 * que é coluna nunca preenchida. Os zeros saem da medida, entram em
 * {@link ConferenciaDaAliquota.zerados}, e produzem o veredito `SEM_MONTANTE`
 * quando há alíquota declarada ao lado deles.
 *
 * ---------------------------------------------------------------------------
 * A ordem dos testes é o que os torna verdadeiros
 * ---------------------------------------------------------------------------
 * 1. **Sem montante nenhum, com alíquota declarada** → `SEM_MONTANTE`. É o caso
 *    do ICMS, e ele decide antes de tudo: perguntar "confere?" sobre uma coluna
 *    vazia é perguntar errado.
 * 2. **Poucos ativos** → `BASE_INSUFICIENTE`.
 * 3. **Há declarada para conferir** → `CONFEREM` ou `DIVERGEM`, conforme a
 *    tolerância. Esta pergunta vem antes da dispersão porque, havendo com o que
 *    conferir, conferir é o que se faz.
 * 4. **Não há declarada** → resta ler a medida sozinha: desvio praticamente zero
 *    é `FORMULA_UNICA`, o resto é `POR_VEICULO`.
 */
export function conferenciaDeAliquotas(
  valores: readonly ValorDeImposto[],
): ConferenciaDaAliquota[] {
  interface Acumulado {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    tributo: Tributo;
    medidas: number[];
    declaradas: number[];
    zerados: number;
    divergentes: number;
    conferidos: number;
    maiorDiferenca: number | null;
  }

  const porChave = new Map<string, Acumulado>();

  const acumular = (
    v: ValorDeImposto,
    tributo: Tributo,
    montante: number | null,
    declarada: number | null,
  ): void => {
    const chave = `${v.ponta}${v.entityType}${tributo}`;
    const atual: Acumulado = porChave.get(chave) ?? {
      ponta: v.ponta,
      entityType: v.entityType,
      tributo,
      medidas: [],
      declaradas: [],
      zerados: 0,
      divergentes: 0,
      conferidos: 0,
      maiorDiferenca: null,
    };

    if (declarada !== null) atual.declaradas.push(declarada);

    /*
      A medida e a conferência saem das mesmas duas funções que a gaveta do
      detalhe usa, e não de uma segunda cópia da regra aqui: o zero que não vira
      0% e a tolerância da comparação têm de ser os mesmos números na régua da
      frota e na frase sobre um ativo.
    */
    if (montante === 0) atual.zerados += 1;
    const medida = aliquotaMedida(montante, v.valorNf);
    if (medida !== null) {
      atual.medidas.push(medida);
      const conferido = conferenciaDoAtivo(montante, v.valorNf, declarada);
      if (conferido) {
        atual.conferidos += 1;
        if (conferido.divergem) atual.divergentes += 1;
        if (atual.maiorDiferenca === null || conferido.distancia > atual.maiorDiferenca) {
          atual.maiorDiferenca = conferido.distancia;
        }
      }
    }

    porChave.set(chave, atual);
  };

  for (const v of valores) {
    acumular(v, "PIS_COFINS", v.pisCofins, v.percentualPisCofins);
    acumular(v, "ICMS", v.icms, v.percentualIcms);
  }

  return [...porChave.values()]
    .map((a): ConferenciaDaAliquota => {
      const ativos = a.medidas.length;
      const comDeclarada = a.declaradas.length;
      const declaradaMedia =
        comDeclarada === 0
          ? null
          : Number(
              (a.declaradas.reduce((acc, d) => acc + d, 0) / comDeclarada).toFixed(4),
            );

      if (ativos === 0) {
        /*
          Nenhuma medida. Se há alíquota declarada e há zeros do outro lado, o
          veredito é o achado: alguém declarou a taxa e o dinheiro nunca foi
          preenchido. Sem alíquota declarada, é só falta de base.
        */
        const veredito: VereditoDoTributo =
          comDeclarada >= MINIMO_PARA_VEREDITO && a.zerados > 0
            ? "SEM_MONTANTE"
            : "BASE_INSUFICIENTE";
        return {
          ponta: a.ponta,
          entityType: a.entityType,
          tributo: a.tributo,
          ativos: 0,
          zerados: a.zerados,
          comDeclarada,
          medidaMinima: null,
          medidaMedia: null,
          medidaMaxima: null,
          medidaDesvio: null,
          declaradaMedia,
          divergentes: 0,
          conferidos: 0,
          maiorDiferenca: null,
          veredito,
        };
      }

      const media = a.medidas.reduce((acc, m) => acc + m, 0) / ativos;
      const desvio = Math.sqrt(
        a.medidas.reduce((acc, m) => acc + (m - media) ** 2, 0) / ativos,
      );

      const veredito: VereditoDoTributo =
        ativos < MINIMO_PARA_VEREDITO
          ? "BASE_INSUFICIENTE"
          : a.conferidos >= MINIMO_PARA_VEREDITO
            ? a.divergentes === 0
              ? "CONFEREM"
              : "DIVERGEM"
            : desvio <= DESVIO_DE_FORMULA
              ? "FORMULA_UNICA"
              : "POR_VEICULO";

      return {
        ponta: a.ponta,
        entityType: a.entityType,
        tributo: a.tributo,
        ativos,
        zerados: a.zerados,
        comDeclarada,
        medidaMinima: Number(Math.min(...a.medidas).toFixed(4)),
        medidaMedia: Number(media.toFixed(4)),
        medidaMaxima: Number(Math.max(...a.medidas).toFixed(4)),
        medidaDesvio: Number(desvio.toFixed(4)),
        declaradaMedia,
        divergentes: a.divergentes,
        conferidos: a.conferidos,
        maiorDiferenca:
          a.maiorDiferenca === null ? null : Number(a.maiorDiferenca.toFixed(4)),
        veredito,
      };
    })
    .sort(
      (a, b) =>
        a.tributo.localeCompare(b.tributo) ||
        a.entityType.localeCompare(b.entityType) ||
        a.ponta.localeCompare(b.ponta),
    );
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV_DE_IMPOSTOS = [
  "Veículo",
  "Tipo",
  "Tributo",
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

/** Como o CSV escreve o papel de cada coluna, por extenso. */
const PAPEL_NO_CSV: Record<PapelDaColuna, string> = {
  MONTANTE: "Montante (R$)",
  ALIQUOTA: "Alíquota (%)",
  BASE: "Base de cálculo",
};
/**
 * Uma linha da tabela como as células do CSV.
 *
 * Devolve texto cru — sem `R$`, sem `%`, sem separador de milhar e sem decidir o
 * separador do arquivo. Quem escreve o CSV é `lib/csv.ts`, no cliente, que já
 * sabe o que o Excel brasileiro espera.
 *
 * **A coluna "Papel" existe por causa do arquivo, e não da tela.** Na tela, uma
 * alíquota se distingue de um montante pelo `%` ao lado do número; num CSV
 * exportado para a planilha de outra pessoa, `12` e `37890,84` são duas células
 * numéricas na mesma coluna, e uma soma de coluna junta as duas sem avisar. Dizer
 * por extenso o que cada linha é custa uma coluna e evita o total que não é de
 * nada. A última coluna, pelo mesmo motivo, carrega o aviso da coluna zerada.
 *
 * A justificativa entra por parâmetro porque **não é da linha**: ela é do
 * gestor, mora em `justificativa` e é lida por `change_id` numa segunda
 * consulta. Guardá-la dentro da linha faria a comparação carregar um texto que o
 * motor não produziu — e que muda sem a comparação mudar. É a mesma escolha de
 * `celulasDoCsv`, no FINAME. No arquivo ela é a última coluna, e é boa parte do
 * motivo de o CSV existir para além da tela: quem recebe a planilha lê o que
 * mudou e, na mesma linha, por que mudou.
 */
export function celulasDoCsvDeImpostos(
  l: LinhaDeImpostos,
  justificativa?: string | null,
): (string | number | null)[] {
  return [
    l.entityLabel,
    l.entityType,
    l.tributo === null ? null : ROTULO_DO_TRIBUTO[l.tributo],
    l.rotuloDaVariavel,
    PAPEL_NO_CSV[l.papel],
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
 * Um veículo da tabela de impostos: a placa, o que ela moveu, e as linhas
 * por baixo.
 *
 * O corpo do agrupamento mora em `agrupamento-por-veiculo.ts`, com as outras
 * rubricas de custo fixo — inclusive o FINAME, que foi onde ele nasceu. Quatro
 * cópias da mesma função seriam quatro definições de "o estado de uma placa"
 * livres para divergir.
 */
export type VeiculoDeImpostos = VeiculoDaRubrica<LinhaDeImpostos>;

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
 * O destaque é o PIS/COFINS da compra — **uma** variável, e nunca a soma das monetárias.
 * É o único tributo desta rubrica com montante preenchido — o ICMS vem zerado nas 1.215 linhas do acervo, e é coluna sem dado, não imposto zero. E os dois nunca somam entre si numa célula: são tributos diferentes, e um total de "impostos" esconderia exatamente que um deles não foi preenchido. O que se mover no ICMS continua contado em "Alterações" e escrito na expansão.
 */
export const AGRUPAMENTO_DE_IMPOSTOS = {
  ordemDasVariaveis: ["veiculo", ...TODAS.map((v) => v.chave)],
  destaque: "pis_cofins",
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
export function agruparPorVeiculoDeImpostos(
  linhas: readonly LinhaDeImpostos[],
): VeiculoDeImpostos[] {
  return agruparVeiculos(linhas, AGRUPAMENTO_DE_IMPOSTOS);
}
