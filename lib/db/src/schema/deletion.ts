import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * O que foi apagado, depois que já não há como olhar.
 *
 * Uma importação excluída leva junto a evidência dela — as células RAW, os
 * fatos, as vigências. Esta tabela é o que resta, e por isso ela copia em vez
 * de referenciar: o `import_run_id` aqui aponta para uma linha que não existe
 * mais, e nome, SHA-256 e vigências estão gravados como texto porque a origem
 * deles foi embora junto.
 *
 * É a mesma postura de `import_run`, que guarda a tentativa recusada como
 * duplicata: recusar não é esquecer, e apagar também não. Quem auditar este
 * banco daqui a um ano precisa poder distinguir "esta vigência nunca entrou"
 * de "esta vigência entrou e foi retirada, por fulano, no dia tal". Sem esta
 * tabela as duas seriam a mesma ausência.
 *
 * Ela própria não tem porta de saída: a trigger de `0010_import_deletion`
 * recusa UPDATE e DELETE aqui em qualquer circunstância, inclusive dentro de
 * outra exclusão.
 */
export const importDeletionTable = pgTable(
  "import_deletion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Sem FK: o run que este id nomeia foi apagado nesta mesma transação. */
    importRunId: uuid("import_run_id").notNull(),
    filename: text("filename").notNull(),
    contentSha256: text("content_sha256").notNull(),
    /** O estado em que o run estava — PROMOTED, FAILED, SKIPPED_DUPLICATE… */
    runStatus: text("run_status").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    /** Vigências que sumiram com esta importação, como estavam rotuladas. */
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    /**
     * Vigências que voltaram a valer.
     *
     * Excluir a importação que corrigiu uma vigência devolve a revisão
     * anterior ao ar — ela estava SUPERSEDED por causa desta, e some das telas
     * enquanto está. Sem este campo, a diferença entre "a vigência sumiu" e "a
     * vigência voltou a ser a revisão 1" ficaria por conta da memória de quem
     * apertou o botão.
     */
    restoredLabels: jsonb("restored_labels").$type<string[]>().notNull().default([]),
    /** Quanta coisa saiu, por tabela — os mesmos números que a tela mostrou. */
    removed: jsonb("removed").$type<Record<string, number>>().notNull().default({}),
    /** Nunca nulo: uma exclusão sem autor não é auditável. */
    deletedBy: text("deleted_by").notNull(),
    reason: text("reason"),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("import_deletion_deleted_at_idx").on(t.deletedAt),
    index("import_deletion_sha256_idx").on(t.contentSha256),
  ],
);
