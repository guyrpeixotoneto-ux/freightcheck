import { describe, expect, it } from "vitest";
import { alternarGrupo, alternarUma, grupoEstaAberto } from "../apuracoes";

/**
 * O contrato de abrir a conta na própria lista de Apurações.
 *
 * **Abrir uma não fecha as outras.** A tela existe para comparar CDDs de uma
 * mesma quinzena; se a conta aberta fosse uma só, ver a de baixo custaria a de
 * cima, e comparar voltaria a ser trocar de tela — que é exatamente o que a
 * expansão veio evitar.
 *
 * **O cabeçalho da quinzena termina de abrir o grupo, e não o fecha pela
 * metade.** Quem já abriu um CDD e clica no cabeçalho quer os outros também;
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

  it("não mexe em competência de outra quinzena", () => {
    const outra = "julho-2a-belem";
    expect([...alternarGrupo(conjunto(outra), ["belem", "castanhal"])]).toEqual([
      outra,
      "belem",
      "castanhal",
    ]);
  });
});

describe("grupoEstaAberto", () => {
  it("exige todas as competências do grupo", () => {
    expect(grupoEstaAberto(conjunto("belem"), ["belem", "castanhal"])).toBe(false);
    expect(grupoEstaAberto(conjunto("belem", "castanhal"), ["belem", "castanhal"])).toBe(true);
  });

  /*
    `every` sobre lista vazia é `true`, e um grupo vazio ficaria eternamente
    "aberto" — com a seta girada e um clique que não abre nada. A lista nunca
    desenha um grupo sem linhas, mas a resposta certa aqui não depende disso.
  */
  it("um grupo sem competências não está aberto", () => {
    expect(grupoEstaAberto(conjunto(), [])).toBe(false);
  });
});
