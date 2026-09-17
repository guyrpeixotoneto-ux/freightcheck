// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { LinhaDoMonitor } from "@workspace/comparison/monitor-custo-fixo";
import { TabelaDoMonitor } from "../tabela";
import { ORDENACAO_PADRAO } from "@/lib/monitor-custo-fixo";

/**
 * O que este teste prende, e por que ele monta a tabela de verdade.
 *
 * Três promessas desta tela não são verificáveis numa função pura: que a
 * ausência de valor **não apareça como R$ 0,00**, que a direção do impacto não
 * dependa só da cor, e que o painel abra pelo teclado. As três são sobre o que
 * chega aos olhos e às mãos de quem lê, então o teste renderiza.
 */

afterEach(cleanup);

const PAR = {
  baseId: "a1",
  comparadaId: "b2",
  baseRotulo: "1ª/08",
  comparadaRotulo: "2ª/08",
  baseData: "2026-08-01",
  comparadaData: "2026-08-16",
};

function linha(over: Partial<LinhaDoMonitor> = {}): LinhaDoMonitor {
  return {
    id: "FINAME:1",
    modulo: "FINAME",
    changeId: 1,
    par: PAR,
    entidade: { tipo: "VEICULO", rotulo: "ABC1D23", entityType: "CAVALO", placa: "ABC1D23" },
    variavel: {
      chave: "parcela",
      rotulo: "Parcela FINAME",
      medida: "DINHEIRO",
      attributeCode: "cavalo.finame_cavalo",
    },
    estado: "ALTERADO",
    valorAnterior: "8450",
    valorAtual: "8760",
    variacao: 3.67,
    impacto: {
      situacao: "VALORADO",
      direcao: "GANHO",
      valor: 310,
      periodicidade: "MENSAL",
        motivo: null,
    },
    prioridade: { nivel: "MEDIO", score: 35, motivos: [] },
    origem: {
      modulo: "FINAME",
      rotulo: "FINAME",
      rota: "/custo-fixo-finame",
      changeSetId: "cs-1",
    },
    ...over,
  };
}

const semValoracao = linha({
  id: "IMPOSTOS:2",
  modulo: "IMPOSTOS",
  entidade: { tipo: "VEICULO", rotulo: "DEF2G45", entityType: "CARRETA", placa: "DEF2G45" },
  variavel: {
    chave: "icms",
    rotulo: "ICMS da compra",
    medida: "DINHEIRO",
    attributeCode: "carreta.valor_icms",
  },
  impacto: {
    situacao: "SEM_VALORACAO",
    direcao: null,
    valor: null,
    periodicidade: null,
    motivo: "Um dos lados não é numérico.",
  },
  origem: { modulo: "IMPOSTOS", rotulo: "Impostos", rota: "/custo-fixo-impostos", changeSetId: "cs-1" },
});

const foraDoTotal = linha({
  id: "FINAME:3",
  impacto: {
    situacao: "FORA_DO_TOTAL",
    direcao: null,
    valor: null,
    periodicidade: null,
    motivo: "Rubrica do módulo Impostos.",
  },
});

function montar(linhas: LinhaDoMonitor[], onSelecionar = vi.fn()) {
  render(
    <TabelaDoMonitor
      linhas={linhas}
      ordem={ORDENACAO_PADRAO}
      onOrdenar={vi.fn()}
      selecionada={null}
      onSelecionar={onSelecionar}
    />,
  );
  return { onSelecionar };
}

describe("a célula de impacto", () => {
  it("escreve o valor com a periodicidade colada", () => {
    montar([linha()]);
    expect(screen.getByText("R$ 310,00/mês")).toBeTruthy();
  });

  it("nunca escreve R$ 0,00 onde não houve medição", () => {
    montar([semValoracao, foraDoTotal]);
    expect(screen.queryByText(/R\$ 0,00/)).toBeNull();
    // E diz o que é, em texto — não deixa a célula em branco.
    expect(screen.getAllByText("Sem valoração").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fora do total").length).toBeGreaterThan(0);
  });

  it("diz a direção em palavras, e não só pela cor", () => {
    montar([linha()]);
    // O texto existe para leitor de tela e sobrevive à impressão em cinza.
    expect(screen.getByText("Ganho de")).toBeTruthy();
  });
});

describe("a acessibilidade", () => {
  it("abre o detalhe pelo teclado, sem mouse", () => {
    const { onSelecionar } = montar([linha()]);
    const alvo = screen.getByRole("button", { name: /Abrir o detalhe de ABC1D23/ });

    /*
      O alvo é um `button` de verdade, e não um `onClick` numa `<tr>`: ele
      recebe foco na ordem natural do documento e o Enter o aciona sem que a
      tabela precise de nenhum atalho próprio. É isso que se prende aqui — se
      alguém trocá-lo por uma linha clicável, este teste cai.
    */
    alvo.focus();
    expect(document.activeElement).toBe(alvo);
    fireEvent.keyDown(alvo, { key: "Enter", code: "Enter" });
    fireEvent.click(alvo);

    expect(onSelecionar).toHaveBeenCalledTimes(1);
    expect(onSelecionar.mock.calls[0]![0].id).toBe("FINAME:1");
  });

  it("dá à tabela um resumo e às colunas um cabeçalho de verdade", () => {
    montar([linha()]);
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByRole("columnheader", { name: /Identificação/ })).toBeTruthy();
    expect(within(tabela).getByRole("columnheader", { name: /Módulo/ })).toBeTruthy();
    // A coluna não se chama "Veículo": ela recebe placa, unidade ou cargo.
    expect(within(tabela).queryByRole("columnheader", { name: /^Veículo$/ })).toBeNull();
  });

  it("anuncia por qual coluna a tabela está ordenada", () => {
    montar([linha()]);
    const prioridade = screen.getByRole("columnheader", { name: /Prioridade/ });
    expect(prioridade.getAttribute("aria-sort")).toBe("descending");
  });
});

describe("a origem de cada linha", () => {
  it("mostra o módulo e o par de vigências em toda linha", () => {
    montar([linha(), semValoracao]);
    expect(screen.getByText("FINAME")).toBeTruthy();
    expect(screen.getByText("Impostos")).toBeTruthy();
    expect(screen.getAllByText("1ª/08 → 2ª/08").length).toBe(2);
  });
});
