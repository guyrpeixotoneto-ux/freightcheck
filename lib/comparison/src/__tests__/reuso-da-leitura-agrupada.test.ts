import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDb } from "@workspace/ingest/testing";
import { criarBancoComModelosCurados } from "../testing";
import { getGroupedViewComDados } from "../grouped";
import { getFamiliesView } from "../families-view";

/**
 * A invariante que permite a Visão por famílias reaproveitar a leitura agrupada.
 *
 * `getFamiliesView` carregava de novo o que `getGroupedView` acabara de
 * carregar — `loadChanges`, `snapshotsDosChangeSets` e
 * `carregarVinculosDeConjunto` sobre os mesmos change sets. Três round trips
 * por requisição para chegar ao mesmo resultado, numa leitura que alimenta
 * cinco telas.
 *
 * Reaproveitar só é correto porque os dois lados enxergam **o mesmo conjunto**
 * de comparações, e isso não é óbvio: os ids saem de consultas diferentes. A
 * leitura agrupada os tira da consulta das comparações, filtrando
 * `entity_type_set IS DISTINCT FROM 'TRECHO'`; a Visão por famílias os tirava
 * de `view.series`, que é por equipamento e filtra o componente
 * (`t <> 'TRECHO'`) — repetindo o mesmo id quando CAVALO e CARRETA dividem um
 * snapshot.
 *
 * Os dois filtros coincidem por uma razão só: **TRECHO nunca se combina com
 * outro tipo**. Uma série é ou 'TRECHO' inteira, e some dos dois lados, ou não
 * tem componente TRECHO nenhum. No dia em que isso deixar de valer, os
 * conjuntos divergem e a Visão por famílias passa a somar alterações de trecho
 * que ela sempre excluiu — em silêncio, porque nada na tela diria que mudou.
 *
 * Este arquivo existe para que esse dia produza um teste vermelho, e não um
 * número errado.
 */

let banco: TestDb;

beforeAll(async () => {
  banco = await criarBancoComModelosCurados("reuso-da-leitura-agrupada");
}, 300_000);

afterAll(async () => {
  await banco?.drop();
});

describe("os dois lados enxergam as mesmas comparações", () => {
  it("os ids de `view.series` são, como conjunto, os que a leitura agrupada carregou", async () => {
    const leitura = await getGroupedViewComDados(banco.db);
    expect(leitura).not.toBeNull();

    const daSerie = new Set(
      leitura!.view.series
        .map((s) => s.changeSetId)
        .filter((id): id is string => id !== null),
    );
    const carregados = new Set(leitura!.changeSetIds);

    expect([...daSerie].sort()).toEqual([...carregados].sort());
  });

  /**
   * A repetição é esperada e é inofensiva — era ela que fazia `loadChanges`
   * receber o mesmo id duas vezes. Fica registrada para que ninguém
   * "conserte" `view.series` achando que a duplicata é o defeito: ela é o
   * desenho (uma linha por equipamento), e é justamente por isso que
   * reaproveitar pelo conjunto é o certo.
   */
  it("`view.series` repete o id quando dois equipamentos dividem um snapshot", async () => {
    const leitura = await getGroupedViewComDados(banco.db);
    const daSerie = leitura!.view.series
      .map((s) => s.changeSetId)
      .filter((id): id is string => id !== null);

    expect(daSerie.length).toBeGreaterThanOrEqual(new Set(daSerie).size);
    expect(new Set(daSerie).size).toBe(leitura!.changeSetIds.length);
  });
});

describe("a Visão por famílias responde o mesmo com o material reaproveitado", () => {
  /**
   * O contrato de verdade: seja qual for o caminho interno, o que sai tem de
   * ser o mesmo. Comparado sobre o JSON inteiro — não sobre um campo
   * escolhido a dedo, que é como uma diferença passa despercebida.
   */
  it("o impacto e os totais fecham com os da leitura agrupada", async () => {
    const leitura = await getGroupedViewComDados(banco.db);
    const familias = await getFamiliesView(banco.db);

    expect(familias).not.toBeNull();
    expect(familias!.impact).toEqual(leitura!.view.impact);
    expect(familias!.totals).toEqual(leitura!.view.totals);
  });

  /**
   * Nenhuma alteração entrou nem sumiu: a soma das famílias continua sendo o
   * total da vigência. É a mesma conta que `families-real` faz, repetida aqui
   * porque é ela que quebraria se o conjunto de change sets divergisse.
   */
  it("a soma das alterações por família é o total da vigência", async () => {
    const familias = await getFamiliesView(banco.db);
    const somaDasFamilias = familias!.families.reduce(
      (total, f) => total + f.parameters.reduce((s, p) => s + p.changes, 0),
      0,
    );

    expect(somaDasFamilias).toBe(familias!.totals.changes);
  });
});
