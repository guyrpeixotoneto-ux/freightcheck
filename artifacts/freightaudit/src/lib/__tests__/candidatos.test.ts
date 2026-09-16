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
  const comImpacto = (
    alteracoes: number,
    porPeriodicidade: Record<string, number>,
  ) => ({
    alteracoes,
    impacto: { porPeriodicidade, naoCalculavel: 0, cobertasPorParcelas: 0, foraDaSoma: 0 },
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
    expect(linha?.valores).toEqual([{ texto: "R$ 0,00", bruto: 0 }]);
  });

  it("escreve o dinheiro com a periodicidade, e o sinal certo", () => {
    const linha = numerosDaLinha(comImpacto(457, { MENSAL: -302261.18 }));

    expect(linha?.alteracoes).toBe("457 alterações");
    expect(linha?.valores).toHaveLength(1);
    expect(linha?.valores[0].texto).toMatch(/^−R\$/);
    expect(linha?.valores[0].texto).toMatch(/\/mês$/);
    expect(linha?.valores[0].bruto).toBeLessThan(0);
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

    expect(linha?.valores).toEqual([{ texto: "R$ 0,00", bruto: 0 }]);
    expect(linha?.alteracoes).toBe("3 alterações");
  });

  /* Com algum balde valorado, o zero dos outros continua fora da linha. */
  it("o balde zerado não rouba a linha de quem tem notícia", () => {
    const linha = numerosDaLinha(comImpacto(9, { ANUAL: 0, MENSAL: 1200 }));

    expect(linha?.valores.map((v) => v.bruto)).toEqual([1200]);
  });
});
