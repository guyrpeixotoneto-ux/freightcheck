import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  importRunTable,
  rawRowTable,
  rawSheetTable,
  snapshotTable,
  sourceFileTable,
  stagedFactTable,
  validationIssueTable,
} from "@workspace/db";
import { impedePromocao, isolaAChave } from "./apontamentos";
import { identidadesPendentes } from "./pipeline";
import { parseVigenciaLabel } from "./vigencia";

/**
 * Import history, read-only.
 *
 * What a person wants to know here is whether a file arrived, what came out of
 * it, and what the pipeline complained about — with the SHA-256 in view,
 * because that is what makes "we already have this file" a fact rather than an
 * opinion.
 *
 * The counters come from `import_run` itself, written by the pipeline as it
 * ran. Recomputing them from RAW would be both slower and less honest: what
 * matters is what that run actually produced, not what a query says today.
 */

export interface ImportRunSummary {
  importRunId: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  triggeredBy: string | null;
  failureReason: string | null;
  filename: string;
  byteSize: number;
  contentSha256: string;
  receivedAt: Date;
  receivedBy: string | null;
  sheets: number;
  rawRows: number;
  rawCells: number;
  stagedFacts: number;
  snapshots: number;
  errors: number;
  warnings: number;
  /** Vigências this run produced, oldest first. */
  labels: string[];
  /**
   * O tipo declarado no envio — a aba da tela em que o arquivo foi escolhido.
   *
   * `null` em toda importação anterior à declaração, e nas que entram por CLI.
   */
  declaredType: string | null;
  /**
   * O que as vigências gravadas por esta importação passaram a cobrir.
   *
   * **Não é** "o que veio neste arquivo" — esse é {@link tiposDoArquivo}. Uma
   * revisão preserva os fatos dos tipos que o arquivo não toca (o arquivo de
   * carreta que entra numa vigência que já tinha cavalos grava uma revisão
   * cobrindo os dois), e o conjunto aqui é o da vigência resultante, herança
   * incluída. A tela que escrever estes tipos como se fossem o conteúdo do
   * arquivo estará afirmando uma coisa com o número da outra — foi exatamente
   * assim que "Cavalo + Carreta" apareceu num arquivo que só trouxe carretas.
   *
   * Vazio quando a importação não produziu vigência nenhuma. Isso não é um
   * detalhe de implementação: é a resposta honesta para o arquivo que entrou e
   * não virou nada, que antes ficava indistinguível de um arquivo cheio.
   */
  entityTypes: string[];
  /**
   * Os tipos que **este arquivo** trouxe — a parte de {@link entityTypes} que
   * não é herança.
   *
   * Lido de `snapshot_entity_type`, onde cada tipo de cada vigência carrega
   * quantos fatos vieram deste arquivo e quantos foram preservados da revisão
   * anterior: um tipo cujos fatos são todos herdados não veio no arquivo.
   *
   * Vazio nas importações que não chegaram a promover vigência (aí só a
   * declaração, quando existe, diz o tipo) — e nas anteriores ao agregado por
   * tipo, se o backfill da migration 0021 não as cobriu.
   */
  tiposDoArquivo: string[];
  /**
   * O run que este releu — nulo em toda importação que é a primeira leitura do
   * seu arquivo.
   *
   * É o que permite a tela separar três coisas que hoje chegam misturadas na
   * mesma lista: o **recebimento**, que é a primeira vez que aquele conteúdo
   * entrou; a **tentativa recusada**, que é o reenvio idêntico barrado pelo
   * SHA-256 sem ler nada; e o **reprocessamento**, que é a releitura deliberada
   * do mesmo arquivo porque o leitor mudou.
   */
  reprocessOfRunId: string | null;
  /** Por que se releu. Sempre presente quando {@link reprocessOfRunId} está. */
  reprocessReason: string | null;
  /**
   * As releituras **deste** run, da mais antiga para a mais nova.
   *
   * A relação escrita nos dois sentidos, e não só no de quem aponta. Sem ela o
   * cartão do recebimento original não teria como dizer "isto foi relido
   * depois" sem varrer a lista inteira — e o detalhe de uma importação, que
   * carrega um run só, não teria como dizer nada.
   */
  reprocessadoPor: string[];
  /**
   * Quantas leituras este mesmo arquivo já teve, contando esta.
   *
   * Sai de `source_file`, não da lista da tela: o detalhe de uma importação
   * precisa saber que não está sozinho mesmo carregando um run só.
   */
  leiturasDoArquivo: number;
}

/**
 * The one shape of "a run, as a person reads it".
 *
 * List and detail answer the same question about a different number of runs,
 * so they select the same columns. Two copies of this projection would drift,
 * and the drift would show up as a card whose numbers change when you open it.
 */
function selectRunSummary(db: Database) {
  return db
    .select({
      importRunId: importRunTable.id,
      status: importRunTable.status,
      startedAt: importRunTable.startedAt,
      finishedAt: importRunTable.finishedAt,
      triggeredBy: importRunTable.triggeredBy,
      failureReason: importRunTable.failureReason,
      sheets: importRunTable.rawSheetCount,
      rawRows: importRunTable.rawRowCount,
      rawCells: importRunTable.rawCellCount,
      stagedFacts: importRunTable.stagedFactCount,
      snapshots: importRunTable.snapshotCount,
      errors: importRunTable.errorCount,
      warnings: importRunTable.warningCount,
      filename: sourceFileTable.filename,
      byteSize: sourceFileTable.byteSize,
      contentSha256: sourceFileTable.contentSha256,
      receivedAt: sourceFileTable.receivedAt,
      receivedBy: sourceFileTable.receivedBy,
      labels: sql<string[]>`
        coalesce(
          array(
            SELECT s.source_label FROM snapshot s
             WHERE s.import_run_id = ${importRunTable.id}
             ORDER BY s.effective_date
          ),
          '{}'
        )`,
      declaredType: importRunTable.declaredType,
      /*
        Os tipos saem de `snapshot.entity_type_set`, que já está sendo lido
        aqui ao lado para os rótulos. A alternativa seria um DISTINCT sobre
        `staged_fact` — dezenas de milhares de linhas por importação, uma vez
        por cartão da lista — para responder a mesma pergunta.
      */
      entityTypes: sql<string[]>`
        coalesce(
          array(
            SELECT DISTINCT btrim(t)
              FROM snapshot s,
                   unnest(string_to_array(s.entity_type_set, '+')) AS t
             WHERE s.import_run_id = ${importRunTable.id}
               AND btrim(t) <> ''
             ORDER BY 1
          ),
          '{}'
        )`,
      /*
        O que veio no arquivo sai de `snapshot_entity_type`, que a promoção
        escreve (e a 0021 preencheu para trás) com a contagem de fatos herdados
        ao lado da total: um tipo com fato além dos herdados veio deste
        arquivo; um tipo só de herança está na vigência, não no arquivo. É a
        mesma razão de custo do campo acima — a alternativa seria um DISTINCT
        sobre `staged_fact`, dezenas de milhares de linhas por cartão.
      */
      tiposDoArquivo: sql<string[]>`
        coalesce(
          array(
            SELECT DISTINCT et.entity_type
              FROM snapshot s
              JOIN snapshot_entity_type et ON et.snapshot_id = s.id
             WHERE s.import_run_id = ${importRunTable.id}
               AND et.fact_count > et.inherited_fact_count
             ORDER BY 1
          ),
          '{}'
        )`,
      reprocessOfRunId: importRunTable.reprocessOfRunId,
      reprocessReason: importRunTable.reprocessReason,
      /*
        A relação lida no sentido contrário — quem releu este run.

        Um `array()` correlacionado e não um JOIN: a lista é quase sempre
        vazia, e um JOIN multiplicaria as linhas do cartão para o caso raro em
        que não é.
      */
      reprocessadoPor: sql<string[]>`
        coalesce(
          array(
            SELECT r.id::text
              FROM import_run r
             WHERE r.reprocess_of_run_id = ${importRunTable.id}
             ORDER BY r.started_at
          ),
          '{}'
        )`,
      leiturasDoArquivo: sql<number>`
        (SELECT count(*)::int FROM import_run r
          WHERE r.source_file_id = ${importRunTable.sourceFileId})`,
    })
    .from(importRunTable)
    .innerJoin(sourceFileTable, eq(sourceFileTable.id, importRunTable.sourceFileId));
}

export async function listImportRuns(db: Database): Promise<ImportRunSummary[]> {
  return selectRunSummary(db).orderBy(desc(importRunTable.startedAt));
}

/** One run, or null when no run carries that id. */
export async function getImportRun(
  db: Database,
  importRunId: string,
): Promise<ImportRunSummary | null> {
  const [run] = await selectRunSummary(db).where(
    eq(importRunTable.id, importRunId),
  );
  return run ?? null;
}

/**
 * What a run has produced so far — the answer to a poll while it is running.
 *
 * `labels` comes from the staged facts, not from `snapshot`: before promotion
 * no snapshot exists, and a screen that read the snapshot count would show
 * zero vigências for a file that in fact carries nine. After promotion the
 * staged rows are still there, so the same query keeps telling the truth.
 */
export interface ImportRunStatus {
  importRunId: string;
  status: string;
  /** Qual arquivo é este: dois envios de uma vez são dois cartões iguais sem ele. */
  filename: string;
  failureReason: string | null;
  /** O tipo declarado no envio, para o cartão dizer por qual aba ele entrou. */
  declaredType: string | null;
  /**
   * Preenchido quando este run é uma releitura — o cartão em andamento precisa
   * saber, porque "enviado como QLP Administrativo" é falso para um arquivo que
   * ninguém enviou: ele foi relido, e o tipo foi declarado na releitura.
   */
  reprocessOfRunId: string | null;
  sheets: number;
  rawCells: number;
  facts: number;
  snapshots: number;
  /**
   * Todo apontamento de severidade ERRO deste run — o total, e nada além dele.
   *
   * **Não é a resposta a "pode aprovar?".** Foi lido como se fosse, e o preço
   * apareceu na tela: um QLP com 8 chaves em conflito e nenhum impedimento
   * chegava com "Aprovar e importar" desabilitado e a frase "8 erros — corrija
   * a origem antes de aprovar", enquanto o pipeline já tinha classificado o
   * mesmo arquivo como conferido e aprovável. Quem pergunta sobre aprovação lê
   * {@link blockingErrors}; este número continua aqui porque "quantos
   * apontamentos ERRO este run produziu" é uma pergunta legítima do histórico,
   * e é a que ele responde.
   *
   * Vem de `import_run.error_count`, gravado pelo pipeline enquanto rodava — e
   * continua sendo isso. Ajustar o contador do banco para caber na pergunta da
   * tela reescreveria o que aquele run de fato produziu.
   */
  errors: number;
  warnings: number;
  /**
   * Quantos apontamentos impedem aprovar este arquivo — a conta do pipeline.
   *
   * Zero é o caso comum, inclusive num arquivo cheio de ERROs: linha sem placa
   * recusa a linha, chave em conflito retira o registro, e nem uma nem outra
   * impedem o arquivo. Sai do mesmo `impedePromocao` que a pré-visualização usa
   * para decidir entre PREVIEWED e VALIDATION_ERROR, e é por isso que a tela
   * pode confiar nele sem repetir a regra.
   */
  blockingErrors: number;
  /**
   * Quantas chaves já se sabe que **não** vão entrar se este run for aprovado.
   *
   * A duplicidade conflitante retira o registro e deixa o resto do arquivo
   * entrar. Isso é o comportamento certo e cria uma dívida: a vigência nasce
   * incompleta nessas chaves, e um registro que ficou de fora não aparece como
   * faltando — ele simplesmente não aparece. Este número existe para a tela
   * poder dizê-lo **antes** da aprovação, que é quando ainda dá para decidir
   * corrigir a origem em vez de importar incompleto.
   */
  chavesEmQuarentena: number;
  labels: string[];
  /**
   * Equipamentos que esta importação criaria e o dicionário não conhece.
   *
   * Vazio no caso comum. Preenchido, a promoção recusa até serem declarados —
   * a tela precisa saber disso enquanto ainda dá para decidir, e não descobrir
   * pela recusa depois do clique.
   */
  pendingIdentities: string[];
}

export async function getImportRunStatus(
  db: Database,
  importRunId: string,
): Promise<ImportRunStatus | null> {
  const [run] = await db
    .select({
      id: importRunTable.id,
      status: importRunTable.status,
      failureReason: importRunTable.failureReason,
      rawSheetCount: importRunTable.rawSheetCount,
      rawCellCount: importRunTable.rawCellCount,
      stagedFactCount: importRunTable.stagedFactCount,
      snapshotCount: importRunTable.snapshotCount,
      errorCount: importRunTable.errorCount,
      warningCount: importRunTable.warningCount,
      declaredType: importRunTable.declaredType,
      reprocessOfRunId: importRunTable.reprocessOfRunId,
      filename: sourceFileTable.filename,
    })
    .from(importRunTable)
    .innerJoin(sourceFileTable, eq(sourceFileTable.id, importRunTable.sourceFileId))
    .where(eq(importRunTable.id, importRunId));
  if (!run) return null;

  const staged = await db
    .selectDistinct({ label: stagedFactTable.snapshotLabel })
    .from(stagedFactTable)
    .where(eq(stagedFactTable.importRunId, importRunId));

  /*
    As duas contas que decidem a aprovação, feitas sobre os apontamentos.

    Não saem de `import_run`: os contadores gravados lá respondem "quantos
    ERROs" e "quantos avisos", e a pergunta aqui é outra — *quais* apontamentos,
    porque a consequência é do código e não da severidade. Agrupar por código é
    o suficiente (um run tem poucos códigos distintos, muitas ocorrências) e sai
    do índice que já existe — `validation_issue_run_code_idx` —, o que importa
    porque o cartão de upload consulta este estado a cada 1,2 s enquanto o
    arquivo é lido. Os predicados são os do pipeline: se a lista do que bloqueia
    mudar, os dois lados mudam juntos porque leem a mesma função.
  */
  const apontamentos = await db
    .select({
      code: validationIssueTable.code,
      severity: validationIssueTable.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(validationIssueTable)
    .where(eq(validationIssueTable.importRunId, importRunId))
    .groupBy(validationIssueTable.code, validationIssueTable.severity);

  const somar = (linhas: typeof apontamentos) =>
    linhas.reduce((soma, i) => soma + i.count, 0);

  const labels = staged
    .map((row) => row.label)
    // Ordenar por data, e não pelo texto: EMPURRADA_2_12_2025 vem antes de
    // EMPURRADA_2_1_2026 no calendário e depois dele no alfabeto.
    .sort((a, b) =>
      (parseVigenciaLabel(a).effectiveDate ?? a).localeCompare(
        parseVigenciaLabel(b).effectiveDate ?? b,
      ),
    );

  return {
    importRunId: run.id,
    status: run.status,
    filename: run.filename,
    failureReason: run.failureReason,
    declaredType: run.declaredType,
    reprocessOfRunId: run.reprocessOfRunId,
    sheets: run.rawSheetCount,
    rawCells: run.rawCellCount,
    facts: run.stagedFactCount,
    snapshots: run.snapshotCount,
    errors: run.errorCount,
    warnings: run.warningCount,
    blockingErrors: somar(apontamentos.filter(impedePromocao)),
    chavesEmQuarentena: somar(apontamentos.filter(isolaAChave)),
    labels,
    pendingIdentities: await identidadesPendentes(db, importRunId),
  };
}

/** Sheets of one run, with the reason each was or was not treated as a source. */
export async function getImportRunSheets(db: Database, importRunId: string) {
  return db
    .select({
      sheetName: rawSheetTable.sheetName,
      role: rawSheetTable.role,
      roleReason: rawSheetTable.roleReason,
      rowCount: rawSheetTable.rowCount,
      columnCount: rawSheetTable.columnCount,
      headerRowIndex: rawSheetTable.headerRowIndex,
    })
    .from(rawSheetTable)
    .where(eq(rawSheetTable.importRunId, importRunId))
    .orderBy(rawSheetTable.sheetIndex);
}

/** Vigências of one run, for the detail view. */
export async function getImportRunSnapshots(db: Database, importRunId: string) {
  return db
    .select({
      id: snapshotTable.id,
      sourceLabel: snapshotTable.sourceLabel,
      effectiveDate: snapshotTable.effectiveDate,
      entityCount: snapshotTable.entityCount,
      factCount: snapshotTable.factCount,
      status: snapshotTable.status,
      revision: snapshotTable.revision,
    })
    .from(snapshotTable)
    .where(eq(snapshotTable.importRunId, importRunId))
    .orderBy(snapshotTable.effectiveDate);
}

/**
 * Os apontamentos de uma importação, agrupados por código.
 *
 * `validation_issue` já era escrito pelo pipeline desde o começo, e nunca foi
 * lido por tela nenhuma: a interface mostrava a *contagem* de erros e avisos, e
 * o motivo da falha quando havia. Isso responde "deu problema?" e não responde
 * "qual, onde, em que campo" — que é a pergunta de quem precisa decidir se a
 * origem está errada ou se a nossa leitura dela está.
 *
 * A pergunta ficou concreta com o quadro de pessoal: para saber se unidade +
 * cargo (+ turno) separa as linhas da origem, é preciso ver **quais** chaves
 * colidiram e **em que campos** — inclusive as colisões que concordam, que não
 * são erro nenhum e são o sintoma mais cedo de um grão grosso demais.
 *
 * Agrupado por código porque é assim que se lê: 1.300 avisos de um tipo são uma
 * linha com um número, e três colisões de chave são três linhas para abrir. As
 * ocorrências vêm com o `detail` que o pipeline gravou — chave, campos,
 * vigência —, e limitadas por código, porque um arquivo de 40 mil células pode
 * produzir dezenas de milhares de apontamentos e nenhuma tela lê isso.
 */
export interface ImportIssueGroup {
  code: string;
  severity: string;
  /** Quantos apontamentos deste código existem — não quantos vieram abaixo. */
  count: number;
  /** As primeiras ocorrências, com o que o pipeline gravou em cada uma. */
  ocorrencias: {
    message: string;
    detail: unknown;
    sheetName: string | null;
    rowIndex: number | null;
  }[];
}

/** Quantas ocorrências de cada código a leitura devolve. */
export const OCORRENCIAS_POR_CODIGO = 50;

export async function getImportRunIssues(
  db: Database,
  importRunId: string,
): Promise<ImportIssueGroup[]> {
  const contagens = await db
    .select({
      code: validationIssueTable.code,
      severity: validationIssueTable.severity,
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(validationIssueTable)
    .where(eq(validationIssueTable.importRunId, importRunId))
    .groupBy(validationIssueTable.code, validationIssueTable.severity)
    .orderBy(desc(sql`count(*)`));

  const grupos: ImportIssueGroup[] = [];
  for (const grupo of contagens) {
    const ocorrencias = await db
      .select({
        message: validationIssueTable.message,
        detail: validationIssueTable.detail,
        sheetName: rawSheetTable.sheetName,
        rowIndex: rawRowTable.rowIndex,
      })
      .from(validationIssueTable)
      .leftJoin(rawSheetTable, eq(rawSheetTable.id, validationIssueTable.rawSheetId))
      .leftJoin(rawRowTable, eq(rawRowTable.id, validationIssueTable.rawRowId))
      .where(
        and(
          eq(validationIssueTable.importRunId, importRunId),
          eq(validationIssueTable.code, grupo.code),
          eq(validationIssueTable.severity, grupo.severity),
        ),
      )
      .orderBy(validationIssueTable.id)
      .limit(OCORRENCIAS_POR_CODIGO);

    grupos.push({ ...grupo, ocorrencias });
  }

  /*
    A ordem: erro, aviso, informação — e dentro de cada um, o mais numeroso
    primeiro. Quem abre esta lista está procurando o que impede promover antes
    do que apenas anota.
  */
  const peso = (severity: string) =>
    severity === "ERROR" ? 0 : severity === "WARNING" ? 1 : 2;
  return grupos.sort(
    (a, b) => peso(a.severity) - peso(b.severity) || b.count - a.count,
  );
}
