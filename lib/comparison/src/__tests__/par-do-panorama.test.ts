// As recusas do par do Panorama, e o que ele manda calcular.
//
// O que se prende aqui é a régua — qualquer par da unidade, menos a mesma
// vigência dos dois lados — e a economia: o par canônico já está gravado e não
// pode ser recalculado por ninguém abrir a tela; a volta e o par salteado são
// calculados uma vez e reaproveitados nas seguintes. O resto (escopo,
// cobertura, canal) é recusa do motor, e este módulo só a deixa passar inteira.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calculadas: [string, string][] = [];
/** Os pares que o banco já tem gravados, como `getChangeSetForPair` os vê. */
let gravados = new Set<string>();

vi.mock("../engine", () => ({
  computeChangeSet: vi.fn(async (_db: unknown, a: string, b: string) => {
    calculadas.push([a, b]);
    return { id: `${a}->${b}` };
  }),
}));

vi.mock("../query", () => ({
  getChangeSetForPair: vi.fn(async (_db: unknown, a: string, b: string) =>
    gravados.has(`${a}->${b}`) ? { id: `${a}->${b}` } : null,
  ),
}));

const { prepararParDoPanorama } = await import("../par-do-panorama");
import type { SeriesContext } from "../series";
import type { Database } from "@workspace/db";

const CONTEXTO = {
  scopeHash: "hash-pe",
  channel: "EMPURRADA",
} as unknown as SeriesContext;

const PERIODOS = ["2026-09-01", "2026-08-01", "2026-07-01"];

/** Os snapshots das duas pontas, como a consulta os devolveria. */
const snapshot = (id: string, data: string, cobertura = "CARRETA+CAVALO") => ({
  id,
  effective_date: data,
  scope_hash: "hash-pe",
  entity_type_set: cobertura,
  source_label: `EMPURRADA_${id}`,
});

const bancoCom = (linhas: unknown[]) =>
  ({ execute: vi.fn(async () => ({ rows: linhas })) }) as unknown as Database;

beforeEach(() => {
  calculadas.length = 0;
  gravados = new Set();
});

describe("a régua do par", () => {
  it("recusa a mesma vigência dos dois lados", async () => {
    await expect(
      prepararParDoPanorama(bancoCom([]), CONTEXTO, {
        de: "2026-08-01",
        para: "2026-08-01",
      }, PERIODOS),
    ).rejects.toThrow(/não se compara consigo mesma/);
  });

  it("recusa uma vigência que não é desta unidade", async () => {
    await expect(
      prepararParDoPanorama(bancoCom([]), CONTEXTO, {
        de: "2025-01-01",
        para: "2026-08-01",
      }, PERIODOS),
    ).rejects.toThrow(/não pertence a esta unidade/);
  });

  /*
    E **não** recusa o par salteado: julho contra setembro, com agosto no meio,
    é o par que a pessoa montou no seletor — o motor o calcula como calcula a
    volta. Era aqui que morava a trava que fazia o seletor da tela arrastar o
    Para a cada escolha no De.
  */
  it("aceita o par salteado e manda calculá-lo", async () => {
    const db = bancoCom([
      snapshot("jul", "2026-07-01"),
      snapshot("set", "2026-09-01"),
    ]);

    const par = await prepararParDoPanorama(
      db,
      CONTEXTO,
      { de: "2026-07-01", para: "2026-09-01" },
      PERIODOS,
    );

    expect(par).toEqual({
      de: "2026-07-01",
      para: "2026-09-01",
      invertido: false,
      calculadas: 1,
    });
    /* A ordem é De × Para: o lado A do motor é a ponta de partida. */
    expect(calculadas).toEqual([["jul", "set"]]);
  });

  /* A volta salteada — setembro contra julho — é o mesmo caminho, ao contrário. */
  it("aceita a volta salteada", async () => {
    const db = bancoCom([
      snapshot("set", "2026-09-01"),
      snapshot("jul", "2026-07-01"),
    ]);

    const par = await prepararParDoPanorama(
      db,
      CONTEXTO,
      { de: "2026-09-01", para: "2026-07-01" },
      PERIODOS,
    );

    expect(par.invertido).toBe(true);
    expect(par.calculadas).toBe(1);
    expect(calculadas).toEqual([["set", "jul"]]);
  });
});

describe("o par canônico", () => {
  it("não calcula nada: é a comparação que a importação gravou", async () => {
    const db = bancoCom([]);
    const par = await prepararParDoPanorama(
      db,
      CONTEXTO,
      { de: "2026-07-01", para: "2026-08-01" },
      PERIODOS,
    );

    expect(par).toEqual({
      de: "2026-07-01",
      para: "2026-08-01",
      invertido: false,
      calculadas: 0,
    });
    /* E nem o banco é consultado: não há o que procurar. */
    expect(db.execute).not.toHaveBeenCalled();
    expect(calculadas).toEqual([]);
  });
});

describe("a volta", () => {
  /*
    O par se monta **dentro** da série: casar por data apenas emparelharia o
    arquivo de cavalo de setembro com o de carreta de agosto — o par que o motor
    recusa por cobertura diferente, aqui produzido por nós.
  */
  it("pede B×A ao motor, uma vez por série", async () => {
    const db = bancoCom([
      snapshot("set-cavalo", "2026-09-01", "CAVALO"),
      snapshot("ago-cavalo", "2026-08-01", "CAVALO"),
      snapshot("set-carreta", "2026-09-01", "CARRETA"),
      snapshot("ago-carreta", "2026-08-01", "CARRETA"),
    ]);

    const par = await prepararParDoPanorama(
      db,
      CONTEXTO,
      { de: "2026-09-01", para: "2026-08-01" },
      PERIODOS,
    );

    expect(par.invertido).toBe(true);
    expect(par.calculadas).toBe(2);
    expect(calculadas).toEqual([
      ["set-cavalo", "ago-cavalo"],
      ["set-carreta", "ago-carreta"],
    ]);
  });

  /* O segundo clique custa uma leitura, e não uma varredura. */
  it("reaproveita a volta já calculada", async () => {
    gravados.add("set->ago");
    const db = bancoCom([snapshot("set", "2026-09-01"), snapshot("ago", "2026-08-01")]);

    const par = await prepararParDoPanorama(
      db,
      CONTEXTO,
      { de: "2026-09-01", para: "2026-08-01" },
      PERIODOS,
    );

    expect(par.calculadas).toBe(0);
    expect(calculadas).toEqual([]);
  });

  /*
    Sem o mesmo conjunto de equipamento dos dois lados não há o que comparar, e
    a frase diz isso em vez de deixar a tela montar uma leitura vazia — ou, pior,
    de alguém aqui trocar a ponta pedida por uma que casasse.
  */
  it("recusa quando nenhuma série tem as duas pontas", async () => {
    const db = bancoCom([
      snapshot("set-cavalo", "2026-09-01", "CAVALO"),
      snapshot("ago-carreta", "2026-08-01", "CARRETA"),
    ]);

    await expect(
      prepararParDoPanorama(db, CONTEXTO, { de: "2026-09-01", para: "2026-08-01" }, PERIODOS),
    ).rejects.toThrow(/Nenhuma série tem as duas vigências/);
  });
});
