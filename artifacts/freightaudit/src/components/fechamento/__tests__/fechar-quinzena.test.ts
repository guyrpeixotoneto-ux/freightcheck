import { describe, expect, it } from "vitest";
import { motivoAceito, oQueQuestionar } from "../fechar-quinzena";
import type { Apuracao, Divergencia } from "@/lib/fechamento";

/**
 * O que o resumo do fechamento diz ter a questionar.
 *
 * O número aparece duas vezes na tela da competência — na lista "O que
 * perguntar à Ambev" e no resumo ao lado do botão que congela o período — e uma
 * terceira na linha da lista de Importações. As três leem esta função, e o teste
 * é o que garante que continuem lendo a mesma conta.
 */

const divergencia = (parte: Partial<Divergencia>): Divergencia => ({
  id: "d",
  tipo: "VERBA_NAO_FECHA",
  canal: "AS",
  titulo: "VBZ 29",
  valor: 0,
  onde: "03.08.15, linha 12",
  sentido: "A_RECEBER",
  desfecho: "",
  ...parte,
});

const apuracaoCom = (divergencias: Divergencia[]): Apuracao => ({
  id: "a",
  rodadaEm: "2026-08-16T12:00:00.000Z",
  fontesPresentes: [],
  fontesAusentes: [],
  aliquotas: [],
  cargaFiscal: [],
  totais: { emitido: 0, esperado: 0, naoConferido: 0, diferenca: 0 },
  verbas: [],
  divergencias,
});

describe("oQueQuestionar", () => {
  it("deixa de fora a informativa: aviso da conciliação não é trabalho de ninguém", () => {
    const { acionaveis } = oQueQuestionar(
      apuracaoCom([
        divergencia({ id: "1", sentido: "INFORMATIVO", valor: 500 }),
        divergencia({ id: "2", sentido: "A_RECEBER", valor: 100 }),
      ]),
    );
    expect(acionaveis.map((d) => d.id)).toEqual(["2"]);
  });

  it("soma só o que reduz o que a transportadora recebe", () => {
    const { aReceber } = oQueQuestionar(
      apuracaoCom([
        divergencia({ id: "1", sentido: "A_RECEBER", valor: 100 }),
        divergencia({ id: "2", sentido: "A_PAGAR", valor: 40 }),
        divergencia({ id: "3", sentido: "A_RECEBER", valor: 12.5 }),
      ]),
    );
    expect(aReceber).toBe(112.5);
  });

  it("conta a A_PAGAR na fila, mesmo sem somá-la — ela também espera resposta", () => {
    const { acionaveis, aReceber } = oQueQuestionar(
      apuracaoCom([divergencia({ id: "1", sentido: "A_PAGAR", valor: 40 })]),
    );
    expect(acionaveis).toHaveLength(1);
    expect(aReceber).toBe(0);
  });

  it("sem divergência nenhuma, a fila é vazia e a soma é zero — e zero aqui é resultado", () => {
    const { acionaveis, aReceber } = oQueQuestionar(apuracaoCom([]));
    expect(acionaveis).toEqual([]);
    expect(aReceber).toBe(0);
  });
});

/**
 * O motivo da reabertura, conferido antes da viagem.
 *
 * A regra continua sendo do servidor — a rota recusa o vazio e
 * `reabrirCompetencia` recusa de novo —, e a mesma régua aqui existe para que o
 * botão não gaste uma ida e volta para dizer o que já se sabia.
 */
describe("motivoAceito", () => {
  it("aceita o motivo escrito", () => {
    expect(motivoAceito("a Ambev mandou o 03.08.20 depois do fechamento")).toBe(true);
  });

  it("recusa o campo vazio: reabrir sem dizer por quê é a alteração silenciosa", () => {
    expect(motivoAceito("")).toBe(false);
  });

  it("recusa o espaço em branco, que é o vazio escrito de outro jeito", () => {
    expect(motivoAceito("   ")).toBe(false);
    expect(motivoAceito("\n\t")).toBe(false);
  });

  it("aceita o motivo com espaço em volta — quem digita não apara a ponta", () => {
    expect(motivoAceito("  o 03.08.18 veio truncado  ")).toBe(true);
  });
});
