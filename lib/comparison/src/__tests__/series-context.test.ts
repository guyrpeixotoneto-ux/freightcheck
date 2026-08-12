import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { channelOf } from "@workspace/ingest";
import { seedTaxonomy } from "@workspace/curation";
import { computeChangeSet, findPreviousSnapshot } from "../engine";
import { computeMissingChangeSets, getConsolidated, listPeriods } from "../consolidated";
import { getAccumulatedImpact, getAttributeSeries, getGroupedView } from "../grouped";
import {
  CHANNEL_PATTERN,
  ContextNotFoundError,
  listContexts,
  resolveContext,
} from "../series";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * O contexto de uma leitura: unidade e canal.
 *
 * Este arquivo existe por causa de dois defeitos que só apareceriam no dia da
 * primeira importação de uma segunda unidade — tarde demais, e num número já
 * publicado:
 *
 * 1. **Períodos chaveados só por data.** Duas unidades entregando agosto viravam
 *    um período só, e o cartão da tela somava as duas frotas sem dizer que
 *    somou.
 * 2. **Séries chaveadas sem canal.** Com o parser de vigência aceitando outros
 *    canais, a primeira vigência do canal ROTA tomaria a última do canal
 *    EMPURRADA como sua anterior — mesma unidade, mesma cobertura, remuneração
 *    diferente — e toda a frota apareceria alterada.
 *
 * Os dois são testados aqui com dado sintético, porque a base real tem uma
 * unidade e um canal e portanto não pode exercitá-los.
 */

let ctx: TestDb;

/** Duas unidades distintas, com placas próprias para não disputarem identidade. */
const UNIDADE_A = "scope-unidade-a";
const UNIDADE_B = "scope-unidade-b";

const CUSTO: AttributeSpec[] = [
  {
    code: "carreta.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

beforeAll(async () => {
  ctx = await createTestDatabase("series_context");
  await seedTaxonomy(ctx.db, "test");

  // Unidade A, canal EMPURRADA: 1000 -> 1200 (+200/mês).
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_1_2026",
        effectiveDate: "2026-01-02",
        data: { AAA1A11: { "carreta.custo_fixo": 1000 } },
      },
      {
        label: "EMPURRADA_2_2_2026",
        effectiveDate: "2026-02-02",
        data: { AAA1A11: { "carreta.custo_fixo": 1200 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_A },
  );

  // Unidade B, mesmo canal, **mesmas datas**: 5000 -> 4000 (−1000/mês).
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_1_2026",
        effectiveDate: "2026-01-02",
        data: { BBB2B22: { "carreta.custo_fixo": 5000 } },
      },
      {
        label: "EMPURRADA_2_2_2026",
        effectiveDate: "2026-02-02",
        data: { BBB2B22: { "carreta.custo_fixo": 4000 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_B },
  );

  // Unidade A de novo, agora no canal ROTA, na mesma data de fevereiro.
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "ROTA_2_2_2026",
        effectiveDate: "2026-02-02",
        data: { CCC3C33: { "carreta.custo_fixo": 7000 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: UNIDADE_A },
  );

  await computeMissingChangeSets(ctx.db, "test");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

/**
 * O canal é derivado em dois lugares — TypeScript na ingestão, SQL na leitura —
 * porque `snapshot` é congelado por trigger e uma coluna nova não poderia ser
 * preenchida nas vigências já importadas. Duas derivações é uma a mais do que o
 * ideal; este teste é o preço que as mantém iguais.
 */
describe("a derivação do canal, nos dois lados", () => {
  it("SQL e TypeScript concordam em cada rótulo", async () => {
    const labels = [
      "EMPURRADA_2_12_2025",
      "EMPURRADA_1_8_2026",
      "ROTA_1_8_2026",
      "ROTA_SECA_1_8_2026",
      "R2_1_8_2026",
      "CAR_JAN",
      "EMPURRADA",
      "1_8_2026",
      "vigencia-1",
    ];

    for (const label of labels) {
      const { rows } = await ctx.db.execute<{ channel: string | null }>(sql`
        SELECT substring(${label} from ${CHANNEL_PATTERN}) AS channel
      `);
      expect(rows[0].channel ?? null, `rótulo ${label}`).toBe(channelOf(label));
    }
  });
});

describe("duas unidades na mesma data", () => {
  it("são dois contextos, não um período compartilhado", async () => {
    const contexts = await listContexts(ctx.db);
    // Unidade A tem dois canais; unidade B tem um.
    expect(contexts).toHaveLength(3);
    expect(contexts.map((c) => `${c.scopeHash}|${c.channel}`).sort()).toEqual([
      `${UNIDADE_A}|EMPURRADA`,
      `${UNIDADE_A}|ROTA`,
      `${UNIDADE_B}|EMPURRADA`,
    ]);
  });

  it("cada uma vê só as suas vigências", async () => {
    const a = await listPeriods(ctx.db, { scopeHash: UNIDADE_A, channel: "EMPURRADA" });
    const rota = await listPeriods(ctx.db, { scopeHash: UNIDADE_A, channel: "ROTA" });
    expect(a.map((p) => p.effective_date)).toEqual(["2026-02-02", "2026-01-02"]);
    expect(rota.map((p) => p.effective_date)).toEqual(["2026-02-02"]);
  });

  it("o impacto de fevereiro é o da unidade pedida, nunca a soma das duas", async () => {
    const a = (await getGroupedView(ctx.db, "2026-02-02", {
      scopeHash: UNIDADE_A,
      channel: "EMPURRADA",
    }))!;
    const b = (await getGroupedView(ctx.db, "2026-02-02", {
      scopeHash: UNIDADE_B,
      channel: "EMPURRADA",
    }))!;

    expect(a.impact.byPeriodicity).toEqual({ MENSAL: 200 });
    expect(b.impact.byPeriodicity).toEqual({ MENSAL: -1000 });
    // A soma das duas seria −800/mês: um número que nenhuma das unidades
    // reconheceria como seu, e que era o que a chave por data devolvia.
    expect(a.impact.byPeriodicity.MENSAL).not.toBe(-800);
    expect(b.impact.byPeriodicity.MENSAL).not.toBe(-800);
  });

  it("o consolidado também é por contexto", async () => {
    const a = (await getConsolidated(ctx.db, "2026-02-02", { scopeHash: UNIDADE_A, channel: "EMPURRADA" }))!;
    const b = (await getConsolidated(ctx.db, "2026-02-02", { scopeHash: UNIDADE_B, channel: "EMPURRADA" }))!;
    expect(a.impactByPeriodicity).toEqual({ MENSAL: 200 });
    expect(b.impactByPeriodicity).toEqual({ MENSAL: -1000 });
    expect(a.totals.valueChanges).toBe(1);
    expect(b.totals.valueChanges).toBe(1);
  });

  it("a série de um atributo não junta as frotas das duas unidades", async () => {
    const a = (await getAttributeSeries(ctx.db, "carreta.custo_fixo", {
      scopeHash: UNIDADE_A,
      channel: "EMPURRADA",
    }))!;
    const fevereiro = a.points.find((p) => p.effectiveDate === "2026-02-02")!;
    // Um veículo, R$ 1.200 — e não dois veículos somando R$ 5.200, que faria a
    // média por veículo descrever um universo que não existe.
    expect(fevereiro.vehicles).toBe(1);
    expect(fevereiro.total).toBe(1200);
    expect(fevereiro.average).toBe(1200);
  });

  it("o acumulado é o da unidade, não o de todas", async () => {
    const a = await getAccumulatedImpact(ctx.db, { scopeHash: UNIDADE_A, channel: "EMPURRADA" });
    const b = await getAccumulatedImpact(ctx.db, { scopeHash: UNIDADE_B, channel: "EMPURRADA" });
    expect(a.byPeriodicity).toEqual({ MENSAL: 200 });
    expect(b.byPeriodicity).toEqual({ MENSAL: -1000 });
    expect(a.comparisons).toBe(1);
    expect(b.comparisons).toBe(1);
  });

  it("diz qual contexto escolheu quando ninguém escolheu", async () => {
    const view = (await getGroupedView(ctx.db))!;
    expect(view.context.scopeHash).toBeDefined();
    // E nomeia os outros, para que a escolha padrão não seja uma omissão.
    expect(view.otherContexts).toHaveLength(2);
    expect(
      view.otherContexts.every(
        (c) => !(c.scopeHash === view.context.scopeHash && c.channel === view.context.channel),
      ),
    ).toBe(true);
  });
});

describe("dois canais na mesma unidade", () => {
  it("a vigência de um canal não tem a do outro como anterior", async () => {
    const { rows } = await ctx.db.execute<{ id: string; source_label: string }>(sql`
      SELECT id::text, source_label FROM snapshot WHERE scope_hash = ${UNIDADE_A}
    `);
    const rota = rows.find((r) => r.source_label === "ROTA_2_2_2026")!;
    const empurradaFev = rows.find((r) => r.source_label === "EMPURRADA_2_2_2026")!;
    const empurradaJan = rows.find((r) => r.source_label === "EMPURRADA_2_1_2026")!;

    // ROTA é a primeira do seu canal: não há anterior, e inventar uma seria
    // declarar alterada uma frota que ninguém alterou.
    expect(await findPreviousSnapshot(ctx.db, rota.id)).toBeNull();
    // E o canal EMPURRADA continua encadeado normalmente.
    expect(await findPreviousSnapshot(ctx.db, empurradaFev.id)).toBe(empurradaJan.id);
  });

  it("comparar canais diferentes é recusado por escrito", async () => {
    const { rows } = await ctx.db.execute<{ id: string; source_label: string }>(sql`
      SELECT id::text, source_label FROM snapshot WHERE scope_hash = ${UNIDADE_A}
    `);
    const rota = rows.find((r) => r.source_label === "ROTA_2_2_2026")!;
    const empurrada = rows.find((r) => r.source_label === "EMPURRADA_2_2_2026")!;

    await expect(computeChangeSet(ctx.db, empurrada.id, rota.id)).rejects.toThrow(
      /Canais diferentes/,
    );
  });

  it("o backfill não pareia vigências de canais diferentes", async () => {
    // Rodar de novo é idempotente e, sobretudo, não descobre um par novo entre
    // ROTA e EMPURRADA que a primeira execução tivesse deixado passar.
    const result = await computeMissingChangeSets(ctx.db, "test");
    expect(result.computed).toBe(0);
    // Três séries: A/EMPURRADA, A/ROTA e B/EMPURRADA.
    expect(result.series).toBe(3);
    // E duas comparações no total — a de ROTA não existe, por não ter anterior.
    const { rows } = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM change_set`,
    );
    expect(rows[0].n).toBe(2);
  });
});

describe("contexto pedido que não existe", () => {
  it("é recusa escrita, não uma resposta vazia", async () => {
    await expect(
      resolveContext(ctx.db, { scopeHash: "unidade-que-nao-existe" }),
    ).rejects.toBeInstanceOf(ContextNotFoundError);

    await expect(
      resolveContext(ctx.db, { scopeHash: "unidade-que-nao-existe" }),
    ).rejects.toThrow(/Disponíveis:/);
  });
});
