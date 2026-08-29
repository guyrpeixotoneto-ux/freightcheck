import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setImportRunHidden } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  buildFixture,
  type AttributeSpec,
} from "@workspace/comparison/testing";
import { listarBalancos } from "../balanco";
import { runsDeProveniencia } from "../proveniencia";

/**
 * As quatro regras que a cobertura por recorte não pode perder de vista.
 *
 * Cada uma delas já foi, em algum momento desta investigação, a resposta óbvia
 * e errada — e é por isso que estão presas aqui e não só escritas num comentário:
 *
 *   1. a proveniência é do **fato**, não do dono da vigência;
 *   2. herdar um fato não troca a origem dele;
 *   3. run oculto não entra na proveniência...
 *   4. ...nem na cobertura global, que era o agregado que ignorava o próprio
 *      contrato de `hidden_at`.
 */

let ctx: TestDb;

const ATRIBUTOS: AttributeSpec[] = [
  { code: "cavalo.valor_a", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
  { code: "cavalo.valor_b", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
];

async function runDoSnapshot(snapshotId: string): Promise<string> {
  const { rows } = await ctx.db.execute<{ import_run_id: string }>(
    sql`SELECT import_run_id::text FROM snapshot WHERE id = ${snapshotId}::uuid`,
  );
  return rows[0].import_run_id;
}

beforeAll(async () => {
  ctx = await createTestDatabase("proveniencia");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

it("a proveniência segue a origem do fato, e sobrevive à herança de uma revisão parcial", async () => {
  // (1) O arquivo do cavalo abre a vigência.
  const a = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [
      {
        label: `A-${Math.random()}`,
        effectiveDate: "2026-01-01",
        data: { AAA1A11: { "cavalo.valor_a": 111 } },
      },
    ],
    { entityType: "CAVALO" },
  );
  const snapshotA = Object.values(a.snapshotIds)[0];
  const runCavalo = await runDoSnapshot(snapshotA);

  // (2) O arquivo da carreta revisa a mesma vigência...
  const b = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [
      {
        label: `B-${Math.random()}`,
        effectiveDate: "2026-02-01",
        data: { AAA1A11: { "cavalo.valor_b": 222 } },
      },
    ],
    { entityType: "CAVALO" },
  );
  const snapshotB = Object.values(b.snapshotIds)[0];
  const runCarreta = await runDoSnapshot(snapshotB);
  expect(runCavalo).not.toBe(runCarreta);

  // (3) ...e herda o fato que não tocou, do jeito que `promote` herda: o fato
  //     passa a viver no snapshot da revisão, mantendo a origem do cavalo.
  await ctx.db.execute(sql`ALTER TABLE fact DISABLE TRIGGER fact_immutable`);
  await ctx.db.execute(sql`
    INSERT INTO fact (
      snapshot_id, entity_id, attribute_id, value_numeric, value_text,
      value_boolean, value_date, value_hash, is_null, null_reason, raw_cell_id,
      inherited_from_snapshot_id, origin_import_run_id
    )
    SELECT ${snapshotB}::uuid, f.entity_id, f.attribute_id, f.value_numeric, f.value_text,
           f.value_boolean, f.value_date, f.value_hash, f.is_null, f.null_reason, f.raw_cell_id,
           ${snapshotA}::uuid, f.origin_import_run_id
      FROM fact f
     WHERE f.snapshot_id = ${snapshotA}::uuid
  `);
  await ctx.db.execute(sql`ALTER TABLE fact ENABLE TRIGGER fact_immutable`);

  // A vigência pertence à carreta — e é exatamente por isso que
  // `snapshot.import_run_id` não serve: sozinho, ele diria que o arquivo do
  // cavalo não alimenta esta tela, quando metade do que ela mostra veio dele.
  expect(await runDoSnapshot(snapshotB)).toBe(runCarreta);

  const runs = await runsDeProveniencia(ctx.db, [snapshotB]);
  expect(new Set(runs)).toEqual(new Set([runCavalo, runCarreta]));

  // (4) Ocultar o arquivo do cavalo tira o fato herdado da leitura — então tira
  //     a importação da proveniência também. Não fosse pela origem real, o
  //     filtro olharia o dono da vigência e não alcançaria este caso.
  await setImportRunHidden(ctx.db, runCavalo, true, {
    by: "teste@teste.com",
    reason: "a origem tem de sobreviver à herança",
  });

  expect(await runsDeProveniencia(ctx.db, [snapshotB])).toEqual([runCarreta]);

  // (5) E o contrato de `hidden_at` vale para a cobertura global também: a
  //     lista que alimenta o percentual não pode continuar contando o arquivo
  //     que o usuário tirou de todo agregado.
  const balancos = await listarBalancos(ctx.db);
  expect(balancos.map((x) => x.importRunId)).not.toContain(runCavalo);
  expect(balancos.map((x) => x.importRunId)).toContain(runCarreta);

  // (6) Ocultar não é excluir: desfazer devolve as duas coisas.
  await setImportRunHidden(ctx.db, runCavalo, false, {
    by: "teste@teste.com",
    reason: "de volta",
  });
  expect(new Set(await runsDeProveniencia(ctx.db, [snapshotB]))).toEqual(
    new Set([runCavalo, runCarreta]),
  );
  expect((await listarBalancos(ctx.db)).map((x) => x.importRunId)).toContain(
    runCavalo,
  );
});

it("sem snapshot não há proveniência — e a resposta é vazia, não 'tudo'", async () => {
  // O caso que transformaria a métrica no seu contrário: um recorte sem
  // snapshot algum caindo num conjunto vazio que uma implementação distraída
  // leria como "sem filtro", devolvendo a cobertura global sob o rótulo da
  // unidade — exatamente o defeito que esta mudança existe para corrigir.
  expect(await runsDeProveniencia(ctx.db, [])).toEqual([]);
});
