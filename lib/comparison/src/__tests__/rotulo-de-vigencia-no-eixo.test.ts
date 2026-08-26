import { describe, expect, it } from "vitest";
import { periodLabel, rotuloCurtoDaVigencia, rotuloDaVigencia } from "../labels";

/**
 * O rótulo de vigência na largura de um tick de eixo.
 *
 * O Dashboard desenhava seis barras com `periodLabel` puro e o eixo saía
 * `junho/2026, junho/2026, julho/2026, julho/2026, agosto/2026, agosto/2026`:
 * seis vigências, três nomes, e nada na tela dizendo qual barra era qual. O
 * subtítulo ainda prometia "últimas 6 competências" para três meses de
 * calendário.
 *
 * `rotuloCurtoDaVigencia` desempata pelo dia — e só quando há empate.
 */

describe("rotuloCurtoDaVigencia", () => {
  it("mês com uma entrega continua escrito pelo mês", () => {
    const mensal = ["2026-06-01", "2026-07-01", "2026-08-01"];
    expect(mensal.map((d) => rotuloCurtoDaVigencia(d, mensal))).toEqual([
      "junho/2026",
      "julho/2026",
      "agosto/2026",
    ]);
  });

  it("duas vigências no mesmo mês passam a ser distinguíveis pelo dia", () => {
    const agosto = ["2026-08-01", "2026-08-15"];
    expect(agosto.map((d) => rotuloCurtoDaVigencia(d, agosto))).toEqual([
      "01/08/2026",
      "15/08/2026",
    ]);
  });

  it("nunca escreve o mesmo rótulo duas vezes num contexto — o defeito do eixo", () => {
    const seisVigencias = [
      "2026-06-01",
      "2026-06-16",
      "2026-07-01",
      "2026-07-20",
      "2026-08-01",
      "2026-08-15",
    ];

    // O que estava no ar: seis datas, três rótulos.
    expect(new Set(seisVigencias.map(periodLabel)).size).toBe(3);

    const rotulos = seisVigencias.map((d) => rotuloCurtoDaVigencia(d, seisVigencias));
    expect(new Set(rotulos).size).toBe(seisVigencias.length);
    expect(rotulos).toEqual([
      "01/06/2026",
      "16/06/2026",
      "01/07/2026",
      "20/07/2026",
      "01/08/2026",
      "15/08/2026",
    ]);
  });

  it("desempata pelo dia mesmo quando as duas caem em quinzenas diferentes", () => {
    /*
      É a única divergência deliberada com `rotuloDaVigencia`, que aqui
      escreveria "1ª quinzena de agosto/2026". A ordinal não cabe num tick de
      eixo com seis rótulos lado a lado, e o dia distingue com a mesma
      garantia — duas vigências do mesmo contexto nunca compartilham data.
    */
    const partido = ["2026-08-01", "2026-08-16"];
    expect(rotuloDaVigencia("2026-08-01", partido)).toBe("1ª quinzena de agosto/2026");
    expect(rotuloCurtoDaVigencia("2026-08-01", partido)).toBe("01/08/2026");
    expect(rotuloCurtoDaVigencia("2026-08-16", partido)).toBe("16/08/2026");
  });

  it("a própria data entra na conta mesmo vinda de fora do conjunto", () => {
    expect(rotuloCurtoDaVigencia("2026-08-20", ["2026-08-01"])).toBe("20/08/2026");
  });

  it("um mês só ambíguo não contamina os outros", () => {
    const misto = ["2026-07-01", "2026-08-01", "2026-08-15"];
    expect(misto.map((d) => rotuloCurtoDaVigencia(d, misto))).toEqual([
      "julho/2026",
      "01/08/2026",
      "15/08/2026",
    ]);
  });

  it("o que não é vigência ISO passa direto, como em periodLabel", () => {
    expect(rotuloCurtoDaVigencia("sem data", ["2026-08-01"])).toBe("sem data");
  });
});
