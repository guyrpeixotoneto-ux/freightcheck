import { pgTable, text, uuid, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { changeSetTable, changeTable } from "./comparison";

/**
 * Chamados — Justificativas: a justificativa que o gestor escreve sobre uma
 * alteração específica, entre uma vigência e a seguinte.
 *
 * Uma linha por alteração justificada (`change_id`) dentro de uma comparação
 * (`change_set_id`) — não por placa: uma placa com várias alterações pode ter
 * cada uma justificada separadamente, ou todas de uma vez pela tela (que
 * ainda agrupa por placa para navegação). `entity_label`/`entity_type` vêm
 * denormalizados de `change` no momento do insert, pelo mesmo motivo que
 * `change` já denormaliza os dela: a tela lista sem precisar de join.
 * Justificar de novo a mesma alteração grava uma linha nova — é histórico,
 * não edição —, e a tela lê sempre a mais recente.
 */
export const justificativaTable = pgTable(
  "justificativa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    changeSetId: uuid("change_set_id")
      .notNull()
      .references(() => changeSetTable.id, { onDelete: "cascade" }),
    changeId: bigint("change_id", { mode: "number" })
      .notNull()
      .references(() => changeTable.id, { onDelete: "cascade" }),
    entityLabel: text("entity_label").notNull(),
    entityType: text("entity_type"),
    texto: text("texto").notNull(),
    /** Nunca nulo: uma justificativa sem autor não é auditável. */
    criadoPor: text("criado_por").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("justificativa_change_set_idx").on(t.changeSetId),
    index("justificativa_change_id_idx").on(t.changeId),
  ],
);
