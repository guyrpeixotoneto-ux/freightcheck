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
  contextoDasLinhas,
  type OpcoesDoAgrupamento,
  type VeiculoDaRubrica,
} from "./agrupamento-por-veiculo";

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
  /**
   * Uma coluna que **não entra na soma de impacto deste módulo**, e a razão.
   *
   * Existe aqui pela mesma razão que existe em `ipva.ts` e `impostos.ts`, e
   * chegou depois das duas: são as colunas que o FINAME mostra para **conferir**
   * o financiamento e que pertencem, como rubrica, a outro módulo. Somá-las aqui
   * contava dinheiro que o módulo dono já conta — ver o cabeçalho de
   * {@link impactoPorPeriodicidade} e `docs/ACHADO-DUPLA-CONTAGEM-CUSTO-FIXO.md`.
   *
   * Diferente de {@link VariavelDeFiname.totalComposto}: aquele some da tabela,
   * porque mostrá-lo convidaria a somar duas vezes dentro do próprio FINAME.
   * Esta **fica na tabela**, marcada, porque é o que confere a linha ao lado —
   * é a mesma escolha que o IPVA faz com a coluna mensal da carreta.
   */
  foraDaSoma?: string;
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
    /*
      Três parcelas, e a terceira só existe no implemento.

      `aluguel` entrou quando a curadoria confirmou a periodicidade da coluna por
      base aritmética: `finameImplemento = amortização + juros + aluguel` fecha
      em 1.314 de 1.314 linhas do acervo, e **sem ela falha nas 36** — todas de
      implementos alugados, em que amortização e juros são zero e o custo inteiro
      está no aluguel (`docs/ACHADO-ALUGUEL.md`).

      Declará-la aqui faz duas coisas ao mesmo tempo, e as duas importam: a
      expansão da placa passa a explicar a parcela dos implementos alugados — ela
      mostrava R$ 5.363,55 ao lado de duas parcelas zeradas —, e a regra de
      `cobertasPorParcelasEm` passa a tirar a parcela do total quando o aluguel
      se move, que é o que impede o módulo Aluguel de contar o mesmo dinheiro
      uma segunda vez.
    */
    parcelas: ["juros", "amortizacao", "aluguel"],
    ajuda:
      "Amortização do principal mais juros, no período da vigência — e, nos " +
      "implementos alugados, o aluguel, que ocupa o lugar do financiamento.",
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
    chave: "aluguel",
    rotulo: "Aluguel do implemento",
    medida: "DINHEIRO",
    /* Só a carreta. A identidade do cavalo é amortização + juros + lucro fixo
       (`composition.ts`), sem aluguel, e `cavalo.custo_aluguel` é zero nas 558
       linhas do acervo. Emparelhar os dois aqui faria a expansão do cavalo
       mostrar uma parcela que o cavalo não tem. */
    codigo: { CARRETA: "carreta.custo_aluguel" },
    foraDaSoma:
      "O aluguel do implemento é rubrica do módulo Aluguel de Frota, que é quem " +
      "o soma. Ele está aqui porque é a terceira parcela desta parcela — sem ele " +
      "a identidade falha nos implementos alugados —, e é como parcela que ele " +
      "tira o total da soma deste módulo. Somá-lo aqui *e* lá contaria o mesmo " +
      "dinheiro duas vezes; é a mesma recusa que esta tela já faz sobre o ICMS.",
    ajuda:
      "O implemento que a frota aluga em vez de financiar: nele a parcela FINAME " +
      "é o aluguel, com amortização e juros zerados. Quem o soma é a Auditoria de " +
      "Aluguel de Frota.",
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
    foraDaSoma:
      "É o preço de compra do ativo, não uma rubrica de custo fixo. Ela está aqui " +
      "porque é a base que confere a parcela, o IPVA e os tributos da aquisição — " +
      "nunca para somar com eles. É a mesma recusa que `ipva.ts` e `impostos.ts` " +
      "já faziam sobre esta coluna.",
    ajuda:
      "A base de compra do equipamento. Entra na tabela porque é o que confere o " +
      "financiamento; fica fora do impacto porque preço do ativo não é custo fixo.",
  },
  {
    chave: "icms",
    rotulo: "ICMS",
    medida: "DINHEIRO",
    codigo: { CAVALO: "cavalo.valor_icms", CARRETA: "carreta.valor_icms" },
    foraDaSoma:
      "ICMS da aquisição é rubrica do módulo Impostos, que é quem o soma. Hoje a " +
      "coluna é zero nas 1.215 linhas do acervo, de modo que somá-la aqui não move " +
      "número nenhum — e é justamente por isso que a recusa precisa ser explícita: " +
      "no dia em que a fonte a preencher, a soma silenciosa viraria dupla contagem.",
    ajuda: "Conferência do tributo da compra. Quem o soma é a Auditoria de Impostos.",
  },
  {
    chave: "pis_cofins",
    rotulo: "PIS/COFINS",
    medida: "DINHEIRO",
    codigo: {
      CAVALO: "cavalo.valor_pis_cofins",
      CARRETA: "carreta.valor_pis_cofins",
    },
    foraDaSoma:
      "PIS/COFINS da aquisição é rubrica do módulo Impostos, que é quem o soma. " +
      "Esta era a dupla contagem medida: a mesma alteração entrava nos dois totais, " +
      "porque a semântica dela é confirmada e o motor a precifica (PONTUAL).",
    ajuda: "Conferência do tributo da compra. Quem o soma é a Auditoria de Impostos.",
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

/**
 * A coluna que declara se o financiamento está vivo — por equipamento.
 *
 * ---------------------------------------------------------------------------
 * Por que não é uma variável de {@link VARIAVEIS_DE_FINAME}
 * ---------------------------------------------------------------------------
 * Porque aquela lista é a **tabela de comparação entre vigências**, e entrar
 * nela é aparecer como coluna em todas as telas que a leem. Esta coluna não é
 * pedida ali — `status_financiamento`, que está na lista, é outra (só a carreta
 * a declara, e a própria variável diz isso). O que esta constante serve é o
 * confronto Remunerado × Realizado, que precisa saber se um veículo **sem
 * lançamento no razão** está quitado ou está declarado financiado. Ver
 * `docs/DEFINICOES-DO-CONFRONTO-DE-FINAME.md`.
 *
 * Os dois equipamentos declaram a mesma coluna do T1 Shared, e é dela que sai a
 * partição do universo "sem realizado". O texto não é interpretado aqui:
 * `situacaoDoFinanciamentoDe`, no confronto, é quem normaliza — e devolve
 * `INDEFINIDO` para o que não reconhece, em vez de chutar.
 */
export const CODIGO_DA_SITUACAO_DO_FINANCIAMENTO: Readonly<Record<"CAVALO" | "CARRETA", string>> = {
  CAVALO: "cavalo.status_financiamento_t1_shared",
  CARRETA: "carreta.status_financiamento_t1_shared",
};

/**
 * Os códigos de um recorte de equipamento — `TODOS`, `CAVALO` ou `CARRETA`.
 *
 * Existe porque nem toda leitura aceita recortar por `entity_type`. A Evolução
 * por Placa aceita (`tipo`), mas a leitura ponta a ponta (`end-to-end.ts`) só
 * aceita uma lista de atributos — e as duas precisam responder pelo **mesmo**
 * recorte quando a aba Cavalo está aberta, ou a tela publica a variação ponta a
 * ponta do acervo inteiro sob o título de um equipamento só.
 *
 * A tradução é exata, e não uma aproximação: cada variável de FINAME tem um
 * código por equipamento (`cavalo.finame_cavalo` e `carreta.finame_implemento`
 * são atributos distintos), então filtrar pelos códigos de um lado é o mesmo
 * conjunto de linhas que filtrar pelo `entity_type` daquele lado.
 */
export function codigosDoRecorte(
  recorte: "TODOS" | "CAVALO" | "CARRETA",
  variaveis: readonly VariavelDeFiname[] = VARIAVEIS_DE_FINAME,
): string[] {
  if (recorte === "TODOS") return codigosDe(variaveis);
  const codigos = new Set<string>();
  for (const v of variaveis) {
    const codigo = v.codigo[recorte];
    if (codigo) codigos.add(codigo);
  }
  return [...codigos].sort();
}

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
  /**
   * O prazo do financiamento deste veículo, em meses — contexto da linha, não
   * comparação.
   *
   * Uma amortização que cai para R$ 0,00 e um prazo de 60 meses contados desde
   * 2019 são a mesma frase: o contrato acabou. Sem o período ao lado, quem lê a
   * tabela tem de abrir o detalhe de cada placa para saber se a queda é o fim
   * do financiamento ou um erro de digitação da planilha.
   *
   * Vem da leitura da vigência comparada (`periodo_finame`), com a base como
   * segunda opção para o veículo que saiu — e **nulo quando nenhuma das duas
   * pontas declarou o prazo**, porque ausência aqui também não vira zero. Quem
   * o preenche é {@link comContextoDoVeiculo}; as duas fábricas de linha nascem
   * com ele nulo, já que o `change_set` sozinho não conhece o prazo de um
   * veículo cuja linha de prazo não mudou.
   */
  periodoFiname: string | null;
  /**
   * A data de cadastro do veículo — a entrada dele na frota, como a fonte a
   * entregou (`cavalo.data` / `carreta.data`).
   *
   * Contexto pela mesma razão do prazo, e lida do mesmo jeito: a idade do
   * cadastro é o que diz se a parcela que sumiu pertence a um veículo de 2019 —
   * financiamento no fim — ou a um que entrou no mês passado, onde a mesma queda
   * é suspeita de erro de planilha. Nula quando nenhuma das duas pontas declarou
   * a data.
   */
  dataDeCadastro: string | null;
  /**
   * O fim do contrato de financiamento deste veículo, como a fonte o entregou
   * (`cavalo.data_fim_contrato` / `carreta.data_fim_contrato`).
   *
   * Contexto pela mesma razão das duas colunas acima, e a mais direta das três:
   * uma amortização em R$ 0,00 ao lado de um fim de contrato já vencido é o
   * financiamento que terminou — a leitura que antes exigia abrir a expansão e
   * achar a linha da data no meio das outras treze. Nula quando nenhuma das duas
   * pontas declarou a data.
   */
  fimDoContrato: string | null;
  impactoAmount: number | null;
  impactoPeriodicidade: string | null;
  impactoCalculado: boolean;
  /**
   * O aviso da coluna que não soma neste módulo, quando esta linha é de uma
   * delas. Nulo nas demais.
   *
   * A linha continua na tabela e continua contada em "variáveis alteradas": o
   * que ela não faz é entrar no impacto — ver {@link VariavelDeFiname.foraDaSoma}.
   */
  foraDaSoma: string | null;
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
      periodoFiname: null,
      dataDeCadastro: null,
      fimDoContrato: null,
      impactoAmount: null,
      impactoPeriodicidade: null,
      impactoCalculado: false,
      foraDaSoma: null,
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
    periodoFiname: null,
    dataDeCadastro: null,
    fimDoContrato: null,
    impactoAmount: numero(a.impactAmount),
    impactoPeriodicidade: a.impactPeriodicity ?? null,
    impactoCalculado: a.impactConfidence === "CALCULATED",
    foraDaSoma: variavel.foraDaSoma ?? null,
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
    periodoFiname: null,
    dataDeCadastro: null,
    fimDoContrato: null,
    impactoAmount: null,
    impactoPeriodicidade: null,
    impactoCalculado: false,
    foraDaSoma: variavel.foraDaSoma ?? null,
  };
}

// ---------------------------------------------------------------------------
// O contexto do veículo — as colunas que não são comparação
// ---------------------------------------------------------------------------

/** As três variáveis de contexto. Lidas do catálogo, nunca redigitadas. */
const PRAZO = VARIAVEIS_DE_FINAME.find((v) => v.chave === "prazo");
const DATA_DE_CADASTRO = VARIAVEIS_DE_FINAME.find((v) => v.chave === "data_de_entrada");
const FIM_DO_CONTRATO = VARIAVEIS_DE_DETALHE.find((v) => v.chave === "data_fim_contrato");

/**
 * Os códigos do prazo, da data de entrada e do fim do contrato, por tipo.
 *
 * É o recorte que a rota lê das duas vigências para preencher as colunas de
 * contexto: três atributos, e não a tabela inteira.
 */
export const CODIGOS_DO_CONTEXTO: string[] = codigosDe(
  [PRAZO, DATA_DE_CADASTRO, FIM_DO_CONTRATO].filter(
    (v): v is VariavelDeFiname => v !== undefined,
  ),
);

/** O código do prazo de um tipo de equipamento, quando ele o tem. */
export function codigoDoPeriodo(entityType: string): string | undefined {
  return PRAZO ? codigoDaVariavel(PRAZO, entityType) : undefined;
}

/** O código da data de cadastro de um tipo de equipamento, quando ele o tem. */
export function codigoDaDataDeCadastro(entityType: string): string | undefined {
  return DATA_DE_CADASTRO ? codigoDaVariavel(DATA_DE_CADASTRO, entityType) : undefined;
}

/** O código do fim do contrato de um tipo de equipamento, quando ele o tem. */
export function codigoDoFimDoContrato(entityType: string): string | undefined {
  return FIM_DO_CONTRATO ? codigoDaVariavel(FIM_DO_CONTRATO, entityType) : undefined;
}

/** O contexto de um veículo, do jeito que a leitura da vigência o entrega. */
export interface ContextoDoVeiculo {
  entityLabel: string | null;
  entityType: string;
  /** `null` quando a vigência não declarou o prazo daquele veículo. */
  periodo: string | null;
  /** `null` quando a vigência não declarou a data de cadastro. */
  dataDeCadastro: string | null;
  /** `null` quando a vigência não declarou o fim do contrato. */
  fimDoContrato: string | null;
}

/**
 * As linhas com o prazo, a data de cadastro e o fim do contrato ao lado.
 *
 * Duas listas, e não uma: a comparada manda, e a base entra só onde a comparada
 * não tem o veículo — é o caso do `AUSENTE_NA_COMPARADA`, cuja linha ficaria sem
 * contexto justamente quando o contexto explica a saída. A ordem das linhas não
 * muda, e nenhuma linha é criada ou removida aqui: a função só preenche duas
 * colunas.
 *
 * Um campo que nenhuma das duas pontas declarou continua nulo. Escrever "0
 * meses" ali diria que o financiamento acabou — que é exatamente a leitura que
 * esta coluna existe para sustentar, e que ninguém pode sustentar sobre um campo
 * em branco.
 */
export function comContextoDoVeiculo(
  linhas: readonly LinhaDeFiname[],
  contexto: {
    comparada: readonly ContextoDoVeiculo[];
    base?: readonly ContextoDoVeiculo[];
  },
): LinhaDeFiname[] {
  const periodos = new Map<string, string>();
  const datas = new Map<string, string>();
  const fins = new Map<string, string>();
  /* A base primeiro, a comparada por cima: quem está nas duas fica com o valor
     da comparada, e quem só está na base conserva o dela. */
  for (const c of [...(contexto.base ?? []), ...contexto.comparada]) {
    const chave = chaveDoVeiculo(c);
    if (c.periodo !== null && c.periodo !== "") periodos.set(chave, c.periodo);
    if (c.dataDeCadastro !== null && c.dataDeCadastro !== "") {
      datas.set(chave, c.dataDeCadastro);
    }
    if (c.fimDoContrato !== null && c.fimDoContrato !== "") {
      fins.set(chave, c.fimDoContrato);
    }
  }
  return linhas.map((l) => {
    const chave = chaveDoVeiculo(l);
    return {
      ...l,
      periodoFiname: periodos.get(chave) ?? null,
      dataDeCadastro: datas.get(chave) ?? null,
      fimDoContrato: fins.get(chave) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// O agrupamento por veículo — uma linha por placa
// ---------------------------------------------------------------------------

/**
 * Um veículo da tabela: a placa, o que ela moveu, e as linhas por baixo.
 *
 * O corpo do agrupamento mora em `agrupamento-por-veiculo.ts`, com as outras
 * três rubricas de custo fixo. O que continua sendo do FINAME são as três
 * colunas de contexto abaixo — e elas continuam aqui porque só ele as tem.
 */
export interface VeiculoDeFiname extends VeiculoDaRubrica<LinhaDeFiname> {
  /**
   * O prazo, a data de cadastro e o fim do contrato — do veículo, não da
   * variável, e por isso colunas da placa e não linhas da expansão.
   */
  periodoFiname: string | null;
  dataDeCadastro: string | null;
  fimDoContrato: string | null;
}

/**
 * A ordem em que a expansão lê as variáveis de uma placa, e quem é o destaque.
 *
 * A ordem é a do catálogo, e não a que o motor entrega. Na ordem do motor a
 * parcela FINAME caía no meio das duas parcelas que a compõem — "Amortização,
 * Parcela FINAME, Juros" —, e o número que a linha de cima mostra ficava entre
 * as duas metades dele: quem lê soma as três e chega ao dobro do que a placa
 * custa. O catálogo já começa na parcela e segue por juros e amortização, que é
 * a leitura que a tela quer — o total primeiro, o que o compõe logo abaixo.
 *
 * `veiculo` vem antes de tudo, porque entrada e saída de ativo explicam todas
 * as outras linhas da placa; e por isso mesmo fica **fora da contagem**, em vez
 * de fazer uma placa que só entrou na frota aparecer com "1 alteração".
 *
 * O destaque é a **parcela**, e não a soma das monetárias: somar parcela, juros,
 * amortização e valor de NF numa célula só juntaria o mesmo dinheiro escrito
 * três vezes (a parcela é juros + amortização) com um valor do ato da compra,
 * que nem periodicidade tem em comum com os outros — as duas recusas que
 * {@link impactoPorPeriodicidade} já faz para o recorte inteiro. A parcela é a
 * variável que o gráfico de totais soma, e é ela que a coluna mostra.
 */
export const AGRUPAMENTO_DE_FINAME = {
  ordemDasVariaveis: ["veiculo", ...TODAS.map((v) => v.chave)],
  destaque: "parcela",
  /* A unidade do destaque e a resposta a "esta rubrica tem dinheiro?" saem
     daqui — do mesmo catálogo que define a ordem da expansão, e nunca de
     uma segunda lista escrita à mão. */
  medidas: medidasDoCatalogo(TODAS),
  foraDaContagem: ["veiculo"],
} as const satisfies OpcoesDoAgrupamento;

/**
 * As linhas viradas uma linha por placa.
 *
 * A tabela nasceu por variável — uma linha por (veículo × variável) —, e com
 * catorze variáveis a mesma placa aparecia catorze vezes, espalhada por três
 * páginas: ler "o que aconteceu com a QYW6D15" era procurar as linhas dela na
 * lista. Agrupar responde essa pergunta de uma vez, e a lista de baixo continua
 * inteira dentro da placa.
 *
 * **Não recalcula nada.** Contagem, estado e destaque saem das linhas que o
 * motor já produziu; o contexto sai da primeira linha que o declara, porque ele
 * chega repetido em todas e nem todas o trazem.
 */
export function agruparPorVeiculo(
  linhas: readonly LinhaDeFiname[],
): VeiculoDeFiname[] {
  return agruparVeiculos(linhas, AGRUPAMENTO_DE_FINAME).map((v) => ({
    ...v,
    periodoFiname: contextoDasLinhas(v.linhas, (l) => l.periodoFiname),
    dataDeCadastro: contextoDasLinhas(v.linhas, (l) => l.dataDeCadastro),
    fimDoContrato: contextoDasLinhas(v.linhas, (l) => l.fimDoContrato),
  }));
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
  /**
   * Linhas retiradas do total por **pertencerem a outro módulo** — a base de
   * compra e os dois tributos da aquisição.
   *
   * Balde próprio, e não somado ao de cima, porque as duas exclusões respondem
   * perguntas diferentes: `cobertasPorParcelas` é dinheiro deste módulo já
   * contado noutra linha deste módulo; `foraDaSoma` é dinheiro que não é deste
   * módulo. Juntá-las esconderia justamente a distinção que a correção criou.
   */
  foraDaSoma: number;
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
 * **Não soma o que é rubrica de outro módulo.** O valor de nota é o preço do
 * ativo, e o ICMS e o PIS/COFINS da aquisição são tributos — os três estão na
 * tabela para **conferir** o financiamento, e quem os soma é Impostos (os
 * tributos) ou ninguém (a base). Até esta correção o FINAME os somava, e o
 * PIS/COFINS entrava ao mesmo tempo neste total e no de Impostos: a mesma
 * alteração, contada duas vezes, porque a semântica dela é confirmada e o motor
 * a precifica. O achado, a medição e a decisão estão em
 * `docs/ACHADO-DUPLA-CONTAGEM-CUSTO-FIXO.md`. É a mesma recusa que `ipva.ts` e
 * `impostos.ts` já faziam sobre a mesma coluna de base — o FINAME é que estava
 * fora de linha com os irmãos.
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
/**
 * Quais linhas saem do total por já estarem representadas nas parcelas delas.
 *
 * A chave é `entityLabel\u001f entityType\u001f variavel` — a identidade de uma
 * linha dentro do recorte.
 *
 * Saiu de dentro de {@link impactoPorPeriodicidade} para ser **uma** regra com
 * dois leitores: a soma deste módulo e o Monitor Custo Fixo, que precisa dizer,
 * linha a linha, por que ela não entrou no total. Enquanto esteve embutida no
 * laço, a única forma de o Monitor saber isso era reescrever a regra — e duas
 * redações da mesma exclusão produziriam duas respostas para o mesmo veículo.
 *
 * Nada mudou de comportamento na extração: o laço abaixo é o que estava lá.
 */
export function cobertasPorParcelasEm(
  linhas: readonly LinhaDeFiname[],
): ReadonlySet<string> {
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

  const cobertas = new Set<string>();
  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;
    if (l.foraDaSoma) continue;
    if (!l.impactoCalculado || l.impactoAmount === null) continue;
    const variavel = VARIAVEIS_DE_FINAME.find((v) => v.chave === l.variavel);
    const parcelas = variavel?.parcelas ?? [];
    if (parcelas.length === 0) continue;
    const mudaram = parcelasPorVeiculo.get(`${l.entityLabel}\u001f${l.entityType}`);
    if (parcelas.some((p) => mudaram?.has(p))) {
      cobertas.add(`${l.entityLabel}\u001f${l.entityType}\u001f${l.variavel}`);
    }
  }
  return cobertas;
}

export function impactoPorPeriodicidade(
  linhas: readonly LinhaDeFiname[],
): ImpactoDeFiname {
  const cobertas = cobertasPorParcelasEm(linhas);

  const porPeriodicidade: Record<string, number> = {};
  let naoCalculavel = 0;
  let cobertasPorParcelas = 0;
  let foraDaSoma = 0;

  for (const l of linhas) {
    if (l.estado !== "ALTERADO") continue;
    /*
      A coluna de outro módulo sai antes da pergunta "o motor precificou?", como
      em `ipva.ts` e `impostos.ts`: não precificar uma coluna que não é deste
      módulo não é falha de precificação **deste** módulo, e contá-la em
      `naoCalculavel` mandaria alguém procurar uma curadoria que já existe do
      outro lado.
    */
    if (l.foraDaSoma) {
      foraDaSoma++;
      continue;
    }
    if (!l.impactoCalculado || l.impactoAmount === null) {
      // Só conta como "não precificado" o que era candidato a dinheiro. Prazo e
      // taxa não são falha de cálculo: não são dinheiro, e dizer que faltou
      // precificá-los seria prometer uma conversão que não existe.
      if (l.medida === "DINHEIRO") naoCalculavel++;
      continue;
    }

    if (cobertas.has(`${l.entityLabel}\u001f${l.entityType}\u001f${l.variavel}`)) {
      cobertasPorParcelas++;
      continue;
    }

    const balde = l.impactoPeriodicidade ?? "SEM_PERIODICIDADE";
    porPeriodicidade[balde] = (porPeriodicidade[balde] ?? 0) + l.impactoAmount;
  }

  for (const balde of Object.keys(porPeriodicidade)) {
    porPeriodicidade[balde] = Number(porPeriodicidade[balde].toFixed(6));
  }
  return { porPeriodicidade, naoCalculavel, cobertasPorParcelas, foraDaSoma };
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

/**
 * Quantas alterações cada variável teve, da maior para a menor.
 *
 * **Percorre o catálogo inteiro — o da tabela e o do detalhe.** A barra existe
 * para a variável que se moveu, e não para a variável que a tabela mostra: a
 * TJLP muda para a frota toda de uma vez, e enquanto esta função só olhava
 * `VARIAVEIS_DE_FINAME` aquelas alterações não apareciam em barra nenhuma. O
 * efeito era o cartão dizer "31 variáveis alteradas" ao lado de um gráfico que
 * somava 19, sobre exatamente as mesmas linhas — a diferença eram as doze
 * alterações de variável de detalhe, caladas por um filtro.
 *
 * Com o catálogo inteiro, a soma das barras é a mesma `variaveisAlteradas` do
 * cartão, que é o que quem lê supõe ao ver os dois lado a lado. O total
 * composto da carreta continua fora, mas por onde sempre esteve: ele nem chega
 * a virar linha ({@link linhaDaAlteracao}).
 */
export function alteracoesPorVariavel(
  linhas: readonly LinhaDeFiname[],
): AlteracoesDaVariavel[] {
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

/**
 * A diferença de um tipo, aberta nas três parcelas que a produzem.
 *
 * O total de cada ponta inclui quem não mudou, quem só a base tem e quem só a
 * comparada tem — e era isso que fazia a diferença do painel não reconciliar
 * com a tabela, que só mostra diferença para quem está nas duas. As três
 * parcelas são a conta inteira, e a identidade é exata:
 *
 * ```
 * base + alterados + entradas − saidas = comparada
 * ```
 *
 * Sem ela o painel dizia "+35,66%" sobre uma frota em que vinte carretas
 * saíram e dezoito entraram, e quem lia entendia reajuste de contrato.
 */
export interface EvolucaoDoTipo {
  entityType: string;
  /** O total da ponta base — o mesmo de {@link totaisPorVigencia}. */
  base: number;
  comparada: number;
  /** Σ(comparada − base) dos veículos com parcela nas **duas** pontas. */
  alterados: number;
  /** Σ da parcela de quem só a comparada tem — frota que entrou. */
  entradas: number;
  /**
   * Σ da parcela de quem só a base tem — frota que saiu.
   *
   * Positivo, e **subtraído** na identidade: escrevê-lo negativo obrigaria
   * quem lê a somar três números de sinais misturados para conferir um quarto.
   */
  saidas: number;
  /** Veículos nas duas pontas cuja parcela se moveu — os que valem a soma. */
  veiculosAlterados: number;
  veiculosEntradas: number;
  veiculosSaidas: number;
}

/**
 * A evolução de cada tipo, decomposta — a mesma leitura que os totais.
 *
 * Recebe as duas leituras de vigência com **o veículo de cada valor**, porque
 * a classificação é por veículo: o mesmo real entra em `alterados` ou em
 * `entradas` conforme a outra ponta tenha ou não aquele veículo, e uma soma por
 * tipo não sabe dizer qual dos dois.
 *
 * Um veículo cuja parcela é nula numa das pontas conta como entrada ou saída —
 * é o que o dinheiro faz no total, que é a pergunta desta função. Ele pode não
 * estar na aba Novos nem na Ausentes da tabela, que contam **veículo** e não
 * parcela; por isso o painel diz "veíc. com parcela", e não "novos".
 */
export function evolucaoPorTipo(
  valores: readonly {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    /** Quem sustenta o valor. Sem ele não há como saber se o veículo tem as duas pontas. */
    entityId: string;
    attributeCode: string;
    valor: number | null;
  }[],
): EvolucaoDoTipo[] {
  /* Um mapa por tipo, e dentro dele um par de valores por veículo: `undefined`
     é "aquela ponta não tem parcela deste veículo", que é justamente o que
     separa uma entrada de uma alteração. */
  const porTipo = new Map<string, Map<string, { base?: number; comparada?: number }>>();
  for (const v of valores) {
    const variavel = variavelDoCodigo(v.attributeCode);
    if (!variavel || variavel.chave !== "parcela" || v.valor === null) continue;
    const veiculos = porTipo.get(v.entityType) ?? new Map();
    const atual = veiculos.get(v.entityId) ?? {};
    if (v.ponta === "BASE") atual.base = (atual.base ?? 0) + v.valor;
    else atual.comparada = (atual.comparada ?? 0) + v.valor;
    veiculos.set(v.entityId, atual);
    porTipo.set(v.entityType, veiculos);
  }

  const duasCasas = (n: number) => Number(n.toFixed(2));

  return [...porTipo.entries()]
    .map(([entityType, veiculos]) => {
      const e: EvolucaoDoTipo = {
        entityType,
        base: 0,
        comparada: 0,
        alterados: 0,
        entradas: 0,
        saidas: 0,
        veiculosAlterados: 0,
        veiculosEntradas: 0,
        veiculosSaidas: 0,
      };
      for (const { base, comparada } of veiculos.values()) {
        e.base += base ?? 0;
        e.comparada += comparada ?? 0;
        if (base !== undefined && comparada !== undefined) {
          const delta = comparada - base;
          e.alterados += delta;
          /* Quem não se moveu não é contado: ele contribui zero para a soma, e
             um contador que o incluísse diria "412 veíc." ao lado de R$ 0,00. */
          if (delta !== 0) e.veiculosAlterados += 1;
        } else if (comparada !== undefined) {
          e.entradas += comparada;
          e.veiculosEntradas += 1;
        } else if (base !== undefined) {
          e.saidas += base;
          e.veiculosSaidas += 1;
        }
      }
      return {
        ...e,
        base: duasCasas(e.base),
        comparada: duasCasas(e.comparada),
        alterados: duasCasas(e.alterados),
        entradas: duasCasas(e.entradas),
        saidas: duasCasas(e.saidas),
      };
    })
    .sort((a, b) => a.entityType.localeCompare(b.entityType));
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/** O cabeçalho do CSV — a ordem das colunas da tela. */
export const COLUNAS_DO_CSV = [
  "Veículo",
  "Tipo",
  "Período FINAME",
  "Data de cadastro",
  "Variável",
  "Vigência Base",
  "Vigência Comparada",
  "Diferença",
  "Variação %",
  "Status",
  "Motivo",
  "Fora da soma",
  "Justificativa",
] as const;

/**
 * Uma linha da tabela como as treze células do CSV.
 *
 * Devolve texto cru — sem `R$`, sem separador de milhar e sem decidir o
 * separador do arquivo. Quem escreve o CSV é `lib/csv.ts`, no cliente, que já
 * sabe o que o Excel brasileiro espera; repetir aquela decisão aqui daria duas
 * regras para o mesmo arquivo.
 *
 * A justificativa entra por parâmetro porque **não é da linha**: ela é do
 * gestor, mora em `justificativa` e é lida por `change_id` numa segunda
 * consulta. Guardá-la dentro de `LinhaDeFiname` faria a comparação carregar um
 * texto que o motor não produziu — e que muda sem a comparação mudar.
 */
export function celulasDoCsv(
  l: LinhaDeFiname,
  justificativa?: string | null,
): (string | number | null)[] {
  return [
    l.entityLabel,
    l.entityType,
    l.periodoFiname,
    l.dataDeCadastro,
    l.rotuloDaVariavel,
    l.base,
    l.comparada,
    l.diferenca,
    l.variacao,
    ROTULO_DO_ESTADO[l.estado],
    l.motivo,
    /*
      A razão de a linha não entrar no impacto viaja com ela, como no CSV de
      IPVA e no de Impostos: o arquivo sai do produto e vira soma na planilha de
      outra pessoa, e uma coluna de tributo exportada sem dizer que ela pertence
      a outro módulo é a dupla contagem saindo de casa pela porta da frente.
    */
    l.foraDaSoma,
    justificativa ?? null,
  ];
}

// ---------------------------------------------------------------------------
// O recorte da tela — e por que ele mora aqui
// ---------------------------------------------------------------------------

/**
 * Os filtros da Auditoria de FINAME — o que as caixas acima da tabela recortam.
 *
 * Eles nasceram em `lib/finame.ts`, do lado da interface, e era o lugar certo
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
export type FiltrosDeFiname = {
  busca: string;
  /** `TODOS`, ou um `entity_type` — o recorte de equipamento. */
  tipo: string;
  /** `TODAS`, ou a chave da variável. */
  variavel: string;
  estado: "TODAS" | EstadoDaLinhaDeFiname;
}

export const FILTROS_DE_FINAME_VAZIOS: FiltrosDeFiname = {
  busca: "",
  tipo: "TODOS",
  variavel: "TODAS",
  estado: "TODAS",
};

/**
 * O recorte da tabela — o mesmo que alimenta a contagem das abas, o CSV e o
 * universo do lote.
 *
 * Uma função só, e não uma por consumidor: a aba que diz "12" sobre uma tabela
 * de 9 linhas é o defeito que aparece quando o filtro é reescrito em vez de
 * reutilizado, e no lote ele seria pior — gravaria a frase em linhas fora do
 * recorte.
 */
export function filtrarLinhasDeFiname(
  linhas: readonly LinhaDeFiname[],
  filtros: FiltrosDeFiname,
): LinhaDeFiname[] {
  const busca = filtros.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (filtros.estado !== "TODAS" && l.estado !== filtros.estado) return false;
    if (filtros.tipo !== "TODOS" && l.entityType !== filtros.tipo) return false;
    if (filtros.variavel !== "TODAS" && l.variavel !== filtros.variavel) return false;
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
 * O universo de um lote é decidido por estes campos, e é ele que decide o que
 * recebe justificativa: um `estado` que o cliente inventasse não pode virar um
 * recorte que ninguém viu. O que não é reconhecido cai no valor vazio, que é o
 * recorte mais largo — e o mais largo é, por construção, o que a tela mostra
 * quando ninguém filtrou nada.
 */
export function lerFiltrosDeFiname(bruto: unknown): FiltrosDeFiname {
  const objeto = (bruto ?? {}) as Record<string, unknown>;
  const texto = (chave: string, padrao: string): string =>
    typeof objeto[chave] === "string" ? (objeto[chave] as string) : padrao;
  const estado = texto("estado", "TODAS");
  return {
    ...FILTROS_DE_FINAME_VAZIOS,
    busca: texto("busca", ""),
    tipo: texto("tipo", "TODOS"),
    variavel: texto("variavel", "TODAS"),
    estado:
      estado === "TODAS" || GRAVIDADE.includes(estado as EstadoDaLinhaDeFiname)
        ? (estado as FiltrosDeFiname["estado"])
        : "TODAS",
  };
}
