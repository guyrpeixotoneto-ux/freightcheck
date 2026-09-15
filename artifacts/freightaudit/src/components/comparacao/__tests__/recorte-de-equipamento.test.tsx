// @vitest-environment jsdom
//
// O RECORTE POR EQUIPAMENTO — AS ABAS CAVALO E CARRETA.
//
// O pedido, de 15/09/2026, com a Auditoria de FINAME aberta: *"não seria melhor
// termos a aba Cavalo e a aba Carreta? assim eu poderia na aba cavalo ver tudo
// que eh de cavalo e aba carreta tudo que é carreta"*. O recorte já existia —
// um seletor "Tipo de equipamento" na fileira de filtros da tabela — e quem
// pediu estava com ele a um palmo do cursor, o que é o argumento inteiro: um
// eixo de leitura escondido entre refinamentos não é um eixo.
//
// O que estes casos prendem é o que o controle promete: os três recortes, o
// número de cada um, e a recusa honesta de abrir um que não tem veículo.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecorteDeEquipamento,
  type RecorteDeTipo,
} from "../recorte-de-equipamento";

afterEach(cleanup);

function montar(
  valor: RecorteDeTipo,
  contagens: Record<RecorteDeTipo, number>,
) {
  const onValor = vi.fn();
  render(
    <RecorteDeEquipamento
      valor={valor}
      onValor={onValor}
      contagens={contagens}
      idPrefixo="finame"
    />,
  );
  return { onValor };
}

const AMBOS: Record<RecorteDeTipo, number> = {
  TODOS: 135,
  CAVALO: 68,
  CARRETA: 67,
};

describe("os três recortes", () => {
  it("escreve a cobertura como quem fala dela, com o tamanho de cada uma", () => {
    montar("TODOS", AMBOS);

    expect(screen.getByRole("tab", { name: /Cavalo \+ Carreta/ }).textContent).toContain(
      "135",
    );
    expect(screen.getByRole("tab", { name: /^Cavalo 68$/ }).textContent).toContain("68");
    expect(screen.getByRole("tab", { name: /^Carreta 67$/ }).textContent).toContain("67");
  });

  it("marca só o recorte aberto", () => {
    montar("CARRETA", AMBOS);

    expect(
      screen.getByRole("tab", { name: /^Carreta/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: /^Cavalo 68$/ }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("troca de recorte com o valor que a página usa no filtro", () => {
    const { onValor } = montar("TODOS", AMBOS);
    /* `/^Cavalo/` sozinho casaria também com "Cavalo + Carreta": o dígito
       depois do nome é o que separa a aba do tipo da aba do total. */
    fireEvent.click(screen.getByRole("tab", { name: /^Cavalo \d/ }));

    expect(onValor).toHaveBeenCalledWith("CAVALO");
  });
});

describe("o recorte que a comparação não tem", () => {
  /* O par só cobre cavalo: a aba Carreta não abre uma tela vazia — ela diz por
     quê, que é a mesma distinção entre "não mudou" e "não há" que o resto do
     produto faz. */
  const SO_CAVALO: Record<RecorteDeTipo, number> = {
    TODOS: 135,
    CAVALO: 135,
    CARRETA: 0,
  };

  it("desabilita a aba sem veículo e explica a ausência", () => {
    montar("TODOS", SO_CAVALO);
    const carreta = screen.getByRole("tab", { name: /^Carreta/ });

    expect(carreta.hasAttribute("disabled")).toBe(true);
    expect(carreta.getAttribute("title")).toBe(
      "Esta comparação não tem carreta. Importe o arquivo correspondente nas duas vigências para auditá-lo aqui.",
    );
  });

  it("não deixa abrir o recorte vazio nem por clique", () => {
    const { onValor } = montar("TODOS", SO_CAVALO);
    fireEvent.click(screen.getByRole("tab", { name: /^Carreta/ }));

    expect(onValor).not.toHaveBeenCalled();
  });

  /* "Todos" nunca desabilita: mesmo zerado, ele é a tela que já existia. */
  it("mantém Cavalo + Carreta sempre disponível", () => {
    montar("TODOS", { TODOS: 0, CAVALO: 0, CARRETA: 0 });

    expect(
      screen.getByRole("tab", { name: /Cavalo \+ Carreta/ }).hasAttribute("disabled"),
    ).toBe(false);
  });
});
