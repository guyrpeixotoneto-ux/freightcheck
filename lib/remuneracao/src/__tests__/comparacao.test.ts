import { describe, expect, it } from "vitest";
import { compararCadastros, type LinhaComparada } from "../comparacao";
import { montarCadastro, type MaterialDoCadastro } from "../montagem";
import type { TrechoDaVigencia } from "../medicao";

/**
 * As duas quinzenas lado a lado.
 *
 * O que estes casos protegem, em uma frase: **lastro que aparece ou some não é
 * dinheiro que se moveu.** É a única forma de esta tela produzir um número
 * perigoso — um "+100%" que descreve uma coluna que passou a ser importada, e
 * não um centavo a mais na conta da transportadora. Os quatro primeiros casos
 * são sobre isso.
 *
 * O material imita o movimento real da aba de CDD Belém entre as duas quinzenas
 * de agosto: a frota e as alíquotas ficam paradas, e o que se move é a
 * proporção de documentos — 3,16% para 2,38% na planilha.
 */

const trecho = (t: Partial<TrechoDaVigencia>): TrechoDaVigencia => ({
  tributo: null,
  percentualDeclarado: null,
  freteCtrc: null,
  imposto: null,
  pisCofins: null,
  previsaoViagens: null,
  ...t,
});

/** Uma quinzena com 56 ativos, 8 inativos e 2 de 64 documentos no município. */
const PRIMEIRA: MaterialDoCadastro = {
  cavalos: [
    ...Array.from({ length: 56 }, (_, i) => ({ entityId: `a${i}`, ativo: true })),
    ...Array.from({ length: 8 }, (_, i) => ({ entityId: `i${i}`, ativo: false })),
  ],
  trechos: [
    trecho({ tributo: "ISS", freteCtrc: 1_000, imposto: 59, pisCofins: 92.5, previsaoViagens: 2 }),
    trecho({
      tributo: "ICMS",
      freteCtrc: 10_000,
      imposto: 1_784,
      pisCofins: 925,
      previsaoViagens: 62,
    }),
  ],
  trechosEntregues: true,
};

/** A seguinte: um ativo a menos, e 1 de 64 documentos no município. */
const SEGUNDA: MaterialDoCadastro = {
  cavalos: [
    ...Array.from({ length: 55 }, (_, i) => ({ entityId: `a${i}`, ativo: true })),
    ...Array.from({ length: 8 }, (_, i) => ({ entityId: `i${i}`, ativo: false })),
  ],
  trechos: [
    trecho({ tributo: "ISS", freteCtrc: 500, imposto: 29.5, pisCofins: 46.25, previsaoViagens: 1 }),
    trecho({
      tributo: "ICMS",
      freteCtrc: 10_000,
      imposto: 1_784,
      pisCofins: 925,
      previsaoViagens: 63,
    }),
  ],
  trechosEntregues: true,
};

const VAZIA: MaterialDoCadastro = { cavalos: [], trechos: [], trechosEntregues: false };

function comparar(a: MaterialDoCadastro, b: MaterialDoCadastro) {
  return compararCadastros(montarCadastro(a), montarCadastro(b));
}

function linha(
  comparacao: ReturnType<typeof comparar>,
  chave: string,
): LinhaComparada {
  const achada = comparacao.blocos.flatMap((b) => b.linhas).find((l) => l.chave === chave);
  if (!achada) throw new Error(`Linha desconhecida: ${chave}`);
  return achada;
}

describe("lastro não é dinheiro", () => {
  /*
    O caso central. A quinzena vazia não sustenta a alíquota; a seguinte
    sustenta. Isso não é "a alíquota subiu de 0 para 17,84%" — é o acervo que
    passou a responder, e a diferença tem de ser nula para que nenhuma soma
    corrente a apanhe.
  */
  it("linha que ganha lastro não vira aumento a partir de zero", () => {
    const icms = linha(comparar(VAZIA, PRIMEIRA), "aliquota_icms");

    expect(icms.movimento).toBe("GANHOU_LASTRO");
    expect(icms.variacao).toBeNull();
    expect(icms.esquerda.estado).toBe("SEM_LASTRO");
    expect(icms.direita.valor).toBeCloseTo(17.84, 4);
  });

  it("linha que perde lastro não vira queda até zero", () => {
    const icms = linha(comparar(PRIMEIRA, VAZIA), "aliquota_icms");

    expect(icms.movimento).toBe("PERDEU_LASTRO");
    expect(icms.variacao).toBeNull();
  });

  it("linha sem lastro dos dois lados não é comparação nenhuma", () => {
    const marketing = linha(comparar(PRIMEIRA, SEGUNDA), "marketing_sem_impostos");

    expect(marketing.movimento).toBe("SEM_COMPARACAO");
    expect(marketing.variacao).toBeNull();
  });

  it("conta os quatro movimentos separadamente no resumo", () => {
    const { resumo } = comparar(VAZIA, PRIMEIRA);

    expect(resumo.linhas).toBe(30);
    expect(resumo.ganharamLastro).toBe(11);
    expect(resumo.perderamLastro).toBe(0);
    expect(resumo.mudaram).toBe(0);
    expect(resumo.semComparacao).toBe(19);
  });
});

describe("o que se move entre as duas quinzenas", () => {
  it("mostra a queda da fatia dentro do município, com a variação junto", () => {
    const dentro = linha(comparar(PRIMEIRA, SEGUNDA), "rota_percentual_iss");

    // 2/64 = 3,125% → 1/64 = 1,5625%.
    expect(dentro.movimento).toBe("DESCEU");
    expect(dentro.esquerda.valor).toBeCloseTo(3.125, 4);
    expect(dentro.direita.valor).toBeCloseTo(1.5625, 4);
    expect(dentro.variacao!.absoluta).toBeCloseTo(-1.5625, 4);
    expect(dentro.variacao!.percentual).toBeCloseTo(-50, 4);
  });

  it("mostra a saída de um veículo da frota ativa", () => {
    const ativos = linha(comparar(PRIMEIRA, SEGUNDA), "frota_fixa_ativos");

    expect(ativos.movimento).toBe("DESCEU");
    expect(ativos.variacao!.absoluta).toBe(-1);
    expect(ativos.esquerda.valor).toBe(56);
    expect(ativos.direita.valor).toBe(55);
  });

  it("mantém parado o que não se moveu", () => {
    const comparacao = comparar(PRIMEIRA, SEGUNDA);

    // As alíquotas são as mesmas nas duas quinzenas — o estado, não a operação.
    expect(linha(comparacao, "aliquota_icms").movimento).toBe("IGUAL");
    expect(linha(comparacao, "aliquota_iss").movimento).toBe("IGUAL");
    expect(linha(comparacao, "resumo_ctrc").movimento).toBe("IGUAL");
    expect(linha(comparacao, "frota_fixa_inativos").movimento).toBe("IGUAL");
  });

  /*
    PIS e COFINS não têm número próprio, e ainda assim são comparáveis: o que se
    compara é o par medido. Sem isto, as duas linhas cairiam em
    `SEM_COMPARACAO` e a tela deixaria de avisar quando a carga de PIS/COFINS
    mudasse de uma quinzena para a outra.
  */
  it("compara PIS e COFINS pelo par, que é o que o acervo sustenta", () => {
    const pis = linha(comparar(PRIMEIRA, SEGUNDA), "aliquota_pis");

    expect(pis.esquerda.estado).toBe("EM_CONJUNTO");
    expect(pis.movimento).toBe("IGUAL");
    expect(pis.esquerda.conjunto!.valor).toBeCloseTo(9.25, 4);
  });

  it("não devolve percentual quando a base é zero", () => {
    const doZero = compararCadastros(
      montarCadastro({ ...PRIMEIRA, trechos: [trecho({ tributo: "ICMS", previsaoViagens: 1 })] }),
      montarCadastro(PRIMEIRA),
    );
    const dentro = linha(doZero, "rota_percentual_iss");

    // 0% → 3,125%: subiu 3,125 pontos, e o percentual disso não existe.
    expect(dentro.movimento).toBe("SUBIU");
    expect(dentro.variacao!.absoluta).toBeCloseTo(3.125, 4);
    expect(dentro.variacao!.percentual).toBeNull();
  });
});

describe("a forma da comparação", () => {
  it("devolve os mesmos blocos e as mesmas linhas do cadastro, na ordem", () => {
    const comparacao = comparar(PRIMEIRA, SEGUNDA);
    const so = montarCadastro(PRIMEIRA);

    expect(comparacao.blocos.map((b) => b.titulo)).toEqual(so.blocos.map((b) => b.titulo));
    expect(comparacao.blocos.flatMap((b) => b.linhas).map((l) => l.chave)).toEqual(
      so.blocos.flatMap((b) => b.linhas).map((l) => l.chave),
    );
  });

  it("fecha o resumo com o total de linhas", () => {
    const { resumo } = comparar(PRIMEIRA, SEGUNDA);

    expect(
      resumo.iguais +
        resumo.mudaram +
        resumo.ganharamLastro +
        resumo.perderamLastro +
        resumo.semComparacao,
    ).toBe(resumo.linhas);
  });

  it("comparar uma quinzena com ela mesma não move nada", () => {
    const { resumo } = comparar(PRIMEIRA, PRIMEIRA);

    expect(resumo.mudaram).toBe(0);
    expect(resumo.ganharamLastro).toBe(0);
    expect(resumo.perderamLastro).toBe(0);
    expect(resumo.iguais).toBe(11);
  });
});
