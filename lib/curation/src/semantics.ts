/**
 * Proposing what a variable means — and refusing to decide it.
 *
 * Everything in this file produces a *proposal*. The engine may move an
 * attribute from UNKNOWN to PRESUMED and write down why; only a human moves it
 * to CONFIRMED, and only CONFIRMED attributes will ever reach the financial
 * engine in F4. The database enforces that split, so a bug here cannot leak a
 * guess into a number.
 */

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
  if (dataType === "TEXT" || dataType === "BOOLEAN" || dataType === "DATE" || dataType === "MIXED") {
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

/** Name-based placement in the tree. A proposal, like everything else here. */
export function guessTaxonomyCode(code: string, entityType: string): string {
  const n = code.split(".").slice(1).join(".");

  if (has(n, "unidade", "operador", "organizacao", "regiao", "prazo_pagamento"))
    return "cad_escopo";
  if (has(n, "chassi", "placa", "modelo", "montadora", "empresa_locadora") || n === "id" || n === "ano")
    return "cad_identificacao";
  if (has(n, "data", "vigencia", "carencia", "periodo", "mes_de_entrada", "ciclo", "contrato", "bid"))
    return has(n, "manutencao") ? "cv_manutencao" : "cad_contrato";
  if (has(n, "eixo", "cambio", "padrao", "capacidade", "medida", "double_deck", "revestimento", "tacografo", "rastreador", "faixa", "carroceria", "implemento", "frota_emprestada", "ativo", "odometro"))
    return "cad_especificacao";

  if (has(n, "amortizacao")) return "cf_depreciacao";
  if (has(n, "finame", "juros", "spread", "tjlp", "taxa", "financiamento", "percentual_entrada"))
    return "cf_financiamento";
  if (has(n, "ipva", "licenciamento", "seguro", "icms", "pis_cofins")) return "cf_seguros_tributos";
  if (has(n, "lucro_fixo")) return "cf_remuneracao_capital";
  if (has(n, "lucro_variavel")) return "cv_lucro_variavel";
  if (has(n, "combustivel", "consumo")) return "cv_combustivel";
  if (has(n, "manutencao", "free_maintenance")) return "cv_manutencao";
  if (has(n, "pneu")) return "cv_pneus";
  if (has(n, "custo_variavel", "reais_km")) return "cv_outros";
  if (n === "custo_fixo")
    return entityType === "CAVALO" ? "cf_frota_cavalo" : "cf_frota_carreta";
  if (has(n, "custo_aluguel", "valor_nf_compra")) return "cf_outros";

  return "nao_classificado";
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
  const taxonomyCode = guessTaxonomyCode(evidence.code, evidence.entityType);

  const parts = [unitGuess.reason, aggGuess.reason];
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
    taxonomyCode,
    rationale: parts.join(" "),
    status,
  };
}

export interface PeriodicityConflict {
  annualCode: string;
  monthlyCode: string;
  annualSum: number;
  monthlySum: number;
  ratio: number;
  message: string;
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
    // Anything from a twelfth to about a third is consistent with a monthly
    // figure. Above that the naming cannot be taken at face value.
    if (ratio <= 0.35) continue;

    conflicts.push({
      annualCode: baseCode,
      monthlyCode: candidate.code,
      annualSum: base.latestSum,
      monthlySum: candidate.latestSum,
      ratio,
      message:
        `"${candidate.sourceName}" soma ${candidate.latestSum.toFixed(2)} enquanto ` +
        `"${base.sourceName}" soma ${base.latestSum.toFixed(2)} — razão de ${ratio.toFixed(2)}×. ` +
        `Um valor mensal deveria ser cerca de 1/12 do anual. A nomenclatura não descreve o conteúdo; ` +
        `ambos ficam bloqueados para cálculo financeiro até você confirmar o que cada um significa.`,
    });
  }

  return conflicts;
}
