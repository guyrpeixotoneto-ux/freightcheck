// @vitest-environment jsdom
//
// A CAIXA DE APLICAR UMA JUSTIFICATIVA A VÁRIAS ALTERAÇÕES.
//
// O que ela tem de sustentar, e que nenhuma outra tela sustenta por ela:
//
// 1. **o resumo só afirma o que é verdade para todas.** Um cabeçalho que
//    escrevesse "R$ 7.210,00 → R$ 4.145,26" sobre uma seleção com valores
//    diferentes convidaria a explicar um fato que vale para parte do que vai
//    ser gravado — o risco central desta funcionalidade.
// 2. **a frase do rodapé é a que evita o engano da palavra "lote".** O que vai
//    acontecer não é "uma justificativa do conjunto": é a mesma justificativa
//    gravada em cada alteração, individualmente.
// 3. **o que já está explicado não é tocado**, e a porta para substituí-lo está
//    fechada — e some inteira para quem não administra contas.
// 4. **os campos são os mesmos da justificativa individual**, cobrados pela
//    mesma regra: sem fórmula, sem regra e sem conformidade, não grava.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumoDoLote } from "@workspace/comparison/justificativa-em-lote";

import { JustificarEmLoteDialog } from "@/components/justificativas/justificar-em-lote-dialog";

afterEach(cleanup);

const RESUMO: ResumoDoLote = {
  total: 5,
  veiculos: 5,
  jaJustificadas: 0,
  variavel: "IPVA / Licenciamento",
  entityType: "CAVALO",
  base: "7210.00",
  comparada: "4145.26",
  baseEscrita: "R$ 7.210,00",
  comparadaEscrita: "R$ 4.145,26",
  mesmoContexto: true,
};

const props = {
  aberto: true,
  contexto: "comparação julho/2026 → agosto/2026",
  resumo: RESUMO,
  aplicaveis: 5,
  podeSobrescrever: false,
  universo: "5 alterações escolhidas a dedo",
  todosOsResultados: false,
  pendente: false,
  erro: null,
  onFechar: () => {},
  onConfirmar: () => {},
};

/** Preenche o mínimo que a justificativa exige para poder ser gravada. */
function preencher() {
  fireEvent.change(screen.getByPlaceholderText(/como o valor deve ser calculado/i), {
    target: { value: "IPVA = valor de nota × alíquota" },
  });
  fireEvent.change(screen.getByPlaceholderText(/quando esta variável pode ser alterada/i), {
    target: { value: "Muda quando a alíquota do estado muda." },
  });
  fireEvent.click(screen.getByRole("radio", { name: /sim/i }));
}

describe("o cabeçalho e o resumo", () => {
  it("diz a quantas alterações a justificativa vai", () => {
    render(<JustificarEmLoteDialog {...props} />);
    expect(screen.getByText("Aplicar justificativa a 5 alterações")).toBeTruthy();
    expect(screen.getByText("comparação julho/2026 → agosto/2026")).toBeTruthy();
  });

  it("afirma os valores quando eles são os mesmos em todas", () => {
    render(<JustificarEmLoteDialog {...props} />);
    expect(screen.getByText("Valor anterior")).toBeTruthy();
    /* Escritos como a tabela os escreve, e não como o banco os guarda. */
    expect(screen.getByText("R$ 7.210,00")).toBeTruthy();
    expect(screen.getByText("R$ 4.145,26")).toBeTruthy();
  });

  it("se cala sobre o valor quando o conjunto tem mais de um", () => {
    render(
      <JustificarEmLoteDialog
        {...props}
        resumo={{ ...RESUMO, comparada: null, comparadaEscrita: null, mesmoContexto: false }}
      />,
    );
    expect(screen.getByText("Valor anterior")).toBeTruthy();
    expect(screen.queryByText("Valor atual")).toBeNull();
  });

  it("mostra o universo que vai ficar registrado", () => {
    render(
      <JustificarEmLoteDialog
        {...props}
        todosOsResultados
        universo="todos os resultados do recorte: rubrica ipva, par v1 → v2, estado ALTERADO"
      />,
    );
    expect(screen.getByText(/Recorte gravado/)).toBeTruthy();
    expect(screen.getByText(/estado ALTERADO/)).toBeTruthy();
  });
});

describe("o que já está justificado", () => {
  const comJustificadas = {
    ...props,
    resumo: { ...RESUMO, jaJustificadas: 2 },
    aplicaveis: 3,
  };

  it("é contado, e por padrão fica de fora do que vai ser gravado", () => {
    render(<JustificarEmLoteDialog {...comJustificadas} />);
    expect(screen.getByText(/2 de 5 já estão justificadas/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aplicar a 3 alterações" })).toBeTruthy();
  });

  it("a porta de substituir não existe para quem não administra contas", () => {
    render(<JustificarEmLoteDialog {...comJustificadas} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/ação de administrador/i)).toBeTruthy();
  });

  it("marcada por um administrador, o alvo passa a ser o conjunto inteiro", () => {
    render(<JustificarEmLoteDialog {...comJustificadas} podeSobrescrever />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Aplicar a 5 alterações" })).toBeTruthy();
  });
});

describe("gravar", () => {
  it("não deixa gravar sem os campos que a rota exige", () => {
    render(<JustificarEmLoteDialog {...props} />);
    expect(
      screen.getByRole("button", { name: "Aplicar a 5 alterações" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("preenchido, grava sem substituir nada", () => {
    const onConfirmar = vi.fn();
    render(<JustificarEmLoteDialog {...props} onConfirmar={onConfirmar} />);
    preencher();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar a 5 alterações" }));
    expect(onConfirmar).toHaveBeenCalledWith(
      expect.objectContaining({
        formula: "IPVA = valor de nota × alíquota",
        conforme: true,
      }),
      false,
    );
  });

  it("diz, antes do clique, que a gravação é uma por alteração", () => {
    render(<JustificarEmLoteDialog {...props} />);
    expect(
      screen.getByText(
        /Esta justificativa será aplicada individualmente a 5 alterações selecionadas/,
      ),
    ).toBeTruthy();
  });
});
