import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { getFamiliesView } from "../families-view";
import { getFamiliesOverview } from "../families-view-overview";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * "Veículos" no consolidado Geral: união dos ativos, não soma das unidades.
 *
 * `summary.vehiclesTouched` da Visão Geral é a soma dos `vehiclesTouched` de
 * cada unidade, e o próprio `mergeSummaries` documenta que isso é uma
 * aproximação: nada impede que o mesmo caminhão apareça em duas unidades, e aí
 * ele entra duas vezes. A faixa de abertura do Dashboard publicava essa soma
 * escrita "veículos afetados", ao lado de um número de unidade que era
 * cardinalidade de verdade.
 *
 * `vehiclesTouchedDistinct` é a cardinalidade global, e ela é possível porque
 * `entity.id` é global e casado por placa/chassi (`entity_identifier`): o
 * mesmo caminhão exportado por duas unidades resolve para o mesmo id nas duas
 * — que é exatamente o que o fixture faz aqui, do mesmo jeito que a promoção
 * faz em produção.
 *
 * A fixture é montada para o caso que a de `families-view-overview.test.ts`
 * não cobre: lá cada unidade usa placas próprias e a soma acaba coincidindo
 * com a união. Aqui a placa `SHR0001` é da unidade X **e** da unidade Y.
 */

let ctx: TestDb;

const JULHO = "2026-07-02";
const AGOSTO = "2026-08-02";

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
  ctx = await createTestDatabase("veiculos_distintos_consolidado");
  await seedTaxonomy(ctx.db, "test");

  // X: dois ativos, um deles compartilhado com Y.
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          SHR0001: { "carreta.custo_fixo": 1000 },
          XXX0002: { "carreta.custo_fixo": 2000 },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          SHR0001: { "carreta.custo_fixo": 1200 },
          XXX0002: { "carreta.custo_fixo": 2400 },
        },
      },
    ],
    { entityType: "CARRETA", scopeHash: "distintos-unit-x", canal: "EMPURRADA" },
  );

  // Y: dois ativos, um deles o MESMO caminhão de X — mesma placa, e por isso
  // o mesmo `entity.id`.
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          SHR0001: { "carreta.custo_fixo": 1000 },
          YYY0003: { "carreta.custo_fixo": 3000 },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          SHR0001: { "carreta.custo_fixo": 1500 },
          YYY0003: { "carreta.custo_fixo": 3300 },
        },
      },
    ],
    { entityType: "CARRETA", scopeHash: "distintos-unit-y", canal: "EMPURRADA" },
  );

  await computeMissingChangeSets(ctx.db, "test");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("entityIdsTouched é a identidade por trás de vehiclesTouched", () => {
  it("uma vigência publica exatamente os ativos que contou", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;
    const views = (
      await Promise.all(
        overview.unitsIncluded.flatMap((u) =>
          u.contexts.map((c) =>
            getFamiliesView(ctx.db, AGOSTO, { scopeHash: c.scopeHash, channel: c.channel }),
          ),
        ),
      )
    ).filter((v) => v !== null);

    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      expect(view.totals.entityIdsTouched).toHaveLength(view.totals.vehiclesTouched);
      expect(new Set(view.totals.entityIdsTouched).size).toBe(view.totals.vehiclesTouched);
    }
  });
});

describe("o consolidado Geral conta veículos, não somas", () => {
  it("o caminhão de duas unidades entra uma vez só", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;

    expect(overview.unitsIncluded.map((u) => u.unidade).sort()).toEqual([
      "distintos-unit-x",
      "distintos-unit-y",
    ]);

    // Duas unidades, dois ativos cada, um deles o mesmo caminhão: a soma diz
    // quatro, e existem três.
    expect(overview.summary.vehiclesTouched).toBe(4);
    expect(overview.vehiclesTouchedDistinct).toBe(3);
  });

  it("a soma continua sendo a soma — a semântica contratada não mudou", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;
    const individuais = (
      await Promise.all(
        overview.unitsIncluded.flatMap((u) =>
          u.contexts.map((c) =>
            getFamiliesView(ctx.db, AGOSTO, { scopeHash: c.scopeHash, channel: c.channel }),
          ),
        ),
      )
    ).filter((v) => v !== null);

    expect(overview.summary.vehiclesTouched).toBe(
      individuais.reduce((soma, v) => soma + v.summary.vehiclesTouched, 0),
    );
  });

  it("a união nunca passa a soma, e é a união dos conjuntos das unidades", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;
    const individuais = (
      await Promise.all(
        overview.unitsIncluded.flatMap((u) =>
          u.contexts.map((c) =>
            getFamiliesView(ctx.db, AGOSTO, { scopeHash: c.scopeHash, channel: c.channel }),
          ),
        ),
      )
    ).filter((v) => v !== null);

    const uniaoManual = new Set(individuais.flatMap((v) => v.totals.entityIdsTouched)).size;

    expect(overview.vehiclesTouchedDistinct).toBe(uniaoManual);
    expect(overview.vehiclesTouchedDistinct).toBeLessThanOrEqual(
      overview.summary.vehiclesTouched,
    );
  });
});
