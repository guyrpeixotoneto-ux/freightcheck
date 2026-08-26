import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setImportRunHidden } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { FATO_DE_ORIGEM_VISIVEL } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * Herdar um fato não troca a origem dele.
 *
 * O cenário é o do produto, e era o furo: importa-se o cavalo, depois a carreta
 * revisa a mesma vigência e herda os fatos de cavalo que não toca. A vigência
 * passa a ter `import_run_id` da carreta — um valor só por vigência, sempre o da
 * última revisão —, e ocultar a importação do cavalo não escondia nada, porque o
 * filtro perguntava quem é o dono da vigência em vez de de onde veio o dado.
 *
 * Aqui a herança é montada à mão, e não pelo `promote`: o que está sob teste é a
 * regra de visibilidade, e montá-la direto deixa as duas origens explícitas na
 * mesma vigência — que é a situação que nenhuma fixture de arquivo produz sem
 * arrastar junto o pipeline inteiro.
 */

let ctx: TestDb;

const ATRIBUTOS: AttributeSpec[] = [
  { code: "cavalo.valor_a", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
  { code: "cavalo.valor_b", dataType: "NUMERIC", semanticsStatus: "PRESUMED" },
];

/** O que a vigência mostra hoje, pela definição única de fato visível. */
async function visiveis(snapshotId: string): Promise<Record<string, string>> {
  const { rows } = await ctx.db.execute<{ code: string; valor: string }>(sql`
    SELECT a.code, f.value_numeric::text AS valor
      FROM fato_visivel f
      JOIN attribute a ON a.id = f.attribute_id
     WHERE f.snapshot_id = ${snapshotId}::uuid
     ORDER BY a.code
  `);
  return Object.fromEntries(rows.map((r) => [r.code, r.valor]));
}

beforeAll(async () => {
  ctx = await createTestDatabase("origem_do_fato_oculto");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

it("oculta o fato pela origem real, inclusive o herdado por outra importação", async () => {
  // (1) Importação A traz o fato de cavalo.
  const a = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [{ label: `A-${Math.random()}`, effectiveDate: "2026-01-01", data: { AAA1A11: { "cavalo.valor_a": 111 } } }],
    { entityType: "CAVALO" },
  );
  const snapshotA = Object.values(a.snapshotIds)[0];

  // (2) Importação B abre a vigência seguinte com um fato próprio...
  const b = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [{ label: `B-${Math.random()}`, effectiveDate: "2026-02-01", data: { AAA1A11: { "cavalo.valor_b": 222 } } }],
    { entityType: "CAVALO" },
  );
  const snapshotB = Object.values(b.snapshotIds)[0];

  const runDe = async (snapshotId: string): Promise<string> => {
    const { rows } = await ctx.db.execute<{ import_run_id: string }>(
      sql`SELECT import_run_id::text FROM snapshot WHERE id = ${snapshotId}::uuid`,
    );
    return rows[0].import_run_id;
  };
  const runA = await runDe(snapshotA);
  const runB = await runDe(snapshotB);
  expect(runA).not.toBe(runB);

  // (3) ...e herda o fato de A, do jeito que `promote` herda: o fato passa a
  //     viver no snapshot de B, mantendo `raw_cell_id` e a origem de A.
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

  // A vigência agora pertence a B e carrega as duas origens.
  expect(await runDe(snapshotB)).toBe(runB);
  expect(await visiveis(snapshotB)).toEqual({
    "cavalo.valor_a": "111.000000",
    "cavalo.valor_b": "222.000000",
  });

  // (4) Oculto A.
  await setImportRunHidden(ctx.db, runA, true, {
    by: "teste@teste.com",
    reason: "a origem tem de sobreviver à herança",
  });

  // (5) e (6): o fato de A some — mesmo herdado por B —, o de B permanece.
  expect(await visiveis(snapshotB)).toEqual({ "cavalo.valor_b": "222.000000" });

  // (7) O snapshot de B não some, e continua sendo de B.
  const { rows: vigencias } = await ctx.db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM snapshot
     WHERE id = ${snapshotB}::uuid
       AND NOT EXISTS (SELECT 1 FROM import_run
                        WHERE import_run.id = snapshot.import_run_id
                          AND import_run.hidden_at IS NOT NULL)`);
  expect(vigencias[0].n).toBe(1);

  // Nada foi apagado: a ocultação é uma lente de leitura, e volta atrás.
  const { rows: naTabela } = await ctx.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM fact WHERE snapshot_id = ${snapshotB}::uuid`,
  );
  expect(naTabela[0].n).toBe(2);

  await setImportRunHidden(ctx.db, runA, false, { by: "teste@teste.com" });
  expect(await visiveis(snapshotB)).toEqual({
    "cavalo.valor_a": "111.000000",
    "cavalo.valor_b": "222.000000",
  });
});

/**
 * A alteração já gravada segue os fatos que ela compara.
 *
 * `change_set` é cache: ocultar não o recalcula, e não deve — refazer um
 * change_set apaga `change`, e `justificativa` pende dele em cascata. A
 * alteração é filtrada na leitura, e volta inteira quando a importação reaparece.
 */
it("a alteração deixa de contar quando o fato que ela cita foi ocultado", async () => {
  const { snapshotIds } = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [
      { label: `D1-${Math.random()}`, effectiveDate: "2026-07-01", data: { DDD4D44: { "cavalo.valor_a": 10 } } },
      { label: `D2-${Math.random()}`, effectiveDate: "2026-08-01", data: { DDD4D44: { "cavalo.valor_a": 20 } } },
    ],
    { entityType: "CAVALO" },
  );
  const [snapA, snapB] = Object.values(snapshotIds);

  const { rows: fatos } = await ctx.db.execute<{ id: string; snapshot_id: string }>(sql`
    SELECT id::text, snapshot_id::text FROM fact
     WHERE snapshot_id IN (${snapA}::uuid, ${snapB}::uuid) ORDER BY snapshot_id
  `);
  const fatoA = fatos.find((f) => f.snapshot_id === snapA)!;
  const fatoB = fatos.find((f) => f.snapshot_id === snapB)!;

  const [{ id: changeSetId }] = (
    await ctx.db.execute<{ id: string }>(sql`
      INSERT INTO change_set (snapshot_a_id, snapshot_b_id, status)
      VALUES (${snapA}::uuid, ${snapB}::uuid, 'DONE') RETURNING id::text`)
  ).rows;

  await ctx.db.execute(sql`
    INSERT INTO change (change_set_id, change_type, category, comparability,
                        impact_confidence, attribute_code, entity_label,
                        fact_a_id, fact_b_id)
    VALUES (${changeSetId}::uuid, 'VALUE_CHANGED', 'VALOR', 'COMPARABLE',
            'CALCULATED', 'cavalo.valor_a', 'DDD4D44',
            ${Number(fatoA.id)}, ${Number(fatoB.id)})
  `);

  const visiveisAgora = async () => {
    const { rows } = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM alteracao_visivel WHERE change_set_id = ${changeSetId}::uuid`,
    );
    return rows[0].n;
  };
  expect(await visiveisAgora()).toBe(1);

  const { rows: run } = await ctx.db.execute<{ import_run_id: string }>(
    sql`SELECT import_run_id::text FROM snapshot WHERE id = ${snapB}::uuid`,
  );
  await setImportRunHidden(ctx.db, run[0].import_run_id, true, { by: "teste@teste.com" });

  // A alteração some, e o `change` gravado continua no banco — nada foi apagado.
  expect(await visiveisAgora()).toBe(0);
  const { rows: gravadas } = await ctx.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM change WHERE change_set_id = ${changeSetId}::uuid`,
  );
  expect(gravadas[0].n).toBe(1);

  await setImportRunHidden(ctx.db, run[0].import_run_id, false, { by: "teste@teste.com" });
  expect(await visiveisAgora()).toBe(1);
});

/**
 * A view e o predicado são a mesma regra em duas formas — a view para o SQL
 * cru, o predicado para o query builder. Divergir seria a regra passar a morar
 * em dois lugares, que é o que a centralização veio evitar.
 */
it("a view e o predicado do query builder contam o mesmo", async () => {
  const pelaView = async () => {
    const { rows } = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM fato_visivel`,
    );
    return rows[0].n;
  };
  const peloPredicado = async () => {
    const { rows } = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM fact WHERE ${FATO_DE_ORIGEM_VISIVEL}`,
    );
    return rows[0].n;
  };

  const { snapshotIds } = await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [{ label: `C-${Math.random()}`, effectiveDate: "2026-05-01", data: { CCC3C33: { "cavalo.valor_a": 333 } } }],
    { entityType: "CAVALO" },
  );
  const { rows } = await ctx.db.execute<{ import_run_id: string }>(
    sql`SELECT import_run_id::text FROM snapshot WHERE id = ${Object.values(snapshotIds)[0]}::uuid`,
  );
  const run = rows[0].import_run_id;

  expect(await pelaView()).toBe(await peloPredicado());

  await setImportRunHidden(ctx.db, run, true, { by: "teste@teste.com" });
  expect(await pelaView()).toBe(await peloPredicado());

  const { rows: tudo } = await ctx.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM fact`,
  );
  expect(await pelaView()).toBeLessThan(tudo[0].n);
});
