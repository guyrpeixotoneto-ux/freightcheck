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
   * A regra pela qual a coluna muda de valor. Mesma convenção.
   *
   * É a terceira frase, e responde o que as outras duas não respondem:
   * `definition` diz o que a coluna é, `calculationBasis` diz como o número é
   * produzido hoje, e esta diz o que faz esse número deixar de ser o que é —
   * "revisão semestral", "reajusta por IPCA na virada do contrato". Ver
   * `attribute.change_rule`.
   */
  changeRule?: string | null;
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
  changeRule: string | null;
  displayName: string | null;
  /** Untouched by this operation. Returned so a caller can prove that. */
  semanticsStatus: string;
  /** Fields that actually changed. Empty means the write was a no-op. */
  changed: string[];
  /**
   * O campo que esta chamada trouxe e não teve onde guardar, com a frase que
   * explica isso a quem está na tela. `null` quando tudo o que veio foi gravado.
   *
   * Existe um caso só, e é o da base de cálculo num atributo sem semântica
   * versionada. Ele não é erro do pedido — o nome e a definição do mesmo envio
   * são gravados —, e por isso não sai como exceção: quem chama precisa poder
   * dizer "salvei o nome, a fórmula ainda não" na mesma tela.
   */
  notWritten: { field: string; message: string } | null;
}

/** Blank is not a value: a cleared textarea means "I have nothing to say here". */
function normalise(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A frase da base de cálculo que ficou de fora, dita para quem está na tela.
 *
 * Ela nomeia o que *foi* gravado, e não por educação: o mesmo botão salvou duas
 * coisas e deixou uma terceira para depois, e um aviso que só falasse da que
 * faltou faria a pessoa reescrever o nome que já está no banco.
 */
/**
 * A primeira letra em maiúscula, e só ela.
 *
 * Era um `replace(/^o/, "O")`, escrito quando a lista só podia começar por "o
 * nome gerencial" ou "o significado". Com "a regra de alteração" na lista, a
 * mesma expressão deixa a frase começando em minúscula — e o defeito é
 * invisível até alguém salvar a regra num atributo sem versão de semântica.
 */
function maiuscula(frase: string): string {
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

function recusaDaBase(code: string, gravados: string[]): string {
  const nomes = [
    gravados.includes("display_name") ? "o nome gerencial" : null,
    gravados.includes("definition") ? "o significado" : null,
    gravados.includes("change_rule") ? "a regra de alteração" : null,
  ].filter((n): n is string => n !== null);

  const salvo =
    nomes.length === 0
      ? "" // Nada mais mudou nesta chamada; não há o que anunciar como salvo.
      : ` ${maiuscula(nomes.join(" e "))} ${
          nomes.length === 1 ? "foi salvo" : "foram salvos"
        } normalmente.`;

  return (
    `A "fórmula de cálculo" de "${code}" ainda não foi gravada: esse campo ` +
    `pertence à versão da semântica, e este atributo não tem nenhuma. Desde a ` +
    `migration 0025 toda coluna nasce com a sua, então isto é banco com ` +
    `migration pendente — não é nada que se resolva por esta tela.${salvo}`
  );
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
  const changeRule = normalise(input.changeRule);
  const displayName = normalise(input.displayName);

  if (
    definition === undefined &&
    calculationBasis === undefined &&
    changeRule === undefined &&
    displayName === undefined
  ) {
    throw new Error(
      "Nada a gravar: informe o nome gerencial, o significado, a base de cálculo ou a regra de alteração.",
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

    /*
      The basis lives only on the versioned row — there is no column for it on
      `attribute`, because "how the source calculates this" is exactly the
      thing the IPVA case proved changes over time. Without a version there is
      nowhere honest to put it, and saying so beats returning a value that was
      never stored.

      Only *text* is held back. A blank basis on an attribute with no version is
      asking to clear something that was never stored — a no-op.

      And holding it back is all that happens: the refusal used to be an
      exception, which took the rest of the same call down with it. The screen
      sends the three fields together, so someone who wrote a name, a definition
      *and* a formula got a message about backfills promising that "o nome
      gerencial e o significado podem ser salvos normalmente" — while having
      saved neither. The only way to obey that sentence was to erase the formula
      they had just written. The promise is now kept by the code that makes it:
      the two unversioned fields are written, and the basis comes back in
      `notWritten` for the screen to say so.
    */
    const basisRefused = Boolean(calculationBasis) && !current;

    // Still an exception when the basis is the whole call: there is nothing
    // else to save, and answering "gravado" to a write that stored nothing
    // would be the same lie in the other direction.
    if (
      basisRefused &&
      definition === undefined &&
      changeRule === undefined &&
      displayName === undefined
    ) {
      throw new Error(
        `Ainda não dá para gravar "fórmula de cálculo" de "${input.code}": esse campo ` +
          `pertence à versão da semântica, e este atributo não tem nenhuma. Desde a ` +
          `migration 0025 toda coluna nasce com a sua, então isto é banco com migration ` +
          `pendente. O nome gerencial e o significado podem ser salvos normalmente.`,
      );
    }

    const nextDefinition =
      definition !== undefined ? definition : attribute.definition;
    const nextBasis =
      calculationBasis !== undefined && !basisRefused
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
    /*
      A regra de alteração não é versionada, e mora só em `attribute`.

      É a diferença com a base de cálculo, e ela é deliberada: a base descreve
      como o número era produzido *naquela vigência*, e por isso a do IPVA de
      janeiro tem de sobreviver à de julho. A regra de alteração descreve o
      contrário — o que faz a base trocar —, e ela não muda de verdade a cada
      vigência. Versioná-la só compraria o beco de `calculation_basis`: coluna
      sem versão ficaria sem onde guardar a frase, e a planilha de atributos
      recusaria a célula justamente nas colunas que ninguém olhou ainda.
    */
    const nextChangeRule =
      changeRule !== undefined ? changeRule : attribute.changeRule;

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
      !basisRefused &&
      current &&
      calculationBasis !== current.calculationBasis
    ) {
      changed.push({
        field: "calculation_basis",
        before: current.calculationBasis,
        after: calculationBasis,
      });
    }
    if (changeRule !== undefined && changeRule !== attribute.changeRule) {
      changed.push({
        field: "change_rule",
        before: attribute.changeRule,
        after: changeRule,
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
        .set({
          definition: nextDefinition,
          displayName: nextDisplayName,
          changeRule: nextChangeRule,
        })
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
      // Nunca o texto recusado: devolver o que a pessoa digitou faria a tela
      // mostrar como guardada uma fórmula que não está em lugar nenhum.
      calculationBasis: nextBasis,
      changeRule: nextChangeRule,
      displayName: nextDisplayName,
      // Read back rather than echoed: the guarantee this function makes is that
      // it did not move, and asserting it from the row proves it.
      semanticsStatus: attribute.semanticsStatus,
      changed: changed.map((c) => c.field),
      notWritten: basisRefused
        ? {
            field: "calculation_basis",
            message: recusaDaBase(input.code, changed.map((c) => c.field)),
          }
        : null,
    };
  });
}
