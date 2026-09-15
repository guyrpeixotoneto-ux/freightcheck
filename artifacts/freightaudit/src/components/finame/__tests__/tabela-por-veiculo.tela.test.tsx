// @vitest-environment jsdom
//
// A tabela de FINAME depois que a placa virou a linha.
//
// Antes, a mesma placa aparecia uma vez por variável: seis linhas de
// "Amortização" seguidas de seis de "Parcela FINAME", das mesmas seis placas,
// em páginas diferentes. O que estes casos prendem é o que o agrupamento
// prometeu: uma linha por placa, as alterações contadas nela, e **clicar
// abrindo as alterações daquela placa** — sem sair da página e sem trazer as
// linhas de outra.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LinhaDeFiname } from "@workspace/comparison/finame";
import { agruparPorVeiculo } from "@workspace/comparison/finame";

import { TabelaDeFiname } from "../tabela";

afterEach(cleanup);

const linha = (over: Partial<LinhaDeFiname> = {}): LinhaDeFiname => ({
  id: 1,
  entityLabel: "QYW6D15",
  entityType: "CAVALO",
  variavel: "parcela",
  rotuloDaVariavel: "Parcela FINAME",
  medida: "DINHEIRO",
  attributeCode: "cavalo.finame_cavalo",
  base: "12070.55",
  comparada: "5891.26",
  diferenca: -6179.29,
  variacao: -51.19,
  estado: "ALTERADO",
  motivo: null,
  periodoFiname: "60",
  dataDeCadastro: "2019-05-10",
  impactoAmount: -6179.29,
  impactoPeriodicidade: "MENSAL",
  impactoCalculado: true,
  ...over,
});

const RECORTE = [
  linha(),
  linha({
    id: 2,
    variavel: "amortizacao",
    rotuloDaVariavel: "Amortização",
    attributeCode: "cavalo.amortizacao_cavalo",
    base: "10207.94",
    comparada: "0",
    diferenca: -10207.94,
    variacao: -100,
  }),
  linha({
    id: 3,
    entityLabel: "QYQ5B02",
    variavel: "amortizacao",
    rotuloDaVariavel: "Amortização",
    attributeCode: "cavalo.amortizacao_cavalo",
    base: "7700.16",
    comparada: "0",
    diferenca: -7700.16,
    variacao: -100,
    periodoFiname: "48",
    dataDeCadastro: "2020-02-03",
  }),
];

const renderizar = (onAbrir = vi.fn()) => {
  render(
    <TabelaDeFiname veiculos={agruparPorVeiculo(RECORTE)} onAbrir={onAbrir} />,
  );
  return onAbrir;
};

describe("a tabela por veículo", () => {
  it("lista uma linha por placa, e não uma por variável", () => {
    renderizar();
    // Três alterações, duas placas.
    expect(screen.getAllByText("QYW6D15")).toHaveLength(1);
    expect(screen.getAllByText("QYQ5B02")).toHaveLength(1);
    // Fechada, a placa não escreve as variáveis dela em lugar nenhum.
    expect(screen.queryByText("Parcela FINAME")).toBeNull();
  });

  it("conta as alterações da placa e mostra o contexto do veículo", () => {
    renderizar();
    const placa = screen.getByRole("button", {
      name: /Abrir as alterações de QYW6D15/,
    });
    expect(within(placa).getByText("2")).toBeTruthy();
    expect(within(placa).getByText("60 meses")).toBeTruthy();
    expect(within(placa).getByText("10/05/2019")).toBeTruthy();
  });

  it("abre as alterações daquela placa — e só as dela", () => {
    renderizar();
    fireEvent.click(
      screen.getByRole("button", { name: /Abrir as alterações de QYW6D15/ }),
    );
    expect(screen.getByText("Parcela FINAME")).toBeTruthy();
    // Duas linhas de "Amortização" no recorte, mas só uma é desta placa.
    expect(screen.getAllByText("Amortização")).toHaveLength(1);
  });

  it("fecha o que foi aberto, sem mexer nas outras placas", () => {
    renderizar();
    const alvo = screen.getByRole("button", {
      name: /Abrir as alterações de QYW6D15/,
    });
    fireEvent.click(alvo);
    fireEvent.click(
      screen.getByRole("button", { name: /Fechar as alterações de QYW6D15/ }),
    );
    expect(screen.queryByText("Parcela FINAME")).toBeNull();
    expect(screen.getByText("QYQ5B02")).toBeTruthy();
  });

  it("leva a placa certa para a gaveta do detalhe completo", () => {
    const onAbrir = renderizar();
    fireEvent.click(
      screen.getByRole("button", { name: /Abrir as alterações de QYQ5B02/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir detalhe completo" }));
    expect(onAbrir).toHaveBeenCalledWith(
      expect.objectContaining({ entityLabel: "QYQ5B02", entityType: "CAVALO" }),
    );
  });
});
