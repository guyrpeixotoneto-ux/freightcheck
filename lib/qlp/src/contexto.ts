import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  contextFilter,
  listContexts,
  periodLabel,
  resolveContext,
  type ContextInfo,
  type RequestedContext,
} from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest";

/**
 * O contexto de leitura do quadro de pessoal.
 *
 * A mesma resolução de contexto do resto do produto (`resolveContext`), com uma
 * diferença que é o motivo deste arquivo existir: a lista de contextos e a
 * régua de vigências vêm **só da família QUADRO_DE_PESSOAL**. O QLP forma
 * vigências próprias na mesma unidade e canal do equipamento, e resolver o
 * contexto sobre a lista geral faria o seletor da tela oferecer quinzenas de
 * equipamento que esta leitura não sabe responder.
 */

/** O tipo de entidade que esta leitura enxerga. Autoridade: `lib/ingest/tipos.ts`. */
export const TIPO_QLP_ADMINISTRATIVO = "QLP_ADMINISTRATIVO";

/**
 * Erro de recusa: a vigência pedida não existe neste contexto. Rota traduz em
 * 404 — o contexto existe, mas a quinzena pedida não foi importada, e responder
 * com a mais próxima seria o número certo sob o título errado.
 */
export class VigenciaNaoEncontradaError extends Error {
  constructor(pedida: string, disponiveis: string[]) {
    super(
      `A vigência pedida (${pedida}) não existe neste contexto de QLP Administrativo. ` +
        `Disponíveis: ${disponiveis.join(", ") || "nenhuma"}.`,
    );
    this.name = "VigenciaNaoEncontradaError";
  }
}

export interface VigenciaDoQuadro {
  effectiveDate: string;
  /** "Ago/2026" — o mês; as quinzenas do mesmo mês se distinguem pelo rótulo. */
  periodLabel: string;
  /** Os rótulos literais da fonte, ex.: "EMPURRADA_1_8_2026". */
  sourceLabels: string[];
}

export interface ContextoDoQuadro {
  context: ContextInfo;
  effectiveDate: string;
  periodLabel: string;
  /** A vigência imediatamente anterior da série do quadro, para navegação. */
  anterior: string | null;
  vigencias: VigenciaDoQuadro[];
}

/**
 * Resolve contexto e vigência para uma leitura do quadro.
 *
 * `null` quando não existe nenhuma vigência de QLP importada — a rota traduz em
 * 404 com a frase que aponta para Importações. Contexto pedido e inexistente é
 * `ContextNotFoundError`; vigência pedida e inexistente é
 * {@link VigenciaNaoEncontradaError}. Recusa escrita, nunca lista vazia.
 */
export async function resolverContextoDoQuadro(
  db: Database,
  requested?: RequestedContext & { period?: string },
): Promise<ContextoDoQuadro | null> {
  const contexts = await listContexts(db, {
    datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
  });
  if (contexts.length === 0) return null;

  const context = (await resolveContext(db, requested, contexts))!;

  const effectiveDate = requested?.period ?? context.latestPeriod;
  if (!context.periodosDisponiveis.includes(effectiveDate)) {
    throw new VigenciaNaoEncontradaError(effectiveDate, context.periodosDisponiveis);
  }

  const anteriores = context.periodosDisponiveis.filter((d) => d < effectiveDate);
  const anterior = anteriores.length > 0 ? anteriores[anteriores.length - 1] : null;

  return {
    context,
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    anterior,
    vigencias: await listarVigenciasDoQuadro(db, context),
  };
}

/** As vigências do quadro neste contexto, da mais antiga para a mais nova. */
async function listarVigenciasDoQuadro(
  db: Database,
  context: ContextInfo,
): Promise<VigenciaDoQuadro[]> {
  const { rows } = await db.execute<{ effective_date: string; labels: string[] }>(sql`
    SELECT s.effective_date::text AS effective_date,
           array_agg(DISTINCT s.source_label ORDER BY s.source_label) AS labels
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND ${contextFilter("s", context)}
     GROUP BY 1
     ORDER BY 1
  `);
  return rows.map((row) => ({
    effectiveDate: row.effective_date,
    periodLabel: periodLabel(row.effective_date),
    sourceLabels: row.labels ?? [],
  }));
}
