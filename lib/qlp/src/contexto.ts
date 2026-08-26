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
  /**
   * O contexto de referência — quem nomeia a leitura e dá a régua de vigências.
   *
   * Continua sendo **um**: o título da tela, o rótulo do período e a navegação
   * entre quinzenas falam de uma série. O que deixou de ser um é o conjunto que
   * a consulta varre — ver {@link ContextoDoQuadro.escopos}.
   */
  context: ContextInfo;
  /**
   * Os escopos que esta leitura pode atravessar — a autorização da visão.
   *
   * **O quadro é consolidado por desenho.** Uma planilha de QLP traz várias
   * unidades, e o snapshot é particionado por `scope_hash` — que é o
   * comportamento estrutural correto e não muda por causa de uma tela. Prender a
   * consulta ao `scope_hash` do contexto de referência fazia o quadro mostrar os
   * cargos de uma unidade e anunciar o total de todas.
   *
   * A correção não é remover o filtro de escopo: é trocá-lo por **este
   * conjunto**, que sai de `listContexts` para a família do quadro. Ele é a
   * fronteira, e a consulta não a atravessa — uma unidade fora daqui não entra
   * no resultado, e `filtroDosEscopos` sobre lista vazia não devolve nada em vez
   * de devolver tudo.
   */
  escopos: ContextInfo[];
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
    escopos: contexts,
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    anterior,
    vigencias: await listarVigenciasDoQuadro(db, contexts),
  };
}

/**
 * O filtro de uma leitura consolidada — a união dos escopos autorizados.
 *
 * É `contextFilter` aplicado a cada escopo e ligado por `OR`, e não uma segunda
 * forma de filtrar escrita aqui: cada contexto continua trazendo o próprio
 * canal e a própria família, exatamente como em toda outra leitura do produto.
 * O que muda é quantos contextos entram, nunca a regra de cada um.
 *
 * **Lista vazia devolve `false`, e isso é a parte que importa.** Um filtro que
 * degenerasse em verdadeiro sobre conjunto vazio faria uma leitura sem
 * autorização nenhuma varrer o acervo inteiro — o defeito exato que este
 * parâmetro existe para impedir.
 */
export function filtroDosEscopos(alias: string, escopos: ContextInfo[]) {
  if (escopos.length === 0) return sql`false`;
  return sql`(${sql.join(
    escopos.map((escopo) => sql`(${contextFilter(alias, escopo)})`),
    sql` OR `,
  )})`;
}

/**
 * As vigências do quadro nos escopos autorizados, da mais antiga para a mais nova.
 *
 * Consolidada como o quadro que ela indexa: uma quinzena existe para esta
 * leitura quando qualquer unidade autorizada publicou nela, e `sourceLabels`
 * junta os rótulos das que publicaram. Listar só as do contexto de referência
 * esconderia a quinzena em que a unidade A não entregou e a B entregou — e o
 * quadro daquela data, que tem dado, apareceria como vigência inexistente.
 */
async function listarVigenciasDoQuadro(
  db: Database,
  escopos: ContextInfo[],
): Promise<VigenciaDoQuadro[]> {
  const { rows } = await db.execute<{ effective_date: string; labels: string[] }>(sql`
    SELECT s.effective_date::text AS effective_date,
           array_agg(DISTINCT s.source_label ORDER BY s.source_label) AS labels
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND ${filtroDosEscopos("s", escopos)}
     GROUP BY 1
     ORDER BY 1
  `);
  return rows.map((row) => ({
    effectiveDate: row.effective_date,
    periodLabel: periodLabel(row.effective_date),
    sourceLabels: row.labels ?? [],
  }));
}
