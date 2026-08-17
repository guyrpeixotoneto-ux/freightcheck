import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * SIGNIFICADO ECONÔMICO — o cadastro canônico do que um valor representa.
 *
 * ---------------------------------------------------------------------------
 * Por que uma tabela, e não um enum
 * ---------------------------------------------------------------------------
 * `unit`, `periodicity`, `aggregation` e `is_monetary` continuam existindo e
 * continuam sendo o que o motor financeiro lê. O que mudou é **quem os
 * escreve**: até aqui era uma pessoa, escolhendo quatro valores técnicos numa
 * tela; agora é a autoridade semântica (`lib/curation/src/significado.ts`),
 * derivando-os de uma única afirmação econômica — "isto é R$ por litro".
 *
 * Esta tabela é o cadastro dessas afirmações. Ela é tabela, e não enum, por uma
 * razão que o resto do schema já pratica em `taxonomy_node` e nas colunas de
 * texto: **o vocabulário é da operação, não nosso.** Uma transportadora que
 * remunera por pallet entregue precisa de `R$ por pallet` no dia em que ela
 * importa a planilha, não na próxima migration. E a criação tem de acontecer na
 * própria tela de confirmação — quem está curando não pode ser mandado para um
 * cadastro em outro lugar e depois "voltar".
 *
 * ---------------------------------------------------------------------------
 * Os campos técnicos ficam gravados aqui também. De propósito.
 * ---------------------------------------------------------------------------
 * `unit`, `periodicity`, `aggregation`, `is_monetary`, `value_kind`,
 * `denominator` e `currency` são derivados — `derivarSemantica` os produz a
 * partir de `forma` + `base`. Gravá-los mesmo assim não é duplicação
 * descuidada: é o que permite que uma consulta SQL — a comparação, o
 * diagnóstico, um `psql` de plantão — leia o que um significado significa sem
 * carregar TypeScript. A cópia não pode divergir porque um teste de arquitetura
 * relê todas as linhas do cadastro e as confere contra a função, uma a uma;
 * é o mesmo padrão da constraint `attribute_semantica_coerente`, que é a
 * redação em SQL de `coerenciaDaSemantica`.
 *
 * ---------------------------------------------------------------------------
 * Duas chaves, e nenhuma delas é o rótulo
 * ---------------------------------------------------------------------------
 * - `code` é a chave **econômica**, derivada de forma + base. `R$/litro`,
 *   `R$ por litro` e `reais por litro` produzem o mesmo `taxa_litro`, e é o
 *   índice único sobre ele que impede o cadastro de ganhar três linhas para a
 *   mesma economia.
 * - `normalized_label` é a chave **textual**: o rótulo sem acento, sem caixa e
 *   sem pontuação. É o que faz `combustivel` encontrar `Combustível`.
 *
 * As duas são únicas por escopo, e as duas precisam existir: a primeira sozinha
 * deixaria passar dois rótulos idênticos com bases diferentes por erro de
 * digitação; a segunda sozinha deixaria passar `R$/litro` ao lado de
 * `R$ por litro`.
 *
 * ---------------------------------------------------------------------------
 * Escopo
 * ---------------------------------------------------------------------------
 * Este produto é hoje de um cliente só: não há coluna de empresa em lugar
 * nenhum do schema, e `scope` (em `canonical.ts`) descreve o recorte de uma
 * vigência — filial, canal —, não um inquilino. Inventar uma tabela de
 * inquilinos aqui seria modelar um requisito que ninguém pediu.
 *
 * O que existe é o par `scope_type` / `scope_code`, que nasce `GLOBAL` / `*` e
 * participa das duas chaves únicas. Ele custa duas colunas de texto e compra a
 * única coisa que importa: no dia em que houver mais de um inquilino, o
 * cadastro **não precisa ser rechaveado** — dois escopos podem ter
 * "R$ por pallet" com significados próprios, e um escopo continua sem poder ter
 * dois. Um teste prova as duas metades disso hoje, com escopos de mentira.
 */
export const semanticMeaningTable = pgTable(
  "semantic_meaning",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** GLOBAL hoje. Ver a nota sobre escopo, acima. */
    scopeType: text("scope_type").notNull().default("GLOBAL"),
    scopeCode: text("scope_code").notNull().default("*"),

    /** Chave econômica: `taxa_litro`, `montante_mes`. Derivada de forma+base. */
    code: text("code").notNull(),
    /** Como aparece na tela: "R$ por litro". */
    label: text("label").notNull(),
    /** O rótulo sem acento, caixa nem pontuação — a chave contra duplicata. */
    normalizedLabel: text("normalized_label").notNull(),

    /** MONTANTE | TAXA | PROPORCAO | CONSUMO | GRANDEZA | DESCRITOR. */
    forma: text("forma").notNull(),
    /** MES | ANO | AQUISICAO | VEICULO | LITRO | KM | … — aberta por definição. */
    base: text("base"),

    // --- Os quatro campos que o motor financeiro lê. Derivados, nunca digitados.
    unit: text("unit"),
    periodicity: text("periodicity"),
    aggregation: text("aggregation"),
    isMonetary: boolean("is_monetary"),

    // --- O resto da representação técnica, para quem lê por SQL.
    currency: text("currency"),
    /** AMOUNT | RATE | RATIO | QUANTITY | DESCRIPTOR. */
    valueKind: text("value_kind").notNull(),
    denominator: text("denominator"),

    /**
     * Veio do catálogo inicial, ou foi cadastrado por alguém na tela?
     *
     * A distinção não é decorativa: o teste de arquitetura confere o catálogo
     * inicial contra a autoridade, e um significado que a operação criou é
     * conferido pela mesma autoridade no momento da criação — mas o rótulo dele
     * é da operação, e ninguém pode reescrevê-lo por padronização.
     */
    isSeed: boolean("is_seed").notNull().default(false),

    /**
     * Quem cadastrou. Nunca nulo para o que veio da tela.
     *
     * Mesma regra do `actor` do resto do produto: um cadastro sem autor é um
     * cadastro que ninguém precisa explicar depois. O catálogo inicial entra
     * com um identificador de sistema, que é honesto — ninguém o decidiu numa
     * tela, ele veio com o produto.
     */
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("semantic_meaning_code_uq").on(t.scopeType, t.scopeCode, t.code),
    uniqueIndex("semantic_meaning_label_uq").on(
      t.scopeType,
      t.scopeCode,
      t.normalizedLabel,
    ),
    index("semantic_meaning_scope_idx").on(t.scopeType, t.scopeCode),
  ],
);
