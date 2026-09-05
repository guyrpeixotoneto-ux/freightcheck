// @vitest-environment jsdom
//
// A espera da relação do Monitoramento — por que ela tem tamanho.
//
// O defeito que se prende aqui: a tela abria curta e ficava longa. A lista
// pedia uma página inteira ao servidor e desenhava um punhado de barras cinzas
// enquanto ela vinha — oito barras para vinte e cinco chamados —, então a
// resposta chegava e a página crescia de repente debaixo de quem já estava
// lendo.
//
// O que estes testes prendem não é pixel: é que a espera desenha **tantas
// linhas quantas a página vai trazer**, e que ela tem a moldura da lista — a
// mesma tabela, o mesmo cabeçalho, o mesmo rodapé — para que a resposta troque
// cinza por texto sem mover mais nada.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListaDeChamados } from "../lista-de-chamados";

afterEach(cleanup);

const NADA = () => {};

function relacaoEsperando(linhas: number) {
  return render(
    <ListaDeChamados
      chamados={[]}
      carregando
      dia="2026-09-04"
      pagina={1}
      porPagina={25}
      total={0}
      onPagina={NADA}
      onPorPagina={NADA}
      tamanhos={[25, 50, 100]}
      procedencia="chamados.xlsx"
      linhasNaEspera={linhas}
    />,
  );
}

describe("a relação do envio, enquanto carrega", () => {
  it("desenha uma linha para cada linha que a página vai trazer", () => {
    const { container } = relacaoEsperando(25);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(25);
  });

  it("a última página, mais curta, espera mais curta", () => {
    const { container } = relacaoEsperando(1);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("mostra o cabeçalho da tabela — as colunas são fato, não dado que está vindo", () => {
    const { getByText, container } = relacaoEsperando(25);
    getByText("Chamado");
    getByText("Status");
    // Uma linha de cabeçalho, e as demais são as da espera.
    expect(container.querySelectorAll("thead tr")).toHaveLength(1);
  });

  it("não escreve contagem nenhuma no rodapé", () => {
    /*
      O `Paginacao` com total zero diria "Nenhum resultado" sobre uma lista que
      ainda está vindo. O rodapé da espera tem a altura do rodapé e não afirma
      número nenhum — a mesma disciplina dos cartões, que escrevem "—".
    */
    const { queryByText } = relacaoEsperando(25);
    expect(queryByText("Nenhum resultado")).toBeNull();
    expect(queryByText(/Mostrando/)).toBeNull();
  });
});
