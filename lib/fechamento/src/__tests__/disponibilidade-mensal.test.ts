import { describe, expect, it } from "vitest";

import {
  descontoDeDisponibilidadeDoMes,
  type DiaDeDisponibilidade,
} from "../leitores/disponibilidade";

/**
 * A REGRA DO DESCONTO DE DISPONIBILIDADE — o mês inteiro, aplicado na 2ª.
 *
 * Este arquivo existe para uma coisa só: impedir que a regra volte a ser
 * "quinzena contra quinzena". Ela ficou dois documentos em aberto exatamente
 * por essa comparação, e o que a fechou foi somar o mês.
 *
 * Os números são os do 03.08.18 real de julho/2026 — CDD Belém · Horizonte,
 * abas `FF` e `Van`, dias 1 a 31 —, agrupados por quinzena e por aba para que
 * o teste possa afirmar as duas coisas ao mesmo tempo: que a soma do mês bate
 * com o 03.08.20, e que **nenhuma das metades bate**. A segunda afirmação é a
 * que protege a regra; sem ela, um refator que voltasse a somar só a quinzena
 * passaria no teste da primeira.
 */

/* Os totais reais do 03.08.18 de julho/2026, por aba e por quinzena. */
const REAL = {
  FF: {
    1: { custoFixo: 5870.63, equipe: 36747.87, indiretos: 0, fatorAjudante: 320.85, total: 42939.35 },
    2: { custoFixo: 3031.01, equipe: 26044.61, indiretos: 0, fatorAjudante: 0, total: 29075.62 },
  },
  Van: {
    1: { custoFixo: 7135.28, equipe: 4080.45, indiretos: 0, fatorAjudante: 0, total: 11215.73 },
    2: { custoFixo: 5351.44, equipe: 3060.36, indiretos: 0, fatorAjudante: 0, total: 8411.8 },
  },
} as const;

/** O bloco `DESCONTO DISPONIBILIDADE` do 03.08.20 da 2ª quinzena, Rota. */
const DEMONSTRATIVO_2A = {
  custoFixo: 0.0,
  equipeEntrega: 91321.65,
  custoIndireto: 0.0,
  fatorAjudante: 320.85,
  get total() {
    return this.custoFixo + this.equipeEntrega + this.custoIndireto + this.fatorAjudante;
  },
};

/**
 * Um dia do 03.08.18, com o desconto que ele carrega.
 *
 * Os campos que a regra não lê vão em valores neutros: o que este teste afirma
 * é a soma dos descontos, e encher a frota contratada de números plausíveis
 * daria a impressão de que eles participam da conta.
 */
function dia(
  aba: "FF" | "Van",
  data: string,
  descontos: { custoFixo: number; equipe: number; indiretos: number; fatorAjudante: number; total: number },
  canal: "ROTA" | "AS" = "ROTA",
): DiaDeDisponibilidade {
  return {
    linha: 1,
    aba,
    tipoDeFrota: aba === "FF" ? "FF" : "VAN",
    dia: data,
    canal,
    frotaTotal: 0,
    contratada: 0,
    realPrimeiraViagem: 0,
    realSegundaViagem: 0,
    gapTotal: 0,
    gapDaCia: 0,
    gapDaTransportadora: {
      frotaCancelada: 0,
      outrosCancelados: 0,
      frotaNaoCancelada: 0,
      outrosNaoCancelados: 0,
    },
    descontos,
    percentualDeUtilizacao: null,
    percentualDeDisponibilidade: null,
  };
}

/** O mês inteiro: um dia por aba e por quinzena, carregando o total da metade. */
function mesInteiro(): DiaDeDisponibilidade[] {
  return [
    dia("FF", "2026-07-10", REAL.FF[1]),
    dia("FF", "2026-07-20", REAL.FF[2]),
    dia("Van", "2026-07-10", REAL.Van[1]),
    dia("Van", "2026-07-20", REAL.Van[2]),
  ];
}

describe("o desconto de disponibilidade é mensal", () => {
  it("a soma do mês bate ao centavo com o bloco do 03.08.20 da 2ª quinzena", () => {
    const doMes = descontoDeDisponibilidadeDoMes(mesInteiro(), "ROTA");
    expect(doMes.total).toBe(91642.5);
    expect(doMes.total).toBe(DEMONSTRATIVO_2A.total);
  });

  it("custo fixo + equipe + indiretos é a linha que o demonstrativo publica", () => {
    const doMes = descontoDeDisponibilidadeDoMes(mesInteiro(), "ROTA");
    expect(doMes.agrupadoComoNoDemonstrativo).toBe(91321.65);
    expect(doMes.agrupadoComoNoDemonstrativo).toBe(DEMONSTRATIVO_2A.equipeEntrega);
  });

  it("o fator ajudante fica à parte, como no demonstrativo", () => {
    const doMes = descontoDeDisponibilidadeDoMes(mesInteiro(), "ROTA");
    expect(doMes.parcelas.fatorAjudante).toBe(320.85);
    expect(doMes.parcelas.fatorAjudante).toBe(DEMONSTRATIVO_2A.fatorAjudante);
  });

  /*
    A afirmação que protege a regra. Se alguém voltar a somar só a quinzena,
    os três testes acima continuam passando quando o input já vem filtrado —
    este não.
  */
  it("nenhuma das duas metades sozinha reproduz o desconto do demonstrativo", () => {
    const soPrimeira = descontoDeDisponibilidadeDoMes(
      [dia("FF", "2026-07-10", REAL.FF[1]), dia("Van", "2026-07-10", REAL.Van[1])],
      "ROTA",
    );
    const soSegunda = descontoDeDisponibilidadeDoMes(
      [dia("FF", "2026-07-20", REAL.FF[2]), dia("Van", "2026-07-20", REAL.Van[2])],
      "ROTA",
    );
    expect(soPrimeira.total).toBe(54155.08);
    expect(soSegunda.total).toBe(37487.42);
    expect(soPrimeira.total).not.toBe(DEMONSTRATIVO_2A.total);
    expect(soSegunda.total).not.toBe(DEMONSTRATIVO_2A.total);
    /* E as duas somadas são o mês — a identidade que fecha a prova. */
    expect(soPrimeira.total + soSegunda.total).toBe(DEMONSTRATIVO_2A.total);
  });

  /*
    O "315,2%" que `docs/MAPA-ROTA.md` registrava como inexplicado. Fixá-lo num
    teste é o que impede a pergunta de ser reaberta como se fosse nova.
  */
  it("a razão que parecia discrepância é a razão entre o mês e um quarto dele", () => {
    const soSegundaFF = descontoDeDisponibilidadeDoMes([dia("FF", "2026-07-20", REAL.FF[2])], "ROTA");
    const razao = DEMONSTRATIVO_2A.total / soSegundaFF.total;
    expect(razao).toBeCloseTo(3.152, 3);
  });
});

describe("a soma não conta o mesmo dia duas vezes", () => {
  /*
    O caso real: a exportação da 2ª quinzena vem com o mês inteiro, e a da 1ª
    também traz dias da 2ª na aba `Van`. Enviar as duas é o normal.
  */
  it("dias repetidos entre duas remessas do 03.08.18 entram uma vez", () => {
    const comRepeticao = [...mesInteiro(), ...mesInteiro()];
    const doMes = descontoDeDisponibilidadeDoMes(comRepeticao, "ROTA");
    expect(doMes.total).toBe(91642.5);
    expect(doMes.dias).toBe(2);
  });

  it("FF e Van do mesmo dia são dois descontos, não uma repetição", () => {
    const doMes = descontoDeDisponibilidadeDoMes(
      [dia("FF", "2026-07-10", REAL.FF[1]), dia("Van", "2026-07-10", REAL.Van[1])],
      "ROTA",
    );
    expect(doMes.total).toBe(54155.08);
  });
});

describe("o corte por canal", () => {
  it("o AS não entra na soma da Rota", () => {
    const comAS = [...mesInteiro(), dia("FF", "2026-07-11", REAL.FF[1], "AS")];
    expect(descontoDeDisponibilidadeDoMes(comAS, "ROTA").total).toBe(91642.5);
  });

  it("um mês sem nenhum dia do canal soma zero e diz que somou zero dias", () => {
    const vazio = descontoDeDisponibilidadeDoMes(mesInteiro(), "AS");
    expect(vazio.total).toBe(0);
    expect(vazio.dias).toBe(0);
    expect(vazio.periodo).toBeNull();
  });
});
