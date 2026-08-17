/**
 * Proposing what a variable means — and refusing to decide it.
 *
 * Everything in this file produces a *proposal*. The engine may move an
 * attribute from UNKNOWN to PRESUMED and write down why; only a human moves it
 * to CONFIRMED, and only CONFIRMED attributes will ever reach the financial
 * engine in F4. The database enforces that split, so a bug here cannot leak a
 * guess into a number.
 */

import { ehTipoNumerico } from "./agregacao";

export type Unit =
  | "BRL"
  | "BRL_KM"
  | "KM_L"
  | "PERCENT"
  | "KM"
  | "LITROS"
  | "MESES"
  | "ANO"
  | "QTD";

export type Aggregation = "SUM" | "AVG" | "WEIGHTED_AVG" | "NONE";
export type Periodicity = "MENSAL" | "ANUAL" | "PONTUAL";

export interface AttributeEvidence {
  code: string;
  sourceName: string;
  entityType: string;
  dataType: string;
  valueCount: number;
  nullCount: number;
  distinctCount: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  /** Sum over the most recent snapshot. Raw, unaudited — ordering only. */
  latestSum: number | null;
  zeroCount: number;
  negativeCount: number;
}

export interface SemanticsProposal {
  unit: Unit | null;
  periodicity: Periodicity | null;
  aggregation: Aggregation | null;
  isMonetary: boolean | null;
  taxonomyCode: string;
  /** Plain-language justification, stored on the attribute. */
  rationale: string;
  /** PRESUMED when the evidence supports a proposal, UNKNOWN when it does not. */
  status: "PRESUMED" | "UNKNOWN";
}

const has = (name: string, ...needles: string[]) =>
  needles.some((n) => name.includes(n));

/**
 * Columns whose name claims a periodicity.
 *
 * The claim is never trusted on its own: see {@link detectPeriodicityConflicts}.
 */
const MONTHLY_SUFFIX = "_mensal";

/**
 * Below this, a "cost" is far more likely to be a rate than an amount.
 * Calibrated against the real export: the cheapest genuine per-asset amount is
 * in the hundreds, while every rate column sits in the single digits.
 */
const MIN_PLAUSIBLE_AMOUNT = 100;

interface UnitGuess {
  unit: Unit | null;
  monetary: boolean;
  reason: string;
}

function guessUnit(evidence: AttributeEvidence): UnitGuess {
  const n = evidence.code.split(".").slice(1).join(".");

  if (evidence.dataType === "BOOLEAN") {
    return { unit: null, monetary: false, reason: "Valor booleano." };
  }
  if (evidence.dataType === "TEXT" || evidence.dataType === "MIXED") {
    return {
      unit: null,
      monetary: false,
      reason:
        evidence.dataType === "MIXED"
          ? "A fonte entrega esta coluna com mais de um tipo; unidade indeterminável até a curadoria decidir."
          : "Valor textual.",
    };
  }

  if (has(n, "percentual", "percent")) {
    return { unit: "PERCENT", monetary: false, reason: 'Nome indica percentual.' };
  }
  if (has(n, "reais_km", "reaiskm") || (has(n, "manutencao") && has(n, "bid"))) {
    return {
      unit: "BRL_KM",
      monetary: false,
      reason: "Nome indica valor por quilômetro — razão, não montante.",
    };
  }
  if (has(n, "consumo") && evidence.max !== null && evidence.max <= 20) {
    return {
      unit: "KM_L",
      monetary: false,
      reason: `Nome indica consumo e os valores ficam entre ${evidence.min} e ${evidence.max} — compatível com km/l.`,
    };
  }
  if (has(n, "vida_meses", "vida_cavalo", "_meses")) {
    return { unit: "MESES", monetary: false, reason: "Nome indica prazo em meses." };
  }
  if (
    n === "ano" ||
    n.endsWith("_ano") ||
    (has(n, "ano") && evidence.min !== null && evidence.min >= 1990 && evidence.max !== null && evidence.max <= 2100)
  ) {
    return {
      unit: "ANO",
      monetary: false,
      reason: `Valores entre ${evidence.min} e ${evidence.max} — é um ano de calendário, não uma quantidade.`,
    };
  }
  if (has(n, "odometro", "faixa_km") || n.endsWith("_km")) {
    return { unit: "KM", monetary: false, reason: "Nome indica quilometragem." };
  }
  if (has(n, "capacidade") && has(n, "combustivel")) {
    return { unit: "LITROS", monetary: false, reason: "Capacidade de tanque." };
  }
  if (
    has(
      n,
      "valor",
      "custo",
      "preco",
      "amortizacao",
      "finame",
      "juros",
      "seguro",
      "ipva",
      "lucro",
      "aluguel",
      "icms",
      "pis_cofins",
      "licenciamento",
    ) &&
    !has(n, "percentual", "taxa", "spread")
  ) {
    /**
     * The name says money; the magnitude has to agree.
     *
     * `Custo Variável Simulado` is named like an amount and holds 3.66 — it is
     * R$/km, and proposing SUM for it would reproduce the exact error this
     * product exists to catch (summing 62 plates into a meaningless "R$ 258").
     * A per-asset amount in this fleet is in the hundreds at least, so a
     * maximum below that is evidence against "amount", not for it.
     */
    if (evidence.max !== null && evidence.max > 0 && evidence.max < MIN_PLAUSIBLE_AMOUNT) {
      return {
        unit: null,
        monetary: false,
        reason:
          `O nome sugere um montante financeiro, mas o maior valor observado é ${evidence.max} — ` +
          `pequeno demais para um valor por ativo desta frota e compatível com uma taxa ` +
          `(R$/km, R$/hora). Somar seria errado. Unidade não proposta; precisa de curadoria.`,
      };
    }
    return {
      unit: "BRL",
      monetary: true,
      reason: "Nome indica montante financeiro e a ordem de grandeza é compatível.",
    };
  }
  if (has(n, "taxa", "spread", "tjlp")) {
    return {
      unit: "PERCENT",
      monetary: false,
      reason: "Nome indica taxa/spread — percentual, não montante.",
    };
  }
  if (has(n, "carencia", "ciclo", "periodo", "prazo", "count", "quantidade")) {
    return { unit: "QTD", monetary: false, reason: "Nome indica contagem ou prazo." };
  }
  return {
    unit: null,
    monetary: false,
    reason: "Não há evidência suficiente no nome nem nos valores para propor uma unidade.",
  };
}

function guessAggregation(unit: Unit | null, dataType: string): {
  aggregation: Aggregation | null;
  reason: string;
} {
  /*
    "Tipo desconhecido" e "tipo que não agrega" não são a mesma resposta.

    A lista de tipos morava aqui, escrita à mão, e esquecia `UNKNOWN` — foi o
    que fez `prazoPagamento`, uma coluna sem tipo e sem uma única linha
    preenchida, receber "média simples". A pergunta passou a ser da autoridade,
    que é a mesma que a constraint do banco espelha.

    Mas devolver `NONE` para `UNKNOWN` trocaria um erro por um exagero: `NONE`
    é uma constatação — "este valor não admite aritmética" —, e sobre uma coluna
    que o import nunca viu preenchida não há constatação nenhuma a fazer. Ela
    fica sem proposta, que é o que mantém as oito colunas vazias do export em
    UNKNOWN em vez de promovê-las a "presumido" sem uma linha de evidência.
  */
  if (dataType === "UNKNOWN") {
    return {
      aggregation: null,
      reason: "O import não observou nenhum valor: sem tipo, não há agregação a propor.",
    };
  }
  if (!ehTipoNumerico(dataType)) {
    return { aggregation: "NONE", reason: "Não numérico — não agrega." };
  }
  switch (unit) {
    case "BRL":
      return { aggregation: "SUM", reason: "Montante em reais por ativo — somável na frota." };
    case "BRL_KM":
    case "KM_L":
    case "PERCENT":
      return {
        aggregation: "NONE",
        reason:
          "É uma razão. Somar não faz sentido e a média ponderada exigiria um peso (quilometragem) que não vem neste export.",
      };
    case "ANO":
      return { aggregation: "NONE", reason: "Ano de calendário — não é quantidade." };
    case "MESES":
    case "KM":
    case "LITROS":
    case "QTD":
      return { aggregation: "AVG", reason: "Grandeza física por ativo; a média descreve a frota." };
    default:
      return {
        aggregation: null,
        reason: "Sem unidade definida, a forma de agregação não pode ser proposta.",
      };
  }
}

/** Onde o atributo cai na árvore, e a frase que sustenta a escolha. */
export interface TaxonomyGuess {
  code: string;
  /** Vai para a justificativa gravada no evento de curadoria. */
  reason: string;
}

/**
 * Name-based placement in the tree. A proposal, like everything else here.
 *
 * **Cost patterns are tested before descriptive ones, and the order matters.**
 * The reverse order shipped first and misfiled five attributes that carry real
 * money: `finameImplemento` matched "implemento" and landed under technical
 * specification; `lucroFixomodeloNovoCiclo` matched "modelo" and landed under
 * asset identification. The filter on the Alterações screen was answering
 * "custo fixo ou variável?" wrongly for R$ 6.094,94 per trailer of financing.
 *
 * A descriptive word appearing inside a cost column's name is common; the
 * reverse — a cost word inside a genuinely descriptive column — is not. So
 * money wins the tie.
 *
 * **Palavra de assunto não é palavra de dinheiro, e não ganha a mesma
 * desempate.** A reordenação acima levou junto `combustivelCapacidade`, que não
 * tem palavra de dinheiro nenhuma: "combustivel" é o assunto do bloco em que a
 * coluna está, e capacidade continua sendo especificação do ativo. O teste que
 * travava a colocação anterior citava a mesma auditoria dos cinco — e ela nunca
 * tratou deste caso. Corrigido em 16/08/2026, com a evidência abaixo.
 *
 * **E o nome não vê o valor.** Quatro colunas do implemento não têm palavra de
 * custo alguma e mesmo assim são montante: a planilha de classificação do time
 * — a leitura de quem opera, e a fonte de maior força de prova deste
 * repositório — põe as quatro no valor fixo, e os valores no export real são
 * R$ com dois decimais. Uma regra que só lê nome não tem como saber disso, e é
 * por isso que elas entram nomeadas.
 */
export function guessTaxonomyCode(code: string, entityType: string): TaxonomyGuess {
  const n = code.split(".").slice(1).join(".");
  const em = (code: string, reason: string): TaxonomyGuess => ({ code, reason });

  if (n === "custo_fixo")
    return em(
      entityType === "CAVALO" ? "cf_frota_cavalo" : "cf_frota_carreta",
      "É o custo fixo do próprio equipamento.",
    );
  if (has(n, "amortizacao")) return em("cf_depreciacao", "Nome indica amortização.");
  if (has(n, "finame", "juros", "spread", "tjlp", "taxa", "financiamento", "percentual_entrada"))
    return em("cf_financiamento", "Nome indica financiamento, juros ou taxa.");
  if (has(n, "ipva", "licenciamento", "seguro", "icms", "pis_cofins"))
    return em("cf_seguros_tributos", "Nome indica seguro ou tributo.");
  if (has(n, "lucro_fixo")) return em("cf_remuneracao_capital", "Nome indica lucro fixo.");
  if (has(n, "lucro_variavel")) return em("cv_lucro_variavel", "Nome indica lucro variável.");

  /*
    A capacidade é lida antes do assunto, e depois do dinheiro.

    `combustivelCapacidade` vale 28 e 42 no export real, e a coluna
    `capacidadeEmpurrada` da carreta escreve "Pallets: 28" ao lado — é a
    capacidade de carga do conjunto, e não litros de tanque. Seja qual for a
    grandeza, capacidade é especificação: não é consumo, e a tabela de
    classificação do time diz o mesmo com todas as letras ("é especificação do
    veículo, não consumo — não mexe em valor nenhum da remuneração").

    Fica **depois** das regras de dinheiro de propósito: o desempate que a
    auditoria estabeleceu é dinheiro sobre descritivo, e este não o afrouxa.
  */
  if (has(n, "capacidade"))
    return em(
      "cad_especificacao",
      "Capacidade é especificação do ativo — a palavra do assunto no nome não a torna consumo.",
    );

  if (has(n, "combustivel", "consumo")) return em("cv_combustivel", "Nome indica combustível ou consumo.");
  if (has(n, "manutencao", "free_maintenance")) return em("cv_manutencao", "Nome indica manutenção.");
  if (has(n, "pneu")) return em("cv_pneus", "Nome indica pneu.");
  if (has(n, "custo_variavel", "reais_km")) return em("cv_outros", "Nome indica custo variável.");
  if (has(n, "custo_aluguel", "valor_nf_compra"))
    return em("cf_outros", "Nome indica valor de aquisição ou aluguel do ativo.");

  /*
    Os itens do implemento, nomeados um a um.

    `faixa_reflexiva`, `revestimento`, `tacografo` e `rastreador` são as quatro
    colunas que a planilha do time classifica como valor fixo e que nenhuma
    palavra do nome delas denuncia como dinheiro. Os valores confirmam: R$ 15,94,
    R$ 277,94, R$ 21,03 e R$ 0,00, constantes por implemento e com dois decimais
    — um descritivo seria inteiro ou categoria. `rastreador` vem zerado neste
    export inteiro, então para ele a evidência é só a planilha; entra junto por
    ser a mesma família de colunas.

    `faixa_reflexiva` é nomeada inteira, e não por "faixa": `faixaKm` é a faixa
    de quilometragem do cavalo, e mandá-la para custo fixo seria trocar um erro
    por outro.
  */
  if (has(n, "faixa_reflexiva", "revestimento", "tacografo", "rastreador"))
    return em(
      "cf_outros",
      "Item do implemento que a planilha de classificação do time põe no valor fixo, com valores em R$ no export.",
    );

  if (has(n, "unidade", "operador", "organizacao", "regiao", "prazo_pagamento"))
    return em("cad_escopo", "Nome indica escopo organizacional.");
  if (has(n, "chassi", "placa", "modelo", "montadora", "empresa_locadora") || n === "id" || n === "ano")
    return em("cad_identificacao", "Nome identifica o ativo.");
  if (has(n, "data", "vigencia", "carencia", "periodo", "mes_de_entrada", "ciclo", "contrato", "bid"))
    return em("cad_contrato", "Nome indica contrato ou vigência.");
  if (has(n, "eixo", "cambio", "padrao", "medida", "double_deck", "faixa", "carroceria", "implemento", "frota_emprestada", "ativo", "odometro"))
    return em("cad_especificacao", "Nome descreve a especificação técnica do ativo.");

  return em("nao_classificado", "Nenhum padrão de nome reconhecido.");
}

/**
 * Build a proposal from the evidence.
 *
 * Periodicity is deliberately never inferred from a column name. In this
 * export the names are demonstrably unreliable — `ipvaLicenciamentoMensal`
 * holds values four to twelve times *larger* than the supposedly annual
 * `ipvaLicenciamento` — so a name-based guess would be exactly the error the
 * product exists to catch.
 */
export function proposeSemantics(evidence: AttributeEvidence): SemanticsProposal {
  const unitGuess = guessUnit(evidence);
  const aggGuess = guessAggregation(unitGuess.unit, evidence.dataType);
  const taxonomy = guessTaxonomyCode(evidence.code, evidence.entityType);

  /*
    O porquê da classe entra na justificativa, e não só o nó escolhido.

    A colocação na árvore é o que responde "custo fixo ou variável?" nas telas,
    e o evento de curadoria gravava a mudança de `taxonomy_node_id` com a
    justificativa da *unidade* ao lado — quem fosse auditar por que uma coluna
    virou custo variável lia uma frase sobre km/l. A razão da classe passa a
    viajar junto com ela.
  */
  const parts = [unitGuess.reason, aggGuess.reason, `Classe: ${taxonomy.reason}`];
  if (unitGuess.monetary) {
    parts.push(
      "Periodicidade NÃO proposta: os nomes de coluna deste export não são confiáveis para distinguir mensal de anual. Precisa de confirmação humana.",
    );
  }

  const status: "PRESUMED" | "UNKNOWN" =
    unitGuess.unit !== null || aggGuess.aggregation === "NONE" ? "PRESUMED" : "UNKNOWN";

  return {
    unit: unitGuess.unit,
    periodicity: null,
    aggregation: aggGuess.aggregation,
    isMonetary: unitGuess.unit === null ? null : unitGuess.monetary,
    taxonomyCode: taxonomy.code,
    rationale: parts.join(" "),
    status,
  };
}

/**
 * Per-entity relationship between two columns whose names suggest they are the
 * same quantity at different periodicities.
 *
 * Aggregate sums cannot tell "same quantity, mislabelled periodicity" from
 * "two different quantities sharing a name prefix". The per-asset ratio can:
 * one base measured twice yields a tight ratio, two different bases do not.
 */
export interface PairRatioStats {
  /** Assets carrying a usable value on both sides. */
  sampleSize: number;
  meanRatio: number;
  stddevRatio: number;
  minRatio: number;
  maxRatio: number;
}

export type NamePairVerdict =
  /** Tight ratio and consistent with a monthly/annual split. Nothing to flag. */
  | "CONSISTENT"
  /** Tight ratio, but the value contradicts what the names claim. */
  | "PERIODICITY_CONTRADICTION"
  /** Ratio all over the place: these are different quantities. */
  | "DISTINCT_BASES"
  /** Not enough paired observations to say anything. */
  | "INSUFFICIENT_DATA";

export interface PeriodicityConflict {
  verdict: NamePairVerdict;
  annualCode: string;
  monthlyCode: string;
  annualSum: number;
  monthlySum: number;
  ratio: number;
  stats?: PairRatioStats;
  message: string;
  /**
   * Whether both attributes should be held out of confirmation.
   *
   * Only a genuine contradiction blocks. Two different quantities that merely
   * share a prefix are a naming problem, not a contradiction — blocking them
   * would punish the curator for the source's vocabulary.
   */
  blocks: boolean;
}

/**
 * Dispersion above this means the two columns do not track one another, so
 * they cannot be the same quantity measured at two periodicities.
 */
const MAX_COEFFICIENT_OF_VARIATION = 0.15;
/** A monthly figure is a twelfth of its annual counterpart, within tolerance. */
const MONTHLY_RATIO = 1 / 12;
const MONTHLY_RATIO_TOLERANCE = 0.3;

/**
 * Decide what a `X` / `X_mensal` pair actually is, from the per-asset ratio.
 *
 * This replaces an earlier assumption that such a pair is necessarily the same
 * quantity. On the real export it is not: `ipvaLicenciamento` is a flat fee of
 * about R$150 regardless of vehicle value, while `ipvaLicenciamentoMensal`
 * varies from R$435 to R$733 with no consistent relationship to it.
 */
export function classifyNamePair(stats: PairRatioStats | undefined): {
  verdict: NamePairVerdict;
  blocks: boolean;
} {
  if (!stats || stats.sampleSize < 5) {
    return { verdict: "INSUFFICIENT_DATA", blocks: false };
  }
  const cv =
    stats.meanRatio === 0
      ? Number.POSITIVE_INFINITY
      : Math.abs(stats.stddevRatio / stats.meanRatio);

  if (cv > MAX_COEFFICIENT_OF_VARIATION) {
    return { verdict: "DISTINCT_BASES", blocks: false };
  }
  const consistentWithMonthly =
    Math.abs(stats.meanRatio - MONTHLY_RATIO) <= MONTHLY_RATIO_TOLERANCE * MONTHLY_RATIO;
  return consistentWithMonthly
    ? { verdict: "CONSISTENT", blocks: false }
    : { verdict: "PERIODICITY_CONTRADICTION", blocks: true };
}

/**
 * Find name pairs that claim annual/monthly and whose magnitudes contradict
 * the claim.
 *
 * A monthly figure should be roughly a twelfth of its annual counterpart. When
 * it is larger instead, the pair is reported and *both* sides are held back
 * from confirmation — this is the `ipvaLicenciamento` case, and the single
 * most dangerous thing in the dataset.
 */
export function detectPeriodicityConflicts(
  evidence: AttributeEvidence[],
  ratioStatsByPair: Map<string, PairRatioStats> = new Map(),
): PeriodicityConflict[] {
  const byCode = new Map(evidence.map((e) => [e.code, e]));
  const conflicts: PeriodicityConflict[] = [];

  for (const candidate of evidence) {
    if (!candidate.code.endsWith(MONTHLY_SUFFIX)) continue;
    const baseCode = candidate.code.slice(0, -MONTHLY_SUFFIX.length);
    const base = byCode.get(baseCode);
    if (!base) continue;
    if (base.latestSum === null || candidate.latestSum === null) continue;
    if (base.latestSum === 0) continue;

    const ratio = candidate.latestSum / base.latestSum;
    const stats = ratioStatsByPair.get(candidate.code);
    const { verdict, blocks } = classifyNamePair(stats);

    if (verdict === "CONSISTENT") continue;

    const dispersion =
      stats && stats.meanRatio !== 0
        ? Math.abs(stats.stddevRatio / stats.meanRatio)
        : null;

    let message: string;
    if (verdict === "DISTINCT_BASES") {
      message =
        `"${candidate.sourceName}" e "${base.sourceName}" compartilham o prefixo do nome, mas ` +
        `não medem a mesma coisa: entre os ${stats!.sampleSize} ativos a razão entre elas varia de ` +
        `${stats!.minRatio.toFixed(2)}× a ${stats!.maxRatio.toFixed(2)}× (dispersão de ` +
        `${(dispersion! * 100).toFixed(0)}%). Duas medidas da mesma grandeza teriam razão constante. ` +
        `Não é contradição de periodicidade — é homonímia. Cada uma precisa ser curada por si.`;
    } else if (verdict === "PERIODICITY_CONTRADICTION") {
      message =
        `"${candidate.sourceName}" e "${base.sourceName}" acompanham uma à outra de forma consistente ` +
        `(razão ${stats!.meanRatio.toFixed(2)}× entre os ${stats!.sampleSize} ativos), mas a razão não é ` +
        `1/12. São a mesma grandeza e a nomenclatura mensal/anual está errada; ambas ficam bloqueadas ` +
        `para cálculo financeiro até você confirmar o que cada uma significa.`;
    } else {
      message =
        `Não há pares suficientes de "${candidate.sourceName}" e "${base.sourceName}" para decidir se ` +
        `medem a mesma grandeza. Nenhuma conclusão tirada.`;
    }

    conflicts.push({
      verdict,
      annualCode: baseCode,
      monthlyCode: candidate.code,
      annualSum: base.latestSum,
      monthlySum: candidate.latestSum,
      ratio,
      stats,
      message,
      blocks,
    });
  }

  return conflicts;
}
