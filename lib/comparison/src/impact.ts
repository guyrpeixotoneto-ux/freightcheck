import { viraDinheiro } from "@workspace/curation";
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

  // O portão, e ele não mora aqui: `viraDinheiro` é a mesma decisão que o
  // panorama, o impacto e a composição consultam. Este arquivo já teve a sua
  // cópia da regra — CONFIRMED, monetário e SUM, nesta ordem — e era uma das
  // cinco versões que a auditoria encontrou.
  const dinheiro = viraDinheiro(classification);
  if (!dinheiro.ok) return notCalculable(dinheiro.motivo);

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
