/**
 * O armazém das conversas — e o portão do dono, num lugar só.
 *
 * **Conversa é privada de quem a criou.** Toda função aqui recebe `ownerId` como
 * primeiro argumento depois do banco, e nenhuma delas tem sobrecarga que o
 * dispense. Uma rota nova que esqueça o dono não compila; era o único jeito de
 * a regra não depender de alguém reler cada rota.
 *
 * **Por que isto não vive dentro das rotas.** Vivia, e a regra só podia ser
 * verificada à mão contra um servidor de pé. Aqui ela é uma função com banco
 * real, e a suíte confere que um segundo usuário não lê, não renomeia, não
 * arquiva e não escreve na conversa do primeiro — que é a única forma de essa
 * promessa sobreviver à próxima rota.
 *
 * **Excluir é arquivar.** `archivedAt` recebe a data e a conversa some da
 * lista; nenhuma linha é apagada. É a mesma regra do Book e das contas: o
 * histórico que sustentou uma decisão de auditoria não se apaga porque alguém
 * arrumou a barra lateral.
 *
 * O compartilhamento entre pessoas não existe hoje e não foi fechado fora: a
 * coluna é `owner_id`, não `user_id`, e todo caminho de leitura passa por
 * `daPessoa()` — o dia em que houver convidado, é ali que ele entra.
 */

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { ehSaudacao } from "@workspace/assistant";
import {
  assistantConversationTable,
  assistantMessageTable,
  type Database,
} from "@workspace/db";

/** O filtro do dono. Toda consulta de conversa passa por aqui. */
function daPessoa(ownerId: string, conversationId?: string) {
  const base = and(
    eq(assistantConversationTable.ownerId, ownerId),
    isNull(assistantConversationTable.archivedAt),
  );
  return conversationId
    ? and(base, eq(assistantConversationTable.id, conversationId))
    : base;
}

/** O nome que se dá a uma conversa que ainda não disse do que trata. */
export const CONVERSA_SEM_ASSUNTO = "Nova conversa";

/**
 * O título de uma conversa — **o assunto dela, não a primeira coisa digitada.**
 *
 * A barra lateral tinha meia dúzia de conversas chamadas "ola", porque o título
 * nascia da primeira pergunta e a primeira pergunta costuma ser um cumprimento.
 * O nome de uma conversa é a única coisa que quem procura por ela vê, e "ola"
 * não distingue nada de nada.
 *
 * A ordem é do mais específico para o menos: o bloco do Book de que se falou, a
 * gaveta que se investigou, e só então a frase digitada. Quando nada disso
 * existe — um "bom dia" solto —, devolve `null`, e quem chama guarda um nome
 * provisório que a próxima pergunta substitui.
 */
export function tituloDe(
  pergunta: string,
  assunto: { bloco?: string | null; parametro?: string | null } = {},
): string | null {
  if (assunto.bloco) return assunto.bloco.slice(0, 200);
  if (assunto.parametro) return assunto.parametro.slice(0, 200);
  if (ehSaudacao(pergunta)) return null;

  const limpo = pergunta.replace(/\s+/g, " ").trim().replace(/[?!.]+$/, "");
  if (limpo.length < 6) return null;
  if (limpo.length <= 60) return limpo;

  const corte = limpo.slice(0, 60);
  const espaco = corte.lastIndexOf(" ");
  return `${corte.slice(0, espaco > 0 ? espaco : 60)}…`;
}

export async function listarConversas(db: Database, ownerId: string) {
  return db
    .select({
      id: assistantConversationTable.id,
      title: assistantConversationTable.title,
      updatedAt: assistantConversationTable.updatedAt,
      createdAt: assistantConversationTable.createdAt,
    })
    .from(assistantConversationTable)
    .where(daPessoa(ownerId))
    .orderBy(desc(assistantConversationTable.updatedAt))
    .limit(100);
}

/** A conversa, se ela for desta pessoa. `null` quando não for — nunca 403. */
export async function acharConversa(db: Database, ownerId: string, id: string) {
  const [conversa] = await db
    .select()
    .from(assistantConversationTable)
    .where(daPessoa(ownerId, id));
  return conversa ?? null;
}

export async function mensagensDaConversa(db: Database, conversationId: string) {
  return db
    .select()
    .from(assistantMessageTable)
    .where(eq(assistantMessageTable.conversationId, conversationId))
    .orderBy(asc(assistantMessageTable.position));
}

export async function renomearConversa(
  db: Database,
  ownerId: string,
  id: string,
  titulo: string,
) {
  const [atualizada] = await db
    .update(assistantConversationTable)
    .set({ title: titulo.slice(0, 200), updatedAt: new Date() })
    .where(daPessoa(ownerId, id))
    .returning();
  return atualizada ?? null;
}

/** Arquiva. Nenhuma linha é apagada, nem a conversa nem as mensagens. */
export async function arquivarConversa(db: Database, ownerId: string, id: string) {
  const [arquivada] = await db
    .update(assistantConversationTable)
    .set({ archivedAt: new Date() })
    .where(daPessoa(ownerId, id))
    .returning({ id: assistantConversationTable.id });
  return arquivada ?? null;
}

export async function criarConversa(
  db: Database,
  ownerId: string,
  titulo: string,
  estado: object,
) {
  const [criada] = await db
    .insert(assistantConversationTable)
    .values({ ownerId, title: titulo, state: estado })
    .returning();
  return criada!;
}

export async function guardarEstado(db: Database, id: string, estado: object) {
  await db
    .update(assistantConversationTable)
    .set({ state: estado, updatedAt: new Date() })
    .where(eq(assistantConversationTable.id, id));
}

/**
 * Grava a pergunta e a resposta como duas linhas consecutivas.
 *
 * A posição vem de `max(position) + 1` lido na hora: é o que mantém a ordem da
 * conversa mesmo se duas abas perguntarem quase junto — a segunda lê a posição
 * depois da primeira ter gravado, e nenhuma das duas sobrescreve a outra.
 */
/**
 * O voto de quem leu, guardado no turno.
 *
 * O filtro do dono passa pela conversa, não pela mensagem: quem vota tem de ser
 * quem perguntou. Sem isso, um id de mensagem adivinhado deixaria qualquer
 * pessoa autenticada escrever no histórico de outra.
 *
 * Votar de novo troca o voto — inclusive para nenhum, que é como se desfaz um
 * clique errado. É a mesma regra de toda opinião: a última vale.
 */
export async function registrarFeedback(
  db: Database,
  ownerId: string,
  conversationId: string,
  messageId: string,
  feedback: "UTIL" | "NAO_UTIL" | null,
  nota?: string | null,
) {
  const conversa = await acharConversa(db, ownerId, conversationId);
  if (!conversa) return null;

  const [linha] = await db
    .update(assistantMessageTable)
    .set({
      feedback,
      feedbackNote: nota ?? null,
      feedbackAt: feedback ? new Date() : null,
    })
    .where(
      and(
        eq(assistantMessageTable.id, messageId),
        eq(assistantMessageTable.conversationId, conversationId),
        eq(assistantMessageTable.role, "RESPOSTA"),
      ),
    )
    .returning({
      id: assistantMessageTable.id,
      feedback: assistantMessageTable.feedback,
    });

  return linha ?? null;
}

export async function gravarTurno(
  db: Database,
  conversationId: string,
  pergunta: string,
  resposta: { texto: string; redacao: string; evidencia: object; rastro?: object | null },
) {
  const [linha] = await db
    .select({
      proxima: sql<number>`coalesce(max(${assistantMessageTable.position}), -1) + 1`.mapWith(
        Number,
      ),
    })
    .from(assistantMessageTable)
    .where(eq(assistantMessageTable.conversationId, conversationId));

  const proxima = linha?.proxima ?? 0;

  const gravadas = await db.insert(assistantMessageTable).values([
    { conversationId, position: proxima, role: "PERGUNTA", content: pergunta },
    {
      conversationId,
      position: proxima + 1,
      role: "RESPOSTA",
      content: resposta.texto,
      writer: resposta.redacao,
      evidence: resposta.evidencia,
      /*
        O rastro entra na mesma escrita que a resposta, e não numa segunda.

        Uma segunda escrita poderia falhar sozinha e deixar a mensagem gravada
        sem rastro — o estado exato que este campo existe para não ter, e o mais
        difícil de notar, porque a conversa continua funcionando.
      */
      trace: resposta.rastro ?? null,
    },
  ]).returning({ id: assistantMessageTable.id, role: assistantMessageTable.role });

  /*
    O id da resposta volta porque a tela precisa dele para votar.

    Sem isto o feedback só existiria depois de recarregar a conversa — e o
    momento em que alguém quer dizer "isto não ajudou" é o momento em que
    acabou de ler.
  */
  return { respostaId: gravadas.find((g) => g.role === "RESPOSTA")?.id ?? null };
}
