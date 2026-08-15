import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  integer,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appUserTable } from "./auth";

/**
 * ASSISTENTE — as conversas, e o que cada uma sabia sobre si.
 *
 * **Privada de quem criou.** `owner_id` não é auditoria: é o filtro. Toda
 * leitura passa por ele, e não existe caminho no produto que devolva a conversa
 * de outra pessoa. O compartilhamento foi desenhado e não implementado — quando
 * vier, entra como uma tabela de concessão ao lado, e nenhuma linha destas duas
 * precisa mudar. É por isso que não há uma coluna `privada`: um booleano hoje
 * seria uma segunda verdade sobre quem pode ler, e a primeira já está no dono.
 *
 * **Nada é apagado.** Excluir marca `archived_at`, como o Book e como as
 * contas. Uma conversa carrega o raciocínio que sustentou uma decisão de
 * auditoria; apagá-la de verdade transformaria "por que decidimos isso em
 * agosto?" numa pergunta sem resposta.
 *
 * **O estado é coluna, e as mensagens são linhas.** Poderia ser derivado da
 * última mensagem, e seria uma segunda implementação da herança conversacional
 * — a de `conversa.ts` e a da releitura. Guardá-lo resolvido é o que faz o
 * follow-up funcionar igual na primeira pergunta depois de reabrir a conversa e
 * na quinta seguida.
 */
export const assistantConversationTable = pgTable(
  "assistant_conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Quem criou — e, por enquanto, a única pessoa que lê.
     *
     * `restrict` e não `cascade`: contas nunca são apagadas neste produto, são
     * desativadas, e uma conversa órfã seria pior que uma conversa de alguém
     * que perdeu o acesso.
     */
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => appUserTable.id),
    /**
     * O título, derivado da primeira pergunta e renomeável.
     *
     * Nasce do texto da pergunta porque a alternativa — pedir um título antes
     * de conversar — é atrito na única parte do produto que deveria não ter
     * nenhum.
     */
    title: text("title").notNull(),
    /**
     * O recorte em que a conversa está: assunto, parâmetro, vigência, contexto.
     *
     * JSON e não colunas porque este formato acompanha a interpretação, que
     * ainda vai mudar. Uma migration por campo novo de estado seria atrito sem
     * contrapartida — nada aqui é consultado por índice, só lido inteiro junto
     * da conversa.
     */
    state: jsonb("state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Excluir é arquivar. Nunca há DELETE. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("assistant_conversation_owner_idx").on(t.ownerId, t.updatedAt),
  ],
);

/**
 * Uma pergunta ou uma resposta, na ordem em que aconteceram.
 *
 * `evidence` guarda o que a resposta usou — ferramentas, recortes, origens — em
 * JSON. É o que permite reabrir uma conversa de semanas atrás e ainda ver de
 * onde cada número veio. Não é cache: reabrir não recalcula, e a tela diz que
 * aquilo foi consultado naquele dia.
 */
export const assistantMessageTable = pgTable(
  "assistant_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => assistantConversationTable.id, { onDelete: "cascade" }),
    /** Ordem dentro da conversa. Explícita para não depender do relógio. */
    position: integer("position").notNull(),
    /** PERGUNTA (de quem usa) ou RESPOSTA (do assistente). */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** O dossiê reduzido: evidências, trechos, lacunas, recorte. */
    evidence: jsonb("evidence"),
    /**
     * O voto de quem leu: `UTIL`, `NAO_UTIL`, ou nada.
     *
     * É a única medida de qualidade deste assistente que não fomos nós que
     * escolhemos medir. A bateria, o benchmark e os cenários da trava de lastro
     * cobrem o que pensamos em cobrir; o analista que perguntou é quem sabe se
     * a resposta serviu. Nulo é o estado normal — a maioria das respostas não
     * recebe voto, e ler ausência como "ruim" inventaria um sinal.
     */
    feedback: text("feedback"),
    /** O que a pessoa quis dizer junto com o voto. Opcional. */
    feedbackNote: text("feedback_note"),
    feedbackAt: timestamp("feedback_at", { withTimezone: true }),
    /** IA ou DETERMINISTICA — para o painel técnico, nunca para a leitura. */
    writer: text("writer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("assistant_message_conversation_idx").on(t.conversationId, t.position),
    /**
     * Só a resposta recebe voto, e só um dos dois valores. Um voto numa
     * pergunta seria um dado que nenhuma tela sabe ler.
     */
    check(
      "assistant_message_feedback_ck",
      sql`${t.feedback} IS NULL OR (${t.role} = 'RESPOSTA' AND ${t.feedback} IN ('UTIL', 'NAO_UTIL'))`,
    ),
  ],
);
