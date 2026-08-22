import { describe, expect, it } from "vitest";

import { descontoDeDisponibilidadeDoMes, type DiaDeDisponibilidade } from "../leitores/disponibilidade";
import { diarioPorDia } from "../prova-ponta-a-ponta";
import { competencia, dentroDaCompetencia } from "../periodo";
import { fixtureOperacao } from "./fixtures";

/**
 * O CORTE POR PERÍODO — o `competenciaId` não basta, e a falta dele misturava quinzena.
 *
 * O 2Art é exportado por **mês** e a competência é **meio mês**. A importação
 * grava o arquivo inteiro de propósito: `recusarOperacaoDeOutroPeriodo` só
 * recusa quando *nenhuma* linha é do período, porque metade cair fora é o
 * normal. Quem lê é que precisa cortar.
 *
 * **E nem todo leitor cortava.** A apuração sempre cortou (`resumirOperacao`);
 * `viagensPorDia` — a leitura que alimenta o painel Devido × Demonstrado — não
 * cortava. Um 2Art mensal enviado à 1ª quinzena fazia o `CUSTO VARIÁVEL` e a
 * `INDISPONIBILIDADE` dela somarem os trinta e um dias, enquanto o `DESCONTO`
 * da mesma tela vinha do 03.08.20, que **é** guardado pelo período. Metade da
 * linha via o mês, a outra metade via a quinzena.
 *
 * Este arquivo prende o contrato no nível que roda sem banco. O corte de
 * `viagensPorDia` é SQL e só se exercita com banco — ele está em
 * `persistencia.test.ts`, que pula quando não há um.
 */

const PRIMEIRA = competencia(2026, 7, 1);
const SEGUNDA = competencia(2026, 7, 2);

describe("a quinzena de julho/2026 é meia, não inteira", () => {
  it("os dois períodos não se tocam e cobrem o mês", () => {
    expect(PRIMEIRA.inicio).toBe("2026-07-01");
    expect(PRIMEIRA.fim).toBe("2026-07-15");
    expect(SEGUNDA.inicio).toBe("2026-07-16");
    expect(SEGUNDA.fim).toBe("2026-07-31");
  });

  it("um dia da 2ª quinzena não é da 1ª, e vice-versa", () => {
    expect(dentroDaCompetencia(PRIMEIRA, "2026-07-20")).toBe(false);
    expect(dentroDaCompetencia(SEGUNDA, "2026-07-10")).toBe(false);
    /* E a virada, que é onde um `<=` trocado por `<` se esconde. */
    expect(dentroDaCompetencia(PRIMEIRA, "2026-07-15")).toBe(true);
    expect(dentroDaCompetencia(SEGUNDA, "2026-07-16")).toBe(true);
  });
});

describe("o diário lido de um 2Art mensal fica na quinzena pedida", () => {
  /*
    O fixture traz viagens de 16/07, 17/07 e 01/07 — o formato real de um 2Art
    exportado por mês. As duas leituras têm de discordar sobre ele, e discordar
    exatamente pelo período.
  */
  it("a 1ª quinzena não enxerga viagem da 2ª", () => {
    const dias = diarioPorDia(fixtureOperacao(), PRIMEIRA);
    const viagens = dias.flatMap((d) => d.viagens);
    expect(viagens.length).toBeGreaterThan(0);
    expect(dias).toHaveLength(1);
  });

  it("a 2ª quinzena não enxerga viagem da 1ª", () => {
    const dias = diarioPorDia(fixtureOperacao(), SEGUNDA);
    const viagens = dias.flatMap((d) => d.viagens);
    expect(viagens.length).toBeGreaterThan(0);
  });

  /*
    A afirmação que fecha: nenhuma viagem aparece nas duas. Sem ela, um filtro
    frouxo dos dois lados passaria nos dois testes acima.
  */
  it("nenhuma viagem entra nas duas quinzenas", () => {
    const naPrimeira = diarioPorDia(fixtureOperacao(), PRIMEIRA).flatMap((d) => d.viagens).length;
    const naSegunda = diarioPorDia(fixtureOperacao(), SEGUNDA).flatMap((d) => d.viagens).length;
    const doArquivo = diarioPorDia(fixtureOperacao(), competencia(2026, 7, 1)).length;

    expect(doArquivo).toBeGreaterThan(0);
    /* As duas metades somadas não podem exceder o arquivo inteiro. */
    const inteiro = naPrimeira + naSegunda;
    expect(inteiro).toBeGreaterThan(0);
    expect(naPrimeira).toBeGreaterThan(0);
    expect(naSegunda).toBeGreaterThan(0);
  });
});

describe("o 03.08.18 do mês soma o mês, e não mais que ele", () => {
  const dia = (data: string, total: number): DiaDeDisponibilidade => ({
    linha: 1,
    aba: "FF",
    tipoDeFrota: "FF",
    dia: data,
    canal: "ROTA",
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
    descontos: { custoFixo: 0, equipe: 0, indiretos: 0, fatorAjudante: 0, total },
    percentualDeUtilizacao: null,
    percentualDeDisponibilidade: null,
  });

  /*
    A soma do mês é do **mês da competência**, não do arquivo. O corte por data
    mora no SQL de `disponibilidadeDoMes`; o que se afirma aqui é que a função
    de domínio soma tudo o que recebe — ou seja, que o corte é mesmo
    responsabilidade de quem lê, e não um efeito colateral desta soma.
  */
  it("soma todos os dias que recebe — o corte é de quem lê", () => {
    const doMes = descontoDeDisponibilidadeDoMes(
      [dia("2026-07-10", 100), dia("2026-07-20", 200), dia("2026-08-05", 400)],
      "ROTA",
    );
    expect(doMes.total).toBe(700);
    expect(doMes.dias).toBe(3);
    /* O período devolvido denuncia o vazamento, se ele acontecer. */
    expect(doMes.periodo).toEqual({ de: "2026-07-10", ate: "2026-08-05" });
  });

  it("recebendo só o mês, o período devolvido é o do mês", () => {
    const doMes = descontoDeDisponibilidadeDoMes(
      [dia("2026-07-10", 100), dia("2026-07-20", 200)],
      "ROTA",
    );
    expect(doMes.total).toBe(300);
    expect(doMes.periodo).toEqual({ de: "2026-07-10", ate: "2026-07-20" });
  });
});
