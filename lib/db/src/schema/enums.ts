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
  "SKIPPED_DUPLICATE",
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
