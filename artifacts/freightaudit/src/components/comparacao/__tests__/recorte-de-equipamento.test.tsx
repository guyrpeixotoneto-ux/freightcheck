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
// O controle ficou acima do par de vigências, porque é ele que manda no par:
// na aba Cavalo o seletor só oferece vigências que têm cavalo. O que estes
// casos prendem é o que ele promete — os três recortes, a troca, e a recusa
// honesta de abrir uma série que a unidade não tem.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecorteDeEquipamento,
  type RecorteDeTipo,
} from "../recorte-de-equipamento";

afterEach(cleanup);

function montar(
  valor: RecorteDeTipo,
  disponiveis: Record<RecorteDeTipo, boolean>,
) {
  const onValor = vi.fn();
  render(
    <RecorteDeEquipamento
      valor={valor}
      onValor={onValor}
      disponiveis={disponiveis}
      idPrefixo="finame"
    />,
  );
  return { onValor };
}

/** A unidade que entrega os dois equipamentos. */
const AMBOS: Record<RecorteDeTipo, boolean> = {
  TODOS: true,
  CAVALO: true,
  CARRETA: true,
};

describe("os três recortes", () => {
  it("escreve a cobertura como quem fala dela", () => {
    montar("TODOS", AMBOS);

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Cavalo + Carreta",
      "Cavalo",
      "Carreta",
    ]);
  });

  it("marca só o recorte aberto", () => {
    montar("CARRETA", AMBOS);

    expect(
      screen.getByRole("tab", { name: "Carreta" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Cavalo" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("troca de recorte com o valor que a página usa no filtro", () => {
    const { onValor } = montar("TODOS", AMBOS);
    /* Pelo nome exato: `/^Cavalo/` casaria também com "Cavalo + Carreta". */
    fireEvent.click(screen.getByRole("tab", { name: "Cavalo" }));

    expect(onValor).toHaveBeenCalledWith("CAVALO");
  });
});

describe("a série que a unidade não tem", () => {
  /* Nenhuma vigência da unidade cobre carreta: a aba não abre uma tela vazia —
     ela diz por quê, que é a mesma distinção entre "não mudou" e "não há" que o
     resto do produto faz. */
  const SO_CAVALO: Record<RecorteDeTipo, boolean> = {
    TODOS: true,
    CAVALO: true,
    CARRETA: false,
  };

  it("desabilita a aba sem vigência e explica a ausência", () => {
    montar("TODOS", SO_CAVALO);
    const carreta = screen.getByRole("tab", { name: "Carreta" });

    expect(carreta.hasAttribute("disabled")).toBe(true);
    expect(carreta.getAttribute("title")).toBe(
      "Nenhuma vigência desta unidade tem carreta. Importe o arquivo correspondente para auditá-lo aqui.",
    );
  });

  it("não deixa abrir o recorte vazio nem por clique", () => {
    const { onValor } = montar("TODOS", SO_CAVALO);
    fireEvent.click(screen.getByRole("tab", { name: "Carreta" }));

    expect(onValor).not.toHaveBeenCalled();
  });

  /* "Todos" nunca desabilita: mesmo zerado, ele é a tela que já existia. */
  it("mantém Cavalo + Carreta sempre disponível", () => {
    montar("TODOS", { TODOS: true, CAVALO: false, CARRETA: false });

    expect(
      screen.getByRole("tab", { name: /Cavalo \+ Carreta/ }).hasAttribute("disabled"),
    ).toBe(false);
  });
});
