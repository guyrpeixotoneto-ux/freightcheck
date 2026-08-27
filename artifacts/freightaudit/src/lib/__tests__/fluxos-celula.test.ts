import { describe, expect, it } from "vitest";

import {
  celulaEmRepouso,
  reduzirCelula,
  type AcaoDaCelula,
  type EstadoDaCelula,
} from "@/lib/fluxos-celula";

/**
 * A CÉLULA EDITÁVEL DA LISTA, PROVADA SEM DOM.
 *
 * Cada caso aqui é um jeito conhecido de perder trabalho de quem edita, ou de
 * mandar para o servidor uma escrita que ninguém pediu. Eles não falam de
 * pixel: falam da máquina de estados que o componente executa, que é onde os
 * defeitos moram.
 */

/** Roda uma sequência de ações e devolve o estado final e o que foi gravado. */
function correr(
  valorGravado: string,
  acoes: AcaoDaCelula[],
): { estado: EstadoDaCelula; gravacoes: string[] } {
  let estado = celulaEmRepouso(valorGravado);
  const gravacoes: string[] = [];
  for (const acao of acoes) {
    const passo = reduzirCelula(estado, acao);
    estado = passo.estado;
    if (passo.gravar !== null) gravacoes.push(passo.gravar);
  }
  return { estado, gravacoes };
}

describe("gravar uma vez, e uma vez só", () => {
  it("Enter seguido do blur que ele mesmo provoca grava uma única vez", () => {
    /*
      O defeito clássico deste componente: `Enter` fecha o campo, fechar o campo
      tira o foco, e o `blur` grava de novo. Duas requisições para uma edição —
      e as duas montadas do mesmo cache velho.
    */
    const { gravacoes } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Contas a pagar" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: false },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: true },
    ]);
    expect(gravacoes).toEqual(["Contas a pagar"]);
  });

  it("Tab também grava uma vez só, mesmo com o blur atrás", () => {
    const { gravacoes } = correr("SAP", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Unidox" },
      { tipo: "confirmar", valorGravado: "SAP", saindo: true },
      { tipo: "confirmar", valorGravado: "SAP", saindo: true },
    ]);
    expect(gravacoes).toEqual(["Unidox"]);
  });

  it("abrir a célula de novo destranca — a segunda edição grava", () => {
    const { gravacoes } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Operação" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: false },
      { tipo: "gravou", valor: "Operação" },
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Financeiro" },
      { tipo: "confirmar", valorGravado: "Operação", saindo: false },
    ]);
    expect(gravacoes).toEqual(["Operação", "Financeiro"]);
  });
});

describe("o que não muda não grava", () => {
  it("abrir, ler e sair não manda nada para o servidor", () => {
    const { gravacoes, estado } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: true },
    ]);
    expect(gravacoes).toEqual([]);
    expect(estado.editando).toBe(false);
  });

  it("espaço em volta não é alteração — é o mesmo valor gravado", () => {
    const { gravacoes } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "  Fiscal  " },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: false },
    ]);
    expect(gravacoes).toEqual([]);
  });
});

describe("Esc desiste, e desistir é desistir", () => {
  it("Esc não grava e restaura exatamente o valor anterior", () => {
    const { gravacoes, estado } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "texto que ninguém quis" },
      { tipo: "cancelar", valorGravado: "Fiscal" },
    ]);
    expect(gravacoes).toEqual([]);
    expect(estado.rascunho).toBe("Fiscal");
    expect(estado.editando).toBe(false);
  });

  it("o blur que vem depois do Esc também não grava", () => {
    /* Sem a trava no cancelamento, escapar do campo acabaria gravando. */
    const { gravacoes } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "texto que ninguém quis" },
      { tipo: "cancelar", valorGravado: "Fiscal" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: true },
    ]);
    expect(gravacoes).toEqual([]);
  });
});

describe("o erro não custa o que foi digitado", () => {
  it("falhar com o campo aberto mantém o texto e reabre para tentar de novo", () => {
    const { estado } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Contas a pagar" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: false },
      { tipo: "falhou", frase: "O nome da etapa não pode ficar em branco.", saindo: false },
    ]);
    expect(estado.editando).toBe(true);
    expect(estado.rascunho).toBe("Contas a pagar");
    expect(estado.erro).toBe("O nome da etapa não pode ficar em branco.");
    expect(estado.salvando).toBe(false);
  });

  it("falhar depois de sair (Tab) não puxa o foco de volta, mas guarda o texto", () => {
    const { estado } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Contas a pagar" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: true },
      { tipo: "falhou", frase: "Falha de rede.", saindo: true },
    ]);
    expect(estado.editando).toBe(false);
    expect(estado.rascunho).toBe("Contas a pagar");
    expect(estado.erro).toBe("Falha de rede.");
  });

  it("depois da falha, tentar de novo grava — a trava não fica presa", () => {
    const { gravacoes } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Contas a pagar" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: false },
      { tipo: "falhou", frase: "Falha de rede.", saindo: false },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: false },
    ]);
    expect(gravacoes).toEqual(["Contas a pagar", "Contas a pagar"]);
  });

  it("uma recarga que chega no meio do erro não apaga o que está digitado", () => {
    const { estado } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Contas a pagar" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: true },
      { tipo: "falhou", frase: "Falha de rede.", saindo: true },
      { tipo: "sincronizar", valorGravado: "Fiscal" },
    ]);
    expect(estado.rascunho).toBe("Contas a pagar");
  });
});

describe("o valor gravado aparece na hora, e o de fora também", () => {
  it("depois de gravar, a célula mostra o que foi gravado sem esperar a recarga", () => {
    const { estado } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Operação" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: false },
      { tipo: "gravou", valor: "Operação" },
    ]);
    expect(estado.salvo).toBe("Operação");
    expect(estado.salvando).toBe(false);
  });

  it("quando a recarga chega com o mesmo valor, o local sai de cena", () => {
    const { estado } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "Operação" },
      { tipo: "confirmar", valorGravado: "Fiscal", saindo: false },
      { tipo: "gravou", valor: "Operação" },
      { tipo: "sincronizar", valorGravado: "Operação" },
    ]);
    expect(estado.salvo).toBeNull();
    expect(estado.rascunho).toBe("Operação");
  });

  it("uma alteração feita em outra visualização entra na célula fechada", () => {
    const { estado } = correr("Fiscal", [{ tipo: "sincronizar", valorGravado: "Financeiro" }]);
    expect(estado.rascunho).toBe("Financeiro");
  });

  it("sincronizar com o campo aberto não atropela quem está digitando", () => {
    const { estado } = correr("Fiscal", [
      { tipo: "abrir" },
      { tipo: "digitar", valor: "meio de uma fra" },
      { tipo: "sincronizar", valorGravado: "Financeiro" },
    ]);
    expect(estado.rascunho).toBe("meio de uma fra");
  });

  it("sincronizar sem novidade devolve o mesmo estado — nada de laço de renderização", () => {
    const inicial = celulaEmRepouso("Fiscal");
    const passo = reduzirCelula(inicial, { tipo: "sincronizar", valorGravado: "Fiscal" });
    expect(passo.estado).toBe(inicial);
    expect(passo.gravar).toBeNull();
  });
});
