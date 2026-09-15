import {
  pgTable,
  text,
  uuid,
  bigint,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
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
    /*
      O que a justificativa passou a perguntar, de `0098` em diante: não só o
      texto livre, mas a regra sob a qual a alteração foi feita. `texto`
      continua sendo o resumo legível — é ele que as telas que só têm espaço
      para uma frase (a tabela do FINAME, a fila do painel) mostram —, e estas
      colunas são a decomposição que torna a frase verificável.

      Todas anuláveis porque as justificativas gravadas antes de `0098` não as
      têm, e inventar um valor para elas seria afirmar uma regra que ninguém
      escreveu.
    */
    /** Como o valor é calculado — "Amortização mensal = valor ÷ prazo". */
    formula: text("formula"),
    /** Sob que condição este valor pode mudar. */
    regra: text("regra"),
    /** A alteração seguiu a regra acima, ou foi exceção? */
    conforme: boolean("conforme"),
    /** Por que se alterou mesmo fora da regra — só faz sentido com `conforme` falso. */
    motivoExcecao: text("motivo_excecao"),
    /** Quem autorizou a exceção — idem. */
    responsavelAprovacao: text("responsavel_aprovacao"),
    /** Nunca nulo: uma justificativa sem autor não é auditável. */
    criadoPor: text("criado_por").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("justificativa_change_set_idx").on(t.changeSetId),
    index("justificativa_change_id_idx").on(t.changeId),
  ],
);
