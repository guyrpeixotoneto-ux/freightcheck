import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { changeSetTable, snapshotTable } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeChangeSet } from "../engine";
import { getRangeAnalysis } from "../families-view";
import { getEndToEndAnalysis } from "../end-to-end";
import { buildFixture } from "./fixtures";

/**
 * A garantia estrutural: **dois retratos válidos bastam.**
 *
 * A análise lia `change_set`. Sem ele, devolvia zero — e zero, numa tela de
 * auditoria, se lê como "a Ambev não mexeu em nada". As duas formas de ficar
 * sem comparação gravada são rotineiras: ninguém mandou calcular (a comparação
 * nasce na importação, e a única chamada automática vive no Panorama, com o
 * erro engolido), ou a vigência foi reimportada e o conjunto antigo ficou
 * apontando para um snapshot morto.
 *
 * O que estes testes fixam é a promessa do produto, não a implementação dela:
 * se existem duas vigências, o FreightCheck diz o que mudou entre elas —
 * independentemente de haver cache, de quem abriu qual tela primeiro, e de a
 * vigência ter sido corrigida no meio do caminho.
 *
 * A fixture é sintética de propósito: controla uma variável por vez, coisa que
 * o export real de 83 mil fatos não permite. As mesmas garantias sobre o dado
 * real estão em `range-real.test.ts`.
 */

let ctx: TestDb;

/** Um cavalo de verdade tem custo, operação e cadastro. A fixture também. */
const ATRIBUTOS = [
  {
    code: "cavalo.manutencao_ano",
    dataType: "NUMERIC" as const,
    semanticsStatus: "CONFIRMED" as const,
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cv_manutencao",
  },
  {
    code: "cavalo.finame_cavalo",
    dataType: "NUMERIC" as const,
    semanticsStatus: "CONFIRMED" as const,
    unit: "BRL",
    periodicity: "MENSAL",
    aggregation: "SUM",
    isMonetary: true,
    taxonomyCode: "cf_financiamento",
  },
  {
    /* Consumo: muda de verdade, e não vira dinheiro. */
    code: "cavalo.combustivel_consumo_neg",
    dataType: "NUMERIC" as const,
    semanticsStatus: "CONFIRMED" as const,
    unit: "KM_L",
    periodicity: null,
    aggregation: "AVG",
    isMonetary: false,
    taxonomyCode: "cv_combustivel",
  },
  {
    /* Cadastro: aparece, e nunca entra num total. */
    code: "cavalo.chassi",
    dataType: "TEXT" as const,
    semanticsStatus: "CONFIRMED" as const,
    unit: null,
    isMonetary: false,
    taxonomyCode: "cad_identificacao",
  },
];

const cavalo = (
  manutencao: number,
  finame: number,
  consumo: number,
  chassi = "9BM958",
) => ({
  "cavalo.manutencao_ano": manutencao,
  "cavalo.finame_cavalo": finame,
  "cavalo.combustivel_consumo_neg": consumo,
  "cavalo.chassi": chassi,
});

let escopo: string;

beforeAll(async () => {
  ctx = await createTestDatabase("analise_sem_cache");
  await seedTaxonomy(ctx.db, "test");
  escopo = "escopo-cavalo-analise";

  /*
    Jan → Fev → Mar → Ago, com uma ida e volta de propósito na manutenção:
    3.000 → 4.000 → 3.500 → 3.000. É o exemplo do próprio pedido, e é o que
    separa as duas leituras: movimento soma três transições, ponta a ponta vê
    zero.
  */
  await buildFixture(
    ctx.db,
    ATRIBUTOS,
    [
      {
        label: "CAV_JAN",
        effectiveDate: "2026-01-01",
        data: {
          ABC1D23: cavalo(3000, 3300, 2.85),
          DEF4G56: cavalo(2000, 1000, 3.10),
        },
      },
      {
        label: "CAV_FEV",
        effectiveDate: "2026-02-01",
        data: {
          ABC1D23: cavalo(4000, 3300, 2.85),
          DEF4G56: cavalo(2000, 1000, 3.10),
        },
      },
      {
        label: "CAV_MAR",
        effectiveDate: "2026-03-01",
        data: {
          ABC1D23: cavalo(3500, 3300, 2.85),
          DEF4G56: cavalo(2000, 1000, 3.10),
        },
      },
      {
        label: "CAV_AGO",
        effectiveDate: "2026-08-01",
        data: {
          /* manutenção volta ao ponto de partida; consumo e chassi mudam;
             FINAME cai; DEF4G56 sai da frota e HIJ7K89 entra. */
          ABC1D23: cavalo(3000, 2850, 2.72, "9BM999"),
          HIJ7K89: cavalo(1500, 900, 3.0),
        },
      },
    ],
    { entityType: "CAVALO", scopeHash: escopo },
  );
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

async function changeSets(): Promise<number> {
  const [linha] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(changeSetTable);
  return Number(linha.n);
}

async function apagarComparacoes(): Promise<void> {
  await ctx.db.delete(changeSetTable);
}

/* ------------------------------------------------------------------ */
/* Casos 1 e 2 — com cache e sem cache, a mesma resposta               */
/* ------------------------------------------------------------------ */

describe("a comparação existe com ou sem cache", () => {
  it("caso 2: sem nenhuma comparação gravada, a análise responde", async () => {
    await apagarComparacoes();
    expect(await changeSets()).toBe(0);

    const analise = (await getRangeAnalysis(ctx.db, "2026-01-01", "2026-08-01"))!;

    expect(analise.totals.comparisons).toBe(3);
    expect(analise.totals.changes).toBeGreaterThan(0);
    expect(analise.gaps).toEqual([]);
    // Foi tudo calculado na hora — e a tela não tem como saber disso.
    expect(analise.computedOnRead).toBe(3);
  });

  it("caso 1: com a comparação gravada, o resultado é o mesmo — e não recalcula", async () => {
    await apagarComparacoes();
    const semCache = (await getRangeAnalysis(ctx.db, "2026-01-01", "2026-08-01"))!;

    /*
      A primeira leitura materializa o que calculou. A segunda tem de encontrar
      tudo pronto — é o que garante que o caminho novo não vira custo
      permanente — e dizer exatamente a mesma coisa.
    */
    const comCache = (await getRangeAnalysis(ctx.db, "2026-01-01", "2026-08-01"))!;

    expect(comCache.computedOnRead).toBe(0);
    expect(comCache.totals).toEqual(semCache.totals);
    expect(comCache.impact.byPeriodicity).toEqual(semCache.impact.byPeriodicity);
    expect(comCache.digest).toEqual(semCache.digest);
    expect(comCache.entries.map((e) => e.title)).toEqual(
      semCache.entries.map((e) => e.title),
    );
  });

  it("caso 2b: ponta a ponta também responde sem comparação gravada", async () => {
    await apagarComparacoes();
    const pontas = (await getEndToEndAnalysis(ctx.db, "2026-01-01", "2026-08-01"))!;
    expect(pontas.totals.changes).toBeGreaterThan(0);
    expect(pontas.entitiesCompared).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Caso 3 — a vigência reimportada                                     */
/* ------------------------------------------------------------------ */

describe("caso 3: vigência reimportada", () => {
  it("compara a versão válida, e nunca a comparação presa ao snapshot substituído", async () => {
    await apagarComparacoes();

    const contexto = "escopo-reimportacao";
    const primeira = await buildFixture(
      ctx.db,
      ATRIBUTOS,
      [
        {
          label: "REIMP_JUL",
          effectiveDate: "2026-07-01",
          data: { XYZ9Z99: cavalo(1000, 500, 3.0) },
        },
        {
          label: "REIMP_AGO",
          effectiveDate: "2026-08-01",
          data: { XYZ9Z99: cavalo(1100, 500, 3.0) },
        },
      ],
      { entityType: "CAVALO", scopeHash: contexto },
    );

    // A comparação da importação: +100 de manutenção.
    await computeChangeSet(
      ctx.db,
      primeira.snapshotIds.REIMP_JUL,
      primeira.snapshotIds.REIMP_AGO,
      { computedBy: "test" },
    );

    const antes = (await getRangeAnalysis(ctx.db, "2026-07-01", "2026-08-01", {
      scopeHash: contexto,
      channel: null,
    }))!;
    expect(antes.impact.byPeriodicity.MENSAL).toBeCloseTo(100, 2);

    /*
      Agosto chega corrigido: a manutenção era 1.400, e não 1.100. `promote`
      marca o snapshot antigo como SUPERSEDED e grava um novo, com **id novo** —
      e é isso que a fixture reproduz aqui.
    */
    const segunda = await buildFixture(
      ctx.db,
      ATRIBUTOS,
      [
        {
          label: "REIMP_AGO_R2",
          effectiveDate: "2026-08-01",
          data: { XYZ9Z99: cavalo(1400, 500, 3.0) },
        },
      ],
      { entityType: "CAVALO", scopeHash: contexto },
    );
    await ctx.db
      .update(snapshotTable)
      .set({ status: "SUPERSEDED" })
      .where(eq(snapshotTable.id, primeira.snapshotIds.REIMP_AGO));

    const depois = (await getRangeAnalysis(ctx.db, "2026-07-01", "2026-08-01", {
      scopeHash: contexto,
      channel: null,
    }))!;

    // +400, e não +100: a leitura seguiu o snapshot vivo.
    expect(depois.impact.byPeriodicity.MENSAL).toBeCloseTo(400, 2);
    expect(depois.totals.comparisons).toBe(1);

    /*
      E a comparação obsoleta continua no banco sem ser usada — o que prova que
      ela foi **ignorada por identidade do par**, e não apagada por sorte.
    */
    const [obsoleta] = await ctx.db
      .select()
      .from(changeSetTable)
      .where(eq(changeSetTable.snapshotBId, primeira.snapshotIds.REIMP_AGO));
    expect(obsoleta).toBeDefined();

    // A nova foi materializada no lugar dela, apontando para o snapshot vivo.
    const [nova] = await ctx.db
      .select()
      .from(changeSetTable)
      .where(eq(changeSetTable.snapshotBId, segunda.snapshotIds.REIMP_AGO_R2));
    expect(nova).toBeDefined();
    expect(nova.status).toBe("DONE");
  });
});

/* ------------------------------------------------------------------ */
/* Casos 4, 5, 6, 7, 10 — o que aparece, e como                        */
/* ------------------------------------------------------------------ */

describe("o que a análise mostra de cada alteração", () => {
  it("caso 4: um atributo que mudou aparece no ativo, com antes, depois e impacto", async () => {
    await apagarComparacoes();
    const analise = (await getRangeAnalysis(ctx.db, "2026-03-01", "2026-08-01"))!;
    const abc = analise.byEntity.find((e) => e.plate === "ABC1D23")!;

    expect(abc).toBeDefined();
    expect(abc.status).toBe("ALTERADO");

    const finame = abc.attributes.find((a) => a.attributeCode === "cavalo.finame_cavalo")!;
    expect(finame.valueBefore).toBe("3300");
    expect(finame.valueAfter).toBe("2850");
    expect(finame.impactAmount).toBeCloseTo(-450, 2);
    expect(finame.impactPeriodicity).toBe("MENSAL");
    expect(finame.classification).toBe("CUSTO_REDUZIU");
  });

  it("caso 5: cavalo novo aparece como entrada, e fora do dinheiro", async () => {
    await apagarComparacoes();
    const analise = (await getRangeAnalysis(ctx.db, "2026-03-01", "2026-08-01"))!;

    const novo = analise.byEntity.find((e) => e.plate === "HIJ7K89")!;
    expect(novo.status).toBe("NOVO");
    expect(analise.digest.entitiesAdded).toBe(1);
    expect(analise.digest.byClass.EQUIPAMENTO_NOVO).toBe(1);

    /*
      Frota maior não é preço maior: o ativo que entrou não produz linha de
      valor nenhuma, e por isso não tem atributo no drill-down.
    */
    expect(novo.attributes).toEqual([]);
  });

  it("caso 6: cavalo removido aparece como saída", async () => {
    await apagarComparacoes();
    const analise = (await getRangeAnalysis(ctx.db, "2026-03-01", "2026-08-01"))!;

    const saiu = analise.byEntity.find((e) => e.plate === "DEF4G56")!;
    expect(saiu.status).toBe("REMOVIDO");
    expect(analise.digest.entitiesRemoved).toBe(1);
    expect(analise.digest.byClass.EQUIPAMENTO_REMOVIDO).toBe(1);
  });

  it("caso 7: consumo mudou e não virou dinheiro — impacto não apurado, nunca R$ 0", async () => {
    await apagarComparacoes();
    const analise = (await getRangeAnalysis(ctx.db, "2026-03-01", "2026-08-01"))!;
    const abc = analise.byEntity.find((e) => e.plate === "ABC1D23")!;
    const consumo = abc.attributes.find(
      (a) => a.attributeCode === "cavalo.combustivel_consumo_neg",
    )!;

    expect(consumo.valueBefore).toBe("2.85");
    expect(consumo.valueAfter).toBe("2.72");
    // A distinção que o produto inteiro sustenta: **null**, e não zero.
    expect(consumo.impactAmount).toBeNull();
    expect(consumo.impactConfidence).toBe("NOT_CALCULABLE");
    expect(consumo.reason).toBeTruthy();
    expect(consumo.classification).toBe("OPERACIONAL");
    expect(analise.digest.withoutCalculatedImpact).toBeGreaterThan(0);
  });

  it("caso 10: alteração cadastral aparece mesmo sem impacto financeiro", async () => {
    await apagarComparacoes();
    const analise = (await getRangeAnalysis(ctx.db, "2026-03-01", "2026-08-01"))!;
    const abc = analise.byEntity.find((e) => e.plate === "ABC1D23")!;
    const chassi = abc.attributes.find((a) => a.attributeCode === "cavalo.chassi")!;

    expect(chassi.valueBefore).toBe("9BM958");
    expect(chassi.valueAfter).toBe("9BM999");
    expect(chassi.impactAmount).toBeNull();
    expect(chassi.classification).toBe("CADASTRAL");
    expect(analise.digest.byClass.CADASTRAL).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Caso 8 — as duas leituras discordam, e as duas estão certas         */
/* ------------------------------------------------------------------ */

describe("caso 8: o valor que voltou ao original", () => {
  it("movimentos mostra as transições intermediárias; ponta a ponta mostra líquido zero", async () => {
    await apagarComparacoes();

    const movimentos = (await getRangeAnalysis(ctx.db, "2026-01-01", "2026-08-01"))!;
    const pontas = (await getEndToEndAnalysis(ctx.db, "2026-01-01", "2026-08-01"))!;

    const manutencaoNoCaminho = movimentos.byEntity
      .find((e) => e.plate === "ABC1D23")!
      .attributes.find((a) => a.attributeCode === "cavalo.manutencao_ano")!;

    // 3.000 → 4.000 → 3.500 → 3.000: três mexidas, e a soma delas é zero.
    expect(manutencaoNoCaminho.movements).toBe(3);
    expect(manutencaoNoCaminho.impactAmount).toBeCloseTo(0, 2);
    /*
      Os dois lados vêm brutos e separados: +1.000 de manutenção subindo, e
      −1.450 do que caiu (os mesmos 1.000 da manutenção voltando, mais os 450
      do FINAME). O líquido é −450 — e é exatamente por isso que ele nunca
      substitui os dois brutos na tela: "−450" sozinho esconde que R$ 2.450
      passaram pela mesa.
    */
    expect(movimentos.digest.increasesByPeriodicity.MENSAL).toBeCloseTo(1000, 2);
    expect(movimentos.digest.decreasesByPeriodicity.MENSAL).toBeCloseTo(-1450, 2);
    expect(movimentos.digest.netByPeriodicity.MENSAL).toBeCloseTo(-450, 2);

    /*
      Do outro lado, a manutenção do ABC1D23 simplesmente não existe: janeiro e
      agosto têm o mesmo 3.000. E o produto sabe **dizer** que ela foi revertida,
      que é a única pergunta que exige as duas leituras.
    */
    const abcNasPontas = pontas.byEntity.find((e) => e.plate === "ABC1D23");
    expect(
      abcNasPontas?.attributes.some((a) => a.attributeCode === "cavalo.manutencao_ano"),
    ).toBeFalsy();
    expect(
      pontas.reverted.some((r) => r.attributeCode === "cavalo.manutencao_ano"),
    ).toBe(true);
  });

  it("a reversão é encontrada sem depender de comparação gravada", async () => {
    await apagarComparacoes();
    const pontas = (await getEndToEndAnalysis(ctx.db, "2026-01-01", "2026-08-01"))!;
    expect(
      pontas.reverted.some((r) => r.attributeCode === "cavalo.manutencao_ano"),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Caso 9 — o parâmetro que dois cartões mostram                       */
/* ------------------------------------------------------------------ */

describe("caso 9: parâmetro compartilhado entre cartões", () => {
  it("o recorte por coluna e o recorte por parâmetro veem a mesma alteração", async () => {
    await apagarComparacoes();

    // `cavalo.finame_cavalo` é do parâmetro Financiamento e é também uma das
    // colunas da tabela CAVALO. Os dois cartões a mostram, e devem concordar.
    const porParametro = (await getRangeAnalysis(
      ctx.db,
      "2026-03-01",
      "2026-08-01",
      undefined,
      ["AQUISICAO_FINANCIAMENTO|Financiamento"],
    ))!;
    const porColuna = (await getRangeAnalysis(
      ctx.db,
      "2026-03-01",
      "2026-08-01",
      undefined,
      [],
      ["cavalo.finame_cavalo"],
    ))!;

    expect(porColuna.impact.byPeriodicity.MENSAL).toBeCloseTo(
      porParametro.impact.byPeriodicity.MENSAL,
      2,
    );
  });

  it("a agregação geral não conta a mesma alteração duas vezes", async () => {
    await apagarComparacoes();

    const inteiro = (await getRangeAnalysis(ctx.db, "2026-03-01", "2026-08-01"))!;
    const chaves = [...new Set(inteiro.entries.map((e) => e.parameterKey))];

    let somaDasPartes = 0;
    for (const chave of chaves) {
      const parte = (await getRangeAnalysis(
        ctx.db,
        "2026-03-01",
        "2026-08-01",
        undefined,
        [chave],
      ))!;
      somaDasPartes += parte.totals.changes;
    }
    expect(somaDasPartes).toBe(inteiro.totals.changes);
  });
});

/* ------------------------------------------------------------------ */
/* O resumo executivo                                                  */
/* ------------------------------------------------------------------ */

describe("o resumo executivo", () => {
  it("separa aumentos, reduções e o líquido — e diz quantas ficaram de fora", async () => {
    await apagarComparacoes();
    const analise = (await getRangeAnalysis(ctx.db, "2026-03-01", "2026-08-01"))!;
    const { digest } = analise;

    const aumentos = digest.increasesByPeriodicity.MENSAL ?? 0;
    const reducoes = digest.decreasesByPeriodicity.MENSAL ?? 0;
    expect(digest.netByPeriodicity.MENSAL).toBeCloseTo(aumentos + reducoes, 2);

    /*
      O líquido é uma leitura, e sozinho é meia verdade: as alterações que
      ninguém sabe precificar continuam contadas ao lado dele, para que o número
      nunca seja lido como "o total".
    */
    expect(digest.withoutCalculatedImpact).toBeGreaterThan(0);
    expect(digest.entitiesChanged).toBeGreaterThan(0);
    expect(digest.fieldsChanged).toBe(analise.totals.changes);
  });

  it("nunca soma periodicidades diferentes num número só", async () => {
    await apagarComparacoes();
    const { digest } = (await getRangeAnalysis(ctx.db, "2026-01-01", "2026-08-01"))!;
    for (const balde of Object.keys(digest.netByPeriodicity)) {
      expect(
        Object.keys(digest.increasesByPeriodicity).includes(balde) ||
          Object.keys(digest.decreasesByPeriodicity).includes(balde),
      ).toBe(true);
    }
  });

  it("os maiores impactos vêm ordenados e só com dinheiro apurado", async () => {
    await apagarComparacoes();
    const analise = (await getRangeAnalysis(ctx.db, "2026-03-01", "2026-08-01"))!;

    expect(analise.top.length).toBeGreaterThan(0);
    for (const linha of analise.top) {
      expect(linha.amount).not.toBe(0);
      expect(linha.periodicity).toBeTruthy();
    }
    const pesos = analise.top.map((l) => Math.abs(l.amount));
    expect([...pesos].sort((a, b) => b - a)).toEqual(pesos);
  });
});

/* ------------------------------------------------------------------ */
/* A primeira vigência da série                                        */
/* ------------------------------------------------------------------ */

describe("a única lacuna que sobrou", () => {
  it("a primeira entrega de uma série é nomeada, e não contada como zero", async () => {
    await apagarComparacoes();
    const contexto = "escopo-primeira-entrega";

    /*
      Duas séries na mesma unidade: o cavalo entrega janeiro e fevereiro; a
      carreta só aparece em fevereiro. No intervalo jan → fev o cavalo tem
      transição e a carreta não tem com o que se comparar — e é essa a única
      lacuna que sobrou depois que a comparação passou a ser calculada na hora.
    */
    await buildFixture(
      ctx.db,
      ATRIBUTOS,
      [
        {
          label: "PRIM_JAN",
          effectiveDate: "2026-01-01",
          data: { QQQ1Q11: cavalo(100, 50, 3.0) },
        },
        {
          label: "PRIM_FEV",
          effectiveDate: "2026-02-01",
          data: { QQQ1Q11: cavalo(120, 50, 3.0) },
        },
      ],
      { entityType: "CAVALO", scopeHash: contexto },
    );
    await buildFixture(
      ctx.db,
      ATRIBUTOS,
      [
        {
          label: "PRIM_CARRETA_FEV",
          effectiveDate: "2026-02-01",
          data: { RRR1R11: cavalo(10, 5, 3.0) },
        },
      ],
      { entityType: "CARRETA", scopeHash: contexto },
    );

    const analise = (await getRangeAnalysis(ctx.db, "2026-01-01", "2026-02-01", {
      scopeHash: contexto,
      channel: null,
    }))!;

    // O cavalo comparou; a carreta virou lacuna nomeada.
    expect(analise.totals.comparisons).toBe(1);
    expect(analise.gaps).toHaveLength(1);
    expect(analise.gaps[0].reason).toContain("primeira vigência desta série");
    // E a frase não fala mais de cache, de comparação faltante nem de snapshot.
    expect(analise.gaps[0].reason).not.toMatch(/comparação ainda não foi calculada/);
  });
});
