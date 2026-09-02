import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import {
  type Database,
  ticketChangeTable,
  ticketImportComparacaoTable,
  ticketImportTable,
  ticketMovementDayTable,
  ticketMovementFieldTable,
  ticketMovementReviewTable,
  ticketMovementStepTable,
  ticketTable,
} from "@workspace/db";
import { FUSO_DA_OPERACAO, diaSeguinte } from "./monitoramento-de-chamados";

/**
 * MONITORAMENTO DE CHAMADOS — o que a tela lê.
 *
 * O motor (`monitoramento-de-chamados.ts`) já escreveu tudo o que há para
 * saber. Aqui não se compara nada e não se recalcula nada: cada função abaixo é
 * uma consulta sobre linhas prontas, e é isso que faz a tela abrir em três
 * requisições em vez de comparar snapshots no navegador.
 *
 * ---------------------------------------------------------------------------
 * Duas disciplinas de contagem, e as duas têm cicatriz
 * ---------------------------------------------------------------------------
 *
 * **Revisada é por existência, nunca por contagem de linhas.** `EXISTS`, e não
 * `JOIN`: uma junção com a tabela de revisões multiplicaria a movimentação por
 * revisão gravada, e todo `count(*)` deste arquivo passaria a mentir para cima.
 * É o mesmo cuidado que `painel-de-justificativas.ts` documenta ter tomado do
 * outro lado, e pela mesma razão — lá o painel passava de 100%.
 *
 * **Movimentação e campo alterado são dois grãos.** `ticket_movement_day` conta
 * chamados; `ticket_movement_field` conta campos. Um chamado com três campos
 * alterados é 1 e 3. Os dois números aparecem na tela com rótulos diferentes e
 * **nunca são somados** — é a mesma armadilha que `chamados-totais.test.ts`
 * fixa para a aba Chamados.
 */

// ---------------------------------------------------------------------------
// Os predicados que todo o arquivo compartilha
// ---------------------------------------------------------------------------

/**
 * O recorte de série.
 *
 * `undefined` é "todas as séries" — o padrão de quem abre a tela numa
 * instalação de uma unidade só. `null` é a série **indeterminada**, que é uma
 * série de verdade e não a ausência de recorte. Confundir as duas faria o
 * seletor "sem unidade" mostrar o produto inteiro.
 */
function noEscopoDaSerie(serie: string | null | undefined): SQL | undefined {
  if (serie === undefined) return undefined;
  return serie === null
    ? isNull(ticketMovementDayTable.serie)
    : eq(ticketMovementDayTable.serie, serie);
}

/**
 * Já revisada — a revisão mais recente aponta para a versão atual da linha.
 *
 * Subconsulta correlacionada em vez de junção, pela razão do cabeçalho. O
 * índice `ticket_movement_review_versao_uq` a sustenta.
 */
const JA_REVISADA: SQL = sql`EXISTS (
  SELECT 1 FROM ticket_movement_review r
   WHERE r.movement_id = ${ticketMovementDayTable.id}
     AND r.revisao = ${ticketMovementDayTable.revisao}
)`;

const PENDENTE: SQL = sql`NOT ${JA_REVISADA}`;

// ---------------------------------------------------------------------------
// As séries
// ---------------------------------------------------------------------------

export interface SerieDisponivel {
  serie: string | null;
  origem: string | null;
  envios: number;
  ultimaImportacao: string | null;
}

/**
 * As séries que existem, com o que a tela precisa para montar o seletor.
 *
 * Numa instalação de uma unidade só isto devolve uma linha, e a tela não mostra
 * seletor nenhum — o recorte existe, mas não custa uma decisão a quem opera.
 */
export async function seriesDisponiveis(db: Database): Promise<SerieDisponivel[]> {
  const linhas = await db
    .select({
      serie: ticketImportTable.serie,
      origem: sql<string | null>`max(${ticketImportTable.serieOrigem})`,
      envios: sql<number>`count(*)`.mapWith(Number),
      ultima: sql<Date | null>`max(${ticketImportTable.receivedAt})`,
    })
    .from(ticketImportTable)
    .where(eq(ticketImportTable.status, "READ"))
    .groupBy(ticketImportTable.serie)
    .orderBy(asc(ticketImportTable.serie));

  return linhas.map((l) => ({
    serie: l.serie,
    origem: l.origem,
    envios: l.envios,
    ultimaImportacao: l.ultima ? new Date(l.ultima).toISOString() : null,
  }));
}

// ---------------------------------------------------------------------------
// A régua de dias
// ---------------------------------------------------------------------------

/**
 * O estado de um dia — o que decide a cor na régua.
 *
 * SEM_IMPORTACAO  cinza    ninguém mandou arquivo.
 * PRIMEIRA_CARGA  azul     só houve baseline: o estado inicial foi registrado.
 * SEM_MOVIMENTACAO azul    chegou arquivo e nada mudou.
 * PENDENTE        vermelho há movimentação por revisar.
 * REVISADO        verde    havia movimentação e ela está toda revisada.
 *
 * Os dois azuis são estados diferentes com a mesma cor de propósito: os dois
 * dizem "não há trabalho aqui", e a frase da tela é que os separa.
 */
export type EstadoDoDia =
  | "SEM_IMPORTACAO"
  | "PRIMEIRA_CARGA"
  | "SEM_MOVIMENTACAO"
  | "PENDENTE"
  | "REVISADO";

export interface DiaDaRegua {
  dia: string;
  estado: EstadoDoDia;
  envios: number;
  enviosComFalha: number;
  movimentacoes: number;
  revisadas: number;
  pendentes: number;
  ultimaImportacao: string | null;
}

/** O dia da operação, como o banco o calcula. A mesma régua do motor. */
const DIA_DO_ENVIO = sql<string>`(${ticketImportTable.receivedAt} AT TIME ZONE ${sql.raw(`'${FUSO_DA_OPERACAO}'`)})::date`;

/**
 * A régua: um dia por posição, com o que cada um tem.
 *
 * Lê `ticket_import` — e não só as comparações — de propósito: um envio que
 * falhou não produz comparação nenhuma, e a régua precisa poder dizer que
 * naquele dia **chegou** arquivo, mesmo que nada dele tenha entrado. Sem isso, o
 * dia de uma importação quebrada apareceria como "nenhuma importação
 * realizada", que é a informação errada para quem vai procurar o que aconteceu.
 */
export async function reguaDeDias(
  db: Database,
  { de, ate, serie }: { de: string; ate: string; serie?: string | null },
): Promise<DiaDaRegua[]> {
  const dentroDaJanela = and(
    gte(ticketImportTable.receivedAt, new Date(`${de}T00:00:00.000Z`)),
    // O fim é exclusivo e com folga de um dia: a conversão para o fuso da
    // operação joga até 3h do dia seguinte em UTC para dentro do dia local.
    lte(ticketImportTable.receivedAt, new Date(`${diaSeguinte(ate, 2)}T00:00:00.000Z`)),
  );

  const envios = await db
    .select({
      dia: DIA_DO_ENVIO,
      envios: sql<number>`count(*) filter (where ${ticketImportTable.status} = 'READ')`.mapWith(Number),
      falhas: sql<number>`count(*) filter (where ${ticketImportTable.status} not in ('READ','SKIPPED_DUPLICATE'))`.mapWith(Number),
      ultima: sql<Date | null>`max(${ticketImportTable.receivedAt}) filter (where ${ticketImportTable.status} = 'READ')`,
    })
    .from(ticketImportTable)
    .where(
      serie === undefined
        ? dentroDaJanela
        : and(
            dentroDaJanela,
            serie === null
              ? isNull(ticketImportTable.serie)
              : eq(ticketImportTable.serie, serie),
          ),
    )
    .groupBy(DIA_DO_ENVIO);

  const movimentos = await db
    .select({
      dia: ticketMovementDayTable.dia,
      total: sql<number>`count(*)`.mapWith(Number),
      revisadas: sql<number>`count(*) filter (where ${JA_REVISADA})`.mapWith(Number),
    })
    .from(ticketMovementDayTable)
    .where(
      and(
        gte(ticketMovementDayTable.dia, de),
        lte(ticketMovementDayTable.dia, ate),
        noEscopoDaSerie(serie),
      ),
    )
    .groupBy(ticketMovementDayTable.dia);

  const baselines = await db
    .select({ dia: ticketImportComparacaoTable.dia })
    .from(ticketImportComparacaoTable)
    .where(
      and(
        gte(ticketImportComparacaoTable.dia, de),
        lte(ticketImportComparacaoTable.dia, ate),
        eq(ticketImportComparacaoTable.tipo, "BASELINE"),
        serie === undefined
          ? undefined
          : serie === null
            ? isNull(ticketImportComparacaoTable.serie)
            : eq(ticketImportComparacaoTable.serie, serie),
      ),
    );

  const porDiaEnvios = new Map(envios.map((e) => [String(e.dia), e]));
  const porDiaMov = new Map(movimentos.map((m) => [String(m.dia), m]));
  const comBaseline = new Set(baselines.map((b) => String(b.dia)));

  const dias: DiaDaRegua[] = [];
  for (let dia = de; dia <= ate; dia = diaSeguinte(dia)) {
    const e = porDiaEnvios.get(dia);
    const m = porDiaMov.get(dia);
    const movimentacoes = m?.total ?? 0;
    const revisadas = m?.revisadas ?? 0;
    const pendentes = movimentacoes - revisadas;

    let estado: EstadoDoDia;
    if (!e || (e.envios === 0 && e.falhas === 0)) estado = "SEM_IMPORTACAO";
    else if (movimentacoes === 0) {
      estado = comBaseline.has(dia) ? "PRIMEIRA_CARGA" : "SEM_MOVIMENTACAO";
    } else estado = pendentes > 0 ? "PENDENTE" : "REVISADO";

    dias.push({
      dia,
      estado,
      envios: e?.envios ?? 0,
      enviosComFalha: e?.falhas ?? 0,
      movimentacoes,
      revisadas,
      pendentes,
      ultimaImportacao: e?.ultima ? new Date(e.ultima).toISOString() : null,
    });
  }
  return dias;
}

// ---------------------------------------------------------------------------
// O resumo do dia
// ---------------------------------------------------------------------------

export interface ResumoDoDia {
  dia: string;
  serie: string | null | undefined;
  estado: EstadoDoDia;
  ultimaImportacao: string | null;
  /** O total, e as quatro classes que somam exatamente ele. */
  movimentacoes: number;
  novos: number;
  alterados: number;
  encerrados: number;
  removidos: number;
  revisadas: number;
  pendentes: number;
  /** Grão diferente do de cima: campos, não chamados. Nunca somar os dois. */
  alteracoesDeCampo: { tipo: string; total: number }[];
  pontosDeAtencao: {
    criticos: number;
    atrasados: number;
    prazosAlterados: number;
    trocasDeResponsavel: number;
  };
  porUnidade: { unidade: string | null; total: number }[];
  avisos: AvisoDoDia[];
}

/** O que a tela precisa dizer antes de mostrar número nenhum. */
export interface AvisoDoDia {
  tipo: "BASELINE" | "IMPORTACAO_COM_FALHA" | "REMOVIDOS_SUPRIMIDOS";
  texto: string;
}

export async function resumoDoDia(
  db: Database,
  { dia, serie }: { dia: string; serie?: string | null },
): Promise<ResumoDoDia> {
  const escopo = and(eq(ticketMovementDayTable.dia, dia), noEscopoDaSerie(serie));

  const [totais] = await db
    .select({
      movimentacoes: sql<number>`count(*)`.mapWith(Number),
      novos: sql<number>`count(*) filter (where ${ticketMovementDayTable.classe} = 'NOVO')`.mapWith(Number),
      alterados: sql<number>`count(*) filter (where ${ticketMovementDayTable.classe} = 'ALTERADO')`.mapWith(Number),
      encerrados: sql<number>`count(*) filter (where ${ticketMovementDayTable.classe} = 'ENCERRADO')`.mapWith(Number),
      removidos: sql<number>`count(*) filter (where ${ticketMovementDayTable.classe} = 'REMOVIDO')`.mapWith(Number),
      revisadas: sql<number>`count(*) filter (where ${JA_REVISADA})`.mapWith(Number),
      criticos: sql<number>`count(*) filter (where ${ticketMovementDayTable.criticidade} = 'CRITICO')`.mapWith(Number),
      atrasados: sql<number>`count(*) filter (where ${ticketMovementDayTable.atrasado})`.mapWith(Number),
    })
    .from(ticketMovementDayTable)
    .where(escopo);

  const porTipo = await db
    .select({
      tipo: ticketMovementFieldTable.tipo,
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketMovementFieldTable)
    .innerJoin(
      ticketMovementDayTable,
      eq(ticketMovementDayTable.id, ticketMovementFieldTable.movementId),
    )
    .where(escopo)
    .groupBy(ticketMovementFieldTable.tipo)
    .orderBy(desc(sql`count(*)`));

  const porUnidade = await db
    .select({
      unidade: ticketMovementDayTable.unidade,
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketMovementDayTable)
    .where(escopo)
    .groupBy(ticketMovementDayTable.unidade)
    .orderBy(desc(sql`count(*)`))
    .limit(8);

  const comparacoes = await db
    .select()
    .from(ticketImportComparacaoTable)
    .where(
      and(
        eq(ticketImportComparacaoTable.dia, dia),
        serie === undefined
          ? undefined
          : serie === null
            ? isNull(ticketImportComparacaoTable.serie)
            : eq(ticketImportComparacaoTable.serie, serie),
      ),
    );

  const envios = await db
    .select({
      status: ticketImportTable.status,
      filename: ticketImportTable.filename,
      receivedAt: ticketImportTable.receivedAt,
      failureReason: ticketImportTable.failureReason,
    })
    .from(ticketImportTable)
    .where(
      and(
        sql`${DIA_DO_ENVIO} = ${dia}`,
        serie === undefined
          ? undefined
          : serie === null
            ? isNull(ticketImportTable.serie)
            : eq(ticketImportTable.serie, serie),
      ),
    )
    .orderBy(asc(ticketImportTable.receivedAt));

  const lidos = envios.filter((e) => e.status === "READ");
  const ultimaImportacao = lidos[lidos.length - 1]?.receivedAt ?? null;

  const avisos: AvisoDoDia[] = [];
  for (const c of comparacoes) {
    if (c.tipo === "BASELINE" && c.motivo) {
      avisos.push({ tipo: "BASELINE", texto: c.motivo });
    }
    if (c.removidosSuprimidos > 0 && c.motivo) {
      avisos.push({ tipo: "REMOVIDOS_SUPRIMIDOS", texto: c.motivo });
    }
  }
  for (const e of envios) {
    if (e.status === "READ" || e.status === "SKIPPED_DUPLICATE") continue;
    const hora = new Date(e.receivedAt).toLocaleTimeString("pt-BR", {
      timeZone: FUSO_DA_OPERACAO,
      hour: "2-digit",
      minute: "2-digit",
    });
    avisos.push({
      tipo: "IMPORTACAO_COM_FALHA",
      texto:
        `A importação de ${e.filename} (${hora}) está em ${e.status}` +
        `${e.failureReason ? `: ${e.failureReason}` : "."} ` +
        `Os números abaixo não a incluem.`,
    });
  }

  const movimentacoes = totais?.movimentacoes ?? 0;
  const revisadas = totais?.revisadas ?? 0;
  const temBaseline = comparacoes.some((c) => c.tipo === "BASELINE");

  let estado: EstadoDoDia;
  if (envios.length === 0) estado = "SEM_IMPORTACAO";
  else if (movimentacoes === 0) {
    estado = temBaseline ? "PRIMEIRA_CARGA" : "SEM_MOVIMENTACAO";
  } else estado = movimentacoes - revisadas > 0 ? "PENDENTE" : "REVISADO";

  const totalDoTipo = (tipo: string) =>
    porTipo.find((t) => t.tipo === tipo)?.total ?? 0;

  return {
    dia,
    serie,
    estado,
    ultimaImportacao: ultimaImportacao ? new Date(ultimaImportacao).toISOString() : null,
    movimentacoes,
    novos: totais?.novos ?? 0,
    alterados: totais?.alterados ?? 0,
    encerrados: totais?.encerrados ?? 0,
    removidos: totais?.removidos ?? 0,
    revisadas,
    pendentes: movimentacoes - revisadas,
    alteracoesDeCampo: porTipo,
    pontosDeAtencao: {
      criticos: totais?.criticos ?? 0,
      atrasados: totais?.atrasados ?? 0,
      prazosAlterados: totalDoTipo("PRAZO"),
      trocasDeResponsavel: totalDoTipo("RESPONSAVEL"),
    },
    porUnidade,
    avisos,
  };
}

// ---------------------------------------------------------------------------
// A lista
// ---------------------------------------------------------------------------

/**
 * As abas da tela.
 *
 * `CRITICOS` recorta por uma criticidade **derivada por nós**, e a tela diz
 * isso ao lado do chip — ver `criticidadeDoChamado`. As outras cinco recortam
 * por fatos da fonte.
 */
export const ABAS = [
  "TODOS",
  "NAO_REVISADOS",
  "CRITICOS",
  "NOVOS",
  "ALTERADOS",
  "ENCERRADOS",
  "REMOVIDOS",
] as const;
export type AbaDoMonitoramento = (typeof ABAS)[number];

export interface FiltrosDaLista {
  aba?: AbaDoMonitoramento;
  unidade?: string;
  area?: string;
  responsavel?: string;
  statusBucket?: string;
  tipoDeAlteracao?: string;
  busca?: string;
  limit?: number;
  offset?: number;
}

export interface DiferencaNaLista {
  tipo: string;
  campo: string;
  antes: string | null;
  depois: string | null;
}

export interface MovimentacaoNaLista {
  id: string;
  dia: string;
  serie: string | null;
  externalId: string;
  classe: string;
  revisao: number;
  passos: number;
  unidade: string | null;
  area: string | null;
  responsavel: string | null;
  solicitante: string | null;
  statusRaw: string | null;
  statusBucket: string | null;
  assunto: string | null;
  entidade: string | null;
  prazoPrevisto: string | null;
  abertoEm: string | null;
  encerradoEm: string | null;
  alteradoEmFonte: string | null;
  criticidade: string;
  criticidadeMotivo: string | null;
  criticidadeOrigem: string;
  atrasado: boolean;
  movidaEm: string;
  revisada: boolean;
  revisadaPor: string | null;
  revisadaEm: string | null;
  diferencas: DiferencaNaLista[];
}

const POR_ABA: Record<AbaDoMonitoramento, SQL | undefined> = {
  TODOS: undefined,
  NAO_REVISADOS: PENDENTE,
  CRITICOS: sql`${ticketMovementDayTable.criticidade} = 'CRITICO'`,
  NOVOS: eq(ticketMovementDayTable.classe, "NOVO"),
  ALTERADOS: eq(ticketMovementDayTable.classe, "ALTERADO"),
  ENCERRADOS: eq(ticketMovementDayTable.classe, "ENCERRADO"),
  REMOVIDOS: eq(ticketMovementDayTable.classe, "REMOVIDO"),
};

const TETO_DA_PAGINA = 100;

export async function listarMovimentacoes(
  db: Database,
  {
    dia,
    serie,
    filtros = {},
  }: { dia: string; serie?: string | null; filtros?: FiltrosDaLista },
): Promise<{ total: number; rows: MovimentacaoNaLista[] }> {
  const busca = filtros.busca?.trim();
  const where = and(
    eq(ticketMovementDayTable.dia, dia),
    noEscopoDaSerie(serie),
    POR_ABA[filtros.aba ?? "TODOS"],
    filtros.unidade ? eq(ticketMovementDayTable.unidade, filtros.unidade) : undefined,
    filtros.area ? eq(ticketMovementDayTable.area, filtros.area) : undefined,
    filtros.responsavel
      ? eq(ticketMovementDayTable.responsavel, filtros.responsavel)
      : undefined,
    filtros.statusBucket
      ? eq(ticketMovementDayTable.statusBucket, filtros.statusBucket)
      : undefined,
    /*
      O filtro por tipo de alteração é `EXISTS`, e não junção, pela razão do
      cabeçalho: um chamado com dois prazos alterados apareceria duas vezes na
      lista, e o total diria um número que a página não mostra.
    */
    filtros.tipoDeAlteracao
      ? sql`EXISTS (SELECT 1 FROM ticket_movement_field f
                     WHERE f.movement_id = ${ticketMovementDayTable.id}
                       AND f.tipo = ${filtros.tipoDeAlteracao})`
      : undefined,
    busca
      ? or(
          ilike(ticketMovementDayTable.externalId, `%${busca}%`),
          ilike(ticketMovementDayTable.assunto, `%${busca}%`),
          ilike(ticketMovementDayTable.entidade, `%${busca}%`),
        )
      : undefined,
  );

  const [contagem] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(ticketMovementDayTable)
    .where(where);

  const linhas = await db
    .select({
      m: ticketMovementDayTable,
      revisada: sql<boolean>`${JA_REVISADA}`.mapWith(Boolean),
    })
    .from(ticketMovementDayTable)
    .where(where)
    /*
      `id` desempata de propósito: várias movimentações compartilham o mesmo
      `movida_em` — é o mesmo envio —, e uma ordenação sem desempate deixa a
      ordem entre elas a critério do plano. Com paginação, isso faz a mesma
      linha aparecer em duas páginas ou em nenhuma.
    */
    .orderBy(desc(ticketMovementDayTable.movidaEm), desc(ticketMovementDayTable.id))
    .limit(Math.min(filtros.limit ?? 25, TETO_DA_PAGINA))
    .offset(filtros.offset ?? 0);

  if (linhas.length === 0) return { total: contagem?.total ?? 0, rows: [] };

  const ids = linhas.map((l) => l.m.id);

  /*
    As diferenças da página inteira numa consulta só. Uma por linha seriam 25
    idas ao banco por página — o N+1 que a tela mais fácil comete, porque cada
    ida é rápida e o total não aparece em lugar nenhum.
  */
  const diferencas = await db
    .select()
    .from(ticketMovementFieldTable)
    .where(inArray(ticketMovementFieldTable.movementId, ids))
    .orderBy(asc(ticketMovementFieldTable.tipo), asc(ticketMovementFieldTable.campo));

  const revisoes = await db
    .select()
    .from(ticketMovementReviewTable)
    .where(inArray(ticketMovementReviewTable.movementId, ids))
    .orderBy(desc(ticketMovementReviewTable.revisadoEm));

  const porMovimento = new Map<string, DiferencaNaLista[]>();
  for (const d of diferencas) {
    porMovimento.set(d.movementId, [
      ...(porMovimento.get(d.movementId) ?? []),
      { tipo: d.tipo, campo: d.campo, antes: d.valorAntes, depois: d.valorDepois },
    ]);
  }
  const revisaoPorMovimento = new Map<string, (typeof revisoes)[number]>();
  for (const r of revisoes) {
    if (!revisaoPorMovimento.has(r.movementId)) revisaoPorMovimento.set(r.movementId, r);
  }

  return {
    total: contagem?.total ?? 0,
    rows: linhas.map(({ m, revisada }) =>
      montarLinha(m, revisada, porMovimento.get(m.id) ?? [], revisaoPorMovimento.get(m.id)),
    ),
  };
}

/**
 * Uma movimentação como a tela a recebe.
 *
 * Escrito uma vez porque a lista e o detalhe mostram **a mesma linha**, e duas
 * montagens divergiriam no primeiro campo que alguém acrescentasse a uma delas
 * — com a agravante de que a diferença apareceria só ao abrir um item, que é
 * onde ninguém olha.
 */
function montarLinha(
  m: typeof ticketMovementDayTable.$inferSelect,
  revisada: boolean,
  diferencas: DiferencaNaLista[],
  revisao: { revisadoPor: string; revisadoEm: Date } | undefined,
): MovimentacaoNaLista {
  return {
        id: m.id,
        dia: String(m.dia),
        serie: m.serie,
        externalId: m.externalId,
        classe: m.classe,
        revisao: m.revisao,
        passos: m.passos,
        unidade: m.unidade,
        area: m.area,
        responsavel: m.responsavel,
        solicitante: m.solicitante,
        statusRaw: m.statusRaw,
        statusBucket: m.statusBucket,
        assunto: m.assunto,
        entidade: m.entidade,
        prazoPrevisto: m.prazoPrevisto ? String(m.prazoPrevisto) : null,
        abertoEm: m.abertoEm?.toISOString() ?? null,
        encerradoEm: m.encerradoEm?.toISOString() ?? null,
        alteradoEmFonte: m.alteradoEmFonte?.toISOString() ?? null,
        criticidade: m.criticidade,
        criticidadeMotivo: m.criticidadeMotivo,
        criticidadeOrigem: m.criticidadeOrigem,
        atrasado: m.atrasado,
        movidaEm: m.movidaEm.toISOString(),
        revisada,
        // Só quem revisou **a versão atual** aparece: mostrar o autor de uma
        // revisão vencida ao lado de "não revisado" seria a tela discordando
        // de si mesma.
        revisadaPor: revisada ? (revisao?.revisadoPor ?? null) : null,
        revisadaEm: revisada ? (revisao?.revisadoEm.toISOString() ?? null) : null,
        diferencas,
  };
}

/** As opções que os filtros oferecem — as do dia, e não as do acervo. */
export async function opcoesDeFiltro(
  db: Database,
  { dia, serie }: { dia: string; serie?: string | null },
): Promise<{
  unidades: string[];
  areas: string[];
  responsaveis: string[];
  status: string[];
  tiposDeAlteracao: string[];
}> {
  const escopo = and(eq(ticketMovementDayTable.dia, dia), noEscopoDaSerie(serie));

  const linhas = await db
    .select({
      unidade: ticketMovementDayTable.unidade,
      area: ticketMovementDayTable.area,
      responsavel: ticketMovementDayTable.responsavel,
      status: ticketMovementDayTable.statusBucket,
    })
    .from(ticketMovementDayTable)
    .where(escopo);

  const tipos = await db
    .selectDistinct({ tipo: ticketMovementFieldTable.tipo })
    .from(ticketMovementFieldTable)
    .innerJoin(
      ticketMovementDayTable,
      eq(ticketMovementDayTable.id, ticketMovementFieldTable.movementId),
    )
    .where(escopo);

  const unicos = (valores: (string | null)[]) =>
    [...new Set(valores.filter((v): v is string => v !== null && v !== ""))].sort();

  return {
    unidades: unicos(linhas.map((l) => l.unidade)),
    areas: unicos(linhas.map((l) => l.area)),
    responsaveis: unicos(linhas.map((l) => l.responsavel)),
    status: unicos(linhas.map((l) => l.status)),
    tiposDeAlteracao: unicos(tipos.map((t) => t.tipo)),
  };
}

// ---------------------------------------------------------------------------
// O detalhe
// ---------------------------------------------------------------------------

export interface DetalheDaMovimentacao {
  movimentacao: MovimentacaoNaLista;
  /** O encadeamento do dia — a evidência de que o campo foi e voltou. */
  passos: {
    ordem: number;
    ocorridoEm: string;
    arquivo: string | null;
    diferencas: DiferencaNaLista[];
  }[];
  /** Os parâmetros de remuneração que o chamado mexeu no estado final. */
  parametros: {
    parameterLabel: string;
    changeKind: string | null;
    valueBeforeRaw: string | null;
    valueAfterRaw: string | null;
    beforeSource: string;
  }[];
}

export async function detalheDaMovimentacao(
  db: Database,
  id: string,
): Promise<DetalheDaMovimentacao | null> {
  const [linha] = await db
    .select({
      m: ticketMovementDayTable,
      revisada: sql<boolean>`${JA_REVISADA}`.mapWith(Boolean),
    })
    .from(ticketMovementDayTable)
    .where(eq(ticketMovementDayTable.id, id));
  if (!linha) return null;

  /*
    As diferenças e a revisão vêm por id, e não por uma busca na lista do dia.

    A primeira versão deste arquivo chamava `listarMovimentacoes` com o número do
    chamado como busca livre e procurava o id no resultado — o que funciona até
    o dia em que mais de uma página de movimentações casa com aquele texto, e aí
    o detalhe responde 404 sobre uma movimentação que existe.
  */
  const diferencas = await db
    .select()
    .from(ticketMovementFieldTable)
    .where(eq(ticketMovementFieldTable.movementId, id))
    .orderBy(asc(ticketMovementFieldTable.tipo), asc(ticketMovementFieldTable.campo));

  const [revisao] = await db
    .select()
    .from(ticketMovementReviewTable)
    .where(eq(ticketMovementReviewTable.movementId, id))
    .orderBy(desc(ticketMovementReviewTable.revisadoEm))
    .limit(1);

  const movimentacao = montarLinha(
    linha.m,
    linha.revisada,
    diferencas.map((d) => ({
      tipo: d.tipo,
      campo: d.campo,
      antes: d.valorAntes,
      depois: d.valorDepois,
    })),
    revisao,
  );

  const passos = await db
    .select({
      p: ticketMovementStepTable,
      arquivo: ticketImportTable.filename,
    })
    .from(ticketMovementStepTable)
    .innerJoin(
      ticketImportComparacaoTable,
      eq(ticketImportComparacaoTable.id, ticketMovementStepTable.comparacaoId),
    )
    .innerJoin(
      ticketImportTable,
      eq(ticketImportTable.id, ticketImportComparacaoTable.ticketImportId),
    )
    .where(eq(ticketMovementStepTable.movementId, id))
    .orderBy(asc(ticketMovementStepTable.ordem));

  const parametros = linha.m.ticketIdFinal
    ? await db
        .select({
          parameterLabel: ticketChangeTable.parameterLabel,
          changeKind: ticketChangeTable.changeKind,
          valueBeforeRaw: ticketChangeTable.valueBeforeRaw,
          valueAfterRaw: ticketChangeTable.valueAfterRaw,
          beforeSource: ticketChangeTable.beforeSource,
        })
        .from(ticketChangeTable)
        .innerJoin(ticketTable, eq(ticketTable.id, ticketChangeTable.ticketId))
        .where(
          and(
            eq(ticketTable.ticketImportId, linha.m.ultimoImportId),
            eq(ticketTable.externalId, linha.m.externalId),
          ),
        )
        .orderBy(asc(ticketChangeTable.parameterLabel))
    : [];

  return {
    movimentacao,
    passos: passos.map(({ p, arquivo }) => ({
      ordem: p.ordem,
      ocorridoEm: p.ocorridoEm.toISOString(),
      arquivo,
      diferencas: p.diferencas,
    })),
    parametros,
  };
}

// ---------------------------------------------------------------------------
// A revisão
// ---------------------------------------------------------------------------

export class RevisaoRecusada extends Error {
  readonly codigo: "NAO_ENCONTRADA" | "VERSAO_VENCIDA";
  constructor(codigo: "NAO_ENCONTRADA" | "VERSAO_VENCIDA", mensagem: string) {
    super(mensagem);
    this.name = "RevisaoRecusada";
    this.codigo = codigo;
  }
}

export interface Revisor {
  userId: string | null;
  email: string;
}

/**
 * Marcar uma movimentação como revisada.
 *
 * `revisaoEsperada` é a versão que a tela **mostrou** a quem clicou. Quando ela
 * não é mais a atual, a revisão é recusada em vez de gravada: entre a tela ter
 * carregado e o clique, um envio novo pode ter reescrito a movimentação, e
 * carimbar a versão nova com um olhar dado na antiga é exatamente o carimbo em
 * branco que o schema existe para impedir. A tela recarrega e mostra o que
 * mudou.
 *
 * Sem `revisaoEsperada`, vale a versão atual — é o caminho do lote, em que a
 * tela acabou de ler a lista.
 */
export async function registrarRevisao(
  db: Database,
  {
    movementId,
    revisaoEsperada,
    revisor,
  }: { movementId: string; revisaoEsperada?: number; revisor: Revisor },
): Promise<{ movementId: string; revisao: number; revisadoEm: string }> {
  const [movimento] = await db
    .select({
      id: ticketMovementDayTable.id,
      revisao: ticketMovementDayTable.revisao,
    })
    .from(ticketMovementDayTable)
    .where(eq(ticketMovementDayTable.id, movementId));

  if (!movimento) {
    throw new RevisaoRecusada("NAO_ENCONTRADA", "Movimentação não encontrada.");
  }
  if (revisaoEsperada !== undefined && revisaoEsperada !== movimento.revisao) {
    throw new RevisaoRecusada(
      "VERSAO_VENCIDA",
      "Esta movimentação mudou desde que a tela carregou: uma importação nova " +
        "reescreveu o que ela diz. Recarregue para ver o que mudou antes de revisar.",
    );
  }

  const [gravada] = await db
    .insert(ticketMovementReviewTable)
    .values({
      movementId,
      revisao: movimento.revisao,
      userId: revisor.userId,
      revisadoPor: revisor.email,
    })
    /*
      Revisar duas vezes a mesma versão é um não-evento, e não um erro: dois
      cliques no mesmo botão, ou o lote passando por uma linha já revisada. O
      `DO NOTHING` deixaria `gravada` indefinida; o `DO UPDATE` devolve a linha
      que já existia, e quem revisou primeiro continua sendo quem revisou.
    */
    .onConflictDoUpdate({
      target: [ticketMovementReviewTable.movementId, ticketMovementReviewTable.revisao],
      set: { revisao: movimento.revisao },
    })
    .returning();

  return {
    movementId,
    revisao: movimento.revisao,
    revisadoEm: (gravada?.revisadoEm ?? new Date()).toISOString(),
  };
}

/** Desfazer — some com a revisão da versão atual, e só dela. */
export async function desfazerRevisao(
  db: Database,
  movementId: string,
): Promise<{ movementId: string; desfeita: boolean }> {
  const [movimento] = await db
    .select({ revisao: ticketMovementDayTable.revisao })
    .from(ticketMovementDayTable)
    .where(eq(ticketMovementDayTable.id, movementId));
  if (!movimento) {
    throw new RevisaoRecusada("NAO_ENCONTRADA", "Movimentação não encontrada.");
  }

  const apagadas = await db
    .delete(ticketMovementReviewTable)
    .where(
      and(
        eq(ticketMovementReviewTable.movementId, movementId),
        eq(ticketMovementReviewTable.revisao, movimento.revisao),
      ),
    )
    .returning({ id: ticketMovementReviewTable.id });

  return { movementId, desfeita: apagadas.length > 0 };
}

/**
 * Revisar um lote — o "Continuar revisão" da tela.
 *
 * As movimentações que mudaram desde que a lista carregou **não** são revisadas
 * em silêncio: elas voltam em `recusadas`, e a tela diz quantas precisam de um
 * segundo olhar. Revisá-las junto seria carimbar o que ninguém viu.
 */
export async function revisarEmLote(
  db: Database,
  { ids, revisor }: { ids: string[]; revisor: Revisor },
): Promise<{ revisadas: string[]; recusadas: string[] }> {
  const revisadas: string[] = [];
  const recusadas: string[] = [];
  for (const id of ids) {
    try {
      await registrarRevisao(db, { movementId: id, revisor });
      revisadas.push(id);
    } catch (err) {
      if (err instanceof RevisaoRecusada) recusadas.push(id);
      else throw err;
    }
  }
  return { revisadas, recusadas };
}
