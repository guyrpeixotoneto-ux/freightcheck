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

/** Never joined into one number: mensal and anual are different quantities. */
const fmtImpact = (buckets: Record<string, number>) => {
  const parts = Object.entries(buckets);
  if (parts.length === 0) return "não calculável";
  return parts.map(([p, v]) => `R$ ${n(v)}/${p.toLowerCase()}`).join(" + ");
};

try {
  const all = await listComparableSnapshots(db);

  // Uma vigência só se compara dentro da própria série, e quem diz qual é a
  // série é a autoridade: a chave vem lida do banco, junto da vigência. A
  // cobertura de equipamento não entra nela — ela recorta o que cada par
  // compara, dentro do motor, e não separa a série em duas.
  const series = new Map<string, typeof all>();
  for (const snapshot of all) {
    if (!series.has(snapshot.serie)) series.set(snapshot.serie, []);
    series.get(snapshot.serie)!.push(snapshot);
  }

  console.log(
    `\n${all.length} vigências vivas em ${series.size} série(s). Comparando pares consecutivos dentro de cada uma.\n`,
  );

  let totalSource = 0;
  const snapshots = all;
  for (const [key, group] of series) {
    if (series.size > 1) {
      // A chave é um hash: o cabeçalho nomeia a série pelo que ela entrega.
      const primeira = group[0];
      console.log(
        `  ── ${primeira.canal} · ${primeira.entityTypeSet} · ${group.length} vigência(s) ──`,
      );
    }
  for (let i = 1; i < group.length; i++) {
    const a = group[i - 1];
    const b = group[i];
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
        `impacto ${fmtImpact(set.calculatedImpactByPeriodicity)}`,
    );
  }
  }
  console.log(`\n  TOTAL de mudanças de valor: ${n(totalSource)}`);

  // Detail on the last transition of the last series.
  const last = [...series.values()].pop()!;
  const a = last[last.length - 2];
  const b = last[last.length - 1];
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
