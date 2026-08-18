import {
  pgTable,
  text,
  uuid,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * QUANTIDADE DA BASE — o dado que transforma uma taxa em dinheiro.
 *
 * ---------------------------------------------------------------------------
 * O que esta tabela guarda
 * ---------------------------------------------------------------------------
 * Uma frase, assinada: *"para o TRECHO, a quantidade de VIAGEM do mês vem da
 * coluna `trecho.previsao_viagens`, que é uma previsão"*. Com ela, e só com
 * ela, `R$/viagem × viagens/mês` vira `R$/mês` — a conta está em
 * `lib/curation/src/quantidade-da-base.ts`, que é a autoridade; isto aqui é
 * onde a declaração mora.
 *
 * O produto já sabia que faltava este dado e já dizia o nome dele:
 * `baseQueFalta` responde, para `BRL_KM`, "quilometragem rodada por ativo no
 * período", e a composição já exclui esses componentes com o motivo
 * `BASE_AUSENTE`. Faltava um lugar para a resposta — e é por isso que
 * `manutencaoReaisKm`, R$/km no cavalo, está fora de todos os totais desde que
 * existe.
 *
 * ---------------------------------------------------------------------------
 * Por que é declarada, e não descoberta
 * ---------------------------------------------------------------------------
 * O export de trecho traz `previsaoViagens` e `kmRodadoMesPorEquipe`, e as duas
 * são candidatas plausíveis para bases diferentes. Qual delas remunera é
 * decisão de quem opera o contrato — e um palpite errado aqui não deixa a tela
 * vazia: produz um número com cara de apurado. Por isso a declaração é assinada
 * (`declared_by`), justificada (`justification`) e versionada, como toda
 * decisão que move dinheiro neste produto.
 *
 * ---------------------------------------------------------------------------
 * `nature` — previsão não é medição
 * ---------------------------------------------------------------------------
 * `previsaoViagens` é uma previsão. Um total montado sobre ela é um orçamento,
 * e sair com a mesma cara de um valor apurado seria a classe de erro que este
 * produto existe para não cometer. A natureza acompanha o montante derivado até
 * a tela — a mesma disciplina de `PROJECAO_LINEAR` em `dre/normalizacao.ts`.
 *
 * Trocar a previsão por viagens realizadas é trocar a linha desta tabela: todo
 * número derivado passa a dizer que foi apurado, sem que uma linha de cálculo
 * mude.
 *
 * ---------------------------------------------------------------------------
 * Versionada, como a semântica
 * ---------------------------------------------------------------------------
 * `effective_from` / `effective_until` / `is_current`, no mesmo molde de
 * `attribute_semantics` e `entity_identifier`. A razão é a de sempre nesta
 * base: quando a operação trocar a fonte da quantidade, os totais já apurados
 * continuam tendo sido calculados com a fonte anterior, e reescrevê-los em
 * silêncio apagaria a explicação de um número que alguém já leu.
 *
 * ---------------------------------------------------------------------------
 * `base` e `entity_type` são texto livre. De propósito.
 * ---------------------------------------------------------------------------
 * A base vem do cadastro de significados (`semantic_meaning.base`), que é da
 * operação: `R$ por pallet` nasce numa tela de curadoria, não numa migration.
 * `entity_type` aceita `*`, que vale para qualquer tipo — declarar a
 * quilometragem uma vez para a frota inteira, e deixar o trecho discordar se
 * for o caso. A declaração específica ganha da geral, em `fonteAplicavel`.
 */
export const baseQuantitySourceTable = pgTable(
  "base_quantity_source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `TRECHO`, `CAVALO`… ou `*` para qualquer tipo de ativo. */
    entityType: text("entity_type").notNull(),
    /** `KM`, `VIAGEM`, `PALLET` — como o cadastro de significados a nomeia. */
    base: text("base").notNull(),
    /** A competência a que a quantidade se refere. Hoje sempre `MENSAL`. */
    competence: text("competence").notNull(),
    /** A coluna que entrega a quantidade, por ativo e por vigência. */
    quantityAttributeCode: text("quantity_attribute_code").notNull(),
    /** `MEDIDA` | `PREVISTA` — e o montante derivado herda isto. */
    nature: text("nature").notNull(),
    /** Por que esta coluna, e não outra. Prosa de quem declarou. */
    justification: text("justification").notNull(),
    declaredBy: text("declared_by").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveUntil: date("effective_until", { mode: "string" }),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * Uma fonte corrente por (tipo, base, competência).
     *
     * Duas declarações vivas para a mesma pergunta não é um conflito a resolver
     * na leitura: é um estado que não pode existir. `fonteAplicavel` escolhe
     * entre o específico e o `*` — e não entre dois específicos, porque este
     * índice impede que eles existam.
     */
    uniqueIndex("base_quantity_source_current_uq")
      .on(t.entityType, t.base, t.competence)
      .where(sql`${t.isCurrent}`),
    index("base_quantity_source_lookup_idx").on(t.base, t.competence),
    index("base_quantity_source_attribute_idx").on(t.quantityAttributeCode),
    check(
      "base_quantity_source_nature_conhecida",
      sql`${t.nature} IN ('MEDIDA', 'PREVISTA')`,
    ),
    /**
     * Só duas naturezas, e aqui **cabe** um CHECK — ao contrário de `base`.
     *
     * A diferença não é de gosto: o vocabulário de bases é da operação e cresce
     * com o negócio, enquanto "o número foi medido ou foi previsto" é uma
     * distinção do nosso modelo, com exatamente dois lados. Um terceiro valor
     * aqui não seria uma base nova — seria alguém contornando a etiqueta que
     * separa orçamento de apuração.
     */
    check(
      "base_quantity_source_janela_ordenada",
      sql`${t.effectiveUntil} IS NULL OR ${t.effectiveUntil} >= ${t.effectiveFrom}`,
    ),
  ],
);
