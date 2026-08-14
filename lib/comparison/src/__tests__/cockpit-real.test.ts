import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  importFixture,
  modelExportPaths,
  type TestDb,
} from "@workspace/ingest/testing";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { getGroupedView } from "../grouped";

/**
 * O cockpit contra o export real da Freightec.
 *
 * `cockpit.test.ts` afere a regra com grupos fabricados; este arquivo afere que
 * a regra, aplicada ao que a Ambev de fato entregou, continua contando as
 * mesmas coisas que o resto do produto conta. É aqui que uma divergência entre
 * o painel e a lista apareceria — que é exatamente o defeito que um cockpit
 * executivo pode introduzir sem ninguém notar.
 */

const AGOSTO = "2026-08-01";
const JULHO = "2026-07-02";
const MARCO = "2026-03-02";
const PRIMEIRA = "2025-12-02";

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("cockpit_real");
  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    await importFixture(ctx.db, filePath);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
  await computeMissingChangeSets(ctx.db, "test:cockpit");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("os números do painel são os mesmos da vigência", () => {
  it("KPI de alterações, pontos e veículos batem com os totais do motor", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const { kpis } = view.cockpit;
    expect(kpis.changes).toBe(view.totals.changes);
    expect(kpis.parameters).toBe(view.totals.groups);
    expect(kpis.vehicles).toBe(view.totals.vehiclesTouched);
    // A frota é a soma das séries entregues — cavalos + carretas.
    expect(kpis.fleet).toBe(view.series.reduce((total, s) => total + s.fleet, 0));
  });

  it("a soma das alterações de todos os grupos fecha com o total da vigência", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const soma = view.groups.reduce((total, g) => total + g.changes, 0);
    expect(soma).toBe(view.totals.changes);
  });

  it("as três situações de preço somam o total, e nenhuma vira a outra", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const p = view.cockpit.panorama.pricing;
    expect(p.calculatedChanges + p.excludedChanges + p.notCalculableChanges).toBe(
      view.totals.changes,
    );
    expect(p.excludedChanges).toBe(view.impact.excludedChanges);
    expect(p.notCalculableChanges).toBe(view.impact.notCalculable);
  });

  it("a fila tem exatamente um item por grupo, e todos os grupos existem nela", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    expect(view.cockpit.priorities).toHaveLength(view.groups.length);
    const chaves = new Set(view.groups.map((g) => g.key));
    for (const item of view.cockpit.priorities) expect(chaves.has(item.key)).toBe(true);
    expect(view.cockpit.priorities.map((p) => p.rank)).toEqual(
      view.groups.map((_, i) => i + 1),
    );
  });

  it("cavalo e carreta aparecem separados, e as alterações de cada um fecham", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const porFrota = view.cockpit.panorama.byEquipment;
    expect(porFrota.map((b) => b.entityType).sort()).toEqual(["CARRETA", "CAVALO"]);
    expect(porFrota.reduce((total, b) => total + b.changes, 0)).toBe(view.totals.changes);

    const cavalo = porFrota.find((b) => b.entityType === "CAVALO")!;
    const carreta = porFrota.find((b) => b.entityType === "CARRETA")!;
    expect(cavalo.fleet).toBe(62);
    expect(carreta.fleet).toBe(71);
  });
});

describe("a fila de investigação sobre o dado real", () => {
  it("agosto/2026 não abre mais com o fim do contrato — aquilo era formato", async () => {
    /*
      Este teste já afirmou o contrário: a fila de agosto abria com
      `cavalo.data_fim_contrato`, crítico, 100% da frota. E era mentira contada
      com números corretos — as 62 linhas são a mesma data escrita como serial
      do Excel, e nenhuma delas é mudança de contrato. O que abre agosto agora é
      uma alteração de verdade; o formato continua na fila, no fim, dizendo o
      que é.
    */
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const primeiro = view.cockpit.priorities[0];
    const grupoDoTopo = view.groups.find((g) => g.key === primeiro.key)!;
    expect(grupoDoTopo.attributeCode).not.toBe("cavalo.data_fim_contrato");
    expect(grupoDoTopo.formatOnly).toBe(false);

    const contrato = view.groups.find(
      (g) => g.attributeCode === "cavalo.data_fim_contrato",
    )!;
    const item = view.cockpit.priorities.find((p) => p.key === contrato.key)!;
    expect(contrato.badge).toBe("FORMATO");
    expect(item.severity).toBe("BAIXO");
    expect(item.hasAnomaly).toBe(true);
    expect(item.sharePercent).toBe(100);
    expect(item.diagnosis).toContain("Mudou o formato do arquivo, não o contrato");
    // O valor cru continua sem subir para a camada executiva.
    expect(item.diagnosis).not.toContain("46935");
    expect(item.patternsSummary).toContain("54");

    // E a vigência deixou de ser anunciada por ele: as 62 linhas continuam
    // contadas, ditas como o que são.
    expect(view.totals.formatOnlyChanges).toBe(62);
    expect(view.cockpit.narrative.sentences.join(" ")).toContain(
      "não são alteração contratual",
    );
  });

  it("julho/2026 põe o zeramento da frota inteira à frente do IPVA de R$ 144 mil/ano", async () => {
    /*
      Os dois são críticos, e a ordem entre eles é a regra escrita: um valor
      negociado que zerou nos 62 cavalos (35+10+30+6 = 81) vem antes de um
      imposto que caiu 35% nos mesmos 62 (35+30+6 = 71). Não é o dinheiro que
      decide sozinho — é o dinheiro somado à ruptura e à abrangência.
    */
    const view = (await getGroupedView(ctx.db, JULHO))!;
    const [primeiro, segundo] = view.cockpit.priorities;
    const grupoUm = view.groups.find((g) => g.key === primeiro.key)!;
    const grupoDois = view.groups.find((g) => g.key === segundo.key)!;

    expect(grupoUm.attributeCode).toBe("cavalo.combustivel_consumo_neg");
    expect(primeiro.severity).toBe("CRITICO");
    expect(primeiro.score).toBe(81);

    expect(grupoDois.attributeCode).toBe("cavalo.ipva_licenciamento");
    expect(segundo.hasImpact).toBe(true);
    expect(segundo.score).toBe(71);
    // O valor do item é o do motor, sem recálculo nenhum no meio.
    expect(grupoDois.impact.amount).toBeCloseTo(-144874.5, 2);
    expect(grupoDois.impact.periodicity).toBe("ANUAL");
  });

  it("a ordem é estável entre duas leituras da mesma vigência", async () => {
    const a = (await getGroupedView(ctx.db, AGOSTO))!;
    const b = (await getGroupedView(ctx.db, AGOSTO))!;
    expect(a.cockpit.priorities.map((p) => p.key)).toEqual(
      b.cockpit.priorities.map((p) => p.key),
    );
    expect(a.cockpit.priorities.map((p) => p.score)).toEqual(
      b.cockpit.priorities.map((p) => p.score),
    );
  });

  it("todo item traz a conta que o pôs naquela posição", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    for (const item of view.cockpit.priorities) {
      expect(item.score).toBe(item.reasons.reduce((total, r) => total + r.points, 0));
      expect(item.diagnosis.length).toBeGreaterThan(0);
    }
  });
});

describe("as vigências difíceis", () => {
  it("março/2026 não tem preço nenhum, e o painel diz isso sem escrever zero", async () => {
    const view = (await getGroupedView(ctx.db, MARCO))!;
    expect(view.cockpit.kpis.hasImpact).toBe(false);
    expect(view.cockpit.kpis.impact.byPeriodicity).toEqual({});
    expect(view.cockpit.panorama.pricing.notCalculableChanges).toBe(400);
    expect(view.cockpit.panorama.pricing.reasons.length).toBeGreaterThan(0);
    // O risco continua sendo o assunto da frase.
    expect(view.cockpit.narrative.sentences[0]).toContain("400 alterações");
  });

  it("a primeira vigência da série não é apresentada como 'nada mudou'", async () => {
    const view = (await getGroupedView(ctx.db, PRIMEIRA))!;
    expect(view.totals.changes).toBe(0);
    expect(view.cockpit.baseline.hasBaseline).toBe(false);
    expect(view.cockpit.baseline.seriesWithoutBaseline.length).toBeGreaterThan(0);
    expect(view.cockpit.narrative.headline).toContain("primeira vigência");
    expect(view.cockpit.priorities).toHaveLength(0);
  });

  it("o acumulado histórico fica fora dos KPIs da vigência", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    expect(view.cockpit.history.comparisons).toBe(16);
    expect(view.cockpit.history.sufficient).toBe(true);
    expect(view.cockpit.kpis.impact.byPeriodicity.ANUAL).not.toBe(
      view.cockpit.history.byPeriodicity.ANUAL,
    );
  });
});
