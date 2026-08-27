import { afterAll, beforeAll, expect, it } from "vitest";
import { setImportRunHidden } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { sql } from "drizzle-orm";
import { computeChangeSet } from "../engine";
import { contagemPorTipo } from "../query";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * O que cada comparação tem, por tipo de ativo.
 *
 * É a leitura por trás do seletor de vigência do Plano de Ação, que passou a
 * viver **dentro** da aba de Cavalo, Carreta ou Trecho. A série de uma
 * comparação é `(escopo, entity_type_set)`, então a mesma unidade na mesma data
 * produz uma comparação de equipamento e outra de trecho — duas linhas
 * idênticas no seletor único, sem nada que dissesse qual tinha o que a aba
 * mostra. O que este teste fixa é o que desfaz o empate: a contagem sai do
 * tipo da **linha alterada**, conta placas distintas e alterações separadas, e
 * uma importação ocultada sai das duas.
 */

let ctx: TestDb;

/*
  O tipo da alteração é o do **atributo** — `attribute.entity_type`, que sai do
  prefixo do código da coluna —, e não o da vigência: é assim que a comparação
  o grava (ver `carregarClassificacoes`, em `classification.ts`), e é esse
  mesmo campo que as abas do Plano de Ação já leem de cada linha. Por isso cada
  tipo aqui traz as colunas dele.
*/
const atributosDe = (tipo: string): AttributeSpec[] => [
  {
    code: `${tipo.toLowerCase()}.valor_a`,
    dataType: "NUMERIC",
    semanticsStatus: "PRESUMED",
  },
  {
    code: `${tipo.toLowerCase()}.valor_b`,
    dataType: "NUMERIC",
    semanticsStatus: "PRESUMED",
  },
];

beforeAll(async () => {
  ctx = await createTestDatabase("contagem_por_tipo");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

/** Duas vigências de um tipo, comparadas — devolve o `change_set`. */
async function comparar(
  entityType: string,
  antes: Record<string, Record<string, number>>,
  depois: Record<string, Record<string, number>>,
): Promise<string> {
  const marca = `${entityType}-${Math.random()}`;
  const { snapshotIds } = await buildFixture(
    ctx.db,
    atributosDe(entityType),
    [
      { label: `A-${marca}`, effectiveDate: "2026-07-01", data: antes },
      { label: `B-${marca}`, effectiveDate: "2026-08-01", data: depois },
    ],
    { entityType },
  );
  const [a, b] = Object.values(snapshotIds);
  const set = await computeChangeSet(ctx.db, a, b, { force: true });
  return set.id;
}

it("conta placas e alterações de cada tipo, por comparação", async () => {
  // Equipamento: dois cavalos, um deles com duas colunas mexidas.
  const equipamento = await comparar(
    "CAVALO",
    {
      AAA1A11: { "cavalo.valor_a": 100, "cavalo.valor_b": 10 },
      BBB2B22: { "cavalo.valor_a": 200, "cavalo.valor_b": 20 },
    },
    {
      AAA1A11: { "cavalo.valor_a": 111, "cavalo.valor_b": 11 },
      BBB2B22: { "cavalo.valor_a": 222, "cavalo.valor_b": 20 },
    },
  );
  // Trecho: a outra série, na mesma casa e sem cavalo nenhum.
  const trecho = await comparar(
    "TRECHO",
    { CDBELEMCDRJOAOPESSOA28FALSE: { "trecho.valor_a": 1 } },
    { CDBELEMCDRJOAOPESSOA28FALSE: { "trecho.valor_a": 2 } },
  );

  const contagens = await contagemPorTipo(ctx.db, [equipamento, trecho]);
  const doTipo = (changeSetId: string, entityType: string) =>
    contagens.find(
      (c) => c.changeSetId === changeSetId && c.entityType === entityType,
    );

  // Duas placas mexeram, e três colunas ao todo — a placa é o card, a coluna é
  // a alteração, e o seletor mostra uma de cada lado.
  expect(doTipo(equipamento, "CAVALO")).toEqual({
    changeSetId: equipamento,
    entityType: "CAVALO",
    placas: 2,
    alteracoes: 3,
  });

  // A comparação de equipamento não tem trecho, e é isso que tira a linha dela
  // do seletor da aba Trecho — que sozinho a listaria com a mesma data e a
  // mesma unidade da outra.
  expect(doTipo(equipamento, "TRECHO")).toBeUndefined();
  expect(doTipo(trecho, "TRECHO")?.placas).toBe(1);
  expect(doTipo(trecho, "CAVALO")).toBeUndefined();
});

it("para de contar o que veio de uma importação ocultada", async () => {
  const changeSetId = await comparar(
    "CARRETA",
    { CCC3C33: { "carreta.valor_a": 300 } },
    { CCC3C33: { "carreta.valor_a": 333 } },
  );
  expect((await contagemPorTipo(ctx.db, [changeSetId]))[0].placas).toBe(1);

  const { rows } = await ctx.db.execute<{ import_run_id: string }>(sql`
    SELECT sb.import_run_id
      FROM change_set cs JOIN snapshot sb ON sb.id = cs.snapshot_b_id
     WHERE cs.id = ${changeSetId}::uuid
  `);
  await setImportRunHidden(ctx.db, rows[0].import_run_id, true, {
    by: "teste@teste.com",
    reason: "a aba não pode contar placa que a lista não mostra",
  });

  expect(await contagemPorTipo(ctx.db, [changeSetId])).toEqual([]);
});

it("não vai ao banco quando não há comparação para contar", async () => {
  expect(await contagemPorTipo(ctx.db, [])).toEqual([]);
});
