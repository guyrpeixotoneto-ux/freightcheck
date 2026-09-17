// @vitest-environment jsdom
//
// A JUSTIFICATIVA EM LOTE — as regras que a tela tem de sustentar sozinha.
//
// Cinco delas vivem aqui, e nenhuma é cosmética:
//
// 1. **desligado, a tabela é a de antes.** Sem coluna de caixas, sem largura a
//    mais. Quem entra para ler o que mudou não paga por uma ação que não pediu.
// 2. **a caixa marca alterações, não a placa.** É a alteração que recebe
//    justificativa; uma placa pode ter quatro, e uma placa sem nenhuma
//    justificável recebe caixa desabilitada — nunca célula vazia, que se leria
//    como "esqueceram desta linha".
// 3. **conflito e dado incompleto não entram**, nem marcando a placa inteira.
//    É a mesma regra da coluna de justificar, e é ela que impede o lote de
//    "explicar" o que o motor se recusou a afirmar.
// 4. **a caixa do cabeçalho é dos visíveis.** "Todos os resultados" é outra
//    operação, com outras palavras e outro registro, e a distinção entre as
//    duas é o centro desta funcionalidade.
// 5. **nada selecionado, nada a justificar.** O botão primário fica
//    desabilitado — um botão que abre uma caixa para gravar em coisa nenhuma é
//    um convite a um 400.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LinhaDeIpva } from "@workspace/comparison/ipva";
import { agruparPorVeiculoDeIpva } from "@workspace/comparison/ipva";

import { TooltipProvider } from "@/components/ui/tooltip";
import { TabelaDeIpva } from "@/components/ipva/tabela";
import { BarraDoLote } from "@/components/justificativas/barra-do-lote";

afterEach(cleanup);

const linha = (over: Partial<LinhaDeIpva> = {}): LinhaDeIpva => ({
  id: 1,
  entityLabel: "RPG0C44",
  entityType: "CAVALO",
  variavel: "ipva",
  rotuloDaVariavel: "IPVA / Licenciamento",
  medida: "DINHEIRO",
  attributeCode: "cavalo.ipva_licenciamento",
  base: "7210.00",
  comparada: "4145.26",
  diferenca: -3064.74,
  variacao: -42.51,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: -3064.74,
  impactoPeriodicidade: "ANUAL",
  impactoCalculado: true,
  foraDaSoma: null,
  ...over,
});

function tabela(linhas: LinhaDeIpva[], selecao?: Parameters<typeof TabelaDeIpva>[0]["selecao"]) {
  return render(
    <TooltipProvider>
      <TabelaDeIpva
        veiculos={agruparPorVeiculoDeIpva(linhas)}
        selecao={selecao}
        onAbrir={() => {}}
        onJustificar={() => {}}
      />
    </TooltipProvider>,
  );
}

/** As caixas da tabela, sem as de dentro de tooltip nenhum. */
const caixas = () => screen.queryAllByRole("checkbox");

describe("a coluna de seleção", () => {
  it("não existe com o modo desligado", () => {
    tabela([linha()]);
    expect(caixas()).toHaveLength(0);
    expect(screen.getByText("RPG0C44")).toBeTruthy();
  });

  it("aparece com o modo ligado, uma por linha mais a do cabeçalho", () => {
    tabela([linha({ id: 1, entityLabel: "A" }), linha({ id: 2, entityLabel: "B" })], {
      marcadas: new Set(),
      onMarcar: () => {},
    });
    expect(caixas()).toHaveLength(3);
  });

  it("marca as alterações da placa, e não a placa", () => {
    const onMarcar = vi.fn();
    tabela(
      [
        linha({ id: 7, entityLabel: "A", variavel: "ipva" }),
        linha({
          id: 8,
          entityLabel: "A",
          variavel: "licenciamento",
          rotuloDaVariavel: "Licenciamento",
          attributeCode: "cavalo.licenciamento",
        }),
      ],
      { marcadas: new Set(), onMarcar },
    );
    /* A do cabeçalho é a primeira; a da linha é a segunda. */
    fireEvent.click(caixas()[1]!);
    expect(onMarcar).toHaveBeenCalledWith([7, 8], true);
  });

  it("deixa fora o que o motor não afirmou ser alteração", () => {
    const onMarcar = vi.fn();
    tabela(
      [
        linha({ id: 7, entityLabel: "A" }),
        linha({
          id: 8,
          entityLabel: "A",
          variavel: "licenciamento",
          rotuloDaVariavel: "Licenciamento",
          attributeCode: "cavalo.licenciamento",
          estado: "CONFLITO",
          motivo: "A coluna mudou de tipo entre as duas vigências.",
        }),
      ],
      { marcadas: new Set(), onMarcar },
    );
    fireEvent.click(caixas()[1]!);
    expect(onMarcar).toHaveBeenCalledWith([7], true);
  });

  it("desabilita a caixa da placa sem nada a justificar — e não a esconde", () => {
    tabela([linha({ id: 9, entityLabel: "A", estado: "CONFLITO", motivo: "conflito" })], {
      marcadas: new Set(),
      onMarcar: () => {},
    });
    const daLinha = caixas()[1]!;
    expect(daLinha.hasAttribute("disabled")).toBe(true);
  });

  it("a caixa do cabeçalho alcança as linhas visíveis, e só elas", () => {
    const onMarcar = vi.fn();
    tabela(
      [linha({ id: 1, entityLabel: "A" }), linha({ id: 2, entityLabel: "B" })],
      { marcadas: new Set(), onMarcar },
    );
    fireEvent.click(caixas()[0]!);
    expect(onMarcar).toHaveBeenCalledWith([1, 2], true);
  });

  it("parcialmente marcada, a do cabeçalho marca o resto em vez de desfazer", () => {
    const onMarcar = vi.fn();
    tabela(
      [linha({ id: 1, entityLabel: "A" }), linha({ id: 2, entityLabel: "B" })],
      { marcadas: new Set([1]), onMarcar },
    );
    fireEvent.click(caixas()[0]!);
    expect(onMarcar).toHaveBeenCalledWith([1, 2], true);
  });

  it("a linha marcada se distingue da linha apenas aberta", () => {
    const { container } = tabela([linha({ id: 1, entityLabel: "A" })], {
      marcadas: new Set([1]),
      onMarcar: () => {},
    });
    const linhaDaPlaca = within(container).getByText("A").closest("tr")!;
    expect(linhaDaPlaca.className).toContain("bg-brand");
  });
});

describe("a barra de ações", () => {
  const props = {
    selecionadas: 5,
    totalDoRecorte: 206,
    todosOsResultados: false,
    recorteMudou: false,
    iguais: 0,
    onTodosOsResultados: () => {},
    onIguais: () => {},
    onCancelar: () => {},
    onJustificar: () => {},
  };

  it("conta o que está marcado e oferece o recorte inteiro pelo número real", () => {
    render(<BarraDoLote {...props} />);
    expect(screen.getByText("5 selecionados")).toBeTruthy();
    expect(screen.getByText("Selecionar todos os 206 resultados")).toBeTruthy();
  });

  it("no singular, não escreve “1 selecionados”", () => {
    render(<BarraDoLote {...props} selecionadas={1} />);
    expect(screen.getByText("1 selecionado")).toBeTruthy();
  });

  it("com o recorte inteiro ligado, diz isso — e não “206 selecionados”", () => {
    render(<BarraDoLote {...props} selecionadas={206} todosOsResultados />);
    expect(screen.getByText("Todos os 206 resultados selecionados")).toBeTruthy();
    expect(screen.queryByText("Selecionar todos os 206 resultados")).toBeNull();
  });

  it("sem nada marcado, o botão primário não abre caixa nenhuma", () => {
    render(<BarraDoLote {...props} selecionadas={0} />);
    expect(
      screen.getByRole("button", { name: "Justificar selecionados" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("avisa quando o filtro mudou por baixo de uma seleção global", () => {
    render(<BarraDoLote {...props} selecionadas={0} recorteMudou />);
    expect(screen.getByText(/os filtros mudaram/i)).toBeTruthy();
  });

  it("a seleção rápida só aparece quando há iguais a oferecer", () => {
    const { rerender } = render(<BarraDoLote {...props} />);
    expect(screen.queryByText(/Selecionar alterações iguais/)).toBeNull();
    rerender(<BarraDoLote {...props} iguais={38} />);
    expect(screen.getByText("Selecionar alterações iguais (38)")).toBeTruthy();
  });
});
