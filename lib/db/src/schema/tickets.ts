import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ticketImportStatus } from "./enums";

/**
 * CHAMADOS — o outro caminho pelo qual a remuneração muda.
 *
 * A planilha de vigência é o estado do cadastro num dia: comparar duas diz o
 * que a Ambev mexeu entre elas, e é disso que a aba Planilha vive. O chamado é
 * a outra metade da história — o pedido aberto no Freightech, o que se pediu,
 * o que voltou aplicado, e quanto tempo ficou parado. Um e outro respondem
 * perguntas diferentes sobre o mesmo dinheiro, e é por isso que moram em
 * tabelas separadas em vez de virarem linhas do mesmo `change`.
 *
 * **Por que não entram como `change`.** Uma linha de `change` é sempre uma
 * diferença apurada entre duas vigências fechadas, com as duas pontas
 * rastreáveis até a célula de origem. Um chamado não tem isso: ele tem um
 * pedido e uma resposta, os dois declarados pela própria fonte, sem
 * contraprova. Misturá-los faria a soma de impacto da tela deixar de fechar
 * com a comparação — que é exatamente a propriedade que este produto existe
 * para preservar.
 *
 * **A linha original fica.** `payload` guarda a linha inteira do arquivo, com
 * os cabeçalhos como vieram. O mapeamento de colunas é um palpite justificado
 * (ver `lib/ingest/src/chamados.ts`), e um palpite que descarta a evidência
 * não pode ser corrigido depois.
 */

/**
 * Um envio de export de chamados.
 *
 * Não é `import_run`, e a diferença é proposital: `import_run` é a máquina de
 * estados da planilha de vigência — RAW, staging, preview, promoção —, e todo
 * o pipeline de imutabilidade da `0001` está amarrado nela. Chamados não
 * produzem vigência nem fato canônico; ler o arquivo é o passo inteiro, e não
 * existe decisão humana no meio para justificar um portão de aprovação.
 */
export const ticketImportTable = pgTable(
  "ticket_import",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    /** SHA-256 dos bytes exatos recebidos. O mesmo arquivo não entra duas vezes. */
    contentSha256: text("content_sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    /** Onde o original ficou. Pode não existir mais; a evidência é `payload`. */
    storagePath: text("storage_path"),
    sourceSystem: text("source_system").notNull().default("FREIGHTEC"),
    status: ticketImportStatus("status").notNull().default("PENDING"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    receivedBy: text("received_by"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Linhas de dados que o arquivo trazia, cabeçalho fora. */
    rowCount: integer("row_count").notNull().default(0),
    /** Quantas viraram chamado. A diferença para `row_count` é `ignoredRowCount`. */
    ticketCount: integer("ticket_count").notNull().default(0),
    /** Linhas em branco ou sem número de chamado — contadas, nunca silenciadas. */
    ignoredRowCount: integer("ignored_row_count").notNull().default(0),
    /**
     * Que coluna do arquivo virou que campo nosso, e por quê.
     * `{ campo: { header, reason } }` — é o que a tela mostra quando alguém
     * pergunta de onde saiu "valor pedido".
     */
    columnMapping: jsonb("column_mapping").notNull().default({}),
    /** Cabeçalhos que não reconhecemos. Ficam em `payload`, e aparecem aqui. */
    unmappedColumns: jsonb("unmapped_columns").notNull().default([]),
    failureReason: text("failure_reason"),
  },
  (t) => [
    index("ticket_import_sha256_idx").on(t.contentSha256),
    index("ticket_import_received_idx").on(t.receivedAt),
  ],
);

/**
 * Um chamado, como o arquivo o descreveu.
 *
 * Os campos `*Numeric` só existem quando o texto de origem era mesmo um
 * número; `*Raw` guarda o que estava escrito de qualquer jeito. É a mesma
 * separação de `staged_fact`, e pelo mesmo motivo: "sob análise" na coluna de
 * valor não pode virar zero em lugar nenhum.
 */
export const ticketTable = pgTable(
  "ticket",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketImportId: uuid("ticket_import_id")
      .notNull()
      .references(() => ticketImportTable.id),
    /** O número do chamado no Freightech, como veio. */
    externalId: text("external_id").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** O status como o arquivo escreveu — "Em atendimento", "Concluído", … */
    statusRaw: text("status_raw"),
    /**
     * O mesmo status dobrado numa das seis caixas que a tela filtra.
     * ABERTO | EM_ANDAMENTO | ATENDIDO | RECUSADO | CANCELADO | DESCONHECIDO.
     * É `text` e não enum porque a fonte inventa status novo sem avisar, e uma
     * migration não pode ser pré-requisito para receber um arquivo.
     */
    statusBucket: text("status_bucket").notNull().default("DESCONHECIDO"),
    /** O parâmetro que o chamado mexe, como o arquivo o nomeia. */
    parameterLabel: text("parameter_label"),
    /** O mesmo parâmetro resolvido no dicionário, quando reconhecido. */
    attributeCode: text("attribute_code"),
    /** A placa, quando o chamado é de um ativo específico. */
    entityLabel: text("entity_label"),
    entityType: text("entity_type"),
    requestedValueRaw: text("requested_value_raw"),
    requestedValueNumeric: numeric("requested_value_numeric", {
      precision: 18,
      scale: 6,
    }),
    appliedValueRaw: text("applied_value_raw"),
    appliedValueNumeric: numeric("applied_value_numeric", {
      precision: 18,
      scale: 6,
    }),
    /**
     * Aplicado menos pedido, quando os dois são número e o chamado já foi
     * atendido. Negativo quer dizer que voltou menos do que se pediu.
     */
    impactAmount: numeric("impact_amount", { precision: 18, scale: 6 }),
    /** CALCULATED | NOT_CALCULABLE — a mesma porta que a aba Planilha usa. */
    impactConfidence: text("impact_confidence").notNull().default("NOT_CALCULABLE"),
    /** Por que não deu para apurar. Escrito para quem opera, nunca vazio à toa. */
    impactReason: text("impact_reason"),
    requestedBy: text("requested_by"),
    /** Texto livre do chamado — assunto, descrição, o que a fonte trouxer. */
    subject: text("subject"),
    /** Linha física do arquivo, 1-based, como uma pessoa a contaria. */
    sourceRowIndex: integer("source_row_index").notNull(),
    /** A linha inteira como veio, cabeçalho original por chave. */
    payload: jsonb("payload").notNull().default({}),
  },
  (t) => [
    uniqueIndex("ticket_import_row_uq").on(t.ticketImportId, t.sourceRowIndex),
    index("ticket_import_idx").on(t.ticketImportId),
    index("ticket_external_id_idx").on(t.externalId),
    index("ticket_status_bucket_idx").on(t.statusBucket),
    index("ticket_attribute_idx").on(t.attributeCode),
  ],
);
