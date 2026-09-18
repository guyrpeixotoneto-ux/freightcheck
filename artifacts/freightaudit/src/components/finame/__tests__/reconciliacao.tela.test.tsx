// @vitest-environment jsdom
//
// A PERGUNTA QUE ESTE PAINEL EXISTE PARA RESPONDER.
//
// *"Os dois números de cima dão 17 mil, certo? Por que não batem com esse se
// estão na mesma tela?"* — o cartão somava as rubricas deste módulo nos
// veículos comparados, o painel de baixo somava a parcela FINAME do acervo
// inteiro, e entre os dois havia uma **observação** dizendo que as bases eram
// diferentes.
//
// O que se verifica aqui: a escada escreve os dois números na mesma coluna, com
// um sinal só; ela **fecha** — e diz que fechou; cada degrau abre até a placa,
// a rubrica e as duas vigências; e o dia em que ela não fechar, a linha
// "Diferença não explicada" aparece com o valor, em vez de o resíduo sumir.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ReconciliacaoDoImpacto } from "../reconciliacao";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  DegrauDaReconciliacao,
  ReconciliacaoPorPeriodicidade,
} from "@workspace/comparison/reconciliacao-de-finame";

afterEach(cleanup);

const degrau = (
  chave: DegrauDaReconciliacao["chave"],
  rotulo: string,
  tipo: DegrauDaReconciliacao["tipo"],
  valor: number,
  veiculos: number,
  itens: DegrauDaReconciliacao["itens"] = [],
): DegrauDaReconciliacao => ({
  chave,
  rotulo,
  explicacao: `O que ${rotulo} promete.`,
  tipo,
  valor,
  veiculos,
  itens,
});

/** A escada do par que levantou a pergunta: 2ª de junho → 1ª de setembro/2026. */
const MENSAL: ReconciliacaoPorPeriodicidade = {
  periodicidade: "MENSAL",
  temSaldo: true,
  residuo: 0,
  fecha: true,
  semEfeitoFinanceiro: 10,
  naoPrecificadas: 0,
  degraus: [
    degrau("SALDO_BASE", "Saldo na vigência base", "NIVEL", 1130699.83, 133),
    degrau("ALTERADO_COMPARADOS", "Alterações em veículos comparados", "MOVIMENTO", -17171.54, 10, [
      {
        placa: "QYP3G72",
        entityType: "CAVALO",
        variavel: "amortizacao",
        rubrica: "Amortização",
        base: 7700.16,
        comparada: 0,
        valor: -7700.16,
        nota: null,
      },
    ]),
    degrau("RECLASSIFICADO", "Reclassificado para outro módulo", "MOVIMENTO", 12973.33, 3, [
      {
        placa: "QYP3G72",
        entityType: "CAVALO",
        variavel: "lucro_fixo_do_cavalo",
        rubrica: "Lucro fixo do cavalo",
        base: 0,
        comparada: 4677.85,
        valor: 4677.85,
        nota: "Quem o soma é a Auditoria de Lucro Fixo.",
      },
    ]),
    degrau("FORA_DA_PARCELA", "Movimento sem efeito na parcela", "MOVIMENTO", 0, 0),
    degrau("NAO_EXPLICADO", "Diferença não explicada", "MOVIMENTO", 0, 0),
    degrau("FROTA_EXISTENTE", "Frota existente", "SUBTOTAL", -4198.21, 10),
    degrau("ENTRADAS", "Entradas de frota", "MOVIMENTO", 225479.28, 26),
    degrau("SAIDAS", "Saídas de frota", "MOVIMENTO", -106887.69, 24),
    degrau("SALDO_COMPARADA", "Saldo na vigência comparada", "NIVEL", 1245093.21, 135),
  ],
};

const renderizar = (escadas: ReconciliacaoPorPeriodicidade[] = [MENSAL]) =>
  render(
    <TooltipProvider>
      <ReconciliacaoDoImpacto
        reconciliacao={escadas}
        rotuloBase="junho/2026"
        rotuloComparada="setembro/2026"
      />
    </TooltipProvider>,
  );

describe("a reconciliação do impacto", () => {
  it("escreve o número do cartão e o saldo da frota na mesma coluna", () => {
    renderizar();
    /* O cartão diz −R$ 17.171,54; o painel de baixo, um saldo de R$ 1,24 mi.
       Os dois agora são degraus da mesma escada. */
    expect(screen.getByText("−R$ 17.171,54")).toBeTruthy();
    expect(screen.getByText("R$ 1.130.699,83")).toBeTruthy();
    expect(screen.getByText("R$ 1.245.093,21")).toBeTruthy();
  });

  it("usa um sinal só: a saída de frota é escrita negativa", () => {
    renderizar();
    expect(screen.getByText("−R$ 106.887,69")).toBeTruthy();
    expect(screen.getByText("+R$ 225.479,28")).toBeTruthy();
  });

  it("afirma que fecha, em vez de pedir confiança", () => {
    renderizar();
    expect(
      screen.getByText(/Fecha: saldo de junho\/2026 mais os movimentos/),
    ).toBeTruthy();
    /* A escada soma, de cima para baixo, exatamente o saldo de baixo. */
    const movimentos = MENSAL.degraus
      .filter((d) => d.tipo === "MOVIMENTO" && d.chave !== "FROTA_EXISTENTE")
      .reduce((s, d) => s + d.valor, 0);
    expect(1130699.83 + movimentos).toBeCloseTo(1245093.21, 2);
  });

  it("abre um degrau até a placa, a rubrica e as duas vigências", () => {
    renderizar();
    fireEvent.click(screen.getByRole("button", { name: /Reclassificado para outro módulo/ }));
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("QYP3G72")).toBeTruthy();
    expect(within(tabela).getByText(/Lucro fixo do cavalo/)).toBeTruthy();
    expect(within(tabela).getByText("R$ 4.677,85")).toBeTruthy();
    expect(within(tabela).getByText(/Auditoria de Lucro Fixo/)).toBeTruthy();
    /* As colunas são as duas vigências, nomeadas — não "antes" e "depois". */
    expect(within(tabela).getByText("junho/2026")).toBeTruthy();
    expect(within(tabela).getByText("setembro/2026")).toBeTruthy();
  });

  it("conta a alteração sem efeito financeiro sem somá-la", () => {
    renderizar();
    expect(screen.getByText(/10 alterações sem efeito financeiro/)).toBeTruthy();
  });

  it("não deixa o resíduo mudo quando a escada não fecha", () => {
    renderizar([
      {
        ...MENSAL,
        fecha: false,
        residuo: 812.5,
        degraus: MENSAL.degraus.map((d) =>
          d.chave === "NAO_EXPLICADO" ? { ...d, valor: 812.5 } : d,
        ),
      },
    ]);
    expect(screen.getByText(/A escada não fechou: sobram R\$ 812,50/)).toBeTruthy();
    expect(screen.getByText("+R$ 812,50")).toBeTruthy();
  });

  it("diz que a aquisição não tem saldo de frota, em vez de inventar um", () => {
    renderizar([
      MENSAL,
      {
        periodicidade: "PONTUAL",
        temSaldo: false,
        residuo: 0,
        fecha: true,
        semEfeitoFinanceiro: 0,
        naoPrecificadas: 0,
        degraus: [
          degrau("ALTERADO_COMPARADOS", "Alterações em veículos comparados", "MOVIMENTO", 0, 0),
          degrau("RECLASSIFICADO", "Reclassificado para outro módulo", "MOVIMENTO", 300, 1),
        ],
      },
    ]);
    expect(screen.getByText(/sem saldo de frota nesta periodicidade/)).toBeTruthy();
    expect(screen.getByText(/Não há total de frota nesta periodicidade/)).toBeTruthy();
  });

  it("sem leitura, diz isso — e não mostra uma escada zerada", () => {
    renderizar([]);
    expect(screen.getByText("Sem leitura para reconciliar neste recorte.")).toBeTruthy();
  });
});
