import { unlinkSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { LEITURA_TRAVADA_MINUTOS } from "./deletion";
import { isInsideImportStorage } from "./storage";

/**
 * Excluir um envio de chamados — e tudo o que ele, e só ele, produziu.
 *
 * O desfazer da importação de vigência existe desde a `0010`; deste lado não
 * existia nenhum. O caso é o mesmo e igualmente banal — o export de teste, a
 * fila exportada com o filtro errado, o mesmo mês lido duas vezes —, e sem
 * saída ele ficava para sempre: os chamados entravam em toda contagem da aba, e
 * o SHA-256 ainda recusava o arquivo certo quando ele viesse depois com aquele
 * conteúdo, porque o conteúdo "já havia sido lido".
 *
 * **O que "excluir" significa aqui.** As linhas saem do banco. Não é esconder,
 * não é marcar como inativo: uma exclusão que só apagasse da tela deixaria os
 * chamados somando na aba e o arquivo continuando duplicata de si mesmo — a
 * pior das duas coisas, porque pareceria resolvida.
 *
 * **Por que é mais simples que a exclusão de vigência.** Aquela precisa abrir
 * uma porta declarada nas triggers de imutabilidade (`purge_import_run`),
 * decidir quem ficou órfão no canônico e devolver ao ar a revisão que a
 * importação tinha superado. Nada disso existe aqui: um envio de chamados não
 * escreve fato canônico nem vigência, e o que ele produz — `ticket` e
 * `ticket_change` — só ele sustenta. A comparação da aba Planilha não é tocada,
 * que é a mesma separação que as duas abas mantêm na tela.
 *
 * **O que fica.** O registro de que esta exclusão aconteceu
 * (`ticket_import_deletion`), para sempre e sem porta de saída.
 */

/** Quanta coisa uma exclusão tira, por camada. */
export interface TicketImportDeletionCounts {
  /** Chamados — as linhas do arquivo que viraram `ticket`. */
  tickets: number;
  /** Alterações de parâmetro dentro deles — o número que a aba mostra. */
  ticketChanges: number;
  /**
   * Tentativas recusadas como duplicata que saem junto.
   *
   * Não carregam dado nenhum: são o registro de que alguém reenviou o mesmo
   * arquivo e o sistema disse não. Ficariam apontando para um envio que não
   * existe mais, e segurando o arquivo em disco.
   */
  duplicateAttempts: number;
  /** 1 quando o arquivo recebido sai do disco; 0 quando outro envio ainda o usa. */
  storedFile: number;
  /**
   * Movimentações do Monitoramento que este envio sustentava.
   *
   * Saem por cascata (ver a `0087`), e por isso não aparecem no `DELETE`
   * abaixo — mas **aparecem aqui**, porque a pergunta "tem certeza?" só é uma
   * decisão quando diz o que se perde. Um envio do meio da cadeia costuma ser o
   * `ultimo_import_id` de um dia inteiro de movimentações.
   *
   * Elas são derivadas e voltam no recálculo da série (`recalcularSerie`) — a
   * exclusão as tira, não as destrói. O que **não** volta é a revisão: ela é
   * ato humano, e sai junto.
   */
  movimentacoes: number;
  /** Revisões que somem com as movimentações. Estas não se recomputam. */
  revisoes: number;
}

export interface TicketImportDeletionPlan {
  ticketImportId: string;
  filename: string;
  contentSha256: string;
  status: string;
  receivedAt: Date | null;
  /**
   * A série do envio — devolvida para que quem exclui saiba **o que recalcular**.
   *
   * Tirar um envio do meio de uma cadeia muda o "anterior" de quem ficou, e as
   * comparações seguintes passam a estar erradas. Quem chama é responsável por
   * `recalcularSerie` depois; esta é a única informação que ele precisa e que
   * deixa de existir no instante em que a linha sai.
   */
  serie: string | null;
  /** Por que não dá para excluir agora — null quando dá. */
  refusal: string | null;
  removes: TicketImportDeletionCounts;
}

export interface TicketImportDeletionResult extends TicketImportDeletionPlan {
  refusal: null;
  removed: TicketImportDeletionCounts;
  deletedBy: string;
  reason: string | null;
  deletedAt: Date;
}

export interface DeleteTicketImportOptions {
  /** Quem mandou excluir. Sem isso não há exclusão — nem no schema, nem aqui. */
  deletedBy: string;
  reason?: string | null;
}

/** Erro de regra — a exclusão foi recusada, e a frase é para quem opera. */
export class TicketImportDeletionRefused extends Error {}

/**
 * Um envio que ainda está sendo lido não pode ser apagado por baixo de quem o lê.
 *
 * A leitura roda fora do ciclo da requisição (ver `readInBackground` na API):
 * apagar os chamados enquanto ela insere deixaria a transação dela morrer pela
 * metade, e o motivo apareceria como violação de chave estrangeira em vez de
 * como o que é.
 *
 * **Mas esperar não pode ser para sempre.** Quem lia era o servidor, e um
 * deploy no meio da leitura leva junto quem terminaria o trabalho: o envio fica
 * em READING sem ninguém por trás. Segurar a exclusão desse envio seria
 * transformar um reinício em sujeira permanente — passado o prazo, ele é
 * tratado pelo que é: parado. É a mesma régua da exclusão de vigência, e por
 * isso a constante é a de lá.
 */
export function porQueNaoDaParaExcluir(
  status: string,
  receivedAt?: Date | string | null,
): string | null {
  if (status !== "PENDING" && status !== "READING") return null;

  const inicio = receivedAt ? new Date(receivedAt).getTime() : Date.now();
  const minutos = (Date.now() - inicio) / 60_000;
  if (Number.isFinite(minutos) && minutos >= LEITURA_TRAVADA_MINUTOS) {
    return null;
  }

  return "Este envio ainda está sendo lido. Espere o resumo aparecer para poder excluí-lo.";
}

interface EnvioRow extends Record<string, unknown> {
  id: string;
  filename: string;
  content_sha256: string;
  status: string;
  storage_path: string | null;
  received_at: Date | null;
  serie: string | null;
}

async function carregarEnvio(
  db: Database,
  ticketImportId: string,
): Promise<EnvioRow | null> {
  const { rows } = await db.execute<EnvioRow>(sql`
    SELECT id, filename, content_sha256, status::text AS status,
           storage_path, received_at, serie
      FROM ticket_import
     WHERE id = ${ticketImportId}::uuid`);
  return rows[0] ?? null;
}

async function contar(db: Database, query: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await db.execute<{ n: string }>(query);
  return Number(rows[0]?.n ?? 0);
}

/**
 * As tentativas recusadas como duplicata deste mesmo conteúdo.
 *
 * Elas só saem quando nenhum **outro** envio lido sustenta aquele conteúdo: com
 * dois envios do mesmo arquivo (o que só acontece com reprocessamento pedido),
 * as recusas pertencem ao que fica. Escrito uma vez só porque a prévia e a
 * exclusão precisam responder a mesma coisa.
 */
const duplicatasOrfas = (ticketImportId: string, sha256: string) => sql`
  SELECT ti.id
    FROM ticket_import ti
   WHERE ti.content_sha256 = ${sha256}
     AND ti.id <> ${ticketImportId}::uuid
     AND ti.status = 'SKIPPED_DUPLICATE'
     AND NOT EXISTS (SELECT 1 FROM ticket t WHERE t.ticket_import_id = ti.id)
     AND NOT EXISTS (
           SELECT 1 FROM ticket_import outro
            WHERE outro.content_sha256 = ${sha256}
              AND outro.id <> ${ticketImportId}::uuid
              AND outro.status <> 'SKIPPED_DUPLICATE'
         )`;

/**
 * O que sairia, sem tirar nada — a frase que a tela mostra antes de perguntar.
 *
 * Contar antes é o que permite a pergunta ser específica: "isto apaga 1.218
 * alterações em 1.218 chamados" é uma decisão que dá para tomar; "tem certeza?"
 * não é. É a mesma conta que a exclusão vai fazer, e por isso ela mora aqui.
 */
export async function planTicketImportDeletion(
  db: Database,
  ticketImportId: string,
): Promise<TicketImportDeletionPlan | null> {
  const envio = await carregarEnvio(db, ticketImportId);
  if (!envio) return null;

  const [
    tickets,
    ticketChanges,
    duplicateAttempts,
    arquivoCompartilhado,
    movimentacoes,
    revisoes,
  ] = await Promise.all([
      contar(
        db,
        sql`SELECT count(*) AS n FROM ticket WHERE ticket_import_id = ${ticketImportId}::uuid`,
      ),
      contar(
        db,
        sql`SELECT count(*) AS n FROM ticket_change WHERE ticket_import_id = ${ticketImportId}::uuid`,
      ),
      contar(
        db,
        sql`SELECT count(*) AS n FROM ticket_import ti
             WHERE ti.id IN (${duplicatasOrfas(ticketImportId, envio.content_sha256)})`,
      ),
      // O arquivo em disco é compartilhado com as tentativas recusadas: o nome
      // dele é o próprio sha256. Ele só sai quando nenhum envio que fica ainda
      // o aponta.
      contar(
        db,
        sql`SELECT count(*) AS n FROM ticket_import ti
             WHERE ti.storage_path = ${envio.storage_path}
               AND ti.id <> ${ticketImportId}::uuid
               AND ti.id NOT IN (${duplicatasOrfas(ticketImportId, envio.content_sha256)})`,
      ),
      // Movimentação sustentada por este envio em qualquer uma das duas pontas:
      // ele pode ser o estado inicial de um dia ou o final dele, e sair leva as
      // duas famílias junto pela cascata da `0087`.
      contar(
        db,
        sql`SELECT count(*) AS n FROM ticket_movement_day
             WHERE primeiro_import_id = ${ticketImportId}::uuid
                OR ultimo_import_id = ${ticketImportId}::uuid`,
      ),
      contar(
        db,
        sql`SELECT count(*) AS n FROM ticket_movement_review r
             JOIN ticket_movement_day m ON m.id = r.movement_id
            WHERE m.primeiro_import_id = ${ticketImportId}::uuid
               OR m.ultimo_import_id = ${ticketImportId}::uuid`,
      ),
    ]);

  return {
    ticketImportId,
    filename: envio.filename,
    contentSha256: envio.content_sha256,
    status: envio.status,
    receivedAt: envio.received_at,
    serie: envio.serie ?? null,
    refusal: porQueNaoDaParaExcluir(envio.status, envio.received_at),
    removes: {
      tickets,
      ticketChanges,
      duplicateAttempts,
      storedFile:
        envio.storage_path && arquivoCompartilhado === 0 ? 1 : 0,
      movimentacoes,
      revisoes,
    },
  };
}

/**
 * Apaga o envio e tudo o que só ele sustentava, numa transação.
 *
 * A ordem é a das chaves estrangeiras, de fora para dentro: `ticket_change`
 * aponta para `ticket`, que aponta para `ticket_import`. Errar essa ordem não
 * corrompe nada — o banco recusa e a transação inteira volta atrás —, mas
 * acertar é o que faz a operação ser uma só.
 */
export async function deleteTicketImport(
  db: Database,
  ticketImportId: string,
  options: DeleteTicketImportOptions,
): Promise<TicketImportDeletionResult> {
  const plano = await planTicketImportDeletion(db, ticketImportId);
  if (!plano) throw new TicketImportDeletionRefused("Envio não encontrado.");
  if (plano.refusal) throw new TicketImportDeletionRefused(plano.refusal);

  const envio = (await carregarEnvio(db, ticketImportId))!;

  await db.transaction(async (tx) => {
    // Quem sai junto é decidido enquanto o envio ainda existe: depois do DELETE
    // abaixo não há mais como perguntar quais recusas eram deste conteúdo.
    const { rows: duplicatas } = await tx.execute<{
      id: string;
      filename: string;
      status: string;
      received_at: Date | null;
    }>(sql`
      SELECT ti.id, ti.filename, ti.status::text AS status, ti.received_at
        FROM ticket_import ti
       WHERE ti.id IN (${duplicatasOrfas(ticketImportId, envio.content_sha256)})`);

    await tx.execute(
      sql`DELETE FROM ticket_change WHERE ticket_import_id = ${ticketImportId}::uuid`,
    );
    await tx.execute(
      sql`DELETE FROM ticket WHERE ticket_import_id = ${ticketImportId}::uuid`,
    );
    await tx.execute(
      sql`DELETE FROM ticket_import WHERE id = ${ticketImportId}::uuid`,
    );

    // A auditoria não se perde: cada recusa vira uma linha em
    // `ticket_import_deletion`, que é append-only e permanente.
    for (const duplicata of duplicatas) {
      await tx.execute(sql`
        INSERT INTO ticket_import_deletion
          (ticket_import_id, filename, content_sha256, import_status, received_at,
           removed, deleted_by, reason)
        VALUES (
          ${duplicata.id}::uuid, ${duplicata.filename}, ${envio.content_sha256},
          ${duplicata.status}, ${duplicata.received_at},
          '{}'::jsonb, ${options.deletedBy},
          ${`Tentativa recusada como duplicata do mesmo arquivo; saiu junto com o envio ${ticketImportId}.`}
        )`);
      await tx.execute(
        sql`DELETE FROM ticket_import WHERE id = ${duplicata.id}::uuid`,
      );
    }

    await tx.execute(sql`
      INSERT INTO ticket_import_deletion
        (ticket_import_id, filename, content_sha256, import_status, received_at,
         removed, deleted_by, reason)
      VALUES (
        ${ticketImportId}::uuid,
        ${envio.filename},
        ${envio.content_sha256},
        ${envio.status},
        ${envio.received_at},
        ${JSON.stringify(plano.removes)}::jsonb,
        ${options.deletedBy},
        ${options.reason ?? null}
      )`);
  });

  // Fora da transação, e de propósito: o arquivo em disco é melhor esforço, e
  // um `unlink` que falhe não é motivo para desfazer uma exclusão que o banco
  // já aceitou. Depois da leitura a evidência real é `payload`, guardado linha
  // a linha — e o disco desta plataforma não sobrevive a um deploy.
  if (plano.removes.storedFile > 0 && envio.storage_path) {
    removerArquivo(envio.storage_path);
  }

  return {
    ...plano,
    refusal: null,
    removed: plano.removes,
    deletedBy: options.deletedBy,
    reason: options.reason ?? null,
    deletedAt: new Date(),
  };
}

/**
 * Só sai o que este produto recebeu.
 *
 * Um arquivo que veio de outro caminho — o export de um teste, um caminho
 * passado à mão — é de outra pessoa, e apagá-lo seria consequência que ninguém
 * pediu ao excluir um envio.
 */
function removerArquivo(storagePath: string): void {
  if (!isInsideImportStorage(storagePath)) return;
  try {
    unlinkSync(storagePath);
  } catch {
    // Já não existia, ou o diretório é de outro processo. Nada a fazer.
  }
}

/** O histórico das exclusões, para a tela e para quem auditar. */
export interface TicketImportDeletionRecord {
  ticketImportId: string;
  filename: string;
  contentSha256: string;
  importStatus: string;
  removed: Record<string, number>;
  deletedBy: string;
  reason: string | null;
  deletedAt: Date;
}

export async function listTicketImportDeletions(
  db: Database,
): Promise<TicketImportDeletionRecord[]> {
  const { rows } = await db.execute<{
    ticket_import_id: string;
    filename: string;
    content_sha256: string;
    import_status: string;
    removed: Record<string, number>;
    deleted_by: string;
    reason: string | null;
    deleted_at: Date;
  }>(sql`
    SELECT ticket_import_id, filename, content_sha256, import_status,
           removed, deleted_by, reason, deleted_at
      FROM ticket_import_deletion
     ORDER BY deleted_at DESC`);

  return rows.map((r) => ({
    ticketImportId: r.ticket_import_id,
    filename: r.filename,
    contentSha256: r.content_sha256,
    importStatus: r.import_status,
    removed: r.removed ?? {},
    deletedBy: r.deleted_by,
    reason: r.reason,
    deletedAt: r.deleted_at,
  }));
}
