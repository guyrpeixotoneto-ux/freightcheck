/**
 * Seed the taxonomy, run the proposal pass and print the curation queue.
 *
 * Usage: DATABASE_URL=... tsx src/cli/curate-report.ts
 */
import { createDb } from "@workspace/db";
import { seedTaxonomy } from "../taxonomy";
import { getCurationQueue, getCurationSummary, runProposalPass } from "../engine";
import { applyConfirmations } from "../confirmations";

const { db, pool } = createDb(process.env.DATABASE_URL!);
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

try {
  const seed = await seedTaxonomy(db, "cli:f2-bootstrap");
  console.log(`\nTAXONOMIA: ${seed.created} nós criados, ${seed.existing} já existiam.`);

  const pass = await runProposalPass(db, "engine:proposal-pass");
  console.log(`\nPASSE DE PROPOSTA`);
  console.log(`  atributos examinados .... ${pass.examined}`);
  console.log(`  movidos p/ PRESUMED ..... ${pass.proposed}`);
  console.log(`  mantidos UNKNOWN ........ ${pass.leftUnknown}`);

  if (pass.conflicts.length > 0) {
    console.log(`\nCONFLITOS DE PERIODICIDADE: ${pass.conflicts.length}`);
    for (const c of pass.conflicts) console.log(`  ! ${c.message}\n`);
    console.log(`  bloqueados: ${pass.blockedByConflict.join(", ")}`);
  }

  const confirmations = await applyConfirmations(db);
  console.log(`\nCONFIRMAÇÕES REGISTRADAS (docs/curadoria — decisões humanas)`);
  console.log(`  aplicadas .......... ${confirmations.applied.join(", ") || "—"}`);
  console.log(`  já em dia .......... ${confirmations.unchanged.join(", ") || "—"}`);
  if (confirmations.missing.length > 0) {
    console.log(`  ATRIBUTO AUSENTE ... ${confirmations.missing.join(", ")}`);
  }
  // Confirmado por uma pessoa com outro significado: o registro não sobrescreve,
  // e a diferença é notícia para quem cuida dele.
  if (confirmations.divergentes.length > 0) {
    console.log(`  DIVERGEM DA TELA ... ${confirmations.divergentes.join(", ")}`);
  }
  if (confirmations.incoerentes.length > 0) {
    console.log(`  TIPO INCOMPATÍVEL .. ${confirmations.incoerentes.join(", ")}`);
  }

  const summary = await getCurationSummary(db);
  console.log(`\nSEMÂNTICA`);
  for (const row of summary.byStatus) {
    console.log(
      `  ${row.status.padEnd(10)} ${String(row.count).padStart(4)}  (monetários: ${row.monetary})`,
    );
  }
  console.log(`  não classificados na taxonomia: ${summary.unclassified}`);

  const queue = await getCurationQueue(db);
  console.log(`\nFILA DE CURADORIA — 20 primeiros (ordem por materialidade)`);
  console.log(
    `  ${"ATRIBUTO".padEnd(38)} ${"UNID".padEnd(7)} ${"AGREG".padEnd(6)} ${"STATUS".padEnd(9)} ${"MAGNITUDE*".padStart(14)}`,
  );
  for (const item of queue.slice(0, 20)) {
    console.log(
      `  ${item.code.padEnd(38)} ${(item.unit ?? "—").padEnd(7)} ${(item.aggregation ?? "—").padEnd(6)} ${item.semanticsStatus.padEnd(9)} ${(item.magnitude === null ? "—" : n(item.magnitude)).padStart(14)}`,
    );
  }
  console.log(`\n  * soma bruta não auditada da última vigência — serve só para priorizar,`);
  console.log(`    não é valor apurado. É o que a curadoria vai tornar confiável.`);
} finally {
  await pool.end();
}
