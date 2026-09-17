// @vitest-environment jsdom
//
// A tela da pesquisa de mercado — e a promessa que ela não pode quebrar.
//
// A regra do agente é que **não há preço sem fonte**, e ela só vale de verdade
// se sobreviver até o pixel: um cartão que mostre o número e engula o link
// desfaz, na última camada, o trabalho que a conferência determinística fez na
// primeira. Por isso a prova de baixo é sobre o que está escrito na tela, e não
// sobre o objeto que a alimenta.
//
// A segunda promessa é a da oferta recusada. A mais barata costuma ser
// justamente a que não serve — medida errada, embalagem desconhecida, captura
// velha —, e escondê-la faria a mesma pessoa reencontrá-la sozinha meia hora
// depois, sem saber por que havia sido descartada.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CartaoDoMercado } from "../cartao-do-mercado";
import type { OfertaAnalisada, PesquisaDeMercado } from "../tipos";

afterEach(cleanup);

const CAPTURA = "2026-09-17T12:00:00.000Z";

function oferta(p: {
  fornecedor: string;
  fonte: string;
  preco: number;
  custoTotal: number | null;
  classe?: OfertaAnalisada["match"]["classe"];
  entrouNaConta?: boolean;
  foraPorque?: string | null;
  fonteDuvidosa?: boolean;
  frescor?: OfertaAnalisada["frescor"];
}): OfertaAnalisada {
  return {
    oferta: {
      fornecedor: p.fornecedor,
      produto: "Pneu 295/80 R22.5",
      marca: null,
      especificacao: null,
      preco: p.preco,
      unidadeDoPreco: "UNIDADE",
      unidadesPorEmbalagem: null,
      quantidadeMinima: null,
      disponibilidade: null,
      frete: null,
      freteIncluso: true,
      impostos: null,
      prazoEmDias: null,
      condicaoComercial: null,
      trecho: `R$ ${p.preco}`,
      proveniencia: {
        url: `https://${p.fonte}/pneu`,
        titulo: null,
        fonte: p.fonte,
        capturadoEm: CAPTURA,
        idadeDaPagina: null,
      },
    },
    match: {
      classe: p.classe ?? "EXATO",
      atributos: [],
      porque: "",
      comparavel: (p.classe ?? "EXATO") !== "NAO_COMPARAVEL",
    },
    custo: {
      precoAnunciado: p.preco,
      unidadeDoPreco: "UNIDADE",
      precoPorUnidade: p.preco,
      fretePorUnidade: 0,
      impostoPorUnidade: 0,
      custoTotal: p.custoTotal,
      completo: true,
      semCusto: null,
      abaixoDoMinimo: false,
      conta: `${p.preco} por unidade`,
    },
    frescor: p.frescor ?? "AGORA",
    entrouNaConta: p.entrouNaConta ?? true,
    foraPorque: p.foraPorque ?? null,
    fonteDuvidosa: p.fonteDuvidosa ?? false,
  };
}

const BOA = oferta({
  fornecedor: "Pneus Alfa",
  fonte: "alfa.example",
  preco: 1380,
  custoTotal: 1380,
});
const CARA = oferta({
  fornecedor: "Pneus Beta",
  fonte: "beta.example",
  preco: 1450,
  custoTotal: 1450,
});
const ERRADA = oferta({
  fornecedor: "Pneus Gama",
  fonte: "gama.example",
  preco: 890,
  custoTotal: 890,
  classe: "NAO_COMPARAVEL",
  entrouNaConta: false,
  foraPorque:
    "Fora da conta: a oferta declara 215/75R17.5 onde a especificação pede 295/80R22.5.",
});

function pesquisa(over: Partial<PesquisaDeMercado> = {}): PesquisaDeMercado {
  return {
    especificacao: {
      item: "pneu",
      titulo: "Pneus",
      descricao: "Pneu 295/80 R22.5",
      atributos: [
        {
          tipo: "MEDIDA_PNEU",
          bruto: "295/80 R22.5",
          canonico: "295/80R22.5",
          origem: "Descrição",
        },
      ],
      quantidade: 40,
      regiao: "Camaçari/BA",
      consulta: "Pneu 295/80 R22.5, 40 unidades, entrega em Camaçari/BA",
      lacunas: [],
    },
    buscador: "fixture",
    consultas: ["Pneu 295/80 R22.5"],
    indisponivel: null,
    paginas: [],
    ofertas: [BOA, CARA, ERRADA],
    descartadas: [],
    leitura: {
      ofertas: 2,
      menor: 1380,
      maior: 1450,
      mediana: 1415,
      media: 1415,
      dispersao: 0.02,
    },
    melhor: BOA,
    alvo: {
      piso: 1380,
      teto: 1415,
      evidencias: [],
      derivacao:
        "Piso 1380.00 — o menor custo total comparável entre 2 ofertas; teto 1415.00 — a mediana do mercado.",
    },
    confianca: {
      confianca: "MEDIA",
      pontos: 63,
      fatores: [
        {
          fator: "Volume de ofertas",
          observado: "2 ofertas comparáveis",
          penalidade: 25,
        },
      ],
    },
    economia: {
      precoAtual: 1500,
      precoRecomendado: 1415,
      economiaUnitaria: 85,
      quantidade: 40,
      economiaTotal: 3400,
    },
    margem: {
      remuneracaoUnitaria: 1700,
      custoDeCompra: 1380,
      margemUnitaria: 320,
      quantidade: 40,
      margemTotal: 12800,
    },
    frescor: "AGORA",
    medicao: { latenciaMs: 0, paginasBaixadas: 3 },
    ...over,
  };
}

describe("nenhum preço aparece sem a fonte e a hora", () => {
  it("cada oferta leva o link do domínio e o instante da captura", () => {
    render(<CartaoDoMercado pesquisa={pesquisa()} />);

    for (const fonte of ["alfa.example", "beta.example", "gama.example"]) {
      const link = screen.getByRole("link", { name: new RegExp(fonte) });
      expect(link.getAttribute("href")).toBe(`https://${fonte}/pneu`);
      /* Página de terceiro nunca abre com acesso à janela que a abriu. */
      expect(link.getAttribute("rel")).toContain("noopener");
    }

    expect(screen.getAllByText(/Capturado em/).length).toBe(3);
  });
});

describe("a oferta recusada continua visível, e diz por quê", () => {
  it("mostra a mais barata marcada como não comparável", () => {
    render(<CartaoDoMercado pesquisa={pesquisa()} />);

    expect(screen.getByText("Pneus Gama")).toBeTruthy();
    expect(screen.getByText("Não comparável")).toBeTruthy();
    expect(
      screen.getByText(/215\/75R17\.5 onde a especificação pede/),
    ).toBeTruthy();
  });

  it("e o melhor comparável não é ela", () => {
    render(<CartaoDoMercado pesquisa={pesquisa()} />);
    /* R$ 890 é o menor número da lista e não pode encabeçar a recomendação. */
    expect(
      screen.getByText("Melhor comparável").parentElement?.textContent,
    ).toContain("1.380");
  });
});

describe("economia e margem aparecem separadas", () => {
  it("são duas medidas, com dois rótulos", () => {
    render(<CartaoDoMercado pesquisa={pesquisa()} />);
    expect(screen.getByText("Economia por unidade")).toBeTruthy();
    expect(screen.getByText("Margem por unidade")).toBeTruthy();
    expect(
      screen.getByText(/contra R\$\s*1\.500,00 que se paga hoje/),
    ).toBeTruthy();
  });

  it("margem negativa sai em vermelho, e a economia continua positiva", () => {
    /*
      Comprar melhor que antes e ainda assim acima da remuneração é o caso
      normal de um item mal remunerado. Um número só esconderia isso.
    */
    render(
      <CartaoDoMercado
        pesquisa={pesquisa({
          margem: {
            remuneracaoUnitaria: 1000,
            custoDeCompra: 1380,
            margemUnitaria: -380,
            quantidade: 40,
            margemTotal: -15200,
          },
        })}
      />,
    );
    const margem = screen.getByText("Margem por unidade").parentElement!;
    /* O sinal é o menos tipográfico (−), e não o hífen: ver `formatBrl`. */
    expect(margem.textContent).toContain("\u2212R$");
    expect(margem.querySelector(".text-rose-600")).toBeTruthy();
  });
});

describe("o que a pesquisa não conseguiu fica escrito", () => {
  it("sem faixa, mostra o motivo em vez de um número", () => {
    render(
      <CartaoDoMercado
        pesquisa={pesquisa({
          alvo: {
            porque: "Só uma oferta comparável foi encontrada.",
            evidencias: [],
          },
        })}
      />,
    );
    expect(screen.getByText(/Só uma oferta comparável/)).toBeTruthy();
    expect(screen.getByText("sem evidência suficiente")).toBeTruthy();
  });

  it("busca indisponível aparece como aviso, e o cartão não some", () => {
    render(
      <CartaoDoMercado
        pesquisa={pesquisa({
          indisponivel: "A pesquisa de mercado precisa de uma chave de modelo.",
          ofertas: [],
          leitura: null,
          melhor: null,
        })}
      />,
    );
    expect(screen.getByText(/precisa de uma chave de modelo/)).toBeTruthy();
    expect(screen.getByText(/Mercado — Pneus/)).toBeTruthy();
  });

  it("a página que tentou dar ordens ao agente é marcada na tela", () => {
    render(
      <CartaoDoMercado
        pesquisa={pesquisa({
          ofertas: [
            oferta({
              fornecedor: "Loja Hostil",
              fonte: "hostil.example",
              preco: 1200,
              custoTotal: 1200,
              fonteDuvidosa: true,
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText(/tentou dar instruções ao agente/)).toBeTruthy();
  });

  it("a captura velha aparece com a idade, e não calada", () => {
    render(
      <CartaoDoMercado
        pesquisa={pesquisa({
          ofertas: [
            oferta({
              fornecedor: "Loja Antiga",
              fonte: "antiga.example",
              preco: 900,
              custoTotal: 900,
              frescor: "VELHA",
              entrouNaConta: false,
              foraPorque: "Fora da conta: a captura tem mais de uma semana.",
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Mais de uma semana")).toBeTruthy();
    expect(screen.getByText(/mais de uma semana/)).toBeTruthy();
  });
});
