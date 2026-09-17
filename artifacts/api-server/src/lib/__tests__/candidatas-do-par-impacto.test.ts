import { describe, expect, it } from "vitest";
import {
  impactoDeSeguro,
  linhaDeSeguroDaAlteracao,
  SEM_IMPACTO_PRECIFICAVEL_DE_SEGURO,
  type AlteracaoDoMotor,
  type LinhaDeSeguro,
} from "@workspace/comparison";
import { impactoPublicavel } from "../candidatas-do-par";

/**
 * OS TRÊS ESTADOS DA COLUNA DE DINHEIRO DO MENU DE VIGÊNCIAS.
 *
 * O defeito que trouxe este arquivo: na Auditoria de Seguro, o cartão dizia
 * "Sem impacto precificável" e o menu, no mesmo par, escrevia `R$ 0,00` —
 * enquanto a tabela logo abaixo listava a carreta cujo seguro tinha ido de
 * R$ 180,79 a R$ 631,41. O movimento existia; o que não existia era semântica
 * confirmada para monetizá-lo, e a rota descia `baldes: []` sem dizer isso.
 *
 * `R$ 0,00` é uma afirmação — *a conta aconteceu e deu zero* — e ela não pode
 * sair de um recorte em que a conta foi recusada. Os três estados que estes
 * casos prendem são:
 *
 * 1. precificado e diferente de zero → o valor;
 * 2. precificado e igual a zero → `R$ 0,00`, que é notícia e não ausência;
 * 3. mudou dinheiro e ninguém pôde precificar → nada de `R$ 0,00`, só a
 *    contagem, com `semImpacto` carregando o porquê.
 *
 * E o quarto caso, que é o que garante não haver regra especial escondida
 * aqui: **confirmada a semântica, o valor aparece sozinho**. A única coisa que
 * muda no caminho é o veredito do motor (`impactConfidence`), que é o que a
 * curadoria move — nunca uma exceção por código de atributo.
 */

/** Uma alteração como o motor a grava, com o veredito de impacto por fora. */
const alteracao = (
  over: Partial<AlteracaoDoMotor> & {
    attributeCode: string;
  },
): AlteracaoDoMotor => ({
  id: 1,
  changeType: "VALUE_CHANGED",
  entityLabel: "RZM0C41",
  entityType: "CARRETA",
  valueBefore: "180.79",
  valueAfter: "631.41",
  deltaAbsolute: "450.62",
  deltaPercent: "249.25",
  comparability: "COMPARABLE",
  attributeName: null,
  ...over,
});

/**
 * O seguro de uma carreta que mudou — precificado ou não, conforme a curadoria.
 *
 * `PRESUMED` é o estado real de `carreta.seguro` no acervo: o motor devolve o
 * delta (a tabela mostra +R$ 450,62) e **recusa** o impacto, porque
 * `viraDinheiro` só passa o que a curadoria confirmou. `CALCULATED` é o mesmo
 * atributo depois da confirmação — nada mais muda de lado nenhum.
 */
const seguroQueMudou = (
  confianca: "PRESUMED" | "CALCULATED",
): LinhaDeSeguro => {
  const linha = linhaDeSeguroDaAlteracao(
    alteracao(
      confianca === "CALCULATED"
        ? {
            attributeCode: "carreta.seguro",
            impactConfidence: "CALCULATED",
            impactAmount: "450.62",
            impactPeriodicity: "MENSAL",
          }
        : {
            attributeCode: "carreta.seguro",
            impactConfidence: "PRESUMED",
            impactAmount: null,
            impactPeriodicity: null,
          },
    ),
  );
  if (!linha) throw new Error("carreta.seguro tem de ser linha desta rubrica");
  return linha;
};

/** O que a rota de candidatas faz com o impacto de um recorte de seguro. */
const numerosDoRecorte = (linhas: readonly LinhaDeSeguro[]) => {
  const impacto = impactoDeSeguro(linhas);
  return {
    impacto,
    numeros: impactoPublicavel(impacto.porPeriodicidade, {
      naoPublicadas: impacto.naoCalculavel,
      semImpacto: SEM_IMPACTO_PRECIFICAVEL_DE_SEGURO,
    }),
  };
};

describe("o que uma candidata pode afirmar sobre dinheiro", () => {
  /**
   * O estado 3 — o defeito.
   *
   * Duas carretas, os dois números da tela que abriu o assunto. O recorte tem
   * alteração, tem delta, e não tem um real publicável: `semImpacto` desce, e
   * `baldes` fica vazio **sem** que isso vire zero na linha.
   */
  it("mudou dinheiro e ninguém precificou: diz por quê, e não escreve zero", () => {
    const { impacto, numeros } = numerosDoRecorte([
      seguroQueMudou("PRESUMED"),
      linhaDeSeguroDaAlteracao(
        alteracao({
          id: 2,
          attributeCode: "carreta.seguro",
          entityLabel: "RZF8F68",
          valueBefore: "159.80",
          valueAfter: "476.87",
          deltaAbsolute: "317.07",
          deltaPercent: "198.42",
          impactConfidence: "PRESUMED",
        }),
      )!,
    ]);

    expect(impacto.naoCalculavel).toBe(2);
    expect(numeros.impacto.baldes).toEqual([]);
    expect(numeros.semImpacto).toBe(SEM_IMPACTO_PRECIFICAVEL_DE_SEGURO);
  });

  /**
   * O estado 2, e a razão de ele não poder ser apagado junto com o defeito.
   *
   * Um par em que nada se moveu tem a conta feita e o resultado é zero — a
   * notícia que quem audita veio buscar. Calar a coluna aqui devolveria o menu
   * mudo, que naquela tela quer dizer *ainda não calculei*.
   */
  it("nada se moveu e nada ficou por precificar: continua sendo R$ 0,00", () => {
    const { impacto, numeros } = numerosDoRecorte([]);

    expect(impacto.naoCalculavel).toBe(0);
    expect(numeros.impacto.baldes).toEqual([]);
    expect(numeros.semImpacto).toBeUndefined();
  });

  /**
   * O estado 2 com movimento: o motor precificou, e o líquido deu zero.
   *
   * Uma carreta sobe R$ 450,62 e outra cai o mesmo tanto. O balde existe, vale
   * zero, e é isso que a linha escreve — `R$ 0,00` aqui é a conta, não a falta
   * dela.
   */
  it("precificado e líquido zero: publica o balde zerado, sem frase", () => {
    const { numeros } = numerosDoRecorte([
      seguroQueMudou("CALCULATED"),
      linhaDeSeguroDaAlteracao(
        alteracao({
          id: 2,
          attributeCode: "carreta.seguro",
          entityLabel: "RZF8F68",
          valueBefore: "631.41",
          valueAfter: "180.79",
          deltaAbsolute: "-450.62",
          deltaPercent: "-71.37",
          impactConfidence: "CALCULATED",
          impactAmount: "-450.62",
          impactPeriodicity: "MENSAL",
        }),
      )!,
    ]);

    expect(numeros.impacto.baldes).toEqual([{ periodicidade: "MENSAL", valor: 0 }]);
    expect(numeros.semImpacto).toBeUndefined();
  });

  /** O estado 1: precificado e com direção — o valor desce inteiro. */
  it("precificado e diferente de zero: publica o valor", () => {
    const { numeros } = numerosDoRecorte([seguroQueMudou("CALCULATED")]);

    expect(numeros.impacto.baldes).toEqual([
      { periodicidade: "MENSAL", valor: 450.62 },
    ]);
    expect(numeros.semImpacto).toBeUndefined();
  });

  /**
   * A prova de que não há regra por atributo: **só o veredito muda**.
   *
   * O mesmo `carreta.seguro`, a mesma placa, os mesmos dois lados. PRESUMED
   * (o acervo de hoje) cala a coluna e explica; CALCULATED (o dia em que a
   * curadoria confirmar) publica os R$ 450,62. Nada entre um e outro conhece o
   * nome da coluna, e por isso a confirmação não pede alteração de código
   * nenhuma — nem aqui, nem na rota.
   */
  it("confirmada a semântica, o valor aparece sozinho", () => {
    const presumido = numerosDoRecorte([seguroQueMudou("PRESUMED")]);
    const confirmado = numerosDoRecorte([seguroQueMudou("CALCULATED")]);

    expect(presumido.numeros.semImpacto).toBe(SEM_IMPACTO_PRECIFICAVEL_DE_SEGURO);
    expect(presumido.numeros.impacto.baldes).toEqual([]);

    expect(confirmado.numeros.semImpacto).toBeUndefined();
    expect(confirmado.numeros.impacto.baldes).toEqual([
      { periodicidade: "MENSAL", valor: 450.62 },
    ]);
  });

  /**
   * Precificou parte: publica a parte, e não cala tudo pelo resto.
   *
   * Calar a coluna porque **algo** ficou sem preço esconderia dinheiro medido —
   * o erro simétrico ao que se corrigiu. O cartão da tela mostra os baldes pela
   * mesma régua; um menu que calasse aqui voltaria a discordar dele, só que no
   * sentido inverso.
   */
  it("com parte precificada, o valor manda sobre a frase", () => {
    const { impacto, numeros } = numerosDoRecorte([
      seguroQueMudou("CALCULATED"),
      linhaDeSeguroDaAlteracao(
        alteracao({
          id: 3,
          attributeCode: "carreta.tacografo",
          entityLabel: "QYP0J87",
          valueBefore: "21.03",
          valueAfter: "0",
          deltaAbsolute: "-21.03",
          deltaPercent: "-100",
          impactConfidence: "PRESUMED",
        }),
      )!,
    ]);

    expect(impacto.naoCalculavel).toBe(1);
    expect(numeros.impacto.baldes).toEqual([
      { periodicidade: "MENSAL", valor: 450.62 },
    ]);
    expect(numeros.semImpacto).toBeUndefined();
  });

  /**
   * O contrato que as outras rubricas dependem: sem nada por precificar, a
   * função devolve exatamente o que `baldesDoImpacto` devolvia — nem um campo a
   * mais. É o que garante que FINAME, IPVA e as demais, que não passam por
   * aqui, continuem com a resposta que sempre tiveram.
   */
  it("não inventa campo em recorte que precifica normalmente", () => {
    const numeros = impactoPublicavel(
      { MENSAL: 7238.85, ANUAL: -1200 },
      { naoPublicadas: 0, semImpacto: "não deveria aparecer" },
    );

    expect(numeros).toEqual({
      impacto: {
        baldes: [
          { periodicidade: "MENSAL", valor: 7238.85 },
          { periodicidade: "ANUAL", valor: -1200 },
        ],
      },
    });
    expect(Object.keys(numeros)).toEqual(["impacto"]);
  });
});
