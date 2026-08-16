import { and, asc, desc, eq, gte, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import {
  type Database,
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";

/**
 * Chamados, do lado da leitura.
 *
 * Mora ao lado da comparação de vigências porque as duas respondem à mesma
 * tela — Alterações — e nenhuma das duas escreve nada. O grão também é o
 * mesmo: **um parâmetro que mudou**. O que muda é a régua com que se mede.
 *
 * O que não acontece aqui é fusão: um chamado nunca vira `change`, e o impacto
 * apurado dos chamados nunca é somado ao da planilha. São duas contas, e a
 * tela mostra as duas lado a lado sem nunca as adicionar.
 */

/** Uma alteração de parâmetro trazida por um chamado. */
export interface TicketChangeRow {
  id: string;
  ticketId: string;
  /** O número do chamado que trouxe esta alteração. */
  externalId: string;
  openedAt: string | null;
  closedAt: string | null;
  statusRaw: string | null;
  statusBucket: string;
  requestedBy: string | null;
  subject: string | null;
  /** A vigência que o chamado nomeia (`Vig. Abertura`). */
  vigenciaLabel: string | null;
  /** O ativo como o arquivo o descreve, inteiro. */
  entityDescription: string | null;

  parameterLabel: string;
  /** SET | ADD | FORM_THIS | … — o que o chamado fez com o parâmetro. */
  changeKind: string | null;
  attributeCode: string | null;
  entityLabel: string | null;
  entityType: string | null;

  valueBeforeRaw: string | null;
  valueBeforeNumeric: number | null;
  valueAfterRaw: string | null;
  valueAfterNumeric: number | null;
  /** ARQUIVO | VIGENCIA | AUSENTE — a força de prova do valor anterior. */
  beforeSource: string;
  beforeReference: string | null;

  deltaAbsolute: number | null;
  deltaPercent: number | null;
  impactAmount: number | null;
  impactConfidence: string;
  impactReason: string | null;

  /** Dias entre abertura e fechamento; com o chamado aberto, até hoje. */
  ageInDays: number | null;
  stillOpen: boolean;
}

export interface TicketFilters {
  statusBucket?: string;
  impactConfidence?: string;
  attributeCode?: string;
  parameterLabel?: string;
  beforeSource?: string;
  changeKind?: string;
  /** Texto livre: número, parâmetro, placa, solicitante ou assunto. */
  search?: string;
  /** Só o que de fato variou — agora diferente de antes. */
  onlyDivergent?: boolean;
  minAbsImpact?: number;
  /** A coluna pela qual o cabeçalho da tabela pediu para ordenar. */
  sort?: string;
  /** asc | desc. Só faz sentido acompanhado de `sort`. */
  dir?: string;
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
  /** As colunas lidas como parâmetro de remuneração, nomeadas. */
  parameterColumns: string[];
  columnMapping: Record<string, { header: string; match: string; reason: string }>;
  failureReason: string | null;
}

export interface TicketTotals {
  /** Alterações de parâmetro no envio — o número que a lista conta. */
  changes: number;
  /** Chamados no envio. Um chamado costuma trazer várias alterações. */
  tickets: number;
  byStatus: { statusBucket: string; count: number }[];
  /** De onde veio o valor anterior de cada alteração. */
  byBeforeSource: { beforeSource: string; count: number }[];
  /** O que o chamado fez: SET, ADD, FORM_THIS. Explica a maior parte da tela. */
  byChangeKind: { changeKind: string | null; count: number }[];
  calculated: number;
  notCalculable: number;
  impactSum: number;
  /** Alterações em que o valor de fato mudou. */
  divergent: number;
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
    parameterColumns: (row.parameterColumns as string[]) ?? [],
    columnMapping:
      (row.columnMapping as TicketImportSummary["columnMapping"]) ?? {},
    failureReason: row.failureReason,
  };
}

/**
 * "Variou" em SQL.
 *
 * Existe como expressão e não como coluna porque é uma pergunta da tela e não
 * um fato da alteração: um dia se vai querer uma tolerância — centavos de
 * arredondamento não são divergência —, e uma coluna gravada teria congelado a
 * régua do dia da importação em cima de dados já lidos.
 */
const DIVERGENT = sql`${ticketChangeTable.deltaAbsolute} IS NOT NULL AND ${ticketChangeTable.deltaAbsolute} <> 0`;

function buildWhere(ticketImportId: string, filters: TicketFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [
    eq(ticketChangeTable.ticketImportId, ticketImportId),
  ];

  if (filters.statusBucket) {
    parts.push(eq(ticketTable.statusBucket, filters.statusBucket));
  }
  if (filters.impactConfidence) {
    parts.push(eq(ticketChangeTable.impactConfidence, filters.impactConfidence));
  }
  if (filters.attributeCode) {
    parts.push(eq(ticketChangeTable.attributeCode, filters.attributeCode));
  }
  if (filters.parameterLabel) {
    parts.push(eq(ticketChangeTable.parameterLabel, filters.parameterLabel));
  }
  if (filters.beforeSource) {
    parts.push(eq(ticketChangeTable.beforeSource, filters.beforeSource));
  }
  if (filters.changeKind) {
    parts.push(eq(ticketChangeTable.changeKind, filters.changeKind));
  }
  if (filters.onlyDivergent) {
    parts.push(DIVERGENT);
  }
  if (filters.minAbsImpact !== undefined && Number.isFinite(filters.minAbsImpact)) {
    parts.push(
      gte(sql`abs(${ticketChangeTable.deltaAbsolute})`, String(filters.minAbsImpact)),
    );
  }
  if (filters.search) {
    const needle = `%${filters.search}%`;
    parts.push(
      or(
        ilike(ticketTable.externalId, needle),
        ilike(ticketChangeTable.parameterLabel, needle),
        ilike(ticketChangeTable.attributeCode, needle),
        ilike(ticketChangeTable.entityLabel, needle),
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

const idade = (openedAt: Date | null, closedAt: Date | null) => {
  const opened = openedAt?.getTime() ?? null;
  if (opened === null) return null;
  return Math.floor(((closedAt?.getTime() ?? Date.now()) - opened) / MS_PER_DAY);
};

/**
 * A ordem do ciclo de vida, para a coluna Situação não ordenar por alfabeto.
 *
 * "Aberto, em andamento, atendido, recusado, cancelado" é a sequência que o
 * chamado percorre; em ordem alfabética ela vira "aberto, atendido, cancelado,
 * em andamento, recusado", que não é ordem nenhuma.
 */
const ORDEM_SITUACAO = [
  "ABERTO",
  "EM_ANDAMENTO",
  "ATENDIDO",
  "RECUSADO",
  "CANCELADO",
  "DESCONHECIDO",
];

/**
 * A ordem das operações é a do assunto, e não a do alfabeto nem a da contagem.
 *
 * É a mesma dos filtros rápidos da tela: `fórmula` vem primeiro por ser o que
 * o export tem em massa, e `valor` logo atrás por ser onde estão os números.
 */
const ORDEM_OPERACAO = ["FORM_THIS", "SET", "ADD", "REMOVE"];

/**
 * `CASE ... END` com a posição de cada valor numa ordem declarada aqui.
 *
 * As posições entram como literais e não como parâmetros: `CASE col WHEN $1
 * THEN $2 END` deixa o Postgres sem tipo para o resultado do `CASE`, e ele
 * recusa a consulta inteira. Os índices são gerados pelo próprio laço, então
 * não há texto de fora nesse caminho — o valor comparado, esse sim, continua
 * sendo parâmetro.
 */
function posicaoNaOrdem(coluna: SQL, valores: string[]): SQL {
  const casos = valores.map(
    (valor, indice) => sql`WHEN ${valor} THEN ${sql.raw(String(indice))}`,
  );
  return sql`CASE ${coluna} ${sql.join(casos, sql` `)} ELSE ${sql.raw(String(valores.length))} END`;
}

/**
 * A régua que o cabeçalho da tabela pediu, em SQL.
 *
 * Ordenar é do servidor porque a lista é paginada. Ordenar no navegador o que
 * chegou reordenaria cinquenta linhas de mil e duzentas, e "Impacto ↓" passaria
 * a significar "o maior desta página" — parecido o bastante com a verdade para
 * ninguém desconfiar.
 *
 * Nulo nunca é o menor valor: cai no fim nos dois sentidos, em vez de fingir um
 * zero que ninguém apurou. Um chamado sem impacto apurado não é um chamado de
 * impacto zero.
 */
function ordenacaoPedida(sort: string, dir: string): SQL[] | null {
  const sentido = dir === "desc" ? sql`desc` : sql`asc`;
  const fim = sql`nulls last`;

  switch (sort) {
    case "chamado":
      // O parâmetro é a segunda régua dentro da primeira: o mesmo chamado
      // aparece com os seus parâmetros juntos, e não espalhado pela lista.
      return [
        sql`${ticketTable.externalId} ${sentido} ${fim}`,
        sql`${ticketChangeTable.parameterLabel} ${sentido} ${fim}`,
      ];
    case "tipo":
      return [
        // A linha sem operação declarada fica no fim dos dois sentidos: o
        // `CASE` sozinho a mandaria para o topo quando o sentido inverte.
        sql`(${ticketChangeTable.changeKind} IS NULL) asc`,
        sql`${posicaoNaOrdem(sql`${ticketChangeTable.changeKind}`, ORDEM_OPERACAO)} ${sentido}`,
        sql`${ticketChangeTable.parameterLabel} asc ${fim}`,
      ];
    case "impacto":
      // "Não calculável" fica fora da régua, e não no zero dela.
      return [
        sql`(CASE WHEN ${ticketChangeTable.impactConfidence} = 'CALCULATED'
              THEN ${ticketChangeTable.impactAmount} END) ${sentido} ${fim}`,
      ];
    case "situacao":
      return [
        sql`${posicaoNaOrdem(sql`${ticketTable.statusBucket}`, ORDEM_SITUACAO)} ${sentido}`,
      ];
    case "data":
      // A data da alteração é a do fechamento; enquanto o chamado corre, a de
      // abertura é o que existe — a mesma escolha que a coluna faz na tela.
      return [
        sql`coalesce(${ticketTable.closedAt}, ${ticketTable.openedAt}) ${sentido} ${fim}`,
      ];
    default:
      return null;
  }
}

/** A ordem de casa: materialidade, como a aba Planilha. */
const POR_MATERIALIDADE: SQL[] = [
  // SQL cru: envolver uma expressão que já traz `nulls last` produziria
  // `... nulls last desc`, que o Postgres recusa. O `desc` vem antes.
  sql`(${ticketChangeTable.impactConfidence} = 'CALCULATED') desc`,
  sql`abs(coalesce(${ticketChangeTable.deltaAbsolute}, 0)) desc`,
  sql`${ticketTable.openedAt} desc nulls last`,
];

/**
 * As alterações de um envio, ordenadas por materialidade — ou pela régua que o
 * cabeçalho da tabela pediu.
 *
 * A ordem de casa é a mesma da aba Planilha, pelo mesmo motivo: primeiro o que
 * tem impacto apurado, depois pelo tamanho da variação. Nada é omitido por ser
 * pequeno — o filtro de materialidade mínima é uma escolha de quem lê, e nunca
 * um padrão nosso.
 *
 * Qualquer que seja a régua, a lista termina desempatada pela posição da linha
 * no arquivo. Não é enfeite: sem um critério que separe duas linhas iguais, o
 * Postgres pode devolver a mesma linha na página 2 e na 3 e nunca devolver
 * outra — e uma auditoria com uma linha faltando é pior do que uma sem
 * paginação nenhuma.
 */
export async function listTicketChanges(
  db: Database,
  ticketImportId: string,
  filters: TicketFilters = {},
): Promise<{ total: number; rows: TicketChangeRow[] }> {
  const where = buildWhere(ticketImportId, filters);

  const [count] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(ticketChangeTable)
    .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
    .where(where);

  const pedida = filters.sort
    ? ordenacaoPedida(filters.sort, filters.dir ?? "asc")
    : null;

  const rows = await db
    .select({ c: ticketChangeTable, t: ticketTable })
    .from(ticketChangeTable)
    .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
    .where(where)
    .orderBy(
      ...(pedida ?? POR_MATERIALIDADE),
      asc(ticketTable.sourceRowIndex),
      asc(ticketChangeTable.sourceColumnIndex),
    )
    .limit(Math.min(filters.limit ?? 300, 1000))
    .offset(filters.offset ?? 0);

  return {
    total: count?.total ?? 0,
    rows: rows.map(({ c, t }) => ({
      id: c.id,
      ticketId: c.ticketId,
      externalId: t.externalId,
      openedAt: t.openedAt?.toISOString() ?? null,
      closedAt: t.closedAt?.toISOString() ?? null,
      statusRaw: t.statusRaw,
      statusBucket: t.statusBucket,
      requestedBy: t.requestedBy,
      subject: t.subject,
      vigenciaLabel: t.vigenciaLabel,
      entityDescription: t.entityDescription,

      parameterLabel: c.parameterLabel,
      changeKind: c.changeKind,
      attributeCode: c.attributeCode,
      entityLabel: c.entityLabel,
      entityType: c.entityType,

      valueBeforeRaw: c.valueBeforeRaw,
      valueBeforeNumeric: num(c.valueBeforeNumeric),
      valueAfterRaw: c.valueAfterRaw,
      valueAfterNumeric: num(c.valueAfterNumeric),
      beforeSource: c.beforeSource,
      beforeReference: c.beforeReference,

      deltaAbsolute: num(c.deltaAbsolute),
      deltaPercent: num(c.deltaPercent),
      impactAmount: num(c.impactAmount),
      impactConfidence: c.impactConfidence,
      impactReason: c.impactReason,

      ageInDays: idade(t.openedAt, t.closedAt),
      stillOpen: t.closedAt === null,
    })),
  };
}

/** Um chamado inteiro: o cabeçalho, tudo o que ele mexeu, e a linha de origem. */
export async function getTicket(
  db: Database,
  id: string,
): Promise<
  | {
      id: string;
      externalId: string;
      openedAt: string | null;
      closedAt: string | null;
      statusRaw: string | null;
      statusBucket: string;
      entityLabel: string | null;
      entityType: string | null;
      entityDescription: string | null;
      vigenciaLabel: string | null;
      requestedBy: string | null;
      subject: string | null;
      changedParameterCount: number;
      sourceRowIndex: number;
      ageInDays: number | null;
      stillOpen: boolean;
      payload: Record<string, unknown>;
      changes: {
        parameterLabel: string;
        changeKind: string | null;
        attributeCode: string | null;
        valueBeforeRaw: string | null;
        valueAfterRaw: string | null;
        beforeSource: string;
        beforeReference: string | null;
        deltaAbsolute: number | null;
        impactAmount: number | null;
        impactConfidence: string;
        impactReason: string | null;
      }[];
    }
  | null
> {
  const [t] = await db.select().from(ticketTable).where(eq(ticketTable.id, id));
  if (!t) return null;

  const changes = await db
    .select()
    .from(ticketChangeTable)
    .where(eq(ticketChangeTable.ticketId, id))
    .orderBy(asc(ticketChangeTable.sourceColumnIndex));

  return {
    id: t.id,
    externalId: t.externalId,
    openedAt: t.openedAt?.toISOString() ?? null,
    closedAt: t.closedAt?.toISOString() ?? null,
    statusRaw: t.statusRaw,
    statusBucket: t.statusBucket,
    entityLabel: t.entityLabel,
    entityType: t.entityType,
    entityDescription: t.entityDescription,
    vigenciaLabel: t.vigenciaLabel,
    requestedBy: t.requestedBy,
    subject: t.subject,
    changedParameterCount: t.changedParameterCount,
    sourceRowIndex: t.sourceRowIndex,
    ageInDays: idade(t.openedAt, t.closedAt),
    stillOpen: t.closedAt === null,
    payload: (t.payload as Record<string, unknown>) ?? {},
    changes: changes.map((c) => ({
      parameterLabel: c.parameterLabel,
      changeKind: c.changeKind,
      attributeCode: c.attributeCode,
      valueBeforeRaw: c.valueBeforeRaw,
      valueAfterRaw: c.valueAfterRaw,
      beforeSource: c.beforeSource,
      beforeReference: c.beforeReference,
      deltaAbsolute: num(c.deltaAbsolute),
      impactAmount: num(c.impactAmount),
      impactConfidence: c.impactConfidence,
      impactReason: c.impactReason,
    })),
  };
}

/**
 * Os totais do envio inteiro — sem filtro nenhum.
 *
 * De propósito: os cartões do topo dizem o tamanho do assunto, e um cartão que
 * encolhe ao se clicar num chip deixa de responder "quantas alterações
 * existem" para responder "quantas sobraram", que é a pergunta que a contagem
 * da tabela já responde logo abaixo.
 */
export async function getTicketTotals(
  db: Database,
  ticketImportId: string,
): Promise<TicketTotals> {
  const escopoChanges = eq(ticketChangeTable.ticketImportId, ticketImportId);
  const escopoTickets = eq(ticketTable.ticketImportId, ticketImportId);

  const [agg] = await db
    .select({
      changes: sql<number>`count(*)`.mapWith(Number),
      calculated: sql<number>`count(*) filter (where ${ticketChangeTable.impactConfidence} = 'CALCULATED')`.mapWith(Number),
      notCalculable: sql<number>`count(*) filter (where ${ticketChangeTable.impactConfidence} <> 'CALCULATED')`.mapWith(Number),
      impactSum: sql<string | null>`sum(${ticketChangeTable.impactAmount}) filter (where ${ticketChangeTable.impactConfidence} = 'CALCULATED')`,
      divergent: sql<number>`count(*) filter (where ${DIVERGENT})`.mapWith(Number),
    })
    .from(ticketChangeTable)
    .where(escopoChanges);

  const [chamados] = await db
    .select({
      tickets: sql<number>`count(*)`.mapWith(Number),
      stillOpen: sql<number>`count(*) filter (where ${ticketTable.closedAt} is null)`.mapWith(Number),
      avgDays: sql<string | null>`avg(extract(epoch from (${ticketTable.closedAt} - ${ticketTable.openedAt})) / 86400) filter (where ${ticketTable.closedAt} is not null and ${ticketTable.openedAt} is not null)`,
    })
    .from(ticketTable)
    .where(escopoTickets);

  const byStatus = await db
    .select({
      statusBucket: ticketTable.statusBucket,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketTable)
    .where(escopoTickets)
    .groupBy(ticketTable.statusBucket)
    .orderBy(desc(sql`count(*)`));

  const byBeforeSource = await db
    .select({
      beforeSource: ticketChangeTable.beforeSource,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketChangeTable)
    .where(escopoChanges)
    .groupBy(ticketChangeTable.beforeSource)
    .orderBy(desc(sql`count(*)`));

  const byChangeKind = await db
    .select({
      changeKind: ticketChangeTable.changeKind,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketChangeTable)
    .where(escopoChanges)
    .groupBy(ticketChangeTable.changeKind)
    .orderBy(desc(sql`count(*)`));

  return {
    changes: agg?.changes ?? 0,
    tickets: chamados?.tickets ?? 0,
    byStatus,
    byBeforeSource,
    byChangeKind,
    calculated: agg?.calculated ?? 0,
    notCalculable: agg?.notCalculable ?? 0,
    impactSum:
      agg?.impactSum === null || agg?.impactSum === undefined
        ? 0
        : Number(agg.impactSum),
    divergent: agg?.divergent ?? 0,
    averageDaysToClose:
      chamados?.avgDays === null || chamados?.avgDays === undefined
        ? null
        : Math.round(Number(chamados.avgDays) * 10) / 10,
    stillOpen: chamados?.stillOpen ?? 0,
  };
}

/**
 * Os parâmetros que os chamados mais mexeram.
 *
 * É o que liga as duas abas: um parâmetro que aparece em vinte chamados **e**
 * numa alteração de planilha é a mesma história contada dos dois lados. O
 * `attributeCode` vem junto quando o dicionário reconheceu o nome, e é ele que
 * permite pular de uma aba para a outra.
 */
export async function getTicketsByParameter(
  db: Database,
  ticketImportId: string,
  limit = 15,
): Promise<
  {
    parameterLabel: string;
    attributeCode: string | null;
    count: number;
    impactSum: number | null;
  }[]
> {
  const rows = await db
    .select({
      parameterLabel: ticketChangeTable.parameterLabel,
      attributeCode: ticketChangeTable.attributeCode,
      count: sql<number>`count(*)`.mapWith(Number),
      impactSum: sql<string | null>`sum(${ticketChangeTable.impactAmount}) filter (where ${ticketChangeTable.impactConfidence} = 'CALCULATED')`,
    })
    .from(ticketChangeTable)
    .where(
      and(
        eq(ticketChangeTable.ticketImportId, ticketImportId),
        isNotNull(ticketChangeTable.parameterLabel),
      ),
    )
    .groupBy(ticketChangeTable.parameterLabel, ticketChangeTable.attributeCode)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows.map((r) => ({
    parameterLabel: r.parameterLabel,
    attributeCode: r.attributeCode,
    count: r.count,
    impactSum: r.impactSum === null ? null : Number(r.impactSum),
  }));
}
