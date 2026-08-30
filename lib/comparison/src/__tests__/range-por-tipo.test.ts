import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedTaxonomy } from "@workspace/curation";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { computeChangeSet } from "../engine";
import { getRangeAnalysis } from "../families-view";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * O recorte por tipo da Linha do Tempo — a aba "Cavalo, Carreta e Trecho".
 *
 * A aba faz a **mesma** pergunta da aba Geral sobre uma população menor, e é
 * essa palavra — população, e não filtro — que este arquivo protege. Três
 * afirmações, e nenhuma é decorativa:
 *
 * 1. **A partição.** Cavalo mais carreta somam a leitura sem recorte, em cada
 *    número e em cada periodicidade. É o que impede uma alteração de sumir das
 *    duas abas sem aparecer em lugar nenhum — o mesmo defeito que
 *    `escopo-de-frota.test.ts` trava do lado de Alterações.
 * 2. **O isolamento.** Nenhuma linha de carreta entra na leitura de cavalo. Um
 *    recorte que vaza é pior do que recorte nenhum: ele publica um número
 *    menor sob um rótulo que promete outro universo.
 * 3. **O trecho existe.** A leitura sem recorte exclui trecho de propósito
 *    (ele vive numa série própria, e as telas de frota não o querem). A aba de
 *    trecho é o que o traz de volta — e se ela lesse pelo caminho de sempre,
 *    devolveria vazio, que se leria como "nada mudou".
 */

let ctx: TestDb;
const SCOPE = "scope-range-por-tipo";
const JAN = "2026-01-01";
const FEV = "2026-02-01";

const CARRETA: AttributeSpec[] = [
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
  {
    code: "cavalo.ipva",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "ANUAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
];

const TRECHO: AttributeSpec[] = [
  {
    code: "trecho.frete_liquido",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    economicDirection: "HIGHER_IS_BETTER",
  },
];

beforeAll(async () => {
  ctx = await createTestDatabase("range_por_tipo");
  await seedTaxonomy(ctx.db, "test");

  /*
    Três séries na mesma unidade e nas mesmas duas datas — que é o desenho real:
    cavalo, carreta e trecho chegam na mesma vigência, e o trecho só é uma
    leitura à parte porque forma série própria dentro dela.

    Cada série leva um `canal` próprio de identidade canônica (o rótulo é que
    forma o contexto, e nenhum deles declara canal), pelo motivo que
    `FixtureOptions.canal` documenta: sem isso as três colidiriam na identidade
    ativa da mesma data.
  */
  const carreta = await buildFixture(
    ctx.db,
    CARRETA,
    [
      {
        label: "CAR_JAN",
        effectiveDate: JAN,
        data: {
          AAA1A11: { "carreta.custo_fixo": 1000 },
          AAA2A22: { "carreta.custo_fixo": 2000 },
        },
      },
      {
        label: "CAR_FEV",
        effectiveDate: FEV,
        data: {
          // +300 MENSAL. A segunda carreta não se mexe: ela é frota, não alteração.
          AAA1A11: { "carreta.custo_fixo": 1300 },
          AAA2A22: { "carreta.custo_fixo": 2000 },
        },
      },
    ],
    { entityType: "CARRETA", scopeHash: SCOPE, canal: "CAR" },
  );

  const cavalo = await buildFixture(
    ctx.db,
    CAVALO,
    [
      {
        label: "CAV_JAN",
        effectiveDate: JAN,
        data: {
          BBB1B11: { "cavalo.custo_fixo": 5000, "cavalo.ipva": 12000 },
          BBB2B22: { "cavalo.custo_fixo": 4000, "cavalo.ipva": 8000 },
        },
      },
      {
        label: "CAV_FEV",
        effectiveDate: FEV,
        data: {
          // +500 MENSAL e −3.000 ANUAL: duas periodicidades no mesmo tipo.
          BBB1B11: { "cavalo.custo_fixo": 5500, "cavalo.ipva": 9000 },
          BBB2B22: { "cavalo.custo_fixo": 4000, "cavalo.ipva": 8000 },
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: SCOPE, canal: "CAV" },
  );

  const trecho = await buildFixture(
    ctx.db,
    TRECHO,
    [
      {
        label: "TRE_JAN",
        effectiveDate: JAN,
        data: { T_MANAUS: { "trecho.frete_liquido": 5000 } },
      },
      {
        label: "TRE_FEV",
        effectiveDate: FEV,
        data: { T_MANAUS: { "trecho.frete_liquido": 5500 } },
      },
    ],
    { entityType: "TRECHO", scopeHash: SCOPE, canal: "TRE" },
  );

  for (const [de, ate] of [
    [carreta.snapshotIds.CAR_JAN, carreta.snapshotIds.CAR_FEV],
    [cavalo.snapshotIds.CAV_JAN, cavalo.snapshotIds.CAV_FEV],
    [trecho.snapshotIds.TRE_JAN, trecho.snapshotIds.TRE_FEV],
  ]) {
    await computeChangeSet(ctx.db, de, ate, { computedBy: "test:range-por-tipo" });
  }
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

const leitura = (tipo?: "CAVALO" | "CARRETA" | "TRECHO") =>
  getRangeAnalysis(ctx.db, JAN, FEV, undefined, undefined, undefined, tipo);

describe("a aba Geral continua sendo o que era", () => {
  it("lê cavalo e carreta somados, e não lê trecho", async () => {
    const geral = (await leitura())!;
    const tipos = new Set(geral.entries.map((e) => e.group.entityType));

    expect(tipos).toEqual(new Set(["CAVALO", "CARRETA"]));
    expect(geral.impact.byPeriodicity).toEqual({ MENSAL: 800, ANUAL: -3000 });
  });
});

describe("a partição — cavalo mais carreta somam a leitura sem recorte", () => {
  it("em cada número e em cada periodicidade", async () => {
    const geral = (await leitura())!;
    const cavalo = (await leitura("CAVALO"))!;
    const carreta = (await leitura("CARRETA"))!;

    expect(cavalo.totals.changes + carreta.totals.changes).toBe(geral.totals.changes);

    for (const balde of Object.keys(geral.impact.byPeriodicity)) {
      expect(
        (cavalo.impact.byPeriodicity[balde] ?? 0) +
          (carreta.impact.byPeriodicity[balde] ?? 0),
      ).toBeCloseTo(geral.impact.byPeriodicity[balde], 2);
    }

    // O eixo de vigências é o mesmo nos três: o recorte troca a população, e
    // não o histórico que ela percorre.
    expect(cavalo.movements.map((m) => m.period)).toEqual(
      geral.movements.map((m) => m.period),
    );
  });
});

describe("o isolamento — um recorte que vaza é pior do que recorte nenhum", () => {
  it("a leitura de cavalo não tem uma linha de carreta sequer", async () => {
    const cavalo = (await leitura("CAVALO"))!;

    expect(cavalo.entries.length).toBeGreaterThan(0);
    expect(cavalo.entries.every((e) => e.group.entityType === "CAVALO")).toBe(true);
    expect(cavalo.impact.byPeriodicity).toEqual({ MENSAL: 500, ANUAL: -3000 });
    // Só a placa que se mexeu — a outra é frota, e frota não é alteração.
    expect(cavalo.totals.vehiclesTouched).toBe(1);
  });

  it("a leitura de carreta é a outra metade, e só ela", async () => {
    const carreta = (await leitura("CARRETA"))!;

    expect(carreta.entries.every((e) => e.group.entityType === "CARRETA")).toBe(true);
    expect(carreta.impact.byPeriodicity).toEqual({ MENSAL: 300 });
  });
});

describe("o trecho — o que a leitura sem recorte não alcança", () => {
  it("aparece na aba dele, e só nela", async () => {
    const trecho = (await leitura("TRECHO"))!;
    const geral = (await leitura())!;

    expect(trecho.entries.length).toBeGreaterThan(0);
    expect(trecho.entries.every((e) => e.group.entityType === "TRECHO")).toBe(true);
    expect(geral.entries.some((e) => e.group.entityType === "TRECHO")).toBe(false);

    // O trecho percorre o mesmo eixo de vigências das outras abas: ele chega
    // fundido à vigência do equipamento, e é lá que a tela o desenha.
    expect(trecho.movements.map((m) => m.period)).toEqual([FEV]);
  });

  it("nenhuma comparação sobra fora do eixo que a tela desenha", async () => {
    const trecho = (await leitura("TRECHO"))!;
    const noEixo = new Set([
      ...trecho.movements.map((m) => m.period),
      ...trecho.gaps.map((g) => g.period),
    ]);

    // Toda alteração somada em `totals` tem uma vigência desenhada acima dela —
    // é o que faz o placar fechar com o gráfico.
    expect(trecho.entries.every((e) => noEixo.has(e.period))).toBe(true);
  });
});
