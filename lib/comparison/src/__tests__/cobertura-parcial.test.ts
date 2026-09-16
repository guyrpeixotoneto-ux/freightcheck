import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeChangeSet } from "../engine";
import { listChanges } from "../query";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * UM ARQUIVO PARCIAL NO MEIO DO ANO NÃO APAGA A SÉRIE.
 *
 * ---------------------------------------------------------------------------
 * O defeito, como ele chegou
 * ---------------------------------------------------------------------------
 * Relatado em 16/09/2026 na Auditoria de FINAME: o seletor "De", que oferecia
 * de dezembro/2025 a agosto/2026, passou a oferecer três quinzenas. A Evolução
 * do ano, ao lado, mostrava o mês da virada "importado sem comparação
 * calculada". Nenhum dado de cavalo havia mudado — o que mudou foi que um
 * arquivo parcial (de carreta, de trecho) começou a ser importado a partir
 * daquele mês, e as vigências dali para frente passaram a cobrir um tipo a
 * mais.
 *
 * A causa era a cobertura ser **condição de par**: `CAVALO` não se comparava
 * com `CARRETA+CAVALO`, então a série se partia em duas exatamente na fronteira
 * do primeiro arquivo parcial. O argumento a favor da regra era bom — comparar
 * as duas faria cada carreta aparecer como frota que entrou —, e mirava o alvo
 * errado: quem inventava a carreta não era o par, era a comparação ler dos dois
 * lados um tipo que só existe de um.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo fixa
 * ---------------------------------------------------------------------------
 * A cobertura é **recorte**, não condição: o par compara a interseção. Daí os
 * três casos abaixo, que são as três metades da mesma promessa — o par existe,
 * o cavalo é comparado de verdade, e a carreta que só existe de um lado não
 * aparece como movimento de frota nem como coluna nova.
 */

let ctx: TestDb;
const SCOPE = "scope-cobertura-parcial";

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

let julho = "";
let agosto = "";

beforeAll(async () => {
  ctx = await createTestDatabase("cobertura_parcial");
  await seedTaxonomy(ctx.db, "test");

  /*
    Julho cobre só o cavalo. Agosto cobre cavalo **e** carreta, porque foi em
    agosto que o arquivo de carreta começou a ser importado — a vigência ganhou
    um tipo sem que uma linha de cavalo mudasse de dono.
  */
  const acervo = await buildFixture(
    ctx.db,
    [...CAVALO, ...CARRETA],
    [
      {
        label: "JULHO",
        effectiveDate: "2026-07-16",
        data: { RPG1B56: { "cavalo.custo_fixo": 1000 } },
      },
      {
        label: "AGOSTO",
        effectiveDate: "2026-08-16",
        entityTypeSet: "CARRETA+CAVALO",
        data: {
          RPG1B56: { "cavalo.custo_fixo": 1100 },
          QQQ7X70: { "carreta.custo_fixo": 500 },
        },
      },
    ],
    {
      entityType: "CAVALO",
      scopeHash: SCOPE,
      tipoPorPlaca: { RPG1B56: "CAVALO", QQQ7X70: "CARRETA" },
    },
  );
  julho = acervo.snapshotIds.JULHO;
  agosto = acervo.snapshotIds.AGOSTO;
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("uma vigência que passou a cobrir mais um tipo", () => {
  it("continua se comparando com a anterior, que cobre só o cavalo", async () => {
    const resumo = await computeChangeSet(ctx.db, julho, agosto, {
      computedBy: "test:cobertura-parcial",
      force: true,
    });

    expect(resumo.valueChanges).toBe(1);
  });

  it("lê o cavalo das duas pontas, com o valor de cada uma", async () => {
    const resumo = await computeChangeSet(ctx.db, julho, agosto, {
      computedBy: "test:cobertura-parcial",
      force: true,
    });
    const { rows } = await listChanges(ctx.db, resumo.id, { limit: 50 });

    const cavalo = rows.find((r) => r.attributeCode === "cavalo.custo_fixo");
    expect(cavalo?.valueBefore).toBe("1000");
    expect(cavalo?.valueAfter).toBe("1100");
  });

  /* O motivo de a regra antiga existir — e a prova de que ela não é mais
     necessária para produzi-lo. */
  it("não conta a carreta que só existe de um lado como frota que entrou", async () => {
    const resumo = await computeChangeSet(ctx.db, julho, agosto, {
      computedBy: "test:cobertura-parcial",
      force: true,
    });

    expect(resumo.entitiesAdded).toBe(0);
    expect(resumo.entitiesRemoved).toBe(0);
    expect(resumo.attributesAdded).toBe(0);
  });
});
