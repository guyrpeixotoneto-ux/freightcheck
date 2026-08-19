import { describe, expect, it } from "vitest";
import { acaoDoFechamento, anoAceito } from "../competencias";

/**
 * O contrato de fechar a quinzena a partir da lista de Importações.
 *
 * **Cada estado oferece uma coisa só, e nunca a errada.** Oferecer "fechar" a
 * quem não apurou produz um 409 do servidor que a pessoa não tinha como prever;
 * oferecer "fechar" a quem já encerrou é um botão que não faz nada. A lista
 * decide isso antes de desenhar, e é esta função que decide.
 *
 * **O ano é conferido antes da viagem.** A regra continua sendo do servidor —
 * ver `routes/fechamento.ts` —, e a mesma régua aqui existe para que o clique
 * não gaste uma ida e volta para dizer o que já se sabia.
 */

describe("acaoDoFechamento", () => {
  it("oferece fechar a quem tem apuração vigente", () => {
    expect(acaoDoFechamento("APURADA")).toBe("FECHAR");
  });

  it("oferece fechar a quem já foi aprovada — aprovar não desfaz a apuração", () => {
    expect(acaoDoFechamento("APROVADA")).toBe("FECHAR");
  });

  it("oferece reabrir a quem já encerrou, e não fechar de novo", () => {
    expect(acaoDoFechamento("ENCERRADA")).toBe("REABRIR");
  });

  it("manda apurar quem só abriu — encerrar sem apurar congela um período sem valor", () => {
    expect(acaoDoFechamento("ABERTA")).toBe("APURAR");
  });

  it("manda apurar enquanto a conta está rodando: não há apuração vigente ainda", () => {
    expect(acaoDoFechamento("EM_APURACAO")).toBe("APURAR");
  });
});

describe("anoAceito", () => {
  it("aceita o ano dentro da faixa que a rota aceita", () => {
    expect(anoAceito("2026")).toBe(true);
    expect(anoAceito("2000")).toBe(true);
    expect(anoAceito("2100")).toBe(true);
  });

  it("recusa fora da faixa, nas duas pontas", () => {
    expect(anoAceito("1999")).toBe(false);
    expect(anoAceito("2101")).toBe(false);
  });

  it("recusa o campo vazio em vez de o ler como ano zero", () => {
    expect(anoAceito("")).toBe(false);
    expect(anoAceito("   ")).toBe(false);
  });

  it("recusa o que não é número, e o número que não é inteiro", () => {
    expect(anoAceito("dois mil")).toBe(false);
    expect(anoAceito("2026,5")).toBe(false);
    expect(anoAceito("2026.5")).toBe(false);
  });

  it("aceita o ano com espaço em volta — quem digita não apaga o espaço", () => {
    expect(anoAceito(" 2026 ")).toBe(true);
  });
});
