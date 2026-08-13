import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, modelExportPaths, type TestDb } from "@workspace/ingest/testing";
import { captureRaw, preview, promote, receiveFile, stage } from "@workspace/ingest";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { computeMissingChangeSets, listPeriods } from "../consolidated";
import { getFamiliesView, getRangeAnalysis } from "../families-view";

/**
 * O intervalo — a aba Análise do cartão, sobre o export real.
 *
 * A aba existe para responder o que o Freightech não responde: entre duas
 * vigências, o que o cliente mexeu, quanto custou e quanto rendeu. Um número
 * assim é fácil de produzir errado de quatro maneiras, e cada uma delas tem um
 * teste aqui:
 *
 * 1. **Discordar da outra aba.** Um intervalo de uma vigência só tem de dar
 *    exatamente o que a tela daquela vigência já dá. Se as duas abas do mesmo
 *    cartão se contradisserem, nenhuma das duas serve.
 * 2. **Somar entre periodicidades.** R$/mês e R$/ano continuam em baldes
 *    separados, aqui como em todo o resto do produto.
 * 3. **Cancelar perda com ganho.** O líquido é uma leitura; as duas pontas são
 *    o dado. `perdas + ganhos` tem de reconstruir o líquido, balde a balde.
 * 4. **Engolir vigência sem comparação.** A que não tem comparação aparece
 *    nomeada em `gaps`, e nunca contada como zero.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("range_real");
  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo]) {
    const received = await receiveFile(ctx.db, { filePath });
    await captureRaw(ctx.db, received.importRunId);
    await stage(ctx.db, received.importRunId);
    await preview(ctx.db, received.importRunId);
    await promote(ctx.db, received.importRunId);
  }
  await seedTaxonomy(ctx.db, "test");
  await runProposalPass(ctx.db, "test");
  await applyConfirmations(ctx.db);
  await backfillSemantics(ctx.db);
  await computeMissingChangeSets(ctx.db, "test:range");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("as pontas do intervalo", () => {
  it("sem escolha, abre na vigência mais recente e na anterior — as duas dentro", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(ctx.db))!;

    expect(analise.to).toBe(periodos[0].effective_date);
    expect(analise.from).toBe(periodos[1]?.effective_date ?? periodos[0].effective_date);

    // "As duas entram" não é figura de linguagem: as duas datas aparecem entre
    // as vigências lidas (com comparação) ou entre as que ficaram de fora.
    const lidas = new Set([
      ...analise.movements.map((m) => m.period),
      ...analise.gaps.map((g) => g.period),
    ]);
    expect(lidas.has(analise.from)).toBe(true);
    expect(lidas.has(analise.to)).toBe(true);
  });

  it("pontas trocadas dão a mesma leitura — de agosto até abril é abril até agosto", async () => {
    const periodos = await listPeriods(ctx.db);
    if (periodos.length < 2) return;
    const antiga = periodos[periodos.length - 1].effective_date;
    const recente = periodos[0].effective_date;

    const certo = (await getRangeAnalysis(ctx.db, antiga, recente))!;
    const trocado = (await getRangeAnalysis(ctx.db, recente, antiga))!;

    expect(trocado.from).toBe(certo.from);
    expect(trocado.to).toBe(certo.to);
    expect(trocado.impact).toEqual(certo.impact);
    expect(trocado.totals).toEqual(certo.totals);
  });

  it("uma ponta que não existe no histórico cai no padrão, e não derruba a tela", async () => {
    const padrao = (await getRangeAnalysis(ctx.db))!;
    const inventada = (await getRangeAnalysis(ctx.db, "1999-01-01", "1999-02-01"))!;
    expect(inventada.from).toBe(padrao.from);
    expect(inventada.to).toBe(padrao.to);
  });
});

describe("as duas abas do cartão não se contradizem", () => {
  it("um intervalo de uma vigência só dá o que aquela vigência dá", async () => {
    const periodos = await listPeriods(ctx.db);
    const alvo = periodos[0].effective_date;

    const vigencia = (await getFamiliesView(ctx.db, alvo))!;
    const intervalo = (await getRangeAnalysis(ctx.db, alvo, alvo))!;

    expect(intervalo.totals.changes).toBe(vigencia.totals.changes);
    expect(intervalo.totals.vehiclesTouched).toBe(vigencia.totals.vehiclesTouched);
    expect(intervalo.impact.byPeriodicity).toEqual(vigencia.impact.byPeriodicity);
    expect(intervalo.impact.notCalculable).toBe(vigencia.impact.notCalculable);
  });

  it("o ranking do intervalo de uma vigência tem os mesmos grupos da vigência", async () => {
    const periodos = await listPeriods(ctx.db);
    const alvo = periodos[0].effective_date;

    const vigencia = (await getFamiliesView(ctx.db, alvo))!;
    const intervalo = (await getRangeAnalysis(ctx.db, alvo, alvo))!;

    expect(intervalo.entries).toHaveLength(vigencia.groups.length);
    const impactosDaVigencia = vigencia.groups
      .map((g) => g.impact.amount)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    const impactosDoIntervalo = intervalo.entries
      .map((e) => e.amount)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    expect(impactosDoIntervalo).toEqual(impactosDaVigencia);
  });
});

describe("perda e ganho nunca viram um número só", () => {
  it("balde a balde, perdas + ganhos reconstroem o líquido", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    for (const valor of Object.values(analise.lossesByPeriodicity)) {
      expect(valor).toBeLessThan(0);
    }
    for (const valor of Object.values(analise.gainsByPeriodicity)) {
      expect(valor).toBeGreaterThan(0);
    }

    const baldes = new Set([
      ...Object.keys(analise.lossesByPeriodicity),
      ...Object.keys(analise.gainsByPeriodicity),
      ...Object.keys(analise.impact.byPeriodicity),
    ]);
    for (const balde of baldes) {
      const perda = analise.lossesByPeriodicity[balde] ?? 0;
      const ganho = analise.gainsByPeriodicity[balde] ?? 0;
      const liquido = analise.impact.byPeriodicity[balde] ?? 0;
      expect(perda + ganho).toBeCloseTo(liquido, 2);
    }
  });
});

describe("nada some no caminho", () => {
  it("toda vigência do intervalo está num dos dois lados: lida ou nomeada", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const noIntervalo = periodos
      .map((p) => p.effective_date)
      .filter((d) => d >= analise.from && d <= analise.to)
      .sort();
    const cobertas = [
      ...analise.movements.map((m) => m.period),
      ...analise.gaps.map((g) => g.period),
    ].sort();

    expect(cobertas).toEqual(noIntervalo);
    // E nenhuma nos dois lados ao mesmo tempo.
    const lidas = new Set(analise.movements.map((m) => m.period));
    for (const gap of analise.gaps) expect(lidas.has(gap.period)).toBe(false);
  });

  it("nenhuma linha do ranking mistura duas vigências", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const comComparacao = new Set(analise.movements.map((m) => m.period));
    for (const entrada of analise.entries) {
      expect(entrada.key.startsWith(`${entrada.period}|`)).toBe(true);
      expect(comComparacao.has(entrada.period)).toBe(true);
    }
  });

  it("a soma das alterações por vigência fecha com o total do intervalo", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const soma = analise.movements.reduce((total, m) => total + m.changes, 0);
    expect(soma).toBe(analise.totals.changes);
  });
});
