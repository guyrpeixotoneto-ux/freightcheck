import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  ALTERACAO_DE_ORIGEM_VISIVEL,
  attributeTable,
  changeSetTable,
  changeTable,
  snapshotTable,
} from "@workspace/db";
import type { EscopoDeFrota } from "./escopo";
import { attributeLabel, periodLabel } from "./labels";
import { impactoApurado, linhasApuradas } from "./impacto-apurado";
import { datasetFamilyFilter, operacaoFilter, type Operacao } from "./series";
import type { RastroDaDeducao } from "./deduplicacao";

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
  /**
   * CAVALO | CARRETA — o equipamento da linha.
   *
   * Recorte de **linha**, e não de comparação: `entityTypeSet` escolhe qual
   * comparação ler (a série tem vigências próprias), enquanto este diz quais
   * linhas de uma leitura já feita ficam à vista. A diferença importa quando a
   * vigência está fixada: filtrar por equipamento dentro do período pedido
   * responde "o que mudou no cavalo em agosto"; trocar de série responderia "o
   * que mudou no cavalo na última vigência dele", que é outra pergunta e pode
   * ser outro mês.
   */
  entityType?: string;
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

/**
 * Pressupõe a junção `ATRIBUTO_ATUAL`: a busca por texto olha também o nome
 * gerencial, que vive em `attribute` e não na cópia denormalizada.
 */
/**
 * As condições de um filtro de Alterações, sem a escolha das comparações.
 *
 * Extraídas de `buildWhere` para que **a lista e os totais do cabeçalho usem
 * exatamente as mesmas**. Enquanto só a lista as aplicava, a tela mostrava
 * "19 com impacto" embaixo de um cabeçalho que dizia "267 alterações · R$
 * 39.936" — dois recortes diferentes empilhados, e o de cima com cara de total.
 */
export function condicoesDoFiltro(f: ChangeFilters): SQL[] {
  const parts: SQL[] = [];
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
  if (f.entityType) parts.push(eq(changeTable.entityType, f.entityType));
  if (f.entityLabel) parts.push(eq(changeTable.entityLabel, f.entityLabel));
  if (f.minAbsImpact !== undefined) {
    parts.push(sql`abs(${changeTable.impactAmount}) >= ${f.minAbsImpact}`);
  }
  if (f.search) {
    const like = `%${f.search}%`;
    parts.push(
      sql`(${changeTable.attributeCode} ILIKE ${like}
        OR ${changeTable.attributeName} ILIKE ${like}
        -- O nome gerencial de hoje também procura: quem batizou a coluna
        -- procura pelo nome que deu, e a cópia denormalizada acima só conhece
        -- o nome que valia quando a comparação rodou.
        OR ${attributeTable.displayName} ILIKE ${like}
        OR ${changeTable.entityLabel} ILIKE ${like})`,
    );
  }
  return parts;
}

function buildWhere(changeSetId: string | string[], f: ChangeFilters): SQL {
  // An array is how the consolidated view reads several series at once. It is
  // still a plain listing of changes — no aggregation happens here.
  const ids = Array.isArray(changeSetId) ? changeSetId : [changeSetId];
  return and(
    ids.length === 1
      ? eq(changeTable.changeSetId, ids[0])
      : inArray(changeTable.changeSetId, ids),
    ALTERACAO_DE_ORIGEM_VISIVEL,
    ...condicoesDoFiltro(f),
  )!;
}

/**
 * O atributo como ele está hoje, ao lado da alteração que o cita.
 *
 * Por `code`, e não por `attribute_id`: o código é a identidade que esta tela
 * agrupa e filtra, e é ele que sobrevive a uma correção de identidade que
 * refaça a linha de `attribute`. Por chave única dos dois lados, então a junção
 * nunca multiplica linha nenhuma — o `count(*)` continua contando alterações.
 */
const ATRIBUTO_ATUAL = eq(attributeTable.code, changeTable.attributeCode);

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
    .leftJoin(attributeTable, ATRIBUTO_ATUAL)
    .where(where);

  const rows = await db
    .select({
      id: changeTable.id,
      category: changeTable.category,
      changeType: changeTable.changeType,
      nature: changeTable.nature,
      attributeCode: changeTable.attributeCode,
      attributeName: changeTable.attributeName,
      /* O nome de leitura não sai da cópia denormalizada — ver o `map` no fim
         desta função. */
      attributeSourceName: attributeTable.sourceName,
      attributeDisplayName: attributeTable.displayName,
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
    .leftJoin(attributeTable, ATRIBUTO_ATUAL)
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
    rows: rows.map(({ attributeSourceName, attributeDisplayName, ...r }) => ({
      ...r,
      attributeName: nomeDeLeitura(
        r.attributeCode,
        r.attributeName,
        attributeSourceName,
        attributeDisplayName,
      ),
      deltaAbsolute: r.deltaAbsolute === null ? null : Number(r.deltaAbsolute),
      deltaPercent: r.deltaPercent === null ? null : Number(r.deltaPercent),
      impactAmount: r.impactAmount === null ? null : Number(r.impactAmount),
    })),
  };
}

/**
 * O nome com que a alteração se apresenta na tela.
 *
 * `change.attribute_name` é o que a comparação denormalizou no dia em que
 * rodou. Servido cru, um nome gerencial dado depois não aparece em lugar
 * nenhum desta tela — o painel "Atributos mais alterados" continuava dizendo
 * `combustivelVidaCavalo` enquanto a curadoria, a Composição e os Chamados já
 * diziam o apelido, e as duas telas pareciam falar de colunas diferentes.
 *
 * Então o nome sai do estado atual do atributo, pela mesma `attributeLabel` que
 * o resto do produto usa: apelido da curadoria, vocabulário de `labels.ts`, e
 * por fim o literal da planilha. Nada se perde — o código continua ao lado do
 * nome na lista, e o literal continua na proveniência.
 *
 * Quando não há atributo (uma entrada ou saída de frota), não há nome a
 * resolver: devolve o que estava gravado, inclusive `null`, que a tela já sabe
 * mostrar como "—".
 */
function nomeDeLeitura(
  attributeCode: string | null,
  denormalizado: string | null,
  sourceName: string | null,
  displayName: string | null,
): string | null {
  if (attributeCode === null) return denormalizado;
  return attributeLabel(attributeCode, sourceName ?? denormalizado, displayName);
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
      FROM "alteracao_visivel" c
      JOIN change_set cs ON cs.id = c.change_set_id
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
      LEFT JOIN fato_visivel fa ON fa.id = c.fact_a_id
      LEFT JOIN raw_cell rca ON rca.id = fa.raw_cell_id
      LEFT JOIN raw_row rra ON rra.id = rca.raw_row_id
      LEFT JOIN raw_sheet sha ON sha.id = rra.raw_sheet_id
      LEFT JOIN fato_visivel fb ON fb.id = c.fact_b_id
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

/**
 * O escopo de frota como predicado sobre `change`.
 *
 * Fica ao lado de `buildWhere` e não dentro dele porque as duas coisas não são
 * a mesma — ver o cabeçalho de `escopo.ts`. O filtro estreita a lista dentro de
 * uma população anunciada; o escopo troca a população, e por isso ele precisa
 * alcançar também o breakdown e os totais, que nenhum filtro alcança.
 *
 * A placa é comparada com `entity_label`, a cópia denormalizada do
 * identificador corrente: é o mesmo texto que a aba Chamados carrega, e é o que
 * permite ao mesmo escopo atravessar as duas leituras.
 */
function escopoDeFrota(escopo: EscopoDeFrota): SQL[] {
  const parts: SQL[] = [];
  if (escopo.entityType) parts.push(eq(changeTable.entityType, escopo.entityType));
  if (escopo.plate) parts.push(eq(changeTable.entityLabel, escopo.plate));
  return parts;
}

/** Breakdown for the header of the Alterações screen. */
export async function getChangeSetBreakdown(
  db: Database,
  changeSetId: string | string[],
  escopo: EscopoDeFrota = {},
  filtros: ChangeFilters = {},
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
  const recorte = [...escopoDeFrota(escopo), ...condicoesDoFiltro(filtros)];
  const scope = and(
    inArray(changeTable.changeSetId, ids),
    ALTERACAO_DE_ORIGEM_VISIVEL,
    ...recorte,
  )!;

  /*
    As decisões de dupla contagem, tomadas uma vez para a comparação inteira e
    reaproveitadas por todos os agrupamentos abaixo. Cada `GROUP BY` daqui
    somava `impact_amount` cru: o cabeçalho da tela dizia um número e o cartão
    dizia outro, sobre exatamente as mesmas linhas.
  */
  const decididas = await linhasApuradas(db, ids, recorte);
  const contam = decididas.filter((l) => l.noRecorte && l.foraDoTotal === null);

  const porClasse = new Map<string, number>();
  for (const l of contam) {
    if (l.amount === null) continue;
    const chave = l.costClass ?? "";
    porClasse.set(chave, (porClasse.get(chave) ?? 0) + l.amount);
  }

  const byCostClass = (
    await db
      .select({
        costClass: changeTable.costClass,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(changeTable)
      .where(scope)
      .groupBy(changeTable.costClass)
      .orderBy(changeTable.costClass)
  ).map((linha) => ({
    ...linha,
    impact: porClasse.has(linha.costClass ?? "")
      ? String(Number(porClasse.get(linha.costClass ?? "")!.toFixed(6)))
      : null,
  }));

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

    O nome de leitura, esse, vem do atributo como ele está hoje — `max()` sobre
    uma junção por chave única é o próprio valor da linha, e não uma escolha
    entre vários. Sem isso, um nome gerencial dado depois da comparação não
    chegaria a este painel: era o que fazia a lista dizer `combustivelVidaCavalo`
    do atributo que a curadoria já tinha batizado.
  */
  const temAtributo = sql`${changeTable.attributeCode} IS NOT NULL`;
  const byAttribute = await db
    .select({
      attributeCode: changeTable.attributeCode,
      attributeName: sql<string | null>`max(${changeTable.attributeName})`,
      attributeSourceName: sql<string | null>`max(${attributeTable.sourceName})`,
      attributeDisplayName: sql<string | null>`max(${attributeTable.displayName})`,
      count: sql<number>`count(*)`.mapWith(Number),
      calculated: sql<number>`count(*) FILTER (
        WHERE ${changeTable.impactConfidence} = 'CALCULATED'
          AND ${changeTable.impactAmount} IS NOT NULL
      )`.mapWith(Number),
    })
    .from(changeTable)
    .leftJoin(attributeTable, ATRIBUTO_ATUAL)
    .where(and(scope, temAtributo))
    .groupBy(changeTable.attributeCode)
    .orderBy(sql`count(*) DESC`, changeTable.attributeCode);

  /*
    O mesmo recorte de `assessImpact`: só o que tem preço apurado entra, e uma
    alteração sem periodicidade declarada ganha o próprio balde em vez de um
    destino silencioso. É o que faz esta lista fechar com `impactByPeriodicity`.
  */
  /*
    O impacto por atributo sai das linhas já decididas — o mesmo conjunto que
    alimenta o cartão. Era aqui que "Impactos relevantes" abria agosto/2026 com
    `custoFixo +R$ 16.595/mês`: um número que a soma oficial já havia tirado
    inteiro por dupla contagem, em destaque no topo da tela.

    Uma alteração sem periodicidade declarada ganha o próprio balde em vez de um
    destino silencioso, como em `assessImpact`.
  */
  const porAtributo = new Map<string, Map<string, number>>();
  for (const l of contam) {
    if (l.attributeCode === null || l.amount === null) continue;
    let baldes = porAtributo.get(l.attributeCode);
    if (!baldes) porAtributo.set(l.attributeCode, (baldes = new Map()));
    baldes.set(l.periodicity, (baldes.get(l.periodicity) ?? 0) + l.amount);
  }

  const impactoPorAtributo = new Map<string, AttributeRollup["impact"]>();
  for (const [attributeCode, baldes] of porAtributo) {
    const lista = [...baldes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodicity, amount]) => ({
        periodicity,
        amount: Number(amount.toFixed(6)),
      }));
    impactoPorAtributo.set(attributeCode, lista);
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
              attributeName: nomeDeLeitura(
                r.attributeCode,
                r.attributeName,
                r.attributeSourceName,
                r.attributeDisplayName,
              ),
              count: r.count,
              calculated: r.calculated,
              impact: impactoPorAtributo.get(r.attributeCode) ?? [],
            },
          ],
    ),
  };
}

/**
 * Os totais de uma comparação **dentro de um escopo de frota**.
 *
 * Os mesmos sete números que `change_set` guarda somados, e a mesma soma de
 * impacto por periodicidade — recontados sobre as linhas em vez de lidos das
 * colunas agregadas. A recontagem existe por uma razão só: aquelas colunas são
 * da comparação inteira, e uma tela que fala de cavalos não pode mostrar o
 * cartão da frota ao lado de uma lista de cavalos. Seria a mesma mentira que
 * `escopo.ts` descreve, escrita no lugar mais visível da tela.
 *
 * Com escopo vazio ela devolve exatamente o que `change_set` tem gravado —
 * `totais-escopo.test.ts` prova essa identidade contra o motor, e é ela que
 * garante que a recontagem não seja uma segunda verdade financeira.
 *
 * `inconclusive` conta pela `comparability` gravada em cada linha, que é a mesma
 * régua que o motor usa ao incrementar o contador; `impactNotCalculable` conta o
 * complemento exato de quem entrou na soma, para que as duas leituras do mesmo
 * conjunto nunca deixem uma alteração fora das duas.
 */
export interface TotaisDoEscopo {
  valueChanges: number;
  entitiesAdded: number;
  entitiesRemoved: number;
  attributesAdded: number;
  attributesRemoved: number;
  inconclusive: number;
  impactNotCalculable: number;
  /**
   * O impacto **oficial**, uma entrada por periodicidade. Nunca somadas entre
   * si, e já sem dupla contagem.
   */
  impactByPeriodicity: Record<string, number>;
  /** O bruto, antes de qualquer dedução. Auditoria técnica; nunca "Impacto apurado". */
  impactoBrutoByPeriodicity: Record<string, number>;
  /** A escada que explica a distância entre os dois. Explicação, não valor. */
  deducaoRastro: RastroDaDeducao;
  /** Quantas alterações ficaram fora da soma por dupla contagem. */
  mudancasForaDoTotal: number;
}

export const TOTAIS_VAZIOS: TotaisDoEscopo = {
  valueChanges: 0,
  entitiesAdded: 0,
  entitiesRemoved: 0,
  attributesAdded: 0,
  attributesRemoved: 0,
  inconclusive: 0,
  impactNotCalculable: 0,
  impactByPeriodicity: {},
  impactoBrutoByPeriodicity: {},
  deducaoRastro: { brutoByPeriodicity: {}, degraus: [], oficialByPeriodicity: {} },
  mudancasForaDoTotal: 0,
};

/**
 * Os totais do cabeçalho — na **mesma população** que a lista.
 *
 * `filtros` não é um refinamento opcional: é o que faz os cinco cartões e a
 * lista responderem pelo mesmo conjunto de linhas. Quem entra na tela por
 * "ver as alterações que somam este valor" chega com `impactConfidence=CALCULATED`,
 * e antes disso a lista obedecia e o cabeçalho não — 19 linhas embaixo de um
 * total de 267.
 */
export async function totaisDoEscopo(
  db: Database,
  changeSetId: string | string[],
  escopo: EscopoDeFrota = {},
  filtros: ChangeFilters = {},
): Promise<TotaisDoEscopo> {
  const ids = Array.isArray(changeSetId) ? changeSetId : [changeSetId];
  if (ids.length === 0) return { ...TOTAIS_VAZIOS };

  const recorte = [...escopoDeFrota(escopo), ...condicoesDoFiltro(filtros)];
  const scope = and(
    inArray(changeTable.changeSetId, ids),
    ALTERACAO_DE_ORIGEM_VISIVEL,
    ...recorte,
  )!;
  const conta = (condicao: SQL) =>
    sql<number>`count(*) FILTER (WHERE ${condicao})`.mapWith(Number);

  // O apurado é o que entrou na soma; o resto é o complemento, e não uma
  // segunda contagem que poderia divergir dela.
  const apurado = and(
    eq(changeTable.impactConfidence, "CALCULATED"),
    sql`${changeTable.impactAmount} IS NOT NULL`,
  )!;

  const [agregado] = await db
    .select({
      valueChanges: conta(eq(changeTable.category, "SOURCE_CHANGE")),
      entitiesAdded: conta(eq(changeTable.changeType, "ENTITY_ADDED")),
      entitiesRemoved: conta(eq(changeTable.changeType, "ENTITY_REMOVED")),
      attributesAdded: conta(eq(changeTable.changeType, "ATTRIBUTE_ADDED")),
      attributesRemoved: conta(eq(changeTable.changeType, "ATTRIBUTE_REMOVED")),
      inconclusive: conta(eq(changeTable.comparability, "INCONCLUSIVE")),
      impactNotCalculable: conta(sql`NOT (${apurado})`),
    })
    .from(changeTable)
    .where(scope);

  /*
    O dinheiro sai de `impactoApurado`, e não de um `sum()` aqui.

    Este bloco era um `sum(impact_amount) GROUP BY periodicidade` — correto
    como agregação e errado como resposta: somava o total e as parcelas dele,
    e o cavalo dentro da coluna da carreta. Era este número que a aba Planilha
    publicava como "Impacto apurado". Uma agregação SQL não tem como aplicar
    uma regra que é por ativo; a soma mudou de lugar em vez de ganhar um
    `WHERE` que não existiria.

    As contagens acima continuam em SQL: contar linhas não depende de regra de
    dupla contagem, e `impactNotCalculable` é o complemento de "tem preço".
  */
  const impacto = await impactoApurado(db, ids, recorte);

  return {
    ...agregado,
    impactByPeriodicity: impacto.byPeriodicity,
    impactoBrutoByPeriodicity: impacto.brutoByPeriodicity,
    deducaoRastro: impacto.rastro,
    mudancasForaDoTotal: impacto.excludedChanges,
  };
}

/**
 * O que mudou para cada ativo, ativo a ativo — o card de Cavalo 360°.
 *
 * A contagem e a maior alteração de cada placa, numa varredura de cada. O grão
 * é o que separa esta leitura de `listChanges`: lá cada linha é uma alteração e
 * a lista é do período; aqui cada linha é um **ativo**, e o que se lê é o
 * resumo dele.
 *
 * `maior` é a alteração que a régua de materialidade põe em primeiro para
 * aquele ativo — a mesma ordem de `listChanges`, e é de propósito: o card diz
 * "o FINAME caiu de X para Y" e o clique leva à lista onde aquela linha está no
 * topo. Duas réguas fariam o card apontar para uma lista que abre em outra
 * coisa.
 *
 * `DISTINCT ON` e não uma junção com `max()`: o critério de materialidade é uma
 * ordem de três colunas com desempates, e não um máximo de uma delas.
 */
export interface AlteracaoDoAtivo {
  attributeCode: string | null;
  attributeName: string | null;
  valueBefore: string | null;
  valueAfter: string | null;
  deltaAbsolute: number | null;
  deltaPercent: number | null;
  impactAmount: number | null;
  impactPeriodicity: string | null;
}

export interface SituacaoDoAtivo {
  /** Quantas alterações da comparação são deste ativo. */
  alteracoes: number;
  /** A mais material delas. Null quando o ativo não mudou. */
  maior: AlteracaoDoAtivo | null;
}

export async function situacaoPorAtivo(
  db: Database,
  changeSetId: string | string[],
  escopo: EscopoDeFrota = {},
): Promise<Map<string, SituacaoDoAtivo>> {
  const ids = Array.isArray(changeSetId) ? changeSetId : [changeSetId];
  const situacao = new Map<string, SituacaoDoAtivo>();
  if (ids.length === 0) return situacao;

  const scope = and(
    inArray(changeTable.changeSetId, ids),
    ALTERACAO_DE_ORIGEM_VISIVEL,
    sql`${changeTable.entityLabel} IS NOT NULL`,
    ...escopoDeFrota(escopo),
  )!;

  const contagens = await db
    .select({
      entityLabel: changeTable.entityLabel,
      alteracoes: sql<number>`count(*)`.mapWith(Number),
    })
    .from(changeTable)
    .where(scope)
    .groupBy(changeTable.entityLabel);

  for (const linha of contagens) {
    if (linha.entityLabel === null) continue;
    situacao.set(linha.entityLabel, { alteracoes: linha.alteracoes, maior: null });
  }

  const maiores = await db
    .selectDistinctOn([changeTable.entityLabel], {
      entityLabel: changeTable.entityLabel,
      attributeCode: changeTable.attributeCode,
      attributeName: changeTable.attributeName,
      attributeSourceName: attributeTable.sourceName,
      attributeDisplayName: attributeTable.displayName,
      valueBefore: changeTable.valueBefore,
      valueAfter: changeTable.valueAfter,
      deltaAbsolute: changeTable.deltaAbsolute,
      deltaPercent: changeTable.deltaPercent,
      impactAmount: changeTable.impactAmount,
      impactPeriodicity: changeTable.impactPeriodicity,
    })
    .from(changeTable)
    .leftJoin(attributeTable, ATRIBUTO_ATUAL)
    .where(scope)
    .orderBy(
      changeTable.entityLabel,
      sql`abs(${changeTable.impactAmount}) DESC NULLS LAST`,
      sql`abs(${changeTable.deltaAbsolute}) DESC NULLS LAST`,
      sql`abs(${changeTable.deltaPercent}) DESC NULLS LAST`,
      changeTable.attributeCode,
      changeTable.id,
    );

  for (const linha of maiores) {
    if (linha.entityLabel === null) continue;
    const atual = situacao.get(linha.entityLabel);
    if (!atual) continue;
    atual.maior = {
      attributeCode: linha.attributeCode,
      // O nome de leitura de hoje, pela mesma regra da lista: um apelido dado
      // na Curadoria depois da comparação precisa aparecer nos dois lugares.
      attributeName: nomeDeLeitura(
        linha.attributeCode,
        linha.attributeName,
        linha.attributeSourceName,
        linha.attributeDisplayName,
      ),
      valueBefore: linha.valueBefore,
      valueAfter: linha.valueAfter,
      deltaAbsolute:
        linha.deltaAbsolute === null ? null : Number(linha.deltaAbsolute),
      deltaPercent: linha.deltaPercent === null ? null : Number(linha.deltaPercent),
      impactAmount: linha.impactAmount === null ? null : Number(linha.impactAmount),
      impactPeriodicity: linha.impactPeriodicity,
    };
  }

  return situacao;
}

/** Every comparison on record, newest first. */
/**
 * As comparações gravadas, da vigência mais recente para a mais antiga.
 *
 * **De uma família por vez, e a de equipamento por padrão.** O contador ao lado
 * de "Alterações", no menu, lê daqui: ele pega a data mais recente da lista e
 * soma as comparações que terminam nela. Com as duas famílias juntas, a
 * quinzena do quadro de pessoal — que chega depois — virava "a vigência aberta",
 * e o menu anunciava as alterações de cargos ao lado de um Resumo executivo que
 * falava de placas. Dois números, duas realidades, a mesma tela.
 *
 * O filtro é sobre a ponta de cima (`sb`), que é a vigência que a comparação
 * explica e a data que o contador usa. A de baixo não precisa de cláusula: o
 * motor não compara famílias diferentes — `findPreviousSnapshot` já as separa
 * pela cobertura —, então as duas pontas são sempre da mesma.
 *
 * **Uma linha por vigência de destino.** Reprocessar a vigência de origem
 * não atualiza o `snapshot` existente — ele grava um `snapshot` novo
 * (`revision` +1, o antigo marcado `SUPERSEDED`; ver `snapshot_canonical_live_uq`
 * em `lib/db/src/schema/canonical.ts`). `computeChangeSet` é idempotente só
 * por par (`snapshot_a_id`, `snapshot_b_id`), então cada reprocessamento
 * nasce com um `snapshot_b_id` novo e um `change_set` novo — os antigos, que
 * apontam pra revisões já `SUPERSEDED`, continuam na tabela. `DISTINCT ON
 * (cs.snapshot_b_id)` não pega isso (cada linha tem um `snapshot_b_id`
 * genuinamente diferente); o filtro certo é `sb.status <> 'SUPERSEDED'` — só
 * a revisão viva de cada identidade canônica.
 */
export async function listChangeSets(
  db: Database,
  /** Qual família listar (`snapshot.dataset_family`). Padrão: equipamento. */
  opts?: { datasetFamily?: string; operacao?: Operacao | null },
) {
  const sa = sql`sa`;
  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT DISTINCT ON (sb.canonical_snapshot_key)
           cs.*,
           sa.source_label   AS snapshot_a_label,
           sa.effective_date AS snapshot_a_date,
           sb.source_label   AS snapshot_b_label,
           sb.effective_date AS snapshot_b_date,
           sb.scope_hash     AS snapshot_b_scope_hash
      FROM change_set cs
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
     WHERE sb.status <> 'SUPERSEDED'
       AND ${datasetFamilyFilter("sb", opts?.datasetFamily)}
       AND ${operacaoFilter("sb", opts?.operacao)}
       AND ${operacaoFilter("sa", opts?.operacao)}
     ORDER BY sb.canonical_snapshot_key, cs.id DESC
  `);
  return rows.sort(
    (x, y) =>
      new Date(y.snapshot_b_date as string).getTime() -
      new Date(x.snapshot_b_date as string).getTime(),
  );
}

/**
 * Live snapshots, oldest first — the pickers on Comparar read this.
 *
 * **De uma família por vez, e a de equipamento por padrão.** Duas vigências de
 * famílias diferentes não se comparam: `findPreviousSnapshot` já as separa pela
 * cobertura, então um par assim nunca produziria comparação — mas esta lista é
 * também de onde `/changes/latest` tira "a série mais recente", e uma quinzena
 * do quadro de pessoal entrando aqui muda qual série a tela de Alterações abre.
 * É o mesmo defeito que a família fechou no `contextFilter`, numa consulta que
 * não passa por ele.
 *
 * **E de uma operação por vez, quando quem pergunta é uma auditoria.** Os
 * seletores de "Comparar vigências" ofereciam o acervo inteiro: dentro da
 * Auditoria Rota dava para escolher uma vigência de empurrada de um lado e uma
 * de rota do outro. O motor recusaria o par (`engine.ts` não compara canais
 * diferentes), mas a recusa chegaria depois do clique, e a lista já teria
 * mostrado o que não é de lá.
 */
export async function listComparableSnapshots(
  db: Database,
  /** Qual família listar (`snapshot.dataset_family`). Padrão: equipamento. */
  opts?: { datasetFamily?: string; operacao?: Operacao | null },
) {
  return db
    .select({
      id: snapshotTable.id,
      sourceLabel: snapshotTable.sourceLabel,
      effectiveDate: snapshotTable.effectiveDate,
      entityTypeSet: snapshotTable.entityTypeSet,
      scopeHash: snapshotTable.scopeHash,
      revision: snapshotTable.revision,
      status: snapshotTable.status,
      entityCount: snapshotTable.entityCount,
      factCount: snapshotTable.factCount,
    })
    .from(snapshotTable)
    .where(
      sql`${snapshotTable.status} <> 'SUPERSEDED'
          AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = ${snapshotTable.importRunId} AND import_run.hidden_at IS NOT NULL)
          AND ${datasetFamilyFilter("snapshot", opts?.datasetFamily)}
          AND ${operacaoFilter("snapshot", opts?.operacao)}`,
    )
    .orderBy(snapshotTable.effectiveDate);
}

/**
 * The panel's numbers, and only the ones that are real.
 *
 * No forecast, no annualisation, no aggregate that mixes periodicities: the
 * page shows what the system currently knows, and says plainly how much of the
 * remuneration it still cannot price.
 */
export async function getOverview(db: Database, opts?: { operacao?: Operacao | null }) {
  /*
    O retrato da Home é o lugar onde o recorte por operação mais precisa ser
    literal, e onde ele é mais fácil de esquecer: são doze contagens que não
    passam por `contextFilter` nenhum, três delas sobre tabelas que não têm
    canal (`entity`, `fact`, `change`). O caminho até o canal existe em todas —
    o fato pertence a um snapshot, a entidade só aparece no acervo por um fato,
    a alteração pertence a uma comparação entre dois snapshots — e é ele que
    está escrito abaixo, sub-consulta por sub-consulta.

    `attribute` é a exceção declarada: atributo é vocabulário, global por
    código, e é o mesmo `carreta.custo_fixo` na empurrada e na rota. Contar
    atributos por operação seria inventar uma partição que o modelo não tem —
    e a fila de curadoria que esses números anunciam é uma só, para o produto
    inteiro.
  */
  const daOperacao = operacaoFilter("s", opts?.operacao);
  const alteracoesDaOperacao = sql`
    EXISTS (
      SELECT 1 FROM change_set cs
        JOIN snapshot s ON s.id = cs.snapshot_b_id
       WHERE cs.id = "alteracao_visivel".change_set_id AND ${daOperacao}
    )`;

  const { rows } = await db.execute<Record<string, unknown>>(sql`
    SELECT
      (SELECT count(*) FROM snapshot s
        WHERE s.status <> 'SUPERSEDED'
          AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
          AND ${daOperacao})
                                                                            AS vigencias,
      (SELECT min(s.effective_date) FROM snapshot s WHERE ${daOperacao})     AS primeira_vigencia,
      (SELECT max(s.effective_date) FROM snapshot s WHERE ${daOperacao})     AS ultima_vigencia,
      (SELECT count(DISTINCT f.entity_id) FROM fact f
         JOIN snapshot s ON s.id = f.snapshot_id WHERE ${daOperacao})        AS ativos,
      (SELECT count(*) FROM fact f
         JOIN snapshot s ON s.id = f.snapshot_id WHERE ${daOperacao})        AS fatos,
      (SELECT count(*) FROM attribute)                                      AS atributos,
      (SELECT count(*) FROM attribute WHERE semantics_status = 'CONFIRMED') AS atributos_confirmados,
      (SELECT count(*) FROM attribute
        WHERE is_monetary IS TRUE AND semantics_status <> 'CONFIRMED')      AS monetarios_pendentes,
      (SELECT count(*) FROM change_set cs JOIN snapshot s ON s.id = cs.snapshot_b_id
        WHERE ${daOperacao})                                                AS comparacoes,
      (SELECT count(*) FROM "alteracao_visivel"
        WHERE change_type = 'VALUE_CHANGED' AND ${alteracoesDaOperacao})    AS alteracoes,
      (SELECT count(*) FROM "alteracao_visivel"
        WHERE impact_confidence = 'CALCULATED' AND ${alteracoesDaOperacao}) AS com_impacto,
      (SELECT count(*) FROM "alteracao_visivel"
        WHERE comparability = 'INCONCLUSIVE' AND ${alteracoesDaOperacao})   AS inconclusivas
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
           cs.impacto_oficial_by_periodicity,
           /*
             O nome físico é o antigo (calculated_impact_by_periodicity), e a
             migration 0033 explica por que ele não foi renomeado. Quem se chama
             impacto_bruto é o campo do schema do drizzle; esta consulta é SQL
             cru e lia o nome do campo — quebrava com "column
             cs.impacto_bruto_by_periodicity does not exist" em qualquer base,
             503 na Home. O apelido põe os dois de acordo sem tocar na fila de
             migrations.
           */
           cs.calculated_impact_by_periodicity AS impacto_bruto_by_periodicity,
           cs.mudancas_fora_do_total
      FROM change_set cs
      JOIN snapshot sa ON sa.id = cs.snapshot_a_id
      JOIN snapshot sb ON sb.id = cs.snapshot_b_id
     WHERE sb.effective_date = (
       SELECT max(s.effective_date)
         FROM change_set c JOIN snapshot s ON s.id = c.snapshot_b_id
        WHERE ${operacaoFilter("s", opts?.operacao)}
     )
       AND ${operacaoFilter("sb", opts?.operacao)}
     ORDER BY sb.entity_type_set
  `);

  /*
    O acumulado de todas as comparações do registro, por periodicidade —
    **oficial**, e não a soma crua de `impact_amount`.

    Era um `sum()` sobre a tabela inteira, sem regra de dupla contagem nenhuma,
    e alimentava o Painel de Impacto. Agora a soma passa pela autoridade: cada
    comparação decide as suas próprias exclusões — as duas regras são internas a
    um par de vigências — e os oficiais se somam.

    Continuam apartados por periodicidade e nunca totalizados entre si.
  */
  /*
    O acumulado soma **as comparações desta operação**, e nada mais. Era um
    `SELECT id FROM change_set` sem cláusula: numa base com duas operações, o
    impacto acumulado da rota trazia dentro dele cada centavo da empurrada.
  */
  const { rows: setsDaOperacao } = await db.execute<{ id: string }>(sql`
    SELECT cs.id FROM change_set cs
      JOIN snapshot s ON s.id = cs.snapshot_b_id
     WHERE ${operacaoFilter("s", opts?.operacao)}
  `);
  const todosOsSets = setsDaOperacao;
  const decididas = await linhasApuradas(
    db,
    todosOsSets.map((s) => s.id),
  );
  const acumulado = new Map<string, { changes: number; total: number }>();
  for (const linha of decididas) {
    if (linha.amount === null || linha.foraDoTotal !== null) continue;
    const balde = acumulado.get(linha.periodicity) ?? { changes: 0, total: 0 };
    balde.changes++;
    balde.total += linha.amount;
    acumulado.set(linha.periodicity, balde);
  }
  const impactByPeriodicity = [...acumulado.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([periodicity, v]) => ({
      periodicity,
      changes: v.changes,
      total: Number(v.total.toFixed(6)),
    }));

  return {
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
    accumulatedImpactByPeriodicity: impactByPeriodicity,
    impactByPeriodicity,
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

/**
 * Quantas placas — e quantas alterações — de cada tipo de ativo cada
 * comparação carrega.
 *
 * A fila de Justificativas escolhe a vigência **dentro da aba** de Cavalo,
 * Carreta ou Trecho, e para isso o seletor precisa saber, antes de abrir
 * comparação nenhuma, quais delas têm trecho. A lista de `/change-sets` não
 * diz: um `change_set` é de uma série, e a série é `(escopo, entity_type_set)`
 * — a mesma data da mesma unidade aparece nela duas vezes, uma com o arquivo
 * de equipamento e outra com o de trecho, sem nada que distinga uma da outra.
 * Sem este recorte o seletor listava as duas linhas iguais e escolher era
 * chutar qual das duas tinha o que a aba mostra.
 *
 * O tipo sai da **linha alterada** (`change.entity_type`), e não do
 * `snapshot.entity_type_set`: a comparação exata com o conjunto falha sempre
 * que trecho chega junto de cavalo e carreta na mesma vigência, que é um
 * formato real de entrega — o mesmo motivo pelo qual `resolverComparacaoDeTrecho`
 * deixou de olhá-lo (ver `radar-trechos.ts`).
 *
 * As placas contam `DISTINCT entity_label` porque é a placa que o card de
 * Justificativas representa: a aba escrita `Trecho 6` abre com seis cards.
 * As alterações contam linhas, que é o que o seletor mostra à direita de cada
 * vigência. Linha sem placa (`LAYOUT_CHANGE`) não é assunto desta tela e fica
 * de fora das duas contagens — como já fica da lista.
 *
 * Mesma `ALTERACAO_DE_ORIGEM_VISIVEL` da listagem: uma importação ocultada não
 * pode continuar enchendo a aba com placas que a lista não mostra.
 */
export interface ContagemPorTipo {
  changeSetId: string;
  /** Cru, como a linha o gravou — quem normaliza é quem monta as abas. */
  entityType: string | null;
  placas: number;
  alteracoes: number;
}

export async function contagemPorTipo(
  db: Database,
  changeSetIds: string[],
): Promise<ContagemPorTipo[]> {
  if (changeSetIds.length === 0) return [];

  const rows = await db
    .select({
      changeSetId: changeTable.changeSetId,
      entityType: changeTable.entityType,
      placas: sql<number>`count(DISTINCT ${changeTable.entityLabel})`.mapWith(
        Number,
      ),
      alteracoes: sql<number>`count(*)`.mapWith(Number),
    })
    .from(changeTable)
    .where(
      and(
        inArray(changeTable.changeSetId, changeSetIds),
        sql`${changeTable.entityLabel} IS NOT NULL`,
        ALTERACAO_DE_ORIGEM_VISIVEL,
      )!,
    )
    .groupBy(changeTable.changeSetId, changeTable.entityType);

  return rows;
}
