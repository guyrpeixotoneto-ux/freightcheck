import { describe, expect, it } from "vitest";
import { acaoDoFechamento, anoAceito, lerParteDigitada, podeExcluir } from "../competencias";

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

/**
 * Quem pode ser excluída da lista.
 *
 * A régua tem um estado só do lado do não, e é o que importa: a quinzena
 * encerrada é a prova de uma cobrança, e apagá-la de um clique de lista apagaria
 * a prova sem que ninguém tenha dito por quê. Reabrir — com motivo escrito, que
 * fica no registro — é o caminho, e o servidor recusa do mesmo jeito.
 */
describe("podeExcluir", () => {
  it("recusa a encerrada: reabrir, com motivo, vem antes de apagar", () => {
    expect(podeExcluir("ENCERRADA")).toBe(false);
  });

  it("deixa excluir a que foi aberta por engano, antes de qualquer arquivo", () => {
    expect(podeExcluir("ABERTA")).toBe(true);
  });

  it("deixa excluir a que já apurou — apurar não é cobrar", () => {
    expect(podeExcluir("APURADA")).toBe(true);
    expect(podeExcluir("EM_APURACAO")).toBe(true);
  });

  it("deixa excluir a aprovada: aprovar não congela, encerrar é que congela", () => {
    expect(podeExcluir("APROVADA")).toBe(true);
  });
});

/**
 * O texto do campo, lido como `código — nome`.
 *
 * A leitura ficou sob teste quando o "Usar" deixou de guardar a parte só no
 * estado da tela e passou a gravá-la no servidor: o que antes era um rótulo
 * temporário virou o que fica escrito, e um separador lido errado passa a
 * cadastrar um CDD chamado `443 - CDD Belém` — código e tudo.
 */
describe("lerParteDigitada", () => {
  it("separa código e nome pelo travessão, pelo hífen e pela barra", () => {
    expect(lerParteDigitada("443 — CDD Belém")).toEqual({ codigo: "443", nome: "CDD Belém" });
    expect(lerParteDigitada("443 - CDD Belém")).toEqual({ codigo: "443", nome: "CDD Belém" });
    expect(lerParteDigitada("443 / CDD Belém")).toEqual({ codigo: "443", nome: "CDD Belém" });
  });

  it("sem separador, o texto inteiro é o código — o nome fica para depois", () => {
    expect(lerParteDigitada("  443  ")).toEqual({ codigo: "443", nome: null });
  });

  it("o nome com hífen no meio continua inteiro: o primeiro separador é o que separa", () => {
    expect(lerParteDigitada("443 — CDD Belém - Norte")).toEqual({
      codigo: "443",
      nome: "CDD Belém - Norte",
    });
  });
});
