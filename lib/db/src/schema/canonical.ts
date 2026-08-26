import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  bigint,
  bigserial,
  boolean,
  numeric,
  timestamp,
  date,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { semanticsStatus, snapshotStatus } from "./enums";
import { importRunTable, rawCellTable, sourceFileTable } from "./raw";
import { semanticMeaningTable } from "./significado";

/**
 * CANONICAL layer — the source of truth. Comparable, versioned, traceable.
 */

/**
 * The remunerated asset.
 *
 * Identity is the internal UUID and nothing else. Plate and chassis are
 * *identifiers* (see `entity_identifier`) that participate in matching and
 * may change over the asset's life; they never define permanent identity.
 */
export const entityTable = pgTable(
  "entity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Free text, not an enum: the Freightec may start exporting a third kind
     * of equipment without a migration.
     */
    entityType: text("entity_type").notNull(),
    firstSeenImportRunId: uuid("first_seen_import_run_id").references(
      () => importRunTable.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("entity_type_idx").on(t.entityType)],
);

/**
 * Identifiers an entity carries over time, with validity history.
 *
 * A Mercosul re-plating closes the old PLACA row and opens a new one; the
 * `entity.id` — and therefore every historical fact — is untouched.
 */
export const entityIdentifierTable = pgTable(
  "entity_identifier",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entityTable.id),
    /** PLACA | CHASSI | ... — text so new identifier kinds need no migration. */
    identifierType: text("identifier_type").notNull(),
    /** Normalizado: sem pontuação, em caixa alta. É o que identifica. */
    identifierValue: text("identifier_value").notNull(),
    /** O identificador como veio escrito. Evidência, não identidade. */
    identifierValueRaw: text("identifier_value_raw"),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    effectiveUntil: date("effective_until", { mode: "string" }),
    isCurrent: boolean("is_current").notNull().default(true),
    sourceImportRunId: uuid("source_import_run_id").references(
      () => importRunTable.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** The same identifier value cannot be open for two entities at once. */
    uniqueIndex("entity_identifier_current_uq")
      .on(t.identifierType, t.identifierValue)
      .where(sql`${t.isCurrent}`),
    index("entity_identifier_lookup_idx").on(
      t.identifierType,
      t.identifierValue,
    ),
    index("entity_identifier_entity_idx").on(t.entityId),
  ],
);

/**
 * Organisational scope (unit, operator, region, ...).
 *
 * Today the file carries exactly one of each; the model is multi-valued from
 * the start so the first multi-unit export needs no migration.
 */
export const scopeTable = pgTable(
  "scope",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeType: text("scope_type").notNull(),
    code: text("code").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("scope_type_code_uq").on(t.scopeType, t.code)],
);

/**
 * A vigência found inside a file. One file yields many snapshots.
 *
 * Identidade canônica (segunda linha de defesa, independente do SHA-256):
 *   source_system + dataset_family + canal + effective_date + canonical_scope
 *
 * Nenhum componente dela depende da *forma* como o dado chegou. A chave antiga
 * — rótulo literal, hash de escopo cru e o conjunto de tipos que por acaso veio
 * no arquivo — dependia das três, e por isso o mesmo negócio entregue com o
 * rótulo escrito de outro jeito, com o CNPJ mascarado ou com uma aba a menos
 * abria uma **segunda vigência ativa** em vez de uma revisão.
 *
 * Reentregar a mesma vigência com correções é sempre uma revisão explícita,
 * nunca uma edição no lugar.
 */
export const snapshotTable = pgTable(
  "snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFileTable.id),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id),
    sourceSystem: text("source_system").notNull().default("FREIGHTEC"),
    /** Literal label from the file, e.g. "EMPURRADA_1_8_2026". Never parsed away. */
    sourceLabel: text("source_label").notNull(),
    /** Derived from the label by an explicit, tested rule. Kept separate. */
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    /**
     * Hash do conjunto de escopos como ele veio, sem normalizar.
     *
     * Não faz mais parte da identidade — um CNPJ mascarado num arquivo e sem
     * máscara no outro mudava este hash e abria uma segunda vigência ativa.
     * Continua gravado porque é o que os snapshots antigos usavam e porque diz
     * o que o arquivo trazia; quem identifica agora é `canonicalScope`.
     */
    scopeHash: text("scope_hash").notNull(),
    /**
     * Conjunto de tipos cobertos, ordenado e unido por '+', p.ex.
     * "CARRETA+CAVALO".
     *
     * Descritivo, não identificador. Ele varia com as abas que o arquivo trouxe
     * — e era exatamente por isso que uma correção só de cavalos virava uma
     * segunda vigência ativa em vez de uma revisão. Quem identifica é
     * `datasetFamily`.
     */
    entityTypeSet: text("entity_type_set").notNull(),
    /**
     * A família do dataset: o contrato da importação.
     *
     * CAVALO e CARRETA são componentes da mesma família, de modo que um arquivo
     * parcial entra como revisão da vigência que já existe — nunca como uma
     * segunda vigência ativa.
     */
    datasetFamily: text("dataset_family").notNull(),
    /** EMPURRADA, ROTA, … — derivado do rótulo, normalizado. Identifica. */
    canal: text("canal").notNull(),
    /** O escopo normalizado, ordenado e sem repetição. Identifica. */
    canonicalScope: jsonb("canonical_scope").notNull(),
    /**
     * Hash do conteúdo já normalizado, para reconhecer "o arquivo é outro, mas
     * o dado é o mesmo". Nulo nas vigências anteriores a esta coluna: quando
     * falta, a comparação é feita contra os fatos do próprio snapshot.
     */
    canonicalPayloadHash: text("canonical_payload_hash"),
    /**
     * A identidade canônica, **calculada pelo banco**.
     *
     * É uma coluna gerada: a aplicação não a escreve e não consegue escrevê-la.
     * É o que transforma "o TypeScript calcula certo" em "é impossível calcular
     * errado" — ver `0015_canonical_identity.sql`.
     */
    canonicalSnapshotKey: text("canonical_snapshot_key").generatedAlwaysAs(
      sql`freightcheck_snapshot_key("source_system", "dataset_family", "canal", "effective_date", "canonical_scope")`,
    ),
    revision: integer("revision").notNull().default(1),
    supersedesSnapshotId: uuid("supersedes_snapshot_id"),
    status: snapshotStatus("status").notNull().default("DRAFT"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    entityCount: integer("entity_count").notNull().default(0),
    factCount: integer("fact_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * No máximo uma vigência ativa por identidade canônica.
     *
     * Esta linha é a garantia do produto. Ela não depende de nenhum caminho da
     * aplicação estar correto: mesmo que o `promote` passe a errar, o banco
     * recusa a segunda vigência ativa.
     */
    uniqueIndex("snapshot_canonical_live_uq")
      .on(t.canonicalSnapshotKey)
      .where(sql`${t.status} <> 'SUPERSEDED'`),
    /**
     * A numeração de revisão não admite empate, o que impede duas promoções
     * concorrentes de gravarem a mesma revisão da mesma identidade.
     */
    uniqueIndex("snapshot_canonical_revision_uq").on(
      t.canonicalSnapshotKey,
      t.revision,
    ),
    index("snapshot_canonical_key_idx").on(t.canonicalSnapshotKey),
    index("snapshot_effective_date_idx").on(t.effectiveDate),
    index("snapshot_import_run_idx").on(t.importRunId),
    /*
      `NOT NULL` cobre o nulo e nada mais.

      String vazia e `[]` satisfazem a obrigatoriedade e destroem a identidade:
      duas vigências com canal vazio na mesma data são a mesma chave canônica, e
      o que era para virar revisão vira fusão silenciosa de duas realidades
      diferentes. Estas quatro são o que impede uma identidade *ambígua* — e
      valem no banco, não no caminho de escrita, porque o caminho de escrita é
      exatamente o que pode errar.
    */
    check(
      "snapshot_canonical_scope_ck",
      sql`${t.canonicalScope} = freightcheck_canonical_scope(${t.canonicalScope})`,
    ),
    check("snapshot_canal_nao_vazio_ck", sql`btrim(${t.canal}) <> ''`),
    check(
      "snapshot_dataset_family_nao_vazio_ck",
      sql`btrim(${t.datasetFamily}) <> ''`,
    ),
    check(
      "snapshot_canonical_scope_nao_vazio_ck",
      sql`jsonb_array_length(${t.canonicalScope}) > 0`,
    ),
  ],
);

/**
 * Por que duas vigências ativas viraram uma.
 *
 * Responde "onde foram parar os dados da vigência X" quando uma fusão — a da
 * migration `0016` ou a que o `promote` faz ao receber um arquivo parcial —
 * tirou de cena a vigência que alguém procura.
 */
export const snapshotMergeTable = pgTable("snapshot_merge", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Cascata: esta linha descreve aquela revisão e não sobrevive a ela. */
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => snapshotTable.id, { onDelete: "cascade" }),
  /** As vigências que entraram nela, na ordem de precedência aplicada. */
  mergedFrom: uuid("merged_from").array().notNull(),
  revisoesOriginais: integer("revisoes_originais").array().notNull(),
  /** O de-para completo da renumeração: `{snapshot_id: {de, para}}`. */
  renumeracao: jsonb("renumeracao").notNull().default({}),
  canonicalSnapshotKey: text("canonical_snapshot_key").notNull(),
  motivo: text("motivo").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const snapshotScopeTable = pgTable(
  "snapshot_scope",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => snapshotTable.id),
    scopeId: uuid("scope_id")
      .notNull()
      .references(() => scopeTable.id),
  },
  (t) => [
    uniqueIndex("snapshot_scope_uq").on(t.snapshotId, t.scopeId),
    index("snapshot_scope_snapshot_idx").on(t.snapshotId),
  ],
);

/**
 * The remuneration hierarchy, built by curation rather than by import.
 *
 * Nothing in the Freightec export says "custo fixo"; the classification is
 * ours. Depth is free — `parent_id` is self-referential and `path` carries the
 * materialised ancestry so a subtree query is a single prefix match.
 *
 * History lives in `curation_event`: reclassifying an attribute records the
 * before and after there, so the past is recoverable without duplicating nodes.
 */
export const taxonomyNodeTable = pgTable(
  "taxonomy_node",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => taxonomyNodeTable.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** ROOT | CLASS | GROUP | SUBGROUP | ... — text, so depth stays open. */
    kind: text("kind").notNull(),
    /**
     * **Morta.** Ninguém lê, ninguém escreve, e a migration 0030 a zerou.
     *
     * A classe de custo saiu daqui e virou `attribute.cost_class`: ela nunca foi
     * propriedade da natureza — `Pessoal e encargos` é fixo no cavalo e variável
     * no trecho —, e enquanto morou no nó a árvore precisava de um nó por
     * combinação das duas.
     *
     * A coluna continua declarada por uma razão operacional, e não conceitual:
     * derrubá-la agora faria a proposta do Publishing **removê-la de Production**
     * antes de Production ter rodado a fila, que é DDL destrutivo fora de ordem —
     * exatamente o que `textoDaProposta` existe para impedir. O `DROP` é uma
     * migration de uma linha, no dia em que Production estiver em dia.
     */
    costClass: text("cost_class"),
    /** Materialised ancestry, e.g. "remuneracao/custo_fixo/frota_cavalo". */
    path: text("path").notNull(),
    depth: integer("depth").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    /**
     * Quem criou o nó, quando alguém o criou.
     *
     * Nulo para a árvore inicial e para os nós anteriores a esta coluna — que é
     * uma resposta, e não uma lacuna: aquela árvore veio com o produto e está
     * em `DEFAULT_TAXONOMY`, revisável num pull request. Uma categoria criada
     * na tela de confirmação tem autor, e tem de ter: ela passa a classificar
     * dinheiro nas telas de custo fixo e variável, e uma classificação que
     * ninguém assinou é a mesma coisa que uma confirmação sem responsável.
     *
     * O evento em `curation_event` também registra a criação. Os dois convivem
     * pelo mesmo motivo que `attribute.confirmed_by` convive com o histórico:
     * ler quem criou uma categoria não pode custar uma varredura do log.
     */
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("taxonomy_node_path_uq").on(t.path),
    uniqueIndex("taxonomy_node_code_uq").on(t.code),
    index("taxonomy_node_parent_idx").on(t.parentId),
  ],
);

/**
 * The stable identity of a variable, plus everything we know — and admit we
 * do not know — about what it means.
 */
export const attributeTable = pgTable(
  "attribute",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Internal slug, e.g. "cavalo.ipva_licenciamento". */
    code: text("code").notNull(),
    /** The literal column name from the file. Never rewritten. */
    sourceName: text("source_name").notNull(),
    displayName: text("display_name"),
    entityType: text("entity_type").notNull(),
    /** NUMERIC | TEXT | BOOLEAN | DATE — text, so new kinds need no migration. */
    dataType: text("data_type").notNull(),
    unit: text("unit"),
    periodicity: text("periodicity"),
    aggregation: text("aggregation"),
    /**
     * The gate. Import can only ever produce UNKNOWN or PRESUMED; promotion to
     * CONFIRMED is a human curation act (F2). Nothing below CONFIRMED may enter
     * a financial aggregation.
     */
    semanticsStatus: semanticsStatus("semantics_status")
      .notNull()
      .default("UNKNOWN"),
    isMonetary: boolean("is_monetary"),

    /**
     * O significado econômico confirmado — a afirmação de que os quatro campos
     * acima são derivação.
     *
     * Nulo em tudo que foi curado antes da autoridade semântica existir, e isso
     * é deliberado: os quatro campos técnicos continuam válidos e continuam
     * sendo o que o motor lê, então nenhum número muda por esta coluna estar
     * vazia. A tela resolve o significado de volta a partir deles
     * (`significadoPara`), de modo que uma coluna confirmada em 10/08/2026
     * aparece na tela nova como "R$ por mês" sem que nada tenha sido reescrito.
     *
     * Preenchê-la é o caminho de mão única: daqui para a frente toda
     * confirmação grava o significado **e** a derivação dele, e a derivação
     * deixa de ser digitável.
     */
    meaningId: uuid("meaning_id").references(() => semanticMeaningTable.id),

    /** Position in the remuneration hierarchy. Set by curation, never by import. */
    taxonomyNodeId: uuid("taxonomy_node_id").references(
      () => taxonomyNodeTable.id,
    ),
    /**
     * What the column *is*, written by whoever knows.
     *
     * The three prose fields around here answer three different questions, and
     * conflating them is what left this one missing for so long:
     * `semantics_rationale` is why the *engine* proposed something and is
     * overwritten by the next confirmation; `curation_event.reason` is why a
     * *person* confirmed on a given day; this is what the column means, which
     * is the only one of the three a curator can answer on day one.
     *
     * Writing it never moves `semantics_status`. Prose does not unlock money —
     * a confirmation does, and that still costs unit, periodicity and
     * aggregation. Splitting the two is the whole point: the meaning can be
     * recorded months before anyone can say whether the figure is monthly.
     */
    definition: text("definition"),
    /**
     * Why the current semantics were proposed. Written whenever the engine
     * moves an attribute to PRESUMED, so a curator sees the reasoning rather
     * than a bare guess.
     */
    semanticsRationale: text("semantics_rationale"),

    /**
     * Which way the money moves when this number moves — **from the
     * carrier's side**.
     *
     * HIGHER_IS_BETTER | HIGHER_IS_WORSE | NEUTRAL | DEPENDS_ON_FORMULA.
     *
     * The point of view is half the fact: a higher negotiated consumption
     * lowers the litres reimbursed, which is worse for whoever hauls and
     * better for whoever contracts. Stored without saying whose side it is,
     * the field would read inverted depending on who reads it.
     *
     * Free text for the same reason as `calculation_basis`: a fifth category
     * should not cost a migration. `NULL` means nobody has curated it — which
     * is not `NEUTRAL`, and the difference matters to anything that reasons
     * over this.
     */
    economicDirection: text("economic_direction"),
    /**
     * The direction in one sentence, written by whoever knows: "more km per
     * litre recognised means fewer litres reimbursed for the same distance".
     *
     * Same spirit as `definition`, and the reason both exist: a code sorts and
     * filters, a sentence explains. Anything that has to say *why* needs the
     * second.
     */
    economicEffect: text("economic_effect"),
    /**
     * FIXO | VARIAVEL | NAO_APLICAVEL | null — **do atributo, não do nó**.
     *
     * A taxonomia responde o que o valor é; esta coluna responde como ele se
     * comporta. Morava no nó da taxonomia e herdava para baixo, o que obrigava a
     * árvore a ter um nó por combinação das duas: `Pessoal e encargos` é fixo
     * quando descreve o cavalo e variável quando descreve o trecho, e com a
     * classe no nó "o que é isto?" passava a ter duas respostas conforme o
     * contexto. Ver a migration 0030.
     *
     * `NAO_APLICAVEL` é afirmação, não lacuna — cadastro e direcionador
     * operacional não são custo, e carimbá-los FIXO os poria num total. `null` é
     * "ninguém decidiu ainda".
     */
    costClass: text("cost_class"),
    /**
     * A regra pela qual esta coluna muda de valor, escrita por quem a conhece.
     *
     * Texto livre, e pelo mesmo motivo de `calculation_basis`: o vocabulário
     * das regras de reajuste é da operação do cliente, não nosso. "Revisão
     * semestral", "reajusta por IPCA na virada do contrato", "muda quando a
     * Ambev renegocia a tabela" — nenhuma dessas cabe numa lista fechada, e uma
     * lista fechada faria quem sabe a regra escolher a opção menos errada.
     *
     * É prosa, e portanto não move dinheiro: escrevê-la nunca toca
     * `semantics_status`, exatamente como `definition`. A diferença entre as
     * três frases desta tabela é a pergunta que cada uma responde —
     * `definition` diz o que a coluna é, `calculation_basis` diz como o número
     * é produzido hoje, e esta diz o que faz esse número deixar de ser o que é.
     *
     * Fica em `attribute`, e não na versão da semântica, de propósito: é a
     * regra de mudança, e não um valor que muda com ela. Guardá-la em
     * `attribute_semantics` faria a planilha de atributos recusar a célula de
     * toda coluna sem versão — que é o beco em que `calculation_basis` cai, e
     * que `notWritten` existe para explicar.
     */
    changeRule: text("change_rule"),
    /** Only a human writes these two, and only for CONFIRMED. */
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    firstSeenImportRunId: uuid("first_seen_import_run_id").references(
      () => importRunTable.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("attribute_code_uq").on(t.code),
    index("attribute_entity_type_idx").on(t.entityType),
  ],
);

/**
 * Normalisation without losing the origin. A column name is bound to an
 * attribute here; an unconfirmed binding never feeds a calculation.
 */
export const attributeAliasTable = pgTable(
  "attribute_alias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributeTable.id),
    sourceName: text("source_name").notNull(),
    sourceSheet: text("source_sheet").notNull(),
    matchConfidence: numeric("match_confidence", { precision: 5, scale: 4 }),
    firstSeenImportRunId: uuid("first_seen_import_run_id").references(
      () => importRunTable.id,
    ),
    confirmedBy: text("confirmed_by"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("attribute_alias_source_uq").on(t.sourceName, t.sourceSheet),
    index("attribute_alias_attribute_idx").on(t.attributeId),
  ],
);

/**
 * Which attributes the layout actually carried in a given snapshot.
 *
 * This is what makes ATTRIBUTE_REMOVED ("the column stopped existing")
 * distinguishable from VALUE_MISSING ("the column is there, this asset has no
 * value") when the comparison engine arrives in F3.
 */
export const snapshotAttributeTable = pgTable(
  "snapshot_attribute",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => snapshotTable.id),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributeTable.id),
    sourceSheet: text("source_sheet").notNull(),
    columnIndex: integer("column_index").notNull(),
    presentInLayout: boolean("present_in_layout").notNull().default(true),
    valueCount: integer("value_count").notNull().default(0),
    nullCount: integer("null_count").notNull().default(0),
  },
  (t) => [
    uniqueIndex("snapshot_attribute_uq").on(t.snapshotId, t.attributeId),
    index("snapshot_attribute_snapshot_idx").on(t.snapshotId),
    /* Apagar uma coluna do dicionário confere esta ligação; sem índice, cada
       linha apagada varre a tabela inteira (ver `fact_attribute_idx`). */
    index("snapshot_attribute_attribute_idx").on(t.attributeId),
  ],
);

/**
 * The grain of the system: (snapshot, entity, attribute) -> value.
 *
 * Not partitioned. The indexes below are the ones a partitioned table would
 * need anyway, and `snapshot_id` leads every one of them, so range-partitioning
 * on it later is a mechanical change. We partition when measurements say so.
 */
export const factTable = pgTable(
  "fact",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => snapshotTable.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entityTable.id),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => attributeTable.id),

    /** NUMERIC, never float. Money and quantities alike. */
    valueNumeric: numeric("value_numeric", { precision: 18, scale: 6 }),
    valueText: text("value_text"),
    valueBoolean: boolean("value_boolean"),
    valueDate: date("value_date", { mode: "string" }),

    /** Normalised representation, so diffing is a hash comparison. */
    valueHash: text("value_hash").notNull(),

    /**
     * Absence is not zero. `is_null = false` with `value_numeric = 0` is a
     * true economic zero; `is_null = true` carries a reason below.
     */
    isNull: boolean("is_null").notNull().default(false),
    /**
     * EMPTY | SENTINEL | NOT_APPLICABLE | INVALID | VALUE_MISSING | ...
     * Free text on purpose — new states will surface as we learn the source.
     */
    nullReason: text("null_reason"),

    /** Traceability is mandatory: every fact points at its originating cell. */
    /**
     * A revisão de onde este fato foi herdado.
     *
     * Preenchido quando uma revisão parcial carrega junto os componentes que o
     * arquivo não tocou — as carretas de uma vigência corrigida só nos cavalos.
     * O fato é do snapshot, mas não nasceu deste arquivo, e o balanço de massa
     * precisa dessa diferença para fechar.
     */
    inheritedFromSnapshotId: uuid("inherited_from_snapshot_id"),
    rawCellId: bigint("raw_cell_id", { mode: "number" })
      .notNull()
      .references(() => rawCellTable.id),

    /**
     * A importação que de fato trouxe este fato — nunca a que o carregou adiante.
     *
     * É o mesmo que a cadeia `raw_cell → raw_row → raw_sheet → import_run` já
     * responde, materializado aqui por uma razão de semântica e outra de custo.
     *
     * **Semântica.** `snapshot.import_run_id` é um valor só por vigência, e vira
     * o da última revisão que a tocou. Uma revisão parcial que herda os
     * componentes que não toca faz os fatos herdados passarem a viver sob o
     * `import_run_id` dela, embora tenham nascido em outro arquivo. Ocultar a
     * importação de origem, então, não os alcançava: o filtro olhava o dono da
     * vigência, não a origem do fato. Herdar um fato não pode trocar a origem
     * dele, e esta coluna é o que faz a origem sobreviver à herança.
     *
     * **Custo.** O filtro precisa valer em toda leitura de fato; resolvê-lo pela
     * cadeia exigiria três junções por consulta sobre a maior tabela do sistema.
     *
     * **`NOT NULL`, e o banco já dizia isso.** A `0061` prova que todo fato tem
     * origem — `raw_cell_id` é obrigatório, toda célula pertence a uma
     * importação — e fecha a coluna com `SET NOT NULL` depois de conferir o
     * backfill linha a linha. Aqui a obrigatoriedade tinha ficado de fora, e a
     * diferença não era cosmética: o passo de schema do Publishing compara este
     * arquivo com o banco, e o que ele proporia é `DROP NOT NULL` — desfazer,
     * em Production e por fora da fila, a garantia que a migration estabeleceu.
     * Quem encontrou a divergência foi `meta-snapshots`, comparando o snapshot
     * com um banco criado pelas migrations até aquele ponto.
     */
    originImportRunId: uuid("origin_import_run_id")
      .notNull()
      .references(() => importRunTable.id),
  },
  (t) => [
    uniqueIndex("fact_grain_uq").on(t.snapshotId, t.entityId, t.attributeId),
    /** Attribute-major: "this variable across the fleet, in this vigência". */
    index("fact_snapshot_attribute_idx").on(
      t.snapshotId,
      t.attributeId,
      t.entityId,
    ),
    /** Entity-major: "everything about this asset, in this vigência". */
    index("fact_snapshot_entity_idx").on(t.snapshotId, t.entityId),
    /** History of one variable for one asset, across vigências. */
    index("fact_entity_attribute_idx").on(t.entityId, t.attributeId),
    index("fact_raw_cell_idx").on(t.rawCellId),
    /* O filtro de importação oculta entra por aqui, em toda leitura de fato. */
    index("fact_origin_import_run_idx").on(t.originImportRunId),
    /*
      Chave estrangeira sem índice é varredura por linha apagada.

      Excluir uma importação apaga dezenas de milhares de fatos, e cada um deles
      obriga o Postgres a conferir quem aponta para ele. Sem estes índices a
      conferência é uma varredura sequencial por linha — a exclusão de um
      arquivo real levava 28 segundos, e 2 com eles. O índice existe pelo
      caminho de escrita, não pelo de leitura.
    */
    index("fact_attribute_idx").on(t.attributeId),
    check(
      "fact_exactly_one_value",
      sql`(
        (CASE WHEN ${t.valueNumeric} IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN ${t.valueText}    IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN ${t.valueBoolean} IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN ${t.valueDate}    IS NOT NULL THEN 1 ELSE 0 END)
        = CASE WHEN ${t.isNull} THEN 0 ELSE 1 END
      )`,
    ),
    check(
      "fact_null_reason_requires_null",
      sql`(${t.isNull} = true AND ${t.nullReason} IS NOT NULL)
          OR (${t.isNull} = false AND ${t.nullReason} IS NULL)`,
    ),
  ],
);

/**
 * O registro de uma correção de identidade de equipamento.
 *
 * Renomear um `entity_type` é a operação mais séria que este banco aceita fora
 * da importação: ela mexe em identidade de ativo, no código de cada coluna do
 * dicionário e na cobertura declarada de vigências já fechadas. Uma operação
 * assim não pode acontecer sem deixar rastro — quem, quando, de quê para quê,
 * quanta coisa moveu e, principalmente, **o que ela se recusou a mover**.
 *
 * O que a correção não move fica em `skipped`: uma coluna cujo código novo já
 * existe não pode ser renomeada para cima da outra, porque os fatos das duas
 * são imutáveis e não há como fundi-las sem reescrever o passado. A correção
 * então deixa as duas onde estão e diz quais são, em vez de escolher uma.
 */
export const entityTypeCorrectionTable = pgTable("entity_type_correction", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromEntityType: text("from_entity_type").notNull(),
  toEntityType: text("to_entity_type").notNull(),
  attributesRenamed: integer("attributes_renamed").notNull().default(0),
  attributesSkipped: integer("attributes_skipped").notNull().default(0),
  entitiesRenamed: integer("entities_renamed").notNull().default(0),
  snapshotsRenamed: integer("snapshots_renamed").notNull().default(0),
  snapshotsSkipped: integer("snapshots_skipped").notNull().default(0),
  changesRelabelled: integer("changes_relabelled").notNull().default(0),
  stagedFactsRenamed: integer("staged_facts_renamed").notNull().default(0),
  /** Uma entrada por coisa que a correção se recusou a mover, com o motivo. */
  skipped: jsonb("skipped").notNull().default([]),
  /** Nunca nulo: uma correção sem autor não é auditável. */
  appliedBy: text("applied_by").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
