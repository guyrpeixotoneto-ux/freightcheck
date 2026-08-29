import { describe, expect, it } from "vitest";
// @ts-expect-error — utilitário interno do Recharts, sem tipos publicados.
import { getStackedData } from "recharts/es6/util/ChartUtils";
import {
  EMPILHAMENTO,
  SERIES_DA_BARRA,
  type PontoDeImpacto,
} from "../grafico-de-impacto";

/**
 * Onde cada barra começa e termina — contra o empilhador do próprio Recharts.
 *
 * O gráfico não tinha `stackOffset`, e o padrão da biblioteca é `"none"`: as
 * séries são acumuladas na ordem declarada **sem olhar o sinal**. Com ganhos
 * positivos e perdas negativas, a barra vermelha era desenhada do topo do verde
 * até o líquido, e não de zero até a perda. Os dois casos abaixo são as duas
 * competências reais que a tela publicou assim.
 *
 * O teste chama `getStackedData` do Recharts, e não uma reimplementação: o que
 * precisa ser provado é o que a biblioteca faz com os nossos dados, e uma
 * fórmula escrita aqui só provaria que ela concorda com ela mesma.
 */

const serie = (dataKey: string) => ({ props: { dataKey } });
const itens = SERIES_DA_BARRA.map(serie);

/** As faixas `[base, topo]` de cada barra, na ordem `[ganhos, perdas]`. */
function faixas(ponto: PontoDeImpacto, offset: string) {
  const [ganhos, perdas] = getStackedData([ponto], itens, offset);
  return { ganhos: [ganhos[0][0], ganhos[0][1]], perdas: [perdas[0][0], perdas[0][1]] };
}

/**
 * Se a faixa desenha alguma coisa.
 *
 * Faixa de altura zero não vira pixel: o `Rectangle` do Recharts devolve
 * `null` quando `height === 0`. É o que salva o caso `perdas: 0`, em que
 * `offsetSign` põe a faixa vazia no topo da pilha positiva por tratar `0` como
 * não-negativo — a posição é estranha, e nada é desenhado nela.
 */
const temAltura = (faixa: number[]) => faixa[0] !== faixa[1];

/** Agosto/2026 na unidade da captura: perda grande, ganho engolido. */
const PERDA_GRANDE: PontoDeImpacto = {
  periodo: "2026-08-01",
  label: "01/08/2026",
  ganhos: 51075,
  perdas: -123303,
  liquido: -72228,
};

/** Julho/2026: ganho grande, perda pequena — a que aparecia acima do zero. */
const GANHO_GRANDE: PontoDeImpacto = {
  periodo: "2026-07-01",
  label: "01/07/2026",
  ganhos: 90000,
  perdas: -5000,
  liquido: 85000,
};

const TODOS_OS_PONTOS: [string, PontoDeImpacto][] = [
  ["perda maior que o ganho", PERDA_GRANDE],
  ["ganho maior que a perda", GANHO_GRANDE],
  ["vigência sem perda", { ...GANHO_GRANDE, perdas: 0, liquido: 90000 }],
  ["vigência sem ganho", { ...PERDA_GRANDE, ganhos: 0, liquido: -123303 }],
  ["vigência sem movimento", { ...PERDA_GRANDE, ganhos: 0, perdas: 0, liquido: 0 }],
];

describe("as duas barras partem do zero, cada uma para o seu lado", () => {
  it.each([
    ["perda maior que o ganho", PERDA_GRANDE],
    ["ganho maior que a perda", GANHO_GRANDE],
  ])("%s: ganhos ocupam [0, ganhos] e perdas ocupam [0, perdas]", (_, ponto) => {
    const { ganhos, perdas } = faixas(ponto, EMPILHAMENTO);

    expect(ganhos).toEqual([0, ponto.ganhos]);
    expect(perdas).toEqual([0, ponto.perdas]);
  });

  it("uma vigência só de ganho não desenha vermelho nenhum", () => {
    const { ganhos, perdas } = faixas({ ...GANHO_GRANDE, perdas: 0, liquido: 90000 }, EMPILHAMENTO);

    expect(ganhos).toEqual([0, 90000]);
    expect(temAltura(perdas)).toBe(false);
  });

  it("uma vigência só de perda não desenha verde nenhum, e a perda desce do zero", () => {
    const { ganhos, perdas } = faixas({ ...PERDA_GRANDE, ganhos: 0, liquido: -123303 }, EMPILHAMENTO);

    expect(perdas).toEqual([0, -123303]);
    expect(temAltura(ganhos)).toBe(false);
  });

  it.each(TODOS_OS_PONTOS)(
    "%s: nenhuma parte visível da barra de perdas fica acima do zero",
    (_, ponto) => {
      const { perdas } = faixas(ponto, EMPILHAMENTO);
      if (!temAltura(perdas)) return;
      expect(Math.max(...perdas)).toBeLessThanOrEqual(0);
    },
  );

  it.each(TODOS_OS_PONTOS)(
    "%s: nenhuma parte visível da barra de ganhos fica abaixo do zero",
    (_, ponto) => {
      const { ganhos } = faixas(ponto, EMPILHAMENTO);
      if (!temAltura(ganhos)) return;
      expect(Math.min(...ganhos)).toBeGreaterThanOrEqual(0);
    },
  );

  it.each(TODOS_OS_PONTOS)(
    "%s: as duas faixas nunca dividem pixel — o verde não fica encoberto",
    (_, ponto) => {
      const { ganhos, perdas } = faixas(ponto, EMPILHAMENTO);
      if (!temAltura(ganhos) || !temAltura(perdas)) return;
      const sobreposicao =
        Math.min(Math.max(...ganhos), Math.max(...perdas)) -
        Math.max(Math.min(...ganhos), Math.min(...perdas));
      expect(sobreposicao).toBeLessThanOrEqual(0);
    },
  );
});

describe("o defeito que o stackOffset padrão produzia", () => {
  it('com "none", a perda pequena era desenhada acima do zero, sobre o topo do ganho', () => {
    const { ganhos, perdas } = faixas(GANHO_GRANDE, "none");

    // Vermelho de 85.000 a 90.000: inteiramente positivo, e dentro do verde.
    expect(perdas).toEqual([90000, 85000]);
    expect(Math.min(...perdas)).toBeGreaterThan(0);
    expect(Math.min(...perdas)).toBeLessThan(Math.max(...ganhos));
    expect(ganhos).toEqual([0, 90000]);
  });

  it('com "none", a perda grande cobria a barra de ganhos inteira', () => {
    const { ganhos, perdas } = faixas(PERDA_GRANDE, "none");

    // Vermelho de +51.075 a -72.228, passando por cima de todo o verde.
    expect(perdas).toEqual([51075, -72228]);
    expect(ganhos).toEqual([0, 51075]);
    expect(Math.max(...perdas)).toBeGreaterThanOrEqual(Math.max(...ganhos));
    expect(Math.min(...perdas)).toBeLessThanOrEqual(Math.min(...ganhos));
  });
});
