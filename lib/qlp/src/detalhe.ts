import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  contextFilter,
  loadAttributeClassificationsAt,
  periodLabel,
  type RequestedContext,
} from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest";
import {
  TIPO_QLP_ADMINISTRATIVO,
  resolverContextoDoQuadro,
  type ContextoDoQuadro,
} from "./contexto";
import { separarChaveLegivel, type SemanticaDaColuna, type ValorDeFato } from "./quadro";

/**
 * A ficha de um cargo numa vigência: os fatos que o export declarou para ele,
 * cada um com a semântica curada e com a célula de origem.
 *
 * A proveniência vem no mesmo `SELECT` dos fatos, de propósito — a mesma
 * decisão do motor da Composição: numa tela de auditoria, o número e a origem
 * dele nascem juntos ou nenhum dos dois vale.
 */

export interface OrigemDoFato {
  /** O arquivo recebido, pelo nome com que chegou. */
  arquivo: string | null;
  aba: string | null;
  /** Linha física da planilha, 1-based. */
  linha: number | null;
  coluna: string | null;
  cabecalho: string | null;
  /** O texto da célula como veio, antes de qualquer tipagem. */
  valorBruto: string | null;
}

export interface FatoDoCargo {
  code: string;
  sourceName: string;
  displayName: string | null;
  dataType: string;
  valor: ValorDeFato;
  isNull: boolean;
  nullReason: string | null;
  semantica: SemanticaDaColuna;
  /** O rótulo da vigência de onde o fato veio por herança, quando veio. */
  herdadoDe: string | null;
  origem: OrigemDoFato;
}

export interface DetalheDoCargo extends ContextoDoQuadro {
  entityId: string;
  cargo: string;
  unidadeCnpjLegivel: string;
  /** A chave como a identidade canônica a escreve: "CNPJ · CARGO". */
  chaveLegivel: string;
  /** Falso quando o cargo existe na série mas não nesta vigência. */
  presente: boolean;
  atributos: FatoDoCargo[];
  /** As vigências da série em que este cargo aparece, da mais antiga à mais nova. */
  vigenciasDoCargo: { effectiveDate: string; periodLabel: string }[];
}

type LinhaDeFato = {
  attribute_id: string;
  code: string;
  source_name: string;
  display_name: string | null;
  data_type: string;
  value_numeric: string | null;
  value_text: string | null;
  value_boolean: boolean | null;
  value_date: string | null;
  is_null: boolean;
  null_reason: string | null;
  herdado_de: string | null;
  sheet_name: string | null;
  row_index: number | null;
  column_letter: string | null;
  column_header: string | null;
  raw_value: string | null;
  filename: string | null;
}

export async function getDetalheDoCargo(
  db: Database,
  entityId: string,
  options: { period?: string; context?: RequestedContext } = {},
): Promise<DetalheDoCargo | null> {
  const { rows: entidades } = await db.execute<{ identifier_value_raw: string }>(sql`
    SELECT ei.identifier_value_raw
      FROM entity e
      JOIN entity_identifier ei
        ON ei.entity_id = e.id
       AND ei.identifier_type = 'PLACA'
       AND ei.is_current
     WHERE e.id = ${entityId}::uuid
       AND e.entity_type = ${TIPO_QLP_ADMINISTRATIVO}
  `);
  if (entidades.length === 0) return null;
  const chaveLegivel = entidades[0].identifier_value_raw;
  const { cnpjLegivel, cargo } = separarChaveLegivel(chaveLegivel);

  const resolvido = await resolverContextoDoQuadro(db, {
    ...options.context,
    ...(options.period !== undefined ? { period: options.period } : {}),
  });
  if (!resolvido) return null;
  const { context, effectiveDate } = resolvido;

  const { rows } = await db.execute<LinhaDeFato>(sql`
    SELECT a.id::text            AS attribute_id,
           a.code,
           a.source_name,
           a.display_name,
           a.data_type,
           f.value_numeric::text AS value_numeric,
           f.value_text,
           f.value_boolean,
           f.value_date::text    AS value_date,
           f.is_null,
           f.null_reason,
           origem.source_label   AS herdado_de,
           sh.sheet_name,
           r.row_index,
           c.column_letter,
           c.column_header,
           c.raw_value,
           sf.filename
      FROM fato_visivel f
      JOIN snapshot s   ON s.id = f.snapshot_id
      JOIN attribute a  ON a.id = f.attribute_id
      LEFT JOIN snapshot origem ON origem.id = f.inherited_from_snapshot_id
      LEFT JOIN raw_cell c   ON c.id = f.raw_cell_id
      LEFT JOIN raw_row r    ON r.id = c.raw_row_id
      LEFT JOIN raw_sheet sh ON sh.id = r.raw_sheet_id
      LEFT JOIN import_run ir ON ir.id = sh.import_run_id
      LEFT JOIN source_file sf ON sf.id = ir.source_file_id
     WHERE f.entity_id = ${entityId}::uuid
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND s.effective_date = ${effectiveDate}::date
       AND ${contextFilter("s", context)}
     ORDER BY a.code
  `);

  const classificacoes = await loadAttributeClassificationsAt(db, effectiveDate);

  const atributos: FatoDoCargo[] = rows.map((linha) => {
    const cls = classificacoes.get(linha.attribute_id);
    return {
      code: linha.code,
      sourceName: linha.source_name,
      displayName: linha.display_name,
      dataType: linha.data_type,
      valor: linha.is_null
        ? null
        : linha.value_numeric !== null
          ? Number(linha.value_numeric)
          : (linha.value_text ?? linha.value_boolean ?? linha.value_date),
      isNull: linha.is_null,
      nullReason: linha.null_reason,
      semantica: {
        status: cls?.semanticsStatus ?? "UNKNOWN",
        isMonetary: cls?.isMonetary ?? null,
        unit: cls?.unit ?? null,
        periodicity: cls?.periodicity ?? null,
        aggregation: cls?.aggregation ?? null,
      },
      herdadoDe: linha.herdado_de,
      origem: {
        arquivo: linha.filename,
        aba: linha.sheet_name,
        linha: linha.row_index,
        coluna: linha.column_letter,
        cabecalho: linha.column_header,
        valorBruto: linha.raw_value,
      },
    };
  });

  const { rows: presencas } = await db.execute<{ effective_date: string }>(sql`
    SELECT DISTINCT s.effective_date::text AS effective_date
      FROM fato_visivel f
      JOIN snapshot s ON s.id = f.snapshot_id
     WHERE f.entity_id = ${entityId}::uuid
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND s.dataset_family = ${DATASET_FAMILY_QUADRO_DE_PESSOAL}
       AND ${contextFilter("s", context)}
     ORDER BY 1
  `);

  return {
    ...resolvido,
    entityId,
    cargo,
    unidadeCnpjLegivel: cnpjLegivel,
    chaveLegivel,
    presente: atributos.length > 0,
    atributos,
    vigenciasDoCargo: presencas.map((p) => ({
      effectiveDate: p.effective_date,
      periodLabel: periodLabel(p.effective_date),
    })),
  };
}
