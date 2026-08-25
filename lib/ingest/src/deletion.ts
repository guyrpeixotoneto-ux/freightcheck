import { unlinkSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { isInsideImportStorage } from "./storage";

/**
 * Excluir uma importação — e tudo o que ela, e só ela, produziu.
 *
 * O resto do pipeline é de mão única de propósito: RAW não se reescreve,
 * vigência fechada não se edita, correção entra como revisão nova. Nada disso
 * ajuda quem importou o arquivo errado. Esse caso existe e é banal — a
 * planilha de teste, o mês repetido, o export que veio truncado —, e enquanto
 * não havia como desfazê-lo o erro ficava no sistema para sempre, somando
 * fatos a vigências reais, com o SHA-256 ainda impedindo que o arquivo certo
 * entrasse depois com aquele conteúdo.
 *
 * **O que "excluir" significa aqui.** Não é esconder, não é marcar como
 * inativo: as linhas saem do banco. Uma exclusão que só apagasse da tela
 * deixaria os fatos entrando em toda soma e o arquivo continuando duplicata
 * de si mesmo — seria a pior das duas coisas, porque pareceria resolvida.
 *
 * **O que sai, e o que fica.** Sai o que só existe por causa desta
 * importação: as células RAW, os fatos, as vigências, as comparações que
 * envolviam essas vigências, e os equipamentos e colunas que ficariam sem
 * nenhum dado. Fica tudo que outra importação também sustenta — um
 * equipamento que aparece em outras vigências continua lá, com o histórico
 * dele intacto. E fica, para sempre, o registro de que esta exclusão
 * aconteceu (`import_deletion`).
 *
 * **O que ela se recusa a fazer.** Não apaga uma importação que outra corrigiu
 * depois: a mais nova sai primeiro, ou a história ficaria com a correção de um
 * dado que não existe mais. E não apaga um run que ainda está sendo lido — mas
 * só enquanto "sendo lido" for verdade: ver `whyCannotDelete`.
 */

/** Quanta coisa uma exclusão tira, por camada. */
export interface ImportDeletionCounts {
  /** Vigências (`snapshot`) que somem. */
  snapshots: number;
  /** Fatos canônicos — o número que aparece nas telas. */
  facts: number;
  /** Comparações que deixam de existir; são recalculáveis. */
  changeSets: number;
  changes: number;
  /** Equipamentos que ficariam sem nenhum fato. */
  entities: number;
  /** Colunas do dicionário que ficariam sem nenhum fato. */
  attributes: number;
  /** Versões de semântica que saem junto com essas colunas. */
  attributeSemantics: number;
  /** A evidência: células, linhas e abas capturadas do arquivo. */
  rawCells: number;
  rawRows: number;
  rawSheets: number;
  stagedFacts: number;
  validationIssues: number;
  columnMappings: number;
  /** O arquivo recebido sai quando nenhuma outra importação o usa. */
  sourceFile: number;
}

export interface ImportDeletionPlan {
  importRunId: string;
  filename: string;
  contentSha256: string;
  status: string;
  receivedAt: Date | null;
  /** Vigências que esta importação escreveu. */
  labels: string[];
  /** Revisões anteriores que voltam a valer quando esta sair. */
  restoredLabels: string[];
  /**
   * Releituras deste arquivo que apontam para esta importação, e que serão
   * reancoradas quando ela sair.
   *
   * Não impede a exclusão — ver {@link releiturasDe} —, mas quem apaga precisa
   * saber que está mexendo numa corrente, e não numa importação solta.
   */
  reprocessamentosReancorados: string[];
  /** Por que não dá para excluir agora — null quando dá. */
  refusal: string | null;
  removes: ImportDeletionCounts;
}

export interface ImportDeletionResult extends ImportDeletionPlan {
  refusal: null;
  removed: ImportDeletionCounts;
  deletedBy: string;
  reason: string | null;
  deletedAt: Date;
}

export interface DeleteImportRunOptions {
  /** Quem mandou excluir. Sem isso não há exclusão — nem no schema, nem aqui. */
  deletedBy: string;
  reason?: string | null;
}

/**
 * Depois disto, um run parado a meio caminho é um zumbi, e não uma leitura.
 *
 * O maior arquivo real leva pouco mais de dez segundos para ser lido inteiro;
 * meia hora é folga de sobra para a máquina mais lenta.
 */
export const LEITURA_TRAVADA_MINUTOS = 30;

/**
 * Um run que ainda está sendo lido não pode ser apagado por baixo de quem o lê.
 *
 * O pipeline roda fora do ciclo da requisição (ver `readInBackground` na API):
 * apagar as abas enquanto ele insere células deixaria a transação dele morrer
 * pela metade, e o motivo apareceria como uma violação de chave estrangeira em
 * vez de como o que é. Esperar alguns segundos é a resposta.
 *
 * **Mas esperar não pode ser para sempre.** O processo que lia é o servidor, e
 * um deploy no meio da leitura leva junto quem terminaria o trabalho: o run
 * fica em READING sem ninguém por trás, e a tela consulta um estado que não vai
 * mudar. Segurar a exclusão desse run seria transformar um reinício em sujeira
 * permanente. Passado o prazo, ele é tratado pelo que é — parado —, e a
 * exclusão é liberada.
 */
export function whyCannotDelete(
  status: string,
  startedAt?: Date | string | null,
): string | null {
  const lendo = ["PENDING", "READING", "STAGED"].includes(status);
  if (!lendo && status !== "PROMOTING") return null;

  const inicio = startedAt ? new Date(startedAt).getTime() : Date.now();
  const minutos = (Date.now() - inicio) / 60_000;
  if (Number.isFinite(minutos) && minutos >= LEITURA_TRAVADA_MINUTOS) {
    return null;
  }

  return lendo
    ? "Esta importação ainda está sendo lida. Espere o resumo aparecer para poder excluí-la."
    : "Esta importação está sendo aprovada neste momento. Espere terminar.";
}

/**
 * Os conjuntos que a exclusão precisa nomear, escritos uma vez só.
 *
 * A prévia e a exclusão fazem a mesma pergunta — "o que sai daqui?" — e a
 * resposta precisa ser a mesma nas duas, ou a tela promete um número e o banco
 * cumpre outro. Por isso os predicados moram aqui, e não copiados em cada
 * consulta.
 */
const runSnapshots = (runId: string) =>
  sql`SELECT id FROM snapshot WHERE import_run_id = ${runId}::uuid`;

const runSheets = (runId: string) =>
  sql`SELECT id FROM raw_sheet WHERE import_run_id = ${runId}::uuid`;

const runRows = (runId: string) =>
  sql`SELECT r.id FROM raw_row r WHERE r.raw_sheet_id IN (${runSheets(runId)})`;

const runChangeSets = (runId: string) => sql`
  SELECT cs.id FROM change_set cs
   WHERE cs.snapshot_a_id IN (${runSnapshots(runId)})
      OR cs.snapshot_b_id IN (${runSnapshots(runId)})`;

/**
 * Equipamentos que ficariam sem nenhum fato.
 *
 * A condição é "não sobra nada", nunca "foi esta importação que o criou": um
 * equipamento visto pela primeira vez aqui, mas que aparece em mais cinco
 * vigências, continua sendo o mesmo ativo e continua com o histórico dele. Sai
 * quem só existia por causa deste arquivo — e quem foi criado por ele sem
 * chegar a receber fato nenhum.
 */
const orphanEntities = (runId: string) => sql`
  SELECT e.id FROM entity e
   WHERE NOT EXISTS (
           SELECT 1 FROM fact f
            WHERE f.entity_id = e.id
              AND f.snapshot_id NOT IN (${runSnapshots(runId)})
         )
     AND NOT EXISTS (
           SELECT 1 FROM change c
            WHERE c.entity_id = e.id
              AND c.change_set_id NOT IN (${runChangeSets(runId)})
         )
     AND (
           e.first_seen_import_run_id = ${runId}::uuid
           OR EXISTS (
                SELECT 1 FROM fact f
                 WHERE f.entity_id = e.id
                   AND f.snapshot_id IN (${runSnapshots(runId)})
              )
         )`;

/**
 * Colunas do dicionário que ficariam sem nenhum dado — e sem nenhuma amarra.
 *
 * Além dos fatos, a condição olha para o que mais aponta para a coluna: o
 * layout de outra vigência, o mapeamento de outra importação, uma alteração já
 * calculada. Enquanto qualquer um desses existir, a coluna fica: apagá-la
 * levaria junto a curadoria que alguém confirmou sobre um dado que continua no
 * sistema.
 */
const orphanAttributes = (runId: string) => sql`
  SELECT a.id FROM attribute a
   WHERE NOT EXISTS (
           SELECT 1 FROM fact f
            WHERE f.attribute_id = a.id
              AND f.snapshot_id NOT IN (${runSnapshots(runId)})
         )
     AND NOT EXISTS (
           SELECT 1 FROM snapshot_attribute sa
            WHERE sa.attribute_id = a.id
              AND sa.snapshot_id NOT IN (${runSnapshots(runId)})
         )
     AND NOT EXISTS (
           SELECT 1 FROM column_mapping cm
            WHERE cm.target_attribute_id = a.id
              AND cm.import_run_id <> ${runId}::uuid
         )
     AND NOT EXISTS (
           SELECT 1 FROM change c
            WHERE c.attribute_id = a.id
              AND c.change_set_id NOT IN (${runChangeSets(runId)})
         )
     AND (
           a.first_seen_import_run_id = ${runId}::uuid
           OR EXISTS (
                SELECT 1 FROM fact f
                 WHERE f.attribute_id = a.id
                   AND f.snapshot_id IN (${runSnapshots(runId)})
              )
         )`;

async function count(db: Database, query: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await db.execute<{ n: string }>(query);
  return Number(rows[0]?.n ?? 0);
}

interface RunRow extends Record<string, unknown> {
  id: string;
  status: string;
  started_at: Date;
  source_file_id: string;
  filename: string;
  content_sha256: string;
  storage_path: string;
  received_at: Date | null;
}

async function loadRun(db: Database, runId: string): Promise<RunRow | null> {
  const { rows } = await db.execute<RunRow>(sql`
    SELECT ir.id,
           ir.status::text AS status,
           ir.started_at,
           ir.source_file_id,
           sf.filename,
           sf.content_sha256,
           sf.storage_path,
           sf.received_at
      FROM import_run ir
      JOIN source_file sf ON sf.id = ir.source_file_id
     WHERE ir.id = ${runId}::uuid`);
  return rows[0] ?? null;
}

/**
 * Uma correção posterior não pode sobreviver ao que ela corrigiu.
 *
 * Se a revisão 2 de uma vigência veio de outro arquivo, apagar o arquivo da
 * revisão 1 deixaria uma correção pendurada num dado que não existe mais — e a
 * tela mostraria "revisão 2" sem ter o que ela substituiu. A ordem é a
 * cronológica: a mais nova primeiro.
 */
async function supersededByLaterRun(
  db: Database,
  runId: string,
): Promise<{ label: string; filename: string }[]> {
  const { rows } = await db.execute<{ label: string; filename: string }>(sql`
    SELECT antigo.source_label AS label, sf.filename
      FROM snapshot antigo
      JOIN snapshot novo ON novo.supersedes_snapshot_id = antigo.id
      JOIN import_run ir ON ir.id = novo.import_run_id
      JOIN source_file sf ON sf.id = ir.source_file_id
     WHERE antigo.import_run_id = ${runId}::uuid
       AND novo.import_run_id <> ${runId}::uuid
     ORDER BY antigo.effective_date`);
  return rows;
}

/**
 * As releituras que apontam para este run — e por que elas **não** o impedem
 * de sair.
 *
 * A primeira versão disto era uma recusa: "esta importação foi reprocessada
 * depois, exclua a releitura primeiro". Parecia a mesma regra da correção de
 * vigência, e é o oposto dela. A correção mais nova depende do dado da antiga;
 * a releitura **substitui** a antiga, e o caso que justifica todo o
 * reprocessamento termina exatamente em apagar a leitura relida: um arquivo que
 * entrou sob o tipo errado é relido com o tipo certo, aprovado, e aí a
 * importação errada — a que gravou vigência na família errada — precisa sair.
 * A recusa proibia o último passo do procedimento que ela deveria servir.
 *
 * O que se faz, então, é o que se faz ao remover um nó de uma corrente:
 * reancorar. Quem apontava para o run que sai passa a apontar para o que ele
 * apontava, e a história continua legível de ponta a ponta. Quando o run que
 * sai é a cabeça da corrente, o ponteiro fica nulo — e a releitura continua
 * sendo uma releitura, porque quem diz isso é `reprocess_reason`, que fica.
 */
async function releiturasDe(
  db: Database,
  runId: string,
): Promise<{ id: string }[]> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT ir.id::text AS id
      FROM import_run ir
     WHERE ir.reprocess_of_run_id = ${runId}::uuid
     ORDER BY ir.started_at`);
  return rows;
}

/**
 * O que sairia, sem tirar nada — a frase que a tela mostra antes de perguntar.
 *
 * Contar antes é o que permite a pergunta ser específica: "isto apaga 41.391
 * fatos e 9 vigências" é uma decisão que dá para tomar; "tem certeza?" não é.
 */
export async function planImportDeletion(
  db: Database,
  importRunId: string,
): Promise<ImportDeletionPlan | null> {
  const run = await loadRun(db, importRunId);
  if (!run) return null;

  const { rows: labelRows } = await db.execute<{ source_label: string }>(sql`
    SELECT source_label FROM snapshot
     WHERE import_run_id = ${importRunId}::uuid
     ORDER BY effective_date`);
  const labels = labelRows.map((r) => r.source_label);

  const { rows: restoredRows } = await db.execute<{ source_label: string }>(sql`
    SELECT anterior.source_label
      FROM snapshot atual
      JOIN snapshot anterior ON anterior.id = atual.supersedes_snapshot_id
     WHERE atual.import_run_id = ${importRunId}::uuid
       AND anterior.status = 'SUPERSEDED'
     ORDER BY anterior.effective_date`);

  const posteriores = await supersededByLaterRun(db, importRunId);
  const releituras = await releiturasDe(db, importRunId);
  const refusal =
    whyCannotDelete(run.status, run.started_at) ??
    (posteriores.length > 0
      ? `A vigência ${posteriores[0].label} desta importação foi corrigida depois por "${posteriores[0].filename}". ` +
        `Exclua a importação mais recente primeiro — ou o sistema ficaria com uma correção sobre um dado que não existe mais.`
      : null);

  const removes: ImportDeletionCounts = {
    snapshots: labels.length,
    facts: await count(
      db,
      sql`SELECT count(*) AS n FROM fact WHERE snapshot_id IN (${runSnapshots(importRunId)})`,
    ),
    changeSets: await count(
      db,
      sql`SELECT count(*) AS n FROM change_set WHERE id IN (${runChangeSets(importRunId)})`,
    ),
    changes: await count(
      db,
      sql`SELECT count(*) AS n FROM change WHERE change_set_id IN (${runChangeSets(importRunId)})`,
    ),
    entities: await count(
      db,
      sql`SELECT count(*) AS n FROM entity WHERE id IN (${orphanEntities(importRunId)})`,
    ),
    attributes: await count(
      db,
      sql`SELECT count(*) AS n FROM attribute WHERE id IN (${orphanAttributes(importRunId)})`,
    ),
    attributeSemantics: await count(
      db,
      sql`SELECT count(*) AS n FROM attribute_semantics
           WHERE attribute_id IN (${orphanAttributes(importRunId)})`,
    ),
    rawCells: await count(
      db,
      sql`SELECT count(*) AS n FROM raw_cell WHERE raw_row_id IN (${runRows(importRunId)})`,
    ),
    rawRows: await count(
      db,
      sql`SELECT count(*) AS n FROM raw_row WHERE raw_sheet_id IN (${runSheets(importRunId)})`,
    ),
    rawSheets: await count(
      db,
      sql`SELECT count(*) AS n FROM raw_sheet WHERE import_run_id = ${importRunId}::uuid`,
    ),
    stagedFacts: await count(
      db,
      sql`SELECT count(*) AS n FROM staged_fact WHERE import_run_id = ${importRunId}::uuid`,
    ),
    validationIssues: await count(
      db,
      sql`SELECT count(*) AS n FROM validation_issue WHERE import_run_id = ${importRunId}::uuid`,
    ),
    columnMappings: await count(
      db,
      sql`SELECT count(*) AS n FROM column_mapping WHERE import_run_id = ${importRunId}::uuid`,
    ),
    // O arquivo recebido é compartilhado: uma tentativa recusada como duplicata
    // aponta para o mesmo `source_file`. Ele só sai quando ninguém mais o usa —
    // e é a saída dele que devolve ao operador o direito de reenviar o arquivo.
    sourceFile: await count(
      db,
      sql`SELECT count(*) AS n FROM source_file sf
           WHERE sf.id = ${run.source_file_id}::uuid
             AND NOT EXISTS (
                   SELECT 1 FROM import_run ir
                    WHERE ir.source_file_id = sf.id
                      AND ir.id <> ${importRunId}::uuid
                 )
             AND NOT EXISTS (
                   SELECT 1 FROM snapshot s
                    WHERE s.source_file_id = sf.id
                      AND s.import_run_id <> ${importRunId}::uuid
                 )`,
    ),
  };

  return {
    importRunId,
    filename: run.filename,
    contentSha256: run.content_sha256,
    status: run.status,
    receivedAt: run.received_at,
    labels,
    restoredLabels: restoredRows.map((r) => r.source_label),
    reprocessamentosReancorados: releituras.map((r) => r.id),
    refusal,
    removes,
  };
}

/** Erro de regra — a exclusão foi recusada, e a frase é para quem opera. */
export class ImportDeletionRefused extends Error {}

/**
 * Apaga a importação e tudo o que só ela sustentava, numa transação.
 *
 * A ordem abaixo é a das chaves estrangeiras, de fora para dentro: o que
 * aponta sai antes do que é apontado. Errar essa ordem não corrompe nada — o
 * banco recusa e a transação inteira volta atrás —, mas acertar é o que faz a
 * operação ser uma só.
 */
export async function deleteImportRun(
  db: Database,
  importRunId: string,
  options: DeleteImportRunOptions,
): Promise<ImportDeletionResult> {
  const plan = await planImportDeletion(db, importRunId);
  if (!plan) throw new ImportDeletionRefused("Importação não encontrada.");
  if (plan.refusal) throw new ImportDeletionRefused(plan.refusal);

  const run = (await loadRun(db, importRunId))!;

  await db.transaction(async (tx) => {
    // A porta das triggers de imutabilidade, aberta só aqui e só até o COMMIT
    // (o `true` é o que a torna local à transação). Sem isto, cada DELETE
    // abaixo em RAW, snapshot ou fact é recusado pelo banco.
    await tx.execute(
      sql`SELECT set_config('freightcheck.purge_import_run', ${importRunId}, true)`,
    );

    // Quem fica sem nada é decidido com o banco ainda inteiro, e pelas mesmas
    // condições da prévia: depois dos DELETEs abaixo já não há como distinguir
    // "ficou sem fato por causa desta importação" de "nunca teve".
    const { rows: entidades } = await tx.execute<{ id: string }>(
      orphanEntities(importRunId),
    );
    const { rows: colunas } = await tx.execute<{ id: string }>(
      orphanAttributes(importRunId),
    );
    const entityIds = entidades.map((e) => e.id);
    const attributeIds = colunas.map((a) => a.id);

    // As revisões que esta importação tinha superado, anotadas enquanto o
    // ponteiro `supersedes_snapshot_id` ainda existe: quem sabe qual vigência
    // volta a valer é a linha que está prestes a sair.
    const { rows: aRestaurar } = await tx.execute<{ id: string }>(sql`
      SELECT anterior.id
        FROM snapshot atual
        JOIN snapshot anterior ON anterior.id = atual.supersedes_snapshot_id
       WHERE atual.import_run_id = ${importRunId}::uuid
         AND anterior.status = 'SUPERSEDED'`);
    const restoreIds = aRestaurar.map((s) => s.id);

    // --- comparação: derivada, e recalculável ------------------------------
    await tx.execute(
      sql`DELETE FROM change WHERE change_set_id IN (${runChangeSets(importRunId)})`,
    );
    await tx.execute(
      sql`DELETE FROM change_set WHERE id IN (${runChangeSets(importRunId)})`,
    );

    // --- semântica: a versão fica, o ponteiro para a evidência não ---------
    // A semântica confirmada por uma pessoa não é da importação; a prova que
    // ela citou, sim. Zerar o ponteiro é o que sobra de honesto quando a
    // vigência que servia de evidência deixa de existir.
    await tx.execute(sql`
      UPDATE attribute_semantics
         SET evidence_snapshot_id = NULL
       WHERE evidence_snapshot_id IN (${runSnapshots(importRunId)})`);

    // --- canônico ----------------------------------------------------------
    await tx.execute(
      sql`DELETE FROM fact WHERE snapshot_id IN (${runSnapshots(importRunId)})`,
    );
    await tx.execute(
      sql`DELETE FROM snapshot_attribute WHERE snapshot_id IN (${runSnapshots(importRunId)})`,
    );
    await tx.execute(
      sql`DELETE FROM snapshot_scope WHERE snapshot_id IN (${runSnapshots(importRunId)})`,
    );
    /* O agregado de cobertura é derivado da vigência e morre com ela. */
    await tx.execute(
      sql`DELETE FROM snapshot_entity_type WHERE snapshot_id IN (${runSnapshots(importRunId)})`,
    );

    // --- staging e apontamentos -------------------------------------------
    await tx.execute(
      sql`DELETE FROM validation_issue WHERE import_run_id = ${importRunId}::uuid`,
    );
    await tx.execute(
      sql`DELETE FROM staged_fact WHERE import_run_id = ${importRunId}::uuid`,
    );
    await tx.execute(
      sql`DELETE FROM column_mapping WHERE import_run_id = ${importRunId}::uuid`,
    );

    // --- o que ficou sem nenhum dado --------------------------------------
    if (entityIds.length > 0) {
      await tx.execute(sql`
        DELETE FROM entity_identifier
         WHERE entity_id IN (${sql.join(entityIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
      await tx.execute(sql`
        DELETE FROM entity
         WHERE id IN (${sql.join(entityIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    }
    if (attributeIds.length > 0) {
      const lista = sql.join(attributeIds.map((id) => sql`${id}::uuid`), sql`, `);
      await tx.execute(sql`DELETE FROM attribute_alias WHERE attribute_id IN (${lista})`);
      await tx.execute(sql`DELETE FROM attribute_semantics WHERE attribute_id IN (${lista})`);
      await tx.execute(sql`DELETE FROM attribute WHERE id IN (${lista})`);
    }

    /*
      A corrente de releituras se fecha por cima do run que sai.

      Não é o mesmo caso dos ponteiros abaixo, que viram NULL: aqueles são
      "onde isto foi visto pela primeira vez", e sem o run não há resposta.
      Aqui há: quem releu o run que sai passa a reler o que **ele** relia, que é
      a leitura anterior da mesma corrente. Só quando o run que sai é a cabeça —
      o recebimento original — é que o ponteiro fica nulo, e aí a releitura
      continua se identificando pelo `reprocess_reason`, que não é tocado.
    */
    await tx.execute(sql`
      UPDATE import_run
         SET reprocess_of_run_id = (
               SELECT saindo.reprocess_of_run_id FROM import_run saindo
                WHERE saindo.id = ${importRunId}::uuid
             )
       WHERE reprocess_of_run_id = ${importRunId}::uuid`);

    // --- o que sobrevive não pode apontar para um run que não existe -------
    for (const stmt of [
      sql`UPDATE attribute SET first_seen_import_run_id = NULL WHERE first_seen_import_run_id = ${importRunId}::uuid`,
      sql`UPDATE attribute_alias SET first_seen_import_run_id = NULL WHERE first_seen_import_run_id = ${importRunId}::uuid`,
      sql`UPDATE entity SET first_seen_import_run_id = NULL WHERE first_seen_import_run_id = ${importRunId}::uuid`,
      sql`UPDATE entity_identifier SET source_import_run_id = NULL WHERE source_import_run_id = ${importRunId}::uuid`,
    ]) {
      await tx.execute(stmt);
    }

    await tx.execute(
      sql`DELETE FROM snapshot WHERE import_run_id = ${importRunId}::uuid`,
    );

    // --- a revisão anterior volta a valer ----------------------------------
    // Depois de a revisão nova sair, e não antes: `snapshot_business_key_live_uq`
    // admite uma única vigência viva por chave de negócio, e é ela que garante
    // que "voltar a valer" nunca signifique duas valendo ao mesmo tempo.
    if (restoreIds.length > 0) {
      await tx.execute(sql`
        UPDATE snapshot
           SET status = 'CLOSED'
         WHERE id IN (${sql.join(restoreIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    }

    // --- RAW: a evidência sai por último, porque tudo apontava para ela ----
    await tx.execute(
      sql`DELETE FROM raw_cell WHERE raw_row_id IN (${runRows(importRunId)})`,
    );
    await tx.execute(
      sql`DELETE FROM raw_row WHERE raw_sheet_id IN (${runSheets(importRunId)})`,
    );
    await tx.execute(
      sql`DELETE FROM raw_sheet WHERE import_run_id = ${importRunId}::uuid`,
    );
    await tx.execute(
      sql`DELETE FROM import_run WHERE id = ${importRunId}::uuid`,
    );

    // As tentativas recusadas por duplicata saem junto.
    //
    // Elas não carregam dado nenhum: são o registro de que alguém reenviou o
    // mesmo arquivo e o sistema disse não. Mas apontam para o mesmo
    // `source_file`, e essa referência sozinha segurava o arquivo no banco. O
    // efeito era o operador ficar preso: enviava o arquivo, reenviava por
    // engano (409), excluía o original — e continuava impedido de importar,
    // porque o registro da recusa mantinha o conteúdo "já recebido". Sair da
    // situação exigia adivinhar que era preciso excluir também a recusa.
    //
    // A auditoria não se perde: cada uma vira uma linha em `import_deletion`,
    // que é append-only e permanente.
    const recusadas = await tx.execute<{ id: string; filename: string; status: string; received_at: string }>(sql`
      SELECT ir.id, sf.filename, ir.status::text AS status, ir.started_at AS received_at
        FROM import_run ir
        JOIN source_file sf ON sf.id = ir.source_file_id
       WHERE ir.source_file_id = ${run.source_file_id}::uuid
         AND ir.status IN ('SKIPPED_DUPLICATE', 'SKIPPED_DUPLICATE_DATA')
         AND NOT EXISTS (SELECT 1 FROM snapshot s WHERE s.import_run_id = ir.id)`);

    for (const recusada of recusadas.rows) {
      await tx.execute(sql`
        INSERT INTO import_deletion
          (import_run_id, filename, content_sha256, run_status, received_at,
           labels, restored_labels, removed, deleted_by, reason)
        VALUES (
          ${recusada.id}::uuid, ${recusada.filename}, ${run.content_sha256},
          ${recusada.status}, ${recusada.received_at},
          '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
          ${options.deletedBy},
          ${`Tentativa recusada como duplicata do mesmo arquivo; saiu junto com a importação ${importRunId}.`}
        )`);
      await tx.execute(sql`DELETE FROM import_run WHERE id = ${recusada.id}::uuid`);
    }

    // O arquivo recebido só sai quando nenhuma outra tentativa o usa — e é a
    // saída dele que libera o mesmo conteúdo para ser reenviado.
    const { rowCount } = await tx.execute(sql`
      DELETE FROM source_file sf
       WHERE sf.id = ${run.source_file_id}::uuid
         AND NOT EXISTS (SELECT 1 FROM import_run ir WHERE ir.source_file_id = sf.id)
         AND NOT EXISTS (SELECT 1 FROM snapshot s WHERE s.source_file_id = sf.id)`);
    const arquivoSaiu = Number(rowCount ?? 0) > 0;

    await tx.execute(sql`
      INSERT INTO import_deletion
        (import_run_id, filename, content_sha256, run_status, received_at,
         labels, restored_labels, removed, deleted_by, reason)
      VALUES (
        ${importRunId}::uuid,
        ${run.filename},
        ${run.content_sha256},
        ${run.status},
        ${run.received_at},
        ${JSON.stringify(plan.labels)}::jsonb,
        ${JSON.stringify(plan.restoredLabels)}::jsonb,
        ${JSON.stringify({ ...plan.removes, sourceFile: arquivoSaiu ? 1 : 0 })}::jsonb,
        ${options.deletedBy},
        ${options.reason ?? null}
      )`);

    if (arquivoSaiu) removeStoredFile(run.storage_path);
  });

  return {
    ...plan,
    refusal: null,
    removed: plan.removes,
    deletedBy: options.deletedBy,
    reason: options.reason ?? null,
    deletedAt: new Date(),
  };
}

/**
 * O arquivo em disco, quando o registro dele já saiu.
 *
 * Melhor esforço, e de propósito: depois da captura a evidência real está em
 * `raw_cell`, e o disco desta plataforma nem sobrevive a um deploy. Um arquivo
 * que não estava mais lá não é motivo para desfazer uma exclusão que o banco
 * já aceitou.
 *
 * Só sai o que este produto recebeu — um arquivo importado de outro caminho é
 * de outra pessoa, e apagá-lo seria consequência que ninguém pediu ao excluir
 * uma importação.
 */
function removeStoredFile(storagePath: string): void {
  if (!isInsideImportStorage(storagePath)) return;
  try {
    unlinkSync(storagePath);
  } catch {
    // Já não existia, ou o diretório é de outro processo. Nada a fazer.
  }
}

/** O histórico das exclusões, para a tela e para quem auditar. */
export interface ImportDeletionRecord {
  importRunId: string;
  filename: string;
  contentSha256: string;
  runStatus: string;
  labels: string[];
  restoredLabels: string[];
  removed: Record<string, number>;
  deletedBy: string;
  reason: string | null;
  deletedAt: Date;
}

export async function listImportDeletions(
  db: Database,
): Promise<ImportDeletionRecord[]> {
  const { rows } = await db.execute<{
    import_run_id: string;
    filename: string;
    content_sha256: string;
    run_status: string;
    labels: string[];
    restored_labels: string[];
    removed: Record<string, number>;
    deleted_by: string;
    reason: string | null;
    deleted_at: Date;
  }>(sql`
    SELECT import_run_id, filename, content_sha256, run_status, labels,
           restored_labels, removed, deleted_by, reason, deleted_at
      FROM import_deletion
     ORDER BY deleted_at DESC`);

  return rows.map((r) => ({
    importRunId: r.import_run_id,
    filename: r.filename,
    contentSha256: r.content_sha256,
    runStatus: r.run_status,
    labels: r.labels ?? [],
    restoredLabels: r.restored_labels ?? [],
    removed: r.removed ?? {},
    deletedBy: r.deleted_by,
    reason: r.reason,
    deletedAt: r.deleted_at,
  }));
}

export interface ImportRunHiddenState {
  importRunId: string;
  hiddenAt: Date | null;
  hiddenBy: string | null;
  hiddenReason: string | null;
}

/**
 * Oculta ou reexibe um run — e todos os fatos de todas as suas vigências —
 * em todo agregado, sem apagar nada. Ver `hidden_at` em `schema/raw.ts` para
 * o porquê de não ser nem exclusão nem revisão.
 *
 * `hidden = false` limpa as três colunas, inclusive `hiddenReason`: quando o
 * run volta a valer, o motivo de tê-lo escondido não é mais um fato sobre o
 * estado atual — se precisar sobreviver, é quem chama que o registra em outro
 * lugar (auditoria de aplicação), não este UPDATE.
 */
export async function setImportRunHidden(
  db: Database,
  importRunId: string,
  hidden: boolean,
  options: { by: string; reason?: string | null },
): Promise<ImportRunHiddenState | null> {
  const { rows } = await db.execute<{
    id: string;
    hidden_at: Date | null;
    hidden_by: string | null;
    hidden_reason: string | null;
  }>(
    hidden
      ? sql`
        UPDATE import_run
           SET hidden_at = now(), hidden_by = ${options.by},
               hidden_reason = ${options.reason ?? null}
         WHERE id = ${importRunId}::uuid
         RETURNING id, hidden_at, hidden_by, hidden_reason`
      : sql`
        UPDATE import_run
           SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL
         WHERE id = ${importRunId}::uuid
         RETURNING id, hidden_at, hidden_by, hidden_reason`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    importRunId: row.id,
    hiddenAt: row.hidden_at,
    hiddenBy: row.hidden_by,
    hiddenReason: row.hidden_reason,
  };
}
