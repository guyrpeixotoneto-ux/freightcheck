import { eq } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { attributeTable } from "@workspace/db";
import { confirmAttribute } from "./engine";
import type { Aggregation, Periodicity, Unit } from "./semantics";

/**
 * Confirmed semantics, as a versioned artefact.
 *
 * A confirmation is knowledge about the domain that a person supplied. Keeping
 * it only in a database would make it invisible to review and lost on a
 * rebuild; keeping it here makes it diffable, attributable and replayable into
 * any fresh environment.
 *
 * This registry does not weaken the human-confirmation rule — every entry
 * records who decided and on what basis, and applying it goes through the same
 * {@link confirmAttribute} guards as the screen does. Adding a line here is
 * itself the human act, reviewable in a pull request.
 *
 * Do not add an entry you were not told. An unconfirmed attribute staying
 * UNKNOWN is the system working; a guess recorded here as fact is not.
 */
export interface ConfirmedSemantics {
  code: string;
  unit: Unit | null;
  periodicity: Periodicity | null;
  aggregation: Aggregation;
  isMonetary: boolean;
  taxonomyCode?: string;
  /** The person who decided. Never a system identifier. */
  confirmedBy: string;
  /** What the decision was based on — the thing a reviewer will want. */
  basis: string;
}

export const CONFIRMED_SEMANTICS: ConfirmedSemantics[] = [
  {
    code: "carreta.custo_fixo",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Confirmado pelo transportador em 10/08/2026: custoFixo é um valor mensal por implemento.",
  },
  {
    code: "carreta.icms",
    unit: "PERCENT",
    // A rate has no periodicity — it is not an amount accruing over time.
    periodicity: null,
    aggregation: "NONE",
    isMonetary: false,
    taxonomyCode: "cf_seguros_tributos",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Confirmado pelo transportador em 10/08/2026: a coluna icms é alíquota, não valor. " +
      "O montante correspondente é valorIcms. Consistente com a faixa observada (0 a 12).",
  },
  {
    code: "carreta.pis_cofins",
    unit: "PERCENT",
    periodicity: null,
    aggregation: "NONE",
    isMonetary: false,
    taxonomyCode: "cf_seguros_tributos",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Confirmado pelo transportador em 10/08/2026: a coluna pisCofins é alíquota, não valor. " +
      "O montante correspondente é valorPisCofins. Consistente com a faixa observada (0 a 9,3).",
  },

  // ---------------------------------------------------------------------------
  // Bloco de alta confiança, aprovado em 10/08/2026 a partir de
  // docs/AUDITORIA-PERIODICIDADE.md. Cada entrada cita a conta que a sustenta —
  // nenhuma delas veio de interpretar nome de coluna.
  // ---------------------------------------------------------------------------

  // Cadeia A — custoFixo (já confirmado MENSAL) = finame + lucroFixomodeloNovoCiclo,
  // em 611 de 657 linhas. Uma soma não muda de periodicidade no meio.
  ...([
    ["carreta.finame", "cf_financiamento"],
    ["carreta.lucro_fixomodelo_novo_ciclo", "cf_remuneracao_capital"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "BRL" as const,
    periodicity: "MENSAL" as const,
    aggregation: "SUM" as const,
    isMonetary: true,
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026 com base aritmética: custoFixo = finame + lucroFixomodeloNovoCiclo " +
      "em 611 de 657 linhas (93%), em todas as 9 vigências. Como custoFixo é confirmado MENSAL, " +
      "as duas parcelas são mensais — uma soma não muda de periodicidade no meio.",
  })),

  // Cadeia B — a amortização é o valor financiado dividido pelo prazo em MESES:
  // razão 1,108 (carretas, desvio 0,018) e 1,081 (cavalos, desvio 0,040).
  // Lida como anual, a conta erraria por um fator de treze.
  ...([
    ["carreta.finame_implemento", "cf_financiamento"],
    ["carreta.juros_finame_implemento", "cf_financiamento"],
    ["carreta.amortizacao_implemento", "cf_depreciacao"],
    ["cavalo.finame_cavalo", "cf_financiamento"],
    ["cavalo.juros_finame_cavalo", "cf_financiamento"],
    ["cavalo.amortizacao_cavalo", "cf_depreciacao"],
    ["cavalo.lucro_fixomodelo_novo_ciclo_cavalo", "cf_remuneracao_capital"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "BRL" as const,
    periodicity: "MENSAL" as const,
    aggregation: "SUM" as const,
    isMonetary: true,
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026 com base aritmética: amortizacao ÷ (valorNF × (1 − entrada%) ÷ periodoFiname) " +
      "= 1,108 nas carretas (desvio 0,018) e 1,081 nos cavalos (desvio 0,040) — ou seja, o prazo do FINAME " +
      "está em meses. Lido como anual, erraria por um fator de 13. E finameImplemento = amortizacao + juros " +
      "em 37 de 38 implementos com ambas as parcelas não nulas.",
  })),

  // Cadeia D — 1,000% do valor da NF, desvio zero, de Jan a Jun/2026.
  // Um por cento ao ano é alíquota plausível; ao mês daria 12% a.a.
  {
    code: "cavalo.ipva_licenciamento",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_seguros_tributos",
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026: de Jan a Jun/2026 o valor é exatamente 1,000% de valorNfCompra para " +
      "as 62 placas, com desvio 0,0000. Um por cento do valor do veículo ao ano é alíquota plausível; " +
      "ao mês daria 12% a.a., o que não existe. Atenção: a base de cálculo mudou duas vezes na série " +
      "(2,52% médio → 1,000% fixo → 0,651% médio) — ver docs/ACHADO-IPVA.md.",
  },

  // Cadeia C — cinco colunas nunca variam nas 9 vigências, e valorPisCofins é
  // exatamente 9,250% da NF com desvio zero. São valores de aquisição.
  ...([
    ["carreta.valor_nf_compra", "cf_outros"],
    ["cavalo.valor_nf_compra", "cf_outros"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "BRL" as const,
    periodicity: "PONTUAL" as const,
    aggregation: "SUM" as const,
    isMonetary: true,
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026: o valor nunca varia ao longo das 9 vigências para nenhum ativo " +
      "(100% com um único valor distinto). É o valor da nota de compra — grandeza de aquisição, " +
      "não fluxo periódico.",
  })),
  ...([
    ["carreta.valor_pis_cofins", "cf_seguros_tributos"],
    ["cavalo.valor_pis_cofins", "cf_seguros_tributos"],
  ] as const).map(([code, taxonomyCode]) => ({
    code,
    unit: "BRL" as const,
    periodicity: "PONTUAL" as const,
    aggregation: "SUM" as const,
    isMonetary: true,
    taxonomyCode,
    confirmedBy: "guyrpeixoto.neto@gmail.com",
    basis:
      "Aprovado em 10/08/2026: é exatamente 9,250% de valorNfCompra, com desvio 0,0000 nos 132 ativos, " +
      "e nunca varia ao longo da série. Tributo incidente sobre a nota de compra — valor de aquisição.",
  })),
];

export interface ApplyConfirmationsResult {
  applied: string[];
  unchanged: string[];
  missing: string[];
}

/**
 * Replay the registry into a database. Idempotent: an attribute already
 * carrying exactly these semantics is left alone, so re-running writes no
 * events and does not restamp the confirmation date.
 */
export async function applyConfirmations(
  db: Database,
  registry: ConfirmedSemantics[] = CONFIRMED_SEMANTICS,
): Promise<ApplyConfirmationsResult> {
  const applied: string[] = [];
  const unchanged: string[] = [];
  const missing: string[] = [];

  for (const entry of registry) {
    const [attribute] = await db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, entry.code));

    if (!attribute) {
      missing.push(entry.code);
      continue;
    }

    const alreadyMatches =
      attribute.semanticsStatus === "CONFIRMED" &&
      attribute.unit === entry.unit &&
      attribute.periodicity === entry.periodicity &&
      attribute.aggregation === entry.aggregation &&
      attribute.isMonetary === entry.isMonetary &&
      attribute.confirmedBy === entry.confirmedBy;

    if (alreadyMatches) {
      unchanged.push(entry.code);
      continue;
    }

    await confirmAttribute(db, {
      code: entry.code,
      unit: entry.unit,
      periodicity: entry.periodicity,
      aggregation: entry.aggregation,
      isMonetary: entry.isMonetary,
      taxonomyCode: entry.taxonomyCode,
      actor: entry.confirmedBy,
      reason: entry.basis,
    });
    applied.push(entry.code);
  }

  return { applied, unchanged, missing };
}
