import { and, asc, desc, eq, gte, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { type Database, ticketImportTable, ticketTable } from "@workspace/db";

/**
 * Chamados, do lado da leitura.
 *
 * Mora ao lado da comparação de vigências porque as duas respondem à mesma
 * tela — Alterações — e nenhuma das duas escreve nada. O que não acontece aqui
 * é fusão: um chamado nunca vira `change`, e o impacto apurado dos chamados
 * nunca é somado ao da planilha. São duas contas, com réguas diferentes, e a
 * tela mostra as duas lado a lado sem nunca as adicionar.
 */

export interface TicketRow {
  id: string;
  externalId: string;
  openedAt: string | null;
  closedAt: string | null;
  statusRaw: string | null;
  statusBucket: string;
  parameterLabel: string | null;
  attributeCode: string | null;
  entityLabel: string | null;
  entityType: string | null;
  requestedValueRaw: string | null;
  requestedValueNumeric: number | null;
  appliedValueRaw: string | null;
  appliedValueNumeric: number | null;
  impactAmount: number | null;
  impactConfidence: string;
  impactReason: string | null;
  requestedBy: string | null;
  subject: string | null;
  sourceRowIndex: number;
  /** Dias entre abertura e fechamento; com o chamado aberto, até hoje. */
  ageInDays: number | null;
  /** True enquanto não houver fechamento — o "há quanto tempo espera". */
  stillOpen: boolean;
}

export interface TicketFilters {
  statusBucket?: string;
  impactConfidence?: string;
  attributeCode?: string;
  /** Texto livre: número, parâmetro, placa, solicitante ou assunto. */
  search?: string;
  /** Só o que divergiu — aplicado diferente do pedido. */
  onlyDivergent?: boolean;
  minAbsImpact?: number;
  limit?: number;
  offset?: number;
}

export interface TicketImportSummary {
  id: string;
  filename: string;
  status: string;
  receivedAt: string;
  receivedBy: string | null;
  rowCount: number;
  ticketCount: number;
  ignoredRowCount: number;
  unmappedColumns: string[];
  columnMapping: Record<string, { header: string; match: string; reason: string }>;
  failureReason: string | null;
}

export interface TicketTotals {
  /** Chamados no envio lido, depois dos filtros da tela terem sido ignorados. */
  total: number;
  byStatus: { statusBucket: string; count: number }[];
  /** Quantos têm impacto apurado, e quanto eles somam. */
  calculated: number;
  notCalculable: number;
  impactSum: number;
  /** Atendidos em que o aplicado veio diferente do pedido. */
  divergent: number;
  /** Dias médios entre abertura e fechamento, só dos que fecharam. */
  averageDaysToClose: number | null;
  stillOpen: number;
}

/** O envio mais recente que foi lido até o fim. É dele que a tela fala. */
export async function latestTicketImport(
  db: Database,
): Promise<TicketImportSummary | null> {
  const [row] = await db
    .select()
    .from(ticketImportTable)
    .where(eq(ticketImportTable.status, "READ"))
    .orderBy(desc(ticketImportTable.receivedAt))
    .limit(1);
  return row ? toSummary(row) : null;
}

export async function getTicketImport(
  db: Database,
  id: string,
): Promise<TicketImportSummary | null> {
  const [row] = await db
    .select()
    .from(ticketImportTable)
    .where(eq(ticketImportTable.id, id));
  return row ? toSummary(row) : null;
}

/** Todos os envios, o mais novo primeiro — inclusive os que falharam. */
export async function listTicketImports(
  db: Database,
): Promise<TicketImportSummary[]> {
  const rows = await db
    .select()
    .from(ticketImportTable)
    .orderBy(desc(ticketImportTable.receivedAt));
  return rows.map(toSummary);
}

function toSummary(row: typeof ticketImportTable.$inferSelect): TicketImportSummary {
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    receivedAt: row.receivedAt.toISOString(),
    receivedBy: row.receivedBy,
    rowCount: row.rowCount,
    ticketCount: row.ticketCount,
    ignoredRowCount: row.ignoredRowCount,
    unmappedColumns: (row.unmappedColumns as string[]) ?? [],
    columnMapping:
      (row.columnMapping as TicketImportSummary["columnMapping"]) ?? {},
    failureReason: row.failureReason,
  };
}

/**
 * A diferença entre pedido e aplicado, em SQL.
 *
 * Existe como expressão e não como coluna porque "divergiu" é uma pergunta da
 * tela e não um fato do chamado: um dia se vai querer uma tolerância (centavos
 * de arredondamento não são divergência), e uma coluna gravada teria congelado
 * a régua do dia da importação em cima de dados já lidos.
 */
const DIVERGENT = sql`${ticketTable.impactConfidence} = 'CALCULATED' AND ${ticketTable.impactAmount} <> 0`;

function buildWhere(ticketImportId: string, filters: TicketFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(ticketTable.ticketImportId, ticketImportId)];

  if (filters.statusBucket) {
    parts.push(eq(ticketTable.statusBucket, filters.statusBucket));
  }
  if (filters.impactConfidence) {
    parts.push(eq(ticketTable.impactConfidence, filters.impactConfidence));
  }
  if (filters.attributeCode) {
    parts.push(eq(ticketTable.attributeCode, filters.attributeCode));
  }
  if (filters.onlyDivergent) {
    parts.push(DIVERGENT);
  }
  if (filters.minAbsImpact !== undefined && Number.isFinite(filters.minAbsImpact)) {
    parts.push(gte(sql`abs(${ticketTable.impactAmount})`, String(filters.minAbsImpact)));
  }
  if (filters.search) {
    const needle = `%${filters.search}%`;
    parts.push(
      or(
        ilike(ticketTable.externalId, needle),
        ilike(ticketTable.parameterLabel, needle),
        ilike(ticketTable.entityLabel, needle),
        ilike(ticketTable.requestedBy, needle),
        ilike(ticketTable.subject, needle),
        ilike(ticketTable.statusRaw, needle),
      ),
    );
  }

  return and(...parts.filter((p): p is SQL => p !== undefined));
}

const num = (value: string | null): number | null =>
  value === null ? null : Number(value);

const MS_PER_DAY = 86_400_000;

/**
 * Os chamados de um envio, ordenados por materialidade.
 *
 * A mesma ordem da aba Planilha, pelo mesmo motivo: primeiro o que tem impacto
 * apurado, depois pelo tamanho da divergência, e o resto por data de abertura.
 * Nada é omitido por ser pequeno — o filtro de materialidade mínima é uma
 * escolha de quem lê, e nunca um padrão nosso.
 */
export async function listTickets(
  db: Database,
  ticketImportId: string,
  filters: TicketFilters = {},
): Promise<{ total: number; rows: TicketRow[] }> {
  const where = buildWhere(ticketImportId, filters);

  const [count] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(ticketTable)
    .where(where);

  const rows = await db
    .select()
    .from(ticketTable)
    .where(where)
    // A ordenação é escrita em SQL cru, e não com `desc(...)`: envolver uma
    // expressão que já traz `nulls last` produz `... nulls last desc`, que o
    // Postgres recusa como erro de sintaxe. O `desc` tem de vir antes.
    .orderBy(
      sql`(${ticketTable.impactConfidence} = 'CALCULATED') desc`,
      sql`abs(coalesce(${ticketTable.impactAmount}, 0)) desc`,
      sql`${ticketTable.openedAt} desc nulls last`,
      asc(ticketTable.sourceRowIndex),
    )
    .limit(Math.min(filters.limit ?? 300, 1000))
    .offset(filters.offset ?? 0);

  const now = Date.now();
  return {
    total: count?.total ?? 0,
    rows: rows.map((r) => {
      const opened = r.openedAt?.getTime() ?? null;
      const closed = r.closedAt?.getTime() ?? null;
      return {
        id: r.id,
        externalId: r.externalId,
        openedAt: r.openedAt?.toISOString() ?? null,
        closedAt: r.closedAt?.toISOString() ?? null,
        statusRaw: r.statusRaw,
        statusBucket: r.statusBucket,
        parameterLabel: r.parameterLabel,
        attributeCode: r.attributeCode,
        entityLabel: r.entityLabel,
        entityType: r.entityType,
        requestedValueRaw: r.requestedValueRaw,
        requestedValueNumeric: num(r.requestedValueNumeric),
        appliedValueRaw: r.appliedValueRaw,
        appliedValueNumeric: num(r.appliedValueNumeric),
        impactAmount: num(r.impactAmount),
        impactConfidence: r.impactConfidence,
        impactReason: r.impactReason,
        requestedBy: r.requestedBy,
        subject: r.subject,
        sourceRowIndex: r.sourceRowIndex,
        ageInDays:
          opened === null ? null : Math.floor(((closed ?? now) - opened) / MS_PER_DAY),
        stillOpen: closed === null,
      };
    }),
  };
}

/**
 * Um chamado, com a linha do arquivo junto.
 *
 * `payload` só sai por aqui, e nunca pela listagem: é a linha inteira do
 * arquivo, e trezentas delas viajando em toda abertura de tela pagariam por
 * uma leitura que quase ninguém faz.
 */
export async function getTicket(
  db: Database,
  id: string,
): Promise<(TicketRow & { payload: Record<string, unknown> }) | null> {
  const [r] = await db.select().from(ticketTable).where(eq(ticketTable.id, id));
  if (!r) return null;

  const opened = r.openedAt?.getTime() ?? null;
  const closed = r.closedAt?.getTime() ?? null;
  return {
    id: r.id,
    externalId: r.externalId,
    openedAt: r.openedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    statusRaw: r.statusRaw,
    statusBucket: r.statusBucket,
    parameterLabel: r.parameterLabel,
    attributeCode: r.attributeCode,
    entityLabel: r.entityLabel,
    entityType: r.entityType,
    requestedValueRaw: r.requestedValueRaw,
    requestedValueNumeric: num(r.requestedValueNumeric),
    appliedValueRaw: r.appliedValueRaw,
    appliedValueNumeric: num(r.appliedValueNumeric),
    impactAmount: num(r.impactAmount),
    impactConfidence: r.impactConfidence,
    impactReason: r.impactReason,
    requestedBy: r.requestedBy,
    subject: r.subject,
    sourceRowIndex: r.sourceRowIndex,
    ageInDays:
      opened === null
        ? null
        : Math.floor(((closed ?? Date.now()) - opened) / MS_PER_DAY),
    stillOpen: closed === null,
    payload: (r.payload as Record<string, unknown>) ?? {},
  };
}

/**
 * Os totais do envio inteiro — sem filtro nenhum.
 *
 * De propósito: os cartões do topo dizem o tamanho do assunto, e um cartão que
 * encolhe quando se clica num chip deixa de responder "quantos chamados
 * existem" para responder "quantos sobraram", que é a pergunta que a contagem
 * da tabela já responde logo abaixo.
 */
export async function getTicketTotals(
  db: Database,
  ticketImportId: string,
): Promise<TicketTotals> {
  const scope = eq(ticketTable.ticketImportId, ticketImportId);

  const [agg] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      calculated: sql<number>`count(*) filter (where ${ticketTable.impactConfidence} = 'CALCULATED')`.mapWith(Number),
      notCalculable: sql<number>`count(*) filter (where ${ticketTable.impactConfidence} <> 'CALCULATED')`.mapWith(Number),
      impactSum: sql<string | null>`sum(${ticketTable.impactAmount}) filter (where ${ticketTable.impactConfidence} = 'CALCULATED')`,
      divergent: sql<number>`count(*) filter (where ${DIVERGENT})`.mapWith(Number),
      stillOpen: sql<number>`count(*) filter (where ${ticketTable.closedAt} is null)`.mapWith(Number),
      avgDays: sql<string | null>`avg(extract(epoch from (${ticketTable.closedAt} - ${ticketTable.openedAt})) / 86400) filter (where ${ticketTable.closedAt} is not null and ${ticketTable.openedAt} is not null)`,
    })
    .from(ticketTable)
    .where(scope);

  const byStatus = await db
    .select({
      statusBucket: ticketTable.statusBucket,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketTable)
    .where(scope)
    .groupBy(ticketTable.statusBucket)
    .orderBy(desc(sql`count(*)`));

  return {
    total: agg?.total ?? 0,
    byStatus,
    calculated: agg?.calculated ?? 0,
    notCalculable: agg?.notCalculable ?? 0,
    impactSum: agg?.impactSum === null || agg?.impactSum === undefined ? 0 : Number(agg.impactSum),
    divergent: agg?.divergent ?? 0,
    averageDaysToClose:
      agg?.avgDays === null || agg?.avgDays === undefined
        ? null
        : Math.round(Number(agg.avgDays) * 10) / 10,
    stillOpen: agg?.stillOpen ?? 0,
  };
}

/**
 * Os parâmetros mais citados pelos chamados deste envio.
 *
 * É o que liga as duas abas: um parâmetro que aparece em vinte chamados **e**
 * numa alteração de planilha é a mesma história contada dos dois lados. O
 * `attributeCode` vem junto quando o dicionário reconheceu o nome, e é ele que
 * permite pular de uma aba para a outra.
 */
export async function getTicketsByParameter(
  db: Database,
  ticketImportId: string,
  limit = 12,
): Promise<
  {
    parameterLabel: string | null;
    attributeCode: string | null;
    count: number;
    impactSum: number | null;
  }[]
> {
  const rows = await db
    .select({
      parameterLabel: ticketTable.parameterLabel,
      attributeCode: ticketTable.attributeCode,
      count: sql<number>`count(*)`.mapWith(Number),
      impactSum: sql<string | null>`sum(${ticketTable.impactAmount}) filter (where ${ticketTable.impactConfidence} = 'CALCULATED')`,
    })
    .from(ticketTable)
    .where(
      and(eq(ticketTable.ticketImportId, ticketImportId), isNotNull(ticketTable.parameterLabel)),
    )
    .groupBy(ticketTable.parameterLabel, ticketTable.attributeCode)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows.map((r) => ({
    parameterLabel: r.parameterLabel,
    attributeCode: r.attributeCode,
    count: r.count,
    impactSum: r.impactSum === null ? null : Number(r.impactSum),
  }));
}
