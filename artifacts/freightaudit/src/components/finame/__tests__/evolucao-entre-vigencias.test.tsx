// @vitest-environment jsdom
//
// A PERGUNTA QUE ESTE PAINEL EXISTE PARA RESPONDER.
//
// *"Esses valores de evolução entre duas vigências e o que está na tabela não
// deveriam bater?"* — não batiam, e não por defeito de conta: o total de cada
// ponta inclui quem entrou e quem saiu da frota, e a coluna Diferença da tabela
// só fala de quem está nas duas vigências.
//
// O que se verifica aqui não é layout. É que a diferença aparece **aberta** nas
// três parcelas que a produzem, que a soma delas é a diferença escrita ao lado
// — a identidade, e não uma aproximação — e que cada parcela leva a tabela para
// o recorte que a sustenta, com os três filtros escritos de uma vez.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvolucaoEntreVigencias } from "../graficos";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { EvolucaoDoTipo } from "@workspace/comparison/finame";

afterEach(cleanup);

/** Os números da tela que levantou a pergunta — as carretas do par de julho. */
const CARRETA: EvolucaoDoTipo = {
  entityType: "CARRETA",
  base: 254748.52,
  comparada: 345593.23,
  alterados: 12410.08,
  entradas: 96233.4,
  saidas: 17798.77,
  veiculosAlterados: 6,
  veiculosEntradas: 18,
  veiculosSaidas: 20,
};

const renderizar = ({ comRecorte = true } = {}) => {
  const onRecorte = vi.fn();
  render(
    <TooltipProvider>
      <EvolucaoEntreVigencias
        evolucao={[CARRETA]}
        rotuloBase="junho/2026"
        rotuloComparada="julho/2026"
        {...(comRecorte ? { onRecorte } : {})}
      />
    </TooltipProvider>,
  );
  return { onRecorte };
};

describe("a evolução entre as duas vigências", () => {
  it("escreve as duas pontas e a diferença entre elas", () => {
    renderizar();
    expect(screen.getByText("R$ 254.748,52")).toBeTruthy();
    expect(screen.getByText("R$ 345.593,23")).toBeTruthy();
    expect(screen.getByText(/\+R\$ 90\.844,71 · \+35,66%/)).toBeTruthy();
  });

  it("abre a diferença nas três parcelas, e elas somam a diferença", () => {
    renderizar();
    expect(screen.getByText("+R$ 12.410,08")).toBeTruthy();
    expect(screen.getByText("+R$ 96.233,40")).toBeTruthy();
    /* A saída é escrita positiva: o operador "−" ao lado é que a subtrai. */
    expect(screen.getByText("R$ 17.798,77")).toBeTruthy();
    expect(
      CARRETA.base + CARRETA.alterados + CARRETA.entradas - CARRETA.saidas,
    ).toBeCloseTo(CARRETA.comparada, 2);
  });

  it("diz quantos veículos sustentam cada parcela", () => {
    renderizar();
    expect(screen.getByText("6 veíc.")).toBeTruthy();
    expect(screen.getByText("18 veíc.")).toBeTruthy();
    expect(screen.getByText("20 veíc.")).toBeTruthy();
  });

  it("leva a tabela para a variável Parcela — e não para a aba Alterados", () => {
    const { onRecorte } = renderizar();
    fireEvent.click(screen.getByRole("button", { name: /Parcela alterada/ }));
    /* A aba Alterados conta alteração de qualquer variável; este número é só da
       parcela, e mandar para lá seria prometer um recorte e abrir outro. */
    expect(onRecorte).toHaveBeenCalledWith({
      tipo: "CARRETA",
      estado: "TODAS",
      variavel: "parcela",
    });
  });

  it("leva as entradas e as saídas para as abas delas, sem filtrar variável", () => {
    const { onRecorte } = renderizar();
    fireEvent.click(screen.getByRole("button", { name: /Entradas/ }));
    expect(onRecorte).toHaveBeenCalledWith({
      tipo: "CARRETA",
      estado: "NOVO_NA_VIGENCIA",
      variavel: "TODAS",
    });

    fireEvent.click(screen.getByRole("button", { name: /Saídas/ }));
    /* Entrada e saída de ativo não citam atributo — o motor as grava uma vez por
       veículo, com a variável em branco. Filtrar por Parcela esvaziaria a tabela. */
    expect(onRecorte).toHaveBeenLastCalledWith({
      tipo: "CARRETA",
      estado: "AUSENTE_NA_COMPARADA",
      variavel: "TODAS",
    });
  });

  it("sem para onde levar, os chips não clicam", () => {
    renderizar({ comRecorte: false });
    for (const rotulo of [/Parcela alterada/, /Entradas/, /Saídas/]) {
      expect(screen.getByRole("button", { name: rotulo }).hasAttribute("disabled")).toBe(true);
    }
  });

  it("escreve a parcela zerada, mas ela não clica", () => {
    render(
      <TooltipProvider>
        <EvolucaoEntreVigencias
          evolucao={[{ ...CARRETA, saidas: 0, veiculosSaidas: 0 }]}
          rotuloBase="junho/2026"
          rotuloComparada="julho/2026"
          onRecorte={vi.fn()}
        />
      </TooltipProvider>,
    );
    /* Escrita, porque é ela que deixa a soma conferível: sem o zero, quem lê
       não sabe se nada saiu ou se a parcela foi omitida. */
    const chip = screen.getByRole("button", { name: /Saídas/ });
    expect(chip.textContent).toContain("R$ 0,00");
    expect(chip.hasAttribute("disabled")).toBe(true);
  });

  it("sem série, diz que não há total para comparar", () => {
    render(
      <TooltipProvider>
        <EvolucaoEntreVigencias evolucao={[]} rotuloBase="junho/2026" rotuloComparada="julho/2026" />
      </TooltipProvider>,
    );
    expect(screen.getByText("Sem total para comparar.")).toBeTruthy();
  });
});
