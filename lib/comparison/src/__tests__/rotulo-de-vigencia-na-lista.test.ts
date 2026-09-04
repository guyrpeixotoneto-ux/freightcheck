import { describe, expect, it } from "vitest";
import { rotuloCurtoDaVigencia, rotuloDeListaDaVigencia } from "../labels";

/**
 * O rótulo de vigência empilhado numa lista.
 *
 * O seletor "Trocar vigência" desenhava `rotuloCurtoDaVigencia` puro, e a
 * coluna saía em dois idiomas:
 *
 * ```
 * setembro/2026
 * 02/08/2026
 * 01/08/2026
 * julho/2026
 * ```
 *
 * Três meses escritos por extenso e um escrito em dígitos — e a única razão da
 * diferença é que agosto teve duas entregas, que não é uma distinção que
 * interesse a quem está procurando o mês. `rotuloDeListaDaVigencia` mantém o
 * desempate e devolve o mês para a coluna.
 */

describe("rotuloDeListaDaVigencia", () => {
  it("mês com uma entrega é o mês, sem marca nenhuma", () => {
    const mensal = ["2026-06-01", "2026-07-01", "2026-08-01"];
    expect(mensal.map((d) => rotuloDeListaDaVigencia(d, mensal))).toEqual([
      { mes: "junho/2026", marca: null },
      { mes: "julho/2026", marca: null },
      { mes: "agosto/2026", marca: null },
    ]);
  });

  it("o mês continua sendo o mês quando ele tem duas entregas — o defeito da lista", () => {
    const lista = ["2026-09-01", "2026-08-02", "2026-08-01", "2026-07-01"];

    // O que estava no ar: a coluna trocava de idioma nas duas do meio.
    expect(lista.map((d) => rotuloCurtoDaVigencia(d, lista))).toEqual([
      "setembro/2026",
      "02/08/2026",
      "01/08/2026",
      "julho/2026",
    ]);

    const rotulos = lista.map((d) => rotuloDeListaDaVigencia(d, lista));
    expect(rotulos.map((r) => r.mes)).toEqual([
      "setembro/2026",
      "agosto/2026",
      "agosto/2026",
      "julho/2026",
    ]);
    expect(rotulos.map((r) => r.marca)).toEqual([null, "dia 02", "dia 01", null]);
  });

  it("as duas de agosto continuam distinguíveis — mês e marca juntos nunca repetem", () => {
    const lista = ["2026-09-01", "2026-08-02", "2026-08-01", "2026-07-01"];
    const escritos = lista.map((d) => {
      const { mes, marca } = rotuloDeListaDaVigencia(d, lista);
      return marca ? `${mes} · ${marca}` : mes;
    });
    expect(new Set(escritos).size).toBe(lista.length);
  });

  it("mês partido em quinzenas do calendário ganha a ordinal, não o dia", () => {
    /*
      A mesma régua de `rotuloDaVigencia`, e a divergência deliberada com
      `rotuloCurtoDaVigencia`, que escreve o dia porque um tick de eixo não
      comporta a ordinal. Aqui a lista comporta.
    */
    const partido = ["2026-08-01", "2026-08-16"];
    expect(partido.map((d) => rotuloDeListaDaVigencia(d, partido))).toEqual([
      { mes: "agosto/2026", marca: "1ª quinzena" },
      { mes: "agosto/2026", marca: "2ª quinzena" },
    ]);
  });

  it("três entregas no mesmo mês caem no dia — nenhuma quinzena que o calendário não sustente", () => {
    const tres = ["2026-08-01", "2026-08-02", "2026-08-20"];
    expect(tres.map((d) => rotuloDeListaDaVigencia(d, tres).marca)).toEqual([
      "dia 01",
      "dia 02",
      "dia 20",
    ]);
  });

  it("um mês só ambíguo não contamina os outros", () => {
    const misto = ["2026-07-01", "2026-08-01", "2026-08-15"];
    expect(misto.map((d) => rotuloDeListaDaVigencia(d, misto).marca)).toEqual([
      null,
      "dia 01",
      "dia 15",
    ]);
  });

  it("a própria data entra na conta mesmo vinda de fora do conjunto", () => {
    /*
      `2026-08-20` não está na lista, e mesmo assim agosto conta como mês de
      duas entregas — sem isso, a chamada de fora do conjunto afirmaria "mês
      com uma entrega" para uma data que o contexto nem conhece.
    */
    expect(rotuloDeListaDaVigencia("2026-08-20", ["2026-08-01"])).toEqual({
      mes: "agosto/2026",
      marca: "2ª quinzena",
    });
  });

  it("o que não é vigência ISO passa direto, como em periodLabel", () => {
    expect(rotuloDeListaDaVigencia("sem data", ["2026-08-01"])).toEqual({
      mes: "sem data",
      marca: null,
    });
  });
});
