import { pgTable, text, uuid, timestamp, index } from "drizzle-orm/pg-core";

/**
 * O que uma normalização tirou — para que dê para pôr de volta exatamente isso.
 *
 * A promoção antiga criava todo atributo com `display_name` igual a
 * `source_name`, e limpar essa cópia é o que devolve ao Nome Gerencial o
 * significado de campo respondido por alguém. O problema não é a limpeza: é
 * não saber, depois, quais linhas foram limpas.
 *
 * **Por que um registro, e não um `WHERE` esperto.** A volta atrás óbvia —
 * `SET display_name = source_name WHERE display_name IS NULL` — atinge também
 * o que já era nulo por direito e todo atributo criado depois da regra nova, que
 * nasce nulo de propósito. Ela não desfaz a normalização: reinstala o defeito,
 * e num conjunto maior do que o que foi tocado. Um rollback que não sabe dizer
 * o que alterou não é rollback.
 *
 * Cada linha aqui é uma coluna cujo Nome Gerencial foi apagado, com o valor que
 * ela tinha. Restaurar é ler daqui, e alcança exatamente — nem uma linha a mais
 * — o conjunto que a rotina mexeu.
 *
 * **Por que isto existe apesar de `curation_event`.** O evento de curadoria é o
 * registro do que uma *pessoa* decidiu, e escrevê-lo aqui seria mentira: ninguém
 * decidiu nada sobre estas colunas — uma rotina desfez o que outra rotina havia
 * escrito. Misturar as duas coisas contaminaria a única tabela de que a
 * curadoria depende para saber quem disse o quê.
 *
 * **Sem chave estrangeira para `attribute`**, pela mesma razão de
 * `import_deletion`: excluir uma importação pode levar a coluna embora, e uma FK
 * faria essa exclusão falhar por causa de um registro de auditoria. O
 * `attribute_code` fica gravado como texto para que a linha continue legível
 * quando o id que ela nomeia já não existir.
 */
export const nomeGerencialNormalizadoTable = pgTable(
  "nome_gerencial_normalizado",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Sem FK: a coluna que este id nomeia pode ser excluída depois. */
    attributeId: uuid("attribute_id").notNull(),
    /** O código, em texto, para a linha sobreviver ao id. */
    attributeCode: text("attribute_code").notNull(),
    /** O nome de origem, que a rotina não toca — aqui para conferência. */
    sourceName: text("source_name").notNull(),
    /** O que foi apagado. É por este valor que a volta atrás restaura. */
    displayNameAntes: text("display_name_antes").notNull(),
    /** Quem mandou normalizar. Sem isso não há auditoria. */
    normalizadoPor: text("normalizado_por").notNull(),
    normalizadoEm: timestamp("normalizado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Quando a volta atrás repôs esta linha — nulo enquanto ela está desfeita.
     *
     * A linha não é apagada no rollback pelo mesmo motivo que `import_deletion`
     * não some: o que aconteceu aconteceu, e um banco que já foi normalizado e
     * revertido não é o mesmo que um banco que nunca foi tocado.
     */
    restauradoEm: timestamp("restaurado_em", { withTimezone: true }),
  },
  (t) => [
    index("nome_gerencial_normalizado_attribute_idx").on(t.attributeId),
    index("nome_gerencial_normalizado_em_idx").on(t.normalizadoEm),
  ],
);
