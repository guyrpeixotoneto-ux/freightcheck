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
import { justificativaLoteTable } from "./justificativa-lote";

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
    /** A alteração seguiu a regra acima? */
    conforme: boolean("conforme"),
    /**
     * **Que tipo** de não conformidade — `EXCECAO` ou `DESCUMPRIMENTO`. Nulo
     * quando `conforme`, e nulo também nas justificativas anteriores a `0100`,
     * que só sabiam dizer "não".
     *
     * A distinção não é vocabulário: uma exceção é um desvio **aprovado**, e
     * tem aprovador; um descumprimento da regra de remuneração não tem, porque
     * ninguém o autorizou. Guardar as duas como o mesmo "não" fazia a coluna
     * `responsavel_aprovacao` ter de ser preenchida nos dois casos — e no
     * segundo ela registraria um aval que não existiu.
     */
    naoConformidade: text("nao_conformidade"),
    /** Por que se alterou fora da regra — o motivo da exceção ou do descumprimento. */
    motivoExcecao: text("motivo_excecao"),
    /** Quem autorizou a exceção. Só na exceção: descumprimento não tem aprovador. */
    responsavelAprovacao: text("responsavel_aprovacao"),
    /**
     * O lote que gravou esta linha — nulo em tudo que foi escrito uma a uma.
     *
     * O nulo é a maioria, e é o caminho normal: a caixa de justificar pergunta
     * uma variável por vez, e cada resposta é um POST. Preenchido, ele diz que
     * esta linha nasceu de um gesto que alcançou outras — e é por ele que se
     * chega ao universo daquele gesto, que é a única pergunta que a
     * justificativa em lote provoca e a linha sozinha não responde. Ver
     * `schema/justificativa-lote.ts`.
     *
     * `ON DELETE SET NULL`, e não cascade: apagar o registro do lote não pode
     * apagar as justificativas que ele gravou — o que o gestor escreveu é dele,
     * não do lote.
     */
    loteId: uuid("lote_id").references(() => justificativaLoteTable.id, {
      onDelete: "set null",
    }),
    /** Nunca nulo: uma justificativa sem autor não é auditável. */
    criadoPor: text("criado_por").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("justificativa_change_set_idx").on(t.changeSetId),
    index("justificativa_change_id_idx").on(t.changeId),
    index("justificativa_lote_idx").on(t.loteId),
  ],
);
