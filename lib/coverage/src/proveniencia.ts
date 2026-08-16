import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";

/**
 * De onde veio este número.
 *
 * A cadeia existe inteira no banco desde a F1 e nunca foi exposta nesta tela:
 *
 *     valor → fact → attribute
 *                  → entity → entity_identifier (a placa)
 *                  → snapshot (vigência, família, canal, escopo, revisão)
 *                  → raw_cell → raw_row → raw_sheet → import_run → source_file
 *
 * `fact.raw_cell_id` é `NOT NULL`: nenhum fato canônico existe sem apontar a
 * célula que o originou. É isso que faz "de qual arquivo veio o seguro da placa
 * ABC1D23 em agosto?" ter resposta em vez de opinião.
 *
 * **O elo que a consolidação poderia ter quebrado, e não quebrou.** Quando uma
 * revisão parcial herda os componentes que o arquivo não tocou, o fato herdado
 * mantém o `raw_cell_id` **original** — o da célula da revisão anterior — e
 * marca `inherited_from_snapshot_id`. A proveniência de um fato herdado aponta,
 * portanto, para o arquivo que de fato o trouxe, e não para o que apenas o
 * carregou adiante. As duas informações saem na resposta, porque são duas
 * perguntas: quem trouxe o número, e por qual revisão ele chegou até aqui.
 */

export interface Proveniencia {
  factId: number;
  valor: string | null;
  isNull: boolean;
  nullReason: string | null;
  atributo: { code: string; label: string; sourceName: string; entityType: string };
  entidade: { id: string; identificador: string; entityType: string };
  vigencia: {
    snapshotId: string;
    sourceLabel: string;
    effectiveDate: string;
    datasetFamily: string;
    canal: string;
    revision: number;
    scopeLabel: string;
  };
  /** Preenchido quando o fato veio junto numa revisão parcial. */
  herdadoDe: { snapshotId: string; sourceLabel: string; effectiveDate: string } | null;
  celula: {
    rawCellId: number;
    aba: string;
    linha: number;
    coluna: string;
    cabecalho: string | null;
    valorBruto: string | null;
    textoFormatado: string | null;
  };
  importacao: {
    importRunId: string;
    status: string;
    startedAt: string;
    arquivo: string;
    contentSha256: string;
    recebidoEm: string;
    recebidoPor: string | null;
  };
}

/**
 * A cadeia inteira de um fato, numa consulta.
 *
 * Uma linha de `fact` e seis joins, todos por chave primária. Não há aqui o que
 * escalar: a pergunta é sobre um valor, e a resposta custa o mesmo com mil
 * fatos ou com cem milhões.
 */
export async function provenienciaDoFato(
  db: Database,
  factId: number,
): Promise<Proveniencia | null> {
  const { rows } = await db.execute<Record<string, string | number | boolean | null>>(sql`
    SELECT f.id::text                                        AS fact_id,
           coalesce(f.value_text, f.value_numeric::text, f.value_boolean::text,
                    f.value_date::text)                      AS valor,
           f.is_null,
           f.null_reason,
           a.code                                            AS attr_code,
           coalesce(a.display_name, a.source_name)           AS attr_label,
           a.source_name                                     AS attr_source_name,
           a.entity_type                                     AS attr_entity_type,
           e.id::text                                        AS entity_id,
           e.entity_type,
           coalesce(
             (SELECT ei.identifier_value FROM entity_identifier ei
               WHERE ei.entity_id = e.id AND ei.identifier_type = 'PLACA'
               ORDER BY ei.is_current DESC, ei.effective_from DESC LIMIT 1),
             left(e.id::text, 8)
           )                                                 AS identificador,
           s.id::text                                        AS snapshot_id,
           s.source_label,
           s.effective_date::text,
           s.dataset_family,
           s.canal,
           s.revision,
           coalesce(
             (SELECT string_agg(coalesce(sc.name, sc.code), ' · ' ORDER BY sc.scope_type)
                FROM snapshot_scope ss JOIN scope sc ON sc.id = ss.scope_id
               WHERE ss.snapshot_id = s.id AND sc.scope_type = 'UNIDADE'),
             left(s.scope_hash, 8)
           )                                                 AS scope_label,
           h.id::text                                        AS herdado_id,
           h.source_label                                    AS herdado_label,
           h.effective_date::text                            AS herdado_date,
           rc.id::text                                       AS raw_cell_id,
           rc.column_letter,
           rc.column_header,
           rc.raw_value,
           rc.formatted_text,
           rr.row_index,
           rs.sheet_name,
           ir.id::text                                       AS import_run_id,
           ir.status::text                                   AS import_status,
           ir.started_at::text                               AS started_at,
           sf.filename,
           sf.content_sha256,
           sf.received_at::text                              AS received_at,
           sf.received_by
      FROM fact f
      JOIN attribute a  ON a.id = f.attribute_id
      JOIN entity e     ON e.id = f.entity_id
      JOIN snapshot s   ON s.id = f.snapshot_id
      LEFT JOIN snapshot h ON h.id = f.inherited_from_snapshot_id
      JOIN raw_cell rc  ON rc.id = f.raw_cell_id
      JOIN raw_row rr   ON rr.id = rc.raw_row_id
      JOIN raw_sheet rs ON rs.id = rr.raw_sheet_id
      JOIN import_run ir ON ir.id = rs.import_run_id
      JOIN source_file sf ON sf.id = ir.source_file_id
     WHERE f.id = ${factId}
  `);

  const r = rows[0];
  if (!r) return null;

  return {
    factId: Number(r.fact_id),
    valor: r.valor as string | null,
    isNull: Boolean(r.is_null),
    nullReason: r.null_reason as string | null,
    atributo: {
      code: r.attr_code as string,
      label: r.attr_label as string,
      sourceName: r.attr_source_name as string,
      entityType: r.attr_entity_type as string,
    },
    entidade: {
      id: r.entity_id as string,
      identificador: r.identificador as string,
      entityType: r.entity_type as string,
    },
    vigencia: {
      snapshotId: r.snapshot_id as string,
      sourceLabel: r.source_label as string,
      effectiveDate: r.effective_date as string,
      datasetFamily: r.dataset_family as string,
      canal: r.canal as string,
      revision: Number(r.revision),
      scopeLabel: r.scope_label as string,
    },
    herdadoDe: r.herdado_id
      ? {
          snapshotId: r.herdado_id as string,
          sourceLabel: r.herdado_label as string,
          effectiveDate: r.herdado_date as string,
        }
      : null,
    celula: {
      rawCellId: Number(r.raw_cell_id),
      aba: r.sheet_name as string,
      linha: Number(r.row_index),
      coluna: r.column_letter as string,
      cabecalho: r.column_header as string | null,
      valorBruto: r.raw_value as string | null,
      textoFormatado: r.formatted_text as string | null,
    },
    importacao: {
      importRunId: r.import_run_id as string,
      status: r.import_status as string,
      startedAt: r.started_at as string,
      arquivo: r.filename as string,
      contentSha256: r.content_sha256 as string,
      recebidoEm: r.received_at as string,
      recebidoPor: r.received_by as string | null,
    },
  };
}

/**
 * Quais importações contribuíram para uma vigência, e com o quê.
 *
 * A pergunta inversa da anterior, e a que responde "qual arquivo poderia
 * completar esta lacuna": ela mostra que uma vigência é feita de mais de um
 * arquivo, quantos fatos cada um pôs, e quantos vieram herdados de uma revisão
 * anterior em vez de terem sido entregues agora.
 */
export async function contribuintesDaVigencia(
  db: Database,
  snapshotId: string,
): Promise<
  {
    importRunId: string;
    arquivo: string;
    contentSha256: string;
    recebidoEm: string;
    fatos: number;
    herdados: number;
    equipamentos: string[];
  }[]
> {
  const { rows } = await db.execute<{
    import_run_id: string;
    filename: string;
    content_sha256: string;
    received_at: string;
    fatos: number;
    herdados: number;
    equipamentos: string[];
  }>(sql`
    SELECT ir.id::text                                        AS import_run_id,
           sf.filename,
           sf.content_sha256,
           sf.received_at::text                               AS received_at,
           count(*)::int                                      AS fatos,
           count(*) FILTER (WHERE f.inherited_from_snapshot_id IS NOT NULL)::int AS herdados,
           array_agg(DISTINCT e.entity_type ORDER BY e.entity_type)             AS equipamentos
      FROM fact f
      JOIN entity e      ON e.id = f.entity_id
      JOIN raw_cell rc   ON rc.id = f.raw_cell_id
      JOIN raw_row rr    ON rr.id = rc.raw_row_id
      JOIN raw_sheet rs  ON rs.id = rr.raw_sheet_id
      JOIN import_run ir ON ir.id = rs.import_run_id
      JOIN source_file sf ON sf.id = ir.source_file_id
     WHERE f.snapshot_id = ${snapshotId}::uuid
     GROUP BY 1, 2, 3, 4
     ORDER BY 4
  `);

  return rows.map((r) => ({
    importRunId: r.import_run_id,
    arquivo: r.filename,
    contentSha256: r.content_sha256,
    recebidoEm: r.received_at,
    fatos: Number(r.fatos),
    herdados: Number(r.herdados),
    equipamentos: r.equipamentos,
  }));
}
