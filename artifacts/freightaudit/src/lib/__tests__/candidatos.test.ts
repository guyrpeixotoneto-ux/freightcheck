import { describe, expect, it } from "vitest";
import { numerosDaLinha } from "../candidatos";

/**
 * O que o menu escreve ao lado de cada vigência.
 *
 * A regressão que este bloco guarda é uma frase: **ausência não é zero**. Um
 * par que o servidor ainda não calculou não tem número, e escrever "0
 * alterações" ali seria responder com um número uma pergunta que não foi feita
 * — numa tela de auditoria, a pior forma de errar.
 */
describe("os números de cada linha do menu", () => {
  const comImpacto = (
    alteracoes: number,
    porPeriodicidade: Record<string, number>,
  ) => ({
    alteracoes,
    impacto: { porPeriodicidade, naoCalculavel: 0, cobertasPorParcelas: 0 },
  });

  it("não escreve número nenhum para quem ainda não foi calculado", () => {
    expect(numerosDaLinha(null)).toBeNull();
  });

  /* O outro lado da mesma moeda: nada mudou **é** resposta, e tem texto. */
  it("diz 'nenhuma alteração' quando o cálculo aconteceu e deu zero", () => {
    const linha = numerosDaLinha(comImpacto(0, {}));

    expect(linha?.alteracoes).toBe("nenhuma alteração");
    expect(linha?.valores).toEqual([]);
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

  /* Um balde zerado não vira linha "R$ 0" — ele simplesmente não tem notícia. */
  it("não escreve R$ 0 para um balde sem impacto", () => {
    const linha = numerosDaLinha(comImpacto(3, { MENSAL: 0 }));

    expect(linha?.valores).toEqual([]);
    expect(linha?.alteracoes).toBe("3 alterações");
  });
});
