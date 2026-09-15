import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enums are reserved for *closed* internal state machines.
 *
 * Anything that describes the shape of the incoming Freightec data
 * (entity types, units, null reasons, identifier types, ...) is stored as
 * `text` on purpose: the architecture requires absorbing variables and
 * states that the Ambev may invent later, without a migration.
 */

/** Lifecycle of a single processing attempt over a source file. */
export const importRunStatus = pgEnum("import_run_status", [
  "PENDING",
  "READING",
  "STAGED",
  "PREVIEWED",
  "PROMOTING",
  "PROMOTED",
  "FAILED",
  "ABORTED",
  /**
   * O arquivo já havia sido recebido, byte a byte. Primeira camada, decidida
   * antes de qualquer leitura, pelo SHA-256 do conteúdo.
   */
  "SKIPPED_DUPLICATE",
  /**
   * O arquivo é outro, mas os dados normalizados desta vigência são idênticos
   * aos que já estão ativos. Nenhuma revisão foi aberta — abrir uma revisão que
   * não muda nada é ruído de auditoria, não registro.
   */
  "SKIPPED_DUPLICATE_DATA",
  /**
   * O arquivo foi lido, mas não pode ser promovido: falta um componente
   * obrigatório da identidade (escopo), ou a mesma entidade aparece duas vezes
   * com informações conflitantes. Não é falha técnica — é o dado que não fecha.
   */
  "VALIDATION_ERROR",
  /**
   * Quem enviou desistiu — e desistiu **antes** de o dado entrar.
   *
   * É o único estado terminal que uma pessoa escreve de propósito. ABORTED
   * descreve um acidente (o processo que lia morreu com o reinício) e
   * VALIDATION_ERROR descreve a planilha; este descreve uma decisão, e por isso
   * não pode ser nenhum dos dois: quem lê o histórico daqui a três meses precisa
   * distinguir "o servidor caiu no meio" de "mandei o arquivo errado e parei".
   *
   * Vale para os dois momentos em que dá para desistir — a leitura em curso e a
   * aprovação em curso —, e em ambos a promessa é a mesma: nada entrou. A
   * aprovação roda numa transação só, então parar no meio dela é o `ROLLBACK`
   * que o banco já sabia fazer.
   */
  "CANCELLED",
]);

/**
 * DRAFT     — being assembled inside a transaction, never observed by readers.
 * CLOSED    — immutable. Enforced by trigger, not by convention.
 * SUPERSEDED— replaced by a newer revision of the same business key.
 */
export const snapshotStatus = pgEnum("snapshot_status", [
  "DRAFT",
  "CLOSED",
  "SUPERSEDED",
]);

/** How a worksheet was classified during RAW capture. */
export const sheetRole = pgEnum("sheet_role", ["SOURCE", "PIVOT", "UNKNOWN"]);

export const issueSeverity = pgEnum("issue_severity", [
  "ERROR",
  "WARNING",
  "INFO",
]);

/** Outcome of resolving one spreadsheet column to a canonical attribute. */
export const mappingStatus = pgEnum("mapping_status", [
  "MAPPED",
  "NEW",
  "AMBIGUOUS",
  "IGNORED",
]);

/**
 * Gate that protects every financial number in the product.
 * Only CONFIRMED attributes may ever enter an aggregation (enforced from F4 on).
 */
export const semanticsStatus = pgEnum("semantics_status", [
  "CONFIRMED",
  "PRESUMED",
  "UNKNOWN",
]);

export const stagedFactStatus = pgEnum("staged_fact_status", [
  "VALID",
  "WARNING",
  "REJECTED",
]);

/**
 * Os dois jeitos de uma regra do Book do Operador entrar no sistema.
 *
 * `DOCUMENTO` é o arquivo anexado — contrato, manual, planilha de apoio.
 * `TEXTO` é a regra escrita direto na tela, que é o que serve quando ela cabe
 * em três parágrafos e não existe arquivo para anexar. É enum e não booleano
 * porque um terceiro tipo é plausível (um link para o Freightech, por
 * exemplo), e `is_document = false` já teria deixado de significar "é texto"
 * naquele dia.
 */
export const bookEntryKind = pgEnum("book_entry_kind", ["DOCUMENTO", "TEXTO"]);

/**
 * O ciclo de um envio de export de chamados.
 *
 * É curto de propósito, e não uma cópia de `import_run_status`. Chamados não
 * viram fato canônico nem vigência: não há staging para conferir nem promoção
 * para aprovar, então os estados intermediários daquele pipeline aqui seriam
 * degraus que ninguém sobe. `READ` é o estado final feliz — o arquivo foi lido
 * e os chamados estão no banco.
 */
export const ticketImportStatus = pgEnum("ticket_import_status", [
  "PENDING",
  "READING",
  "READ",
  "FAILED",
  "SKIPPED_DUPLICATE",
]);
