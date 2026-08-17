import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  type Database,
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { parseVigenciaLabel } from "@workspace/ingest";
import {
  CLASSES_DE_VALOR,
  NAO_CLASSIFICADO,
  classificarParametro,
  type ClasseNaTela,
} from "@workspace/knowledge";

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
  /**
   * O assunto do chamado, exato.
   *
   * É o corte da visão por tipo: lá a árvore desce até *classe → parâmetro →
   * assunto*, e clicar numa folha precisa trazer exatamente aquelas linhas. Por
   * isso é igualdade e não `ilike` — "Ajuste complemento PM" e "Ajuste
   * complemento PM 2" são dois motivos, e a folha de um não pode arrastar o
   * outro junto.
   */
  subject?: string;
  /**
   * Só os chamados sem assunto declarado.
   *
   * Existe separado de `subject` porque string vazia já quer dizer "sem filtro"
   * em toda esta interface, e o grupo dos sem assunto é uma folha real da
   * árvore — no export que motivou esta tela ele tem oito chamados. Sem este
   * campo, essa folha seria a única que não abriria.
   */
  subjectMissing?: boolean;
  /** Texto livre: número, parâmetro, placa, solicitante ou assunto. */
  search?: string;
  /** Só o que de fato variou — agora diferente de antes. */
  onlyDivergent?: boolean;
  minAbsImpact?: number;
  /** A coluna pela qual o cabeçalho da tabela pediu para ordenar. */
  sort?: string;
  /** asc | desc. Só faz sentido acompanhado de `sort`. */
  dir?: string;
  /**
   * O recorte De/Até, já resolvido nos rótulos que ele cobre.
   *
   * `undefined` (ou `null`) é o envio inteiro. Uma **lista vazia** é um recorte
   * legítimo que nenhuma vigência atende, e não se confunde com o anterior: ela
   * não devolve nada, em vez de devolver tudo. Confundir os dois faria a tela
   * mostrar 1.218 alterações sob um título que promete três vigências.
   *
   * Vem em rótulos e não em datas porque é o rótulo que o chamado declara —
   * `EMPURRADA_2_12_2025`, a mesma string de `snapshot.source_label`. Quem
   * traduz a data escolhida na tela para esta lista é {@link rotulosNaJanela},
   * uma vez só, sobre o eixo que o próprio envio sustenta.
   */
  vigenciaLabels?: string[] | null;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// O eixo de vigências dos chamados
// ---------------------------------------------------------------------------

/**
 * As vigências que os chamados de um envio nomeiam, em ordem.
 *
 * **Sai do próprio envio, e não do contexto de vigências.** Chamado não tem
 * unidade nem canal em lugar nenhum deste produto — é uma população à parte, e
 * derivar as opções de um contexto escolhido por padrão faria a aba recortar
 * por uma unidade que ninguém pediu. O que o chamado tem é a coluna
 * `Vig. Abertura`, que é a vigência contra a qual ele foi aberto e casa
 * exatamente com `snapshot.source_label` — a mesma igualdade que a importação
 * já usa para achar o valor anterior de um parâmetro.
 *
 * A data vem do rótulo, pelo mesmo parser da importação. Rótulo que não tem
 * forma de vigência não vira data nenhuma e não entra no eixo: ele é contado em
 * {@link EixoDeVigencias.semVigencia}, para que a tela possa dizer quantas
 * alterações **nenhum** recorte alcança em vez de deixá-las sumir em silêncio.
 */
export interface EixoDeVigencias {
  /** As datas das vigências nomeadas, da mais antiga à mais recente. */
  disponiveis: string[];
  /**
   * `2025-12-02` → os rótulos daquele dia, em ordem.
   *
   * É uma lista e não uma string porque o eixo é de **datas** e a fonte escreve
   * **rótulos**: `EMPURRADA_2_12_2025` e `EMPURRADA_02_12_2025` são o mesmo dia
   * escrito de dois jeitos, e o recorte tem de alcançar os dois. Guardar um só
   * deixaria de fora, em silêncio, os chamados que usaram a outra grafia. Quem
   * precisa de uma legenda usa o primeiro; quem precisa filtrar usa todos.
   */
  rotulos: Record<string, string[]>;
  /**
   * Alterações cujo chamado não nomeia vigência legível.
   *
   * Ficam fora de qualquer recorte por construção — não há onde as pôr — e o
   * número existe para que isso seja dito, e não descoberto por subtração.
   */
  semVigencia: number;
}

export async function getTicketVigencias(
  db: Database,
  ticketImportId: string,
): Promise<EixoDeVigencias> {
  const rows = await db
    .select({
      vigenciaLabel: ticketTable.vigenciaLabel,
      changes: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketChangeTable)
    .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
    .where(eq(ticketChangeTable.ticketImportId, ticketImportId))
    .groupBy(ticketTable.vigenciaLabel);

  const rotulos: Record<string, string[]> = {};
  let semVigencia = 0;
  for (const row of rows) {
    const rotulo = row.vigenciaLabel;
    const data = rotulo === null ? null : parseVigenciaLabel(rotulo).effectiveDate;
    if (data === null || rotulo === null) {
      semVigencia += row.changes;
      continue;
    }
    (rotulos[data] ??= []).push(rotulo);
  }
  for (const lista of Object.values(rotulos)) lista.sort();

  return { disponiveis: Object.keys(rotulos).sort(), rotulos, semVigencia };
}

/**
 * O recorte, traduzido para os rótulos que ele cobre.
 *
 * `null` quando não há recorte — e é o valor que faz as consultas responderem
 * pelo envio inteiro. Meia janela é completada com o extremo do eixo, pela
 * mesma razão que em `aplicarJanela`: "de março para cá" é um pedido legítimo.
 *
 * Uma ponta que não é vigência deste envio **não** é aparada para a mais
 * próxima: ela recorta o que houver entre as duas datas, e se não houver nada a
 * lista sai vazia. É a diferença entre responder pouco e responder por outro
 * período com o título do pedido.
 */
export function rotulosNaJanela(
  eixo: EixoDeVigencias,
  janela: { de?: string; ate?: string } | null | undefined,
): string[] | null {
  if (!janela || (janela.de === undefined && janela.ate === undefined)) return null;

  const de = janela.de ?? eixo.disponiveis[0] ?? "";
  const ate = janela.ate ?? eixo.disponiveis[eixo.disponiveis.length - 1] ?? "";

  return eixo.disponiveis
    .filter((d) => d >= de && d <= ate)
    .flatMap((d) => eixo.rotulos[d] ?? []);
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
  /** Alterações por situação do chamado que as trouxe — a régua do filtro. */
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

/**
 * O recorte por vigência, como predicado sobre o chamado.
 *
 * Exige que `ticket` esteja no `FROM` de quem o usa — é sempre o caso, porque
 * a vigência é do chamado e não da alteração.
 *
 * Uma lista vazia vira `false` em vez de sumir. Apagar um recorte que não
 * alcança nada faria a consulta responder pelo envio inteiro debaixo do título
 * do recorte, que é a forma mais silenciosa de mentir que esta tela tem.
 */
function noRecorteDeVigencia(labels: string[] | null | undefined): SQL | undefined {
  if (labels === null || labels === undefined) return undefined;
  if (labels.length === 0) return sql`false`;
  return inArray(ticketTable.vigenciaLabel, labels);
}

function buildWhere(ticketImportId: string, filters: TicketFilters): SQL | undefined {
  const parts: (SQL | undefined)[] = [
    eq(ticketChangeTable.ticketImportId, ticketImportId),
    noRecorteDeVigencia(filters.vigenciaLabels),
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
  if (filters.subjectMissing) {
    parts.push(isNull(ticketTable.subject));
  } else if (filters.subject) {
    parts.push(eq(ticketTable.subject, filters.subject));
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
 * Os totais do envio — sem filtro de linha, mas **dentro do recorte**.
 *
 * A ausência de filtro é de propósito: os cartões do topo dizem o tamanho do
 * assunto, e um cartão que encolhe ao se clicar num chip deixa de responder
 * "quantas alterações existem" para responder "quantas sobraram", que é a
 * pergunta que a contagem da tabela já responde logo abaixo.
 *
 * O recorte de vigências é a exceção, e não uma inconsistência: ele não é um
 * filtro de linha, é **de que período a tela está falando** — a mesma natureza
 * da unidade nas outras abas. Um cartão dizendo 1.218 ao lado de um seletor
 * dizendo "3 de 9 vigências" não seria um total abrangente, seria um total de
 * outro assunto.
 */
export async function getTicketTotals(
  db: Database,
  ticketImportId: string,
  /** Os rótulos do recorte; `null` (ou ausente) é o envio inteiro. */
  vigenciaLabels?: string[] | null,
): Promise<TicketTotals> {
  const recorte = noRecorteDeVigencia(vigenciaLabels);
  /*
    O `innerJoin` com `ticket` entra sempre, e não só quando há recorte: toda
    alteração tem um chamado (a coluna é NOT NULL com chave estrangeira), então
    ele não muda contagem nenhuma — e uma consulta que mudasse de forma conforme
    o recorte seria duas consultas se fingindo de uma.
  */
  const escopoChanges = and(
    eq(ticketChangeTable.ticketImportId, ticketImportId),
    recorte,
  );
  const escopoTickets = and(
    eq(ticketTable.ticketImportId, ticketImportId),
    recorte,
  );

  const [agg] = await db
    .select({
      changes: sql<number>`count(*)`.mapWith(Number),
      calculated: sql<number>`count(*) filter (where ${ticketChangeTable.impactConfidence} = 'CALCULATED')`.mapWith(Number),
      notCalculable: sql<number>`count(*) filter (where ${ticketChangeTable.impactConfidence} <> 'CALCULATED')`.mapWith(Number),
      impactSum: sql<string | null>`sum(${ticketChangeTable.impactAmount}) filter (where ${ticketChangeTable.impactConfidence} = 'CALCULATED')`,
      divergent: sql<number>`count(*) filter (where ${DIVERGENT})`.mapWith(Number),
    })
    .from(ticketChangeTable)
    .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
    .where(escopoChanges);

  const [chamados] = await db
    .select({
      tickets: sql<number>`count(*)`.mapWith(Number),
      stillOpen: sql<number>`count(*) filter (where ${ticketTable.closedAt} is null)`.mapWith(Number),
      avgDays: sql<string | null>`avg(extract(epoch from (${ticketTable.closedAt} - ${ticketTable.openedAt})) / 86400) filter (where ${ticketTable.closedAt} is not null and ${ticketTable.openedAt} is not null)`,
    })
    .from(ticketTable)
    .where(escopoTickets);

  /*
    Alterações por situação, e não chamados por situação.

    Estes números são os que a tela põe ao lado dos chips de Situação, e um
    número ao lado de um filtro é lido como "é isto que sobra se eu clicar".
    O filtro `statusBucket` recorta alterações — um chamado atendido que mexeu
    em oito parâmetros tira oito linhas da lista, não uma —, então contar
    chamados aqui prometia um resultado e entregava outro, ao lado de dois
    grupos de chips que já contavam alterações. `tickets` e `stillOpen`
    continuam contando chamados: aqueles são cartões, e falam de chamados.
  */
  const byStatus = await db
    .select({
      statusBucket: ticketTable.statusBucket,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketChangeTable)
    .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
    .where(escopoChanges)
    .groupBy(ticketTable.statusBucket)
    .orderBy(desc(sql`count(*)`));

  const byBeforeSource = await db
    .select({
      beforeSource: ticketChangeTable.beforeSource,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketChangeTable)
    .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
    .where(escopoChanges)
    .groupBy(ticketChangeTable.beforeSource)
    .orderBy(desc(sql`count(*)`));

  const byChangeKind = await db
    .select({
      changeKind: ticketChangeTable.changeKind,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketChangeTable)
    .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
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

// ---------------------------------------------------------------------------
// Alterações por tipo de valor
// ---------------------------------------------------------------------------

/**
 * A visão por tipo: o que os chamados mexeram no fixo, no variável e no diesel.
 *
 * É a pergunta que a aba Resumo não responde. Lá a lista está ordenada por
 * materialidade e diz *quais* alterações existem; aqui a mesma população é
 * dobrada em três — os componentes da remuneração — e cada um abre em
 * parâmetro e depois em assunto do chamado. Quem confere o mês quer saber
 * primeiro se o mês mexeu no fixo ou no variável, e só depois em quê.
 *
 * **A conta não fecha por soma, e isso é o achado, não o defeito.** Um
 * parâmetro pode mexer em dois valores — `cavaloEmpurrada` mexe no fixo e no
 * variável —, então somar as classes conta essas alterações duas vezes.
 * `overlap` é exatamente quantas são, e existe para a tela poder escrever a
 * diferença em vez de deixar quem lê descobri-la subtraindo números na cabeça.
 */

/** Um assunto de chamado dentro de um parâmetro — a folha da árvore. */
export interface TicketSubjectRollup {
  /** O assunto como o chamado o escreveu. `null` é chamado sem assunto. */
  subject: string | null;
  /**
   * Alterações de parâmetro. É o grão da tela inteira.
   *
   * Também é o número de chamados distintos desta folha, e não por acaso:
   * `ticket_change` é único por (chamado, parâmetro), então um chamado aparece
   * no máximo uma vez em cada parâmetro. A igualdade se perde uma linha acima,
   * na classe, onde o mesmo chamado pode ter mexido em dois parâmetros.
   */
  changes: number;
  calculated: number;
  impactSum: number | null;
}

/** Um parâmetro dentro de uma classe, com os assuntos que o pediram. */
export interface TicketParameterInClass {
  parameterLabel: string;
  attributeCode: string | null;
  changes: number;
  calculated: number;
  impactSum: number | null;
  /** Por que este parâmetro caiu nesta classe. Vem da tabela de classificação. */
  porque: string | null;
  /** Em que outras classes ele também entra — vazio quando entra só nesta. */
  tambemEm: ClasseNaTela[];
  subjects: TicketSubjectRollup[];
}

/** Uma das quatro caixas: fixo, variável, variável diesel, não classificado. */
export interface TicketClassRollup {
  classe: ClasseNaTela;
  nome: string;
  descricao: string;
  changes: number;
  calculated: number;
  impactSum: number | null;
  parameters: TicketParameterInClass[];
}

export interface TicketClassificationView {
  classes: TicketClassRollup[];
  /** Alterações do envio, sem dupla contagem. Bate com `TicketTotals.changes`. */
  changes: number;
  /** Quantas foram contadas em mais de uma classe. */
  overlap: number;
  /** Quantas não têm classe — a fila de trabalho da tabela de classificação. */
  unclassified: number;
}

/** O grão bruto que o banco devolve, antes de qualquer classificação. */
export interface TicketGroupedRow {
  parameterLabel: string;
  attributeCode: string | null;
  subject: string | null;
  changes: number;
  calculated: number;
  impactSum: number | null;
}

/**
 * Dobrar o grão bruto nas quatro caixas.
 *
 * Separado da consulta de propósito: a regra de classificação é a única parte
 * disto que pode estar errada de um jeito que ninguém percebe, e uma função
 * pura pode ser testada com dez linhas inventadas em vez de um banco inteiro.
 *
 * Uma classe vazia continua na lista. "Nenhum chamado mexeu no diesel neste
 * mês" é resposta, e uma caixa que some quando dá zero deixa quem lê sem saber
 * se a pergunta foi feita.
 */
export function classificarAlteracoes(
  rows: TicketGroupedRow[],
): TicketClassificationView {
  const caixas = new Map<ClasseNaTela, Map<string, TicketParameterInClass>>(
    CLASSES_DE_VALOR.map((c) => [c.codigo, new Map()]),
  );

  let changes = 0;
  let overlap = 0;
  let unclassified = 0;

  for (const row of rows) {
    changes += row.changes;

    const conhecido = classificarParametro(row.parameterLabel);
    const classes: ClasseNaTela[] =
      conhecido && conhecido.classes.length > 0
        ? conhecido.classes
        : [NAO_CLASSIFICADO];

    if (classes[0] === NAO_CLASSIFICADO) unclassified += row.changes;
    // Contadas uma vez a menos do que aparecem: o excedente é o que faz a soma
    // das classes passar do total.
    overlap += row.changes * (classes.length - 1);

    for (const classe of classes) {
      const porClasse = caixas.get(classe);
      if (!porClasse) continue;

      const atual = porClasse.get(row.parameterLabel) ?? {
        parameterLabel: row.parameterLabel,
        attributeCode: row.attributeCode,
        changes: 0,
        calculated: 0,
        impactSum: null,
        porque: conhecido?.porque ?? null,
        tambemEm: classes.filter((outra) => outra !== classe),
        subjects: [],
      };

      atual.changes += row.changes;
      atual.calculated += row.calculated;
      if (row.impactSum !== null) {
        atual.impactSum = (atual.impactSum ?? 0) + row.impactSum;
      }
      atual.subjects.push({
        subject: row.subject,
        changes: row.changes,
        calculated: row.calculated,
        impactSum: row.impactSum,
      });

      porClasse.set(row.parameterLabel, atual);
    }
  }

  const classes = CLASSES_DE_VALOR.map((descricao) => {
    const parameters = [...(caixas.get(descricao.codigo)?.values() ?? [])]
      .map((p) => ({ ...p, subjects: [...p.subjects].sort(porTamanho) }))
      .sort(porTamanho);

    return {
      classe: descricao.codigo,
      nome: descricao.nome,
      descricao: descricao.descricao,
      changes: parameters.reduce((soma, p) => soma + p.changes, 0),
      calculated: parameters.reduce((soma, p) => soma + p.calculated, 0),
      impactSum: somarApurados(parameters),
      parameters,
    };
  });

  return { classes, changes, overlap, unclassified };
}

/** Do maior para o menor, e o alfabeto desempata — para a ordem não dançar. */
function porTamanho(
  a: { changes: number; parameterLabel?: string; subject?: string | null },
  b: { changes: number; parameterLabel?: string; subject?: string | null },
): number {
  if (a.changes !== b.changes) return b.changes - a.changes;
  const nomeA = a.parameterLabel ?? a.subject ?? "";
  const nomeB = b.parameterLabel ?? b.subject ?? "";
  return nomeA.localeCompare(nomeB, "pt-BR");
}

/**
 * `null` quando nada foi apurado, e não zero.
 *
 * Zero é uma afirmação — "mexeram e não mudou nada" — e é falsa quando a
 * verdade é "ninguém conseguiu apurar". A tela mostra as duas coisas com
 * palavras diferentes, e depende desta distinção chegar até ela.
 */
function somarApurados(itens: { impactSum: number | null }[]): number | null {
  const apurados = itens.filter((i) => i.impactSum !== null);
  if (apurados.length === 0) return null;
  return apurados.reduce((soma, i) => soma + (i.impactSum ?? 0), 0);
}

/**
 * As alterações do envio agrupadas por parâmetro e assunto, e classificadas.
 *
 * O agrupamento é do banco; a classificação é de `@workspace/knowledge` e roda
 * aqui, em TypeScript. É de propósito: a tabela que diz o que é fixo e o que é
 * variável é conhecimento do modelo de remuneração, revisável em código, e
 * empurrá-la para dentro de um `CASE` em SQL a tornaria invisível justamente
 * para quem precisa conferi-la.
 */
export async function getTicketClassification(
  db: Database,
  ticketImportId: string,
  /** Os rótulos do recorte; `null` (ou ausente) é o envio inteiro. */
  vigenciaLabels?: string[] | null,
): Promise<TicketClassificationView> {
  const rows = await db
    .select({
      parameterLabel: ticketChangeTable.parameterLabel,
      attributeCode: ticketChangeTable.attributeCode,
      subject: ticketTable.subject,
      changes: sql<number>`count(*)`.mapWith(Number),
      calculated: sql<number>`count(*) filter (where ${ticketChangeTable.impactConfidence} = 'CALCULATED')`.mapWith(Number),
      impactSum: sql<string | null>`sum(${ticketChangeTable.impactAmount}) filter (where ${ticketChangeTable.impactConfidence} = 'CALCULATED')`,
    })
    .from(ticketChangeTable)
    .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
    .where(
      and(
        eq(ticketChangeTable.ticketImportId, ticketImportId),
        noRecorteDeVigencia(vigenciaLabels),
      ),
    )
    .groupBy(
      ticketChangeTable.parameterLabel,
      ticketChangeTable.attributeCode,
      ticketTable.subject,
    );

  return classificarAlteracoes(
    rows.map((r) => ({
      parameterLabel: r.parameterLabel,
      attributeCode: r.attributeCode,
      subject: r.subject,
      changes: r.changes,
      calculated: r.calculated,
      impactSum: r.impactSum === null ? null : Number(r.impactSum),
    })),
  );
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
  /** Os rótulos do recorte; `null` (ou ausente) é o envio inteiro. */
  vigenciaLabels?: string[] | null,
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
    .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
    .where(
      and(
        eq(ticketChangeTable.ticketImportId, ticketImportId),
        isNotNull(ticketChangeTable.parameterLabel),
        noRecorteDeVigencia(vigenciaLabels),
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
