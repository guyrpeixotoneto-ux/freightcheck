import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { getGroupedView, getGroupVehicles } from "../grouped";
import { getChangeProvenance } from "../query";
import { buildFixture, contextoDaUnidade, type AttributeSpec } from "./fixtures";

/**
 * De qual vigência é o lado "Antes".
 *
 * A tabela de veículos escreve `Antes` e `Agora` acima de dois números, e por
 * muito tempo não disse de quando cada um era. Quem lia `0 → 2,19` a dez linhas
 * de rolagem do cabeçalho da página tinha de lembrar contra o que aquela
 * vigência havia sido comparada — e a lembrança mais fácil, "o mês anterior",
 * é justamente a que o motor **não** promete.
 *
 * O que ele promete está em `findPreviousSnapshot`: cada série compara contra a
 * última entrega *dela*. Disso saem os três casos deste arquivo, e os três são
 * o mesmo teste feito de ângulos diferentes — o rótulo tem de vir do snapshot,
 * nunca de uma conta sobre o calendário:
 *
 * 1. **Mês consecutivo.** O caso fácil, e o único que uma subtração acertaria.
 * 2. **Salto de vigência.** A série pulou setembro: outubro compara contra
 *    agosto. Subtrair um mês escreveria "setembro" num lado que ninguém
 *    entregou.
 * 3. **Cavalo e carreta divergindo.** Na mesma vigência, com anteriores
 *    diferentes. É o caso que proíbe a alternativa mais barata — um rótulo só,
 *    no cabeçalho da página, servindo a tabela inteira.
 */

let ctx: TestDb;
const UNIDADE = "vigencia-antes";
/** Um canal só: cavalo e carreta são duas entregas do mesmo contexto. */
const CANAL = "EMPURRADA";
/**
 * A chave do escopo, lida do banco depois que os fixtures entram.
 *
 * Não é um literal porque não é um literal na produção: quem calcula a chave é
 * o banco, a partir do escopo canônico. Escrevê-la aqui à mão seria uma segunda
 * definição de identidade morando num arquivo de teste.
 */
let escopo: string;

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

beforeAll(async () => {
  ctx = await createTestDatabase("vigencia_antes");
  await seedTaxonomy(ctx.db, "test");

  // Cavalos: julho, agosto e outubro. Setembro nunca chegou.
  await buildFixture(
    ctx.db,
    CAVALO,
    [
      { label: "CAV_JUL", effectiveDate: "2026-07-01", data: { RPG1B56: { "cavalo.custo_fixo": 1000 } } },
      { label: "CAV_AGO", effectiveDate: "2026-08-01", data: { RPG1B56: { "cavalo.custo_fixo": 1100 } } },
      { label: "CAV_OUT", effectiveDate: "2026-10-01", data: { RPG1B56: { "cavalo.custo_fixo": 1200 } } },
    ],
    /*
      Mesmo escopo e mesmo canal das carretas, e família própria.

      É o que permite as duas entregas dividirem o **contexto** — que é o que
      esta suíte precisa: uma visão que mostre cavalo e carreta lado a lado, cada
      um com a sua própria vigência anterior. Sem a família, as duas colidiriam
      na identidade canônica, porque escopo, canal e data seriam os mesmos.
    */
    { entityType: "CAVALO", unidade: UNIDADE, canal: CANAL, datasetFamily: "REMUNERACAO_CAVALO" },
  );

  // Carretas: agosto, setembro e outubro — a série completa.
  await buildFixture(
    ctx.db,
    CARRETA,
    [
      { label: "CAR_AGO", effectiveDate: "2026-08-01", data: { QQQ7X70: { "carreta.custo_fixo": 500 } } },
      { label: "CAR_SET", effectiveDate: "2026-09-01", data: { QQQ7X70: { "carreta.custo_fixo": 540 } } },
      { label: "CAR_OUT", effectiveDate: "2026-10-01", data: { QQQ7X70: { "carreta.custo_fixo": 560 } } },
    ],
    { entityType: "CARRETA", unidade: UNIDADE, canal: CANAL, datasetFamily: "REMUNERACAO_CARRETA" },
  );

  escopo = (await contextoDaUnidade(ctx.db, UNIDADE, CANAL)).scopeHash;

  await computeMissingChangeSets(ctx.db, "test:vigencia-antes");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

const veiculos = (period: string, attributeCode: string, entityType: string) =>
  getGroupVehicles(ctx.db, {
    period,
    attributeCode,
    entityType,
    scopeHash: escopo,
    channel: CANAL,
  });

describe("mês consecutivo", () => {
  it("o Antes de agosto é julho, na série e na linha", async () => {
    const view = (await getGroupedView(ctx.db, "2026-08-01", {
      scopeHash: escopo,
      channel: CANAL,
    }))!;
    const cavalo = view.series.find((s) => s.entityTypeSet === "CAVALO")!;
    expect(cavalo.previousPeriod).toBe("2026-07-01");
    expect(cavalo.previousPeriodLabel).toBe("julho/2026");

    const linhas = await veiculos("2026-08-01", "cavalo.custo_fixo", "CAVALO");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].periodBeforeLabel).toBe("julho/2026");
    expect(linhas[0].periodAfterLabel).toBe("agosto/2026");
    // A prova de que os dois lados do rótulo são os dois lados do número.
    expect(linhas[0].numericBefore).toBe(1000);
    expect(linhas[0].numericAfter).toBe(1100);
  });
});

describe("salto de vigência", () => {
  it("o Antes de outubro é agosto, e não o setembro que a série não entregou", async () => {
    const view = (await getGroupedView(ctx.db, "2026-10-01", {
      scopeHash: escopo,
      channel: CANAL,
    }))!;
    const cavalo = view.series.find((s) => s.entityTypeSet === "CAVALO")!;
    expect(cavalo.previousPeriod).toBe("2026-08-01");
    expect(cavalo.previousPeriodLabel).toBe("agosto/2026");
    expect(cavalo.previousPeriodLabel).not.toBe("setembro/2026");

    const linhas = await veiculos("2026-10-01", "cavalo.custo_fixo", "CAVALO");
    expect(linhas).toHaveLength(1);
    expect(linhas[0].periodBeforeLabel).toBe("agosto/2026");
    expect(linhas[0].periodAfterLabel).toBe("outubro/2026");
    // Setembro existe no banco — só não nesta série. É o que torna o salto uma
    // armadilha de verdade: há um "mês anterior" para um rótulo errado citar.
    expect(view.periods.map((p) => p.date)).toContain("2026-09-01");
  });

  it("o valor comparado é o da última entrega da série, não o do mês vizinho", async () => {
    const linhas = await veiculos("2026-10-01", "cavalo.custo_fixo", "CAVALO");
    // 1100 é agosto. Setembro do cavalo não existe, e a carreta daquele mês
    // (540) não pertence a esta série.
    expect(linhas[0].numericBefore).toBe(1100);
    expect(linhas[0].numericAfter).toBe(1200);
  });
});

describe("cavalo e carreta na mesma vigência", () => {
  it("cada série leva a sua própria vigência anterior", async () => {
    const view = (await getGroupedView(ctx.db, "2026-10-01", {
      scopeHash: escopo,
      channel: CANAL,
    }))!;
    const porEquipamento = new Map(
      view.series.map((s) => [s.entityTypeSet, s.previousPeriodLabel]),
    );
    expect(porEquipamento.get("CAVALO")).toBe("agosto/2026");
    expect(porEquipamento.get("CARRETA")).toBe("setembro/2026");
  });

  it("as tabelas de veículos divergem no Antes e concordam no Agora", async () => {
    const cavalo = await veiculos("2026-10-01", "cavalo.custo_fixo", "CAVALO");
    const carreta = await veiculos("2026-10-01", "carreta.custo_fixo", "CARRETA");

    expect(cavalo[0].periodBeforeLabel).toBe("agosto/2026");
    expect(carreta[0].periodBeforeLabel).toBe("setembro/2026");
    expect(cavalo[0].periodAfterLabel).toBe("outubro/2026");
    expect(carreta[0].periodAfterLabel).toBe("outubro/2026");

    // Um rótulo único para a vigência inteira teria de mentir para um dos dois.
    expect(cavalo[0].periodBefore).not.toBe(carreta[0].periodBefore);
  });
});

describe("proveniência", () => {
  it("traz a vigência de cada lado junto do rótulo da entrega", async () => {
    const linhas = await veiculos("2026-10-01", "cavalo.custo_fixo", "CAVALO");
    const origem = (await getChangeProvenance(ctx.db, linhas[0].changeId))!;

    expect(origem.snapshot_before).toBe("CAV_AGO");
    expect(origem.snapshot_after).toBe("CAV_OUT");
    // O rótulo da entrega identifica o arquivo e não diz de quando ele é; a
    // data ao lado é o que essa tela passou a responder.
    expect(origem.period_before).toBe("2026-08-01");
    expect(origem.period_after).toBe("2026-10-01");
    expect(origem.period_before_label).toBe("agosto/2026");
    expect(origem.period_after_label).toBe("outubro/2026");
  });
});

describe("primeira vigência de uma série", () => {
  it("não tem anterior, e diz isso em vez de supor uma", async () => {
    // Agosto é a primeira entrega da carreta: não há com que comparar.
    const view = (await getGroupedView(ctx.db, "2026-08-01", {
      scopeHash: escopo,
      channel: CANAL,
    }))!;
    const carreta = view.series.find((s) => s.entityTypeSet === "CARRETA")!;
    expect(carreta.previousPeriod).toBeNull();
    expect(carreta.previousPeriodLabel).toBeNull();
    expect(carreta.reason).toMatch(/não há anterior/i);
  });
});
