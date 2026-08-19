import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDb } from "@workspace/ingest/testing";
import { criarBancoComModelosCurados } from "../testing";
import { listPeriods } from "../consolidated";
import { getGroupedView } from "../grouped";
import { getRangeAnalysis } from "../families-view";
import { getEndToEndAnalysis } from "../end-to-end";

/**
 * A frota de um grupo — a mesma nas três leituras que a publicam.
 *
 * **O defeito que este teste fecha.** `buildGroup` procura a frota por
 * (comparação, equipamento). `getGroupedView` montava o índice com essa chave;
 * `getFamiliesView` montava-o só com a comparação e `getEndToEndAnalysis` só
 * com a série. Nas duas últimas a busca errava sempre, caía no `?? 0`, e o
 * `Math.max(..., vehicles)` logo abaixo devolvia `vehicles` — a frota do grupo
 * passava a ser o próprio grupo.
 *
 * O estrago não era uma excepção: era um número plausível em toda linha. A
 * razão `vehicles / fleet` dava 1, a cobertura de **todo** grupo virava `TOTAL`,
 * e `coverageLabel` publicava "Toda a frota · N de N" sobre um grupo que tinha
 * pegado doze de setenta e um ativos. Nada falhava, nada avisava, e a tela
 * afirmava abrangência total onde havia uma minoria.
 *
 * Daí a forma dos testes abaixo. Não basta comparar as três leituras entre si —
 * antes da correcção elas concordariam em `fleet === vehicles` sempre que o
 * grupo pegasse a frota inteira. O que prende a correcção é a asserção de que
 * **existe** grupo com frota maior do que o número de ativos dele, que é
 * exactamente o que o defeito tornava impossível.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await criarBancoComModelosCurados("frota_do_grupo");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

/** A chave que identifica o mesmo grupo em leituras diferentes. */
const chave = (g: { attributeCode: string | null; entityType: string | null }) =>
  `${g.attributeCode}|${g.entityType}`;

describe("a frota do grupo", () => {
  it("no ponta a ponta é a do equipamento, e não a do próprio grupo", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getEndToEndAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const grupos = analise.entries.map((e) => e.group);
    expect(grupos.length).toBeGreaterThan(0);

    // Nenhuma frota abaixo dos ativos do grupo: seria contradição aritmética.
    for (const g of grupos) expect(g.fleet).toBeGreaterThanOrEqual(g.vehicles);

    /*
      A asserção que prende a correcção. Com o índice partido, `fleet` era
      sempre `vehicles` e esta lista saía vazia — sem que nenhum teste falhasse.
    */
    const parciais = grupos.filter((g) => g.fleet > g.vehicles);
    expect(parciais.length).toBeGreaterThan(0);
    expect(parciais.some((g) => g.coverage !== "TOTAL")).toBe(true);
  });

  it("no intervalo é a do equipamento, e não a da vigência inteira", async () => {
    const periodos = await listPeriods(ctx.db);
    const analise = (await getRangeAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    const grupos = analise.entries.map((e) => e.group);
    expect(grupos.length).toBeGreaterThan(0);
    for (const g of grupos) expect(g.fleet).toBeGreaterThanOrEqual(g.vehicles);
    expect(grupos.filter((g) => g.fleet > g.vehicles).length).toBeGreaterThan(0);
  });

  it("é a mesma nas três leituras, para a mesma comparação", async () => {
    const periodos = await listPeriods(ctx.db);
    const alvo = periodos[0].effective_date;
    const anterior = periodos[1].effective_date;

    const canonica = (await getGroupedView(ctx.db, alvo))!;
    const intervalo = (await getRangeAnalysis(ctx.db, anterior, alvo))!;
    const pontas = (await getEndToEndAnalysis(ctx.db, anterior, alvo))!;

    /*
      `getGroupedView` é a referência: era a única que montava a chave certa, e
      continua a ser a leitura que a vigência aberta publica. As outras duas
      leem os mesmos dois snapshots e têm de dizer a mesma frota — quando a
      comparação é de um par só, "o intervalo" e "as pontas" são a mesma coisa.
    */
    const referencia = new Map(canonica.groups.map((g) => [chave(g), g.fleet]));
    expect(referencia.size).toBeGreaterThan(0);

    let conferidos = 0;
    for (const leitura of [intervalo.entries, pontas.entries]) {
      for (const entrada of leitura) {
        const esperada = referencia.get(chave(entrada.group));
        if (esperada === undefined) continue;
        expect(entrada.group.fleet).toBe(esperada);
        conferidos++;
      }
    }
    expect(conferidos).toBeGreaterThan(0);
  });

  it("a frota de cavalo não inclui as carretas da mesma vigência", async () => {
    const periodos = await listPeriods(ctx.db);
    const pontas = (await getEndToEndAnalysis(
      ctx.db,
      periodos[periodos.length - 1].effective_date,
      periodos[0].effective_date,
    ))!;

    /*
      A vigência real é `CARRETA+CAVALO`, e `snapshot.entity_count` conta as
      duas. Era esse número que o ponta a ponta indexava. Aqui exige-se o
      contrário: dentro de um tipo, a frota é uma só, e ela é menor do que a
      soma dos tipos — que é o que `entity_count` teria devolvido.
    */
    const porTipo = new Map<string, Set<number>>();
    for (const { group } of pontas.entries) {
      if (group.entityType === null) continue;
      const frotas = porTipo.get(group.entityType) ?? new Set<number>();
      frotas.add(group.fleet);
      porTipo.set(group.entityType, frotas);
    }

    expect(porTipo.size).toBeGreaterThan(1);
    for (const frotas of porTipo.values()) expect(frotas.size).toBe(1);

    const soma = [...porTipo.values()].reduce((t, f) => t + [...f][0], 0);
    for (const frotas of porTipo.values()) expect([...frotas][0]).toBeLessThan(soma);
  });
});
