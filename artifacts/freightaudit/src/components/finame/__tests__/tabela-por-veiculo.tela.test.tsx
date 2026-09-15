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
import type { Justificativa } from "@/lib/justificativas";

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
  fimDoContrato: "2024-05-10",
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

const JUSTIFICADA: Justificativa = {
  id: "j1",
  changeSetId: "cs1",
  changeId: 2,
  entityLabel: "QYW6D15",
  entityType: "CAVALO",
  texto: "Conforme a regra: o valor acompanha o contrato de financiamento.",
  formula: "Amortização mensal = Valor financiado ÷ Prazo",
  regra: "O valor acompanha o contrato de financiamento.",
  conforme: true,
  motivoExcecao: null,
  responsavelAprovacao: null,
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
    expect(within(placa).getByText("10/05/2024")).toBeTruthy();
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

describe("o fim do contrato, que virou coluna", () => {
  /*
    O fim do contrato é do veículo, como o prazo e a data de cadastro: ele
    responde na linha da placa, e não numa linha da expansão no meio das outras
    treze — que era onde a data de 2026 ficava, longe da amortização em R$ 0,00
    que ela explica.
  */
  /* O contexto da vigência chega repetido em cada linha da placa, e é ele que a
     coluna lê: as linhas da QYW6D15 dizem todas o mesmo fim de contrato. */
  const COM_FIM = [
    ...RECORTE.map((l) =>
      l.entityLabel === "QYW6D15" ? { ...l, fimDoContrato: "2026-08-02" } : l,
    ),
    linha({
      id: 4,
      variavel: "data_fim_contrato",
      rotuloDaVariavel: "Fim do contrato",
      medida: "DATA",
      attributeCode: "cavalo.data_fim_contrato",
      base: "2021-08-02",
      comparada: "2026-08-02",
      diferenca: null,
      variacao: null,
      fimDoContrato: "2026-08-02",
      impactoAmount: null,
      impactoPeriodicidade: null,
      impactoCalculado: false,
    }),
  ];

  const renderizarComFim = () =>
    render(
      <TooltipProvider>
        <TabelaDeFiname veiculos={agruparPorVeiculo(COM_FIM)} onAbrir={vi.fn()} />
      </TooltipProvider>,
    );

  it("escreve a data na coluna da placa, ao lado da data de cadastro", () => {
    renderizarComFim();
    const placa = screen.getByRole("button", {
      name: /Abrir as alterações de QYW6D15/,
    });
    expect(within(placa).getByText("02/08/2026")).toBeTruthy();
  });

  it("sai da expansão — a coluna já o diz, e repetir é dizer duas vezes", () => {
    renderizarComFim();
    fireEvent.click(
      screen.getByRole("button", { name: /Abrir as alterações de QYW6D15/ }),
    );
    expect(screen.getByText("Parcela FINAME")).toBeTruthy();
    // O único "Fim do contrato" da tela é o título da coluna.
    expect(screen.getAllByText("Fim do contrato")).toHaveLength(1);
    expect(screen.getByText("Fim do contrato").tagName).toBe("TH");
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
    // A justificativa atual viaja junto: o diálogo abre com ela nos campos,
    // dizendo o que se está substituindo.
    expect(onJustificar).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 2 })],
      expect.objectContaining({
        regra: "O valor acompanha o contrato de financiamento.",
        conforme: true,
      }),
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

describe("o que conta como justificável", () => {
  /* A mesma placa com uma alteração e um conflito: o conflito é a recusa do
     motor em afirmar que houve alteração, e o que ele pede é o conserto do
     dado. Contá-lo poria a placa em "1 de 2" para sempre. */
  const COM_CONFLITO = [
    linha(),
    linha({
      id: 9,
      variavel: "taxa",
      rotuloDaVariavel: "Taxa FINAME",
      attributeCode: "cavalo.taxa_finame",
      medida: "PERCENTUAL",
      diferenca: null,
      variacao: null,
      estado: "CONFLITO",
      motivo: "O tipo do valor mudou entre os dois snapshots.",
    }),
  ];

  const renderizarComConflito = (onJustificar = vi.fn()) => {
    render(
      <TooltipProvider>
        <TabelaDeFiname
          veiculos={agruparPorVeiculo(COM_CONFLITO)}
          justificadaPor={new Map([[1, { ...JUSTIFICADA, changeId: 1 }]])}
          onAbrir={vi.fn()}
          onJustificar={onJustificar}
        />
      </TooltipProvider>,
    );
    return onJustificar;
  };

  it("conta só as alteradas — o conflito fica fora do denominador", () => {
    renderizarComConflito();
    const placa = screen.getByRole("button", {
      name: /Abrir as alterações de QYW6D15/,
    });
    expect(within(placa).getByText("1 de 1")).toBeTruthy();
  });

  it("justifica em massa só as alteradas da placa", () => {
    const onJustificar = renderizarComConflito();
    fireEvent.click(
      screen.getByRole("button", { name: /Justificar a 1 alteração de QYW6D15/ }),
    );
    expect(onJustificar.mock.calls[0]![0]).toEqual([expect.objectContaining({ id: 1 })]);
  });

  it("não oferece o botão na linha em conflito, nem a cobra de pendência", () => {
    renderizarComConflito();
    fireEvent.click(
      screen.getByRole("button", { name: /Abrir as alterações de QYW6D15/ }),
    );
    expect(screen.getByText("Taxa FINAME")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Justificar Taxa FINAME/ }),
    ).toBeNull();
    expect(screen.queryByText("Sem justificativa")).toBeNull();
  });
});
