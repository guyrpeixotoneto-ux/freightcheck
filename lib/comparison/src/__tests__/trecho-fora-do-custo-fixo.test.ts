import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { computeChangeSet, findPreviousSnapshot } from "../engine";
import { listChanges, listComparableSnapshots } from "../query";
import {
  formamParDeVigencias,
  frotaDoEquipamento,
  parDePartida,
  TIPOS_DE_EQUIPAMENTO,
  vigenciasQueCobrem,
} from "../recorte-de-rubrica";
import { frotaPorTipo } from "../query";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * TRECHO NÃO É ASSUNTO DE CUSTO FIXO — NEM NA LISTA, NEM NA CONTA.
 *
 * ---------------------------------------------------------------------------
 * A regra, como o cliente a escreveu
 * ---------------------------------------------------------------------------
 * "A importação de TRECHO pode continuar existindo normalmente no sistema, mas
 * deve ficar completamente isolada dos módulos de Custo Fixo." Dito em
 * 16/09/2026, depois de uma importação parcial ter apagado sete meses do
 * seletor da Auditoria de FINAME.
 *
 * A correção daquele defeito — a comparação passar a ler a **interseção** das
 * coberturas — devolve a série, e sozinha não basta para esta regra. Duas
 * vigências que tragam trecho dentro do mesmo arquivo do equipamento têm
 * cobertura idêntica, então não há interseção a recortar: o trecho entra na
 * comparação e sai nos números de frota que as quatro telas publicam. É o
 * recorte **explícito** que o mantém fora, e é ele que este arquivo fixa.
 *
 * Os quatro casos são as quatro garantias pedidas, na ordem:
 *   1. todos os períodos continuam disponíveis;
 *   2. a sequência histórica continua completa;
 *   3. os valores de cavalo e carreta não se movem;
 *   4. nada de trecho aparece nem interfere.
 */

let ctx: TestDb;
const SCOPE = "scope-trecho-fora";

const EQUIPAMENTO: AttributeSpec[] = [
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
    code: "carreta.custo_fixo",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_frota_carreta",
  },
  {
    code: "trecho.km_rodado",
    dataType: "NUMERIC",
    semanticsStatus: "CONFIRMED",
    unit: "KM",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: false,
  },
];

/** As quatro vigências, e o que cada uma cobre. */
let junho = "";
let julho = "";
let agosto = "";
let setembro = "";

beforeAll(async () => {
  ctx = await createTestDatabase("trecho_fora_do_custo_fixo");
  await seedTaxonomy(ctx.db, "test");

  /*
    Junho e julho são de equipamento. Agosto é a mesma vigência de equipamento
    **mais** o trecho — que é como um arquivo de trecho entra quando ele chega
    pela mesma unidade, mesma data e mesmo canal: como revisão que herda o que
    já estava lá e faz o conjunto de tipos crescer (`pipeline.ts`).
  */
  const acervo = await buildFixture(
    ctx.db,
    EQUIPAMENTO,
    [
      {
        label: "JUNHO",
        effectiveDate: "2026-06-16",
        data: {
          RPG1B56: { "cavalo.custo_fixo": 1000 },
          QQQ7X70: { "carreta.custo_fixo": 500 },
        },
      },
      {
        label: "JULHO",
        effectiveDate: "2026-07-16",
        data: {
          RPG1B56: { "cavalo.custo_fixo": 1100 },
          QQQ7X70: { "carreta.custo_fixo": 500 },
        },
      },
      {
        label: "AGOSTO",
        effectiveDate: "2026-08-16",
        entityTypeSet: "CARRETA+CAVALO+TRECHO",
        data: {
          RPG1B56: { "cavalo.custo_fixo": 1100 },
          QQQ7X70: { "carreta.custo_fixo": 500 },
          /* As pernas de rota que a importação de trecho trouxe. */
          TR001: { "trecho.km_rodado": 420 },
          TR002: { "trecho.km_rodado": 380 },
          TR003: { "trecho.km_rodado": 610 },
        },
      },
      {
        label: "SETEMBRO",
        effectiveDate: "2026-09-16",
        entityTypeSet: "CARRETA+CAVALO+TRECHO",
        data: {
          RPG1B56: { "cavalo.custo_fixo": 1100 },
          QQQ7X70: { "carreta.custo_fixo": 500 },
          /* TR002 saiu da malha, TR004 entrou. Movimento de trecho puro. */
          TR001: { "trecho.km_rodado": 420 },
          TR003: { "trecho.km_rodado": 610 },
          TR004: { "trecho.km_rodado": 155 },
        },
      },
    ],
    {
      entityType: "CAVALO",
      scopeHash: SCOPE,
      tipoPorPlaca: {
        RPG1B56: "CAVALO",
        QQQ7X70: "CARRETA",
        TR001: "TRECHO",
        TR002: "TRECHO",
        TR003: "TRECHO",
        TR004: "TRECHO",
      },
    },
  );
  junho = acervo.snapshotIds.JUNHO;
  julho = acervo.snapshotIds.JULHO;
  agosto = acervo.snapshotIds.AGOSTO;
  setembro = acervo.snapshotIds.SETEMBRO;

  await computeMissingChangeSets(ctx.db, "test:trecho-fora");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("1. os períodos de Custo Fixo continuam todos disponíveis", () => {
  it("o seletor oferece as três vigências, inclusive a que ganhou trecho", async () => {
    const vigencias = await listComparableSnapshots(ctx.db);
    const daUnidade = vigencias.filter((v) => v.scopeHash === SCOPE);
    const doCustoFixo = vigenciasQueCobrem(daUnidade, TIPOS_DE_EQUIPAMENTO);

    expect(doCustoFixo.map((v) => v.sourceLabel).sort()).toEqual([
      "AGOSTO",
      "JULHO",
      "JUNHO",
      "SETEMBRO",
    ]);
  });

  it("agosto forma par com junho e com julho, apesar da cobertura diferente", async () => {
    const vigencias = await listComparableSnapshots(ctx.db);
    const porId = new Map(vigencias.map((v) => [v.id, v]));
    const ago = porId.get(agosto)!;

    expect(formamParDeVigencias(porId.get(junho)!, ago)).toBe(true);
    expect(formamParDeVigencias(porId.get(julho)!, ago)).toBe(true);
    expect(parDePartida(vigencias.filter((v) => v.scopeHash === SCOPE))).not.toBeNull();
  });
});

describe("2. a sequência histórica continua completa", () => {
  it("a anterior de agosto é julho, e não 'nenhuma'", async () => {
    expect(await findPreviousSnapshot(ctx.db, agosto)).toBe(julho);
    expect(await findPreviousSnapshot(ctx.db, julho)).toBe(junho);
  });

  it("as duas transições do período foram calculadas", async () => {
    const julhoSet = await computeChangeSet(ctx.db, junho, julho, {
      computedBy: "test:trecho-fora",
    });
    const agostoSet = await computeChangeSet(ctx.db, julho, agosto, {
      computedBy: "test:trecho-fora",
    });

    expect(julhoSet.id).toBeTruthy();
    expect(agostoSet.id).toBeTruthy();
  });
});

describe("3. os valores de cavalo e carreta não se movem", () => {
  it("julho → agosto não tem alteração de equipamento nenhuma", async () => {
    const set = await computeChangeSet(ctx.db, julho, agosto, {
      computedBy: "test:trecho-fora",
    });
    const { rows } = await listChanges(ctx.db, set.id, {
      attributeCodes: ["cavalo.custo_fixo", "carreta.custo_fixo"],
      limit: 100,
    });

    expect(rows).toEqual([]);
  });

  it("junho → julho continua mostrando a alteração do cavalo, intacta", async () => {
    const set = await computeChangeSet(ctx.db, junho, julho, {
      computedBy: "test:trecho-fora",
    });
    const { rows } = await listChanges(ctx.db, set.id, {
      attributeCodes: ["cavalo.custo_fixo", "carreta.custo_fixo"],
      limit: 100,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].valueBefore).toBe("1000");
    expect(rows[0].valueAfter).toBe("1100");
  });
});

describe("4. nada de trecho aparece nem interfere", () => {
  /* Coberturas diferentes: a interseção sozinha já mantém o trecho fora da
     comparação, e ele nem chega a ser contado. */
  it("o trecho que chegou numa ponta só não vira frota que apareceu", async () => {
    const set = await computeChangeSet(ctx.db, julho, agosto, {
      computedBy: "test:trecho-fora",
    });
    const porTipo = await frotaPorTipo(ctx.db, set.id, agosto);

    expect(porTipo.TRECHO?.novos ?? 0).toBe(0);
    expect(frotaDoEquipamento(porTipo)).toEqual({
      comparados: 2,
      novos: 0,
      ausentes: 0,
    });
  });

  /**
   * Coberturas **iguais** — o caso que a interseção não alcança.
   *
   * Agosto e setembro trazem trecho as duas, então não há conjunto a recortar:
   * o motor compara a vigência inteira, e o movimento de trecho (TR002 saiu,
   * TR004 entrou) entra no `change_set`, como deve — o Trecho 360 o lê de lá.
   * O que mantém esse movimento fora dos cartões de Custo Fixo é o recorte
   * explícito, e é só ele.
   */
  it("o movimento de trecho entre duas vigências que o trazem fica fora dos cartões", async () => {
    const set = await computeChangeSet(ctx.db, agosto, setembro, {
      computedBy: "test:trecho-fora",
    });
    const porTipo = await frotaPorTipo(ctx.db, set.id, setembro);

    /* O acervo registrou o movimento: uma perna entrou, outra saiu. */
    expect(porTipo.TRECHO?.novos).toBe(1);
    expect(porTipo.TRECHO?.ausentes).toBe(1);

    /* E nenhum dos dois aparece na tela de Custo Fixo. */
    const doCustoFixo = frotaDoEquipamento(porTipo);
    expect(doCustoFixo.novos).toBe(0);
    expect(doCustoFixo.ausentes).toBe(0);
    expect(doCustoFixo.comparados).toBe(2);
  });

  it("nenhuma linha de trecho chega à lista que as telas de Custo Fixo leem", async () => {
    const set = await computeChangeSet(ctx.db, julho, agosto, {
      computedBy: "test:trecho-fora",
    });
    const { rows } = await listChanges(ctx.db, set.id, {
      attributeCodes: ["cavalo.custo_fixo", "carreta.custo_fixo"],
      limit: 500,
    });

    expect(rows.every((r) => r.entityType !== "TRECHO")).toBe(true);
    expect(rows.some((r) => r.attributeCode?.startsWith("trecho."))).toBe(false);
  });

  it("o recorte soma só os tipos que a tela audita, venha o que vier", () => {
    const porTipo = {
      CAVALO: { comparados: 60, novos: 1, ausentes: 0 },
      CARRETA: { comparados: 71, novos: 0, ausentes: 2 },
      TRECHO: { comparados: 900, novos: 120, ausentes: 30 },
    };

    expect(frotaDoEquipamento(porTipo)).toEqual({
      comparados: 131,
      novos: 1,
      ausentes: 2,
    });
  });
});
