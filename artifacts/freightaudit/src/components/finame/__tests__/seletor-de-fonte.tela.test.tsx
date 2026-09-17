// @vitest-environment jsdom
//
// DADOS ANALISADOS — o controle que diz qual fonte está em tela.
//
// O que se verifica aqui não é aparência: é que as duas opções são mutuamente
// exclusivas para quem lê com os olhos **e** para quem lê com leitor de tela,
// que não há uma terceira, e que a marcada é identificável sem depender de cor.
// Um segmento em que as duas estivessem marcadas — ou nenhuma — diria que a
// tela está mostrando as duas fontes ao mesmo tempo, que é a única coisa que
// ela nunca faz.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SeletorDeFonte } from "../seletor-de-fonte";

afterEach(cleanup);

describe("o seletor de fonte", () => {
  it("oferece duas opções, e exatamente duas", () => {
    render(<SeletorDeFonte valor="REMUNERADO" onValor={() => {}} />);
    const opcoes = screen.getAllByRole("radio");
    expect(opcoes).toHaveLength(2);
    expect(opcoes.map((o) => o.textContent)).toEqual(["Remunerado", "Real"]);
  });

  it("uma só fica marcada, e a marcada é a que se pediu", () => {
    render(<SeletorDeFonte valor="REAL" onValor={() => {}} />);
    expect(screen.getByRole("radio", { name: "Real" }).getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByRole("radio", { name: "Remunerado" }).getAttribute("aria-checked"),
    ).toBe("false");
  });

  /*
    Não é um liga/desliga. Um switch tem um estado padrão e um "outro", e estas
    duas fontes não são isso — são duas leituras legítimas. A distinção importa
    para leitor de tela: `switch` seria anunciado como "ativado/desativado", e a
    pessoa não saberia o nome da fonte que está vendo.
  */
  it("não é um switch", () => {
    render(<SeletorDeFonte valor="REMUNERADO" onValor={() => {}} />);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });

  it("o grupo se anuncia pelo próprio rótulo", () => {
    render(<SeletorDeFonte valor="REMUNERADO" onValor={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: /dados analisados/i })).toBeTruthy();
  });

  it("clicar na outra pede a troca — e clicar na marcada também avisa quem decide", () => {
    const onValor = vi.fn();
    render(<SeletorDeFonte valor="REMUNERADO" onValor={onValor} />);

    fireEvent.click(screen.getByRole("radio", { name: "Real" }));
    expect(onValor).toHaveBeenCalledWith("REAL");
  });

  /* O significado de cada fonte não fica só no seletor: o título de cada opção
     repete a frase da linha de contexto, para quem chega com o cursor antes de
     ler a página. */
  it("cada opção diz o que significa", () => {
    render(<SeletorDeFonte valor="REMUNERADO" onValor={() => {}} />);
    expect(screen.getByRole("radio", { name: "Real" }).getAttribute("title")).toContain(
      "efetivamente realizado",
    );
  });
});
