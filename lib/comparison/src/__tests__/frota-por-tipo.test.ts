import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { computeChangeSet } from "../engine";
import { frotaPorTipo } from "../query";
import { buildFixture, type AttributeSpec } from "../testing";

/**
 * A FROTA DE CADA TIPO — O DENOMINADOR DAS ABAS CAVALO E CARRETA.
 *
 * As quatro auditorias de grão equipamento passaram a abrir por tipo, e o
 * cartão "Veículos comparados" tinha de abrir junto. O que este arquivo prende
 * é a única coisa difícil daquela conta: ela **não sai da lista de
 * alterações**. Um veículo em que nada mudou não produz linha nenhuma, e uma
 * aba que contasse a lista diria "0 comparados" sobre uma frota inteira parada
 * — que é justamente a comparação em que o número mais importa.
 *
 * E prende a segunda: a régua tem de ser a mesma do total que a tela já
 * publica. `frotaDoPar`, nas rotas, faz `entity_count − entitiesAdded`; aqui a
 * mesma subtração acontece por tipo, sobre `snapshot_entity_type.entity_count`
 * e sobre as linhas `FLEET_CHANGE` agrupadas. Duas contagens da mesma frota que
 * fecham diferente valem menos que nenhuma.
 */

let ctx: TestDb;

const atributosDe = (tipo: string): AttributeSpec[] => [
  {
    code: `${tipo.toLowerCase()}.valor_a`,
    dataType: "NUMERIC",
    semanticsStatus: "PRESUMED",
  },
];

beforeAll(async () => {
  ctx = await createTestDatabase("frota_por_tipo");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

/** Duas vigências de um tipo, comparadas — devolve o par e o `change_set`. */
async function comparar(
  entityType: string,
  antes: Record<string, Record<string, number>>,
  depois: Record<string, Record<string, number>>,
) {
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
  const resumo = await computeChangeSet(ctx.db, a!, b!, { force: true });
  return { resumo, comparada: b! };
}

describe("a frota de um tipo, no par", () => {
  const coluna = "cavalo.valor_a";

  it("conta os presentes nas duas pontas, os que entraram e os que saíram", async () => {
    const { resumo, comparada } = await comparar(
      "CAVALO",
      {
        AAA1: { [coluna]: 10 },
        BBB2: { [coluna]: 20 },
        CCC3: { [coluna]: 30 },
      },
      {
        AAA1: { [coluna]: 11 },
        BBB2: { [coluna]: 20 },
        DDD4: { [coluna]: 40 },
      },
    );

    const frota = await frotaPorTipo(ctx.db, resumo.id, comparada);

    /* Três na comparada, um deles novo → dois presentes nas duas pontas. */
    expect(frota.CAVALO).toEqual({ comparados: 2, novos: 1, ausentes: 1 });
  });

  /**
   * O caso que a lista de alterações erraria sozinha.
   *
   * Nada mudou entre as duas vigências: o `change_set` sai sem uma única linha.
   * Derivar a frota dali daria zero comparados — e a tela diria que não há
   * veículo nenhum sobre uma frota de três parados.
   */
  it("conta a frota parada, em que não há alteração nenhuma para contar", async () => {
    const iguais = {
      AAA1: { [coluna]: 10 },
      BBB2: { [coluna]: 20 },
      CCC3: { [coluna]: 30 },
    };
    const { resumo, comparada } = await comparar("CAVALO", iguais, { ...iguais });

    const frota = await frotaPorTipo(ctx.db, resumo.id, comparada);

    expect(frota.CAVALO).toEqual({ comparados: 3, novos: 0, ausentes: 0 });
  });

  /**
   * A mesma régua do total — a garantia de que a soma das abas fecha.
   *
   * `frotaDoPar`, nas quatro rotas, é `entity_count − entitiesAdded`. Aqui os
   * dois lados da igualdade são lidos de lugares diferentes: o resumo do motor
   * e o agregado por tipo. Se um dia eles divergirem, é este caso que cai —
   * antes de a tela publicar uma aba que não fecha com o número ao lado.
   */
  it("bate com os números que o motor gravou no resumo", async () => {
    const { resumo, comparada } = await comparar(
      "CARRETA",
      { AAA1: { "carreta.valor_a": 1 }, BBB2: { "carreta.valor_a": 2 } },
      { BBB2: { "carreta.valor_a": 2 }, CCC3: { "carreta.valor_a": 3 } },
    );

    const frota = await frotaPorTipo(ctx.db, resumo.id, comparada);
    const somaDasAbas = Object.values(frota).reduce(
      (s, f) => ({
        novos: s.novos + f.novos,
        ausentes: s.ausentes + f.ausentes,
      }),
      { novos: 0, ausentes: 0 },
    );

    expect(somaDasAbas.novos).toBe(resumo.entitiesAdded);
    expect(somaDasAbas.ausentes).toBe(resumo.entitiesRemoved);
  });

  /**
   * O tipo que a vigência não tem não vira zero silencioso: ele não aparece.
   *
   * É o que deixa a aba "Carreta" desabilitada com a frase em vez de aberta
   * sobre uma tabela vazia — a mesma distinção entre "não mudou" e "não há"
   * que `tipos-da-vigencia.ts` já faz no resto do produto.
   */
  it("não inventa entrada para o tipo que a vigência não tem", async () => {
    const { resumo, comparada } = await comparar(
      "CAVALO",
      { AAA1: { [coluna]: 1 } },
      { AAA1: { [coluna]: 2 } },
    );

    const frota = await frotaPorTipo(ctx.db, resumo.id, comparada);

    expect(frota.CARRETA).toBeUndefined();
    expect(Object.keys(frota)).toEqual(["CAVALO"]);
  });
});
