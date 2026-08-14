import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  attributeTable,
  entityIdentifierTable,
  entityTable,
  factTable,
  importDecisionTable,
  importRunTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  snapshotTable,
  sourceFileTable,
  stagedFactTable,
  validationIssueTable,
} from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { createTestDatabase, realExportPath, type TestDb } from "../testing";

/**
 * The acceptance suite, run against the real Freightec export.
 *
 * Baseline established by independent analysis of the workbook before any of
 * this code existed. These numbers are the regression contract: if a future
 * parser change moves them, the change has to justify itself.
 */
const BASELINE = {
  sheets: 5,
  sourceSheets: ["carretas", "cavalos"],
  pivotSheets: ["Quantidade", "Análise Carreta", "Análise Cavalo"],
  snapshots: 9,
  /** (vigência, placa) rows: 657 carretas + 558 cavalos. */
  entityVigenciaRows: 1215,
  entities: 144,
  labels: [
    "EMPURRADA_2_12_2025",
    "EMPURRADA_2_1_2026",
    "EMPURRADA_2_2_2026",
    "EMPURRADA_2_3_2026",
    "EMPURRADA_2_4_2026",
    "EMPURRADA_2_5_2026",
    "EMPURRADA_2_6_2026",
    "EMPURRADA_2_7_2026",
    "EMPURRADA_1_8_2026",
  ],
} as const;

let ctx: TestDb;
let importRunId: string;

beforeAll(async () => {
  ctx = await createTestDatabase("ingest");
  const received = await receiveFile(ctx.db, {
    filePath: realExportPath(),
    receivedBy: "acceptance-suite",
  });
  importRunId = received.importRunId;
  await captureRaw(ctx.db, importRunId);
  await stage(ctx.db, importRunId);
  await preview(ctx.db, importRunId);
  await promote(ctx.db, importRunId);
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("sheet recognition", () => {
  it("captures all five sheets in RAW", async () => {
    const sheets = await ctx.db
      .select()
      .from(rawSheetTable)
      .where(eq(rawSheetTable.importRunId, importRunId));
    expect(sheets).toHaveLength(BASELINE.sheets);
  });

  it("treats only the two grain-bearing sheets as fact sources", async () => {
    const sheets = await ctx.db
      .select()
      .from(rawSheetTable)
      .where(eq(rawSheetTable.importRunId, importRunId));
    const source = sheets.filter((s) => s.role === "SOURCE").map((s) => s.sheetName);
    expect(source.sort()).toEqual([...BASELINE.sourceSheets].sort());
  });

  it("excludes the three pivot sheets from the canonical stream, with a reason", async () => {
    const sheets = await ctx.db
      .select()
      .from(rawSheetTable)
      .where(eq(rawSheetTable.importRunId, importRunId));
    const pivots = sheets.filter((s) => s.role !== "SOURCE");
    expect(pivots.map((s) => s.sheetName).sort()).toEqual(
      [...BASELINE.pivotSheets].sort(),
    );
    for (const pivot of pivots) {
      expect(pivot.roleReason).toBeTruthy();
      expect(pivot.headerRowIndex).toBeNull();
    }

    // Their cells are still preserved as evidence...
    const [pivotCells] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(rawCellTable)
      .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
      .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
      .where(
        and(
          eq(rawSheetTable.importRunId, importRunId),
          sql`${rawSheetTable.role} <> 'SOURCE'`,
        ),
      );
    expect(pivotCells.count).toBeGreaterThan(0);

    // ...but none of them produced a fact.
    const [pivotFacts] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(factTable)
      .innerJoin(rawCellTable, eq(factTable.rawCellId, rawCellTable.id))
      .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
      .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
      .where(sql`${rawSheetTable.role} <> 'SOURCE'`);
    expect(pivotFacts.count).toBe(0);
  });
});

describe("snapshots", () => {
  it("produces exactly nine, one per vigência", async () => {
    const snapshots = await ctx.db.select().from(snapshotTable);
    expect(snapshots).toHaveLength(BASELINE.snapshots);
  });

  it("preserves the EMPURRADA_* labels verbatim", async () => {
    const snapshots = await ctx.db.select().from(snapshotTable);
    expect(snapshots.map((s) => s.sourceLabel).sort()).toEqual(
      [...BASELINE.labels].sort(),
    );
  });

  it("derives the date into a separate column without touching the label", async () => {
    const snapshots = await ctx.db
      .select()
      .from(snapshotTable)
      .orderBy(snapshotTable.effectiveDate);
    expect(snapshots.map((s) => s.effectiveDate)).toEqual([
      "2025-12-02",
      "2026-01-02",
      "2026-02-02",
      "2026-03-02",
      "2026-04-02",
      "2026-05-02",
      "2026-06-02",
      "2026-07-02",
      "2026-08-01",
    ]);
    // The label is still the source's own string, not a rendering of the date.
    const first = snapshots[0];
    expect(first.sourceLabel).toBe("EMPURRADA_2_12_2025");
    expect(first.sourceLabel).not.toContain(first.effectiveDate);
  });

  it("spans both entity types in one snapshot per vigência", async () => {
    const snapshots = await ctx.db.select().from(snapshotTable);
    for (const snapshot of snapshots) {
      expect(snapshot.entityTypeSet).toBe("CARRETA+CAVALO");
      expect(snapshot.revision).toBe(1);
      expect(snapshot.status).toBe("CLOSED");
    }
  });

  it("matches the (vigência, placa) row baseline", async () => {
    const snapshots = await ctx.db.select().from(snapshotTable);
    const total = snapshots.reduce((sum, s) => sum + s.entityCount, 0);
    expect(total).toBe(BASELINE.entityVigenciaRows);
  });
});

describe("entities", () => {
  it("creates one stable entity per asset, not one per vigência", async () => {
    const entities = await ctx.db.select().from(entityTable);
    expect(entities).toHaveLength(BASELINE.entities);
  });

  it("keeps identity in the internal id and plates in entity_identifier", async () => {
    const identifiers = await ctx.db
      .select()
      .from(entityIdentifierTable)
      .where(eq(entityIdentifierTable.identifierType, "PLACA"));
    expect(identifiers).toHaveLength(BASELINE.entities);
    for (const identifier of identifiers) {
      expect(identifier.isCurrent).toBe(true);
      expect(identifier.effectiveFrom).toBeTruthy();
    }
    // The entity row itself carries no plate column at all.
    const [entity] = await ctx.db.select().from(entityTable).limit(1);
    expect(Object.keys(entity)).not.toContain("placa");
    expect(Object.keys(entity)).not.toContain("chassi");
  });

  it("attaches chassis as a second identifier of the same entity", async () => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(entityIdentifierTable)
      .where(eq(entityIdentifierTable.identifierType, "CHASSI"));
    expect(row.count).toBeGreaterThan(0);
  });
});

describe("traceability", () => {
  it("points every fact at a real cell with sheet, row and column", async () => {
    const [orphans] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(factTable)
      .leftJoin(rawCellTable, eq(factTable.rawCellId, rawCellTable.id))
      .where(sql`${rawCellTable.id} IS NULL`);
    expect(orphans.count).toBe(0);

    const [sample] = await ctx.db
      .select({
        value: factTable.valueNumeric,
        sheet: rawSheetTable.sheetName,
        row: rawRowTable.rowIndex,
        column: rawCellTable.columnLetter,
        header: rawCellTable.columnHeader,
        original: rawCellTable.rawValue,
        originalType: rawCellTable.sourceType,
      })
      .from(factTable)
      .innerJoin(rawCellTable, eq(factTable.rawCellId, rawCellTable.id))
      .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
      .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
      .where(sql`${factTable.valueNumeric} IS NOT NULL`)
      .limit(1);

    expect(sample.sheet).toBeTruthy();
    expect(sample.row).toBeGreaterThan(1);
    expect(sample.column).toMatch(/^[A-Z]+$/);
    expect(sample.header).toBeTruthy();
    expect(sample.original).toBeTruthy();
    expect(sample.originalType).toBeTruthy();
  });

  it("can walk from a known plate and column back to the original cell", async () => {
    // QYQ6A80 · ipvaLicenciamento in the first vigência: the R$ 11.089,38 that
    // later falls 77%. If this lookup breaks, the audit story breaks.
    const [row] = await ctx.db
      .select({
        value: factTable.valueNumeric,
        original: rawCellTable.rawValue,
        sheet: rawSheetTable.sheetName,
        rowIndex: rawRowTable.rowIndex,
      })
      .from(factTable)
      .innerJoin(snapshotTable, eq(factTable.snapshotId, snapshotTable.id))
      .innerJoin(attributeTable, eq(factTable.attributeId, attributeTable.id))
      .innerJoin(
        entityIdentifierTable,
        eq(factTable.entityId, entityIdentifierTable.entityId),
      )
      .innerJoin(rawCellTable, eq(factTable.rawCellId, rawCellTable.id))
      .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
      .innerJoin(rawSheetTable, eq(rawRowTable.rawSheetId, rawSheetTable.id))
      .where(
        and(
          eq(entityIdentifierTable.identifierType, "PLACA"),
          eq(entityIdentifierTable.identifierValue, "QYQ6A80"),
          eq(attributeTable.code, "cavalo.ipva_licenciamento"),
          eq(snapshotTable.sourceLabel, "EMPURRADA_2_12_2025"),
        ),
      );

    expect(row).toBeDefined();
    expect(Number(row.value)).toBeCloseTo(11089.38, 2);
    expect(row.sheet).toBe("cavalos");
    expect(Number(row.original)).toBeCloseTo(11089.38, 2);
  });
});

describe("zero, absence and ambiguity", () => {
  it("keeps true zeros as numbers rather than nulls", async () => {
    const [zeros] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(factTable)
      .where(and(eq(factTable.isNull, false), eq(factTable.valueNumeric, "0")));
    expect(zeros.count).toBeGreaterThan(0);

    // No fact is ever both a value and a null.
    const [contradictions] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(factTable)
      .where(
        sql`(${factTable.isNull} = true AND ${factTable.valueNumeric} IS NOT NULL)
            OR (${factTable.isNull} = false AND ${factTable.nullReason} IS NOT NULL)`,
      );
    expect(contradictions.count).toBe(0);
  });

  it("records why each absent value is absent", async () => {
    const reasons = await ctx.db
      .select({
        reason: factTable.nullReason,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(factTable)
      .where(eq(factTable.isNull, true))
      .groupBy(factTable.nullReason);

    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason.reason).toBeTruthy();
      expect(reason.reason).not.toBe("(unset)");
    }
    // The export has blank cells, so EMPTY must be represented.
    expect(reasons.map((r) => r.reason)).toContain("EMPTY");
  });

  it("flags the ambiguous date serial instead of converting it", async () => {
    const issues = await ctx.db
      .select()
      .from(validationIssueTable)
      .where(
        and(
          eq(validationIssueTable.importRunId, importRunId),
          eq(validationIssueTable.code, "AMBIGUOUS_DATE_SERIAL"),
        ),
      )
      .limit(1);
    expect(issues.length).toBeGreaterThan(0);

    // In carretas the column is a bare serial in every row, so it stays
    // NUMERIC — no silent conversion to a date happened.
    const [carreta] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "carreta.data_fim_contrato"));
    expect(carreta.dataType).toBe("NUMERIC");
  });

  it("reports a column the source types inconsistently, instead of picking one", async () => {
    // dataFimContrato in `cavalos` arrives date-formatted for most rows and as
    // a bare serial for the rest — the same column, the same sheet. Choosing a
    // winner would silently discard one of the two representations.
    const [cavalo] = await ctx.db
      .select()
      .from(attributeTable)
      .where(eq(attributeTable.code, "cavalo.data_fim_contrato"));
    expect(cavalo.dataType).toBe("MIXED");

    const [issue] = await ctx.db
      .select()
      .from(validationIssueTable)
      .where(
        and(
          eq(validationIssueTable.importRunId, importRunId),
          eq(validationIssueTable.code, "MIXED_TYPE_COLUMN"),
        ),
      )
      .limit(1);
    expect(issue).toBeDefined();

    // Both representations survived in the facts.
    const [counts] = await ctx.db
      .select({
        numeric: sql<number>`count(*) FILTER (WHERE ${factTable.valueNumeric} IS NOT NULL)`.mapWith(Number),
        text: sql<number>`count(*) FILTER (WHERE ${factTable.valueText} IS NOT NULL)`.mapWith(Number),
      })
      .from(factTable)
      .where(eq(factTable.attributeId, cavalo.id));
    expect(counts.numeric).toBeGreaterThan(0);
    expect(counts.text).toBeGreaterThan(0);
  });

  it("leaves every imported attribute with UNKNOWN semantics", async () => {
    // F1 must not promote anything to CONFIRMED; that is a human act in F2,
    // and it is what gates financial aggregation later.
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(attributeTable)
      .where(sql`${attributeTable.semanticsStatus} <> 'UNKNOWN'`);
    expect(row.count).toBe(0);
  });
});

describe("idempotency", () => {
  it("refuses to reprocess identical bytes and records the refusal", async () => {
    const before = await countAll();

    const second = await receiveFile(ctx.db, {
      filePath: realExportPath(),
      receivedBy: "acceptance-suite",
    });
    expect(second.isDuplicate).toBe(true);

    const [run] = await ctx.db
      .select()
      .from(importRunTable)
      .where(eq(importRunTable.id, second.importRunId));
    expect(run.status).toBe("SKIPPED_DUPLICATE");
    expect(run.failureReason).toContain("já havia sido recebido");

    // Only one source_file row exists for those bytes.
    const files = await ctx.db
      .select()
      .from(sourceFileTable)
      .where(eq(sourceFileTable.contentSha256, second.contentSha256));
    expect(files).toHaveLength(1);

    // A skipped run cannot advance through the pipeline.
    await expect(captureRaw(ctx.db, second.importRunId)).rejects.toThrow(
      /SKIPPED_DUPLICATE/,
    );

    expect(await countAll()).toEqual(before);
  });

  it("reconhece uma cópia de bytes diferentes como duplicata de dados, sem abrir revisão", async () => {
    // Uma cópia com outro nome derrota o SHA-256. Quem a barra é a identidade
    // canônica — e, como o **conteúdo normalizado** é o mesmo, a resposta certa
    // não é erro: é `SKIPPED_DUPLICATE_DATA`. Abrir uma revisão idêntica à
    // ativa poluiria a auditoria com uma correção que não corrige nada.
    //
    // Esta asserção mudou junto com o modelo de identidade. Antes o pipeline
    // recusava com "Snapshot already exists for business key", porque a única
    // pergunta que ele sabia fazer era "esta chave já existe?". Agora ele
    // também pergunta "e o dado é o mesmo?", e responde de acordo.
    const copy = await copyExportWithDifferentBytes();
    const received = await receiveFile(ctx.db, { filePath: copy });
    expect(received.isDuplicate).toBe(false);

    await captureRaw(ctx.db, received.importRunId);
    await stage(ctx.db, received.importRunId);
    await preview(ctx.db, received.importRunId);

    const resultado = await promote(ctx.db, received.importRunId);
    expect(resultado.snapshots).toHaveLength(0);
    expect(resultado.factsInserted).toBe(0);

    const [run] = await ctx.db
      .select()
      .from(importRunTable)
      .where(eq(importRunTable.id, received.importRunId));
    expect(run.status).toBe("SKIPPED_DUPLICATE_DATA");

    // Nada foi criado, nada foi superseded: a camada canônica ficou intacta.
    const snapshots = await ctx.db.select().from(snapshotTable);
    expect(snapshots).toHaveLength(BASELINE.snapshots);
    expect(snapshots.every((s) => s.status !== "SUPERSEDED")).toBe(true);

    // E a recusa ficou explicada, sem depender de log.
    const [decisao] = await ctx.db
      .select()
      .from(importDecisionTable)
      .where(
        and(
          eq(importDecisionTable.importRunId, received.importRunId),
          eq(importDecisionTable.decisao, "DUPLICATA_DE_DADOS"),
        ),
      );
    expect(decisao.motivo).toMatch(/dados normalizados/i);
  });
});

describe("preview gate", () => {
  it("refuses to promote a run that has not been previewed", async () => {
    const copy = await copyExportWithDifferentBytes("-nopreview");
    const received = await receiveFile(ctx.db, { filePath: copy });
    await captureRaw(ctx.db, received.importRunId);
    await stage(ctx.db, received.importRunId);
    // No preview() call here.
    await expect(promote(ctx.db, received.importRunId)).rejects.toThrow(
      /requires PREVIEWED/,
    );
  });
});

async function countAll() {
  const count = async (table: Parameters<typeof ctx.db.select>[0] extends never ? never : any) => {
    const [row] = await ctx.db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(table);
    return row.count;
  };
  return {
    sourceFiles: await count(sourceFileTable),
    sheets: await count(rawSheetTable),
    cells: await count(rawCellTable),
    staged: await count(stagedFactTable),
    snapshots: await count(snapshotTable),
    facts: await count(factTable),
    entities: await count(entityTable),
  };
}

/**
 * Byte-different, content-identical copy of the export: the case SHA-256
 * cannot catch, which is exactly why the business key exists.
 */
async function copyExportWithDifferentBytes(suffix = "-copy"): Promise<string> {
  const { copyFileSync, appendFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const target = path.join(tmpdir(), `freightec-export${suffix}-${process.pid}.xlsx`);
  copyFileSync(realExportPath(), target);
  // Trailing bytes change the hash; SheetJS ignores them when reading the zip.
  appendFileSync(target, Buffer.from(suffix));
  return target;
}
