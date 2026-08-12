/**
 * Relatório da visão agrupada, para conferir contra os dados reais.
 *
 * Usage: DATABASE_URL=... tsx src/cli/grouped-report.ts [YYYY-MM-DD ...]
 */
import { createDb } from "@workspace/db";
import { getGroupedView, getAttributeSeries } from "../grouped";

const { db, pool } = createDb(process.env.DATABASE_URL!);
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

try {
  const periods = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const targets = periods.length ? periods : [undefined];

  for (const period of targets) {
    const view = await getGroupedView(db, period);
    if (!view) { console.log("sem vigências"); break; }

    console.log(`\n${"=".repeat(100)}`);
    console.log(`VIGÊNCIA ${view.periodLabel}  (${view.period})`);
    console.log("=".repeat(100));
    for (const s of view.series) {
      console.log(
        `  ${s.equipment.padEnd(10)} ${(s.previousLabel ?? "—")} → ${s.snapshotLabel}` +
        `  ·  ${s.fleet} ativos${s.reason ? `  ·  ${s.reason}` : ""}`,
      );
    }
    if (!view.complete) console.log(`  SÉRIES AUSENTES: ${view.missingSeries.join(", ")}`);

    const i = view.impact;
    const fmt = (b: Record<string, number>) =>
      Object.keys(b).length === 0 ? "nenhum" : Object.entries(b).map(([p, v]) => `${brl(v)}/${p.toLowerCase()}`).join("  +  ");
    console.log(`\n  ${view.totals.changes} alterações  →  ${view.totals.groups} grupos  ·  ${view.totals.vehiclesTouched} ativos tocados  ·  ${view.totals.unchanged} valores sem alteração`);
    console.log(`  IMPACTO DESTA VIGÊNCIA : ${fmt(i.byPeriodicity)}`);
    console.log(`  fora por dupla contagem: ${fmt(i.excludedByPeriodicity)}  (${i.excludedChanges} alterações)`);
    console.log(`  sem preço              : ${i.notCalculable} alterações`);
    console.log(`  ACUMULADO (${view.accumulated.comparisons} comparações, ${view.accumulated.from} → ${view.accumulated.to}): ${fmt(view.accumulated.byPeriodicity)}`);

    console.log(`\n  ${"SELO".padEnd(12)}${"GRUPO".padEnd(42)}${"ABRANGÊNCIA".padEnd(30)}${"ANTES→DEPOIS".padEnd(30)}${"IMPACTO"}`);
    for (const g of view.groups) {
      const ad = g.aggregate.summable && g.aggregate.totalBefore !== null
        ? `${brl(g.aggregate.totalBefore)} → ${brl(g.aggregate.totalAfter!)}${g.aggregate.deltaPercent !== null ? ` (${g.aggregate.deltaPercent > 0 ? "+" : ""}${g.aggregate.deltaPercent}%)` : ""}`
        : g.aggregate.minPercent !== null
          ? `faixa ${g.aggregate.minPercent}% a ${g.aggregate.maxPercent}% (não somável)`
          : "não somável";
      const imp = g.impact.amount !== null
        ? `${brl(g.impact.amount)}${g.impact.periodicity ? "/" + g.impact.periodicity.toLowerCase() : ""}`
        : "não calculável";
      console.log(
        `  ${g.badge.padEnd(12)}${(g.title + " — " + g.equipment).slice(0, 40).padEnd(42)}` +
        `${g.coverageLabel.padEnd(30)}${ad.slice(0, 29).padEnd(30)}${imp}`,
      );
      if (g.patterns > 1) console.log(`  ${" ".repeat(12)}  ↳ ${g.patterns} padrões distintos`);
      if (g.impact.excludedVehicles > 0)
        console.log(`  ${" ".repeat(12)}  ↳ FORA DO TOTAL em ${g.impact.excludedVehicles} de ${g.vehicles}: ${brl(g.impact.excludedAmount!)}`);
      for (const a of g.anomalies)
        console.log(`  ${" ".repeat(12)}  ↳ ANOMALIA (${a.vehicles} veículos, mesmo instante=${a.sameInstant}): ${a.interpretation}`);
    }
  }

  // O relatório formata pela unidade declarada, e não por ser numérico —
  // imprimir "R$ 50,64" para uma quantidade de meses ensinaria o erro que o
  // produto existe para pegar.
  const fmtUnit = (v: number | null, unit: string | null) =>
    v === null ? "—" : unit === "BRL" ? brl(v) : `${n(v)}${unit ? ` ${unit.toLowerCase()}` : ""}`;

  for (const code of process.argv.slice(2).filter((a) => a.includes("."))) {
    const s = await getAttributeSeries(db, code);
    if (!s) { console.log(`\n${code}: não encontrado`); continue; }
    console.log(`\n${"=".repeat(100)}\nSÉRIE — ${s.title} (${s.attributeCode})`);
    console.log(`  agregação ${s.aggregation} · somável=${s.summable} · média legítima=${s.averageable} · ${s.semanticsStatus}`);
    console.log(`  ${s.note}`);
    console.log(
      `  ${"vigência".padEnd(18)}${"veíc.".padStart(6)}${"numéricos".padStart(8)}` +
        `${"soma".padStart(18)}${"média/veículo".padStart(18)}`,
    );
    for (const p of s.points)
      console.log(
        `  ${p.periodLabel.padEnd(18)}${String(p.vehicles).padStart(6)}` +
          `${String(p.numericVehicles).padStart(8)}${fmtUnit(p.total, s.unit).padStart(18)}` +
          `${fmtUnit(p.average, s.unit).padStart(18)}`,
      );
  }
} finally {
  await pool.end();
}
