// @vitest-environment jsdom
//
// A BUSCA DO MONITOR NÃO PERGUNTA A CADA TECLA — E NÃO MENTE ENQUANTO ESPERA.
//
// O recorte da tela vai na chave das candidatas, porque o número do menu tem de
// ser o número que o clique entrega. A conta disso é que "carreta" dispararia
// sete rodadas de uma rota que pode custar oito segundos por chamada, e seis
// delas são perguntas que ninguém queria fazer.
//
// Esperar a pausa resolve a primeira metade. A segunda é a que um debounce
// ingênuo erra: durante a espera, o que está na mão responde ao **texto
// anterior**. Deixá-lo em tela não é mostrar um número velho — é mostrar um
// número de outra pergunta, ao lado de uma tela que já respondeu à nova. É
// para essa janela que existe `emTransito`.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ESPERA_DA_BUSCA_MS, useTextoAdiado } from "../use-candidatos-do-par";

/** O que a tela faria com o par: o recorte que vai à rota, e o aviso. */
function Tela({ busca }: { busca: string }) {
  const adiado = useTextoAdiado(busca);
  return (
    <>
      <span data-testid="recorte">{adiado.valor}</span>
      <span data-testid="transito">{adiado.emTransito ? "esqueleto" : "numeros"}</span>
    </>
  );
}

const recorte = () => screen.getByTestId("recorte").textContent;
const mostra = () => screen.getByTestId("transito").textContent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a busca adiada das candidatas", () => {
  /* Abrir a tela com um filtro no endereço não é alguém digitando. */
  it("o primeiro valor vale na hora, e sem esqueleto", () => {
    render(<Tela busca="carreta" />);

    expect(recorte()).toBe("carreta");
    expect(mostra()).toBe("numeros");
  });

  it("digitar sete teclas produz um recorte só, o do texto inteiro", () => {
    const { rerender } = render(<Tela busca="" />);

    for (const parcial of ["c", "ca", "car", "carr", "carre", "carret", "carreta"]) {
      rerender(<Tela busca={parcial} />);
      /* Entre uma tecla e outra passa menos do que a pausa. */
      act(() => void vi.advanceTimersByTime(ESPERA_DA_BUSCA_MS / 4));
    }

    /* Nada foi perguntado ainda: o recorte continua o de antes da digitação. */
    expect(recorte()).toBe("");

    act(() => void vi.advanceTimersByTime(ESPERA_DA_BUSCA_MS));
    expect(recorte()).toBe("carreta");
  });

  /**
   * A metade que importa numa tela de auditoria: enquanto espera, o menu diz
   * "está vindo", e não um número.
   */
  it("enquanto a busca não assenta, o menu não mostra número nenhum", () => {
    const { rerender } = render(<Tela busca="" />);
    expect(mostra()).toBe("numeros");

    rerender(<Tela busca="carreta" />);
    expect(mostra()).toBe("esqueleto");
    /* E o que está na mão continua sendo o do texto anterior — por isso o
       esqueleto: quem chama troca os dados por `undefined` nesta janela. */
    expect(recorte()).toBe("");

    act(() => void vi.advanceTimersByTime(ESPERA_DA_BUSCA_MS));
    expect(mostra()).toBe("numeros");
    expect(recorte()).toBe("carreta");
  });

  /* Apagar até o começo é um gesto como outro qualquer, e assenta igual. */
  it("limpar a busca também passa pela pausa, e volta ao recorte vazio", () => {
    const { rerender } = render(<Tela busca="carreta" />);

    rerender(<Tela busca="" />);
    expect(mostra()).toBe("esqueleto");

    act(() => void vi.advanceTimersByTime(ESPERA_DA_BUSCA_MS));
    expect(recorte()).toBe("");
    expect(mostra()).toBe("numeros");
  });
});
