import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  bigserial,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { importRunStatus, sheetRole } from "./enums";

/**
 * RAW layer — the documentary evidence.
 *
 * INVARIANT: every table in this file is append-only. UPDATE and DELETE are
 * blocked by database triggers (see migration `0001_raw_immutability`), not by
 * application convention. If the parser improves, we re-derive STAGING and
 * CANONICAL from RAW; RAW itself is never rewritten.
 */

/**
 * A file as received. Deduplicated by content hash.
 *
 * `source_file` is deliberately NOT the same thing as an import attempt, and
 * neither is the same thing as a snapshot: one file may be processed many
 * times (import_run) and may contain many vigências (snapshot).
 */
export const sourceFileTable = pgTable(
  "source_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    /** SHA-256 of the exact bytes received. First line of idempotency defence. */
    contentSha256: text("content_sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    mimeType: text("mime_type"),
    /** Where the untouched original is preserved. Never overwritten. */
    storagePath: text("storage_path").notNull(),
    sourceSystem: text("source_system").notNull().default("FREIGHTEC"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    receivedBy: text("received_by"),
  },
  (t) => [uniqueIndex("source_file_sha256_uq").on(t.contentSha256)],
);

/**
 * One attempt at processing one file. Failed attempts are kept: "nunca
 * descarte silenciosamente" applies to our own operations too.
 */
export const importRunTable = pgTable(
  "import_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFileTable.id),
    status: importRunStatus("status").notNull().default("PENDING"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    triggeredBy: text("triggered_by"),
    rawSheetCount: integer("raw_sheet_count").notNull().default(0),
    rawRowCount: integer("raw_row_count").notNull().default(0),
    rawCellCount: integer("raw_cell_count").notNull().default(0),
    stagedFactCount: integer("staged_fact_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    /** Populated on promotion; how many snapshots this run produced. */
    snapshotCount: integer("snapshot_count").notNull().default(0),
    failureReason: text("failure_reason"),
    /**
     * O tipo que quem enviou declarou — a aba da tela em que ele escolheu.
     *
     * Nulo quer dizer "ninguém declarou", que é como toda importação anterior
     * a esta coluna entrou: o tipo saía do conteúdo, e continua saindo. O que
     * a declaração acrescenta é uma segunda resposta para a mesma pergunta, e
     * a importação compara as duas — ver `lib/ingest/src/tipos.ts`.
     */
    declaredType: text("declared_type"),
    /**
     * O run que este aqui releu — nulo em toda importação que é a primeira
     * leitura do seu arquivo.
     *
     * Reprocessar é reler um `source_file` que já entrou, porque o leitor mudou
     * desde a primeira vez. O run novo não substitui o antigo nem o apaga: ele
     * aponta para ele. É isso que permite a tela dizer "esta é uma releitura
     * daquela de 18/08" em vez de mostrar dois recebimentos do mesmo arquivo
     * como se fossem coincidência.
     */
    reprocessOfRunId: uuid("reprocess_of_run_id"),
    /**
     * Por que se releu — obrigatório para quem aponta, e conferido pelo banco
     * (`import_run_reprocess_completo`).
     *
     * Um reprocessamento contorna de propósito a defesa que impede o mesmo
     * arquivo de entrar duas vezes. A frase é o que separa isso de um clique a
     * mais: quem pede tem de saber o que mudou desde a primeira leitura, e
     * quem ler o histórico daqui a três meses tem de encontrar essa resposta
     * sem precisar reconstituir a data de um commit.
     *
     * **É esta coluna, e não o ponteiro, que diz "isto é uma releitura".** O
     * ponteiro pode ficar nulo quando a leitura relida é excluída — o que é
     * legítimo, e é o passo final de corrigir um arquivo que entrou sob o tipo
     * errado. A razão sobrevive, porque ela é o fato de auditoria.
     */
    reprocessReason: text("reprocess_reason"),
    /**
     * Quando não-nulo, este run — e todos os fatos de todas as suas
     * vigências — fica de fora de todo agregado (dashboard, comparativo,
     * cobertura, DRE...). Reversível: `NULL` de novo mostra tudo outra vez.
     *
     * Não é exclusão nem é revisão. `import_deletion` (ver `deletion.ts`)
     * apaga de verdade; `snapshot.status = SUPERSEDED` diz "uma revisão mais
     * nova existe". Ocultar não é nenhum dos dois — o dado continua o mesmo,
     * só para de contar enquanto quem importou está com outro arquivo em
     * mãos.
     */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: text("hidden_by"),
    hiddenReason: text("hidden_reason"),
  },
  (t) => [
    index("import_run_source_file_idx").on(t.sourceFileId),
    index("import_run_hidden_at_idx")
      .on(t.id)
      .where(sql`${t.hiddenAt} IS NOT NULL`),
    /**
     * No máximo um run por decidir por arquivo — a trava contra o
     * reprocessamento repetido, decidida pelo banco e não por um SELECT antes
     * do INSERT. Ver `0040_reprocessamento.sql`; os estados terminais ficam de
     * fora porque é sobre eles que se reprocessa.
     */
    uniqueIndex("import_run_leitura_aberta_uq")
      .on(t.sourceFileId)
      .where(
        sql`${t.status} IN ('PENDING', 'READING', 'STAGED', 'PREVIEWED', 'PROMOTING')`,
      ),
  ],
);

/**
 * A worksheet inside the file. Pivot tables are captured in RAW like
 * everything else — they are evidence — but `role` keeps them out of the
 * canonical fact stream.
 */
export const rawSheetTable = pgTable(
  "raw_sheet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id),
    sheetName: text("sheet_name").notNull(),
    sheetIndex: integer("sheet_index").notNull(),
    rowCount: integer("row_count").notNull(),
    columnCount: integer("column_count").notNull(),
    role: sheetRole("role").notNull(),
    /** Why the classifier decided this role. Auditable, never a bare guess. */
    roleReason: text("role_reason").notNull(),
    headerRowIndex: integer("header_row_index"),
  },
  (t) => [
    uniqueIndex("raw_sheet_run_index_uq").on(t.importRunId, t.sheetIndex),
    index("raw_sheet_run_idx").on(t.importRunId),
  ],
);

export const rawRowTable = pgTable(
  "raw_row",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rawSheetId: uuid("raw_sheet_id")
      .notNull()
      .references(() => rawSheetTable.id),
    /** 1-based physical row number in the worksheet, as a human would count it. */
    rowIndex: integer("row_index").notNull(),
    isHeader: boolean("is_header").notNull().default(false),
  },
  (t) => [uniqueIndex("raw_row_sheet_index_uq").on(t.rawSheetId, t.rowIndex)],
);

/**
 * The end of the traceability chain. Every canonical number must be able to
 * point at exactly one of these rows.
 */
export const rawCellTable = pgTable(
  "raw_cell",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rawRowId: bigint("raw_row_id", { mode: "number" })
      .notNull()
      .references(() => rawRowTable.id),
    /** 0-based position, and the spreadsheet letter, so a human can find it. */
    columnIndex: integer("column_index").notNull(),
    columnLetter: text("column_letter").notNull(),
    /** Header text exactly as it appears in the file — never normalised. */
    columnHeader: text("column_header"),
    /** The value as text, always. Typing happens in STAGING, not here. */
    rawValue: text("raw_value"),
    /**
     * SheetJS cell type as delivered: n | s | b | d | e | z.
     * Kept because the file mixes representations for the same concept
     * (e.g. dates arriving both as `d` and as a bare `n` serial).
     */
    sourceType: text("source_type").notNull(),
    /** Excel's own formatted text, when present. Useful for date forensics. */
    formattedText: text("formatted_text"),
  },
  (t) => [
    uniqueIndex("raw_cell_row_column_uq").on(t.rawRowId, t.columnIndex),
    index("raw_cell_row_idx").on(t.rawRowId),
  ],
);

/**
 * Por que o pipeline decidiu o que decidiu, uma linha por decisão.
 *
 * Existe para que "por que esse arquivo não entrou?" tenha resposta sem ler
 * log. A recusa por duplicata é o caso que mais precisa disso: ela é
 * silenciosa por natureza — nada muda no banco canônico —, e sem registro o
 * operador só vê que o número dele não apareceu.
 *
 * Guarda o que sustentou a decisão: o arquivo e seu SHA-256, o hash canônico do
 * conteúdo, a identidade calculada, a vigência, o escopo, a família, e qual
 * revisão foi encontrada ou criada. `ON DELETE CASCADE` acompanha a exclusão do
 * run: a auditoria de uma importação apagada vive em `import_deletion`, que é
 * permanente, e não aqui.
 */
export const importDecisionTable = pgTable(
  "import_decision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id, { onDelete: "cascade" }),
    /**
     * RECEBIDO | DUPLICATA_DE_ARQUIVO | DUPLICATA_DE_DADOS |
     * VIGENCIA_ATIVA_EXISTENTE | ESCOPO_OBRIGATORIO_AUSENTE |
     * ENTIDADE_CONFLITANTE | PROMOVIDO | REVISAO_CRIADA
     *
     * Texto e não enum: uma decisão nova não deve exigir migration.
     */
    decisao: text("decisao").notNull(),
    /** A frase que vai para a tela, escrita para quem opera. */
    motivo: text("motivo").notNull(),
    filename: text("filename"),
    contentSha256: text("content_sha256"),
    canonicalPayloadHash: text("canonical_payload_hash"),
    canonicalSnapshotKey: text("canonical_snapshot_key"),
    sourceLabel: text("source_label"),
    effectiveDate: date("effective_date", { mode: "string" }),
    canal: text("canal"),
    datasetFamily: text("dataset_family"),
    canonicalScope: jsonb("canonical_scope"),
    snapshotId: uuid("snapshot_id"),
    revisionEncontrada: integer("revision_encontrada"),
    revisionCriada: integer("revision_criada"),
    detalhe: jsonb("detalhe"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("import_decision_run_idx").on(t.importRunId),
    index("import_decision_key_idx").on(t.canonicalSnapshotKey),
    index("import_decision_sha_idx").on(t.contentSha256),
  ],
);
