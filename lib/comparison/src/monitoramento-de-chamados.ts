import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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

/**
 * MONITORAMENTO DE CHAMADOS — o motor.
 *
 * A aba Chamados responde "o que tem na fila hoje", lendo **um** envio. Este
 * arquivo responde a outra pergunta, que é a que o gestor faz todo dia: **o que
 * mudou desde ontem?** Ele não lê arquivo nenhum e não guarda chamado nenhum —
 * subtrai dois retratos que já estavam no banco.
 *
 * Mora em `lib/comparison` e escreve, como `engine.ts`: a camada derivada é
 * calculada aqui e é descartável, e é isso que permite melhorar o algoritmo sem
 * migration. Ver `schema/monitoramento-de-chamados.ts`.
 *
 * ---------------------------------------------------------------------------
 * As três armadilhas deste domínio, e onde cada uma é desarmada
 * ---------------------------------------------------------------------------
 *
 * 1. **O número do chamado não identifica uma linha.** O export real é lido no
 *    formato NARROW — uma linha por *campo alterado* —, e `readTicketImport`
 *    grava uma linha de `ticket` por linha do arquivo. Um `B.O` que mexeu em
 *    três campos são três linhas de `ticket` com o mesmo `external_id`. Quem
 *    desarma: `retratosDoEnvio`, que dobra as N linhas num retrato só.
 *
 * 2. **Dois envios do mesmo dia costumam ser unidades diferentes.** O arquivo
 *    chama-se `Chamados_<unidade>.xlsx`. Comparar Recife com Camaçari
 *    produziria "todos sumiram, 380 novos" — movimentação falsa em massa. Quem
 *    desarma: a série (`ticket_import.serie`), que particiona antes de comparar.
 *
 * 3. **Um `ticket_change` não é uma movimentação.** Ele é o *parâmetro de
 *    remuneração que o chamado pediu para mexer*, dentro de um envio. A
 *    movimentação é o que mudou *no chamado* entre dois envios. Aqui os valores
 *    de parâmetro entram apenas como mais um campo comparado
 *    (`VALOR_SOLICITADO`), nunca como a unidade da tela.
 */

// ---------------------------------------------------------------------------
// O dia
// ---------------------------------------------------------------------------

/**
 * O fuso em que o dia da régua é decidido.
 *
 * A régua é a data da **importação** (`received_at`), e um envio às 21h de 02/09
 * pertence a 02/09 — não a 03/09, que é o que um `::date` em UTC responderia
 * neste fuso. A constante é nomeada porque ela aparece em três lugares (aqui,
 * no backfill da `0087` e na tela) e três literais divergiriam no primeiro
 * horário de verão que alguém decidisse tratar.
 */
export const FUSO_DA_OPERACAO = "America/Sao_Paulo";

const FORMATADOR_DE_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_DA_OPERACAO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** O dia da operação a que um instante pertence — `YYYY-MM-DD`. */
export function diaDaOperacao(instante: Date): string {
  return FORMATADOR_DE_DIA.format(instante);
}

/** O dia seguinte a um `YYYY-MM-DD`, sem depender do fuso de quem chama. */
export function diaSeguinte(dia: string, passos = 1): string {
  const [a, m, d] = dia.split("-").map(Number);
  const base = new Date(Date.UTC(a!, m! - 1, d!));
  base.setUTCDate(base.getUTCDate() + passos);
  return base.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// A série
// ---------------------------------------------------------------------------

export type OrigemDaSerie =
  | "ARQUIVO"
  | "NOME_DO_ARQUIVO"
  | "MISTA"
  | "INDETERMINADA";

/**
 * O rótulo com que uma série indeterminada aparece na chave única.
 *
 * Um índice único trata cada `NULL` como distinto, então sem este substituto
 * duas movimentações do mesmo chamado sem série no mesmo dia conviveriam. O
 * mesmo valor está escrito no índice da `0087`, e os dois têm de concordar.
 */
export const SERIE_INDETERMINADA = "—";

/**
 * A unidade que o nome do arquivo nomeia — o desempate, nunca a fonte preferida.
 *
 * `Chamados_Recife.xlsx`, `chamados - camaçari.csv`, `Chamados_CDD BELEM.xlsx`.
 * É frágil de propósito reconhecer só esta forma: quem renomeia o arquivo muda
 * a partição, e por isso a coluna `Unidade` das linhas vence sempre que existe.
 */
export function serieDoNomeDoArquivo(filename: string): string | null {
  const semExtensao = filename.replace(/\.(xlsx|xlsm|csv)$/i, "");
  const casado = semExtensao.match(/^\s*chamados\s*[-_ ]\s*(.+)$/i);
  const bruto = (casado?.[1] ?? "").trim();
  return bruto === "" ? null : bruto;
}

// ---------------------------------------------------------------------------
// O retrato de um chamado num envio
// ---------------------------------------------------------------------------

/** Uma linha de `ticket` como o motor precisa dela. Nada além. */
export interface LinhaDeChamado {
  id: string;
  externalId: string;
  sourceRowIndex: number;
  statusRaw: string | null;
  statusBucket: string;
  unidadeRaw: string | null;
  segmentoRaw: string | null;
  aprovadorRaw: string | null;
  categoriaRaw: string | null;
  prazoPrevisto: string | null;
  alteradoEmFonte: Date | null;
  requestedBy: string | null;
  subject: string | null;
  entityLabel: string | null;
  entityDescription: string | null;
  vigenciaLabel: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
}

/** O chamado inteiro num envio — as N linhas dele, dobradas. */
export interface RetratoDoChamado {
  externalId: string;
  /** A linha de maior `source_row_index`: a que a tela abre. */
  ticketId: string;
  unidade: string | null;
  area: string | null;
  responsavel: string | null;
  solicitante: string | null;
  statusRaw: string | null;
  statusBucket: string;
  assunto: string | null;
  entidade: string | null;
  categoria: string | null;
  vigencia: string | null;
  prazoPrevisto: string | null;
  abertoEm: Date | null;
  encerradoEm: Date | null;
  alteradoEmFonte: Date | null;
  /** `Campo Alteração` → valor solicitado. Uma entrada por parâmetro tocado. */
  valores: Map<string, string | null>;
}

/** Os status que encerram um chamado. */
export const STATUS_TERMINAIS: ReadonlySet<string> = new Set([
  "ATENDIDO",
  "RECUSADO",
  "CANCELADO",
]);

export function eTerminal(bucket: string): boolean {
  return STATUS_TERMINAIS.has(bucket);
}

/** Entre dois não-terminais, o mais adiantado — só para escolher um rótulo. */
const ADIANTAMENTO: Record<string, number> = {
  DESCONHECIDO: 0,
  ABERTO: 1,
  EM_ANDAMENTO: 2,
};

/**
 * O status do **chamado**, a partir dos status das linhas dele.
 *
 * No formato NARROW cada linha é um campo alterado, e nada garante que a fonte
 * repita o mesmo status em todas — num export real convivem "Aprovado" numa
 * alteração e "Em análise" noutra, do mesmo `B.O`.
 *
 * **A regra é: qualquer linha não-terminal mantém o chamado não-terminal.** É a
 * direção segura, e a escolha é sobre que erro se prefere cometer. Encerrar um
 * chamado que ainda tem item em análise o tira da fila de revisão e some com
 * ele da tela; mantê-lo aberto um dia a mais só custa uma linha a mais para
 * olhar. `DESCONHECIDO` conta como não-terminal pela mesma razão — um status
 * que não sabemos ler não pode fechar nada.
 */
export function dobrarStatus(
  linhas: { statusRaw: string | null; statusBucket: string }[],
): { bucket: string; raw: string | null } {
  const naoTerminais = linhas.filter((l) => !eTerminal(l.statusBucket));
  const candidatas = naoTerminais.length > 0 ? naoTerminais : linhas;

  let escolhida = candidatas[0];
  for (const l of candidatas) {
    const melhor = ADIANTAMENTO[escolhida!.statusBucket] ?? -1;
    const atual = ADIANTAMENTO[l.statusBucket] ?? -1;
    if (atual > melhor) escolhida = l;
  }

  /*
    O texto mostrado é o do que decidiu o balde, e não uma junção das grafias:
    "Aprovado / Em análise" numa coluna de status seria lido como um status que
    a Ambev tem, e ela não tem. Quem quiser ver linha a linha abre o chamado.
  */
  return {
    bucket: escolhida?.statusBucket ?? "DESCONHECIDO",
    raw: escolhida?.statusRaw ?? null,
  };
}

/** O primeiro valor não vazio, na ordem das linhas. */
function primeiro<T>(linhas: T[], ler: (l: T) => string | null): string | null {
  for (const l of linhas) {
    const v = ler(l);
    if (v !== null && v.trim() !== "") return v.trim();
  }
  return null;
}

function maisRecente(datas: (Date | null)[]): Date | null {
  let melhor: Date | null = null;
  for (const d of datas) {
    if (d && (melhor === null || d > melhor)) melhor = d;
  }
  return melhor;
}

/**
 * As linhas de um envio dobradas em um retrato por chamado.
 *
 * A chave é `external_id` — e, num envio de série MISTA, `unidade|external_id`:
 * o mesmo número em duas unidades não é o mesmo chamado, e fundi-los faria uma
 * unidade sobrescrever a outra sem que nada aparecesse na tela.
 */
export function retratosDoEnvio(
  linhas: LinhaDeChamado[],
  valoresPorTicket: Map<string, { campo: string; valor: string | null }[]>,
  { porUnidade = false }: { porUnidade?: boolean } = {},
): Map<string, RetratoDoChamado> {
  const agrupadas = new Map<string, LinhaDeChamado[]>();
  for (const linha of linhas) {
    const chave = porUnidade
      ? `${linha.unidadeRaw ?? SERIE_INDETERMINADA}|${linha.externalId}`
      : linha.externalId;
    agrupadas.set(chave, [...(agrupadas.get(chave) ?? []), linha]);
  }

  const retratos = new Map<string, RetratoDoChamado>();
  for (const [chave, doChamado] of agrupadas) {
    const ordenadas = [...doChamado].sort(
      (a, b) => a.sourceRowIndex - b.sourceRowIndex,
    );
    const ultima = ordenadas[ordenadas.length - 1]!;
    const status = dobrarStatus(ordenadas);

    const valores = new Map<string, string | null>();
    for (const linha of ordenadas) {
      for (const { campo, valor } of valoresPorTicket.get(linha.id) ?? []) {
        valores.set(campo, valor);
      }
    }

    retratos.set(chave, {
      externalId: ultima.externalId,
      ticketId: ultima.id,
      unidade: primeiro(ordenadas, (l) => l.unidadeRaw),
      area: primeiro(ordenadas, (l) => l.segmentoRaw),
      responsavel: primeiro(ordenadas, (l) => l.aprovadorRaw),
      solicitante: primeiro(ordenadas, (l) => l.requestedBy),
      statusRaw: status.raw,
      statusBucket: status.bucket,
      assunto: primeiro(ordenadas, (l) => l.subject),
      entidade:
        primeiro(ordenadas, (l) => l.entityLabel) ??
        primeiro(ordenadas, (l) => l.entityDescription),
      categoria: primeiro(ordenadas, (l) => l.categoriaRaw),
      vigencia: primeiro(ordenadas, (l) => l.vigenciaLabel),
      prazoPrevisto: primeiro(ordenadas, (l) => l.prazoPrevisto),
      abertoEm: maisRecente(ordenadas.map((l) => l.openedAt)),
      /*
        O encerramento é o **mais recente** das linhas, e não o primeiro: um
        chamado só está encerrado quando a última alteração dele foi decidida, e
        pegar a primeira data marcaria como fechado em 01/09 um chamado cuja
        última alteração foi aprovada em 05/09.
      */
      encerradoEm: eTerminal(status.bucket)
        ? maisRecente(ordenadas.map((l) => l.closedAt))
        : null,
      alteradoEmFonte: maisRecente(ordenadas.map((l) => l.alteradoEmFonte)),
      valores,
    });
  }
  return retratos;
}

// ---------------------------------------------------------------------------
// A comparação
// ---------------------------------------------------------------------------

export type TipoDeAlteracao =
  | "STATUS"
  | "ENCERRAMENTO"
  | "PRAZO"
  | "RESPONSAVEL"
  | "SOLICITANTE"
  | "UNIDADE"
  | "AREA"
  | "CATEGORIA"
  | "VIGENCIA"
  | "ENTIDADE"
  | "VALOR_SOLICITADO"
  | "OUTRO";

export interface Diferenca {
  tipo: TipoDeAlteracao;
  /** O rótulo que a tela mostra — o cabeçalho da fonte, quando há um. */
  campo: string;
  antes: string | null;
  depois: string | null;
}

/** Vazio e ausente são a mesma coisa; espaço em volta não é alteração. */
function normalizar(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

const CAMPOS_COMPARADOS: {
  tipo: TipoDeAlteracao;
  campo: string;
  ler: (r: RetratoDoChamado) => string | null;
}[] = [
  { tipo: "STATUS", campo: "Status", ler: (r) => r.statusRaw },
  {
    tipo: "ENCERRAMENTO",
    campo: "Data Aprovação",
    ler: (r) => r.encerradoEm?.toISOString().slice(0, 10) ?? null,
  },
  { tipo: "PRAZO", campo: "Previsão Análise", ler: (r) => r.prazoPrevisto },
  { tipo: "RESPONSAVEL", campo: "Aprovador", ler: (r) => r.responsavel },
  { tipo: "SOLICITANTE", campo: "Solicitante", ler: (r) => r.solicitante },
  { tipo: "UNIDADE", campo: "Unidade", ler: (r) => r.unidade },
  { tipo: "AREA", campo: "Segmento", ler: (r) => r.area },
  { tipo: "CATEGORIA", campo: "Categoria", ler: (r) => r.categoria },
  { tipo: "VIGENCIA", campo: "Vig. Abertura", ler: (r) => r.vigencia },
  { tipo: "ENTIDADE", campo: "Item", ler: (r) => r.entidade },
  { tipo: "OUTRO", campo: "Justificativa Abertura", ler: (r) => r.assunto },
];

/**
 * O que mudou entre dois retratos do mesmo chamado.
 *
 * Um campo que sai de preenchido para vazio **é** uma diferença, e aparece com
 * `depois: null`: a tela mostra "Aprovador: Maria → —". Some-lo com "nada
 * mudou" esconderia justamente a remoção de um responsável.
 */
export function compararRetratos(
  antes: RetratoDoChamado,
  depois: RetratoDoChamado,
): Diferenca[] {
  const difs: Diferenca[] = [];

  for (const { tipo, campo, ler } of CAMPOS_COMPARADOS) {
    const a = normalizar(ler(antes));
    const b = normalizar(ler(depois));
    if (a !== b) difs.push({ tipo, campo, antes: a, depois: b });
  }

  /*
    Os valores de parâmetro entram como mais um campo comparado, e não como a
    unidade da tela — ver a armadilha 3 no cabeçalho. Um parâmetro que aparece
    num envio e não existia no anterior é uma diferença de `null` para o valor;
    um que some é o contrário.
  */
  const parametros = new Set([...antes.valores.keys(), ...depois.valores.keys()]);
  for (const campo of [...parametros].sort()) {
    const a = normalizar(antes.valores.get(campo) ?? null);
    const b = normalizar(depois.valores.get(campo) ?? null);
    if (a !== b) difs.push({ tipo: "VALOR_SOLICITADO", campo, antes: a, depois: b });
  }

  return difs;
}

export type ClasseDaMovimentacao = "NOVO" | "ALTERADO" | "ENCERRADO" | "REMOVIDO";

/**
 * A classe da movimentação — exatamente uma, e as quatro são exaustivas.
 *
 * É o que faz `novos + alterados + encerrados + removidos = movimentações`
 * fechar por construção, em vez de "70 movimentações" conviver com um
 * detalhamento que soma 82.
 *
 * Duas decisões estão aqui:
 *
 * **Encerrar vence alterar.** Um encerramento é uma mudança de status, logo
 * também um "alterado"; contar os dois somaria a mesma movimentação duas vezes.
 * A mudança de prazo que veio junto continua listada entre os campos.
 *
 * **Aparecer vence encerrar.** Um chamado que chega já `ATENDIDO` é NOVO, e não
 * ENCERRADO: ele não foi encerrado *neste dia* — ele apareceu assim. Dizer que
 * encerrou afirmaria uma transição que ninguém observou.
 *
 * `null` quer dizer "não é movimentação": o chamado estava nos dois envios e
 * nada mudou. Uma reimportação sem mudança não enche a fila de ninguém.
 */
export function classificar(
  antes: RetratoDoChamado | null,
  depois: RetratoDoChamado | null,
  difs: Diferenca[],
): ClasseDaMovimentacao | null {
  if (antes === null && depois === null) return null;
  if (antes === null) return "NOVO";
  if (depois === null) return "REMOVIDO";
  if (!eTerminal(antes.statusBucket) && eTerminal(depois.statusBucket)) {
    return "ENCERRADO";
  }
  return difs.length > 0 ? "ALTERADO" : null;
}

// ---------------------------------------------------------------------------
// Desaparecimento: o limiar que separa "sumiu" de "o export saiu truncado"
// ---------------------------------------------------------------------------

/**
 * Quanto um envio pode encolher antes de os desaparecimentos deixarem de ser
 * publicados como movimentação.
 *
 * Um export que sai com o filtro errado, ou truncado, faz milhares de chamados
 * sumirem de uma vez. Publicá-los encheria o dia de pendências que ninguém
 * consegue tratar — e o gestor perderia a tela junto. Acima do limiar os
 * removidos são **contados e não publicados**: o número e o motivo vão para
 * `ticket_import_comparacao.removidos_suprimidos`, porque suprimir em silêncio
 * seria a omissão que este produto recusa em todo o resto.
 *
 * 30% é largo o bastante para um dia de encerramentos em massa passar
 * (encerrado continua na fila; o que some é o que a fonte tirou do export) e
 * estreito o bastante para pegar um arquivo pela metade.
 */
export const LIMIAR_DE_ENCOLHIMENTO = 0.3;

export function encolhimentoSuspeito(naBase: number, noEnvio: number): boolean {
  if (naBase === 0) return false;
  return (naBase - noEnvio) / naBase > LIMIAR_DE_ENCOLHIMENTO;
}

// ---------------------------------------------------------------------------
// Criticidade — derivada por nós, e nunca apresentada como da Ambev
// ---------------------------------------------------------------------------

export type Criticidade = "NORMAL" | "CRITICO";

/**
 * A régua de criticidade.
 *
 * **Nenhuma das 26 colunas do export é prioridade.** Este produto não inventa
 * dado, então a alternativa a esta função seria não ter selo nenhum. A saída é
 * ter a régua, mantê-la curta, e gravar `criticidade_origem = 'DERIVADA'` junto
 * — para que a tela nunca possa dizer "crítico segundo a Ambev".
 *
 * Duas regras, e as duas foram aprovadas explicitamente:
 *
 * - **Atrasado** — há prazo, ele já passou, e o chamado não está encerrado.
 * - **Crítico** — está atrasado, **ou** o prazo foi remarcado duas vezes ou
 *   mais no mesmo dia (o sintoma de um chamado que ninguém consegue fechar).
 *
 * `hoje` é o **dia da movimentação**, e não o relógio de quem lê. Recalcular um
 * dia de agosto em setembro tem de devolver o mesmo resultado que ele teve em
 * agosto — senão a tela repinta o passado toda vez que alguém a abre, e o
 * histórico deixa de ser conferível.
 */
export function criticidadeDoChamado(
  retrato: RetratoDoChamado | null,
  { hoje, remarcacoesDePrazo }: { hoje: string; remarcacoesDePrazo: number },
): { criticidade: Criticidade; motivo: string | null; atrasado: boolean } {
  const encerrado = retrato !== null && eTerminal(retrato.statusBucket);
  const prazo = retrato?.prazoPrevisto ?? null;
  const atrasado = !encerrado && prazo !== null && prazo < hoje;

  if (atrasado) {
    return {
      criticidade: "CRITICO",
      motivo: `Prazo previsto para ${prazo} e o chamado segue em aberto.`,
      atrasado: true,
    };
  }
  if (remarcacoesDePrazo >= 2) {
    return {
      criticidade: "CRITICO",
      motivo: `O prazo foi remarcado ${remarcacoesDePrazo} vezes neste dia.`,
      atrasado: false,
    };
  }
  return { criticidade: "NORMAL", motivo: null, atrasado: false };
}

// ---------------------------------------------------------------------------
// A assinatura — o que decide se uma revisão sobrevive ao recálculo
// ---------------------------------------------------------------------------

/**
 * Tudo o que a movimentação afirma, em ordem determinística.
 *
 * Ver `ticket_movement_day.assinatura`: sem ela, `revisao` subiria a cada
 * recálculo e toda revisão do dia voltaria para a fila a cada arquivo recebido.
 * A ordenação das diferenças é obrigatória — `Map` preserva ordem de inserção,
 * que depende da ordem das linhas do arquivo, e duas leituras do mesmo dado
 * dariam assinaturas diferentes.
 */
export function assinaturaDaMovimentacao(entrada: {
  classe: ClasseDaMovimentacao;
  passos: number;
  criticidade: string;
  atrasado: boolean;
  estadoFinal: Partial<Record<string, string | null>>;
  diferencas: Diferenca[];
}): string {
  const campos = [...entrada.diferencas]
    .map((d) => [d.tipo, d.campo, d.antes ?? "∅", d.depois ?? "∅"].join(""))
    .sort()
    .join("");
  const estado = Object.keys(entrada.estadoFinal)
    .sort()
    .map((k) => `${k}${entrada.estadoFinal[k] ?? "∅"}`)
    .join("");

  return createHash("sha256")
    .update(
      [
        entrada.classe,
        String(entrada.passos),
        entrada.criticidade,
        String(entrada.atrasado),
        estado,
        campos,
      ].join(""),
    )
    .digest("hex");
}

// ---------------------------------------------------------------------------
// A leitura de um envio, do banco
// ---------------------------------------------------------------------------

/** As colunas de `ticket` que o motor lê. Projeção estreita, de propósito. */
const COLUNAS_DO_RETRATO = {
  id: ticketTable.id,
  externalId: ticketTable.externalId,
  sourceRowIndex: ticketTable.sourceRowIndex,
  statusRaw: ticketTable.statusRaw,
  statusBucket: ticketTable.statusBucket,
  unidadeRaw: ticketTable.unidadeRaw,
  segmentoRaw: ticketTable.segmentoRaw,
  aprovadorRaw: ticketTable.aprovadorRaw,
  categoriaRaw: ticketTable.categoriaRaw,
  prazoPrevisto: ticketTable.prazoPrevisto,
  alteradoEmFonte: ticketTable.alteradoEmFonte,
  requestedBy: ticketTable.requestedBy,
  subject: ticketTable.subject,
  entityLabel: ticketTable.entityLabel,
  entityDescription: ticketTable.entityDescription,
  vigenciaLabel: ticketTable.vigenciaLabel,
  openedAt: ticketTable.openedAt,
  closedAt: ticketTable.closedAt,
} as const;

/**
 * O retrato completo de um envio.
 *
 * `payload` **não** é lido: é a linha inteira do arquivo, é a maior coluna da
 * tabela, e o motor não precisa dela. Ler `SELECT *` aqui multiplicaria por dez
 * o custo de cada comparação sem mudar nenhuma resposta.
 */
export async function retratoDoEnvio(
  db: Database,
  ticketImportId: string,
  { porUnidade = false }: { porUnidade?: boolean } = {},
): Promise<Map<string, RetratoDoChamado>> {
  const linhas = await db
    .select(COLUNAS_DO_RETRATO)
    .from(ticketTable)
    .where(eq(ticketTable.ticketImportId, ticketImportId))
    .orderBy(asc(ticketTable.sourceRowIndex));

  const valores = await db
    .select({
      ticketId: ticketChangeTable.ticketId,
      campo: ticketChangeTable.parameterLabel,
      valor: ticketChangeTable.valueAfterRaw,
    })
    .from(ticketChangeTable)
    .where(eq(ticketChangeTable.ticketImportId, ticketImportId));

  const porTicket = new Map<string, { campo: string; valor: string | null }[]>();
  for (const v of valores) {
    porTicket.set(v.ticketId, [
      ...(porTicket.get(v.ticketId) ?? []),
      { campo: v.campo, valor: v.valor },
    ]);
  }

  return retratosDoEnvio(linhas as LinhaDeChamado[], porTicket, { porUnidade });
}

// ---------------------------------------------------------------------------
// O motor
// ---------------------------------------------------------------------------

export interface ResultadoDoProcessamento {
  ticketImportId: string;
  serie: string | null;
  dia: string;
  tipo: "BASELINE" | "DIFF" | "IGNORADO";
  movimentacoesNoDia: number;
  removidosSuprimidos: number;
  motivo: string | null;
}

/**
 * A série de um envio, decidida uma vez e gravada.
 *
 * A coluna `Unidade` das linhas vence o nome do arquivo, e a razão é operação:
 * quem baixa `Chamados_Recife.xlsx` e salva como `chamados (3).xlsx` não mudou
 * a unidade de nada, e uma partição que dependesse do nome teria mudado.
 */
export async function derivarSerieDoEnvio(
  db: Database,
  ticketImportId: string,
): Promise<{ serie: string | null; origem: OrigemDaSerie }> {
  const [envio] = await db
    .select({ filename: ticketImportTable.filename })
    .from(ticketImportTable)
    .where(eq(ticketImportTable.id, ticketImportId));

  const unidades = await db
    .selectDistinct({ unidade: ticketTable.unidadeRaw })
    .from(ticketTable)
    .where(eq(ticketTable.ticketImportId, ticketImportId));

  const nomeadas = unidades
    .map((u) => u.unidade)
    .filter((u): u is string => u !== null && u.trim() !== "");

  if (nomeadas.length === 1) {
    return { serie: nomeadas[0]!.trim(), origem: "ARQUIVO" };
  }
  if (nomeadas.length > 1) {
    return { serie: null, origem: "MISTA" };
  }
  const doNome = envio ? serieDoNomeDoArquivo(envio.filename) : null;
  return doNome !== null
    ? { serie: doNome, origem: "NOME_DO_ARQUIVO" }
    : { serie: null, origem: "INDETERMINADA" };
}

/** Os envios lidos de uma série, do mais antigo para o mais novo. */
async function enviosDaSerie(
  db: Database,
  serie: string | null,
): Promise<{ id: string; receivedAt: Date }[]> {
  return await db
    .select({ id: ticketImportTable.id, receivedAt: ticketImportTable.receivedAt })
    .from(ticketImportTable)
    .where(
      and(
        eq(ticketImportTable.status, "READ"),
        serie === null
          ? isNull(ticketImportTable.serie)
          : eq(ticketImportTable.serie, serie),
      ),
    )
    .orderBy(asc(ticketImportTable.receivedAt), asc(ticketImportTable.id));
}

/**
 * Ler um envio e recalcular o dia dele.
 *
 * É o gatilho que `readTicketImport` dispara ao terminar, e a rota de recálculo
 * chama. Idempotente: rodar duas vezes sobre o mesmo envio dá o mesmo resultado
 * e **não** invalida revisão nenhuma — é para isso que a assinatura existe.
 */
export async function processarEnvioDeChamados(
  db: Database,
  ticketImportId: string,
): Promise<ResultadoDoProcessamento> {
  const [envio] = await db
    .select({
      id: ticketImportTable.id,
      status: ticketImportTable.status,
      receivedAt: ticketImportTable.receivedAt,
      serie: ticketImportTable.serie,
      serieOrigem: ticketImportTable.serieOrigem,
    })
    .from(ticketImportTable)
    .where(eq(ticketImportTable.id, ticketImportId));

  if (!envio) throw new Error(`Envio de chamados ${ticketImportId} não encontrado.`);

  const dia = diaDaOperacao(envio.receivedAt);

  /*
    A série é decidida aqui, e não no importador, por uma razão de dependência:
    `lib/comparison` já importa de `lib/ingest` (`parseVigenciaLabel`), e fazer
    o importador chamar este motor fecharia um ciclo entre os dois pacotes.

    Decidida **uma vez** e gravada: derivá-la a cada consulta faria a partição
    do acervo mudar quando alguém corrigisse uma linha, e movimentações antigas
    passariam a pertencer a outra série sem que nada tivesse acontecido.
  */
  if (envio.serieOrigem === null) {
    const derivada = await derivarSerieDoEnvio(db, ticketImportId);
    await db
      .update(ticketImportTable)
      .set({ serie: derivada.serie, serieOrigem: derivada.origem })
      .where(eq(ticketImportTable.id, ticketImportId));
    envio.serie = derivada.serie;
    envio.serieOrigem = derivada.origem;
  }

  /*
    Só envio lido entra em conta. Um `FAILED`, um `READING` ou uma duplicata
    recusada não descreve a fila de ninguém, e compará-lo publicaria como
    movimentação o que é, na verdade, um arquivo pela metade.
  */
  if (envio.status !== "READ") {
    await gravarComparacao(db, {
      ticketImportId,
      baseImportId: null,
      serie: envio.serie,
      dia,
      tipo: "IGNORADO",
      chamadosNoEnvio: 0,
      chamadosNaBase: 0,
      movimentacoes: 0,
      removidosSuprimidos: 0,
      motivo: `O envio está em ${envio.status}: nada dele entra na contagem do dia.`,
    });
    return {
      ticketImportId,
      serie: envio.serie,
      dia,
      tipo: "IGNORADO",
      movimentacoesNoDia: 0,
      removidosSuprimidos: 0,
      motivo: `O envio está em ${envio.status}.`,
    };
  }

  const serie = envio.serie;
  const anteriores = (await enviosDaSerie(db, serie)).filter(
    (e) => e.receivedAt < envio.receivedAt || (e.receivedAt.getTime() === envio.receivedAt.getTime() && e.id < envio.id),
  );
  const base = anteriores[anteriores.length - 1] ?? null;

  if (base === null) {
    /*
      A primeira importação da série. Ela **não** produz movimentação nenhuma, e
      é a regra que impede a carga histórica de nascer como milhares de
      "chamados novos" a revisar — o primeiro contato de alguém com esta tela.
    */
    const [{ total }] = await db
      .select({ total: sql<number>`count(distinct ${ticketTable.externalId})`.mapWith(Number) })
      .from(ticketTable)
      .where(eq(ticketTable.ticketImportId, ticketImportId));

    await gravarComparacao(db, {
      ticketImportId,
      baseImportId: null,
      serie,
      dia,
      tipo: "BASELINE",
      chamadosNoEnvio: total ?? 0,
      chamadosNaBase: 0,
      movimentacoes: 0,
      removidosSuprimidos: 0,
      motivo:
        `Primeira importação desta série: ${total ?? 0} chamados registrados como ` +
        `estado inicial. O monitoramento começa na próxima importação.`,
    });
    await recalcularDia(db, serie, dia);
    return {
      ticketImportId,
      serie,
      dia,
      tipo: "BASELINE",
      movimentacoesNoDia: 0,
      removidosSuprimidos: 0,
      motivo: null,
    };
  }

  const porUnidade = envio.serieOrigem === "MISTA";
  const retratoBase = await retratoDoEnvio(db, base.id, { porUnidade });
  const retratoNovo = await retratoDoEnvio(db, ticketImportId, { porUnidade });
  const suprimir = encolhimentoSuspeito(retratoBase.size, retratoNovo.size);

  await gravarComparacao(db, {
    ticketImportId,
    baseImportId: base.id,
    serie,
    dia,
    tipo: "DIFF",
    chamadosNoEnvio: retratoNovo.size,
    chamadosNaBase: retratoBase.size,
    movimentacoes: 0, // preenchido por `recalcularDia`
    removidosSuprimidos: 0,
    motivo: suprimir
      ? `O envio tem ${retratoNovo.size} chamados contra ${retratoBase.size} do anterior — ` +
        `uma queda acima de ${Math.round(LIMIAR_DE_ENCOLHIMENTO * 100)}%. Os desaparecimentos ` +
        `foram contados e não publicados: um export truncado não é um dia de encerramentos.`
      : null,
  });

  const resumo = await recalcularDia(db, serie, dia);
  return {
    ticketImportId,
    serie,
    dia,
    tipo: "DIFF",
    movimentacoesNoDia: resumo.movimentacoes,
    removidosSuprimidos: resumo.removidosSuprimidos,
    motivo: null,
  };
}

async function gravarComparacao(
  db: Database,
  valores: typeof ticketImportComparacaoTable.$inferInsert,
): Promise<void> {
  await db
    .insert(ticketImportComparacaoTable)
    .values(valores)
    .onConflictDoUpdate({
      target: ticketImportComparacaoTable.ticketImportId,
      set: {
        baseImportId: valores.baseImportId ?? null,
        serie: valores.serie ?? null,
        dia: valores.dia,
        tipo: valores.tipo,
        chamadosNoEnvio: valores.chamadosNoEnvio ?? 0,
        chamadosNaBase: valores.chamadosNaBase ?? 0,
        movimentacoes: valores.movimentacoes ?? 0,
        removidosSuprimidos: valores.removidosSuprimidos ?? 0,
        motivo: valores.motivo ?? null,
        calculadaEm: new Date(),
      },
    });
}

/**
 * Recalcular um dia inteiro de uma série.
 *
 * O dia é a unidade do recálculo, e não a comparação, porque o grão da
 * movimentação é o dia: o envio das 17h muda a movimentação que o das 08h
 * criou, e recalcular só a última comparação deixaria a linha da manhã
 * afirmando um "depois" que já não é o final do dia.
 *
 * O consolidado compara **o estado antes do primeiro envio do dia com o estado
 * depois do último** — A→D, e não a soma de A→B, B→C, C→D. Um campo que sai de
 * A e volta a A não aparece como alteração: o saldo do dia é honesto. As idas e
 * voltas ficam nos passos, que é onde elas são verdade.
 */
export async function recalcularDia(
  db: Database,
  serie: string | null,
  dia: string,
): Promise<{ movimentacoes: number; removidosSuprimidos: number }> {
  const comparacoes = await db
    .select()
    .from(ticketImportComparacaoTable)
    .where(
      and(
        eq(ticketImportComparacaoTable.dia, dia),
        serie === null
          ? isNull(ticketImportComparacaoTable.serie)
          : eq(ticketImportComparacaoTable.serie, serie),
        eq(ticketImportComparacaoTable.tipo, "DIFF"),
      ),
    );

  const envios = await enviosDaSerie(db, serie);
  const ordem = new Map(envios.map((e, i) => [e.id, i]));
  const doDia = comparacoes
    .filter((c) => ordem.has(c.ticketImportId))
    .sort((a, b) => ordem.get(a.ticketImportId)! - ordem.get(b.ticketImportId)!);

  // As movimentações do dia são reconstruídas do zero; guardamos as revisões
  // que existiam para decidir, linha a linha, se cada uma sobrevive.
  const anteriores = await db
    .select({
      id: ticketMovementDayTable.id,
      externalId: ticketMovementDayTable.externalId,
      revisao: ticketMovementDayTable.revisao,
      assinatura: ticketMovementDayTable.assinatura,
    })
    .from(ticketMovementDayTable)
    .where(
      and(
        eq(ticketMovementDayTable.dia, dia),
        serie === null
          ? isNull(ticketMovementDayTable.serie)
          : eq(ticketMovementDayTable.serie, serie),
      ),
    );
  const anteriorPorChave = new Map(anteriores.map((m) => [m.externalId, m]));

  if (doDia.length === 0) {
    // Dia só com BASELINE ou só com envios ignorados: não há movimentação, e
    // as que porventura existissem de um cálculo antigo saem.
    if (anteriores.length > 0) {
      await db.delete(ticketMovementDayTable).where(
        inArray(ticketMovementDayTable.id, anteriores.map((m) => m.id)),
      );
    }
    return { movimentacoes: 0, removidosSuprimidos: 0 };
  }

  const primeira = doDia[0]!;
  const ultima = doDia[doDia.length - 1]!;
  const porUnidade = await serieMista(db, serie);

  const estadoInicial = primeira.baseImportId
    ? await retratoDoEnvio(db, primeira.baseImportId, { porUnidade })
    : new Map<string, RetratoDoChamado>();
  const estadoFinal = await retratoDoEnvio(db, ultima.ticketImportId, { porUnidade });

  const suprimirRemovidos = encolhimentoSuspeito(estadoInicial.size, estadoFinal.size);

  /*
    Os passos: uma comparação de cada vez, para guardar a evidência do
    encadeamento e contar remarcações de prazo dentro do dia.
  */
  const passosPorChave = new Map<string, { comparacaoId: string; ocorridoEm: Date; difs: Diferenca[] }[]>();
  const remarcacoesDePrazo = new Map<string, number>();
  let anterior = estadoInicial;
  for (const comparacao of doDia) {
    const alvo =
      comparacao.ticketImportId === ultima.ticketImportId
        ? estadoFinal
        : await retratoDoEnvio(db, comparacao.ticketImportId, { porUnidade });
    const recebidoEm =
      envios.find((e) => e.id === comparacao.ticketImportId)?.receivedAt ??
      comparacao.calculadaEm;

    for (const chave of new Set([...anterior.keys(), ...alvo.keys()])) {
      const a = anterior.get(chave) ?? null;
      const b = alvo.get(chave) ?? null;
      const difs = a && b ? compararRetratos(a, b) : [];
      if (a !== null && b !== null && difs.length === 0) continue;
      if (a === null && b === null) continue;

      passosPorChave.set(chave, [
        ...(passosPorChave.get(chave) ?? []),
        { comparacaoId: comparacao.id, ocorridoEm: recebidoEm, difs },
      ]);
      if (difs.some((d) => d.tipo === "PRAZO")) {
        remarcacoesDePrazo.set(chave, (remarcacoesDePrazo.get(chave) ?? 0) + 1);
      }
    }
    anterior = alvo;
  }

  // O consolidado: A→D, por chamado.
  const movimentacoes: {
    chave: string;
    linha: typeof ticketMovementDayTable.$inferInsert;
    difs: Diferenca[];
    passos: { comparacaoId: string; ocorridoEm: Date; difs: Diferenca[] }[];
  }[] = [];
  let removidosSuprimidos = 0;

  for (const chave of new Set([...estadoInicial.keys(), ...estadoFinal.keys()])) {
    const a = estadoInicial.get(chave) ?? null;
    const b = estadoFinal.get(chave) ?? null;
    const difs = a && b ? compararRetratos(a, b) : [];

    /*
      O chamado que **oscilou e voltou**.

      `Em andamento → Atrasado → Em andamento` no mesmo dia tem saldo zero, e
      `classificar` responde "não é movimentação" — que é a resposta certa sobre
      o *saldo* e a errada sobre o *dia*. Aquele chamado se mexeu duas vezes, e
      sumir com ele da fila esconderia exatamente o tipo de ruído que o gestor
      abre esta tela para pegar: o prazo que foi remarcado e desremarcado, o
      responsável que trocou e voltou.

      Ele entra como ALTERADO com **zero diferenças** e os passos preservados —
      e é esse par (`campos_alterados = 0` com `passos >= 1`) que a tela lê para
      dizer "oscilou e voltou". Não precisa de coluna: a ausência de saldo com
      presença de passos já é a afirmação inteira.
    */
    const passosDoChamado = passosPorChave.get(chave) ?? [];
    const oscilou =
      a !== null &&
      b !== null &&
      difs.length === 0 &&
      passosDoChamado.some((p) => p.difs.length > 0);

    /*
      O chamado que **aparece e some dentro do mesmo dia** (`a` e `b` nulos) sai
      daqui sem virar movimentação, e isso é decisão e não esquecimento: ele não
      está em nenhuma das duas pontas do dia, então não há estado final para a
      linha mostrar nem para a revisão carimbar. Os passos que o registram
      existem e não são gravados — não há movimentação a que prendê-los.

      É raro e é a forma que um export truncado no meio do dia toma. Quando
      acontece em massa, quem o denuncia é o limiar de encolhimento, com o
      número e o motivo no aviso do dia. Tratá-lo aqui exigiria carregar o
      retrato intermediário para dentro do consolidado, que é mais máquina do
      que o caso pede.
    */
    const classe = oscilou ? "ALTERADO" : classificar(a, b, difs);
    if (classe === null) continue;

    if (classe === "REMOVIDO" && suprimirRemovidos) {
      removidosSuprimidos++;
      continue;
    }

    const passos = passosDoChamado;
    const referencia = b ?? a!;
    const { criticidade, motivo, atrasado } = criticidadeDoChamado(b, {
      hoje: dia,
      remarcacoesDePrazo: remarcacoesDePrazo.get(chave) ?? 0,
    });

    const estadoParaAssinatura = {
      status: referencia.statusRaw,
      unidade: referencia.unidade,
      area: referencia.area,
      responsavel: referencia.responsavel,
      solicitante: referencia.solicitante,
      prazo: referencia.prazoPrevisto,
      encerradoEm: referencia.encerradoEm?.toISOString() ?? null,
      assunto: referencia.assunto,
      entidade: referencia.entidade,
    };

    const movidaEm =
      passos[passos.length - 1]?.ocorridoEm ??
      envios.find((e) => e.id === ultima.ticketImportId)?.receivedAt ??
      ultima.calculadaEm;

    movimentacoes.push({
      chave,
      difs,
      passos,
      linha: {
        dia,
        serie,
        externalId: referencia.externalId,
        classe,
        passos: Math.max(passos.length, 1),
        camposAlterados: difs.length,
        primeiroImportId: primeira.baseImportId ?? primeira.ticketImportId,
        ultimoImportId: ultima.ticketImportId,
        ticketIdFinal: b?.ticketId ?? null,
        unidade: referencia.unidade,
        area: referencia.area,
        responsavel: referencia.responsavel,
        solicitante: referencia.solicitante,
        statusRaw: referencia.statusRaw,
        statusBucket: referencia.statusBucket,
        assunto: referencia.assunto,
        entidade: referencia.entidade,
        prazoPrevisto: referencia.prazoPrevisto,
        abertoEm: referencia.abertoEm,
        encerradoEm: referencia.encerradoEm,
        alteradoEmFonte: referencia.alteradoEmFonte,
        criticidade,
        criticidadeMotivo: motivo,
        criticidadeOrigem: "DERIVADA",
        atrasado,
        movidaEm,
        revisao: 1,
        assinatura: assinaturaDaMovimentacao({
          classe,
          passos: Math.max(passos.length, 1),
          criticidade,
          atrasado,
          estadoFinal: estadoParaAssinatura,
          diferencas: difs,
        }),
      },
    });
  }

  /*
    A troca é destrutiva e reconstrutiva de propósito: apagar as movimentações
    do dia e regravá-las é mais simples — e mais fácil de provar correto — do
    que reconciliar linha a linha. O que **não** pode ser perdido é a revisão, e
    é por isso que `revisao` é recalculada a partir da assinatura antiga antes
    do delete, e a tabela de revisões referencia `(movement_id, revisao)`.

    O cascade de `ticket_movement_review` apaga as revisões junto, então elas são
    relidas e regravadas para as movimentações cuja assinatura não mudou.
  */
  const revisoesAnteriores = anteriores.length
    ? await db
        .select()
        .from(ticketMovementReviewTable)
        .where(
          inArray(
            ticketMovementReviewTable.movementId,
            anteriores.map((m) => m.id),
          ),
        )
    : [];
  const revisoesPorMovimento = new Map<string, typeof revisoesAnteriores>();
  for (const r of revisoesAnteriores) {
    revisoesPorMovimento.set(r.movementId, [
      ...(revisoesPorMovimento.get(r.movementId) ?? []),
      r,
    ]);
  }

  for (const m of movimentacoes) {
    const antiga = anteriorPorChave.get(m.linha.externalId as string);
    if (antiga) {
      m.linha.revisao =
        antiga.assinatura === m.linha.assinatura ? antiga.revisao : antiga.revisao + 1;
    }
  }

  if (anteriores.length > 0) {
    await db.delete(ticketMovementDayTable).where(
      inArray(ticketMovementDayTable.id, anteriores.map((m) => m.id)),
    );
  }

  /*
    Gravação em lote, e não linha a linha.

    A primeira versão inseria a movimentação, os campos, os passos e as revisões
    de cada chamado numa ida ao banco por vez: um dia com 5.000 movimentações
    custava mais de 15.000 viagens, e recalcular o dia acontece a **cada
    importação recebida**. O `CHUNK` é o mesmo de `readTicketImport`, pelo mesmo
    motivo — é o tamanho em que o driver ainda monta a instrução sem esforço.

    A volta é indexada por `external_id`, e não pela ordem do `returning`: as
    movimentações deste laço compartilham dia e série, então o número do chamado
    já é a chave única entre elas (`ticket_movement_day_grao_uq`). Depender da
    ordem funcionaria hoje e seria uma aposta sobre o driver.
  */
  const CHUNK = 500;
  const idPorChamado = new Map<string, string>();
  for (let i = 0; i < movimentacoes.length; i += CHUNK) {
    const gravadas = await db
      .insert(ticketMovementDayTable)
      .values(movimentacoes.slice(i, i + CHUNK).map((m) => m.linha))
      .returning({
        id: ticketMovementDayTable.id,
        externalId: ticketMovementDayTable.externalId,
      });
    for (const g of gravadas) idPorChamado.set(g.externalId, g.id);
  }

  const camposParaGravar: (typeof ticketMovementFieldTable.$inferInsert)[] = [];
  const passosParaGravar: (typeof ticketMovementStepTable.$inferInsert)[] = [];
  const revisoesParaGravar: (typeof ticketMovementReviewTable.$inferInsert)[] = [];

  for (const m of movimentacoes) {
    const movementId = idPorChamado.get(m.linha.externalId as string);
    if (!movementId) continue;

    for (const d of m.difs) {
      camposParaGravar.push({
        movementId,
        tipo: d.tipo,
        campo: d.campo,
        valorAntes: d.antes,
        valorDepois: d.depois,
      });
    }

    m.passos.forEach((p, i) => {
      passosParaGravar.push({
        movementId,
        comparacaoId: p.comparacaoId,
        ordem: i + 1,
        ocorridoEm: p.ocorridoEm,
        diferencas: p.difs.map((d) => ({
          tipo: d.tipo,
          campo: d.campo,
          antes: d.antes,
          depois: d.depois,
        })),
      });
    });

    /*
      A revisão volta **só** quando a assinatura sobreviveu — `revisao` não
      subiu. É o que faz recalcular um dia não devolver para a fila o trabalho
      que já foi feito, e o que faz uma movimentação que de fato mudou voltar.
    */
    const antiga = anteriorPorChave.get(m.linha.externalId as string);
    if (antiga && antiga.revisao === m.linha.revisao) {
      for (const r of revisoesPorMovimento.get(antiga.id) ?? []) {
        revisoesParaGravar.push({
          movementId,
          revisao: r.revisao,
          userId: r.userId,
          revisadoPor: r.revisadoPor,
          revisadoEm: r.revisadoEm,
        });
      }
    }
  }

  for (let i = 0; i < camposParaGravar.length; i += CHUNK) {
    await db.insert(ticketMovementFieldTable).values(camposParaGravar.slice(i, i + CHUNK));
  }
  for (let i = 0; i < passosParaGravar.length; i += CHUNK) {
    await db.insert(ticketMovementStepTable).values(passosParaGravar.slice(i, i + CHUNK));
  }
  for (let i = 0; i < revisoesParaGravar.length; i += CHUNK) {
    await db.insert(ticketMovementReviewTable).values(revisoesParaGravar.slice(i, i + CHUNK));
  }

  // A contagem publicada do dia mora na última comparação dele: é ela que a
  // régua lê para dizer "houve envio e nada mudou".
  await db
    .update(ticketImportComparacaoTable)
    .set({ movimentacoes: movimentacoes.length, removidosSuprimidos })
    .where(eq(ticketImportComparacaoTable.id, ultima.id));

  return { movimentacoes: movimentacoes.length, removidosSuprimidos };
}

async function serieMista(db: Database, serie: string | null): Promise<boolean> {
  const [envio] = await db
    .select({ origem: ticketImportTable.serieOrigem })
    .from(ticketImportTable)
    .where(
      and(
        eq(ticketImportTable.status, "READ"),
        serie === null
          ? isNull(ticketImportTable.serie)
          : eq(ticketImportTable.serie, serie),
        eq(ticketImportTable.serieOrigem, "MISTA"),
      ),
    )
    .limit(1);
  return Boolean(envio);
}

/**
 * Recalcular tudo o que dependia de um envio que saiu.
 *
 * Chamado depois de `deleteTicketImport`. O cascade da `0087` já apagou as
 * comparações e as movimentações que apontavam para ele; o que resta é refazer
 * as comparações dos envios que ficaram, porque o anterior de alguém mudou.
 */
export async function recalcularSerie(
  db: Database,
  serie: string | null,
): Promise<{ envios: number; dias: string[] }> {
  const envios = await enviosDaSerie(db, serie);
  const dias = new Set<string>();
  for (const envio of envios) {
    const resultado = await processarEnvioDeChamados(db, envio.id);
    dias.add(resultado.dia);
  }
  return { envios: envios.length, dias: [...dias].sort() };
}
