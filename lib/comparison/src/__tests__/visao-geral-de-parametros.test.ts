import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { seedTaxonomy } from "@workspace/curation";
import { computeMissingChangeSets } from "../consolidated";
import { getFamiliesView } from "../families-view";
import { getFamiliesOverview } from "../families-view-overview";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * A tela de Parâmetros somada — o que a soma promete e o que ela se recusa.
 *
 * O defeito que este arquivo tranca é de navegação, e a causa era de dado:
 * escolher "Visão Geral" estando em Parâmetros **trocava de tela**, porque a
 * Visão Geral não tinha a árvore que aquela tela desenha. Agora tem, e a régua
 * é a mesma do resto do produto — que é mais estrita do que "somar tudo":
 *
 * - alterações somam;
 * - veículos **não** somam: são a união dos ativos, e o mesmo caminhão em duas
 *   unidades conta uma vez;
 * - impacto soma dentro de cada periodicidade, nunca entre elas;
 * - o que é leitura das linhas (o par dominante) não atravessa a soma, e o
 *   detalhe abre por unidade em vez de inventar um par que nunca existiu.
 *
 * O elenco: duas unidades que mexem no **mesmo** atributo (para haver o que
 * somar), uma delas com uma carreta a mais, e um veículo com a mesma placa nas
 * duas — que é o que separa "somar contagens" de "unir conjuntos".
 */

let ctx: TestDb;

const JULHO = "2026-07-02";
const AGOSTO = "2026-08-02";

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
  ctx = await createTestDatabase("visao_geral_de_parametros");
  await seedTaxonomy(ctx.db, "test");

  /*
    PERNAMBUCO: duas carretas mexem no custo fixo. Uma delas — PPP0001 — é a
    placa que também existe em CAMAÇARI, e é ela que prova a união: somar as
    contagens daria três veículos onde existem dois.
  */
  const pernambuco = await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: {
          PPP0001: { "carreta.custo_fixo": 1000 },
          PPP0002: { "carreta.custo_fixo": 2000 },
        },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: {
          PPP0001: { "carreta.custo_fixo": 1100 },
          PPP0002: { "carreta.custo_fixo": 2300 },
        },
      },
    ],
    { entityType: "CARRETA", scopeHash: "vgp-pernambuco", canal: "EMPURRADA" },
  );
  await anexarEscopo(ctx.db, Object.values(pernambuco.snapshotIds), [
    { scopeType: "UNIDADE", code: "vgp-pernambuco" },
  ]);

  const camacari = await buildFixture(
    ctx.db,
    CUSTO,
    [
      {
        label: "EMPURRADA_2_7_2026",
        effectiveDate: JULHO,
        data: { PPP0001: { "carreta.custo_fixo": 700 } },
      },
      {
        label: "EMPURRADA_2_8_2026",
        effectiveDate: AGOSTO,
        data: { PPP0001: { "carreta.custo_fixo": 900 } },
      },
    ],
    { entityType: "CARRETA", scopeHash: "vgp-camacari", canal: "EMPURRADA" },
  );
  await anexarEscopo(ctx.db, Object.values(camacari.snapshotIds), [
    { scopeType: "UNIDADE", code: "vgp-camacari" },
  ]);

  await computeMissingChangeSets(ctx.db, "test");
}, 180_000);

afterAll(async () => {
  await ctx?.drop();
});

const soma = async () => {
  const overview = await getFamiliesOverview(ctx.db, AGOSTO, { comParametros: true });
  expect(overview).not.toBeNull();
  expect(overview!.parametros).not.toBeNull();
  return overview!.parametros!;
};

const unidade = (scopeHash: string) =>
  getFamiliesView(ctx.db, AGOSTO, { scopeHash, channel: "EMPURRADA" });

describe("a tela de Parâmetros somada", () => {
  /*
    O requisito de origem: a tela consome uma `FamiliesView`, e a soma tem de
    ser uma. Se este teste cair, não é um número que muda — é a tela inteira que
    volta a não ter o que desenhar, e o seletor volta a expulsar quem escolhe.
  */
  it("devolve a mesma forma que a tela lê dentro de uma unidade", async () => {
    const view = await soma();

    expect(view.families.length).toBeGreaterThan(0);
    expect(view.groups.length).toBeGreaterThan(0);
    expect(view.summary).toBeDefined();
    expect(view.freightechSemDado.length).toBeGreaterThan(0);
    // A árvore fecha com a lista: todo grupo mora num parâmetro de uma família.
    const naArvore = view.families.flatMap((f) => f.parameters.flatMap((p) => p.groups));
    expect(naArvore.map((g) => g.key).sort()).toEqual(view.groups.map((g) => g.key).sort());
  });

  it("anuncia quem entrou na soma, com o recorte de cada um", async () => {
    const view = await soma();

    expect(view.visaoGeral.unidades).toBe(2);
    expect(view.visaoGeral.contextos.map((c) => c.scopeHash).sort()).toEqual([
      "vgp-camacari",
      "vgp-pernambuco",
    ]);
    // Sem unidade aberta: `scopeHash` vazio é a afirmação de que não há uma.
    expect(view.context.scopeHash).toBe("");
  });

  it("soma as alterações das unidades", async () => {
    const view = await soma();
    const pernambuco = (await unidade("vgp-pernambuco"))!;
    const camacari = (await unidade("vgp-camacari"))!;

    expect(view.totals.changes).toBe(pernambuco.totals.changes + camacari.totals.changes);
  });

  /*
    A recusa que dá nome ao módulo. PPP0001 mexeu nas duas unidades; somar as
    contagens diria três veículos, e existem dois — `entity.id` é global e
    casado por placa, então a união é deduplicação de verdade.
  */
  it("une os veículos em vez de somá-los", async () => {
    const view = await soma();
    const pernambuco = (await unidade("vgp-pernambuco"))!;
    const camacari = (await unidade("vgp-camacari"))!;
    const soma_ = pernambuco.totals.vehiclesTouched + camacari.totals.vehiclesTouched;

    expect(view.totals.vehiclesTouched).toBeLessThan(soma_);
    expect(view.totals.vehiclesTouched).toBe(view.entityIdsTouched.length);
    expect(new Set(view.entityIdsTouched).size).toBe(view.entityIdsTouched.length);
  });

  it("soma o impacto dentro da periodicidade, e o atributo comum vira um cartão só", async () => {
    const view = await soma();
    const pernambuco = (await unidade("vgp-pernambuco"))!;
    const camacari = (await unidade("vgp-camacari"))!;

    const custo = view.groups.find((g) => g.attributeCode === "carreta.custo_fixo");
    expect(custo).toBeDefined();
    // Um cartão, não dois: as duas unidades mexeram no mesmo ponto.
    expect(view.groups.filter((g) => g.attributeCode === "carreta.custo_fixo")).toHaveLength(1);

    const daUnidade = (v: typeof pernambuco) =>
      v.groups.find((g) => g.attributeCode === "carreta.custo_fixo")!;
    const esperado =
      (daUnidade(pernambuco).impact.amount ?? 0) + (daUnidade(camacari).impact.amount ?? 0);

    expect(custo!.impact.periodicity).toBe("MENSAL");
    expect(custo!.impact.amount).toBeCloseTo(esperado, 2);
    expect(custo!.changes).toBe(daUnidade(pernambuco).changes + daUnidade(camacari).changes);
  });

  /*
    O caminho até a evidência não pode morrer na soma: os veículos, a série e a
    célula da planilha são leituras dentro de um contexto, e é `porUnidade` que
    a tela percorre para abrir cada uma no recorte certo.
  */
  it("preserva de qual unidade veio cada pedaço do cartão", async () => {
    const view = await soma();
    const custo = view.groups.find((g) => g.attributeCode === "carreta.custo_fixo")!;

    expect(custo.porUnidade).toHaveLength(2);
    expect(custo.porUnidade.map((o) => o.scopeHash).sort()).toEqual([
      "vgp-camacari",
      "vgp-pernambuco",
    ]);
    for (const origem of custo.porUnidade) {
      expect(origem.group.attributeCode).toBe("carreta.custo_fixo");
      expect(origem.label).toBeTruthy();
    }
    // A soma das partes é o todo — a mesma conta que a tela mostra no cabeçalho.
    expect(custo.porUnidade.reduce((s, o) => s + o.group.changes, 0)).toBe(custo.changes);
  });

  /*
    O par "antes → depois" de duas unidades não é um par. 1000→1100 em
    PERNAMBUCO e 700→900 em CAMAÇARI não somam em transição nenhuma, e publicar
    um dominante escolhido entre os dois seria afirmar um movimento que não
    aconteceu em lugar nenhum.
  */
  it("não inventa um par dominante entre unidades", async () => {
    const view = await soma();
    const custo = view.groups.find((g) => g.attributeCode === "carreta.custo_fixo")!;

    expect(custo.dominantPattern).toBeNull();
    expect(custo.patterns).toBe(0);
    // E o que cada unidade viu continua inteiro, do lado: o par que ela leu é
    // dela, e é lá que quem audita vai buscá-lo.
    for (const origem of custo.porUnidade) {
      expect(origem.group.patterns).toBeGreaterThan(0);
    }
  });

  it("soma a frota das séries e recompõe a cobertura sobre ela", async () => {
    const view = await soma();
    const pernambuco = (await unidade("vgp-pernambuco"))!;
    const camacari = (await unidade("vgp-camacari"))!;
    const custo = view.groups.find((g) => g.attributeCode === "carreta.custo_fixo")!;
    const frotaEsperada =
      pernambuco.groups.find((g) => g.attributeCode === "carreta.custo_fixo")!.fleet +
      camacari.groups.find((g) => g.attributeCode === "carreta.custo_fixo")!.fleet;

    expect(custo.fleet).toBe(frotaEsperada);
    expect(custo.coverageLabel).toContain(`de ${frotaEsperada}`);
  });

  /*
    O pedaço guardado é o grupo **como aquela unidade o leu** — nada de
    reescrita no caminho. É o que garante que abrir o detalhe pela soma e abrir
    a mesma unidade pela lateral mostrem o mesmo cartão, com os mesmos números.
  */
  it("guarda o grupo de cada unidade sem reescrevê-lo", async () => {
    const view = await soma();
    const custo = view.groups.find((g) => g.attributeCode === "carreta.custo_fixo")!;
    const camacari = (await unidade("vgp-camacari"))!;

    expect(custo.porUnidade.find((o) => o.scopeHash === "vgp-camacari")!.group).toEqual(
      camacari.groups.find((g) => g.attributeCode === "carreta.custo_fixo"),
    );
  });

  it("o resumo executivo da tela é o mesmo da Visão Geral", async () => {
    const overview = await getFamiliesOverview(ctx.db, AGOSTO, { comParametros: true });

    expect(overview!.parametros!.summary).toEqual(overview!.summary);
  });

  /*
    O corpo da resposta não cresce para quem não desenha a árvore.

    Quatro telas leem esta rota e nenhuma delas usa `parametros`; mandá-lo
    sempre dobraria o corpo de todas elas. `null` aqui é "ninguém pediu", e a
    tela que pede escreve `parametros=1` — o que também a obriga a ter chave de
    cache própria, ou leria do cache a resposta magra de outra tela.
  */
  it("não monta a árvore para quem não pediu", async () => {
    const overview = await getFamiliesOverview(ctx.db, AGOSTO);

    expect(overview!.parametros).toBeNull();
    expect(overview!.consolidado.families.length).toBeGreaterThan(0);
  });
});
