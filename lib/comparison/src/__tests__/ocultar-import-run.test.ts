import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setImportRunHidden } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * Ocultar um import_run tira as vigências dele do agregado — reversível, sem
 * apagar nada. `vigencias()` reproduz o `NOT EXISTS` que `getOverview` (e
 * toda consulta de agregado) usa, sem depender do resto daquela função.
 */

let ctx: TestDb;

const ATTRIBUTES: AttributeSpec[] = [
  { code: "carreta.modelo", dataType: "TEXT", semanticsStatus: "PRESUMED" },
];

beforeAll(async () => {
  ctx = await createTestDatabase("ocultar-import-run");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

async function vigencias(): Promise<number> {
  const { rows } = await ctx.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM snapshot
     WHERE status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = snapshot.import_run_id AND import_run.hidden_at IS NOT NULL)`);
  return rows[0].n;
}

it("some do agregado quando oculto, e volta quando reexibido", async () => {
  const antes = await vigencias();

  const { snapshotIds } = await buildFixture(ctx.db, ATTRIBUTES, [
    { label: `X-${Math.random()}`, effectiveDate: "2026-03-01", data: { AAA1A11: { "carreta.modelo": "Randon" } } },
  ]);
  const [snapshotId] = Object.values(snapshotIds);

  expect(await vigencias()).toBe(antes + 1);

  const { rows } = await ctx.db.execute<{ import_run_id: string }>(
    sql`SELECT import_run_id FROM snapshot WHERE id = ${snapshotId}::uuid`,
  );
  const importRunId = rows[0].import_run_id;

  const oculto = await setImportRunHidden(ctx.db, importRunId, true, {
    by: "teste@teste.com",
    reason: "validando a feature de ocultar",
  });
  expect(oculto?.hiddenAt).not.toBeNull();
  expect(await vigencias()).toBe(antes);

  const reexibido = await setImportRunHidden(ctx.db, importRunId, false, {
    by: "teste@teste.com",
  });
  expect(reexibido?.hiddenAt).toBeNull();
  expect(await vigencias()).toBe(antes + 1);
});

describe("run inexistente", () => {
  it("devolve null em vez de inventar uma linha", async () => {
    const result = await setImportRunHidden(
      ctx.db,
      "00000000-0000-0000-0000-000000000000",
      true,
      { by: "teste@teste.com" },
    );
    expect(result).toBeNull();
  });
});
