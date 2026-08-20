import { describe, expect, it } from "vitest";
import {
  acaoDoFechamento,
  lerParteDigitada,
  paraOFormulario,
  podeExcluir,
} from "../competencias";

/**
 * O contrato de fechar a quinzena a partir da lista de Importações.
 *
 * **Cada estado oferece uma coisa só, e nunca a errada.** Oferecer "fechar" a
 * quem não apurou produz um 409 do servidor que a pessoa não tinha como prever;
 * oferecer "fechar" a quem já encerrou é um botão que não faz nada. A lista
 * decide isso antes de desenhar, e é esta função que decide.
 *
 * A régua do ano saiu daqui junto com `anoAceito`, que passou a ser lida também
 * pelo cadastro da unidade — ver `lib/__tests__/fechamento-tela.test.ts`.
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

/**
 * Como o texto da busca se divide entre os dois campos do formulário.
 *
 * O campo de código nasceu porque `443 — CDD Belém` numa caixa só cobrava da
 * pessoa uma sintaxe, e quem digitava só `CDD Belém` cadastrava uma parte cujo
 * **código era "CDD Belém"** — silenciosamente, e é o código que o cadastro de
 * Remuneração usa para encontrar o fechamento. O que se prova aqui é que o
 * texto nunca se perde no caminho para o formulário.
 */
describe("paraOFormulario", () => {
  it("com separador, respeita o que a pessoa separou", () => {
    expect(paraOFormulario("443 — CDD Belém")).toEqual({ codigo: "443", nome: "CDD Belém" });
    expect(paraOFormulario("36 / Horizonte")).toEqual({ codigo: "36", nome: "Horizonte" });
  });

  it("só dígitos é código — a régua que esta tela já declarava", () => {
    expect(paraOFormulario("443")).toEqual({ codigo: "443", nome: null });
    expect(paraOFormulario("  0036 ")).toEqual({ codigo: "0036", nome: null });
  });

  it("o CNPJ inteiro é código, e não parte ao meio na barra", () => {
    /*
      A barra e o hífen do CNPJ são os separadores que `lerParteDigitada`
      procura. Sem a guarda, `12.345.678/0001-99` virava código `12.345.678` e
      nome `0001-99` — num campo cuja única função é casar com o cadastro de
      Remuneração, onde o CNPJ é o formato que a tela pede.
    */
    expect(paraOFormulario("12.345.678/0001-99")).toEqual({
      codigo: "12.345.678/0001-99",
      nome: null,
    });
    expect(lerParteDigitada("12.345.678/0001-99").nome).toBe("0001-99");
  });

  it("nome com hífen continua sendo nome inteiro", () => {
    expect(paraOFormulario("CDD Belém - Norte")).toEqual({
      codigo: "",
      nome: "CDD Belém - Norte",
    });
  });

  it("qualquer outra coisa é nome, e nunca vira código por engano", () => {
    expect(paraOFormulario("CDD Belém")).toEqual({ codigo: "", nome: "CDD Belém" });
    expect(paraOFormulario("HORIZONTE LOGISTICA")).toEqual({
      codigo: "",
      nome: "HORIZONTE LOGISTICA",
    });
  });

  it("o texto sobrevive em todos os caminhos", () => {
    for (const texto of ["443", "CDD Belém", "443 — CDD Belém", "12.345.678/0001-99"]) {
      const { codigo, nome } = paraOFormulario(texto);
      expect(`${codigo}${nome ?? ""}`.replace(/\s|—/g, "")).toBe(texto.replace(/\s|—/g, ""));
    }
  });
});
