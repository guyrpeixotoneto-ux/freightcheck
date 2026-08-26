import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeTable } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeChangeSet } from "../engine";
import { getGroupedView } from "../grouped";
import { buildFixture, type AttributeSpec, type CellValue } from "./fixtures";

/**
 * O KPI de "alterações" conta grandeza econômica, não cadastro.
 *
 * `trecho.origem`, `trecho.destino`, `operador_nome` e o resto do cadastro já
 * são classificados `economic_direction = NEUTRAL` (`direcao-economica-trecho.ts`)
 * — a mesma classificação que o Radar de Trechos usa para separar "alteração
 * material" de forma pura. O que faltava era o Dashboard, o Resumo executivo,
 * o Painel de Unidades, a Linha do Tempo e o Acompanhamento respeitarem essa
 * mesma curadoria: hoje uma troca de operador ou uma correção de grafia de
 * destino conta como se fosse um reajuste de tarifa.
 *
 * A régua vale para qualquer entidade — CAVALO e CARRETA têm cadastro do
 * mesmo jeito (placa, chassi, nome de operador) —, e por isso a segunda
 * `describe` prova a mesma regra fora de Trecho, contra a leitura ao vivo que
 * o Dashboard de fato usa.
 */

let ctx: TestDb;

const TRECHO_ATTRS: AttributeSpec[] = [
  {
    code: "trecho.valor_frete",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
    economicDirection: "HIGHER_IS_WORSE",
  },
  {
    code: "trecho.origem",
    dataType: "TEXT",
    semanticsStatus: "CONFIRMED",
    economicDirection: "NEUTRAL",
  },
  {
    code: "trecho.destino",
    dataType: "TEXT",
    semanticsStatus: "CONFIRMED",
    economicDirection: "NEUTRAL",
  },
  {
    code: "trecho.operador_nome",
    dataType: "TEXT",
    semanticsStatus: "CONFIRMED",
    economicDirection: "NEUTRAL",
  },
];

beforeAll(async () => {
  ctx = await createTestDatabase("alteracoes-materiais");
  await seedTaxonomy(ctx.db, "test");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

let sequence = 0;

async function comparar(
  before: Record<string, CellValue>,
  after: Record<string, CellValue>,
) {
  sequence++;
  const cenario = `cen${sequence}`;
  const fixture = await buildFixture(
    ctx.db,
    TRECHO_ATTRS,
    [
      { label: `${cenario}_A`, effectiveDate: "2026-01-02", data: { T1: before } },
      { label: `${cenario}_B`, effectiveDate: "2026-02-02", data: { T1: after } },
    ],
    { entityType: "TRECHO", scopeHash: `scope-${cenario}` },
  );
  const resumo = await computeChangeSet(
    ctx.db,
    fixture.snapshotIds[`${cenario}_A`],
    fixture.snapshotIds[`${cenario}_B`],
    { computedBy: "test" },
  );
  return resumo;
}

describe("o KPI de alterações (change_set.value_changes) exclui NEUTRAL", () => {
  it("mudança só em trecho.origem → 0 alterações materiais", async () => {
    const resumo = await comparar(
      { "trecho.valor_frete": 1000, "trecho.origem": "Camaçari" },
      { "trecho.valor_frete": 1000, "trecho.origem": "Salvador" },
    );
    expect(resumo.valueChanges).toBe(0);
  });

  it("mudança só em trecho.destino → 0", async () => {
    const resumo = await comparar(
      { "trecho.valor_frete": 1000, "trecho.destino": "Feira de Santana" },
      { "trecho.valor_frete": 1000, "trecho.destino": "Alagoinhas" },
    );
    expect(resumo.valueChanges).toBe(0);
  });

  it("mudança em outro campo NEUTRAL (operador_nome) → 0", async () => {
    const resumo = await comparar(
      { "trecho.valor_frete": 1000, "trecho.operador_nome": "Fulano" },
      { "trecho.valor_frete": 1000, "trecho.operador_nome": "Sicrano" },
    );
    expect(resumo.valueChanges).toBe(0);
  });

  it("mudança em preço/remuneração → 1", async () => {
    const resumo = await comparar(
      { "trecho.valor_frete": 1000 },
      { "trecho.valor_frete": 1200 },
    );
    expect(resumo.valueChanges).toBe(1);
  });

  it("uma alteração econômica + três cadastrais no mesmo ativo → 1, nunca 4", async () => {
    const resumo = await comparar(
      {
        "trecho.valor_frete": 1000,
        "trecho.origem": "A",
        "trecho.destino": "B",
        "trecho.operador_nome": "X",
      },
      {
        "trecho.valor_frete": 1500,
        "trecho.origem": "A2",
        "trecho.destino": "B2",
        "trecho.operador_nome": "X2",
      },
    );
    expect(resumo.valueChanges).toBe(1);
  });

  it("o histórico bruto continua com as quatro linhas — cadastro incluso, nada apagado", async () => {
    const resumo = await comparar(
      {
        "trecho.valor_frete": 1000,
        "trecho.origem": "A",
        "trecho.destino": "B",
        "trecho.operador_nome": "X",
      },
      {
        "trecho.valor_frete": 1500,
        "trecho.origem": "A2",
        "trecho.destino": "B2",
        "trecho.operador_nome": "X2",
      },
    );

    const linhas = await ctx.db
      .select({
        attributeCode: changeTable.attributeCode,
        economicDirection: changeTable.economicDirection,
      })
      .from(changeTable)
      .where(eq(changeTable.changeSetId, resumo.id));

    expect(linhas).toHaveLength(4);
    expect(linhas.filter((l) => l.economicDirection === "NEUTRAL")).toHaveLength(3);
    expect(linhas.filter((l) => l.economicDirection !== "NEUTRAL")).toHaveLength(1);
  });
});

describe("a mesma regra vale fora de Trecho, sem divergir entre o cartão e a leitura ao vivo", () => {
  it("CARRETA: um cadastro NEUTRAL não aparece em value_changes nem em totals.changes", async () => {
    const fixture = await buildFixture(
      ctx.db,
      [
        {
          code: "carreta.custo_fixo",
          dataType: "NUMERIC",
          semanticsStatus: "CONFIRMED",
          unit: "BRL",
          periodicity: "MENSAL",
          aggregation: "SUM",
          isMonetary: true,
          taxonomyCode: "cf_frota_carreta",
          economicDirection: "HIGHER_IS_WORSE",
        },
        {
          code: "carreta.operador_nome",
          dataType: "TEXT",
          semanticsStatus: "CONFIRMED",
          economicDirection: "NEUTRAL",
        },
      ],
      [
        {
          label: "M1",
          effectiveDate: "2026-01-02",
          data: { P1: { "carreta.custo_fixo": 1000, "carreta.operador_nome": "Fulano" } },
        },
        {
          label: "M2",
          effectiveDate: "2026-02-02",
          data: { P1: { "carreta.custo_fixo": 1000, "carreta.operador_nome": "Sicrano" } },
        },
      ],
      { entityType: "CARRETA", scopeHash: "scope-carreta-neutral" },
    );

    const resumo = await computeChangeSet(ctx.db, fixture.snapshotIds.M1, fixture.snapshotIds.M2, {
      computedBy: "test",
    });
    expect(resumo.valueChanges).toBe(0);

    const view = await getGroupedView(ctx.db, "2026-02-02", { scopeHash: "scope-carreta-neutral" });
    expect(view?.totals.changes).toBe(0);
    expect(view?.groups).toHaveLength(0);
  });

  it("CARRETA: preço + cadastro no mesmo ativo → 1 em value_changes e em totals.changes, não 2", async () => {
    const fixture = await buildFixture(
      ctx.db,
      [
        {
          code: "carreta.custo_fixo",
          dataType: "NUMERIC",
          semanticsStatus: "CONFIRMED",
          unit: "BRL",
          periodicity: "MENSAL",
          aggregation: "SUM",
          isMonetary: true,
          taxonomyCode: "cf_frota_carreta",
          economicDirection: "HIGHER_IS_WORSE",
        },
        {
          code: "carreta.operador_nome",
          dataType: "TEXT",
          semanticsStatus: "CONFIRMED",
          economicDirection: "NEUTRAL",
        },
      ],
      [
        {
          label: "M1",
          effectiveDate: "2026-01-02",
          data: { P2: { "carreta.custo_fixo": 1000, "carreta.operador_nome": "Fulano" } },
        },
        {
          label: "M2",
          effectiveDate: "2026-02-02",
          data: { P2: { "carreta.custo_fixo": 1300, "carreta.operador_nome": "Sicrano" } },
        },
      ],
      { entityType: "CARRETA", scopeHash: "scope-carreta-misto" },
    );

    const resumo = await computeChangeSet(ctx.db, fixture.snapshotIds.M1, fixture.snapshotIds.M2, {
      computedBy: "test",
    });
    expect(resumo.valueChanges).toBe(1);

    const view = await getGroupedView(ctx.db, "2026-02-02", { scopeHash: "scope-carreta-misto" });
    expect(view?.totals.changes).toBe(1);
  });
});
