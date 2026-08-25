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
import { DATASET_FAMILY_QUADRO_DE_PESSOAL, normalizeDocumento } from "@workspace/ingest";
import { TIPO_QLP_ADMINISTRATIVO } from "./contexto";
import { separarChaveLegivel } from "./quadro";

/**
 * A série do quadro: vigência a vigência, quem estava no quadro e quanto o
 * arquivo trouxe — contagens de estrutura, nunca soma de valor.
 *
 * O que esta leitura afirma cabe em presença e cardinalidade: quantos cargos,
 * quantas unidades, quantos fatos, quantos vazios, e em que quinzenas cada
 * cargo aparece. Diferença de **valor** entre vigências não sai daqui — é do
 * motor de comparação canônico (`computeChangeSet`), e a tela a pede pelos
 * endpoints de change-set que já existem.
 *
 * Quinzena sem arquivo aparece como ausência na régua (`periodosDisponiveis`):
 * a série mostra o buraco em vez de interpolá-lo.
 */

export interface VigenciaDaEvolucao {
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
  /** Cargos presentes (entidades com fato) nesta vigência. */
  cargos: number;
  /** Unidades distintas com cargo no quadro nesta vigência. */
  unidades: number;
  fatos: number;
  valores: number;
  nulos: number;
  /** Fatos que vieram por herança de uma revisão parcial, quando houve. */
  herdados: number;
}

export interface CargoNaSerie {
  entityId: string;
  cargo: string;
  unidadeCnpj: string;
  unidadeCnpjLegivel: string;
  /** Alinhado a `vigencias`: o cargo estava no quadro daquela quinzena? */
  presencas: boolean[];
}

export interface EvolucaoDoQuadro {
  context: ContextInfo;
  vigencias: VigenciaDaEvolucao[];
  quadro: CargoNaSerie[];
}

export async function getEvolucaoDoQuadro(
  db: Database,
  options: { context?: RequestedContext } = {},
): Promise<EvolucaoDoQuadro | null> {
  const contexts = await listContexts(db, {
    datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
  });
  if (contexts.length === 0) return null;

  const context = (await resolveContext(db, options.context, contexts))!;

  const datas = context.janela
    ? context.periodosDisponiveis.filter(
        (d) => d >= context.janela!.de && d <= context.janela!.ate,
      )
    : context.periodosDisponiveis;

  // Os totais por vigência saem do agregado que a promoção gravou
  // (`snapshot_entity_type`) — a mesma fonte da Cobertura, nada recontado.
  const { rows: totais } = await db.execute<{
    effective_date: string;
    labels: string[];
    fatos: number;
    valores: number;
    nulos: number;
    herdados: number;
  }>(sql`
    SELECT s.effective_date::text AS effective_date,
           array_agg(DISTINCT s.source_label ORDER BY s.source_label) AS labels,
           sum(se.fact_count)::int      AS fatos,
           sum(se.value_count)::int     AS valores,
           sum(se.null_count)::int      AS nulos,
           sum(se.inherited_fact_count)::int AS herdados
      FROM snapshot s
      JOIN snapshot_entity_type se
        ON se.snapshot_id = s.id
       AND se.entity_type = ${TIPO_QLP_ADMINISTRATIVO}
     WHERE s.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND ${contextFilter("s", context)}
     GROUP BY 1
     ORDER BY 1
  `);
  const totaisPorData = new Map(totais.map((t) => [t.effective_date, t]));

  // Presença: em que vigência cada cargo aparece. É daqui que saem tanto a
  // matriz quanto as contagens de cargos e unidades por quinzena.
  const { rows: presencas } = await db.execute<{
    effective_date: string;
    entity_id: string;
    identifier_value_raw: string;
  }>(sql`
    SELECT DISTINCT s.effective_date::text AS effective_date,
           f.entity_id::text               AS entity_id,
           ei.identifier_value_raw
      FROM fact f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity e   ON e.id = f.entity_id
      JOIN entity_identifier ei
        ON ei.entity_id = e.id
       AND ei.identifier_type = 'PLACA'
       AND ei.is_current
     WHERE s.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND e.entity_type = ${TIPO_QLP_ADMINISTRATIVO}
       AND ${contextFilter("s", context)}
     ORDER BY 1
  `);

  interface Presenca {
    entityId: string;
    cargo: string;
    unidadeCnpj: string;
    unidadeCnpjLegivel: string;
    datas: Set<string>;
  }
  const porEntidade = new Map<string, Presenca>();
  for (const linha of presencas) {
    let presenca = porEntidade.get(linha.entity_id);
    if (!presenca) {
      const { cnpjLegivel, cargo } = separarChaveLegivel(linha.identifier_value_raw);
      presenca = {
        entityId: linha.entity_id,
        cargo,
        unidadeCnpj: normalizeDocumento(cnpjLegivel),
        unidadeCnpjLegivel: cnpjLegivel,
        datas: new Set(),
      };
      porEntidade.set(linha.entity_id, presenca);
    }
    presenca.datas.add(linha.effective_date);
  }

  const vigencias: VigenciaDaEvolucao[] = datas.map((data) => {
    const totaisDaData = totaisPorData.get(data);
    const presentes = [...porEntidade.values()].filter((p) => p.datas.has(data));
    return {
      effectiveDate: data,
      periodLabel: periodLabel(data),
      sourceLabels: totaisDaData?.labels ?? [],
      cargos: presentes.length,
      unidades: new Set(presentes.map((p) => p.unidadeCnpj)).size,
      fatos: totaisDaData?.fatos ?? 0,
      valores: totaisDaData?.valores ?? 0,
      nulos: totaisDaData?.nulos ?? 0,
      herdados: totaisDaData?.herdados ?? 0,
    };
  });

  const quadro: CargoNaSerie[] = [...porEntidade.values()]
    // Fora da janela um cargo pode não aparecer em quinzena nenhuma — some da
    // matriz, porque uma linha toda vazia não diz nada sobre o recorte pedido.
    .filter((p) => datas.some((data) => p.datas.has(data)))
    .map((p) => ({
      entityId: p.entityId,
      cargo: p.cargo,
      unidadeCnpj: p.unidadeCnpj,
      unidadeCnpjLegivel: p.unidadeCnpjLegivel,
      presencas: datas.map((data) => p.datas.has(data)),
    }))
    .sort(
      (a, b) =>
        a.unidadeCnpj.localeCompare(b.unidadeCnpj) ||
        a.cargo.localeCompare(b.cargo, "pt-BR"),
    );

  return { context, vigencias, quadro };
}
