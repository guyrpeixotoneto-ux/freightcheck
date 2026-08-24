import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeChangeSet, findPreviousSnapshot } from "../engine";
import { garantirComparacoes, paresDaSerie } from "../garantia";
import type { SeriesContext } from "../series";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * A garantia percorre **todos** os pares que faltam do recorte — e não um
 * subconjunto deles.
 *
 * Este arquivo existe porque a promessa e a implementação tinham divergido em
 * silêncio. `garantirComparacoes` dizia "só os que faltam são calculados" e
 * decidia o que falta por `snapshot_b_id IN (…)`: qualquer `change_set` com
 * aquele `snapshot_b` — inclusive o de um par arbitrário gravado pela tela
 * Comparar, inclusive um `STALE` — bastava para a vigência ser dada por
 * garantida. A Visão Gerencial, que exige o par canônico e `DONE`, continuava
 * mostrando a mesma vigência como "sem comparação" depois de a garantia ter
 * passado por ela: um furo que não aparece em nenhum contador, porque os dois
 * lados estavam convictos.
 *
 * As três provas abaixo são as três formas desse furo, e a quarta é a que
 * impede que o índice em SQL (`paresDaSerie`) vire, com o tempo, uma segunda
 * definição de "vigência anterior" ao lado de `findPreviousSnapshot`.
 */

let ctx: TestDb;
const ESCOPO = "escopo-garantia-serie";
const CANAL = "SERIE";

const CAVALO: AttributeSpec[] = [
  {
    code: "cavalo.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

const JAN = "2026-01-01";
const FEV = "2026-02-01";
const MAR = "2026-03-01";
const ABR = "2026-04-01";

const contexto: SeriesContext = { scopeHash: ESCOPO, channel: CANAL };

/** As vigências vivas do escopo, por data — a ordem em que a série se lê. */
async function porData(): Promise<Record<string, string>> {
  const vigencias = await paresDaSerie(ctx.db, contexto);
  return Object.fromEntries(vigencias.map((v) => [v.effectiveDate, v.id]));
}

async function paresGravados(): Promise<string[]> {
  const { rows } = await ctx.db.execute<{ par: string }>(sql`
    SELECT cs.snapshot_a_id || '|' || cs.snapshot_b_id AS par
      FROM change_set cs
     ORDER BY 1
  `);
  return rows.map((r) => r.par);
}

beforeAll(async () => {
  ctx = await createTestDatabase("garantia_serie");
  await seedTaxonomy(ctx.db, "test");

  await buildFixture(
    ctx.db,
    CAVALO,
    [
      { label: `${CANAL}_1_1_2026`, effectiveDate: JAN, data: { AAA1A11: { "cavalo.custo_fixo": 1000 } } },
      { label: `${CANAL}_1_2_2026`, effectiveDate: FEV, data: { AAA1A11: { "cavalo.custo_fixo": 1100 } } },
      { label: `${CANAL}_1_3_2026`, effectiveDate: MAR, data: { AAA1A11: { "cavalo.custo_fixo": 1200 } } },
      { label: `${CANAL}_1_4_2026`, effectiveDate: ABR, data: { AAA1A11: { "cavalo.custo_fixo": 1300 } } },
    ],
    { entityType: "CAVALO", scopeHash: ESCOPO, canal: CANAL },
  );
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a série em SQL e a série do motor dizem a mesma coisa", () => {
  it("o anterior de cada vigência é o mesmo que findPreviousSnapshot devolve", async () => {
    const vigencias = await paresDaSerie(ctx.db, contexto);
    expect(vigencias.map((v) => v.effectiveDate)).toEqual([JAN, FEV, MAR, ABR]);

    for (const vigencia of vigencias) {
      expect(vigencia.anteriorId).toBe(await findPreviousSnapshot(ctx.db, vigencia.id));
    }
  });

  it("a janela do contexto recorta o que é garantido, não a busca do anterior", async () => {
    const datas = await porData();
    const recortado = await paresDaSerie(ctx.db, { ...contexto, janela: { de: MAR, ate: ABR } });

    expect(recortado.map((v) => v.effectiveDate)).toEqual([MAR, ABR]);
    // Março é a primeira vigência **do recorte** e continua tendo anterior: a
    // janela não pode inventar uma primeira da série que não existe.
    expect(recortado[0].anteriorId).toBe(datas[FEV]);
  });
});

describe("o que conta como comparação já existente", () => {
  it("um par arbitrário não faz a vigência passar por comparada", async () => {
    const datas = await porData();

    // A tela Comparar grava janeiro contra abril: mesmo `snapshot_b`, outro
    // `snapshot_a`. É a comparação que a home **não** lê.
    await computeChangeSet(ctx.db, datas[JAN], datas[ABR], { computedBy: "test:arbitrario" });
    expect(await paresGravados()).toEqual([`${datas[JAN]}|${datas[ABR]}`]);

    const garantia = await garantirComparacoes(ctx.db, contexto, undefined, {
      computedBy: "test:garantia",
    });

    // Três transições canônicas (JAN→FEV, FEV→MAR, MAR→ABR) e uma primeira de
    // série. Abril entra na conta mesmo já tendo um `change_set` pendurado.
    expect(garantia).toMatchObject({ calculados: 3, jaExistiam: 0, semAnterior: 1, falhas: [] });

    const pares = await paresGravados();
    expect(pares).toContain(`${datas[MAR]}|${datas[ABR]}`);
    // O par arbitrário continua onde estava: a garantia não apaga o que a tela
    // Comparar gravou, ela só deixa de confundi-lo com o par canônico.
    expect(pares).toContain(`${datas[JAN]}|${datas[ABR]}`);
    expect(pares).toHaveLength(4);
  });

  it("rodar de novo não recalcula nem duplica nada", async () => {
    const antes = await paresGravados();

    const garantia = await garantirComparacoes(ctx.db, contexto, undefined, {
      computedBy: "test:garantia",
    });

    expect(garantia).toMatchObject({ calculados: 0, jaExistiam: 3, semAnterior: 1, falhas: [] });
    expect(await paresGravados()).toEqual(antes);
  });

  it("uma comparação STALE é trabalho a refazer, não trabalho feito", async () => {
    const datas = await porData();
    await ctx.db.execute(sql`
      UPDATE change_set SET status = 'STALE'
       WHERE snapshot_a_id = ${datas[FEV]}::uuid AND snapshot_b_id = ${datas[MAR]}::uuid
    `);

    const garantia = await garantirComparacoes(ctx.db, contexto, undefined, {
      computedBy: "test:garantia",
    });

    expect(garantia).toMatchObject({ calculados: 1, jaExistiam: 2, semAnterior: 1, falhas: [] });

    const { rows } = await ctx.db.execute<{ status: string }>(sql`
      SELECT cs.status FROM change_set cs
       WHERE cs.snapshot_a_id = ${datas[FEV]}::uuid AND cs.snapshot_b_id = ${datas[MAR]}::uuid
    `);
    expect(rows.map((r) => r.status)).toEqual(["DONE"]);
  });
});
