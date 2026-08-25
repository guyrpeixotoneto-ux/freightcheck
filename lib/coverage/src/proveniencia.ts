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

// ── Chegar ao fato pelo vocabulário de quem opera ───────────────────────────

/**
 * A pergunta que quem opera faz, e que `provenienciaDoFato` não aceita.
 *
 * `provenienciaDoFato` precisa de um `factId` — um número que não aparece em
 * tela nenhuma e que ninguém digita. A pergunta real é "de onde veio o seguro
 * da placa ABC1D23 em agosto?", e ela nomeia três coisas: a placa, o parâmetro
 * e a vigência. Este resolvedor é a ponte entre as duas, e ele mora aqui, ao
 * lado da cadeia que percorre, porque é a mesma consulta lendo as mesmas
 * tabelas — pô-lo no Assistente faria uma segunda implementação da identidade
 * de um fato viver fora do pacote que a define.
 *
 * **Três formas de não encontrar, e elas não se confundem.** A placa pode não
 * existir; pode existir e não ter aquele parâmetro na vigência; e a vigência
 * pode não existir. Devolver `null` para as três faria a resposta dizer "não
 * encontrei" quando o certo é dizer *o que* não encontrou — que é a diferença
 * entre encerrar o assunto e apontar o próximo passo.
 */
export type AlvoDaProveniencia =
  | { achou: true; proveniencia: Proveniencia }
  | { achou: false; motivo: "PLACA_DESCONHECIDA"; placa: string }
  | { achou: false; motivo: "SEM_VIGENCIA"; vigencia: string | null }
  | {
      achou: false;
      motivo: "SEM_FATO";
      placa: string;
      atributo: string;
      vigencia: string;
      /** O que aquele veículo **tem** naquela vigência, para a resposta oferecer. */
      atributosDisponiveis: string[];
    };

/**
 * De (placa, parâmetro, vigência) até o arquivo e a célula.
 *
 * A vigência é opcional: omitida, vale a mais recente em que aquele veículo tem
 * o parâmetro — que é o que "de onde veio esse valor?" quer dizer quando
 * ninguém disse a data.
 */
export async function provenienciaDoValor(
  db: Database,
  pedido: {
    placa: string;
    atributo: string;
    vigencia?: string | undefined;
    scopeHash?: string | undefined;
    canal?: string | null | undefined;
  },
): Promise<AlvoDaProveniencia> {
  const placa = pedido.placa.trim().toUpperCase();

  const { rows: doVeiculo } = await db.execute<{ entity_id: string }>(sql`
    SELECT ei.entity_id::text AS entity_id
      FROM entity_identifier ei
     WHERE ei.identifier_type = 'PLACA'
       AND ei.is_current
       AND upper(ei.identifier_value) = ${placa}
     LIMIT 1
  `);
  const entityId = doVeiculo[0]?.entity_id;
  if (!entityId) return { achou: false, motivo: "PLACA_DESCONHECIDA", placa };

  /*
    O fato é escolhido pela vigência pedida ou, sem pedido, pela mais recente
    daquele veículo e parâmetro. `status <> 'SUPERSEDED'` é a mesma condição que
    `listContexts` aplica: uma revisão substituída não descreve o que vale hoje.

    O recorte entra quando quem pergunta o tem — e ele não é opcional por
    conveniência: um veículo pode ter sido transferido de unidade, e responder
    pela vigência de outra operação seria a mesma troca silenciosa que o resto
    deste produto recusa.
  */
  const { rows } = await db.execute<{ fact_id: string; effective_date: string }>(sql`
    SELECT f.id::text AS fact_id, s.effective_date::text AS effective_date
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
     WHERE f.entity_id = ${entityId}::uuid
       AND a.code = ${pedido.atributo}
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       ${pedido.vigencia ? sql`AND s.effective_date = ${pedido.vigencia}::date` : sql``}
       ${pedido.scopeHash ? sql`AND s.scope_hash = ${pedido.scopeHash}` : sql``}
     ORDER BY s.effective_date DESC
     LIMIT 1
  `);

  const achado = rows[0];
  if (!achado) {
    /*
      O que aquele veículo tem naquela vigência. É o que transforma "não
      encontrei" numa informação: quem perguntou pelo seguro e recebe a lista
      dos parâmetros que existem descobre que o nome era outro.
    */
    const { rows: disponiveis } = await db.execute<{ code: string }>(sql`
      SELECT DISTINCT a.code
        FROM fact f
        JOIN attribute a ON a.id = f.attribute_id
        JOIN snapshot s  ON s.id = f.snapshot_id
       WHERE f.entity_id = ${entityId}::uuid
         AND s.status <> 'SUPERSEDED'
         AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
         ${pedido.vigencia ? sql`AND s.effective_date = ${pedido.vigencia}::date` : sql``}
       ORDER BY a.code
       LIMIT 40
    `);
    if (disponiveis.length === 0) {
      return { achou: false, motivo: "SEM_VIGENCIA", vigencia: pedido.vigencia ?? null };
    }
    return {
      achou: false,
      motivo: "SEM_FATO",
      placa,
      atributo: pedido.atributo,
      vigencia: pedido.vigencia ?? "a mais recente",
      atributosDisponiveis: disponiveis.map((d) => d.code),
    };
  }

  const proveniencia = await provenienciaDoFato(db, Number(achado.fact_id));
  if (!proveniencia) {
    return { achou: false, motivo: "SEM_VIGENCIA", vigencia: achado.effective_date };
  }
  return { achou: true, proveniencia };
}
