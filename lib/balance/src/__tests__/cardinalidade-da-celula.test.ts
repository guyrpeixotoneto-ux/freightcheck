import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  criarBancoComExportRealPromovido,
  type TestDb,
} from "@workspace/ingest/testing";
import { celulasEmFato } from "../proveniencia";

/**
 * **Quantas vezes a mesma célula pode ser contada — medido, não suposto.**
 *
 * `celulasEmFato` conta `COUNT(DISTINCT f.raw_cell_id)`. O `DISTINCT` é a
 * diferença entre uma contagem e um número que passa da massa do arquivo sem
 * nada acusando, e ele só se justifica se a duplicação for possível. O schema
 * diz que é: a grade de `fact` é `(snapshot_id, entity_id, attribute_id)` e
 * `raw_cell_id` não entra nela; a de `staged_fact` é `(import_run_id,
 * snapshot_label, entity_type, entity_key, attribute_code)` e `raw_cell_id`
 * também não. Permitido pelo banco, porém, não é o mesmo que acontecido no
 * pipeline — e a diferença entre as duas coisas é exatamente o que este arquivo
 * resolve, sobre o **export real** promovido.
 *
 * Duas perguntas, e as duas com resposta escrita nas expectativas abaixo:
 *
 *   1. uma `raw_cell_id` aparece em mais de um `snapshot_label` de
 *      `staged_fact`? (a hipótese da "expansão");
 *   2. uma `raw_cell_id` sustenta mais de uma linha de `fact`?
 *
 * Se algum dia uma delas mudar, este teste quebra — e é para quebrar: o dia em
 * que o pipeline passar a expandir uma célula é o dia em que a soma de
 * `celulasEmFato` entre recortes deixa de fechar com a massa do arquivo.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await criarBancoComExportRealPromovido("cardinalidade_da_celula");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a cardinalidade da célula RAW", () => {
  it("no export real, nenhuma célula preparada aparece em mais de um rótulo de vigência", async () => {
    const { rows } = await ctx.db.execute<{
      celulas_em_varios_rotulos: number;
      maximo_de_rotulos: number;
    }>(sql`
      WITH por_celula AS (
        SELECT sf.raw_cell_id, count(DISTINCT sf.snapshot_label) AS rotulos
          FROM staged_fact sf
         GROUP BY 1
      )
      SELECT count(*) FILTER (WHERE rotulos > 1)::int AS celulas_em_varios_rotulos,
             max(rotulos)::int                        AS maximo_de_rotulos
        FROM por_celula
    `);

    expect(rows[0]!.maximo_de_rotulos).toBe(1);
    expect(rows[0]!.celulas_em_varios_rotulos).toBe(0);
  });

  it("no export real, nenhuma célula sustenta mais de um fato", async () => {
    const { rows } = await ctx.db.execute<{
      celulas_com_varios_fatos: number;
      maximo_de_fatos: number;
    }>(sql`
      WITH por_celula AS (
        SELECT f.raw_cell_id, count(*) AS fatos FROM fact f GROUP BY 1
      )
      SELECT count(*) FILTER (WHERE fatos > 1)::int AS celulas_com_varios_fatos,
             max(fatos)::int                        AS maximo_de_fatos
        FROM por_celula
    `);

    expect(rows[0]!.maximo_de_fatos).toBe(1);
    expect(rows[0]!.celulas_com_varios_fatos).toBe(0);
  });

  /*
    O `DISTINCT` fica mesmo com as duas respostas acima em 1, e não por
    superstição: ele é o que mantém a conta certa **se** o pipeline mudar, e o
    caso que o torna possível não é hipotético. Dois escopos canônicos distintos
    sob o mesmo `scope_hash` — o CNPJ mascarado num arquivo e sem máscara no
    outro, que a `0015` descreve — dão dois snapshots vivos no mesmo recorte, e
    aí a mesma célula pode ser alcançada duas vezes pela mesma consulta.
  */
  it("conta a célula uma vez por recorte, ainda que o recorte tenha vários snapshots vivos", async () => {
    const { rows: vivos } = await ctx.db.execute<{ id: string }>(sql`
      SELECT id::text FROM snapshot WHERE status <> 'SUPERSEDED' ORDER BY id
    `);
    const ids = vivos.map((v) => v.id);
    expect(ids.length).toBeGreaterThan(0);

    const { rows: distintas } = await ctx.db.execute<{ celulas: number }>(sql`
      SELECT count(DISTINCT f.raw_cell_id)::int AS celulas
        FROM fact f
       WHERE f.snapshot_id IN (${sql.join(
         ids.map((id) => sql`${id}::uuid`),
         sql`, `,
       )})
    `);

    /* A função concorda com a conta feita à mão sobre os mesmos snapshots… */
    expect(await celulasEmFato(ctx.db, ids)).toBe(distintas[0]!.celulas);

    /* …e passar o mesmo snapshot duas vezes não dobra o número. */
    expect(await celulasEmFato(ctx.db, [...ids, ...ids])).toBe(distintas[0]!.celulas);
  });

  it("sem snapshot nenhum, a conta é zero e não uma varredura do acervo", async () => {
    expect(await celulasEmFato(ctx.db, [])).toBe(0);
  });
});
