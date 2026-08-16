import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeSemanticsTable,
  attributeTable,
  curationEventTable,
} from "@workspace/db";

/**
 * Writing down what a column means, without deciding what it is worth.
 *
 * The curation screen could already record unit, periodicity, aggregation and
 * taxonomy, and all four are gates: an attribute the person cannot fully answer
 * for stays UNKNOWN, and — because confirming a monetary attribute is refused
 * without unit, periodicity *and* aggregation — nothing about it gets written
 * down at all. On the real export that produced 75 pending attributes and zero
 * confirmed. The knowledge existed; there was nowhere to put it that did not
 * also demand a decision about money.
 *
 * So this is deliberately the cheap half of curation:
 *
 * - **No reason argument.** {@link confirmAttribute} demands one because a
 *   confirmation is a claim someone will audit. A definition is not a claim
 *   about a number — it is the number's description, and asking "why did you
 *   write that?" about a description is how the field ends up empty.
 * - **No status change, ever.** `semantics_status`, `confirmed_by`,
 *   `confirmed_at` and `semantics_rationale` are not in the update below and
 *   must never be. Prose cannot unlock a financial aggregation; only
 *   {@link confirmAttribute} can, and it still costs the same three answers.
 * - **An actor is still required.** Attribution is not the expensive part, and
 *   an anonymous edit to the record of what the client's data means would be
 *   worth less than no edit.
 *
 * The reading name lives here for the same reason. Calling a column
 * "Vida útil do combustível" instead of `combustivelVidaCavalo` is a vocabulary
 * choice, not a claim about arithmetic, and the person who can make it is
 * usually the one who has not yet decided whether the number is monthly.
 */

export interface MeaningInput {
  code: string;
  /**
   * What the column is, in the curator's words.
   *
   * `undefined` leaves the stored value alone; `null` or blank clears it. The
   * distinction matters because the screen sends one field at a time.
   */
  definition?: string | null;
  /** How the source produces the number, when that is known. Same convention. */
  calculationBasis?: string | null;
  /**
   * What the column should be called on screen. Same convention.
   *
   * Naming belongs here for the reason the definition does: `combustivelVidaCavalo`
   * is unreadable in a meeting long before anyone knows whether it is monthly,
   * and charging a confirmation for the fix would keep the bad name. The literal
   * from the spreadsheet is never touched — `source_name` is how the import
   * matches the column, and it stays visible beside the alias on every screen.
   */
  displayName?: string | null;
  actor: string;
}

export interface MeaningResult {
  code: string;
  definition: string | null;
  calculationBasis: string | null;
  displayName: string | null;
  /** Untouched by this operation. Returned so a caller can prove that. */
  semanticsStatus: string;
  /** Fields that actually changed. Empty means the write was a no-op. */
  changed: string[];
}

/** Blank is not a value: a cleared textarea means "I have nothing to say here". */
function normalise(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Record what an attribute means.
 *
 * Written to two places in one transaction, and the duplication is the same one
 * the rest of the semantics layer lives with: `attribute_semantics` is the
 * truth over a stretch of the source's timeline, `attribute` is the projection
 * of whichever version is in force. Skipping the version row would make the
 * definition disappear the next time anything calls `projectCurrentVersion`.
 *
 * An attribute with no version yet — a database where the semantics backfill
 * has not run — is written to anyway, on `attribute` alone. Refusing would make
 * recording knowledge depend on a migration having been run, and
 * `backfillSemantics` carries the definition into version 1 when it does run.
 */
export async function saveMeaning(
  db: Database,
  input: MeaningInput,
): Promise<MeaningResult> {
  if (!input.actor?.trim()) {
    throw new Error("Registrar um significado exige um responsável identificado.");
  }

  const definition = normalise(input.definition);
  const calculationBasis = normalise(input.calculationBasis);
  const displayName = normalise(input.displayName);

  if (
    definition === undefined &&
    calculationBasis === undefined &&
    displayName === undefined
  ) {
    throw new Error(
      "Nada a gravar: informe o nome gerencial, o significado ou a base de cálculo.",
    );
  }

  const [attribute] = await db
    .select()
    .from(attributeTable)
    .where(eq(attributeTable.code, input.code));
  if (!attribute) throw new Error(`Atributo "${input.code}" não encontrado.`);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(attributeSemanticsTable)
      .where(
        and(
          eq(attributeSemanticsTable.attributeId, attribute.id),
          isNull(attributeSemanticsTable.effectiveUntil),
        ),
      );

    // The basis lives only on the versioned row — there is no column for it on
    // `attribute`, because "how the source calculates this" is exactly the
    // thing the IPVA case proved changes over time. Without a version there is
    // nowhere honest to put it, and saying so beats returning a value that was
    // never stored.
    //
    // Only *text* is refused. A blank basis on an attribute with no version is
    // asking to clear something that was never stored — a no-op — and refusing
    // it took the whole call down with it: the screen sends the three fields
    // together, so an untouched basis box made naming a column fail with a
    // message about backfills. Nobody who wants to write "Consumo de
    // combustível" over `combustivelVidaCavalo` can act on that, and the name
    // is precisely the field that needs nothing from the version.
    if (calculationBasis && !current) {
      throw new Error(
        `Ainda não dá para gravar "como a fonte calcula" de "${input.code}": esse campo ` +
          `pertence à versão da semântica, que este atributo ainda não tem — rode o ` +
          `backfill antes. O nome gerencial e o significado podem ser salvos normalmente.`,
      );
    }

    const nextDefinition =
      definition !== undefined ? definition : attribute.definition;
    const nextBasis =
      calculationBasis !== undefined
        ? calculationBasis
        : (current?.calculationBasis ?? null);
    /*
      O apelido não é versionado, e a diferença com a definição é deliberada:
      quando a fonte muda o que a coluna carrega, a definição anterior continua
      verdadeira para as vigências dela — mas um nome melhor é melhor para
      sempre, inclusive olhando o passado. Versioná-lo faria a mesma coluna
      aparecer com dois nomes em duas vigências da mesma tela.
    */
    const nextDisplayName =
      displayName !== undefined ? displayName : attribute.displayName;

    const changed: { field: string; before: string | null; after: string | null }[] =
      [];
    if (definition !== undefined && definition !== attribute.definition) {
      changed.push({
        field: "definition",
        before: attribute.definition,
        after: definition,
      });
    }
    if (
      calculationBasis !== undefined &&
      current &&
      calculationBasis !== current.calculationBasis
    ) {
      changed.push({
        field: "calculation_basis",
        before: current.calculationBasis,
        after: calculationBasis,
      });
    }
    if (displayName !== undefined && displayName !== attribute.displayName) {
      changed.push({
        field: "display_name",
        before: attribute.displayName,
        after: displayName,
      });
    }

    if (changed.length > 0) {
      await tx
        .update(attributeTable)
        .set({ definition: nextDefinition, displayName: nextDisplayName })
        .where(eq(attributeTable.id, attribute.id));

      if (current) {
        await tx
          .update(attributeSemanticsTable)
          .set({ definition: nextDefinition, calculationBasis: nextBasis })
          .where(eq(attributeSemanticsTable.id, current.id));
      }

      await tx.insert(curationEventTable).values(
        changed.map((c) => ({
          targetKind: "ATTRIBUTE",
          targetId: attribute.id,
          targetLabel: attribute.code,
          field: c.field,
          valueBefore: c.before,
          valueAfter: c.after,
          actor: input.actor,
          // No `reason`: the new value *is* the content. The column is nullable
          // precisely so that the events that are not confirmations can say so.
          detail: { changeKind: "MEANING" },
        })),
      );
    }

    return {
      code: attribute.code,
      definition: nextDefinition,
      calculationBasis: nextBasis,
      displayName: nextDisplayName,
      // Read back rather than echoed: the guarantee this function makes is that
      // it did not move, and asserting it from the row proves it.
      semanticsStatus: attribute.semanticsStatus,
      changed: changed.map((c) => c.field),
    };
  });
}
