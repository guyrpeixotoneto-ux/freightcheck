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

import { CartoesDaEvolucao } from "../evolucao/cartoes";
import type { EvolucaoPorPlaca } from "@/lib/evolucao-por-placa";
import type { PontaAPonta } from "@/lib/analise";

afterEach(cleanup);

/* A rubrica entra só nas frases das dicas: nenhum número desta prova depende
   dela, e é justamente isso que se quer — o cartão é o mesmo nas quatro telas. */
const RUBRICA = { rubrica: "FINAME", semValoracao: "taxa, prazo, carência" };

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
      <CartoesDaEvolucao evolucao={EVOLUCAO} ponta={PONTA} carregandoPonta={false} {...RUBRICA} />,
    );

    expect(screen.getByText(/Impacto líquido dos movimentos/)).toBeTruthy();
    expect(screen.getByText("soma das células")).toBeTruthy();

    expect(screen.getByText(/Variação ponta a ponta/)).toBeTruthy();
    expect(screen.getByText("dezembro/2025 → setembro/2026")).toBeTruthy();
  });

  it("escreve a diferença entre as duas contas em vez de deixá-la ao leitor", () => {
    render(
      <CartoesDaEvolucao evolucao={EVOLUCAO} ponta={PONTA} carregandoPonta={false} {...RUBRICA} />,
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
      <CartoesDaEvolucao evolucao={EVOLUCAO} ponta={PONTA} carregandoPonta={false} {...RUBRICA} />,
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
      <CartoesDaEvolucao evolucao={EVOLUCAO} ponta={semMensal} carregandoPonta={false} {...RUBRICA} />,
    );

    expect(screen.getByText("sem valor nesta grandeza")).toBeTruthy();
  });

  it("enquanto a ponta a ponta carrega, o cartão não inventa um número", () => {
    render(
      <CartoesDaEvolucao evolucao={EVOLUCAO} ponta={null} carregandoPonta={true} {...RUBRICA} />,
    );

    expect(screen.getByText("Comparando as duas pontas do ano…")).toBeTruthy();
    /* O líquido dos movimentos continua lá: uma leitura não espera a outra. */
    expect(screen.getByText(/Impacto líquido dos movimentos/)).toBeTruthy();
  });

  /*
    O defeito que a prova no navegador das telas de Seguro e de Manutenção
    mostrou: as duas fecham o ano com "0 valoradas · 118 sem valoração" no
    terceiro cartão e um "R$ 0" enorme no primeiro. Os dois números estão certos
    e juntos dizem a coisa errada — o R$ 0 lê-se como "nada se moveu", quando o
    que houve foram 118 movimentos que o motor não sabe precificar.
  */
  it("com nada precificado, o líquido diz isso em vez de escrever R$ 0", () => {
    const semPreco = {
      ...EVOLUCAO,
      totais: {
        ...EVOLUCAO.totais,
        liquido: 0,
        ganho: 0,
        perda: 0,
        alteracoes: 118,
        alteracoesSemValoracao: 118,
        alteracoesEmOutraPeriodicidade: 0,
      },
    } as unknown as EvolucaoPorPlaca;

    render(
      <CartoesDaEvolucao evolucao={semPreco} ponta={PONTA} carregandoPonta={false} {...RUBRICA} />,
    );
    expect(screen.getByText("sem impacto precificável")).toBeTruthy();
    /* E o R$ 0 não pode aparecer no lugar do valor. */
    expect(screen.queryByText("R$ 0")).toBeNull();
    /* A frase diz quantas foram e por que não têm preço. */
    expect(screen.getByText(/não viram reais/)).toBeTruthy();
  });
});
