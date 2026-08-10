/**
 * From an empty database to a working FreightCheck, in one command.
 *
 *   DATABASE_URL=... pnpm run bootstrap
 *
 * Runs migrations, imports the Freightec export that lives in the repo, seeds
 * the taxonomy, runs the proposal pass and replays the confirmed semantics.
 *
 * Safe to re-run: the import is refused as a duplicate on the second pass, the
 * taxonomy seed and the confirmations registry are idempotent, and the
 * proposal pass writes nothing when nothing changed.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import { seedTaxonomy } from "../taxonomy";
import { getCurationSummary, runProposalPass } from "../engine";
import { applyConfirmations } from "../confirmations";
import { backfillSemantics } from "../versioning";

/**
 * Which workbooks to load.
 *
 * The Ambev now ships one file per equipment type (`Modelo_Carreta`,
 * `Modelo_Cavalo`); the older combined export is kept as a fixture. Prefer the
 * per-equipment pair when it is there, because that is what arrives today.
 *
 * Passing paths as arguments overrides the choice entirely.
 */
function exportPaths(): string[] {
  const explicit = process.argv.slice(2).filter((a) => a.endsWith(".xlsx"));
  if (explicit.length > 0) return explicit;

  const assets = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../attached_assets",
  );
  const files = readdirSync(assets).filter((f) => f.endsWith(".xlsx"));

  const models = files.filter((f) => /^Modelo_/i.test(f)).sort();
  if (models.length > 0) return models.map((f) => path.join(assets, f));

  const combined = files.find((f) => /Remunera/i.test(f)) ?? files[0];
  if (!combined) throw new Error(`Nenhum .xlsx encontrado em ${assets}`);
  return [path.join(assets, combined)];
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida.");
  process.exit(1);
}

console.log("\n[1/4] Aplicando migrations…");
await runMigrations(url);

const { db, pool } = createDb(url);
try {
  const paths = exportPaths();
  console.log(`[2/4] Importando ${paths.length} arquivo(s) do Freightec…`);
  for (const filePath of paths) {
    const name = filePath.split("/").pop();
    const received = await receiveFile(db, { filePath, receivedBy: "bootstrap" });

    if (received.isDuplicate) {
      console.log(`      ${name}: já importado — pulando (idempotência).`);
      continue;
    }
    await captureRaw(db, received.importRunId);
    const staged = await stage(db, received.importRunId);
    const report = await preview(db, received.importRunId);
    const promoted = await promote(db, received.importRunId);
    console.log(
      `      ${name}: ${promoted.snapshots.length} vigências · ` +
        `${promoted.factsInserted.toLocaleString("pt-BR")} fatos · ` +
        `${promoted.entitiesCreated} ativos · ${staged.errors} erros · ${report.totals.warnings} avisos`,
    );
  }

  console.log("[3/4] Semeando a taxonomia e propondo semânticas…");
  const seeded = await seedTaxonomy(db, "bootstrap");
  const pass = await runProposalPass(db, "engine:proposal-pass");
  console.log(
    `      ${seeded.created} nós criados · ${pass.proposed} propostos · ${pass.leftUnknown} sem proposta`,
  );
  for (const conflict of pass.conflicts) {
    console.log(`      [${conflict.verdict}] ${conflict.message}`);
  }

  console.log("[4/4] Aplicando as semânticas já confirmadas…");
  const confirmations = await applyConfirmations(db);
  console.log(
    `      ${confirmations.applied.length} aplicadas · ${confirmations.unchanged.length} já em dia` +
      (confirmations.missing.length > 0
        ? ` · AUSENTES: ${confirmations.missing.join(", ")}`
        : ""),
  );

  const versions = await backfillSemantics(db);
  console.log(
    `      versões de semântica: ${versions.created} criadas · ${versions.existing} já existiam (a partir de ${versions.from})`,
  );

  const summary = await getCurationSummary(db);
  console.log("\nPronto. Estado da curadoria:");
  for (const row of summary.byStatus) {
    console.log(`  ${row.status.padEnd(10)} ${String(row.count).padStart(4)}`);
  }
  console.log("\nAbra a aplicação e vá em Curadoria.\n");
} finally {
  await pool.end();
}
