import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  chaveDeEscopoSql,
  chaveDeSerieSql,
  filtroDeVigenciaDisponivel,
} from "@workspace/availability";
import type { Database } from "@workspace/db";
import { changeSetTable, changeTable, snapshotTable } from "@workspace/db";
import { periodLabel } from "./labels";
import { contextFilter, resolveContext, type SeriesContext } from "./series";

/**
 * Reading a change set.
 *
 * Ordering is by materiality; filtering is by the curator's own vocabulary.
 * The two are deliberately separate concerns — materiality decides *what comes
 * first*, never *what is shown*. A one-real change and a seven-hundred-thousand
 * one are both in the list.
 */

export interface ChangeFilters {
  /** FIXO | VARIAVEL | SEM_CLASSE */
  costClass?: string;
  /** VALUE_CHANGED | ENTITY_ADDED | ENTITY_REMOVED | ATTRIBUTE_ADDED | ATTRIBUTE_REMOVED */
  changeType?: string;
  /** SOURCE_CHANGE | FLEET_CHANGE | LAYOUT_CHANGE */
  category?: string;
  /** CONFIRMED | PRESUMED | UNKNOWN */
  semanticsStatus?: string;
  /** COMPARABLE | INCONCLUSIVE */
  comparability?: string;
  /** CALCULATED | ESTIMATED | NOT_CALCULABLE */
  impactConfidence?: string;
  attributeCode?: string;
  entityLabel?: string;
  /** Absolute impact floor, for narrowing a long list — never a default. */
  minAbsImpact?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ChangeRow {
  id: number;
  category: string;
  changeType: string;
  nature: string | null;
  attributeCode: string | null;
  attributeName: string | null;
  entityLabel: string | null;
  entityType: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  isNullBefore: boolean | null;
  isNullAfter: boolean | null;
  nullReasonBefore: string | null;
  nullReasonAfter: string | null;
  deltaAbsolute: number | null;
  deltaPercent: number | null;
  comparability: string;
  inconclusiveReason: string | null;
  impactConfidence: string;
  impactAmount: number | null;
  impactPeriodicity: string | null;
  impactReason: string | null;
  costClass: string | null;
  taxonomyName: string | null;
  semanticsStatus: string | null;
  semanticsVersionA: number | null;
  semanticsVersionB: number | null;
  /** Desde quando a versão nova vale. Só preenchido quando houve versão. */
  semanticsEffectiveFrom: string | null;
}

function buildWhere(changeSetId: string | string[], f: ChangeFilters): SQL {
  // An array is how the consolidated view reads several series at once. It is
  // still a plain listing of changes — no aggregation happens here.
  const ids = Array.isArray(changeSetId) ? changeSetId : [changeSetId];
  const parts: SQL[] = [
    ids.length === 1
      ? eq(changeTable.changeSetId, ids[0])
      : inArray(changeTable.changeSetId, ids),
  ];

  if (f.costClass === "SEM_CLASSE") {
    parts.push(sql`${changeTable.costClass} IS NULL`);
  } else if (f.costClass) {
    parts.push(eq(changeTable.costClass, f.costClass));
  }
  if (f.changeType) parts.push(eq(changeTable.changeType, f.changeType));
  if (f.category) parts.push(eq(changeTable.category, f.category));
  if (f.semanticsStatus) parts.push(eq(changeTable.semanticsStatus, f.semanticsStatus));
  if (f.comparability) parts.push(eq(changeTable.comparability, f.comparability));
  if (f.impactConfidence)
    parts.push(eq(changeTable.impactConfidence, f.impactConfidence));
  if (f.attributeCode) parts.push(eq(changeTable.attributeCode, f.attributeCode));
  if (f.entityLabel) parts.push(eq(changeTable.entityLabel, f.entityLabel));
  if (f.minAbsImpact !== undefined) {
    parts.push(sql`abs(${changeTable.impactAmount}) >= ${f.minAbsImpact}`);
  }
  if (f.search) {
    const like = `%${f.search}%`;
    parts.push(
      sql`(${changeTable.attributeCode} ILIKE ${like}
        OR ${changeTable.attributeName} ILIKE ${like}
        OR ${changeTable.entityLabel} ILIKE ${like})`,
    );
  }
  return and(...parts)!;
}

export async function listChanges(
  db: Database,
  changeSetId: string | string[],
  filters: ChangeFilters = {},
): Promise<{ total: number; rows: ChangeRow[] }> {
  if (Array.isArray(changeSetId) && changeSetId.length === 0) {
    return { total: 0, rows: [] };
  }
  const where = buildWhere(changeSetId, filters);

  const [count] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(changeTable)
    .where(where);

  const rows = await db
    .select({
      id: changeTable.id,
      category: changeTable.category,
      changeType: changeTable.changeType,
      nature: changeTable.nature,
      attributeCode: changeTable.attributeCode,
      attributeName: changeTable.attributeName,
      entityLabel: changeTable.entityLabel,
      entityType: changeTable.entityType,
      valueBefore: changeTable.valueBefore,
      valueAfter: changeTable.valueAfter,
      isNullBefore: changeTable.isNullBefore,
      isNullAfter: changeTable.isNullAfter,
      nullReasonBefore: changeTable.nullReasonBefore,
      nullReasonAfter: changeTable.nullReasonAfter,
      deltaAbsolute: changeTable.deltaAbsolute,
      deltaPercent: changeTable.deltaPercent,
      comparability: changeTable.comparability,
      inconclusiveReason: changeTable.inconclusiveReason,
      impactConfidence: changeTable.impactConfidence,
      impactAmount: changeTable.impactAmount,
      impactPeriodicity: changeTable.impactPeriodicity,
      impactReason: changeTable.impactReason,
      costClass: changeTable.costClass,
      taxonomyName: changeTable.taxonomyName,
      semanticsStatus: changeTable.semanticsStatus,
      semanticsVersionA: changeTable.semanticsVersionA,
      semanticsVersionB: changeTable.semanticsVersionB,
      // "Desde quando" vem da própria versão, não de uma cópia: se a data for
      // corrigida, a tela passa a mostrar a corrigida.
      semanticsEffectiveFrom: sql<string | null>`(
        SELECT v.effective_from::text FROM attribute_semantics v
         WHERE v.attribute_id = ${changeTable.attributeId}
           AND v.version = ${changeTable.semanticsVersionB}
         LIMIT 1
      )`,
    })
    .from(changeTable)
    .where(where)
    // Materiality first: changes whose worth we actually know, by size. Then
    // everything else by the size of its variation, so a large movement we
    // cannot yet price still rises above a trivial one.
    .orderBy(
      sql`abs(${changeTable.impactAmount}) DESC NULLS LAST`,
      sql`abs(${changeTable.deltaAbsolute}) DESC NULLS LAST`,
      sql`abs(${changeTable.deltaPercent}) DESC NULLS LAST`,
      changeTable.attributeCode,
      changeTable.entityLabel,
      // The last tiebreaker is not decoration: with the list paginated, two
      // rows the order above cannot separate may come back on page 2 and again
      // on page 3 while a third never comes back at all. An audit missing a row
      // is worse than an audit with no paging.
      changeTable.id,
    )
    .limit(filters.limit ?? 200)
    .offset(filters.offset ?? 0);

  return {
    total: count.total,
    rows: rows.map((r) => ({
      ...r,
      deltaAbsolute: r.deltaAbsolute === null ? null : Number(r.deltaAbsolute),
      deltaPercent: r.deltaPercent === null ? null : Number(r.deltaPercent),
      impactAmount: r.impactAmount === null ? null : Number(r.impactAmount),
    })),
  };
}

/**
 * Full provenance for one change: both sides, down to the cell.
 *
 * O tipo de retorno é declarado, e não inferido: espalhar a linha num literal
 * apaga a assinatura de índice que ela tinha, e quem lê `origem.snapshot_before`
 * — a rota e os testes — passaria a não compilar por causa de dois campos novos.
 */
export async function getChangeProvenance(
  db: Database,
  changeId: number,
): Promise<Record<string, unknown> | null> {
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT c.id,
           c.attribute_code,
           c.entity_label,
           c.value_before,
           c.value_after,
           sa.source_label AS snapshot_before,
           sb.source_label AS snapshot_after,
           -- A vigência de cada lado, ao lado do rótulo da entrega. O rótulo
           -- diz *de qual arquivo* veio a célula; sozinho, ele nunca disse *de
           -- quando* — e é o "de quando" que separa uma troca de valor de uma
           -- linha que só mudou de mês.
           sa.effective_date::text AS period_before,
           sb.effective_date::text AS period_after,
           sha.sheet_name  AS sheet_before,
           rra.row_index   AS row_before,
           rca.column_letter AS column_before,
           rca.column_header AS header_before,
           rca.raw_value   AS raw_before,
           rca.source_type AS type_before,
           shb.sheet_name  AS sheet_after,
           rrb.row_index   AS row_after,
           rcb.column_letter AS column_after,
           rcb.column_header AS header_after,
           rcb.raw_value   AS raw_after,
           rcb.source_type AS type_after
      FROM "change" c
      JOIN change_set cs ON cs.id = c.change_set_id
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
      LEFT JOIN fact fa ON fa.id = c.fact_a_id
      LEFT JOIN raw_cell rca ON rca.id = fa.raw_cell_id
      LEFT JOIN raw_row rra ON rra.id = rca.raw_row_id
      LEFT JOIN raw_sheet sha ON sha.id = rra.raw_sheet_id
      LEFT JOIN fact fb ON fb.id = c.fact_b_id
      LEFT JOIN raw_cell rcb ON rcb.id = fb.raw_cell_id
      LEFT JOIN raw_row rrb ON rrb.id = rcb.raw_row_id
      LEFT JOIN raw_sheet shb ON shb.id = rrb.raw_sheet_id
     WHERE c.id = ${changeId}
  `);
  const row = rows[0];
  if (!row) return null;
  // O rótulo de leitura sai daqui, e não do SQL: o mês em português é
  // vocabulário de tela, e `periodLabel` é onde ele está escrito uma vez só.
  return {
    ...row,
    period_before_label:
      typeof row.period_before === "string" ? periodLabel(row.period_before) : null,
    period_after_label:
      typeof row.period_after === "string" ? periodLabel(row.period_after) : null,
  };
}

/**
 * Onde as alterações se concentram, atributo a atributo.
 *
 * Duas perguntas diferentes moram na mesma linha: *o que mais mudou* é uma
 * contagem, *o que mais custou* é dinheiro, e o primeiro colocado quase nunca é
 * o mesmo nos dois. Por isso `count` e `impact` vêm juntos e separados — quem
 * lê escolhe a régua, e nenhuma delas vira a outra por descuido.
 *
 * `impact` é uma lista, e não um total: R$/mês e R$/ano são grandezas
 * diferentes. Somá-las aqui produziria justamente o erro que este produto
 * existe para pegar, e a soma por periodicidade é a mesma que o cartão do topo
 * mostra — os dois números têm de fechar.
 */
export interface AttributeRollup {
  attributeCode: string;
  attributeName: string | null;
  count: number;
  /** Quantas das `count` têm preço apurado — o resto é fato sem preço. */
  calculated: number;
  /** Impacto apurado, uma entrada por periodicidade. Nunca somadas entre si. */
  impact: { periodicity: string; amount: number }[];
}

/** Breakdown for the header of the Alterações screen. */
export async function getChangeSetBreakdown(
  db: Database,
  changeSetId: string | string[],
) {
  const ids = Array.isArray(changeSetId) ? changeSetId : [changeSetId];
  if (ids.length === 0) {
    return {
      byCostClass: [],
      byType: [],
      byImpactConfidence: [],
      bySemantics: [],
      byAttribute: [],
    };
  }
  const scope = inArray(changeTable.changeSetId, ids);
  const byCostClass = await db
    .select({
      costClass: changeTable.costClass,
      count: sql<number>`count(*)`.mapWith(Number),
      impact: sql<string | null>`sum(${changeTable.impactAmount})`,
    })
    .from(changeTable)
    .where(scope)
    .groupBy(changeTable.costClass)
    .orderBy(changeTable.costClass);

  const byType = await db
    .select({
      changeType: changeTable.changeType,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(changeTable)
    .where(scope)
    .groupBy(changeTable.changeType)
    .orderBy(changeTable.changeType);

  const bySemantics = await db
    .select({
      semanticsStatus: changeTable.semanticsStatus,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(changeTable)
    .where(scope)
    .groupBy(changeTable.semanticsStatus)
    .orderBy(changeTable.semanticsStatus);

  /*
    Quantas têm preço apurado, e quantas não têm.

    Os dois chips que perguntam isso são os únicos da fileira da frente sem
    contagem ao lado, e a falta não é neutra: ao lado de três chips de classe
    que dizem o seu tamanho, dois que não dizem leem-se como "não há o que
    contar aqui". A conta é a mesma dos outros agrupamentos, e sai da mesma
    varredura.
  */
  const byImpactConfidence = await db
    .select({
      impactConfidence: changeTable.impactConfidence,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(changeTable)
    .where(scope)
    .groupBy(changeTable.impactConfidence)
    .orderBy(changeTable.impactConfidence);

  /*
    Sem teto: o universo aqui é o de colunas da planilha — dezenas —, e não o de
    linhas. Cortar no top-N pareceria prudente e seria a única forma de um
    atributo caro sumir da leitura sem nada dizer que ele existia.

    `attributeName` sai por `max()` porque o agrupamento é pelo código: o nome é
    rótulo do mesmo atributo, e agrupar pelos dois partiria uma linha em duas na
    vigência em que o cabeçalho foi reescrito.
  */
  const temAtributo = sql`${changeTable.attributeCode} IS NOT NULL`;
  const byAttribute = await db
    .select({
      attributeCode: changeTable.attributeCode,
      attributeName: sql<string | null>`max(${changeTable.attributeName})`,
      count: sql<number>`count(*)`.mapWith(Number),
      calculated: sql<number>`count(*) FILTER (
        WHERE ${changeTable.impactConfidence} = 'CALCULATED'
          AND ${changeTable.impactAmount} IS NOT NULL
      )`.mapWith(Number),
    })
    .from(changeTable)
    .where(and(scope, temAtributo))
    .groupBy(changeTable.attributeCode)
    .orderBy(sql`count(*) DESC`, changeTable.attributeCode);

  /*
    O mesmo recorte de `assessImpact`: só o que tem preço apurado entra, e uma
    alteração sem periodicidade declarada ganha o próprio balde em vez de um
    destino silencioso. É o que faz esta lista fechar com `impactByPeriodicity`.
  */
  const bucket = sql<string>`coalesce(${changeTable.impactPeriodicity}, 'SEM_PERIODICIDADE')`;
  const impacts = await db
    .select({
      attributeCode: changeTable.attributeCode,
      periodicity: bucket,
      amount: sql<string | null>`sum(${changeTable.impactAmount})`,
    })
    .from(changeTable)
    .where(
      and(
        scope,
        temAtributo,
        eq(changeTable.impactConfidence, "CALCULATED"),
        sql`${changeTable.impactAmount} IS NOT NULL`,
      ),
    )
    .groupBy(changeTable.attributeCode, bucket)
    .orderBy(changeTable.attributeCode);

  const impactoPorAtributo = new Map<string, AttributeRollup["impact"]>();
  for (const linha of impacts) {
    if (linha.attributeCode === null || linha.amount === null) continue;
    const lista = impactoPorAtributo.get(linha.attributeCode) ?? [];
    lista.push({ periodicity: linha.periodicity, amount: Number(linha.amount) });
    impactoPorAtributo.set(linha.attributeCode, lista);
  }

  return {
    byCostClass: byCostClass.map((r) => ({
      costClass: r.costClass ?? "SEM_CLASSE",
      count: r.count,
      impact: r.impact === null ? null : Number(r.impact),
    })),
    byType,
    byImpactConfidence,
    bySemantics: bySemantics.map((r) => ({
      semanticsStatus: r.semanticsStatus ?? "(sem atributo)",
      count: r.count,
    })),
    byAttribute: byAttribute.flatMap<AttributeRollup>((r) =>
      r.attributeCode === null
        ? []
        : [
            {
              attributeCode: r.attributeCode,
              attributeName: r.attributeName,
              count: r.count,
              calculated: r.calculated,
              impact: impactoPorAtributo.get(r.attributeCode) ?? [],
            },
          ],
    ),
  };
}

/** Every comparison on record, newest first. */
export async function listChangeSets(db: Database) {
  const sa = sql`sa`;
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT cs.*,
           sa.source_label   AS snapshot_a_label,
           sa.effective_date AS snapshot_a_date,
           sb.source_label   AS snapshot_b_label,
           sb.effective_date AS snapshot_b_date
      FROM change_set cs
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
     ORDER BY sb.effective_date DESC
  `);
  return rows;
}

/** Live snapshots, oldest first — the pickers on Comparar read this. */
export async function listComparableSnapshots(db: Database) {
  return db
    .select({
      id: snapshotTable.id,
      sourceLabel: snapshotTable.sourceLabel,
      effectiveDate: snapshotTable.effectiveDate,
      entityTypeSet: snapshotTable.entityTypeSet,
      scopeHash: sql<string>`${chaveDeEscopoSql("snapshot")}`,
      canal: snapshotTable.canal,
      /*
        A série a que esta vigência pertence, **lida da autoridade**.

        Vem daqui e não é remontada por quem agrupa: montar a chave em memória
        foi como o produto acabou com cinco definições de série, e a última
        delas — `scope_hash|canal|entity_type_set` — estava certa por acidente,
        porque a cobertura de equipamento vinha encobrindo a falta de
        `dataset_family`.
      */
      serie: sql<string>`${chaveDeSerieSql("snapshot")}`,
      revision: snapshotTable.revision,
      status: snapshotTable.status,
      entityCount: snapshotTable.entityCount,
      factCount: snapshotTable.factCount,
    })
    .from(snapshotTable)
    .where(filtroDeVigenciaDisponivel("snapshot"))
    .orderBy(snapshotTable.effectiveDate);
}

/**
 * The panel's numbers, and only the ones that are real.
 *
 * No forecast, no annualisation, no aggregate that mixes periodicities: the
 * page shows what the system currently knows, and says plainly how much of the
 * remuneration it still cannot price.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo contava, e por que parou
 * ---------------------------------------------------------------------------
 *
 * **Doze contadores, e nove liam o banco inteiro.** `count(*) FROM fact` conta
 * os fatos de revisões substituídas; `count(*) FROM entity` conta todo ativo
 * que já passou por aqui, de qualquer unidade e de qualquer era; as
 * comparações e as alterações somam pares cujas vigências já saíram de cena. É
 * o defeito que a auditoria mediu — e é pior do que um número grande demais:
 * o Painel é a primeira tela que alguém abre, e ela discordava da Cobertura
 * sobre quantas vigências existem.
 *
 * Agora **toda** contagem passa pela vigência disponível, e todas aceitam o
 * mesmo recorte de contexto que o resto do produto usa.
 *
 * **Uma mudança de significado, declarada.** Os três contadores de dicionário
 * — atributos, confirmados, monetários pendentes — descreviam o dicionário
 * inteiro, que é global por construção. Continuar assim seria coerente hoje e
 * errado no dia em que a segunda unidade chegar: a tela recortada por Camaçari
 * mostraria as colunas de Manaus na conta. Eles passam a descrever **as
 * colunas entregues no recorte**, o que mantém `confirmados ≤ atributos`
 * verdadeiro e responde à pergunta que a tela faz. O número muda quando o
 * dicionário tem colunas que nenhuma vigência viva entregou.
 *
 * **O que continua sem recorte, por escolha.** Sem contexto pedido, o Painel é
 * o censo do banco — todas as unidades, todos os canais. Isso não é omissão: é
 * a resposta certa para "o que o sistema sabe". O que mudou é que o censo
 * agora é das vigências **vivas**, e que pedir um contexto passa a funcionar.
 */
export async function getOverview(
  db: Database,
  contextoPedido?: Partial<SeriesContext>,
) {
  /*
    O recorte, uma vez, aplicado a tudo.

    Resolver só quando **pedido** é deliberado: `resolveContext(db, undefined)`
    devolve o contexto mais recente, e o Painel sem recorte não é "a unidade
    mais recente" — é o censo. Pedir um contexto que não existe é erro, e
    `resolveContext` já o transforma em `ContextNotFoundError`, que a rota
    traduz em 404. Silenciar isso faria a tela mostrar o banco inteiro sob o
    título de uma unidade.

    `contextFilter` é o mesmo predicado que Alterações, Impacto, Composição e
    DRE usam — é assim que o Painel para de ser a única tela com a sua própria
    ideia de "quais vigências contam".
  */
  const contexto = contextoPedido
    ? await resolveContext(db, contextoPedido)
    : null;
  const recorte = contexto ? contextFilter("s", contexto) : sql`true`;
  const vivas = sql`(SELECT s.id FROM snapshot s
                      WHERE ${filtroDeVigenciaDisponivel("s")} AND ${recorte})`;

  const { rows } = await db.execute<Record<string, unknown>>(sql`
    WITH vivas AS (
      SELECT s.id, s.effective_date
        FROM snapshot s
       WHERE ${filtroDeVigenciaDisponivel("s")}
         AND ${recorte}
    ),
    /*
      Os atributos **entregues** — não os do dicionário. É a mudança de
      significado descrita no cabeçalho: snapshot_attribute diz que colunas
      cada vigência trouxe, e é só sobre elas que a tela fala.
    */
    entregues AS (
      SELECT DISTINCT sa.attribute_id
        FROM snapshot_attribute sa
        JOIN vivas v ON v.id = sa.snapshot_id
    ),
    /*
      As comparações que terminam numa vigência viva do recorte. Um change_set
      cujo lado B foi substituído descreve um mundo que não existe mais;
      contá-lo é somar a história com o presente.
    */
    comparacoes AS (
      SELECT cs.id
        FROM change_set cs
        JOIN vivas v ON v.id = cs.snapshot_b_id
    )
    SELECT
      (SELECT count(*) FROM vivas)                    AS vigencias,
      (SELECT min(effective_date) FROM vivas)         AS primeira_vigencia,
      (SELECT max(effective_date) FROM vivas)         AS ultima_vigencia,
      (SELECT count(DISTINCT f.entity_id)
         FROM fact f JOIN vivas v ON v.id = f.snapshot_id)  AS ativos,
      (SELECT count(*)
         FROM fact f JOIN vivas v ON v.id = f.snapshot_id)  AS fatos,
      (SELECT count(*) FROM entregues)                AS atributos,
      (SELECT count(*) FROM entregues e JOIN attribute a ON a.id = e.attribute_id
        WHERE a.semantics_status = 'CONFIRMED')       AS atributos_confirmados,
      (SELECT count(*) FROM entregues e JOIN attribute a ON a.id = e.attribute_id
        WHERE a.is_monetary IS TRUE
          AND a.semantics_status <> 'CONFIRMED')      AS monetarios_pendentes,
      (SELECT count(*) FROM comparacoes)              AS comparacoes,
      (SELECT count(*) FROM "change" ch JOIN comparacoes c ON c.id = ch.change_set_id
        WHERE ch.change_type = 'VALUE_CHANGED')       AS alteracoes,
      (SELECT count(*) FROM "change" ch JOIN comparacoes c ON c.id = ch.change_set_id
        WHERE ch.impact_confidence = 'CALCULATED')    AS com_impacto,
      (SELECT count(*) FROM "change" ch JOIN comparacoes c ON c.id = ch.change_set_id
        WHERE ch.comparability = 'INCONCLUSIVE')      AS inconclusivas
  `);
  const totals = rows[0] ?? {};

  /**
   * The comparisons that land on the most recent vigência — **all of them**.
   *
   * This used to be `ORDER BY sb.effective_date DESC LIMIT 1`. Carretas and
   * cavalos are separate series that share the same vigência dates, so the two
   * rows tie on the sort key and the winner was whatever Postgres happened to
   * return. On the real export that meant the panel reported the CAVALO series
   * (244 changes, +R$ 6.747,20/mês) and silently dropped the CARRETA one
   * (23 changes, +R$ 33.189,08/mês) — it showed the smaller number and said
   * nothing about the larger.
   *
   * Now the date is picked first and every series on it is returned, ordered by
   * `entity_type_set` so the result never reorders between calls.
   */
  const { rows: latest } = await db.execute<Record<string, unknown>>(sql`
    SELECT cs.id,
           sa.source_label AS snapshot_a_label,
           sb.source_label AS snapshot_b_label,
           sb.effective_date AS effective_date,
           sb.entity_type_set,
           cs.value_changes,
           cs.entities_added,
           cs.entities_removed,
           cs.inconclusive,
           cs.impact_not_calculable,
           cs.calculated_impact_by_periodicity
      FROM change_set cs
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
     WHERE sb.id IN ${vivas}
       AND sb.effective_date = (
         SELECT max(s.effective_date)
           FROM change_set c JOIN snapshot s ON s.id = c.snapshot_b_id
          WHERE s.id IN ${vivas}
       )
     ORDER BY sb.entity_type_set
  `);

  /*
    Impacto por periodicidade, sobre as comparações que terminam numa vigência
    viva do recorte. Separado por periodicidade, nunca somado — ver
    `change_set.calculated_impact_by_periodicity`.

    O `WHERE` era só `impact_confidence = 'CALCULATED'`, sobre a tabela inteira:
    o impacto de uma revisão substituída entrava no acumulado do Painel, e o de
    outra unidade também.
  */
  const impactByPeriodicity = await db
    .select({
      periodicity: changeTable.impactPeriodicity,
      changes: sql<number>`count(*)`.mapWith(Number),
      total: sql<string>`sum(${changeTable.impactAmount})`,
    })
    .from(changeTable)
    .where(
      and(
        eq(changeTable.impactConfidence, "CALCULATED"),
        sql`${changeTable.changeSetId} IN (
              SELECT cs.id FROM change_set cs WHERE cs.snapshot_b_id IN ${vivas})`,
      ),
    )
    .groupBy(changeTable.impactPeriodicity)
    .orderBy(changeTable.impactPeriodicity);

  return {
    /**
     * O recorte que produziu estes números, ou `null` quando é o censo.
     *
     * Vai na resposta porque um número sem recorte à vista é um número que a
     * tela pode legendar errado — e foi assim que o Painel passou a discordar
     * da Cobertura sem que ninguém visse a discordância.
     */
    contexto,
    totals,
    /** Kept for callers that still read one series; it is now the first by name. */
    latest: latest[0] ?? null,
    /** Every series on the most recent vigência. None is hidden by a tie-break. */
    latestSeries: latest,
    /**
     * Accumulated across every comparison on record — **not** the latest
     * vigência. The name says so because the screen that read this field
     * printed sixteen transitions' worth of impact under a single vigência's
     * heading.
     */
    accumulatedImpactByPeriodicity: impactByPeriodicity.map((r) => ({
      periodicity: r.periodicity ?? "SEM_PERIODICIDADE",
      changes: r.changes,
      total: r.total === null ? null : Number(r.total),
    })),
    impactByPeriodicity: impactByPeriodicity.map((r) => ({
      periodicity: r.periodicity ?? "SEM_PERIODICIDADE",
      changes: r.changes,
      total: r.total === null ? null : Number(r.total),
    })),
  };
}

export async function getChangeSetForPair(
  db: Database,
  snapshotAId: string,
  snapshotBId: string,
) {
  const [set] = await db
    .select()
    .from(changeSetTable)
    .where(
      and(
        eq(changeSetTable.snapshotAId, snapshotAId),
        eq(changeSetTable.snapshotBId, snapshotBId),
      ),
    );
  return set ?? null;
}
