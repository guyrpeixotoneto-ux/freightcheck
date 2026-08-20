import { describe, expect, it } from "vitest";
import { alternarGrupo, alternarUma, grupoEstaAberto } from "../linhas-abertas";

/**
 * O contrato de abrir a resposta na própria linha — o de Apurações e o da lista
 * de Remuneração, que é o mesmo.
 *
 * **Abrir uma não fecha as outras.** As duas telas existem para comparar — CDDs
 * de uma mesma quinzena, unidades de uma mesma vigência; se a resposta aberta
 * fosse uma só, ver a de baixo custaria a de cima, e comparar voltaria a ser
 * trocar de tela, que é exatamente o que a expansão veio evitar.
 *
 * **O cabeçalho do grupo termina de abri-lo, e não o fecha pela
 * metade.** Quem já abriu uma linha e clica no cabeçalho quer as outras também;
 * fechar o que se estava lendo seria o contrário do gesto. Só quando não falta
 * nenhuma o mesmo clique passa a fechar — aí "abrir tudo" não teria efeito
 * nenhum, e um botão sem efeito é um botão quebrado.
 */

const conjunto = (...ids: string[]) => new Set(ids) as ReadonlySet<string>;

describe("alternarUma", () => {
  it("abre a que estava fechada, sem tocar nas demais", () => {
    expect([...alternarUma(conjunto("belem"), "castanhal")]).toEqual(["belem", "castanhal"]);
  });

  it("fecha a que estava aberta, e só ela", () => {
    expect([...alternarUma(conjunto("belem", "castanhal"), "belem")]).toEqual(["castanhal"]);
  });

  it("devolve um conjunto novo — o anterior é o estado que o React já renderizou", () => {
    const antes = conjunto("belem");
    const depois = alternarUma(antes, "castanhal");
    expect(depois).not.toBe(antes);
    expect([...antes]).toEqual(["belem"]);
  });
});

describe("alternarGrupo", () => {
  it("abre o grupo inteiro quando nenhuma estava aberta", () => {
    expect([...alternarGrupo(conjunto(), ["belem", "castanhal"])]).toEqual(["belem", "castanhal"]);
  });

  it("termina de abrir o grupo meio aberto, em vez de fechar o que já se lia", () => {
    expect([...alternarGrupo(conjunto("belem"), ["belem", "castanhal"])]).toEqual([
      "belem",
      "castanhal",
    ]);
  });

  it("fecha o grupo só quando ele estava inteiro aberto", () => {
    expect([...alternarGrupo(conjunto("belem", "castanhal"), ["belem", "castanhal"])]).toEqual([]);
  });

  it("não mexe em linha de outro grupo", () => {
    const outra = "julho-2a-belem";
    expect([...alternarGrupo(conjunto(outra), ["belem", "castanhal"])]).toEqual([
      outra,
      "belem",
      "castanhal",
    ]);
  });
});

describe("grupoEstaAberto", () => {
  it("exige todas as linhas do grupo", () => {
    expect(grupoEstaAberto(conjunto("belem"), ["belem", "castanhal"])).toBe(false);
    expect(grupoEstaAberto(conjunto("belem", "castanhal"), ["belem", "castanhal"])).toBe(true);
  });

  /*
    `every` sobre lista vazia é `true`, e um grupo vazio ficaria eternamente
    "aberto" — com a seta girada e um clique que não abre nada. Nenhuma das duas
    listas desenha grupo sem linhas, mas a resposta certa aqui não depende
    disso.
  */
  it("um grupo sem linhas não está aberto", () => {
    expect(grupoEstaAberto(conjunto(), [])).toBe(false);
  });
});
