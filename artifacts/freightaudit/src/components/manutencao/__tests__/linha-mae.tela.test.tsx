// @vitest-environment jsdom
//
// A LINHA-MÃE DA MANUTENÇÃO — o que a placa diz sem ser aberta.
//
// O caso que trouxe estes testes é real e tem placa: a RZN6A79 moveu o R$/km do
// BID de 0,4400 para 0,4500 e a linha dela dizia "Alterado", "1 (0 em R$)" e
// quatro travessões. Nenhum número estava errado, e os três liam errado — o
// complemento falava da rubrica (que não tem variável nenhuma em reais) como se
// falasse da placa, e o travessão, que significa "não há valor aplicável aqui",
// ocupava o lugar de um valor que existia uma linha abaixo.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agruparPorVeiculoDeManutencao,
  type LinhaDeManutencao,
} from "@workspace/comparison/manutencao";

import { TooltipProvider } from "@/components/ui/tooltip";

import { TabelaDeManutencao } from "../tabela";

afterEach(cleanup);

const linha = (over: Partial<LinhaDeManutencao> = {}): LinhaDeManutencao => ({
  id: 1,
  entityLabel: "RZN6A79",
  entityType: "CAVALO",
  variavel: "bid",
  rotuloDaVariavel: "R$/km do BID",
  medida: "REAIS_POR_KM",
  attributeCode: "cavalo.manutencao_bid",
  base: "0.44",
  comparada: "0.45",
  diferenca: 0.01,
  variacao: 2.27,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: null,
  impactoPeriodicidade: null,
  impactoCalculado: false,
  foraDaSoma: null,
  ...over,
});

const reaisKm = (over: Partial<LinhaDeManutencao> = {}): LinhaDeManutencao =>
  linha({
    id: 9,
    variavel: "reais_km",
    rotuloDaVariavel: "Manutenção R$/km",
    attributeCode: "cavalo.manutencao_reais_km",
    ...over,
  });

/*
  A linha-mãe é a `<tr>` da placa, e ela se acha pelo que é: o botão que abre as
  alterações daquela placa. `role="row"` não serve aqui — a linha declara
  `role="button"` justamente porque clicar nela abre a expansão.
*/
const linhaMae = () =>
  screen.getByRole("button", { name: /^Abrir as alterações de RZN6A79/ });

const renderizar = (linhas: LinhaDeManutencao[]) =>
  render(
    <TooltipProvider>
      <TabelaDeManutencao
        veiculos={agruparPorVeiculoDeManutencao(linhas)}
        onAbrir={vi.fn()}
        onJustificar={vi.fn()}
      />
    </TooltipProvider>,
  );

describe("a contagem de alterações", () => {
  it("não escreve '(0 em R$)' numa rubrica que não tem reais", () => {
    renderizar([linha()]);

    expect(within(linhaMae()).getByText("1")).toBeTruthy();
    expect(screen.queryByText(/em R\$/)).toBeNull();
  });

  it("e continua não escrevendo quando a placa mexe em duas medidas", () => {
    renderizar([
      linha(),
      linha({
        id: 2,
        variavel: "vida_meses",
        rotuloDaVariavel: "Vida em meses",
        medida: "MESES",
        base: "59.8",
        comparada: "47.8",
        diferenca: -12,
        variacao: -20.07,
      }),
    ]);

    expect(within(linhaMae()).getByText("2")).toBeTruthy();
    expect(screen.queryByText(/em R\$/)).toBeNull();
  });
});

describe("as quatro colunas de destaque", () => {
  it("só o BID mexeu: a linha-mãe mostra o BID, e diz que é o BID", () => {
    renderizar([linha()]);
    const mae = within(linhaMae());

    expect(mae.getByText("R$/km do BID")).toBeTruthy();
    expect(mae.getByText("R$ 0,4400/km")).toBeTruthy();
    expect(mae.getByText("R$ 0,4500/km")).toBeTruthy();
    expect(mae.getByText("+R$ 0,0100/km")).toBeTruthy();
    expect(mae.getByText("+2,27%")).toBeTruthy();
    // E nenhum travessão: a placa tem valor aplicável no recorte.
    expect(mae.queryByText("—")).toBeNull();
  });

  it("o R$/km resolvido no recorte manda, e não se nomeia — é o do cabeçalho", () => {
    renderizar([
      linha(),
      reaisKm({ base: "0.34", comparada: "0.36", diferenca: 0.02, variacao: 5.88 }),
    ]);
    const mae = within(linhaMae());

    expect(mae.getByText("R$ 0,3400/km")).toBeTruthy();
    expect(mae.getByText("R$ 0,3600/km")).toBeTruthy();
    expect(mae.queryByText("R$/km do BID")).toBeNull();
    expect(mae.queryByText("Manutenção R$/km")).toBeNull();
  });

  it("duas em R$/km alteradas: a placa conta, e manda abrir", () => {
    renderizar([
      linha(),
      linha({
        id: 2,
        variavel: "contrato",
        rotuloDaVariavel: "R$/km do contrato",
        base: "0.34",
        comparada: "0.36",
        diferenca: 0.02,
        variacao: 5.88,
      }),
    ]);
    const mae = within(linhaMae());

    expect(mae.getByText(/2 valores em R\$\/km alterados/)).toBeTruthy();
    // Nenhuma das duas foi eleita representante da placa.
    expect(mae.queryByText("R$ 0,4400/km")).toBeNull();
    expect(mae.queryByText("R$ 0,3400/km")).toBeNull();
  });

  it("nada em R$/km no recorte: travessão, que é ausência de valor", () => {
    renderizar([
      linha({
        variavel: "vida_meses",
        rotuloDaVariavel: "Vida em meses",
        medida: "MESES",
        base: "59.8",
        comparada: "47.8",
        diferenca: -12,
        variacao: -20.07,
      }),
    ]);

    expect(within(linhaMae()).getAllByText("—")).toHaveLength(4);
  });
});

describe("travessão, zero e 'sem alteração' são três coisas diferentes", () => {
  it("o zero medido sai escrito como zero, e não como travessão", () => {
    renderizar([reaisKm({ base: "0.34", comparada: "0", diferenca: -0.34, variacao: -100 })]);
    const mae = within(linhaMae());

    expect(mae.getByText("R$ 0,0000/km")).toBeTruthy();
    expect(mae.queryByText("—")).toBeNull();
  });

  it("a ponta que não existe sai como travessão, e a outra como número", () => {
    renderizar([
      reaisKm({
        base: null,
        comparada: "0.34",
        diferenca: null,
        variacao: null,
        estado: "NOVO_NA_VIGENCIA",
      }),
    ]);
    const mae = within(linhaMae());

    expect(mae.getByText("R$ 0,3400/km")).toBeTruthy();
    // A ponta "De", a diferença e a variação: três, e não quatro.
    expect(mae.getAllByText("—")).toHaveLength(3);
  });

  it("a variável parada diz 'sem alteração', com as duas pontas escritas", () => {
    renderizar([
      reaisKm({
        id: null,
        base: "0.34",
        comparada: "0.34",
        diferenca: 0,
        variacao: 0,
        estado: "SEM_ALTERACAO",
      }),
    ]);
    const mae = within(linhaMae());

    expect(mae.getAllByText("R$ 0,3400/km")).toHaveLength(2);
    expect(mae.getByText("sem alteração")).toBeTruthy();
    expect(mae.queryByText("—")).toBeNull();
  });
});
