// @vitest-environment jsdom
//
// A coluna de justificativa das tabelas de rubrica, provada sobre a tabela de
// IPVA — que é a mesma tabela das outras cinco, com outra rubrica.
//
// Três regras vivem aqui, e nenhuma é cosmética:
//
// 1. **só a linha alterada é cobrada.** Um conflito ou um dado incompleto é a
//    recusa do motor em afirmar que houve alteração; um botão "Justificar" ali
//    cobraria explicação de uma alteração que ninguém afirmou.
// 2. **o clique da célula é da célula.** A linha inteira abre o detalhe do
//    veículo; sem parar a propagação, justificar abriria a gaveta por cima do
//    diálogo.
// 3. **sem `onJustificar` a coluna é só de leitura** — é o que mantém a tabela
//    usável onde justificar não faz sentido, sem um botão que não grava.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LinhaDeIpva } from "@workspace/comparison/ipva";
import { agruparPorVeiculoDeIpva } from "@workspace/comparison/ipva";

import { TooltipProvider } from "@/components/ui/tooltip";
import { TabelaDeIpva } from "@/components/ipva/tabela";
import type { Justificativa } from "@/lib/justificativas";

afterEach(cleanup);

const linha = (over: Partial<LinhaDeIpva> = {}): LinhaDeIpva => ({
  id: 1,
  entityLabel: "QYW6D15",
  entityType: "CAVALO",
  variavel: "ipva",
  rotuloDaVariavel: "IPVA / Licenciamento",
  medida: "DINHEIRO",
  attributeCode: "cavalo.ipva_licenciamento",
  base: "15106.89",
  comparada: "2485.87",
  diferenca: -12621.02,
  variacao: -83.55,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: -12621.02,
  impactoPeriodicidade: "ANUAL",
  impactoCalculado: true,
  foraDaSoma: null,
  ...over,
});

const JUSTIFICADA: Justificativa = {
  id: "j1",
  changeSetId: "cs1",
  changeId: 1,
  entityLabel: "QYW6D15",
  entityType: "CAVALO",
  texto: "Conforme a regra: o IPVA acompanha a tabela do estado de emplacamento.",
  formula: "IPVA = alíquota do estado × valor de NF",
  regra: "O IPVA acompanha a tabela do estado de emplacamento.",
  conforme: true,
  naoConformidade: null,
  motivoExcecao: null,
  responsavelAprovacao: null,
  criadoPor: "gestor@ambev.com.br",
  criadoEm: "2026-09-01T12:00:00.000Z",
};

/*
  A coluna mora na expansão da placa desde que a tabela passou a listar veículos
  em vez de variáveis: a justificativa é de **uma alteração**, e alteração é o
  que a expansão mostra. Por isso todo caso abre a placa antes de olhar — é o
  mesmo clique que quem audita dá.
*/
const renderizar = (
  linhas: LinhaDeIpva[],
  { comJustificativa = false, onJustificar = vi.fn(), onAbrir = vi.fn(), abrir = true } = {},
) => {
  render(
    <TooltipProvider>
      <TabelaDeIpva
        veiculos={agruparPorVeiculoDeIpva(linhas)}
        justificadaPor={comJustificativa ? new Map([[1, JUSTIFICADA]]) : undefined}
        onAbrir={onAbrir}
        onJustificar={onJustificar}
      />
    </TooltipProvider>,
  );
  if (abrir) {
    fireEvent.click(screen.getByRole("button", { name: /^Abrir as alterações de/ }));
  }
  return { onJustificar, onAbrir };
};

describe("a coluna de justificativa da tabela de rubrica", () => {
  it("tem cabeçalho próprio, como as demais colunas", () => {
    renderizar([linha()], { abrir: false });
    expect(screen.getByRole("columnheader", { name: "Justificativa" })).toBeTruthy();
  });

  it("cobra a alteração pendente, e manda o que mudou junto", () => {
    const { onJustificar } = renderizar([linha()]);
    fireEvent.click(
      screen.getByRole("button", { name: "Justificar IPVA / Licenciamento de QYW6D15" }),
    );
    expect(onJustificar).toHaveBeenCalledWith([
      {
        id: 1,
        entityLabel: "QYW6D15",
        attributeCode: "cavalo.ipva_licenciamento",
        attributeName: "IPVA / Licenciamento",
        valueBefore: "15106.89",
        valueAfter: "2485.87",
        deltaAbsolute: -12621.02,
        deltaPercent: -83.55,
      },
    ]);
  });

  /* O clique da célula não pode abrir a gaveta do veículo por baixo do diálogo. */
  it("justificar não abre o detalhe da linha", () => {
    const { onAbrir } = renderizar([linha()]);
    fireEvent.click(
      screen.getByRole("button", { name: "Justificar IPVA / Licenciamento de QYW6D15" }),
    );
    expect(onAbrir).not.toHaveBeenCalled();
  });

  it("a linha que o motor não deu como alterada não é cobrada", () => {
    renderizar([linha({ estado: "CONFLITO", motivo: "Duas linhas para a mesma placa." })]);
    expect(screen.queryByRole("button", { name: /^Justificar/ })).toBeNull();
  });

  it("a que já tem justificativa mostra o texto, e reabre para reescrever", () => {
    const { onJustificar } = renderizar([linha()], { comJustificativa: true });
    const botao = screen.getByRole("button", {
      name: "Reescrever a justificativa de IPVA / Licenciamento de QYW6D15",
    });
    expect(botao.textContent).toContain("Conforme a regra");
    fireEvent.click(botao);
    /* Só a alteração: o que já está gravado o diálogo procura por `change.id`
       no mapa da página — ver `AbrirJustificativa`. */
    expect(onJustificar).toHaveBeenCalledWith([expect.objectContaining({ id: 1 })]);
  });

  it("sem onJustificar a coluna é só de leitura", () => {
    render(
      <TooltipProvider>
        <TabelaDeIpva veiculos={agruparPorVeiculoDeIpva([linha()])} onAbrir={vi.fn()} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Abrir as alterações de/ }));
    expect(screen.queryByRole("button", { name: /^Justificar/ })).toBeNull();
    /* Duas vezes: a linha da placa resume o que falta, e a célula da alteração
       diz o mesmo sobre a linha dela. */
    expect(screen.getAllByText("Sem justificativa").length).toBe(2);
  });
});
