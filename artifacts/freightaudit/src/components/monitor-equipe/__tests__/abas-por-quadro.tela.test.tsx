// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  LinhaDoMonitorDeEquipe,
  QuadroNoMonitor,
  ResumoDoMonitorDeEquipe,
} from "@workspace/comparison/monitor-equipe";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AbasDoMonitorDeEquipe } from "../abas";
import { CartoesDoMonitorDeEquipe } from "../cartoes";
import { TabelaDoMonitorDeEquipe } from "../tabela";
import { ORDENACAO_PADRAO } from "@/lib/monitor-equipe";

/**
 * O que este teste prende.
 *
 * A separação por aba é uma promessa sobre o que chega aos olhos: que se leia
 * **uma população de cada vez**. Ela quebra de três maneiras, e nenhuma delas
 * aparece num teste de função pura.
 *
 * 1. A aba aberta deixa de ser a que o endereço pede, e quem clica em
 *    "Administrativo" continua lendo o operacional.
 * 2. O bloco do outro quadro volta para o topo — e aí os dois totais ficam lado
 *    a lado convidando a somar duas leituras que não se somam: pares
 *    diferentes, change sets diferentes, catálogos de coluna que nem se
 *    parecem.
 * 3. A coluna "Quadro" volta para a tabela, escrevendo a mesma palavra em todas
 *    as linhas de uma aba que já disse qual é.
 *
 * As três se testam renderizando.
 */

afterEach(cleanup);

const PAR = {
  quadro: "OPERACIONAL" as const,
  baseId: "a1",
  comparadaId: "b2",
  baseRotulo: "1ª/08",
  comparadaRotulo: "2ª/08",
  baseData: "2026-08-01",
  comparadaData: "2026-08-16",
};

const LINHA: LinhaDoMonitorDeEquipe = {
  id: "OPERACIONAL:transporte:1",
  modulo: "transporte",
  quadro: "OPERACIONAL",
  changeId: 1,
  par: PAR,
  cargo: { chave: "07526557001505CARGOAJUDANTE", entityType: "QLP_OPERACIONAL" },
  variavel: {
    chave: "vale_transporte",
    rotulo: "Vale-transporte",
    medida: "DINHEIRO",
    papel: "MONTANTE",
    attributeCode: "qlp_operacional.vale_transporte",
  },
  estado: "ALTERADO",
  valorAnterior: "120",
  valorAtual: "150",
  diferenca: 30,
  variacao: 25,
  situacao: { tipo: "SEM_VALORACAO", motivo: null },
  prioridade: { nivel: "MEDIO", score: 26, motivos: [] },
  origem: {
    modulo: "transporte",
    quadro: "OPERACIONAL",
    rota: "/qlp/transporte",
    changeSetId: "cs-1",
  },
};

function quadro(over: Partial<QuadroNoMonitor> = {}): QuadroNoMonitor {
  return {
    quadro: "OPERACIONAL",
    rotulo: "QLP Operacional",
    rota: "/qlp-operacional",
    par: PAR,
    ausente: null,
    alteracoes: 7,
    cargosAfetados: 3,
    efetivo: null,
    ...over,
  };
}

const RESUMO: ResumoDoMonitorDeEquipe = {
  alteracoes: 7,
  porSituacao: { EFETIVO: 2, SEM_VALORACAO: 5, FORA_DA_SOMA: 0, NAO_MONETARIA: 0 },
  variaveisAlteradas: 7,
  cargosQueEntraram: 0,
  cargosQueSairam: 0,
  cargosAfetados: 3,
  porQuadro: [
    quadro(),
    quadro({
      quadro: "ADMINISTRATIVO",
      rotulo: "QLP Administrativo",
      rota: "/qlp-administrativo",
      par: null,
      ausente: "Este quadro está fora do recorte escolhido nos filtros.",
      alteracoes: 0,
      cargosAfetados: 0,
    }),
  ],
  porModulo: [],
  semImpactoFinanceiro:
    "As colunas do QLP chegam sem semântica confirmada, e somar o que a curadoria não confirmou seria adivinhação.",
};

describe("as abas do Monitor Equipe", () => {
  it("marca só a aba aberta, e a outra continua clicável", () => {
    const trocar = vi.fn();
    render(<AbasDoMonitorDeEquipe aba="OPERACIONAL" onTrocar={trocar} />);

    const operacional = screen.getByRole("tab", { name: "Operacional" });
    const administrativo = screen.getByRole("tab", { name: "Administrativo" });
    expect(operacional.getAttribute("aria-selected")).toBe("true");
    expect(administrativo.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(administrativo);
    expect(trocar).toHaveBeenCalledWith("ADMINISTRATIVO");
  });
});

/*
  `TooltipProvider` está aqui porque está em `App.tsx`, na raiz da aplicação: a
  ajuda dos cartões é um tooltip, e sem o provedor o Radix recusa a renderização.
*/
const cartoes = (quadroAberto: "OPERACIONAL" | "ADMINISTRATIVO") =>
  render(
    <TooltipProvider>
      <CartoesDoMonitorDeEquipe resumo={RESUMO} quadro={quadroAberto} />
    </TooltipProvider>,
  );

describe("o topo da aba", () => {
  it("publica o bloco do quadro aberto, e não o do outro", () => {
    cartoes("OPERACIONAL");

    expect(screen.getByRole("heading", { name: "QLP Operacional" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "QLP Administrativo" })).toBeNull();
    /*
      E a frase do travamento continua: o que sai é o bloco do outro quadro, não
      a recusa de somar dinheiro no QLP.
    */
    expect(screen.getByText(RESUMO.semImpactoFinanceiro)).toBeTruthy();
  });

  it("troca de bloco quando a aba troca", () => {
    cartoes("ADMINISTRATIVO");

    expect(screen.getByRole("heading", { name: "QLP Administrativo" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "QLP Operacional" })).toBeNull();
    /* O quadro sem par aparece assim mesmo, dizendo por quê. */
    expect(
      screen.getByText("Este quadro está fora do recorte escolhido nos filtros."),
    ).toBeTruthy();
  });
});

describe("a coluna Quadro da tabela", () => {
  const tabela = (mostrarQuadro: boolean) =>
    render(
      <TabelaDoMonitorDeEquipe
        linhas={[LINHA]}
        rotulos={{}}
        ordem={ORDENACAO_PADRAO}
        onOrdenar={() => {}}
        selecionada={null}
        onSelecionar={() => {}}
        mostrarQuadro={mostrarQuadro}
      />,
    );

  it("some dentro da aba, onde ela repetiria a mesma palavra", () => {
    tabela(false);
    expect(screen.queryByRole("columnheader", { name: /Quadro/ })).toBeNull();
    /* As outras colunas ficam — a que sai é uma só. */
    expect(screen.getByRole("columnheader", { name: /Módulo/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Vigência/ })).toBeTruthy();
  });

  it("fica quando a tabela mistura as duas populações", () => {
    tabela(true);
    expect(screen.getByRole("columnheader", { name: /Quadro/ })).toBeTruthy();
  });
});
