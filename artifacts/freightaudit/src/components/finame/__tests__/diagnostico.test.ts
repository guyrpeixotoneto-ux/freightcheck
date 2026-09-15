import { describe, expect, it } from "vitest";
import type { LinhaDeFiname } from "@workspace/comparison/finame";
import { diagnosticoDoVeiculo } from "../detalhe";

/**
 * O diagnóstico é a única frase desta tela escrita em português corrido, e por
 * isso a única que pode sair **contradizendo o número ao lado dela**. Foi o que
 * a primeira renderização sobre dado real mostrou: "a parcela desceu +R$
 * 5.169,50", com o sinal de alta dentro de uma frase de queda.
 *
 * Estes casos prendem as duas regras que essa contradição ensinou: a direção
 * mora na palavra, e o sinal não se repete atrás dela; e uma frase que já
 * termina em ponto não ganha outro.
 */

const linha = (over: Partial<LinhaDeFiname> = {}): LinhaDeFiname => ({
  id: 1,
  entityLabel: "QYP3G72",
  entityType: "CAVALO",
  variavel: "parcela",
  rotuloDaVariavel: "Parcela FINAME",
  medida: "DINHEIRO",
  attributeCode: "cavalo.finame_cavalo",
  base: "9847.35",
  comparada: "4677.85",
  diferenca: -5169.5,
  variacao: -52.49,
  estado: "ALTERADO",
  motivo: null,
  periodoFiname: "60",
  dataDeCadastro: "2019-05-10",
  fimDoContrato: "2024-05-10",
  impactoAmount: -5169.5,
  impactoPeriodicidade: "MENSAL",
  impactoCalculado: true,
  ...over,
});

describe("o diagnóstico do veículo", () => {
  it("não repete o sinal que a palavra já diz", () => {
    const [frase] = diagnosticoDoVeiculo([linha()]);
    expect(frase).toContain("desceu");
    expect(frase).not.toContain("desceu +");
    expect(frase).toContain("R$ 5.169,50");
  });

  it("diz 'subiu' quando subiu, e atribui a parte dos juros", () => {
    const [frase] = diagnosticoDoVeiculo([
      linha({ diferenca: 310, variacao: 3.67, base: "8450", comparada: "8760" }),
      linha({ variavel: "juros", rotuloDaVariavel: "Juros FINAME", diferenca: 121.4 }),
    ]);
    expect(frase).toContain("subiu");
    expect(frase).toContain("os juros respondem por R$ 121,40");
  });

  it("não fecha com dois pontos a frase da recusa que já termina em ponto", () => {
    const frases = diagnosticoDoVeiculo([
      linha({
        variavel: "data_fim_contrato",
        rotuloDaVariavel: "Fim do contrato",
        estado: "CONFLITO",
        diferenca: null,
        variacao: null,
        motivo: "A fonte entrega esta coluna com mais de um tipo no mesmo import.",
      }),
    ]);
    expect(frases.some((f) => f.endsWith(".."))).toBe(false);
    expect(frases[0]).toBe(
      "Fim do contrato: A fonte entrega esta coluna com mais de um tipo no mesmo import.",
    );
  });

  it("diz que nada mudou quando nada mudou", () => {
    expect(diagnosticoDoVeiculo([])).toEqual([
      "Nenhuma variável de FINAME se moveu neste veículo entre as duas vigências.",
    ]);
  });
});
