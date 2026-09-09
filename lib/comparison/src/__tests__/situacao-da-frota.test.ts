import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDb } from "@workspace/ingest/testing";
import { booleanoDoTexto } from "@workspace/ingest";
import { criarBancoComModelosCurados } from "../testing";
import { getGroupedView } from "../grouped";

/**
 * Quantos equipamentos da frota respondem `ATIVO` — contra o export real.
 *
 * O Panorama passou a escrever esse número ao lado da frota porque "ativo" tem
 * dois donos neste produto e os dois aparecem na mesma tela: o **bem** — que é
 * o que a frota conta — e a **coluna `ativo`** do export, que vale `ATIVO` ou
 * `PARADO`. Enquanto o card dizia só "69 ativos", quem conhecia a coluna lia o
 * segundo sentido sobre um número que media o primeiro.
 *
 * O que este arquivo prende é a honestidade da contagem, e ela tem três lados:
 *
 * 1. quem responde `ATIVO` e quem responde `PARADO` são contados à parte;
 * 2. quem **não declara a coluna** não vira parado — CARRETA não a declara, e
 *    somá-la aos parados mostraria as carretas todas encostadas no pátio;
 * 3. o vocabulário do SQL é o mesmo do TypeScript, provado comparando os dois
 *    caminhos sobre o mesmo dado, e não por leitura do código.
 */

const AGOSTO = "2026-08-01";

let ctx: TestDb;

beforeAll(async () => {
  ctx = await criarBancoComModelosCurados("situacao_da_frota");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a situação da frota, no export real", () => {
  it("separa quem respondeu ATIVO de quem respondeu PARADO", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const cavalo = view.series.find((s) => s.entityTypeSet === "CAVALO")!;

    expect(cavalo.ativos).toBe(46);
    expect(cavalo.inativos).toBe(16);
    // Em CAVALO todo mundo respondeu — as duas pontas fecham a frota da série.
    expect(cavalo.ativos + cavalo.inativos).toBe(cavalo.fleet);
  });

  it("não chama de parado quem não declara a coluna", async () => {
    /*
      CARRETA não traz `ativo`. A tentação é escrever `inativos = fleet -
      ativos`, e ela produziria uma frota inteira de carretas paradas — um
      número que a fonte nunca afirmou. As duas contagens vêm do dado, e o que
      sobra é a terceira categoria: sem resposta.
    */
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const carreta = view.series.find((s) => s.entityTypeSet === "CARRETA")!;

    expect(carreta.fleet).toBeGreaterThan(0);
    expect(carreta.ativos).toBe(0);
    expect(carreta.inativos).toBe(0);
  });

  it("os KPIs somam as séries, e a soma não fecha a frota — de propósito", async () => {
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const { kpis } = view.cockpit;

    expect(kpis.ativosNaFrota).toBe(
      view.series.reduce((total, s) => total + s.ativos, 0),
    );
    expect(kpis.inativosNaFrota).toBe(
      view.series.reduce((total, s) => total + s.inativos, 0),
    );

    // A diferença é quem não respondeu, e ela é positiva aqui porque as
    // carretas estão na frota sem estarem na coluna.
    const semResposta = kpis.fleet - kpis.ativosNaFrota - kpis.inativosNaFrota;
    const carreta = view.series.find((s) => s.entityTypeSet === "CARRETA")!;
    expect(semResposta).toBeGreaterThan(0);
    expect(semResposta).toBe(carreta.fleet);
  });

  it("o vocabulário do SQL é o mesmo que o TypeScript aplica", async () => {
    /*
      A contagem vive em SQL, dentro da consulta que já varre os fatos; a
      tradução palavra → booleano vive em TypeScript, em `@workspace/ingest`.
      Duas listas concordariam no dia em que fossem escritas e divergiriam no
      primeiro mês em que o cliente inventasse uma palavra — a planilha de
      remuneração contaria "sem resposta" e o Panorama contaria "parado", sobre
      o mesmo veículo.

      Por isso o SQL monta o `IN (...)` a partir da mesma constante. Este caso
      confere o resultado dos dois caminhos sobre o mesmo dado, que é a única
      prova que sobrevive a alguém reescrever um dos lados.
    */
    const view = (await getGroupedView(ctx.db, AGOSTO))!;
    const cavalo = view.series.find((s) => s.entityTypeSet === "CAVALO")!;

    const { rows } = await ctx.db.execute<{ value_text: string | null }>(
      valoresCrusDaColuna(AGOSTO),
    );

    let ativos = 0;
    let inativos = 0;
    for (const linha of rows) {
      const resposta = booleanoDoTexto(linha.value_text);
      if (resposta === true) ativos += 1;
      else if (resposta === false) inativos += 1;
    }

    expect(rows.length).toBeGreaterThan(0);
    expect({ ativos, inativos }).toEqual({
      ativos: cavalo.ativos,
      inativos: cavalo.inativos,
    });
  });
});

/** Os valores crus da coluna `ativo` na vigência — um por cavalo. */
function valoresCrusDaColuna(data: string) {
  return `
    SELECT f.value_text
      FROM fato_visivel f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN entity e    ON e.id = f.entity_id
      JOIN snapshot s  ON s.id = f.snapshot_id
     WHERE a.code = 'cavalo.ativo'
       AND e.entity_type = 'CAVALO'
       AND f.is_null = false
       AND s.effective_date = '${data}'::date
       AND s.status <> 'SUPERSEDED'
  ` as never;
}
