import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { attributeTable, changeTable } from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { saveMeaning, seedTaxonomy } from "@workspace/curation";
import { computeChangeSet } from "../engine";
import { getChangeSetBreakdown, listChanges } from "../query";
import { buildFixture, type AttributeSpec } from "./fixtures";

/**
 * O nome gerencial na tela de Alterações.
 *
 * O apelido é dado *depois* de a comparação ter rodado — é o caso normal, e não
 * a exceção: alguém lê a lista, não entende a coluna, e batiza. `change` guarda
 * o nome que valia no dia em que comparou, então servir essa cópia crua deixava
 * a tela dizendo `combustivelVidaCavalo` no painel "Atributos mais alterados"
 * enquanto a curadoria ao lado já dizia o apelido — o mesmo atributo, com dois
 * nomes, em duas telas do mesmo produto.
 *
 * O que estes testes prendem: a lista e os painéis leem o atributo como ele
 * está hoje, e a cópia denormalizada continua onde está, intacta, porque é ela
 * que conta o que a comparação viu.
 */

let ctx: TestDb;

const CODE = "cavalo.combustivel_vida_cavalo";
/** O literal da planilha, que nunca é reescrito. */
const LITERAL = "combustivelVidaCavalo";

const ATTRIBUTES: AttributeSpec[] = [{ code: CODE, dataType: "NUMERIC" }];

let changeSetId: string;

beforeAll(async () => {
  ctx = await createTestDatabase("nome_gerencial");
  await seedTaxonomy(ctx.db, "test");

  const { snapshotIds } = await buildFixture(
    ctx.db,
    ATTRIBUTES,
    [
      { label: "jan", effectiveDate: "2026-01-01", data: { AAA1A11: { [CODE]: 100 } } },
      { label: "fev", effectiveDate: "2026-02-01", data: { AAA1A11: { [CODE]: 120 } } },
    ],
    { entityType: "CAVALO" },
  );

  /*
    O estado de antes da curadoria: o atributo tem só o literal da planilha, que
    é o que a fixture teria criado se a importação o tivesse acabado de ver.
  */
  await ctx.db
    .update(attributeTable)
    .set({ sourceName: LITERAL, displayName: null })
    .where(eq(attributeTable.code, CODE));

  const set = await computeChangeSet(ctx.db, snapshotIds.jan, snapshotIds.fev, {
    force: true,
  });
  changeSetId = set.id;
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

async function nomes() {
  const [{ rows }, breakdown] = await Promise.all([
    listChanges(ctx.db, changeSetId, { limit: 10 }),
    getChangeSetBreakdown(ctx.db, changeSetId),
  ]);
  return {
    naLista: rows.map((r) => r.attributeName),
    noPainel: breakdown.byAttribute.map((a) => a.attributeName),
  };
}

describe("antes de qualquer curadoria", () => {
  it("mostra o vocabulário do produto, e não o literal da planilha", async () => {
    const { naLista, noPainel } = await nomes();

    // `labels.ts` conhece este código; o slug da planilha nunca chega à tela.
    expect(naLista).toEqual(["Vida do combustível"]);
    expect(noPainel).toEqual(["Vida do combustível"]);
  });
});

describe("depois de a curadoria dar um nome gerencial", () => {
  beforeAll(async () => {
    await saveMeaning(ctx.db, {
      code: CODE,
      displayName: "Consumo de Combustível",
      actor: "curador@test",
    });
  });

  it("a lista e os painéis passam a chamá-lo pelo nome dado", async () => {
    const { naLista, noPainel } = await nomes();

    // Sem recalcular comparação nenhuma: batizar não é motivo para refazer
    // conta, e esperar o próximo cálculo seria o mesmo que não aparecer.
    expect(naLista).toEqual(["Consumo de Combustível"]);
    expect(noPainel).toEqual(["Consumo de Combustível"]);
  });

  it("a busca encontra pelo nome dado, e continua encontrando pelo literal", async () => {
    const pelo = async (search: string) =>
      (await listChanges(ctx.db, changeSetId, { search, limit: 10 })).total;

    expect(await pelo("Consumo de Comb")).toBe(1);
    expect(await pelo(LITERAL)).toBe(1);
    expect(await pelo("carreta")).toBe(0);
  });

  it("não reescreve o que a comparação registrou", async () => {
    const rows = await ctx.db
      .select({ attributeName: changeTable.attributeName })
      .from(changeTable)
      .where(eq(changeTable.changeSetId, changeSetId));

    /*
      A cópia denormalizada é prova do que a comparação viu naquele dia, e um
      apelido dado meses depois não pode reescrever o passado. Ela sai da tela,
      não do banco — e continua servindo à busca e à proveniência.
    */
    expect(rows.map((r) => r.attributeName)).toEqual([LITERAL]);
  });
});
