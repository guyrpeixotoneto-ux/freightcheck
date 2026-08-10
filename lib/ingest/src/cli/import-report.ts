/**
 * Run the F1 pipeline end to end against a real export and print the import
 * report — the artefact a human reads before accepting a delivery.
 *
 * Usage: DATABASE_URL=... tsx src/cli/import-report.ts <path-to-xlsx> [--promote]
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { createDb } from "@workspace/db";
import {
  attributeTable,
  entityIdentifierTable,
  entityTable,
  factTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  snapshotTable,
  stagedFactTable,
  validationIssueTable,
} from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";

function defaultExport(): string {
  const assets = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../attached_assets",
  );
  const found = readdirSync(assets).find((f) => f.endsWith(".xlsx"));
  if (!found) throw new Error(`No .xlsx found in ${assets}`);
  return path.join(assets, found);
}

const n = (value: number) => value.toLocaleString("pt-BR");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set.");
  const args = process.argv.slice(2);
  const shouldPromote = args.includes("--promote");
  const filePath = args.find((a) => !a.startsWith("--")) ?? defaultExport();

  const { db, pool } = createDb(url);

  try {
    console.log(`\nRELATÓRIO DE IMPORTAÇÃO — FreightCheck F1`);
    console.log(`Arquivo: ${path.basename(filePath)}\n`);

    const received = await receiveFile(db, {
      filePath,
      receivedBy: "import-report-cli",
    });
    console.log(`SHA-256 ............. ${received.contentSha256}`);
    console.log(`Duplicado ........... ${received.isDuplicate ? "SIM" : "não"}`);
    if (received.isDuplicate) {
      console.log(
        `\nArquivo já recebido anteriormente. Processamento recusado por idempotência.`,
      );
      console.log(`import_run ${received.importRunId} registrado como SKIPPED_DUPLICATE.`);
      return;
    }

    const raw = await captureRaw(db, received.importRunId);
    const staged = await stage(db, received.importRunId);
    const report = await preview(db, received.importRunId);

    console.log(`\n── ABAS ─────────────────────────────────────────────────`);
    for (const sheet of report.sheets) {
      console.log(
        `  ${sheet.role.padEnd(7)} ${sheet.name.padEnd(18)} ${String(sheet.rows).padStart(4)} linhas × ${String(sheet.columns).padStart(3)} colunas`,
      );
      console.log(`          └─ ${sheet.roleReason}`);
    }

    console.log(`\n── CONTAGEM POR CAMADA ──────────────────────────────────`);
    console.log(`  RAW      abas ......... ${n(raw.sheets)}`);
    console.log(`  RAW      linhas ....... ${n(raw.rows)}`);
    console.log(`  RAW      células ...... ${n(raw.cells)}`);
    console.log(`  STAGING  fatos ........ ${n(staged.stagedFacts)}`);
    console.log(`  STAGING  erros ........ ${n(staged.errors)}`);
    console.log(`  STAGING  avisos ....... ${n(staged.warnings)}`);
    console.log(`  STAGING  linhas rejeit. ${n(staged.rowsRejected)}`);

    console.log(`\n── VIGÊNCIAS DETECTADAS ─────────────────────────────────`);
    for (const snapshot of report.snapshots) {
      console.log(
        `  ${snapshot.label.padEnd(20)} → ${snapshot.effectiveDate}  ` +
          `${String(snapshot.entityCount).padStart(5)} ativos  ` +
          `${String(snapshot.factCount).padStart(7)} fatos  [${snapshot.entityTypes.join("+")}]`,
      );
    }

    console.log(`\n── AUSÊNCIA vs ZERO ─────────────────────────────────────`);
    for (const row of report.nullsByReason) {
      console.log(`  null · ${row.reason.padEnd(16)} ${n(row.count).padStart(9)}`);
    }
    console.log(`  zero econômico real     ${n(report.zeroCount).padStart(9)}`);

    console.log(`\n── AMBIGUIDADES E OCORRÊNCIAS ───────────────────────────`);
    if (report.issuesByCode.length === 0) {
      console.log(`  (nenhuma)`);
    }
    for (const issue of report.issuesByCode) {
      console.log(`  ${issue.severity.padEnd(7)} ${issue.code.padEnd(26)} ${n(issue.count).padStart(7)}`);
      console.log(`          └─ ${issue.sample.slice(0, 150)}`);
    }

    if (!shouldPromote) {
      console.log(`\nPreview concluído. Rode com --promote para promover ao canônico.`);
      return;
    }

    console.log(`\n── PROMOÇÃO (transação única) ───────────────────────────`);
    const promoted = await promote(db, received.importRunId);
    console.log(`  snapshots criados ..... ${n(promoted.snapshots.length)}`);
    console.log(`  entidades criadas ..... ${n(promoted.entitiesCreated)}`);
    console.log(`  atributos criados ..... ${n(promoted.attributesCreated)}`);
    console.log(`  fatos inseridos ....... ${n(promoted.factsInserted)}`);

    const counts = await layerCounts(db);
    console.log(`\n── CONTAGEM FINAL RAW / STAGING / CANÔNICO ──────────────`);
    console.log(`  RAW      raw_sheet .......... ${n(counts.rawSheets)}`);
    console.log(`  RAW      raw_row ............ ${n(counts.rawRows)}`);
    console.log(`  RAW      raw_cell ........... ${n(counts.rawCells)}`);
    console.log(`  STAGING  staged_fact ........ ${n(counts.staged)}`);
    console.log(`  STAGING  validation_issue ... ${n(counts.issues)}`);
    console.log(`  CANON    snapshot ........... ${n(counts.snapshots)}`);
    console.log(`  CANON    entity ............. ${n(counts.entities)}`);
    console.log(`  CANON    entity_identifier .. ${n(counts.identifiers)}`);
    console.log(`  CANON    attribute .......... ${n(counts.attributes)}`);
    console.log(`  CANON    fact ............... ${n(counts.facts)}`);

    const semantics = await db
      .select({
        status: attributeTable.semanticsStatus,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(attributeTable)
      .groupBy(attributeTable.semanticsStatus);
    console.log(`\n── SEMÂNTICA DOS ATRIBUTOS ──────────────────────────────`);
    for (const row of semantics) {
      console.log(`  ${row.status.padEnd(12)} ${n(row.count).padStart(5)}`);
    }
    console.log(
      `  (F1 nunca promove a CONFIRMED; nada aqui pode entrar em cálculo financeiro)`,
    );

    console.log(`\n── PROVA DE RASTREABILIDADE ─────────────────────────────`);
    const [trace] = await db
      .select({
        placa: entityIdentifierTable.identifierValue,
        atributo: attributeTable.code,
        vigencia: snapshotTable.sourceLabel,
        valor: factTable.valueNumeric,
        aba: rawSheetTable.sheetName,
        linha: rawRowTable.rowIndex,
        coluna: rawCellTable.columnLetter,
        cabecalho: rawCellTable.columnHeader,
        original: rawCellTable.rawValue,
        tipoOriginal: rawCellTable.sourceType,
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
        sql`${entityIdentifierTable.identifierValue} = 'QYQ6A80'
            AND ${attributeTable.code} = 'cavalo.ipva_licenciamento'
            AND ${snapshotTable.sourceLabel} = 'EMPURRADA_2_12_2025'`,
      );
    if (trace) {
      console.log(`  ${trace.placa} · ${trace.atributo} · ${trace.vigencia}`);
      console.log(`  valor canônico ...... ${trace.valor}`);
      console.log(
        `  origem .............. aba "${trace.aba}", linha ${trace.linha}, coluna ${trace.coluna} ("${trace.cabecalho}")`,
      );
      console.log(
        `  valor original ...... ${trace.original} (tipo SheetJS "${trace.tipoOriginal}")`,
      );
    }
  } finally {
    await pool.end();
  }
}

async function layerCounts(db: ReturnType<typeof createDb>["db"]) {
  const total = sql<number>`count(*)`.mapWith(Number);
  const [rawSheets] = await db.select({ count: total }).from(rawSheetTable);
  const [rawRows] = await db.select({ count: total }).from(rawRowTable);
  const [rawCells] = await db.select({ count: total }).from(rawCellTable);
  const [staged] = await db.select({ count: total }).from(stagedFactTable);
  const [issues] = await db.select({ count: total }).from(validationIssueTable);
  const [snapshots] = await db.select({ count: total }).from(snapshotTable);
  const [entities] = await db.select({ count: total }).from(entityTable);
  const [identifiers] = await db.select({ count: total }).from(entityIdentifierTable);
  const [attributes] = await db.select({ count: total }).from(attributeTable);
  const [facts] = await db.select({ count: total }).from(factTable);
  return {
    rawSheets: rawSheets.count,
    rawRows: rawRows.count,
    rawCells: rawCells.count,
    staged: staged.count,
    issues: issues.count,
    snapshots: snapshots.count,
    entities: entities.count,
    identifiers: identifiers.count,
    attributes: attributes.count,
    facts: facts.count,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
