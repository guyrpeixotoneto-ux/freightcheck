// A POLÍTICA DO IMPACTO — os três estados, e a fronteira entre o segundo e o
// terceiro, que é a razão de ela existir.
//
// O defeito que ela fecha, medido em 17/09/2026 na Auditoria de Seguro e na de
// Impostos: quatro superfícies respondiam pela mesma comparação e decidiam
// sozinhas. O cartão dizia "Sem impacto precificável", o menu do par dizia
// "R$ 0,00", a tabela publicava +R$ 317,07 na linha da carreta e o painel de
// evolução publicava +R$ 2.318,77. Nenhuma delas sabia da outra.
//
// O que se prende aqui é a decisão, que agora é uma só: `R$ 0,00` é uma conta
// que aconteceu e deu zero; a coluna calada é uma conta que não aconteceu; e
// dinheiro em tela sobre a segunda é valor declarado, não confirmado.
import { describe, expect, it } from "vitest";

import {
  leituraDoImpacto,
  VALOR_DECLARADO_SEM_CONFIRMACAO,
} from "../politica-do-impacto";

describe("estado 1 — precificado", () => {
  it("com dinheiro somado, publica o dinheiro", () => {
    expect(leituraDoImpacto({ MENSAL: -17171.54 }, 0)).toEqual({
      estado: "PRECIFICADO",
      publicaValor: true,
      declaradoSemConfirmacao: false,
      naoPrecificadas: 0,
    });
  });

  /*
    Um recorte que precificou **parte** do que mudou publica o que precificou:
    calar a coluna ali esconderia dinheiro medido por causa do que ficou por
    medir. É a regra que impede a política de virar tudo-ou-nada.
  */
  it("com parte precificada e parte não, ainda publica o que mediu", () => {
    const leitura = leituraDoImpacto({ MENSAL: 250 }, 7);
    expect(leitura.estado).toBe("PRECIFICADO");
    expect(leitura.declaradoSemConfirmacao).toBe(false);
  });

  /* Zero num balde é um valor medido, e não a ausência de baldes. */
  it("um balde que deu zero é valor medido, não ausência", () => {
    expect(leituraDoImpacto({ MENSAL: 0 }, 3).estado).toBe("PRECIFICADO");
  });
});

describe("estado 2 — zero", () => {
  /*
    O caso comum do Seguro: três das cinco colunas são taxa fixa e não se
    moveram. A conta aconteceu, e deu zero — que é a notícia que quem audita
    veio buscar. Era aqui que o cartão escrevia a frase do estado 3.
  */
  it("sem dinheiro e sem nada por precificar, o valor é publicável", () => {
    expect(leituraDoImpacto({}, 0)).toEqual({
      estado: "ZERO",
      publicaValor: true,
      declaradoSemConfirmacao: false,
      naoPrecificadas: 0,
    });
  });
});

describe("estado 3 — não precificável", () => {
  /*
    O caso da carreta que foi de R$ 180,79 a R$ 631,41 sem que um real
    aparecesse na soma: `carreta.seguro` está PRESUMED, e o portão da curadoria
    recusa somar o que não foi confirmado.
  */
  it("sem dinheiro somado e com movimento monetário recusado, não publica valor", () => {
    expect(leituraDoImpacto({}, 12)).toEqual({
      estado: "NAO_PRECIFICAVEL",
      publicaValor: false,
      declaradoSemConfirmacao: true,
      naoPrecificadas: 12,
    });
  });

  it("carrega a contagem, que é o que o cartão escreve ao lado da frase", () => {
    expect(leituraDoImpacto({}, 1).naoPrecificadas).toBe(1);
  });

  /* A ressalva é uma frase só, e a mesma nas quatro superfícies. */
  it("a ressalva diz que o valor é declarado e não entra no apurado", () => {
    expect(VALOR_DECLARADO_SEM_CONFIRMACAO).toMatch(/declarados pelo export/);
    expect(VALOR_DECLARADO_SEM_CONFIRMACAO).toMatch(/não entram no impacto apurado/);
  });
});

/**
 * A invariante que as quatro superfícies dividem.
 *
 * `publicaValor` e `declaradoSemConfirmacao` são complementares por
 * construção: ou a tela publica um valor apurado, ou o dinheiro que ela
 * mostra é declarado e precisa da ressalva. Nunca as duas, nunca nenhuma —
 * era exatamente "nenhuma das duas" que a tabela e o painel de evolução
 * faziam, publicando reais sem dizer o que eram.
 */
describe("a invariante das quatro superfícies", () => {
  it("publicar valor e ressalvar são estados complementares", () => {
    const recortes: Record<string, number>[] = [{}, { MENSAL: 0 }, { MENSAL: 100 }, { ANUAL: -5 }];
    for (const porPeriodicidade of recortes) {
      for (const naoPrecificadas of [0, 1, 99]) {
        const leitura = leituraDoImpacto(porPeriodicidade, naoPrecificadas);
        expect(leitura.publicaValor).toBe(!leitura.declaradoSemConfirmacao);
      }
    }
  });

  it("a contagem só desce no estado que a usa", () => {
    expect(leituraDoImpacto({ MENSAL: 1 }, 9).naoPrecificadas).toBe(0);
    expect(leituraDoImpacto({}, 0).naoPrecificadas).toBe(0);
    expect(leituraDoImpacto({}, 9).naoPrecificadas).toBe(9);
  });
});
