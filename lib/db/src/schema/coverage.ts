import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  timestamp,
  date,
  index,
  uniqueIndex,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { snapshotTable } from "./canonical";

/**
 * COBERTURA — o que **deveria** existir, e o denominador do que existe.
 *
 * Este arquivo é deliberadamente pequeno, e o motivo é o diagnóstico que o
 * precedeu: quase tudo o que a cobertura precisa saber já está modelado.
 * Presença de valor é `fact.is_null = false`; ausência declarada é
 * `fact.is_null = true` com `null_reason`; presença no layout é
 * `snapshot_attribute.present_in_layout`; a vigência, a família, o canal e o
 * escopo são colunas de `snapshot`; a proveniência é a cadeia
 * `fact.raw_cell_id → raw_cell → raw_row → raw_sheet → import_run →
 * source_file`. Nada disso é recriado aqui.
 *
 * O que **não** existia são duas coisas, e são exatamente estas duas tabelas:
 *
 * 1. **O esperado.** Nenhuma coluna do banco dizia "este atributo deveria
 *    existir para este equipamento nesta família". Sem isso, cobertura só
 *    consegue ser "o que veio", que é a pergunta que a tela de Importações já
 *    responde.
 * 2. **O denominador por equipamento.** `snapshot.entity_count` é o total da
 *    vigência, e `entity_type_set` é um texto. Perguntar "quantos cavalos esta
 *    vigência tem" custava `count(DISTINCT entity_id)` sobre a fact table —
 *    208 ms com 124 mil fatos, medido no export real, e a fact table é a que
 *    cresce para milhões.
 */

/**
 * O agregado de uma entrega, por equipamento.
 *
 * Uma linha por (vigência, tipo de entidade). É o denominador da matriz de
 * cobertura e o único lugar de onde ela o tira: com esta tabela, o resumo e a
 * matriz inteira são lidos sem tocar em `fact` uma única vez.
 *
 * **Por que uma tabela e não uma coluna em `snapshot`.** O gatilho
 * `snapshot_immutable` congela a vigência quando ela fecha, e enumera nome por
 * nome as colunas que a transição CLOSED → SUPERSEDED pode mexer. Uma coluna
 * nova em `snapshot` seria impossível de preencher para as vigências que já
 * existem — o backfill da migration esbarraria no gatilho —, e desligá-lo para
 * isso trocaria a garantia central do produto por uma conveniência de leitura.
 *
 * **Por que não inferir de `snapshot_attribute`.** Como `fact` é densa neste
 * export, `max(value_count + null_count)` sobre os atributos de um tipo dá o
 * número certo de entidades. Dá *hoje*: a densidade é um hábito da origem, não
 * uma garantia do modelo, e no dia em que um arquivo vier esparso a conta
 * passaria a devolver um piso com cara de contagem. Contar na promoção, quando
 * os fatos estão à mão, é exato e não depende de como a origem se comporta.
 *
 * Escrita enquanto o snapshot ainda é DRAFT, na mesma transação que o fecha.
 */
export const snapshotEntityTypeTable = pgTable(
  "snapshot_entity_type",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => snapshotTable.id),
    /** CAVALO | CARRETA | … — texto, como em todo lugar que descreve a origem. */
    entityType: text("entity_type").notNull(),
    /** Entidades distintas deste tipo com pelo menos um fato nesta vigência. */
    entityCount: integer("entity_count").notNull().default(0),
    /** Atributos distintos deste tipo que a vigência carrega. */
    attributeCount: integer("attribute_count").notNull().default(0),
    /** Fatos deste tipo: presentes e ausentes somados. */
    factCount: integer("fact_count").notNull().default(0),
    /** Dos fatos, os que têm valor. É o numerador da cobertura observada. */
    valueCount: integer("value_count").notNull().default(0),
    /** Dos fatos, os que chegaram vazios — entregues e sem valor. */
    nullCount: integer("null_count").notNull().default(0),
    /**
     * Dos fatos, os que vieram da revisão anterior e não deste arquivo.
     *
     * Existe para que a cobertura consiga dizer "estes cavalos estão aqui
     * porque a revisão passada os trouxe", que é a diferença entre uma vigência
     * completa e uma vigência cujo último arquivo foi parcial.
     */
    inheritedFactCount: integer("inherited_fact_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("snapshot_entity_type_uq").on(t.snapshotId, t.entityType),
    index("snapshot_entity_type_type_idx").on(t.entityType),
  ],
);

/**
 * O esperado — e **só** o esperado que alguém afirmou.
 *
 * Esta tabela guarda duas coisas, e não guarda uma terceira de propósito:
 *
 * - `origin = 'CONTRATO'` — o que o sistema sabe formalmente que deveria
 *   existir. Hoje vem do plano da DRE (`lib/dre/src/plano.ts`), onde cada
 *   componente declara as suas `fontes` e se é `essencial`, com a evidência
 *   medida escrita ao lado. Não é um palpite promovido a regra: é a mesma
 *   declaração que a DRE já usa para se recusar a fechar subtotal.
 * - `origin = 'CURADORIA'` — a decisão de uma pessoa. Confirmar uma expectativa
 *   inferida, dispensar uma ausência legítima, aceitar que um campo foi
 *   renomeado. Sempre com `actor` e `rationale`, que são `NOT NULL` porque uma
 *   decisão sem dono e sem motivo não é auditável.
 *
 * **O que ela não guarda: o esperado inferido.** Um atributo que apareceu nas
 * oito vigências anteriores para as mesmas 144 entidades é evidência forte, e
 * evidência forte não é declaração. Ela é recalculada a cada leitura sobre o
 * histórico de `snapshot_attribute` — que é barato, porque aquela tabela cresce
 * com (vigências × atributos) e não com entidades — e chega à tela marcada como
 * inferida. Gravá-la aqui a transformaria, em uma migration ou duas, em algo
 * indistinguível de contrato: é assim que uma estatística vira verdade sem que
 * ninguém tenha decidido. Quem quiser promovê-la clica em confirmar, e aí sim
 * nasce uma linha, com nome e motivo.
 *
 * **A janela de validade.** `effective_from`/`effective_until` alinham-se com
 * `snapshot.effective_date`, como em `attribute_semantics`. É o que permite
 * dizer "isto era esperado até Jul/26" sem apagar o passado: uma renomeação
 * confirmada fecha a janela do nome antigo e aponta `succeeded_by_attribute_
 * code` para o novo, em vez de reescrever o histórico.
 */
export const coverageExpectationTable = pgTable(
  "coverage_expectation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceSystem: text("source_system").notNull().default("FREIGHTEC"),
    datasetFamily: text("dataset_family").notNull(),
    /** Nulo = vale para qualquer canal desta família. */
    canal: text("canal"),
    /**
     * O escopo canônico a que a expectativa se aplica, serializado.
     *
     * Nulo = vale para qualquer unidade. É o caso normal do contrato: o plano
     * da DRE fala do equipamento, não de quem opera. Uma expectativa presa a
     * uma unidade existe para o caso oposto — a unidade que legitimamente não
     * tem aquele dado —, e é o que impede a dispensa de uma unidade de apagar a
     * lacuna das outras.
     */
    scopeKey: text("scope_key"),
    entityType: text("entity_type").notNull(),
    /** O código do atributo, como em `attribute.code`. */
    attributeCode: text("attribute_code").notNull(),
    /** CONTRATO | CURADORIA. */
    origin: text("origin").notNull(),
    /**
     * CONFIRMADO — é esperado, e a ausência é lacuna.
     * DISPENSADO  — a ausência é legítima aqui. Não reduz cobertura.
     *
     * INFERIDO não aparece: expectativa inferida não vira linha (ver o
     * cabeçalho). O que chega à tela como inferido é calculado na leitura.
     */
    status: text("status").notNull(),
    /** CRITICO | RELEVANTE | INFORMATIVO. */
    criticality: text("criticality").notNull().default("RELEVANTE"),
    /** Inclusive, alinhado a `snapshot.effective_date`. */
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    /** Exclusivo. Nulo = em vigor. */
    effectiveUntil: date("effective_until", { mode: "string" }),
    /**
     * Para onde este atributo foi, quando a curadoria confirmou uma renomeação.
     *
     * Preenchido junto com `effective_until`: o par diz "parou de ser esperado
     * nesta data porque virou aquele outro". Sem ele, fechar a janela seria
     * indistinguível de desistir da lacuna.
     */
    succeededByAttributeCode: text("succeeded_by_attribute_code"),
    /** Por que isto é esperado. Vai para a tela como está. Nunca vazio. */
    rationale: text("rationale").notNull(),
    /** A medição que sustenta a linha: contagens, vigências, atributos. */
    evidence: jsonb("evidence").notNull().default({}),
    /** Quem afirmou. Nunca nulo. */
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * Uma expectativa por identidade e por início de janela.
     *
     * `NULLS NOT DISTINCT` porque nulo aqui quer dizer "qualquer", e "qualquer"
     * é um valor como outro: sem isso, duas expectativas de família inteira
     * para o mesmo atributo conviveriam, e a cobertura passaria a depender de
     * qual delas a consulta encontrasse primeiro.
     */
    unique("coverage_expectation_uq")
      .on(
        t.sourceSystem,
        t.datasetFamily,
        t.canal,
        t.scopeKey,
        t.entityType,
        t.attributeCode,
        t.effectiveFrom,
      )
      .nullsNotDistinct(),
    index("coverage_expectation_lookup_idx").on(
      t.datasetFamily,
      t.entityType,
      t.attributeCode,
    ),
    index("coverage_expectation_attribute_idx").on(t.attributeCode),
    check(
      "coverage_expectation_origin_ck",
      sql`${t.origin} IN ('CONTRATO', 'CURADORIA')`,
    ),
    check(
      "coverage_expectation_status_ck",
      sql`${t.status} IN ('CONFIRMADO', 'DISPENSADO')`,
    ),
    check(
      "coverage_expectation_criticality_ck",
      sql`${t.criticality} IN ('CRITICO', 'RELEVANTE', 'INFORMATIVO')`,
    ),
    /* Motivo em branco satisfaz `NOT NULL` e não explica nada. */
    check(
      "coverage_expectation_rationale_ck",
      sql`btrim(${t.rationale}) <> ''`,
    ),
    check("coverage_expectation_actor_ck", sql`btrim(${t.actor}) <> ''`),
    /*
      Uma renomeação declara para onde o dado foi, e fechar a janela é o que
      torna a declaração verdadeira. As duas juntas ou nenhuma: um sucessor com
      a janela aberta diria que o atributo continua esperado *e* que ele virou
      outro, e a lacuna seria contada duas vezes.
    */
    check(
      "coverage_expectation_sucessor_ck",
      sql`${t.succeededByAttributeCode} IS NULL OR ${t.effectiveUntil} IS NOT NULL`,
    ),
  ],
);
