// @vitest-environment jsdom
//
// A espera das duas listas do Monitoramento — por que ela tem tamanho.
//
// O defeito que se prende aqui: a tela abria curta e ficava longa. As listas
// pediam uma página inteira ao servidor e desenhavam um punhado de barras
// cinzas enquanto ela vinha — cinco cartões para vinte e cinco movimentações,
// oito barras para vinte e cinco chamados —, então a resposta chegava e a
// página crescia de repente debaixo de quem já estava lendo.
//
// O que estes testes prendem não é pixel: é que a espera desenha **tantas
// linhas quantas a página vai trazer**, e que ela tem a moldura da lista — a
// mesma tabela, o mesmo cabeçalho, o mesmo rodapé — para que a resposta troque
// cinza por texto sem mover mais nada.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListaDeChamados } from "../lista-de-chamados";
import { ListaDeMovimentacoes } from "../lista-de-movimentacoes";

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

function movimentacoesEsperando(linhas: number) {
  return render(
    <ListaDeMovimentacoes
      movimentacoes={[]}
      carregando
      ocupadas={new Set()}
      onRevisar={NADA}
      onDesfazer={NADA}
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

describe("as movimentações do dia, enquanto carregam", () => {
  it("desenha um cartão para cada movimentação que a página vai trazer", () => {
    const { container } = movimentacoesEsperando(25);
    expect(container.querySelectorAll("ul > li")).toHaveLength(25);
  });

  it("no dia sem movimentação, espera na forma da caixa que vem depois", () => {
    /*
      O resumo já respondeu zero: o que vem a seguir é "nenhuma movimentação
      neste dia", e uma lista de zero itens seria uma moldura de um pixel dando
      lugar a uma caixa de dez linhas — o mesmo salto, em ponto menor.
    */
    const { container } = movimentacoesEsperando(0);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
  });
});
