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
  /**
   * Quantos chamados o arquivo daquele dia trouxe — o número que a régua
   * escreve na posição.
   *
   * Mesma regra de `resumoDoDia`: o último envio lido **de cada série**
   * responde pelo dia. Três envios da mesma unidade num dia são a mesma fila
   * três vezes, e somá-los daria uma régua com o triplo do arquivo.
   */
  chamadosNoEnvio: number;
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

  /*
    Os envios vêm em linha, e não somados pelo banco.

    A régua escreve o tamanho do arquivo na posição, e esse número não é a soma
    dos envios do dia: é o do **último envio de cada série** — a regra de
    `resumoDoDia`, e a única que não conta a mesma fila duas vezes quando a
    unidade reenviou. Um `sum(ticket_count)` agrupado por dia não sabe dizer
    isso, e a janela é de nove dias: são poucas linhas para dobrar aqui.

    `order by received_at` é o que faz a última atribuição ao `Map` ser a do
    envio mais recente daquela série — o mesmo mecanismo de `resumoDoDia`, com
    o mesmo sentinela para a série indeterminada, que é uma série e não pode se
    fundir com outra por ser nula.
  */
  const envios = await db
    .select({
      dia: DIA_DO_ENVIO,
      serie: ticketImportTable.serie,
      status: ticketImportTable.status,
      receivedAt: ticketImportTable.receivedAt,
      chamados: ticketImportTable.ticketCount,
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
    .orderBy(asc(ticketImportTable.receivedAt));

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

  interface DoDia {
    envios: number;
    falhas: number;
    ultima: Date | null;
    /** O `ticket_count` do último envio lido de cada série, por série. */
    ultimoPorSerie: Map<string, number>;
  }
  const porDiaEnvios = new Map<string, DoDia>();
  for (const e of envios) {
    const chave = String(e.dia);
    let d = porDiaEnvios.get(chave);
    if (d === undefined) {
      d = { envios: 0, falhas: 0, ultima: null, ultimoPorSerie: new Map() };
      porDiaEnvios.set(chave, d);
    }
    if (e.status === "READ") {
      d.envios += 1;
      d.ultima = e.receivedAt;
      d.ultimoPorSerie.set(e.serie ?? "—", e.chamados);
    } else if (e.status !== "SKIPPED_DUPLICATE") {
      d.falhas += 1;
    }
  }
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
      chamadosNoEnvio: e
        ? [...e.ultimoPorSerie.values()].reduce((a, n) => a + n, 0)
        : 0,
      ultimaImportacao: e?.ultima ? new Date(e.ultima).toISOString() : null,
    });
  }
  return dias;
}

// ---------------------------------------------------------------------------
// O resumo do dia
// ---------------------------------------------------------------------------

/**
 * A fila do dia pelo desfecho — os três nomes que o arquivo escreve.
 *
 * `APROVADO`, `EM ANÁLISE` e `REPROVADO` são o vocabulário do export da Ambev,
 * e cada um cai numa das caixas de `normalizeStatus`: `ATENDIDO`,
 * `EM_ANDAMENTO` e `RECUSADO`. A contagem é pela **caixa**, e não pelo texto:
 * é ela que tem índice (`ticket_status_bucket_idx`) e é ela que sobrevive à
 * fonte inventar "Aprovado parcialmente" na semana que vem.
 *
 * A caixa é mais larga que o nome do cartão, e a tela diz isso na dica: um
 * arquivo que escrevesse "Concluído" também cairia em `ATENDIDO` e seria
 * contado como aprovado. É a mesma folga que a aba Chamados aceita ao filtrar
 * por situação, e o preço de não ter uma tabela de status por cliente.
 *
 * `outras` é o que **não** cai em nenhuma das três — aberto, cancelado, sem
 * status — e existe para que a soma feche. Três cartões que ignorassem em
 * silêncio uma quarta caixa dariam a soma errada de um total certo, que é o
 * defeito que este produto existe para pegar.
 */
export interface SituacoesNoEnvio {
  /** Caixa `ATENDIDO` — o "APROVADO" do arquivo. */
  aprovados: number;
  /** Caixa `EM_ANDAMENTO` — o "EM ANÁLISE" do arquivo. */
  emAnalise: number;
  /** Caixa `RECUSADO` — o "REPROVADO" do arquivo. */
  reprovados: number;
  /** Tudo o que não é nenhuma das três. Some da tela quando é zero. */
  outras: number;
  /**
   * A soma das quatro — **contada em `ticket`**, e não declarada pelo envio.
   *
   * Pode divergir de `chamadosNoEnvio`, que vem de `ticket_import.ticket_count`
   * (o que o leitor disse ter lido). As duas convivem porque respondem a
   * perguntas diferentes, e é este o número com que os cartões fecham.
   */
  total: number;
  /** As caixas dobradas em `outras`, para a tela poder nomeá-las. */
  detalheDeOutras: { statusBucket: string; total: number }[];
}

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
  /**
   * Quantos chamados o arquivo do dia trouxe — o tamanho da fila, não do delta.
   *
   * Grão diferente de `movimentacoes`, e **nunca somado com ele**: as
   * movimentações são o subconjunto da fila que se mexeu. Está aqui, e não numa
   * consulta própria, porque sai da mesma leitura de `ticket_import` que o
   * resumo já faz — e é ele que permite a tela dizer "1.218 chamados vieram e
   * nenhum se mexeu" sem carregar a relação inteira.
   *
   * O último envio lido de cada série responde pelo dia, pela razão de
   * `filaDoDia`: três envios da mesma unidade são a mesma fila três vezes.
   */
  chamadosNoEnvio: number;
  /**
   * A mesma fila do dia, dobrada pelo desfecho que o arquivo declara.
   *
   * É o que os três cartões do topo da tela contam desde que deixaram de
   * contar movimentações: num dia sem movimentação nenhuma — que é a maioria
   * dos dias — os cartões antigos mostravam três zeros sobre um arquivo de
   * 1.218 chamados, e três zeros certos que não dizem nada é exatamente o que
   * esta tela existe para não fazer.
   */
  situacoesNoEnvio: SituacoesNoEnvio;
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

/**
 * As três caixas que viram cartão, e o nome que a tela lhes dá.
 *
 * Ficam aqui, e não na tela, porque são a ponte entre o vocabulário do arquivo
 * e o de `normalizeStatus`: quem mudar o dobramento lá tem de encontrar esta
 * lista no mesmo pacote, e não num componente três camadas acima.
 */
const CAIXA_APROVADO = "ATENDIDO";
const CAIXA_EM_ANALISE = "EM_ANDAMENTO";
const CAIXA_REPROVADO = "RECUSADO";

/** A fila dos envios do dia contada por caixa de situação. */
async function situacoesDaFila(
  db: Database,
  envios: string[],
): Promise<SituacoesNoEnvio> {
  const vazio: SituacoesNoEnvio = {
    aprovados: 0,
    emAnalise: 0,
    reprovados: 0,
    outras: 0,
    total: 0,
    detalheDeOutras: [],
  };
  if (envios.length === 0) return vazio;

  const linhas = await db
    .select({
      statusBucket: ticketTable.statusBucket,
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(ticketTable)
    .where(inArray(ticketTable.ticketImportId, envios))
    .groupBy(ticketTable.statusBucket)
    .orderBy(desc(sql`count(*)`));

  const conhecidas = new Set([CAIXA_APROVADO, CAIXA_EM_ANALISE, CAIXA_REPROVADO]);
  const contagem = (caixa: string) =>
    linhas.find((l) => l.statusBucket === caixa)?.total ?? 0;

  const detalheDeOutras = linhas.filter((l) => !conhecidas.has(l.statusBucket));
  return {
    aprovados: contagem(CAIXA_APROVADO),
    emAnalise: contagem(CAIXA_EM_ANALISE),
    reprovados: contagem(CAIXA_REPROVADO),
    outras: detalheDeOutras.reduce((a, l) => a + l.total, 0),
    total: linhas.reduce((a, l) => a + l.total, 0),
    detalheDeOutras,
  };
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
      id: ticketImportTable.id,
      serie: ticketImportTable.serie,
      status: ticketImportTable.status,
      filename: ticketImportTable.filename,
      receivedAt: ticketImportTable.receivedAt,
      failureReason: ticketImportTable.failureReason,
      chamados: ticketImportTable.ticketCount,
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

  /*
    O tamanho da fila do dia: o último envio de cada série, somado.

    `lidos` já vem ordenado por `received_at`, então a última atribuição ao
    `Map` é a do envio mais recente daquela série — a mesma regra de
    `enviosDaFila`, e o mesmo sentinela para a série indeterminada, que é uma
    série e não pode se fundir com outra por ser nula.
  */
  const ultimoPorSerie = new Map<string, (typeof lidos)[number]>();
  for (const e of lidos) ultimoPorSerie.set(e.serie ?? "—", e);
  const enviosDaVez = [...ultimoPorSerie.values()];
  const chamadosNoEnvio = enviosDaVez.reduce((a, e) => a + e.chamados, 0);

  /*
    Uma consulta a mais no resumo — a única dele que toca `ticket`.

    O cabeçalho deste arquivo promete que abrir a tela é leitura de linha
    pronta, e esta continua sendo: um `count(*)` agrupado, recortado pelos
    envios do dia com `ticket_import_idx` e dobrado por uma coluna indexada
    (`ticket_status_bucket_idx`). Não desempacota `payload`, não junta com
    movimentação e não compara nada — e continua sendo **uma** requisição, que
    é o que a tela paga ao abrir.

    Fica no resumo, e não na relação, porque os cartões estão em tela antes de
    alguém abrir a visão "Chamados do envio": tirá-los da fila obrigaria toda
    abertura de tela a carregar 1.218 linhas para escrever três números.
  */
  const situacoesNoEnvio = await situacoesDaFila(
    db,
    enviosDaVez.map((e) => e.id),
  );

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
    chamadosNoEnvio,
    situacoesNoEnvio,
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

// ---------------------------------------------------------------------------
// A fila do dia — a relação de chamados que o arquivo trouxe
// ---------------------------------------------------------------------------

/**
 * A segunda leitura do mesmo dia, e por que ela precisa existir.
 *
 * Tudo acima deste ponto responde **o que mudou**. É a pergunta certa para quem
 * abre a tela todo dia, e é a pergunta errada num dia em que nada mudou: o
 * arquivo das 07:25 trouxe 1.218 chamados, a comparação com o envio anterior
 * não achou diferença nenhuma, e a tela — corretamente — dizia "nenhuma
 * movimentação identificada" em cima de uma lista vazia. Quem opera lê isso
 * como *"o import não trouxe nada"*, que é o oposto do que aconteceu.
 *
 * `filaDoDia` é a outra leitura: **o que veio no arquivo**, tenha se mexido ou
 * não. Não é a mesma população da lista de movimentações e nunca soma com ela —
 * é a população **de onde** as movimentações saíram. A tela mostra uma de cada
 * vez, e diz qual está mostrando, pela mesma razão que a aba Chamados e a aba
 * Planilha não somam os números uma da outra.
 *
 * ---------------------------------------------------------------------------
 * O último envio de cada série responde pelo dia
 * ---------------------------------------------------------------------------
 *
 * Um dia com três envios da mesma unidade tem a mesma fila três vezes, e listar
 * os três daria cada chamado repetido três vezes — um "3.654 chamados" que não
 * existe em arquivo nenhum. A fila do dia é o **estado no fim do dia**, que é o
 * último envio lido de cada série; é a mesma escolha que o motor faz ao
 * denormalizar o estado final da movimentação, e pelo mesmo motivo.
 *
 * Envios que não chegaram a `READ` não entram: um arquivo que falhou não tem
 * fila, e a tela já diz por outro caminho que ele existiu (`avisos` do resumo).
 *
 * ---------------------------------------------------------------------------
 * A ponte entre as duas leituras
 * ---------------------------------------------------------------------------
 *
 * Cada linha diz se aquele chamado está entre as movimentações do dia
 * (`movimentou`). É o que permite descer a relação inteira e ver onde o motor
 * mexeu, sem trocar de lista — e é o que torna conferível, a olho, a afirmação
 * de que 1.218 chamados vieram e nenhum se mexeu.
 */

/** Um envio que responde pela fila de um dia — a procedência da lista. */
export interface EnvioDaFila {
  id: string;
  filename: string;
  serie: string | null;
  recebidoEm: string;
  recebidoPor: string | null;
  /** Quantos chamados o arquivo trouxe, como o próprio envio os contou. */
  chamados: number;
}

/**
 * O que o chamado pediu num parâmetro — a linha do arquivo, não a apuração.
 *
 * `de` e `para` são `Valor Antigo` e `Valor Solicitado` como o arquivo os
 * escreveu, sem número derivado nenhum: quem confere a relação está com a
 * planilha aberta ao lado, e um valor normalizado por nós não casa com o que
 * ele lê lá. O impacto apurado é outra tela, e outro grão.
 *
 * `operacao` é a coluna `Operação` (`SET`, `FORM_THIS`, …) e é ela que explica
 * a linha sem valores: num export real a maioria das alterações não é `SET` —
 * é troca de fórmula ou inclusão de item, que mudam a remuneração sem existir
 * "de 10 para 12" para mostrar. Sem ela, essas linhas pareceriam dado perdido.
 */
export interface AlteracaoDoChamado {
  parametro: string;
  operacao: string | null;
  de: string | null;
  para: string | null;
}

/** Um chamado como a relação o mostra. */
export interface ChamadoNaFila {
  id: string;
  externalId: string;
  serie: string | null;
  unidade: string | null;
  area: string | null;
  responsavel: string | null;
  solicitante: string | null;
  /** `Operador` — quem toca o chamado, ao lado de quem o aprova. */
  operador: string | null;
  statusRaw: string | null;
  statusBucket: string;
  assunto: string | null;
  entidade: string | null;
  /**
   * A coluna `Item` inteira — `Cargo: Manobrista | Classificação: …`.
   *
   * Convive com `entidade` porque as duas dizem coisas diferentes nas linhas
   * de cargo: ali `entidade` cai para este mesmo texto por não haver placa, e
   * a tela só o repete quando ele **não** é o que já está em `entidade`.
   */
  item: string | null;
  categoria: string | null;
  /** `Vig. Abertura` — a vigência que o próprio chamado nomeia. */
  vigencia: string | null;
  /** `SLA`, como a fonte escreveu. Não vira data e não vira número. */
  sla: string | null;
  prazoPrevisto: string | null;
  abertoEm: string | null;
  encerradoEm: string | null;
  alteradoEmFonte: string | null;
  /** Quantos parâmetros de remuneração vieram preenchidos neste chamado. */
  parametros: number;
  /**
   * Os parâmetros do chamado, um a um.
   *
   * `parametros` continua sendo a contagem que a coluna gravou; esta é a
   * relação de verdade, lida de `ticket_change` só para a página em tela. As
   * duas podem divergir num chamado cujo envio contou o que a linha não trouxe,
   * e é por isso que a tela mostra a contagem **e** os itens.
   */
  alteracoes: AlteracaoDoChamado[];
  /** Linha física do arquivo, 1-based — o que casa a tela com o Excel aberto. */
  linhaDoArquivo: number;
  /** Este chamado está entre as movimentações do dia. Ver o cabeçalho. */
  movimentou: boolean;
}

export interface FiltrosDaFila {
  unidade?: string;
  area?: string;
  responsavel?: string;
  statusBucket?: string;
  busca?: string;
  limit?: number;
  offset?: number;
}

export interface FilaDoDia {
  dia: string;
  serie: string | null | undefined;
  /** Os envios que respondem pela fila. Vazio num dia sem importação lida. */
  envios: EnvioDaFila[];
  /** O tamanho da fila **sem filtro nenhum** — o número que rotula a visão. */
  total: number;
  /** Sem data de fechamento no arquivo. */
  emAberto: number;
  /** Quantos dos chamados da fila se mexeram neste dia. */
  movimentaram: number;
  /** Quantos a página devolve depois dos filtros. */
  totalFiltrado: number;
  rows: ChamadoNaFila[];
  filtros: {
    unidades: string[];
    areas: string[];
    responsaveis: string[];
    status: string[];
  };
}

/**
 * Os envios lidos de um dia, um por série: o último de cada uma.
 *
 * A janela em `received_at` acompanha a igualdade no dia da operação para que o
 * índice `ticket_import_received_idx` continue servindo — a conversão de fuso
 * sozinha num `WHERE` descarta índice, e é a mesma folga de um dia que a régua
 * usa, pela mesma razão: o fim do dia local cai no dia seguinte em UTC.
 */
async function enviosDaFila(
  db: Database,
  { dia, serie }: { dia: string; serie?: string | null },
): Promise<EnvioDaFila[]> {
  const linhas = await db
    .select({
      id: ticketImportTable.id,
      filename: ticketImportTable.filename,
      serie: ticketImportTable.serie,
      recebidoEm: ticketImportTable.receivedAt,
      recebidoPor: ticketImportTable.receivedBy,
      chamados: ticketImportTable.ticketCount,
    })
    .from(ticketImportTable)
    .where(
      and(
        eq(ticketImportTable.status, "READ"),
        gte(ticketImportTable.receivedAt, new Date(`${dia}T00:00:00.000Z`)),
        lte(
          ticketImportTable.receivedAt,
          new Date(`${diaSeguinte(dia, 2)}T00:00:00.000Z`),
        ),
        sql`${DIA_DO_ENVIO} = ${dia}`,
        serie === undefined
          ? undefined
          : serie === null
            ? isNull(ticketImportTable.serie)
            : eq(ticketImportTable.serie, serie),
      ),
    )
    .orderBy(asc(ticketImportTable.receivedAt), asc(ticketImportTable.id));

  /*
    Um por série, e o último. `Map` sobre a lista já ordenada: a última
    atribuição vence, que é exatamente a regra. O `—` é o mesmo sentinela do
    índice único da movimentação — a série indeterminada é uma série, e não
    pode se fundir com nenhuma outra por ser nula.
  */
  const ultimoPorSerie = new Map<string, EnvioDaFila>();
  for (const l of linhas) {
    ultimoPorSerie.set(l.serie ?? "—", {
      id: l.id,
      filename: l.filename,
      serie: l.serie,
      recebidoEm: new Date(l.recebidoEm).toISOString(),
      recebidoPor: l.recebidoPor,
      chamados: l.chamados,
    });
  }
  return [...ultimoPorSerie.values()].sort((a, b) =>
    a.recebidoEm < b.recebidoEm ? -1 : a.recebidoEm > b.recebidoEm ? 1 : 0,
  );
}

/** Os parâmetros dos chamados em tela, na ordem das colunas do arquivo. */
async function alteracoesDosChamados(
  db: Database,
  chamados: string[],
): Promise<Map<string, AlteracaoDoChamado[]>> {
  const porChamado = new Map<string, AlteracaoDoChamado[]>();
  if (chamados.length === 0) return porChamado;

  const linhas = await db
    .select({
      chamado: ticketChangeTable.ticketId,
      parametro: ticketChangeTable.parameterLabel,
      operacao: ticketChangeTable.changeKind,
      de: ticketChangeTable.valueBeforeRaw,
      para: ticketChangeTable.valueAfterRaw,
    })
    .from(ticketChangeTable)
    .where(inArray(ticketChangeTable.ticketId, chamados))
    /*
      A ordem das colunas do arquivo, pela razão da ordem das linhas: esta
      relação é a planilha, e os parâmetros aparecem na ordem em que ela os
      escreveu. `parameterLabel` desempata porque `(chamado, parâmetro)` é o
      índice único da tabela — sem ele, duas colunas de mesma origem sairiam
      em ordem indefinida entre uma leitura e outra.
    */
    .orderBy(
      asc(ticketChangeTable.sourceColumnIndex),
      asc(ticketChangeTable.parameterLabel),
    );

  for (const l of linhas) {
    const lista = porChamado.get(l.chamado) ?? [];
    lista.push({
      parametro: l.parametro,
      operacao: l.operacao,
      de: l.de,
      para: l.para,
    });
    porChamado.set(l.chamado, lista);
  }
  return porChamado;
}

export async function filaDoDia(
  db: Database,
  {
    dia,
    serie,
    filtros = {},
  }: { dia: string; serie?: string | null; filtros?: FiltrosDaFila },
): Promise<FilaDoDia> {
  const semFiltros = {
    unidades: [] as string[],
    areas: [] as string[],
    responsaveis: [] as string[],
    status: [] as string[],
  };

  const envios = await enviosDaFila(db, { dia, serie });
  if (envios.length === 0) {
    return {
      dia,
      serie,
      envios,
      total: 0,
      emAberto: 0,
      movimentaram: 0,
      totalFiltrado: 0,
      rows: [],
      filtros: semFiltros,
    };
  }

  const ids = envios.map((e) => e.id);
  const daFila = inArray(ticketTable.ticketImportId, ids);

  /*
    O chamado que se mexeu neste dia — a ponte com a outra leitura.

    `EXISTS` correlacionado, e não junção, pela disciplina do cabeçalho do
    arquivo: a movimentação é única por `(dia, série, chamado)`, mas uma junção
    aqui obrigaria todo `count(*)` desta função a se defender dela. A série
    entra na correlação porque o mesmo número de chamado pode existir em duas
    unidades sem ser o mesmo chamado — é a mesma chave do índice
    `ticket_movement_day_grao_uq`, sentinela incluído.
  */
  const MOVIMENTOU: SQL = sql`EXISTS (
    SELECT 1 FROM ticket_movement_day d
     WHERE d.dia = ${dia}
       AND d.external_id = ${ticketTable.externalId}
       AND COALESCE(d.serie, '—') = COALESCE(${ticketImportTable.serie}, '—')
  )`;

  const [totais] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      emAberto: sql<number>`count(*) filter (where ${ticketTable.closedAt} is null)`.mapWith(Number),
      movimentaram: sql<number>`count(*) filter (where ${MOVIMENTOU})`.mapWith(Number),
    })
    .from(ticketTable)
    .innerJoin(ticketImportTable, eq(ticketImportTable.id, ticketTable.ticketImportId))
    .where(daFila);

  const busca = filtros.busca?.trim();
  const recorte = and(
    daFila,
    filtros.unidade ? eq(ticketTable.unidadeRaw, filtros.unidade) : undefined,
    filtros.area ? eq(ticketTable.segmentoRaw, filtros.area) : undefined,
    filtros.responsavel ? eq(ticketTable.aprovadorRaw, filtros.responsavel) : undefined,
    filtros.statusBucket ? eq(ticketTable.statusBucket, filtros.statusBucket) : undefined,
    busca
      ? or(
          ilike(ticketTable.externalId, `%${busca}%`),
          ilike(ticketTable.subject, `%${busca}%`),
          ilike(ticketTable.entityLabel, `%${busca}%`),
          ilike(ticketTable.entityDescription, `%${busca}%`),
        )
      : undefined,
  );

  const [filtrado] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(ticketTable)
    .where(recorte);

  const linhas = await db
    .select({
      t: ticketTable,
      serie: ticketImportTable.serie,
      movimentou: sql<boolean>`${MOVIMENTOU}`.mapWith(Boolean),
    })
    .from(ticketTable)
    .innerJoin(ticketImportTable, eq(ticketImportTable.id, ticketTable.ticketImportId))
    .where(recorte)
    /*
      A ordem do arquivo, e não a da tela de movimentações.

      Esta lista é *a relação da planilha*, e a ordem em que a planilha a
      escreveu é a única que quem confere consegue casar com o arquivo aberto
      no Excel ao lado. `(envio, linha)` é único por construção — o índice
      `ticket_import_row_uq` —, então a paginação não repete nem pula linha,
      que é o defeito que uma ordenação sem desempate produz e que só aparece
      na segunda página.
    */
    .orderBy(
      asc(ticketImportTable.receivedAt),
      asc(ticketTable.ticketImportId),
      asc(ticketTable.sourceRowIndex),
    )
    .limit(Math.min(filtros.limit ?? 25, TETO_DA_PAGINA))
    .offset(filtros.offset ?? 0);

  /*
    As opções dos filtros saem da fila inteira, e não da página: um seletor que
    só oferecesse as unidades das 25 linhas visíveis esconderia justamente as
    que quem procura quer alcançar.
  */
  const valores = await db
    .select({
      unidade: ticketTable.unidadeRaw,
      area: ticketTable.segmentoRaw,
      responsavel: ticketTable.aprovadorRaw,
      status: ticketTable.statusBucket,
    })
    .from(ticketTable)
    .where(daFila);

  const unicos = (lista: (string | null)[]) =>
    [...new Set(lista.filter((v): v is string => v !== null && v !== ""))].sort();

  /*
    Os parâmetros **da página**, e nunca os da fila inteira.

    Uma consulta a mais por página, recortada pelos 25 chamados que estão em
    tela (`ticket_change_ticket_idx`), em vez de uma junção com `ticket_change`
    na consulta da lista: a junção multiplicaria o chamado pelo número de
    parâmetros e faria a paginação devolver 25 *linhas de parâmetro*, não 25
    chamados — o mesmo defeito que o cabeçalho deste arquivo documenta ter
    evitado do lado das revisões.
  */
  const alteracoes = await alteracoesDosChamados(
    db,
    linhas.map((l) => l.t.id),
  );

  return {
    dia,
    serie,
    envios,
    total: totais?.total ?? 0,
    emAberto: totais?.emAberto ?? 0,
    movimentaram: totais?.movimentaram ?? 0,
    totalFiltrado: filtrado?.total ?? 0,
    rows: linhas.map(({ t, serie: serieDoEnvio, movimentou }) => ({
      id: t.id,
      externalId: t.externalId,
      serie: serieDoEnvio,
      unidade: t.unidadeRaw,
      area: t.segmentoRaw,
      responsavel: t.aprovadorRaw,
      solicitante: t.requestedBy,
      statusRaw: t.statusRaw,
      statusBucket: t.statusBucket,
      assunto: t.subject,
      entidade: t.entityLabel ?? t.entityDescription,
      categoria: t.categoriaRaw,
      prazoPrevisto: t.prazoPrevisto ? String(t.prazoPrevisto) : null,
      abertoEm: t.openedAt?.toISOString() ?? null,
      encerradoEm: t.closedAt?.toISOString() ?? null,
      alteradoEmFonte: t.alteradoEmFonte?.toISOString() ?? null,
      operador: t.operadorRaw,
      item: t.entityDescription,
      vigencia: t.vigenciaLabel,
      sla: t.slaRaw,
      parametros: t.changedParameterCount,
      alteracoes: alteracoes.get(t.id) ?? [],
      linhaDoArquivo: t.sourceRowIndex,
      movimentou,
    })),
    filtros: {
      unidades: unicos(valores.map((v) => v.unidade)),
      areas: unicos(valores.map((v) => v.area)),
      responsaveis: unicos(valores.map((v) => v.responsavel)),
      status: unicos(valores.map((v) => v.status)),
    },
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
