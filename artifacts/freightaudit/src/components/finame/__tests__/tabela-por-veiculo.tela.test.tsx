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

import { TooltipProvider } from "@/components/ui/tooltip";

import { TabelaDeFiname } from "../tabela";

/*
  `TooltipProvider` está aqui porque está em `App.tsx`, na raiz da aplicação: a
  justificativa escrita aparece num tooltip, e sem o provedor o Radix recusa a
  renderização. Montar a tabela sem ele testaria uma árvore que o produto não
  tem.
*/

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

const JUSTIFICADA = {
  id: "j1",
  changeSetId: "cs1",
  changeId: 2,
  entityLabel: "QYW6D15",
  entityType: "CAVALO",
  texto: "Contrato encerrado em julho.",
  criadoPor: "gestor@ambev.com.br",
  criadoEm: "2026-09-01T12:00:00.000Z",
};

const renderizar = (
  { onAbrir = vi.fn(), onJustificar = vi.fn(), comJustificativa = false } = {},
) => {
  render(
    <TooltipProvider>
      <TabelaDeFiname
        veiculos={agruparPorVeiculo(RECORTE)}
        justificadaPor={comJustificativa ? new Map([[2, JUSTIFICADA]]) : undefined}
        onAbrir={onAbrir}
        onJustificar={onJustificar}
      />
    </TooltipProvider>,
  );
  return { onAbrir, onJustificar };
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
    const { onAbrir } = renderizar();
    fireEvent.click(
      screen.getByRole("button", { name: /Abrir as alterações de QYQ5B02/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir detalhe completo" }));
    expect(onAbrir).toHaveBeenCalledWith(
      expect.objectContaining({ entityLabel: "QYQ5B02", entityType: "CAVALO" }),
    );
  });
});

describe("justificar direto na tabela", () => {
  it("justifica a placa inteira sem abrir a expansão junto", () => {
    const { onJustificar } = renderizar();
    fireEvent.click(
      screen.getByRole("button", { name: /Justificar as 2 alterações de QYW6D15/ }),
    );
    // As duas alterações da placa, num alvo só — mesmo texto para todas.
    expect(onJustificar).toHaveBeenCalledTimes(1);
    expect(onJustificar.mock.calls[0]![0]).toHaveLength(2);
    // O clique no botão não pode subir para a linha e abrir a expansão.
    expect(screen.queryByText("Parcela FINAME")).toBeNull();
  });

  it("justifica uma alteração sozinha, de dentro da expansão", () => {
    const { onJustificar } = renderizar();
    fireEvent.click(
      screen.getByRole("button", { name: /Abrir as alterações de QYW6D15/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Justificar Parcela FINAME de QYW6D15" }),
    );
    expect(onJustificar).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1, attributeName: "Parcela FINAME" }),
    ]);
  });

  it("abre a justificativa que já existe para ser reescrita", () => {
    const { onJustificar } = renderizar({ comJustificativa: true });
    fireEvent.click(
      screen.getByRole("button", { name: /Abrir as alterações de QYW6D15/ }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reescrever a justificativa de Amortização de QYW6D15",
      }),
    );
    // O texto atual viaja junto: o diálogo abre com ele, dizendo o que substitui.
    expect(onJustificar).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 2 })],
      expect.objectContaining({ texto: "Contrato encerrado em julho." }),
    );
  });

  it("sem onJustificar, a coluna fica só de leitura", () => {
    cleanup();
    render(
      <TooltipProvider>
        <TabelaDeFiname veiculos={agruparPorVeiculo(RECORTE)} onAbrir={vi.fn()} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: /^Justificar/ })).toBeNull();
  });
});
