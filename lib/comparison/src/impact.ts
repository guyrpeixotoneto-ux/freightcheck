import type { AttributeClassification } from "./classification";

/**
 * How much a change is worth — and, far more often, admitting we cannot say.
 *
 * The rule from docs/ARQUITETURA.md §7, made executable: a financial number is
 * only produced when it can be reproduced from confirmed semantics and the
 * data. Everything else is NOT_CALCULABLE *with a reason*, never a zero and
 * never an empty cell.
 */

export type ImpactConfidence = "CALCULATED" | "ESTIMATED" | "NOT_CALCULABLE";

export interface ImpactVerdict {
  confidence: ImpactConfidence;
  amount: number | null;
  /** The periodicity the amount is expressed in. Annualising is F4's job. */
  periodicity: string | null;
  reason: string;
}

export interface ImpactInput {
  classification: AttributeClassification;
  numericBefore: number | null;
  numericAfter: number | null;
  comparable: boolean;
}

export function assessImpact({
  classification,
  numericBefore,
  numericAfter,
  comparable,
}: ImpactInput): ImpactVerdict {
  const notCalculable = (reason: string): ImpactVerdict => ({
    confidence: "NOT_CALCULABLE",
    amount: null,
    periodicity: null,
    reason,
  });

  if (!comparable) {
    return notCalculable(
      "Os dois lados não são comparáveis com segurança, então não há variação a monetizar.",
    );
  }

  // The gate. Nothing below CONFIRMED reaches a financial number — this is the
  // same rule the database enforces on the attribute itself.
  if (classification.semanticsStatus !== "CONFIRMED") {
    return notCalculable(
      `Semântica ${classification.semanticsStatus === "PRESUMED" ? "presumida" : "desconhecida"}: ` +
        `o atributo ainda não foi confirmado na curadoria, então somar sua variação seria adivinhação.`,
    );
  }

  if (classification.isMonetary !== true) {
    return notCalculable(
      "Não é um montante financeiro — a variação existe, mas não vira dinheiro por si só.",
    );
  }

  if (classification.aggregation !== "SUM") {
    return notCalculable(
      `Agregação "${classification.aggregation ?? "indefinida"}": o atributo não é somável, ` +
        `então a variação por ativo não se acumula em um total.`,
    );
  }

  if (numericBefore === null || numericAfter === null) {
    return notCalculable(
      "Um dos lados não é numérico (ausente ou textual), então não há diferença a calcular.",
    );
  }

  return {
    confidence: "CALCULATED",
    amount: numericAfter - numericBefore,
    periodicity: classification.periodicity,
    reason:
      `Semântica confirmada: ${classification.unit}, ${classification.periodicity}, somável. ` +
      `Impacto = valor novo − valor anterior.`,
  };
}
