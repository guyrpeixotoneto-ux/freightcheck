import { describe, expect, it } from "vitest";

import { comOperacao } from "../api";
import { BASES_DE_AUDITORIA, OPERACAO_DA_AUDITORIA } from "../ambiente";

/**
 * **O carimbo da operação em toda chamada — a metade cliente do isolamento.**
 *
 * As quatro auditorias leem o mesmo produto sobre acervos diferentes, e o
 * servidor os separa por `?operacao=` (`snapshot.canal`). Quem carimba é
 * `getApiUrl`, no único lugar por onde todas as chamadas passam — as consultas,
 * as mutações e os downloads. Este arquivo prende as quatro regras desse
 * carimbo; a prova de que o servidor **honra** o parâmetro é a suíte de
 * isolamento, do outro lado (`isolamento-por-operacao.test.ts`).
 *
 * A função é testada com o endereço como argumento em vez de mexer em
 * `window.location`: a regra é uma função pura sobre o caminho, e é assim que
 * ela vale para os quatro ambientes sem montar navegador nenhum.
 */
describe("a operação na chamada", () => {
  it("carimba a operação de cada auditoria", () => {
    for (const [ambiente, base] of Object.entries(BASES_DE_AUDITORIA)) {
      const endereco = base === "" ? "/alteracoes" : `${base}/alteracoes`;
      const operacao = OPERACAO_DA_AUDITORIA[ambiente as keyof typeof OPERACAO_DA_AUDITORIA];

      expect(comOperacao("/contexts", endereco)).toBe(`/contexts?operacao=${operacao}`);
    }
  });

  it("preserva a consulta que a chamada já trazia", () => {
    expect(comOperacao("/changes/consolidated?period=2026-08-01", "/auditoria-rota/alteracoes")).toBe(
      "/changes/consolidated?period=2026-08-01&operacao=ROTA",
    );
  });

  /*
    Quem já mandou a operação sabe o que está fazendo — é o caso das telas que
    comparam dois ambientes, se um dia existirem. O carimbo nunca sobrescreve.
  */
  it("não sobrescreve a operação que a chamada declarou", () => {
    expect(comOperacao("/contexts?operacao=APOIO", "/auditoria-rota/alteracoes")).toBe(
      "/contexts?operacao=APOIO",
    );
  });

  /*
    Nos fechamentos o eixo é outro — `competencia.tipo_de_operacao` —, e um
    `operacao` a mais na consulta seria ruído que o servidor de lá não lê.
  */
  it("não carimba nada fora das auditorias", () => {
    expect(comOperacao("/fechamento/competencias", "/fechamento")).toBe(
      "/fechamento/competencias",
    );
    expect(comOperacao("/fechamento/apuracoes", "/fechamento-as/apuracoes")).toBe(
      "/fechamento/apuracoes",
    );
  });
});
