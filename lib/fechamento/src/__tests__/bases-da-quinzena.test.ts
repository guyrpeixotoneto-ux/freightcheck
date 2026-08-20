import { describe, expect, it } from "vitest";

import { basesDaQuinzena } from "../persistencia";

/**
 * De onde saem as bases que o motor desconta — sem banco.
 *
 * `basesDaQuinzena` é aritmética sobre duas listas, e é a única coisa que
 * decide **qual desconto do 03.08.20 alimenta qual linha da planilha**. O
 * resto de `persistencia.ts` precisa de Postgres; esta função não, e é ela que
 * carrega a decisão.
 *
 * Os números são os de julho/2026 — CDD Belém · Horizonte —, lidos do próprio
 * demonstrativo. Ver `docs/MAPA-ROTA.md` para o elo entre eles e as células
 * digitadas à mão no `Mapa Rota`.
 */
const ROTA = "ROTA" as const;

const DESCONTOS_1A = [
  { canal: ROTA, tipo: "DEVOLUCAO", valor: 13328.3 },
  { canal: ROTA, tipo: "FRETE_MINIMO", valor: 11649.87 },
];

const DESCONTOS_2A = [
  { canal: ROTA, tipo: "DEVOLUCAO", valor: 15763.61 },
  { canal: ROTA, tipo: "DISPONIBILIDADE_CUSTO_FIXO", valor: 0 },
  { canal: ROTA, tipo: "DISPONIBILIDADE_EQUIPE", valor: 91321.65 },
  { canal: ROTA, tipo: "DISPONIBILIDADE_INDIRETO", valor: 0 },
  { canal: ROTA, tipo: "DISPONIBILIDADE_FATOR_AJUDANTE", valor: 320.85 },
  { canal: ROTA, tipo: "FRETE_MINIMO", valor: 14050.54 },
];

describe("basesDaQuinzena", () => {
  it("o frete mínimo é o complementar negativo — a 2ª quinzena fecha ao centavo", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, null, ROTA);

    expect(bases.devolucao).toBe(15763.61);
    /* Os quatro da disponibilidade somados, como o bloco do relatório os traz. */
    expect(bases.disponibilidade).toBe(91642.5);
    /* `Mapa Rota!AH140` traz exatamente este número, digitado à mão. */
    expect(bases.complementarNegativo).toBe(14050.54);
  });

  it("na 1ª quinzena não há bloco de disponibilidade, e ela fica null", () => {
    const bases = basesDaQuinzena(DESCONTOS_1A, null, ROTA);

    expect(bases.devolucao).toBe(13328.3);
    /*
      `null`, e não zero: o relatório da 1ª quinzena não traz o bloco
      `DESCONTO DISPONIBILIDADE`, e "não veio" é outra afirmação que "valeu
      zero". A planilha põe 11.649,87 nesta linha — o frete mínimo, que é o
      complementar —, e é essa discordância que a coluna `Diferença` mostra.
    */
    expect(bases.disponibilidade).toBeNull();
    expect(bases.complementarNegativo).toBe(11649.87);
  });

  it("sem demonstrativo, nenhuma base é inventada", () => {
    const bases = basesDaQuinzena(null, null, ROTA);

    expect(bases.devolucao).toBeNull();
    expect(bases.disponibilidade).toBeNull();
    expect(bases.complementarNegativo).toBeNull();
  });

  it("não empresta desconto de outro canal", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, null, "AS");

    expect(bases.devolucao).toBeNull();
    expect(bases.disponibilidade).toBeNull();
    expect(bases.complementarNegativo).toBeNull();
  });

  it("outros custos e indisponibilidade seguem sem origem, e dizem isso", () => {
    const bases = basesDaQuinzena(DESCONTOS_2A, null, ROTA);

    expect(bases.outrosCustos).toBeNull();
    expect(bases.indisponibilidade).toBeNull();
  });
});
