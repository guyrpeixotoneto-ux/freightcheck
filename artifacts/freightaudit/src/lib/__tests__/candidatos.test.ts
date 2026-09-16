import { describe, expect, it } from "vitest";
import { numerosDaLinha } from "../candidatos";

/**
 * O que o menu escreve ao lado de cada vigência.
 *
 * A regressão que este bloco guarda é uma frase: **ausência não é zero**. Um
 * par que o servidor ainda não calculou não tem número, e escrever "0
 * alterações" ali seria responder com um número uma pergunta que não foi feita
 * — numa tela de auditoria, a pior forma de errar.
 *
 * A recíproca é a outra metade, e é o que mudou em 16/09/2026: **zero não é
 * ausência**. Calculado o par, a linha escreve o dinheiro e a contagem sempre,
 * mesmo quando os dois dão zero. A coluna em branco ficou sendo uma coisa só —
 * "ainda não calculei" — em vez de duas.
 */
describe("os números de cada linha do menu", () => {
  /** Uma rubrica: natureza nula em todo balde, e a linha sai sem prefixo. */
  const comImpacto = (
    alteracoes: number,
    porPeriodicidade: Record<string, number>,
  ) => ({
    alteracoes,
    impacto: {
      baldes: Object.entries(porPeriodicidade).map(([periodicidade, valor]) => ({
        periodicidade,
        natureza: null,
        valor,
      })),
    },
  });

  it("não escreve número nenhum para quem ainda não foi calculado", () => {
    expect(numerosDaLinha(null)).toBeNull();
  });

  /* O outro lado da mesma moeda: nada mudou **é** resposta, e vem zerada. */
  it("escreve os zeros quando o cálculo aconteceu e deu zero", () => {
    const linha = numerosDaLinha(comImpacto(0, {}));

    expect(linha?.alteracoes).toBe("0 alterações");
    /*
      Sem balde nenhum no impacto, o zero sai sem periodicidade: `R$ 0,00/mês`
      afirmaria que o que não mudou era mensal, e não há balde que sustente a
      frase. `bruto` em zero é o que faz o seletor pintar a linha de neutro —
      nem ganho, nem perda.
    */
    expect(linha?.valores).toEqual([
      { texto: "R$ 0,00", bruto: 0, leitura: "NEUTRO" },
    ]);
  });

  /*
    A palavra no lugar do sinal: negativo é perda, positivo é ganho, e o valor
    vem em módulo. "Perda −R$ 302.261,18" diria a mesma coisa duas vezes, e o
    `−` sobraria parecendo sinal de outra conta.
  */
  it("escreve o dinheiro com a periodicidade, e a leitura certa", () => {
    const linha = numerosDaLinha(comImpacto(457, { MENSAL: -302261.18 }));

    expect(linha?.alteracoes).toBe("457 alterações");
    expect(linha?.valores).toHaveLength(1);
    expect(linha?.valores[0].texto).toBe("Perda R$ 302.261,18/mês");
    expect(linha?.valores[0].leitura).toBe("PERDA");
    expect(linha?.valores[0].bruto).toBeLessThan(0);
  });

  it("positivo é ganho, e é a mesma régua", () => {
    const linha = numerosDaLinha(comImpacto(7, { MENSAL: 7238.85 }));

    expect(linha?.valores[0].texto).toBe("Ganho R$ 7.238,85/mês");
    expect(linha?.valores[0].leitura).toBe("GANHO");
  });

  it("uma alteração no singular", () => {
    expect(numerosDaLinha(comImpacto(1, {}))?.alteracoes).toBe("1 alteração");
  });

  /*
    Duas periodicidades viram duas linhas, e nunca uma soma: a parcela é mensal
    e a base de compra é do ato da compra. Somá-las aqui publicaria um total que
    `impactoPorPeriodicidade` se recusa a calcular.
  */
  it("não soma periodicidades diferentes num número só", () => {
    const linha = numerosDaLinha(
      comImpacto(12, { MENSAL: -1000, PONTUAL: -50000 }),
    );

    expect(linha?.valores).toHaveLength(2);
    expect(linha?.valores.map((v) => v.bruto)).toEqual([-1000, -50000]);
  });

  /*
    Três alterações que não moveram dinheiro: a linha diz as duas coisas.

    O balde `MENSAL: 0` continua não virando `R$ 0,00/mês` — a periodicidade
    seria uma afirmação sobre um movimento que não houve. O que sobra é o zero
    seco, que é a notícia: mudou coisa, e não custou nada.
  */
  it("escreve R$ 0,00 quando nenhum balde tem impacto", () => {
    const linha = numerosDaLinha(comImpacto(3, { MENSAL: 0 }));

    expect(linha?.valores).toEqual([
      { texto: "R$ 0,00", bruto: 0, leitura: "NEUTRO" },
    ]);
    expect(linha?.alteracoes).toBe("3 alterações");
  });

  /* Com algum balde valorado, o zero dos outros continua fora da linha. */
  it("o balde zerado não rouba a linha de quem tem notícia", () => {
    const linha = numerosDaLinha(comImpacto(9, { ANUAL: 0, MENSAL: 1200 }));

    expect(linha?.valores.map((v) => v.bruto)).toEqual([1200]);
  });

  /*
    O Monitor Custo Fixo lê os quatro módulos, e com eles vêm as duas naturezas
    — três de custo e um de receita. É o único recorte em que uma periodicidade
    produz duas linhas, e elas **precisam** dizer de qual lado falam: sem o
    prefixo, `+R$ 1.200,00/mês` em cima de `+R$ 900,00/mês` é um convite a somar
    custo com receita, que é o escalar que os cartões daquela tela recusam
    publicar.
  */
  describe("quando o recorte mistura custo e receita", () => {
    const doMonitor = (
      alteracoes: number,
      baldes: { periodicidade: string; natureza: "CUSTO" | "RECEITA"; valor: number }[],
    ) => ({ alteracoes, impacto: { baldes } });

    it("escreve a natureza antes do dinheiro, e não soma os dois lados", () => {
      const linha = numerosDaLinha(
        doMonitor(31, [
          { periodicidade: "MENSAL", natureza: "CUSTO", valor: 1200 },
          { periodicidade: "MENSAL", natureza: "RECEITA", valor: -900 },
        ]),
      );

      expect(linha?.valores).toHaveLength(2);
      /* As duas se leem pela mesma régua — o sinal do líquido —, e o custo e a
         receita continuam em linhas separadas, cada uma com a sua. */
      expect(linha?.valores[0].texto).toBe("Ganho R$ 1.200,00/mês");
      expect(linha?.valores[1].texto).toBe("Perda R$ 900,00/mês");
      /* 1200 e −900 continuam dois números. Nenhum 300 em lugar nenhum. */
      expect(linha?.valores.map((v) => v.bruto)).toEqual([1200, -900]);
    });

    /* Um lado zerado é o lado que não se moveu, e ele não ocupa linha. */
    it("o lado que não se moveu não vira linha", () => {
      const linha = numerosDaLinha(
        doMonitor(4, [
          { periodicidade: "MENSAL", natureza: "CUSTO", valor: 1200 },
          { periodicidade: "MENSAL", natureza: "RECEITA", valor: 0 },
        ]),
      );

      expect(linha?.valores.map((v) => v.texto)).toEqual(["Ganho R$ 1.200,00/mês"]);
    });

    /*
      Nenhum dos dois lados se moveu: volta o zero seco, sem natureza e sem
      periodicidade. Escrever "Custo R$ 0,00" escolheria um dos dois lados para
      responder por um recorte em que nenhum dos dois tem o que dizer.
    */
    it("os dois lados zerados voltam ao zero seco", () => {
      const linha = numerosDaLinha(
        doMonitor(3, [
          { periodicidade: "MENSAL", natureza: "CUSTO", valor: 0 },
          { periodicidade: "MENSAL", natureza: "RECEITA", valor: 0 },
        ]),
      );

      expect(linha?.valores).toEqual([
        { texto: "R$ 0,00", bruto: 0, leitura: "NEUTRO" },
      ]);
      expect(linha?.alteracoes).toBe("3 alterações");
    });
  });
});
