import { describe, expect, it } from "vitest";
import {
  JANELA_PADRAO,
  QUANTIDADES,
  TETO_DA_SERIE,
  competenciaInicial,
  janelasDeVigencias,
  recorteDaJanela,
} from "../janela-de-vigencias";

/**
 * O fatiamento do histórico em janelas — o paginador da Linha do Tempo.
 *
 * O Dashboard só desenha a última fatia, mas as duas telas cortam pelo mesmo
 * lugar: se o corte divergisse, "3 meses" começaria num mês no gráfico e
 * noutro na linha do tempo, sobre o mesmo histórico e na mesma sessão.
 */

const vigencia = (period: string) => ({ period });
const datas = (fatia: { period: string }[]) => fatia.map((p) => p.period);
const data = (ponto: { period: string }) => ponto.period;

/** Cinco meses seguidos, com **duas** vigências em agosto. */
const SERIE = [
  vigencia("2026-04-01"),
  vigencia("2026-05-01"),
  vigencia("2026-06-01"),
  vigencia("2026-07-01"),
  vigencia("2026-08-01"),
  vigencia("2026-08-16"),
];

describe("janelasDeVigencias, por vigências", () => {
  it("alinha o corte pelo fim — a fatia incompleta é a mais antiga", () => {
    const fatias = janelasDeVigencias(SERIE.slice(1), { unidade: "vigencias", quantidade: 3 }, data);

    expect(fatias.map(datas)).toEqual([
      ["2026-05-01", "2026-06-01"],
      ["2026-07-01", "2026-08-01", "2026-08-16"],
    ]);
  });

  it("conta entregas — as duas de agosto gastam duas", () => {
    const fatias = janelasDeVigencias(SERIE, { unidade: "vigencias", quantidade: 3 }, data);

    expect(datas(fatias[fatias.length - 1])).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-08-16",
    ]);
  });

  it("janela maior que o histórico é uma página só", () => {
    const fatias = janelasDeVigencias(SERIE, { unidade: "vigencias", quantidade: 12 }, data);

    expect(fatias).toHaveLength(1);
    expect(fatias[0]).toHaveLength(SERIE.length);
  });
});

describe("janelasDeVigencias, por meses", () => {
  it("conta calendário — as duas de agosto gastam um mês só", () => {
    const fatias = janelasDeVigencias(SERIE, { unidade: "meses", quantidade: 3 }, data);

    expect(fatias.map(datas)).toEqual([
      ["2026-04-01", "2026-05-01"],
      ["2026-06-01", "2026-07-01", "2026-08-01", "2026-08-16"],
    ]);
  });

  it("bloco de calendário sem vigência nenhuma não vira página em branco", () => {
    const parado = [vigencia("2026-01-10"), vigencia("2026-08-01"), vigencia("2026-08-16")];
    const fatias = janelasDeVigencias(parado, { unidade: "meses", quantidade: 3 }, data);

    // Entre janeiro e junho não há entrega — e não há página para atravessar.
    expect(fatias.map(datas)).toEqual([["2026-01-10"], ["2026-08-01", "2026-08-16"]]);
  });

  it("é ancorada na última vigência, e não no relógio", () => {
    const antiga = [vigencia("2019-01-01"), vigencia("2019-02-01"), vigencia("2019-03-01")];
    const fatias = janelasDeVigencias(antiga, { unidade: "meses", quantidade: 3 }, data);

    expect(fatias).toHaveLength(1);
    expect(fatias[0]).toHaveLength(3);
  });

  it("atravessa a virada do ano sem perder vigência", () => {
    const virada = [
      vigencia("2025-11-01"),
      vigencia("2025-12-01"),
      vigencia("2026-01-01"),
      vigencia("2026-02-01"),
    ];
    const fatias = janelasDeVigencias(virada, { unidade: "meses", quantidade: 3 }, data);

    expect(fatias.map(datas)).toEqual([
      ["2025-11-01"],
      ["2025-12-01", "2026-01-01", "2026-02-01"],
    ]);
  });

  it("histórico vazio não rende página nenhuma", () => {
    expect(janelasDeVigencias([], { unidade: "meses", quantidade: 6 }, data)).toEqual([]);
    expect(janelasDeVigencias([], { unidade: "vigencias", quantidade: 6 }, data)).toEqual([]);
  });
});

describe("recorteDaJanela", () => {
  it("é a última fatia — a ponta recente, que é a que abre", () => {
    for (const unidade of ["vigencias", "meses"] as const) {
      const janela = { unidade, quantidade: 3 };
      const fatias = janelasDeVigencias(SERIE, janela, data);
      expect(recorteDaJanela(SERIE, janela, data)).toEqual(fatias[fatias.length - 1]);
    }
  });

  it("nenhuma fatia se perde no caminho — as páginas somam o histórico inteiro", () => {
    for (const unidade of ["vigencias", "meses"] as const) {
      for (const quantidade of QUANTIDADES) {
        const fatias = janelasDeVigencias(SERIE, { unidade, quantidade }, data);
        expect(fatias.flatMap(datas)).toEqual(SERIE.map((p) => p.period));
      }
    }
  });
});

describe("competenciaInicial", () => {
  it("inclui o mês da âncora — três meses a partir de agosto começam em junho", () => {
    expect(competenciaInicial("2026-08-16", 3)).toBe("2026-06");
  });

  it("atravessa a virada do ano", () => {
    expect(competenciaInicial("2026-02-01", 6)).toBe("2025-09");
    expect(competenciaInicial("2026-01-31", 1)).toBe("2026-01");
    expect(competenciaInicial("2026-01-01", 12)).toBe("2025-02");
  });
});

describe("a janela padrão e o teto da série", () => {
  it("abre numa das quantidades que o seletor oferece", () => {
    expect(QUANTIDADES).toContain(JANELA_PADRAO.quantidade);
  });

  it("o teto cabe mais que a maior janela por meses", () => {
    expect(TETO_DA_SERIE).toBeGreaterThan(Math.max(...QUANTIDADES));
  });
});
