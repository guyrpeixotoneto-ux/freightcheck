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
}

/** `null` means the fact is absent for that asset in that snapshot. */
export type CellValue = number | string | boolean | null | { missing: string };

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
  const scopeHash = options.scopeHash ?? `scope-${suffix}`;

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
        status: "DRAFT",
      })
      .returning();
    snapshotIds[spec.label] = snapshot.id;

    const presentAttributes = new Set<string>();
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
        const [cell] = await db
          .insert(rawCellTable)
          .values({
            rawRowId: rawRow.id,
            columnIndex: column,
            columnLetter: String.fromCharCode(64 + column),
            columnHeader: code.split(".").pop()!,
            rawValue: missing ? null : String(value),
            sourceType: missing
              ? "z"
              : typeof value === "number"
                ? "n"
                : typeof value === "boolean"
                  ? "b"
                  : "s",
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
          valueDate: null,
          valueHash: isNull
            ? `0:${(value as { missing: string }).missing}`
            : `${typeof value === "number" ? "n" : typeof value === "boolean" ? "b" : "s"}:${value}`,
          isNull,
          nullReason: isNull ? (value as { missing: string }).missing : null,
          rawCellId: cell.id,
        });
      }
    }

    for (const code of presentAttributes) {
      await db.insert(snapshotAttributeTable).values({
        snapshotId: snapshot.id,
        attributeId: attributeIds.get(code)!,
        sourceSheet: "carretas",
        columnIndex: 1,
        presentInLayout: true,
      });
    }

    await db
      .update(snapshotTable)
      .set({
        status: "CLOSED",
        closedAt: new Date(),
        entityCount: Object.keys(spec.data).length,
        factCount: 0,
      })
      .where(eq(snapshotTable.id, snapshot.id));
  }

  return { snapshotIds };
}

/** A value that exists in RAW but carries no usable content. */
export const absent = (reason = "VALUE_MISSING") => ({ missing: reason });
