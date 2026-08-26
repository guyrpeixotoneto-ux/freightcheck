import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  attributeTable,
  entityIdentifierTable,
  entityTable,
  factTable,
  importRunTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  snapshotAttributeTable,
  snapshotEntityTypeTable,
  snapshotTable,
  sourceFileTable,
  taxonomyNodeTable,
} from "@workspace/db";

/**
 * Synthetic canonical fixtures.
 *
 * The comparison engine reads the canonical layer, so a test can build that
 * layer directly and control exactly one variable at a time — something the
 * real 83k-fact export cannot do. Every fact still gets a real RAW cell behind
 * it, because the engine's traceability guarantees are part of what is
 * under test.
 */

export interface AttributeSpec {
  code: string;
  dataType: "NUMERIC" | "TEXT" | "BOOLEAN" | "DATE" | "MIXED";
  semanticsStatus?: "CONFIRMED" | "PRESUMED" | "UNKNOWN";
  unit?: string | null;
  periodicity?: string | null;
  aggregation?: string | null;
  isMonetary?: boolean | null;
  taxonomyCode?: string;
  /**
   * Como o atributo se comporta — FIXO, VARIAVEL, NAO_APLICAVEL.
   *
   * Separado de `taxonomyCode` porque as duas respostas são separadas desde a
   * migration 0030: a categoria diz o que o valor é, esta coluna diz como ele
   * se comporta. Omitido, o fixture deriva a classe do nó, que é o que a árvore
   * fazia por herança — assim as fixturas escritas antes continuam dizendo a
   * mesma coisa sem precisarem ser reescritas uma a uma.
   */
  costClass?: string | null;
  /** HIGHER_IS_BETTER | HIGHER_IS_WORSE | NEUTRAL | DEPENDS_ON_FORMULA | null. */
  economicDirection?: string | null;
  economicEffect?: string | null;
}

/**
 * `null` means the fact is absent for that asset in that snapshot.
 *
 * `{ date }` writes a real `value_date`, which no other form can produce: a
 * date arriving as a string would land in `value_text` and a test about how
 * dates behave would be testing text. `fact_exactly_one_value` is what makes
 * the distinction matter — the column a value lands in *is* its type.
 */
export type CellValue =
  | number
  | string
  | boolean
  | null
  | { missing: string }
  | { date: string };

export interface SnapshotSpec {
  label: string;
  effectiveDate: string;
  /** plate -> attribute code -> value */
  data: Record<string, Record<string, CellValue>>;
}

export interface FixtureResult {
  snapshotIds: Record<string, string>;
}

export interface FixtureOptions {
  /** Equipment type, which is also the snapshot's entity_type_set. */
  entityType?: string;
  /** Shared so two series land in the same scope and can be consolidated. */
  scopeHash?: string;
  /**
   * O canal da identidade canônica.
   *
   * O fixture monta snapshots direto, sem passar pelo `promote`, e o banco agora
   * só admite **uma** vigência ativa por identidade canônica. Duas chamadas que
   * compartilham `scopeHash` para serem consolidadas (carreta e cavalo na mesma
   * data) colidiriam nessa identidade. Cada chamada recebe um canal próprio, o
   * que as mantém distintas sem mexer no `scope_hash` — que é por onde a
   * consolidação junta as séries.
   */
  canal?: string;
  /**
   * A família do dataset — o contrato da importação, não o que veio no arquivo.
   *
   * O padrão é a remuneração de equipamento porque é o que toda fixture deste
   * módulo monta. É opção porque o quadro de pessoal forma vigências de família
   * própria na mesma unidade e no mesmo canal do equipamento, e sem uma fixture
   * capaz de montar as duas famílias não haveria como escrever o teste que
   * prova que uma leitura de equipamento não enxerga as vigências da outra.
   */
  datasetFamily?: string;
}

let sequence = 0;

export async function buildFixture(
  db: Database,
  attributes: AttributeSpec[],
  snapshots: SnapshotSpec[],
  options: FixtureOptions = {},
): Promise<FixtureResult> {
  sequence++;
  const suffix = `fx${sequence}`;
  const entityType = options.entityType ?? "CARRETA";
  const datasetFamily = options.datasetFamily ?? "REMUNERACAO_EQUIPAMENTO";
  const scopeHash = options.scopeHash ?? `scope-${suffix}`;
  const canal = (options.canal ?? suffix).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  // O escopo canônico tem de sair já normalizado, senão o CHECK do banco recusa
  // a linha. Um CNPJ de 14 dígitos derivado do `scopeHash` faz duas chamadas que
  // compartilham escopo compartilharem também a identidade de escopo.
  const canonicalScope = [
    {
      scopeType: "UNIDADE",
      code: createHash("sha256")
        .update(scopeHash)
        .digest("hex")
        .replace(/\D/g, "")
        .padEnd(14, "0")
        .slice(0, 14),
    },
  ];

  const [file] = await db
    .insert(sourceFileTable)
    .values({
      filename: `${suffix}.xlsx`,
      contentSha256: `sha-${suffix}-${Date.now()}`,
      byteSize: 1,
      storagePath: `/dev/null/${suffix}`,
    })
    .returning();

  const [run] = await db
    .insert(importRunTable)
    .values({ sourceFileId: file.id, status: "PROMOTED" })
    .returning();

  const [nodeFixo] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, "cf_frota_carreta"));
  const [nodeVar] = await db
    .select()
    .from(taxonomyNodeTable)
    .where(eq(taxonomyNodeTable.code, "cv_combustivel"));

  // --- attributes -----------------------------------------------------------
  const attributeIds = new Map<string, string>();
  for (const spec of attributes) {
    // Attributes are global by code in production too, so a fixture reuses one
    // that already exists rather than fighting the unique constraint.
    const [existing] = await db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, spec.code));
    if (existing) {
      attributeIds.set(spec.code, existing.id);
      continue;
    }
    const node =
      spec.taxonomyCode === "cv_combustivel" ? nodeVar : spec.taxonomyCode ? nodeFixo : null;
    const costClass =
      spec.costClass !== undefined
        ? spec.costClass
        : spec.taxonomyCode === "cv_combustivel"
          ? "VARIAVEL"
          : spec.taxonomyCode
            ? "FIXO"
            : null;
    const [created] = await db
      .insert(attributeTable)
      .values({
        code: spec.code,
        sourceName: spec.code.split(".").pop()!,
        displayName: spec.code.split(".").pop()!,
        entityType: spec.code.split(".")[0].toUpperCase(),
        dataType: spec.dataType,
        unit: spec.unit ?? null,
        periodicity: spec.periodicity ?? null,
        aggregation: spec.aggregation ?? null,
        isMonetary: spec.isMonetary ?? null,
        semanticsStatus: spec.semanticsStatus ?? "UNKNOWN",
        taxonomyNodeId: node?.id ?? null,
        costClass,
        economicDirection: spec.economicDirection ?? null,
        economicEffect: spec.economicEffect ?? null,
        confirmedBy: spec.semanticsStatus === "CONFIRMED" ? "fixture@test" : null,
        confirmedAt: spec.semanticsStatus === "CONFIRMED" ? new Date() : null,
      })
      .returning();
    attributeIds.set(spec.code, created.id);
  }

  // --- entities -------------------------------------------------------------
  const plates = new Set<string>();
  for (const snapshot of snapshots) for (const p of Object.keys(snapshot.data)) plates.add(p);

  const entityIds = new Map<string, string>();
  for (const plate of plates) {
    // A plate identifies one asset across every import, so a fixture resolves
    // an existing one exactly the way promotion does.
    const [known] = await db
      .select({ entityId: entityIdentifierTable.entityId })
      .from(entityIdentifierTable)
      .where(
        and(
          eq(entityIdentifierTable.identifierType, "PLACA"),
          eq(entityIdentifierTable.identifierValue, plate),
          eq(entityIdentifierTable.isCurrent, true),
        ),
      );
    if (known) {
      entityIds.set(plate, known.entityId);
      continue;
    }
    const [entity] = await db
      .insert(entityTable)
      .values({ entityType, firstSeenImportRunId: run.id })
      .returning();
    await db.insert(entityIdentifierTable).values({
      entityId: entity.id,
      identifierType: "PLACA",
      identifierValue: plate,
      effectiveFrom: snapshots[0].effectiveDate,
      isCurrent: true,
    });
    entityIds.set(plate, entity.id);
  }

  // --- snapshots ------------------------------------------------------------
  const snapshotIds: Record<string, string> = {};
  let rowCounter = 0;

  for (const spec of snapshots) {
    const [sheet] = await db
      .insert(rawSheetTable)
      .values({
        importRunId: run.id,
        sheetName: "carretas",
        sheetIndex: rowCounter++,
        rowCount: Object.keys(spec.data).length,
        columnCount: attributes.length,
        role: "SOURCE",
        roleReason: "fixture",
        headerRowIndex: 1,
      })
      .returning();

    const [snapshot] = await db
      .insert(snapshotTable)
      .values({
        sourceFileId: file.id,
        importRunId: run.id,
        sourceLabel: spec.label,
        effectiveDate: spec.effectiveDate,
        scopeHash,
        entityTypeSet: entityType,
        datasetFamily,
        canal,
        canonicalScope,
        status: "DRAFT",
      })
      .returning();
    snapshotIds[spec.label] = snapshot.id;

    const presentAttributes = new Set<string>();
    const contagemPorAtributo = new Map<string, { comValor: number; vazios: number }>();
    let fatosDaVigencia = 0;
    let physicalRow = 1;

    for (const [plate, cells] of Object.entries(spec.data)) {
      physicalRow++;
      const [rawRow] = await db
        .insert(rawRowTable)
        .values({ rawSheetId: sheet.id, rowIndex: physicalRow, isHeader: false })
        .returning();

      let column = 0;
      for (const [code, value] of Object.entries(cells)) {
        column++;
        if (value === null) continue; // attribute absent for this asset entirely
        presentAttributes.add(code);

        const missing = typeof value === "object" && value !== null && "missing" in value;
        const dateValue =
          typeof value === "object" && value !== null && "date" in value ? value.date : null;
        const sourceType = missing
          ? "z"
          : dateValue !== null
            ? "d"
            : typeof value === "number"
              ? "n"
              : typeof value === "boolean"
                ? "b"
                : "s";

        const [cell] = await db
          .insert(rawCellTable)
          .values({
            rawRowId: rawRow.id,
            columnIndex: column,
            columnLetter: String.fromCharCode(64 + column),
            columnHeader: code.split(".").pop()!,
            rawValue: missing ? null : (dateValue ?? String(value)),
            sourceType,
          })
          .returning();

        const isNull = missing;
        await db.insert(factTable).values({
          snapshotId: snapshot.id,
          entityId: entityIds.get(plate)!,
          attributeId: attributeIds.get(code)!,
          valueNumeric: !isNull && typeof value === "number" ? String(value) : null,
          valueText: !isNull && typeof value === "string" ? value : null,
          valueBoolean: !isNull && typeof value === "boolean" ? value : null,
          valueDate: dateValue,
          valueHash: isNull
            ? `0:${(value as { missing: string }).missing}`
            : `${sourceType}:${dateValue ?? value}`,
          isNull,
          nullReason: isNull ? (value as { missing: string }).missing : null,
          rawCellId: cell.id,
          originImportRunId: run.id,
        });

        fatosDaVigencia++;
        const contagem = contagemPorAtributo.get(code) ?? { comValor: 0, vazios: 0 };
        if (isNull) contagem.vazios++;
        else contagem.comValor++;
        contagemPorAtributo.set(code, contagem);
      }
    }

    /*
      As contagens do layout são escritas, e não deixadas no zero do default.

      `snapshot_attribute.value_count` e `.null_count` deixaram de ser
      estatística decorativa quando a Cobertura de dados passou a lê-los como o
      observado: uma fixture que os deixasse zerados produziria 0% de cobertura
      com todos os fatos no lugar, e o teste estaria medindo a fixture.
    */
    for (const code of presentAttributes) {
      await db.insert(snapshotAttributeTable).values({
        snapshotId: snapshot.id,
        attributeId: attributeIds.get(code)!,
        sourceSheet: "carretas",
        columnIndex: 1,
        presentInLayout: true,
        valueCount: contagemPorAtributo.get(code)?.comValor ?? 0,
        nullCount: contagemPorAtributo.get(code)?.vazios ?? 0,
      });
    }

    /* O mesmo agregado que `promote` grava — ver `snapshot_entity_type`. */
    await db.insert(snapshotEntityTypeTable).values({
      snapshotId: snapshot.id,
      entityType,
      entityCount: Object.keys(spec.data).length,
      attributeCount: presentAttributes.size,
      factCount: fatosDaVigencia,
      valueCount: [...contagemPorAtributo.values()].reduce((s, c) => s + c.comValor, 0),
      nullCount: [...contagemPorAtributo.values()].reduce((s, c) => s + c.vazios, 0),
      inheritedFactCount: 0,
    });

    await db
      .update(snapshotTable)
      .set({
        status: "CLOSED",
        closedAt: new Date(),
        entityCount: Object.keys(spec.data).length,
        factCount: fatosDaVigencia,
      })
      .where(eq(snapshotTable.id, snapshot.id));
  }

  return { snapshotIds };
}

/** A value that exists in RAW but carries no usable content. */
export const absent = (reason = "VALUE_MISSING") => ({ missing: reason });

/** A real date, in `value_date` — not a date-shaped string in `value_text`. */
export const date = (iso: string) => ({ date: iso });

/**
 * A base real curada — construída uma vez, clonada por arquivo.
 *
 * Quatro arquivos deste pacote (`cockpit-real`, `families-real`,
 * `grouped-real`, `range-real`) tinham `beforeAll` idêntico: importar os dois
 * workbooks do Freightec, semear a taxonomia, propor e aplicar as semânticas,
 * versioná-las e calcular os conjuntos de alteração. Cada um refazia tudo,
 * gastando ~26 s antes da primeira asserção — e nesses quatro o preparo era
 * 99–100% do tempo do arquivo.
 *
 * Agora o preparo é este bloco, executado uma vez por conteúdo, e cada arquivo
 * recebe um clone físico dele. O isolamento não mudou: continuam sendo bancos
 * separados, e um arquivo que escreve não é visto pelos outros.
 *
 * O rótulo de `computeMissingChangeSets` era o único ponto em que os quatro
 * divergiam — cada um passava o seu (`test:cockpit`, `test:families`, …). Ele
 * grava `computed_by`, que nenhuma asserção lê; aqui é um só, e uniforme.
 *
 * **Editar este corpo invalida o template automaticamente**: o hash que nomeia
 * o banco inclui o texto desta função, além das migrations e dos workbooks.
 */
export async function fixtureModelosCurados(db: Database): Promise<void> {
  const { importFixture, modelExportPaths } =
    await import("@workspace/ingest/testing");
  const {
    applyConfirmations,
    backfillSemantics,
    runProposalPass,
    seedTaxonomy,
  } = await import("@workspace/curation");
  const { computeMissingChangeSets } = await import("./consolidated");

  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) await importFixture(db, filePath);
  await seedTaxonomy(db, "test");
  await runProposalPass(db, "test");
  await applyConfirmations(db);
  await backfillSemantics(db);
  await computeMissingChangeSets(db, "test:fixture");
}

/** Um banco próprio com a base real já curada. */
export async function criarBancoComModelosCurados(name: string) {
  const { createTestDatabaseFrom } = await import("@workspace/ingest/testing");
  return createTestDatabaseFrom("modelos_curados", fixtureModelosCurados, name);
}
