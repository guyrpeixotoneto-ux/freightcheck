import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { importRunTable, ticketImportTable } from "@workspace/db";
import { progressoLimpo } from "./progresso";

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
 * `PROMOTING` **entrou** nesta varredura, e a razão é uma mudança de desenho.
 * Enquanto a promoção inteira rodava numa transação — inclusive o UPDATE para
 * PROMOTING —, o processo morrer fazia o rollback devolver o run a PREVIEWED
 * sozinho, e não havia órfã possível. Deixou de ser assim: a aprovação saiu de
 * dentro da requisição, e o estado PROMOTING passa a ser **comitado** antes da
 * transação começar (`reservarPromocao`). O rollback continua desfazendo todo
 * o dado — nada entra pela metade —, mas já não desfaz o estado. Um reinício no
 * meio da gravação deixaria o run dizendo "Importando…" para sempre.
 *
 * Ela é medida por `promocao_em`, e não por `started_at`: aquele é o começo do
 * run, e inclui a leitura e todo o tempo em que o arquivo ficou esperando
 * decisão — num arquivo aprovado três dias depois de enviado, `started_at`
 * declararia órfã uma aprovação que acabou de começar.
 *
 * E o desfecho dela é **PREVIEWED**, não um estado terminal: nada entrou, o
 * arquivo continua conferido, e a aprovação é um clique que pode ser dado de
 * novo. Marcá-la como abortada obrigaria a excluir e reenviar um arquivo que
 * está perfeito.
 */

export const LEITURA_ORFA_MINUTOS = 15;

/**
 * Quanto tempo se espera por uma aprovação antes de tratá-la como órfã.
 *
 * Maior que o da leitura, e muito, porque o trabalho é maior: a leitura de um
 * export real leva pouco mais de dez segundos, e a gravação do mesmo arquivo
 * leva minutos — 75 s para 314 mil fatos, medidos num Postgres local; mais num
 * banco gerenciado. Meia hora é uma folga de uma ordem de grandeza sobre o
 * maior arquivo que já passou por aqui, e continua sendo curta o bastante para
 * ninguém ficar preso a uma tarde.
 */
export const PROMOCAO_ORFA_MINUTOS = 30;

const MOTIVO_IMPORTACAO =
  "O servidor foi reiniciado durante a leitura deste arquivo. Nada do arquivo " +
  "entrou no sistema. Exclua esta importação para liberar o arquivo e reenvie-o.";

const MOTIVO_PROMOCAO =
  "O servidor foi reiniciado enquanto esta importação era gravada. Nada dela " +
  "entrou no sistema — a gravação inteira foi desfeita. O arquivo continua " +
  "conferido: aprove de novo quando quiser.";

const MOTIVO_CHAMADOS =
  "O servidor foi reiniciado durante a leitura deste envio. Exclua o envio " +
  "para liberar o arquivo e reenvie-o.";

export interface RelatorioDeVarredura {
  importacoes: { importRunId: string; status: string }[];
  /**
   * As aprovações que um reinício interrompeu — separadas das leituras porque o
   * desfecho delas é outro: elas voltam a PREVIEWED, prontas para um clique, em
   * vez de terminarem abortadas.
   */
  promocoes: { importRunId: string; status: string }[];
  chamados: { ticketImportId: string; status: string }[];
}

/** Marca como terminal toda leitura órfã — e devolve quem foi, para o log. */
export async function varrerLeiturasOrfas(
  db: Database,
  limiteMinutos: number = LEITURA_ORFA_MINUTOS,
  limiteDaPromocao: number = PROMOCAO_ORFA_MINUTOS,
): Promise<RelatorioDeVarredura> {
  const corte = new Date(Date.now() - limiteMinutos * 60_000);
  const corteDaPromocao = new Date(Date.now() - limiteDaPromocao * 60_000);

  const importacoes = await db
    .update(importRunTable)
    .set({
      status: "ABORTED",
      failureReason: MOTIVO_IMPORTACAO,
      finishedAt: sql`now()`,
      // O processo que media morreu com o reinício: o que ele deixou escrito
      // é a foto de um trabalho que não continua. Apagá-la é o que impede a
      // coluna de descrever um andamento que não existe mais.
      ...progressoLimpo(),
    })
    .where(
      and(
        inArray(importRunTable.status, ["PENDING", "READING", "STAGED"]),
        lt(importRunTable.startedAt, corte),
      ),
    )
    .returning({ importRunId: importRunTable.id, status: importRunTable.status });

  /*
    A aprovação que ficou sem quem a terminasse.

    Volta a PREVIEWED — o estado de onde ela saiu — porque é a verdade: a
    transação inteira voltou atrás, nada entrou, e o arquivo continua conferido.
    O `promocao_em` nulo junto é o que impede a varredura seguinte de contar de
    novo o mesmo run, e o que faz a coluna descrever só aprovações vivas.
  */
  const promocoes = await db
    .update(importRunTable)
    .set({
      status: "PREVIEWED",
      failureReason: MOTIVO_PROMOCAO,
      promocaoEm: null,
      ...progressoLimpo(),
    })
    .where(
      and(
        eq(importRunTable.status, "PROMOTING"),
        isNotNull(importRunTable.promocaoEm),
        lt(importRunTable.promocaoEm, corteDaPromocao),
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

  return { importacoes, promocoes, chamados };
}
