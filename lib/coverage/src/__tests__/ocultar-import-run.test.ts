import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setImportRunHidden } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { provenienciaDoFato, contribuintesDaVigencia } from "../proveniencia";
import { entidadesDoAtributo } from "../observado";
import { detalheDaLacuna } from "../detalhe";

/**
 * Ocultar um import_run some com os dados dele em todo o drill-down de
 * cobertura, não só no agregado. `ocultar-import-run.test.ts` (em
 * `lib/comparison`) já prova isso para `vigencias()`; este arquivo prova a
 * mesma regra nos quatro caminhos de `lib/coverage` que liam direto de `fact`
 * sem passar pelo filtro de `hidden_at`.
 */

let ctx: TestDb;

const ATTRIBUTES: AttributeSpec[] = [
  { code: "cavalo.valor_teste", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
];

beforeAll(async () => {
  ctx = await createTestDatabase("coverage_ocultar_import_run");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

it("desaparece do drill-down de cobertura quando o import_run é ocultado", async () => {
  const { snapshotIds } = await buildFixture(
    ctx.db,
    ATTRIBUTES,
    [{ label: `X-${Math.random()}`, effectiveDate: "2026-02-01", data: { AAA1A11: { "cavalo.valor_teste": 999 } } }],
    { entityType: "CAVALO" },
  );
  const [snapshotId] = Object.values(snapshotIds);

  const { rows: factRows } = await ctx.db.execute<{ fact_id: string; import_run_id: string }>(sql`
    SELECT f.id::text AS fact_id, s.import_run_id::text AS import_run_id
      FROM fact f JOIN snapshot s ON s.id = f.snapshot_id
     WHERE f.snapshot_id = ${snapshotId}::uuid
  `);
  const { fact_id: factId, import_run_id: importRunId } = factRows[0];

  // Antes de ocultar: os quatro caminhos enxergam o dado.
  expect((await provenienciaDoFato(ctx.db, Number(factId)))?.valor).toBe("999.000000");
  expect(
    (await entidadesDoAtributo(ctx.db, snapshotId, "cavalo.valor_teste")).find(
      (e) => e.identificador === "AAA1A11",
    )?.valor,
  ).toBe("999.000000");
  expect(
    (await contribuintesDaVigencia(ctx.db, snapshotId)).some((c) => c.importRunId === importRunId),
  ).toBe(true);
  expect(await detalheDaLacuna(ctx.db, snapshotId, "cavalo.valor_teste")).not.toBeNull();

  await setImportRunHidden(ctx.db, importRunId, true, {
    by: "teste@teste.com",
    reason: "validando que o drill-down respeita a ocultação",
  });

  // Depois de ocultar: nenhum dos quatro caminhos enxerga mais nada dele.
  expect(await provenienciaDoFato(ctx.db, Number(factId))).toBeNull();
  expect(
    (await entidadesDoAtributo(ctx.db, snapshotId, "cavalo.valor_teste")).find(
      (e) => e.identificador === "AAA1A11",
    ),
  ).toBeUndefined();
  expect(
    (await contribuintesDaVigencia(ctx.db, snapshotId)).some((c) => c.importRunId === importRunId),
  ).toBe(false);
  expect(await detalheDaLacuna(ctx.db, snapshotId, "cavalo.valor_teste")).toBeNull();
});
