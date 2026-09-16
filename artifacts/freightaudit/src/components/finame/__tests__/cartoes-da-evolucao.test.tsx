// @vitest-environment jsdom
//
// OS DOIS IMPACTOS DA EVOLUÇÃO ANUAL DO FINAME.
//
// A decisão que estes casos prendem é de produto, e foi tomada contra o desenho
// original: o mockup pedia um cartão só, "Impacto acumulado". São duas contas —
// a soma dos movimentos e a variação ponta a ponta — e um rótulo só teria de
// escolher uma e calar a outra.
//
// O que se verifica aqui não é layout: é que os dois números aparecem, que cada
// um diz qual régua o produziu, e que a diferença entre eles vem escrita em vez
// de ficar por conta do leitor.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CartoesDaEvolucaoDeFiname } from "../evolucao/cartoes";
import type { EvolucaoPorPlaca } from "@/lib/evolucao-por-placa";
import type { PontaAPonta } from "@/lib/analise";

afterEach(cleanup);

/** Os números do mockup: movimentos +550, ponta a ponta +1.000. */
const EVOLUCAO = {
  periodicidade: "MENSAL",
  colunas: [{ period: "2026-01-16", label: "jan", comparisons: 1, alteracoes: 5 }],
  totais: {
    ativos: 5,
    frota: 137,
    comPerda: 2,
    comGanho: 3,
    comPendencia: 4,
    alteracoesSemValoracao: 8,
    alteracoesEmOutraPeriodicidade: 1,
    alteracoes: 21,
    perda: -1900,
    ganho: 2450,
    liquido: 550,
  },
} as unknown as EvolucaoPorPlaca;

const PONTA = {
  fromLabel: "dezembro/2025",
  toLabel: "setembro/2026",
  fleet: { added: 0, removed: 1 },
  reverted: [
    { attributeCode: "cavalo.finame_cavalo", title: "Parcela", equipment: "CAVALO", parameterKey: "x", entities: 1, periods: 2 },
    { attributeCode: "cavalo.taxa_finame", title: "Taxa", equipment: "CAVALO", parameterKey: "y", entities: 1, periods: 2 },
  ],
  impact: { byPeriodicity: { MENSAL: 1000 }, notCalculable: 0 },
} as unknown as PontaAPonta;

describe("os dois impactos", () => {
  it("aparecem como dois cartões, com a régua de cada um dita", () => {
    render(
      <CartoesDaEvolucaoDeFiname evolucao={EVOLUCAO} ponta={PONTA} carregandoPonta={false} />,
    );

    expect(screen.getByText(/Impacto líquido dos movimentos/)).toBeTruthy();
    expect(screen.getByText("soma das células")).toBeTruthy();

    expect(screen.getByText(/Variação ponta a ponta/)).toBeTruthy();
    expect(screen.getByText("dezembro/2025 → setembro/2026")).toBeTruthy();
  });

  it("escreve a diferença entre as duas contas em vez de deixá-la ao leitor", () => {
    render(
      <CartoesDaEvolucaoDeFiname evolucao={EVOLUCAO} ponta={PONTA} carregandoPonta={false} />,
    );

    /* Duas rubricas voltaram ao ponto de partida e um veículo saiu da frota —
       é exatamente por isso que os dois números diferem. */
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("rubricas voltaram");
    expect(texto).toContain("saíram e");
    expect(texto).toContain("não entram nesta conta");
  });

  it("os quatro baldes das alterações fecham com o total", () => {
    render(
      <CartoesDaEvolucaoDeFiname evolucao={EVOLUCAO} ponta={PONTA} carregandoPonta={false} />,
    );

    /* 21 = 12 valoradas + 8 sem valoração + 1 em outra grandeza. A identidade é
       o que faz a tela explicar as alterações que promete — sem ela, um balde
       some e ninguém percebe. */
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("21");
    expect(texto).toContain("12 valoradas");
    expect(texto).toContain("8 sem valoração");
    expect(texto).toContain("1 em outra grandeza");
  });

  it("sem valor na grandeza aberta, diz isso — e nunca escreve R$ 0", () => {
    const semMensal = {
      ...PONTA,
      impact: { byPeriodicity: { ANUAL: 900 }, notCalculable: 0 },
    } as unknown as PontaAPonta;
    render(
      <CartoesDaEvolucaoDeFiname evolucao={EVOLUCAO} ponta={semMensal} carregandoPonta={false} />,
    );

    expect(screen.getByText("sem valor nesta grandeza")).toBeTruthy();
  });

  it("enquanto a ponta a ponta carrega, o cartão não inventa um número", () => {
    render(
      <CartoesDaEvolucaoDeFiname evolucao={EVOLUCAO} ponta={null} carregandoPonta={true} />,
    );

    expect(screen.getByText("Comparando as duas pontas do ano…")).toBeTruthy();
    /* O líquido dos movimentos continua lá: uma leitura não espera a outra. */
    expect(screen.getByText(/Impacto líquido dos movimentos/)).toBeTruthy();
  });
});
