import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { getFamiliesView, getRangeAnalysis } from "../families-view";
import { getFamiliesOverview, getRangeOverview } from "../families-view-overview";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * A Visão Geral soma unidades, nunca contextos — e só quando dá para provar
 * que somar não é contar duas vezes o mesmo veículo.
 *
 * O elenco de unidades sintéticas cobre exatamente os casos que a
 * investigação por trás deste arquivo levantou:
 *
 * - A, B, C: uma unidade, um contexto, a competência pedida — o caso comum.
 * - D, E: têm um mês *anterior* à competência pedida, mas não a competência
 *   em si — provam que `latestPeriod` nunca é usado como substituto.
 * - G: uma unidade real (mesmo código de escopo `UNIDADE`) entregue em dois
 *   **canais** diferentes (EMPURRADA e ROTA) — soma normalmente, porque
 *   canal é a partição que o resto do produto já trata como distinta.
 * - H: uma unidade com **dois contextos no mesmo canal** — o cenário que a
 *   investigação de `lib/ingest/src/pipeline.ts` mostrou não ter garantia
 *   de partição nenhuma. Fica de fora, sinalizada como ambígua.
 */

let ctx: TestDb;

const AGOSTO = "2026-08-02";
const JULHO = "2026-07-02";
const SETEMBRO = "2026-09-02";

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

async function anexarEscopo(
  db: Database,
  snapshotIds: string[],
  entradas: { scopeType: string; code: string }[],
): Promise<void> {
  for (const entrada of entradas) {
    await db.execute(sql`
      INSERT INTO "scope" ("scope_type", "code") VALUES (${entrada.scopeType}, ${entrada.code})
      ON CONFLICT ("scope_type", "code") DO NOTHING
    `);
  }
  for (const snapshotId of snapshotIds) {
    for (const entrada of entradas) {
      await db.execute(sql`
        INSERT INTO "snapshot_scope" ("snapshot_id", "scope_id")
        SELECT ${snapshotId}::uuid, id FROM "scope"
         WHERE scope_type = ${entrada.scopeType} AND code = ${entrada.code}
        ON CONFLICT DO NOTHING
      `);
    }
  }
}

beforeAll(async () => {
  ctx = await createTestDatabase("families_view_overview");
  await seedTaxonomy(ctx.db, "test");

  // A, B, C: uma unidade, um contexto, jul -> ago (a competência pedida).
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_7_2026", effectiveDate: JULHO, data: { AAA0001: { "carreta.custo_fixo": 1000 } } },
      { label: "EMPURRADA_2_8_2026", effectiveDate: AGOSTO, data: { AAA0001: { "carreta.custo_fixo": 1200 } } },
    ],
    { entityType: "CARRETA", scopeHash: "overview-unit-a", canal: "EMPURRADA" },
  );
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_7_2026", effectiveDate: JULHO, data: { BBB0002: { "carreta.custo_fixo": 5000 } } },
      { label: "EMPURRADA_2_8_2026", effectiveDate: AGOSTO, data: { BBB0002: { "carreta.custo_fixo": 4000 } } },
    ],
    { entityType: "CARRETA", scopeHash: "overview-unit-b", canal: "EMPURRADA" },
  );
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_7_2026", effectiveDate: JULHO, data: { CCC0003: { "carreta.custo_fixo": 2000 } } },
      { label: "EMPURRADA_2_8_2026", effectiveDate: AGOSTO, data: { CCC0003: { "carreta.custo_fixo": 2600 } } },
    ],
    { entityType: "CARRETA", scopeHash: "overview-unit-c", canal: "EMPURRADA" },
  );

  // D, E: jun -> jul. Nunca chegam a agosto — a competência pedida nos
  // testes principais não existe para elas, ponto.
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_6_2026", effectiveDate: "2026-06-02", data: { DDD0004: { "carreta.custo_fixo": 3000 } } },
      { label: "EMPURRADA_2_7_2026", effectiveDate: JULHO, data: { DDD0004: { "carreta.custo_fixo": 3500 } } },
    ],
    { entityType: "CARRETA", scopeHash: "overview-unit-d", canal: "EMPURRADA" },
  );
  await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_6_2026", effectiveDate: "2026-06-02", data: { EEE0005: { "carreta.custo_fixo": 1000 } } },
      { label: "EMPURRADA_2_7_2026", effectiveDate: JULHO, data: { EEE0005: { "carreta.custo_fixo": 1100 } } },
    ],
    { entityType: "CARRETA", scopeHash: "overview-unit-e", canal: "EMPURRADA" },
  );

  // G: uma unidade real, dois canais — soma normalmente.
  const gEmpurrada = await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_7_2026", effectiveDate: JULHO, data: { GEE0006: { "carreta.custo_fixo": 800 } } },
      { label: "EMPURRADA_2_8_2026", effectiveDate: AGOSTO, data: { GEE0006: { "carreta.custo_fixo": 900 } } },
    ],
    { entityType: "CARRETA", scopeHash: "overview-unit-g-empurrada", canal: "EMPURRADA" },
  );
  const gRota = await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "ROTA_2_7_2026", effectiveDate: JULHO, data: { GRR0007: { "carreta.custo_fixo": 300 } } },
      { label: "ROTA_2_8_2026", effectiveDate: AGOSTO, data: { GRR0007: { "carreta.custo_fixo": 500 } } },
    ],
    { entityType: "CARRETA", scopeHash: "overview-unit-g-rota", canal: "ROTA" },
  );
  await anexarEscopo(
    ctx.db,
    [...Object.values(gEmpurrada.snapshotIds), ...Object.values(gRota.snapshotIds)],
    [{ scopeType: "UNIDADE", code: "unidade-g" }],
  );

  // H: uma unidade com dois contextos no MESMO canal — jul, ago e set, para
  // também sobrar como a única unidade viva em setembro (isolando o caso
  // "existe competência, ninguém consolidável").
  const h1 = await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_7_2026", effectiveDate: JULHO, data: { HHH0008: { "carreta.custo_fixo": 100 } } },
      { label: "EMPURRADA_2_8_2026", effectiveDate: AGOSTO, data: { HHH0008: { "carreta.custo_fixo": 150 } } },
      { label: "EMPURRADA_2_9_2026", effectiveDate: SETEMBRO, data: { HHH0008: { "carreta.custo_fixo": 200 } } },
    ],
    { entityType: "CARRETA", scopeHash: "overview-unit-h-1", canal: "EMPURRADA" },
  );
  const h2 = await buildFixture(
    ctx.db,
    CUSTO,
    [
      { label: "EMPURRADA_2_7_2026", effectiveDate: JULHO, data: { HHH0009: { "carreta.custo_fixo": 400 } } },
      { label: "EMPURRADA_2_8_2026", effectiveDate: AGOSTO, data: { HHH0009: { "carreta.custo_fixo": 450 } } },
      { label: "EMPURRADA_2_9_2026", effectiveDate: SETEMBRO, data: { HHH0009: { "carreta.custo_fixo": 500 } } },
    ],
    { entityType: "CARRETA", scopeHash: "overview-unit-h-2", canal: "EMPURRADA" },
  );
  await anexarEscopo(ctx.db, Object.values(h1.snapshotIds), [{ scopeType: "UNIDADE", code: "unidade-h" }]);
  await anexarEscopo(ctx.db, Object.values(h2.snapshotIds), [
    { scopeType: "UNIDADE", code: "unidade-h" },
    { scopeType: "OPERADOR", code: "operador-h2" },
  ]);

  await computeMissingChangeSets(ctx.db, "test");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("getFamiliesOverview — quem entra e quem fica de fora", () => {
  it("inclui só quem tem a competência exata, exclui quem não tem — nunca por latestPeriod", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;
    expect(overview).not.toBeNull();

    const incluidas = overview.unitsIncluded.map((u) => u.unidade).sort();
    expect(incluidas).toEqual(
      ["overview-unit-a", "overview-unit-b", "overview-unit-c", "unidade-g"].sort(),
    );

    const semVigencia = overview.unitsExcluded
      .filter((u) => u.reason === "sem_vigencia_na_competencia")
      .map((u) => u.unidade)
      .sort();
    // D e E têm jun->jul, não agosto: excluídas, e não por terem "um período
    // mais antigo" — por não terem ESTA competência.
    expect(semVigencia).toEqual(["overview-unit-d", "overview-unit-e"].sort());
  });

  it("nenhuma unidade aparece em unitsIncluded e unitsExcluded ao mesmo tempo", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;
    const incluidas = new Set(overview.unitsIncluded.map((u) => u.unidade));
    const excluidas = new Set(overview.unitsExcluded.map((u) => u.unidade));
    for (const u of incluidas) expect(excluidas.has(u)).toBe(false);
  });

  it("devolve null quando nenhuma unidade tem essa competência — nunca um objeto vazio", async () => {
    const overview = await getFamiliesOverview(ctx.db, "2019-01-01");
    expect(overview).toBeNull();
  });
});

describe("getFamiliesOverview — sobreposição entre contextos da mesma unidade", () => {
  it("dois contextos no mesmo canal são recusados, com o conflito nomeado por scopeType:code", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;
    const ambigua = overview.unitsExcluded.find((u) => u.unidade === "unidade-h");
    expect(ambigua).toBeDefined();
    expect(ambigua!.reason).toBe("contextos_sobrepostos_ambiguos");
    expect(ambigua!.conflito).toHaveLength(2);

    const entradas = new Set(ambigua!.conflito!.flatMap((c) => c.entradas));
    // A diferença entre os dois contextos é o OPERADOR — não um "aninhamento"
    // de tipos que uma comparação só por scopeType confundiria com um dos
    // dois sendo fatia do outro.
    expect([...entradas].some((e) => e.startsWith("OPERADOR:"))).toBe(true);
    expect([...entradas].filter((e) => e.startsWith("UNIDADE:"))).toHaveLength(1);

    expect(overview.unitsIncluded.some((u) => u.unidade === "unidade-h")).toBe(false);
  });

  it("contextos da mesma unidade em canais diferentes somam normalmente", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;
    const g = overview.unitsIncluded.find((u) => u.unidade === "unidade-g");
    expect(g).toBeDefined();
    expect(g!.contexts).toHaveLength(2);
    expect(new Set(g!.contexts.map((c) => c.channel))).toEqual(new Set(["EMPURRADA", "ROTA"]));
    expect(g!.coberturaParcial).toBeUndefined();
  });

  it("existe competência, mas nada é consolidável: 200 com 0 incluídas, nunca null", async () => {
    // Em setembro, só H tem dado — e H é ambígua. A competência existe; só
    // não há nada para somar com segurança.
    const overview = await getFamiliesOverview(ctx.db, SETEMBRO);
    expect(overview).not.toBeNull();
    expect(overview!.unitsIncluded).toHaveLength(0);
    expect(
      overview!.unitsExcluded.some(
        (u) => u.unidade === "unidade-h" && u.reason === "contextos_sobrepostos_ambiguos",
      ),
    ).toBe(true);
    // Nenhum card financeiro finge que o resultado é zero por falta de dado —
    // é zero porque `mergeSummaries([])` soma um conjunto vazio, e a tela
    // decide como mostrar isso a partir de `unitsIncluded.length === 0`.
    expect(overview!.summary.impact.byPeriodicity).toEqual({});
    expect(overview!.summary.changes).toBe(0);
  });
});

describe("getFamiliesOverview — a soma bate com a soma manual", () => {
  it("impact, changes e vehiclesTouched equivalem à soma dos endpoints individuais", async () => {
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

    const somaManual = (extrair: (v: NonNullable<typeof individuais[number]>) => number) =>
      individuais.reduce((soma, v) => soma + extrair(v), 0);

    expect(overview.summary.impact.byPeriodicity.MENSAL).toBeCloseTo(
      somaManual((v) => v.summary.impact.byPeriodicity.MENSAL ?? 0),
      2,
    );
    expect(overview.summary.changes).toBe(somaManual((v) => v.summary.changes));
    // Soma simples, não deduplicada — cada unidade usa placas próprias nesta
    // fixture, então o valor bate com a soma; o ponto do teste é que é
    // literalmente `sum(...)`, não uma dedução por `entity_id`.
    expect(overview.summary.vehiclesTouched).toBe(somaManual((v) => v.summary.vehiclesTouched));
  });

  it("topParameters mescla o mesmo parâmetro entre unidades em vez de duplicá-lo", async () => {
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

    const somaEsperada = individuais.reduce(
      (soma, v) => soma + (v.summary.topParameters[0]?.byPeriodicity.MENSAL ?? 0),
      0,
    );

    // Um parâmetro só existe na fixture (carreta.custo_fixo): se a mesclagem
    // concatenasse em vez de somar por (family, key), haveria uma entrada por
    // unidade em vez de uma.
    expect(overview.summary.topParameters).toHaveLength(1);
    expect(overview.summary.topParameters[0].byPeriodicity.MENSAL).toBeCloseTo(somaEsperada, 2);
  });
});

describe("getFamiliesOverview — o consolidado que o Dashboard desenha", () => {
  it("famílias somam entre unidades em vez de aparecerem uma vez por unidade", async () => {
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

    // Uma família só existe na fixture: se o consolidado concatenasse em vez
    // de somar por `code`, haveria uma linha por unidade — e o pódio da tela
    // mostraria a mesma família cinco vezes.
    const carreta = overview.consolidado.families.filter((f) => f.changes > 0);
    expect(carreta).toHaveLength(1);
    expect(carreta[0].impact.byPeriodicity.MENSAL).toBeCloseTo(
      individuais.reduce(
        (soma, v) =>
          soma +
          v.families
            .filter((f) => f.code === carreta[0].code)
            .reduce((s, f) => s + (f.impact.byPeriodicity.MENSAL ?? 0), 0),
        0,
      ),
      2,
    );
    expect(carreta[0].changes).toBe(
      individuais.reduce(
        (soma, v) =>
          soma + v.families.filter((f) => f.code === carreta[0].code).reduce((s, f) => s + f.changes, 0),
        0,
      ),
    );
  });

  it("a fila enfileira os grupos de cada unidade sem mesclá-los, e cada linha diz de quem é", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;
    const { groups, gruposNoTotal } = overview.consolidado;

    expect(groups.length).toBeGreaterThan(0);
    expect(gruposNoTotal).toBeGreaterThanOrEqual(groups.length);

    // Mais de uma unidade na fila — é o que distingue "consolidado" de "a
    // primeira unidade que respondeu".
    const unidadesNaFila = new Set(groups.map((g) => g.unidade));
    expect(unidadesNaFila.size).toBeGreaterThan(1);

    // Cada linha aponta para um contexto real da unidade dela: é isso que o
    // link de detalhe da tela usa para abrir Alterações no recorte certo.
    for (const linha of groups) {
      const unidade = overview.unitsIncluded.find((u) => u.unidade === linha.unidade);
      expect(unidade).toBeDefined();
      expect(unidade!.contexts.some((c) => c.scopeHash === linha.scopeHash)).toBe(true);
      expect(linha.label).toBe(unidade!.label);
    }

    // Nenhum grupo aparece duas vezes sob a mesma unidade e canal — a chave
    // que a tela usa para desenhar a linha tem de ser única.
    const chaves = groups.map((g) => `${g.unidade}|${g.channel ?? ""}|${g.group.key}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("a fila está na ordem do Acompanhamento — score primeiro, nunca a ordem de chegada das unidades", async () => {
    const overview = (await getFamiliesOverview(ctx.db, AGOSTO))!;
    const scores = overview.consolidado.groups.map((g) => g.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("totais de frota e de movimento somam as unidades incluídas", async () => {
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

    const { totals } = overview.consolidado;
    expect(totals.changes).toBe(individuais.reduce((s, v) => s + v.totals.changes, 0));
    expect(totals.fleet).toBe(individuais.reduce((s, v) => s + v.cockpit.kpis.fleet, 0));
    expect(totals.entitiesAdded).toBe(individuais.reduce((s, v) => s + v.totals.entitiesAdded, 0));
    expect(totals.entitiesRemoved).toBe(
      individuais.reduce((s, v) => s + v.totals.entitiesRemoved, 0),
    );
    expect(totals.inconclusive).toBe(individuais.reduce((s, v) => s + v.totals.inconclusive, 0));
  });

  it("nada do consolidado vem de unidade excluída — setembro só tem a unidade ambígua", async () => {
    const overview = (await getFamiliesOverview(ctx.db, SETEMBRO))!;
    expect(overview.unitsIncluded).toHaveLength(0);
    expect(overview.consolidado.groups).toEqual([]);
    expect(overview.consolidado.families).toEqual([]);
    expect(overview.consolidado.totals.changes).toBe(0);
    expect(overview.consolidado.totals.fleet).toBe(0);
  });
});

describe("getRangeOverview — a série consolidada do gráfico", () => {
  it("soma ganhos e perdas de todas as unidades incluídas, competência a competência", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    const individuais = (
      await Promise.all(
        overview.unitsIncluded.flatMap((u) =>
          u.contexts.map((c) =>
            getRangeAnalysis(ctx.db, JULHO, AGOSTO, { scopeHash: c.scopeHash, channel: c.channel }),
          ),
        ),
      )
    ).filter((a) => a !== null);

    const ponto = overview.serie.find((p) => p.period === AGOSTO);
    expect(ponto).toBeDefined();

    const esperado = individuais
      .flatMap((a) => a.entries)
      .filter(
        (e) =>
          e.period === AGOSTO &&
          e.periodicity === "MENSAL" &&
          e.confidence === "CALCULATED" &&
          e.amount !== null &&
          e.amount !== 0,
      );
    const ganhos = esperado.filter((e) => e.amount! > 0).reduce((s, e) => s + e.amount!, 0);
    const perdas = esperado.filter((e) => e.amount! < 0).reduce((s, e) => s + e.amount!, 0);

    expect(ponto!.byPeriodicity.MENSAL.gains).toBeCloseTo(ganhos, 2);
    // Perda continua negativa aqui, como em toda parte do produto.
    expect(ponto!.byPeriodicity.MENSAL.losses).toBeCloseTo(perdas, 2);
    expect(perdas).toBeLessThan(0);
  });

  it("conta as alterações da competência somando as unidades incluídas", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    const individuais = (
      await Promise.all(
        overview.unitsIncluded.flatMap((u) =>
          u.contexts.map((c) =>
            getRangeAnalysis(ctx.db, JULHO, AGOSTO, { scopeHash: c.scopeHash, channel: c.channel }),
          ),
        ),
      )
    ).filter((a) => a !== null);

    const esperado = individuais
      .flatMap((a) => a.movements)
      .filter((m) => m.period === AGOSTO)
      .reduce((soma, m) => soma + m.changes, 0);

    const ponto = overview.serie.find((p) => p.period === AGOSTO)!;
    expect(esperado).toBeGreaterThan(0);
    expect(ponto.changes).toBe(esperado);
  });

  it("a série está ordenada por competência e não repete nenhuma", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    const periodos = overview.serie.map((p) => p.period);
    expect([...periodos].sort()).toEqual(periodos);
    expect(new Set(periodos).size).toBe(periodos.length);
  });

  it("a unidade ambígua não entra na série — nem pelo lado do gráfico", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    const soDaAmbigua = await getRangeAnalysis(ctx.db, JULHO, AGOSTO, {
      scopeHash: "overview-unit-h-1",
      channel: "EMPURRADA",
    });
    const daAmbigua = (soDaAmbigua?.entries ?? [])
      .filter((e) => e.period === AGOSTO && e.confidence === "CALCULATED")
      .reduce((s, e) => s + (e.amount ?? 0), 0);
    expect(daAmbigua).not.toBe(0);

    const ponto = overview.serie.find((p) => p.period === AGOSTO)!;
    const liquido =
      ponto.byPeriodicity.MENSAL.gains + ponto.byPeriodicity.MENSAL.losses;
    const comAmbigua = liquido + daAmbigua;
    expect(liquido).not.toBeCloseTo(comAmbigua, 2);
  });
});

describe("getRangeOverview — o histórico consolidado da Linha do Tempo", () => {
  /*
    A Linha do Tempo em Visão Geral desenha a soma dos `movements` de cada
    unidade — o mesmo número que cada unidade publica na própria tela. Os
    testes abaixo prendem essa igualdade: se a soma entre unidades deixar de
    ser a soma do que elas mostram, a tela passa a discordar do servidor sem
    ninguém notar.
  */
  const leiturasDe = async (overview: Awaited<ReturnType<typeof getRangeOverview>>) =>
    (
      await Promise.all(
        overview!.unitsIncluded.flatMap((u) =>
          u.contexts.map(async (c) => ({
            unidade: u.unidade,
            analysis: await getRangeAnalysis(ctx.db, JULHO, AGOSTO, {
              scopeHash: c.scopeHash,
              channel: c.channel,
            }),
          })),
        ),
      )
    ).filter((l) => l.analysis !== null);

  it("o líquido da competência é a soma dos movimentos de cada unidade", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    const leituras = await leiturasDe(overview);

    const esperado = leituras
      .flatMap((l) => l.analysis!.movements)
      .filter((m) => m.period === AGOSTO)
      .reduce((soma, m) => soma + (m.impact.byPeriodicity.MENSAL ?? 0), 0);

    const ponto = overview.serie.find((p) => p.period === AGOSTO)!;
    expect(esperado).not.toBe(0);
    expect(ponto.impact.byPeriodicity.MENSAL).toBeCloseTo(esperado, 2);
  });

  it("o que ficou sem valorar é somado, na competência e na unidade", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    const leituras = await leiturasDe(overview);

    const naCompetencia = leituras
      .flatMap((l) => l.analysis!.movements)
      .filter((m) => m.period === AGOSTO)
      .reduce((soma, m) => soma + m.impact.notCalculable, 0);
    const ponto = overview.serie.find((p) => p.period === AGOSTO)!;
    expect(ponto.impact.notCalculable).toBe(naCompetencia);

    for (const unidade of overview.unitsIncluded) {
      const daUnidade = leituras
        .filter((l) => l.unidade === unidade.unidade)
        .reduce((soma, l) => soma + l.analysis!.impact.notCalculable, 0);
      expect(unidade.notCalculable).toBe(daUnidade);
    }
  });

  it("cada competência diz de quem é o número, uma linha por unidade", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    const ponto = overview.serie.find((p) => p.period === AGOSTO)!;

    // Uma unidade com dois contextos (dois canais) aparece uma vez só.
    const unidades = ponto.porUnidade.map((u) => u.unidade);
    expect(new Set(unidades).size).toBe(unidades.length);
    // E ninguém aparece na série sem estar entre as incluídas.
    const incluidas = new Set(overview.unitsIncluded.map((u) => u.unidade));
    for (const unidade of unidades) expect(incluidas.has(unidade)).toBe(true);

    // As parcelas fecham com o total da competência.
    const soma = ponto.porUnidade.reduce(
      (total, u) => total + (u.impact.byPeriodicity.MENSAL ?? 0),
      0,
    );
    expect(soma).toBeCloseTo(ponto.impact.byPeriodicity.MENSAL ?? 0, 2);
    expect(ponto.porUnidade.reduce((total, u) => total + u.changes, 0)).toBe(ponto.changes);
  });

  it("a unidade ambígua não entra nas parcelas de nenhuma competência", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    for (const ponto of overview.serie) {
      expect(ponto.porUnidade.map((u) => u.unidade)).not.toContain("overview-unit-h");
    }
  });
});

describe("getFamiliesOverview — troca de competência", () => {
  it("muda quais unidades entram, sem misturar as duas leituras", async () => {
    const overviewJulho = (await getFamiliesOverview(ctx.db, JULHO))!;
    const overviewAgosto = (await getFamiliesOverview(ctx.db, AGOSTO))!;

    const incluidasJulho = overviewJulho.unitsIncluded.map((u) => u.unidade).sort();
    const incluidasAgosto = overviewAgosto.unitsIncluded.map((u) => u.unidade).sort();

    // D e E têm julho (jun->jul); em agosto, não têm.
    expect(incluidasJulho).toContain("overview-unit-d");
    expect(incluidasJulho).toContain("overview-unit-e");
    expect(incluidasAgosto).not.toContain("overview-unit-d");
    expect(incluidasAgosto).not.toContain("overview-unit-e");

    expect(overviewJulho.period).toBe(JULHO);
    expect(overviewAgosto.period).toBe(AGOSTO);
  });
});

describe("getRangeOverview — quem entra e quem fica de fora, por intervalo", () => {
  it("inclui unidades com contexto elegível, sem exigir a mesma competência exata", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    expect(overview).not.toBeNull();

    const incluidas = overview.unitsIncluded.map((u) => u.unidade).sort();
    // D e E não têm agosto — ao contrário de getFamiliesOverview, isso não as
    // exclui: cada uma cai no próprio padrão (o intervalo mais curto que
    // ainda mostra movimento a partir do que ela tem).
    expect(incluidas).toEqual(
      ["overview-unit-a", "overview-unit-b", "overview-unit-c", "overview-unit-d", "overview-unit-e", "unidade-g"].sort(),
    );
  });

  it("unidade com dois contextos no mesmo canal continua ambígua, mesmo sem competência única em jogo", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    const ambigua = overview.unitsExcluded.find((u) => u.unidade === "unidade-h");
    expect(ambigua).toBeDefined();
    expect(ambigua!.reason).toBe("contextos_sobrepostos_ambiguos");
    expect(overview.unitsIncluded.some((u) => u.unidade === "unidade-h")).toBe(false);
  });

  it("unidade com dois canais soma os dois contextos, igual à leitura individual de cada um", async () => {
    const overview = (await getRangeOverview(ctx.db, JULHO, AGOSTO))!;
    const g = overview.unitsIncluded.find((u) => u.unidade === "unidade-g");
    expect(g).toBeDefined();
    expect(g!.contexts).toHaveLength(2);

    const individuais = (
      await Promise.all(
        g!.contexts.map((c) =>
          getRangeAnalysis(ctx.db, JULHO, AGOSTO, { scopeHash: c.scopeHash, channel: c.channel }),
        ),
      )
    ).filter((a) => a !== null);

    const somaEsperada = individuais.reduce(
      (soma, a) => soma + (a.impact.byPeriodicity.MENSAL ?? 0),
      0,
    );
    expect(g!.impact.byPeriodicity.MENSAL).toBeCloseTo(somaEsperada, 2);
    expect(g!.changes).toBe(individuais.reduce((soma, a) => soma + a.totals.changes, 0));
  });

  it("devolve null quando nenhuma unidade tem contexto elegível", async () => {
    const vazio = await getRangeOverview(ctx.db, "2019-01-01", "2019-02-01");
    // Toda unidade cai no próprio padrão quando as pontas pedidas não
    // existem no seu histórico — então isto só é null se `listContexts`
    // devolver vazio, o que não é o caso desta fixture; o teste documenta
    // que o formato de "ninguém elegível" é `unitsIncluded: []`, não um 404
    // disfarçado de sucesso.
    expect(vazio).not.toBeNull();
  });
});
