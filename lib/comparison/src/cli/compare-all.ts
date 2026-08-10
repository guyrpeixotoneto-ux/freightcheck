/**
 * Compare every consecutive pair of live snapshots and print the result.
 *
 * Usage: DATABASE_URL=... tsx src/cli/compare-all.ts
 */
import { createDb } from "@workspace/db";
import { computeChangeSet } from "../engine";
import { getChangeSetBreakdown, listChanges, listComparableSnapshots } from "../query";

const { db, pool } = createDb(process.env.DATABASE_URL!);
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

try {
  const snapshots = await listComparableSnapshots(db);
  console.log(`\n${snapshots.length} snapshots vivos. Comparando pares consecutivos.\n`);

  let totalSource = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1];
    const b = snapshots[i];
    const set = await computeChangeSet(db, a.id, b.id, {
      computedBy: "cli:compare-all",
      force: true,
    });
    totalSource += set.valueChanges;
    console.log(
      `  ${a.sourceLabel.padEnd(20)} → ${b.sourceLabel.padEnd(20)} ` +
        `${String(set.valueChanges).padStart(5)} valores · ` +
        `+${set.entitiesAdded}/-${set.entitiesRemoved} ativos · ` +
        `+${set.attributesAdded}/-${set.attributesRemoved} colunas · ` +
        `${set.inconclusive} inconclusivas · ` +
        `impacto ${set.calculatedImpact === null ? "não calculável" : "R$ " + n(set.calculatedImpact)}`,
    );
  }
  console.log(`\n  TOTAL de mudanças de valor: ${n(totalSource)}`);

  // Detail on the last transition.
  const a = snapshots[snapshots.length - 2];
  const b = snapshots[snapshots.length - 1];
  const set = await computeChangeSet(db, a.id, b.id);
  console.log(`\n── ${a.sourceLabel} → ${b.sourceLabel}: 10 maiores ──`);
  const { rows, total } = await listChanges(db, set.id, { limit: 10 });
  console.log(`  (${total} alterações no total)\n`);
  console.log(
    `  ${"ATRIBUTO".padEnd(34)} ${"PLACA".padEnd(9)} ${"ANTES".padStart(12)} ${"AGORA".padStart(12)} ${"VAR%".padStart(9)} ${"CLASSE".padEnd(9)} IMPACTO`,
  );
  for (const r of rows) {
    console.log(
      `  ${(r.attributeCode ?? "—").padEnd(34)} ${(r.entityLabel ?? "—").padEnd(9)} ` +
        `${(r.valueBefore ?? "—").padStart(12)} ${(r.valueAfter ?? "—").padStart(12)} ` +
        `${(r.deltaPercent === null ? "—" : r.deltaPercent.toFixed(1) + "%").padStart(9)} ` +
        `${(r.costClass ?? "—").padEnd(9)} ` +
        `${r.impactConfidence === "CALCULATED" ? "R$ " + n(r.impactAmount!) : r.impactConfidence}`,
    );
  }

  const breakdown = await getChangeSetBreakdown(db, set.id);
  console.log(`\n  por classe de custo:`);
  for (const c of breakdown.byCostClass) {
    console.log(`    ${c.costClass.padEnd(12)} ${String(c.count).padStart(5)} alterações`);
  }
  console.log(`  por tipo:`);
  for (const c of breakdown.byType) {
    console.log(`    ${c.changeType.padEnd(20)} ${String(c.count).padStart(5)}`);
  }
  console.log(`  por status semântico:`);
  for (const c of breakdown.bySemantics) {
    console.log(`    ${c.semanticsStatus.padEnd(12)} ${String(c.count).padStart(5)}`);
  }
} finally {
  await pool.end();
}
