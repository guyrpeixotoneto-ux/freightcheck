import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { changeSetTable } from "./comparison";

/**
 * Plano de Ação — a justificativa que o gestor escreve sobre o que mudou numa
 * placa, entre uma vigência e a seguinte.
 *
 * Uma linha por placa justificada dentro de uma comparação (`change_set_id`):
 * `entity_label` é a mesma placa que `change.entity_label` já usa, então a
 * tela de Justificativas não precisa de identidade própria para o ativo.
 * Justificar de novo a mesma placa na mesma comparação grava uma linha nova —
 * é histórico, não edição —, e a tela lê sempre a mais recente.
 */
export const justificativaTable = pgTable(
  "justificativa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    changeSetId: uuid("change_set_id")
      .notNull()
      .references(() => changeSetTable.id, { onDelete: "cascade" }),
    entityLabel: text("entity_label").notNull(),
    entityType: text("entity_type"),
    texto: text("texto").notNull(),
    /** Nunca nulo: uma justificativa sem autor não é auditável. */
    criadoPor: text("criado_por").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("justificativa_change_set_idx").on(t.changeSetId),
    index("justificativa_entity_label_idx").on(t.entityLabel),
  ],
);
