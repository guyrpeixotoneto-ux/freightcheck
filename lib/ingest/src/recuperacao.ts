import { and, inArray, lt, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { importRunTable, ticketImportTable } from "@workspace/db";

/**
 * A varredura que devolve a saída a quem ficou preso atrás de um reinício.
 *
 * A leitura de um arquivo roda fora do ciclo da requisição (`readInBackground`)
 * e o processo que a executa é o servidor: um deploy, um OOM ou um reap do
 * autoscale no meio dela leva junto quem terminaria o trabalho. O catch que
 * marcaria FAILED morre com o processo, e o run fica em PENDING/READING para
 * sempre — comprovado em auditoria: a tela consulta um estado que não muda, o
 * reenvio do mesmo arquivo é recusado como duplicata e a exclusão responde
 * "ainda está sendo lida". Um beco sem saída que só um desenvolvedor abria.
 *
 * Esta varredura roda na partida e a cada poucos minutos, e move para o estado
 * terminal (`ABORTED`; `FAILED` nos chamados, cujo enum é curto de propósito)
 * todo run de leitura mais velho que o limite — com o motivo escrito para quem
 * opera, dizendo o que fazer. O estado `ABORTED` existia no enum desde a 0000 e
 * nada o escrevia; agora ele significa exatamente isto.
 *
 * **O limite é maior que qualquer leitura legítima e menor que a paciência de
 * alguém preso.** O maior arquivo real lê em ~10 s; quinze minutos é folga de
 * duas ordens de grandeza — e fica abaixo dos 30 min a partir dos quais a
 * exclusão já liberava o zumbi (`LEITURA_TRAVADA_MINUTOS`). Num deploy com
 * várias instâncias, uma partida nunca varre a leitura viva de outra: viva,
 * ela tem segundos de idade.
 *
 * `PROMOTING` fica de fora por correção, não por esquecimento: a promoção
 * inteira — inclusive o UPDATE para PROMOTING — roda numa transação; o
 * processo morrer faz o rollback devolver o run a PREVIEWED sozinho.
 */

export const LEITURA_ORFA_MINUTOS = 15;

const MOTIVO_IMPORTACAO =
  "O servidor foi reiniciado durante a leitura deste arquivo. Nada do arquivo " +
  "entrou no sistema. Exclua esta importação para liberar o arquivo e reenvie-o.";

const MOTIVO_CHAMADOS =
  "O servidor foi reiniciado durante a leitura deste envio. Exclua o envio " +
  "para liberar o arquivo e reenvie-o.";

export interface RelatorioDeVarredura {
  importacoes: { importRunId: string; status: string }[];
  chamados: { ticketImportId: string; status: string }[];
}

/** Marca como terminal toda leitura órfã — e devolve quem foi, para o log. */
export async function varrerLeiturasOrfas(
  db: Database,
  limiteMinutos: number = LEITURA_ORFA_MINUTOS,
): Promise<RelatorioDeVarredura> {
  const corte = new Date(Date.now() - limiteMinutos * 60_000);

  const importacoes = await db
    .update(importRunTable)
    .set({
      status: "ABORTED",
      failureReason: MOTIVO_IMPORTACAO,
      finishedAt: sql`now()`,
    })
    .where(
      and(
        inArray(importRunTable.status, ["PENDING", "READING", "STAGED"]),
        lt(importRunTable.startedAt, corte),
      ),
    )
    .returning({ importRunId: importRunTable.id, status: importRunTable.status });

  const chamados = await db
    .update(ticketImportTable)
    .set({
      status: "FAILED",
      failureReason: MOTIVO_CHAMADOS,
      finishedAt: sql`now()`,
    })
    .where(
      and(
        inArray(ticketImportTable.status, ["PENDING", "READING"]),
        lt(ticketImportTable.receivedAt, corte),
      ),
    )
    .returning({
      ticketImportId: ticketImportTable.id,
      status: ticketImportTable.status,
    });

  return { importacoes, chamados };
}
