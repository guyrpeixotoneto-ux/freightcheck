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
 * interesse a quem está procurando o mês. `rotuloDeListaDaVigencia` devolve o
 * mês para a coluna e põe o desempate numa marca à parte.
 *
 * A segunda metade destas provas é mais nova: a marca deixou de ser exceção. A
 * leitura de quem audita é quinzenal, e uma coluna que ora diz
 * `agosto/2026 · 1ª quinzena`, ora `junho/2026`, faz a ausência da marca
 * parecer um fato sobre o mês — quando ela era um fato sobre o acervo.
 */

describe("rotuloDeListaDaVigencia", () => {
  it("todo mês leva a quinzena, mesmo com uma entrega só", () => {
    const mensal = ["2026-06-01", "2026-07-01", "2026-08-16"];
    expect(mensal.map((d) => rotuloDeListaDaVigencia(d, mensal))).toEqual([
      { mes: "junho/2026", marca: "1ª quinzena" },
      { mes: "julho/2026", marca: "1ª quinzena" },
      { mes: "agosto/2026", marca: "2ª quinzena" },
    ]);
  });

  it("a quinzena sai do dia da vigência, e não da posição dela na lista", () => {
    // Uma data solta, sem contexto nenhum, continua sabendo em que metade cai.
    expect(rotuloDeListaDaVigencia("2026-08-20", [])).toEqual({
      mes: "agosto/2026",
      marca: "2ª quinzena",
    });
    expect(rotuloDeListaDaVigencia("2026-08-01", [])).toEqual({
      mes: "agosto/2026",
      marca: "1ª quinzena",
    });
  });

  it("mês partido em quinzenas do calendário: a ordinal basta, sem dia", () => {
    const partido = ["2026-08-01", "2026-08-16"];
    expect(partido.map((d) => rotuloDeListaDaVigencia(d, partido))).toEqual([
      { mes: "agosto/2026", marca: "1ª quinzena" },
      { mes: "agosto/2026", marca: "2ª quinzena" },
    ]);
  });

  it("duas entregas na mesma metade: o dia entra junto com a quinzena, nunca no lugar dela", () => {
    /*
      A régua antiga trocava a ordinal pelo dia aqui, e o mês perdia a marca
      quinzenal que todas as outras linhas tinham. O dia é um **acréscimo**: ele
      desempata o que a ordinal sozinha não desempata, sem desmentir a metade em
      que a vigência caiu.
    */
    const mesmaMetade = ["2026-08-01", "2026-08-02"];
    expect(mesmaMetade.map((d) => rotuloDeListaDaVigencia(d, mesmaMetade).marca)).toEqual([
      "1ª quinzena · dia 01",
      "1ª quinzena · dia 02",
    ]);
  });

  it("três entregas no mesmo mês: todas ganham o dia, e nenhuma perde a quinzena", () => {
    const tres = ["2026-08-01", "2026-08-02", "2026-08-20"];
    expect(tres.map((d) => rotuloDeListaDaVigencia(d, tres).marca)).toEqual([
      "1ª quinzena · dia 01",
      "1ª quinzena · dia 02",
      "2ª quinzena · dia 20",
    ]);
  });

  it("mês e marca juntos nunca repetem — o critério de aceite da lista", () => {
    const lista = ["2026-09-01", "2026-08-02", "2026-08-01", "2026-07-01"];
    const escritos = lista.map((d) => {
      const { mes, marca } = rotuloDeListaDaVigencia(d, lista);
      return marca ? `${mes} · ${marca}` : mes;
    });
    expect(new Set(escritos).size).toBe(lista.length);
  });

  it("um mês só ambíguo não contamina os outros", () => {
    const misto = ["2026-07-01", "2026-08-01", "2026-08-15"];
    expect(misto.map((d) => rotuloDeListaDaVigencia(d, misto).marca)).toEqual([
      "1ª quinzena",
      "1ª quinzena · dia 01",
      "1ª quinzena · dia 15",
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
    // Sem dia não há quinzena a afirmar, e o texto sai como veio.
    expect(rotuloDeListaDaVigencia("sem data", ["2026-08-01"])).toEqual({
      mes: "sem data",
      marca: null,
    });
    expect(rotuloCurtoDaVigencia("sem data", ["2026-08-01"])).toBe("sem data");
  });
});
