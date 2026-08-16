import { describe, expect, it } from "vitest";
import { faixaDaPagina, numerosDePagina } from "../paginacao";

/**
 * A conta do rodapé, que é o que decide se dá para chegar ao resto da lista.
 *
 * O caso que originou tudo isto é o export real de chamados: 1.218 alterações,
 * das quais a tela mostrava 300 e escrevia "use os filtros para chegar ao
 * restante". Com 100 por página são treze páginas, e o rodapé precisa dizer
 * qual delas está na tela e por onde ir às outras.
 */

describe("numerosDePagina", () => {
  it("mostra todas quando cabem — sem reticência inútil", () => {
    expect(numerosDePagina(1, 1)).toEqual([1]);
    expect(numerosDePagina(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("mantém a primeira, a última e duas de cada lado da atual", () => {
    expect(numerosDePagina(10, 40)).toEqual([1, null, 8, 9, 10, 11, 12, null, 40]);
  });

  it("não abre reticência para pular uma página só", () => {
    // Com a atual perto da ponta, a "lacuna" é de uma página — e "1 … 3" ocupa
    // mais espaço do que "1 2 3", escondendo uma página para economizar nada.
    expect(numerosDePagina(3, 13)).toEqual([1, 2, 3, 4, 5, null, 13]);
    expect(numerosDePagina(12, 13)).toEqual([1, null, 10, 11, 12, 13]);
  });
});

describe("faixaDaPagina", () => {
  it("conta a faixa como uma pessoa contaria — 1-based, inclusiva", () => {
    expect(faixaDaPagina(1, 100, 1218)).toMatchObject({
      primeiro: 1,
      ultimo: 100,
      totalPaginas: 13,
      atual: 1,
    });
    expect(faixaDaPagina(4, 100, 1218)).toMatchObject({
      primeiro: 301,
      ultimo: 400,
    });
  });

  it("não promete linha que não existe na última página", () => {
    // 13 × 100 = 1.300, e o arquivo tem 1.218: a última página vai até o total,
    // e não até onde a multiplicação daria.
    expect(faixaDaPagina(13, 100, 1218)).toMatchObject({
      primeiro: 1201,
      ultimo: 1218,
    });
  });

  it("prende a página pedida no que existe", () => {
    /*
      É o caso do filtro aplicado da página 9: a lista encurta para 40 e a
      página 9 deixa de existir. Sem isto o rodapé anunciaria "Mostrando 801 -
      900 de 40" sobre uma tabela vazia.
    */
    expect(faixaDaPagina(9, 100, 40)).toMatchObject({
      atual: 1,
      primeiro: 1,
      ultimo: 40,
      totalPaginas: 1,
    });
    expect(faixaDaPagina(0, 100, 400)).toMatchObject({ atual: 1 });
  });

  it("diz 'nenhum resultado' sem inventar a linha 1", () => {
    expect(faixaDaPagina(1, 100, 0)).toMatchObject({
      primeiro: 0,
      ultimo: 0,
      totalPaginas: 1,
    });
  });
});
