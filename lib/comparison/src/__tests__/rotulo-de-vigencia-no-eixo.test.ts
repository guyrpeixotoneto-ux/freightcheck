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
 * `rotuloCurtoDaVigencia` desempatava pelo dia — `01/08/2026` ao lado de
 * `julho/2026`, dois idiomas no mesmo eixo. Hoje ele escreve a mesma coisa que
 * o seletor, com a ordinal encurtada para caber no tick: `agosto/2026 · 1ªq`.
 */

describe("rotuloCurtoDaVigencia", () => {
  it("o mês é sempre o mês, e a quinzena vem encurtada", () => {
    const mensal = ["2026-06-01", "2026-07-01", "2026-08-16"];
    expect(mensal.map((d) => rotuloCurtoDaVigencia(d, mensal))).toEqual([
      "junho/2026 · 1ªq",
      "julho/2026 · 1ªq",
      "agosto/2026 · 2ªq",
    ]);
  });

  /*
    O dia entra sem a palavra "dia" — medido, e não por gosto: os seis rótulos
    do eixo do Dashboard com `· dia 02` por extenso encostam um no outro e os
    dois últimos se sobrepõem. A ordinal fica; o que encurta é o dia.
  */
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
      "junho/2026 · 1ªq",
      "junho/2026 · 2ªq",
      "julho/2026 · 1ªq",
      "julho/2026 · 2ªq",
      "agosto/2026 · 1ªq · 01",
      "agosto/2026 · 1ªq · 15",
    ]);
  });

  it("a divergência com o rótulo longo é só a largura da ordinal", () => {
    const partido = ["2026-08-01", "2026-08-16"];
    expect(rotuloDaVigencia("2026-08-01", partido)).toBe("agosto/2026 · 1ª quinzena");
    expect(rotuloCurtoDaVigencia("2026-08-01", partido)).toBe("agosto/2026 · 1ªq");
    expect(rotuloCurtoDaVigencia("2026-08-16", partido)).toBe("agosto/2026 · 2ªq");
  });

  it("a própria data entra na conta mesmo vinda de fora do conjunto", () => {
    expect(rotuloCurtoDaVigencia("2026-08-20", ["2026-08-01"])).toBe("agosto/2026 · 2ªq");
  });

  it("um mês só ambíguo não contamina os outros", () => {
    const misto = ["2026-07-01", "2026-08-01", "2026-08-15"];
    expect(misto.map((d) => rotuloCurtoDaVigencia(d, misto))).toEqual([
      "julho/2026 · 1ªq",
      "agosto/2026 · 1ªq · 01",
      "agosto/2026 · 1ªq · 15",
    ]);
  });

  it("o que não é vigência ISO passa direto, como em periodLabel", () => {
    expect(rotuloCurtoDaVigencia("sem data", ["2026-08-01"])).toBe("sem data");
  });
});
