import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDb } from "@workspace/ingest/testing";
import { criarBancoComModelosCurados } from "../testing";
import { listPeriods } from "../consolidated";
import { getRangeAnalysis } from "../families-view";
import { getGroupedView } from "../grouped";
import { computeChangeSet } from "../engine";
import { sql } from "drizzle-orm";

/**
 * DIAGNÓSTICO — o total de uma vigência depende de alguém ter aberto um menu?
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await criarBancoComModelosCurados("diag_vazamento");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

it("o total da vigência não muda quando uma comparação salteada é gravada", async () => {
  const periodos = await listPeriods(ctx.db);
  const fim = periodos[0].effective_date;
  const salteada = periodos[periodos.length - 1].effective_date;
  console.log("VIGÊNCIAS:", periodos.map((p) => p.effective_date).join(", "));
  console.log("FIM:", fim, "| SALTEADA (mais antiga):", salteada);

  const antes = await getGroupedView(ctx.db, fim);
  const antesRange = await getRangeAnalysis(ctx.db, periodos[1].effective_date, fim);
  console.log("ANTES  — vigência:", antes!.totals.changes, "| range:", antesRange!.movements.find((m) => m.period === fim)?.changes);

  // O que o menu do par faz: calcula (e grava) a comparação de uma candidata
  // não consecutiva contra o "Para" aberto.
  const { rows: snaps } = await ctx.db.execute<{ id: string; effective_date: string; entity_type_set: string }>(sql`
    SELECT id::text, effective_date::text, entity_type_set FROM snapshot
     WHERE status <> 'SUPERSEDED' ORDER BY effective_date
  `);
  const a = snaps.find((s) => s.effective_date === salteada && s.entity_type_set !== "TRECHO");
  const b = snaps.find((s) => s.effective_date === fim && s.entity_type_set !== "TRECHO");
  console.log("GRAVANDO COMPARAÇÃO:", a?.effective_date, "->", b?.effective_date, `(${a?.entity_type_set} / ${b?.entity_type_set})`);
  await computeChangeSet(ctx.db, a!.id, b!.id);

  const depois = await getGroupedView(ctx.db, fim);
  const depoisRange = await getRangeAnalysis(ctx.db, periodos[1].effective_date, fim);
  console.log("DEPOIS — vigência:", depois!.totals.changes, "| range:", depoisRange!.movements.find((m) => m.period === fim)?.changes);

  expect(depois!.totals.changes).toBe(antes!.totals.changes);
});
