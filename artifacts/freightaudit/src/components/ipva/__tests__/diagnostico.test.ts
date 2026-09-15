import { describe, expect, it } from "vitest";
import type { LinhaDeIpva } from "@workspace/comparison/ipva";
import { aliquotaDaPonta, diagnosticoDoVeiculo } from "../detalhe";

/**
 * O diagnóstico é a única frase desta tela escrita em português corrido, e por
 * isso a única que pode sair **contradizendo o número ao lado dela**. A tela de
 * FINAME já mostrou como: "a parcela desceu +R$ 5.169,50", com o sinal de alta
 * dentro de uma frase de queda.
 *
 * Estes casos prendem essa regra e a que é própria do IPVA: a frase do tributo
 * vem com a alíquota colada quando a nota está nas duas pontas, porque "o IPVA
 * caiu R$ 1.570,00" não distingue um veículo mais barato de uma troca de
 * fórmula, e "de 1,000% para 0,651% da nota" distingue.
 */

const linha = (over: Partial<LinhaDeIpva> = {}): LinhaDeIpva => ({
  id: 1,
  entityLabel: "QYQ6A80",
  entityType: "CAVALO",
  variavel: "ipva",
  rotuloDaVariavel: "IPVA / Licenciamento",
  medida: "DINHEIRO",
  attributeCode: "cavalo.ipva_licenciamento",
  base: "4500",
  comparada: "2930",
  diferenca: -1570,
  variacao: -34.89,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: -1570,
  impactoPeriodicidade: "ANUAL",
  impactoCalculado: true,
  foraDaSoma: null,
  ...over,
});

const nota = (over: Partial<LinhaDeIpva> = {}): LinhaDeIpva =>
  linha({
    variavel: "valor_nf",
    rotuloDaVariavel: "Valor de NF",
    attributeCode: "cavalo.valor_nf_compra",
    base: "450000",
    comparada: "450000",
    diferenca: null,
    variacao: null,
    estado: "SEM_ALTERACAO",
    impactoAmount: null,
    impactoCalculado: false,
    ...over,
  });

describe("a alíquota de uma ponta", () => {
  it("é o tributo sobre a nota, em pontos percentuais", () => {
    expect(aliquotaDaPonta(4500, 450000)).toBe(1);
  });

  it("não vira 0% quando falta a nota — nem quando ela é zero", () => {
    expect(aliquotaDaPonta(4500, null)).toBeNull();
    expect(aliquotaDaPonta(4500, 0)).toBeNull();
    expect(aliquotaDaPonta(null, 450000)).toBeNull();
  });
});

describe("o diagnóstico do veículo", () => {
  it("não repete o sinal que a palavra já diz", () => {
    const [frase] = diagnosticoDoVeiculo([linha()]);
    expect(frase).toContain("desceu");
    expect(frase).not.toContain("desceu +");
    expect(frase).not.toContain("desceu −");
  });

  it("cola a alíquota na frase do tributo quando a nota está nas duas pontas", () => {
    const [frase] = diagnosticoDoVeiculo([linha(), nota()]);
    // 4.500/450.000 = 1,000% → 2.930/450.000 = 0,651%
    expect(frase).toContain("1,000%");
    expect(frase).toContain("0,651%");
    expect(frase).toContain("valor de nota");
  });

  it("não inventa alíquota quando a nota não veio", () => {
    const [frase] = diagnosticoDoVeiculo([linha()]);
    expect(frase).not.toContain("valor de nota");
    expect(frase).not.toContain("NaN");
  });

  it("conta a nota que se move sozinha, que em reais pareceria 'nada mudou'", () => {
    const frases = diagnosticoDoVeiculo([
      linha({ diferenca: null, variacao: null, estado: "SEM_ALTERACAO", comparada: "4500" }),
      nota({ comparada: "900000", diferenca: 450000, variacao: 100, estado: "ALTERADO" }),
    ]);
    expect(frases[0]).toContain("sem que o IPVA em reais mudasse");
    expect(frases[0]).toContain("1,000%");
    expect(frases[0]).toContain("0,500%");
  });

  it("chama o valor negativo pelo nome", () => {
    const frases = diagnosticoDoVeiculo([
      linha({ entityType: "CARRETA", base: "150", comparada: "-1709.86", diferenca: -1859.86 }),
    ]);
    expect(frases.some((f) => f.includes("negativo"))).toBe(true);
  });

  it("avisa que a coluna que mudou não entra em soma nenhuma", () => {
    const frases = diagnosticoDoVeiculo([
      linha({
        variavel: "ipva_mensal",
        rotuloDaVariavel: "IPVA / Licenciamento (coluna “mensal”)",
        entityType: "CARRETA",
        base: "435",
        comparada: "733",
        diferenca: 298,
        foraDaSoma: "Não é 1/12 da coluna anual.",
      }),
    ]);
    expect(frases.some((f) => f.includes("não entra em soma nenhuma"))).toBe(true);
  });

  it("não termina uma frase que já tem ponto com outro ponto", () => {
    const frases = diagnosticoDoVeiculo([
      linha({ estado: "CONFLITO", motivo: "A coluna veio com dois tipos no mesmo import." }),
    ]);
    expect(frases.some((f) => f.endsWith(".."))).toBe(false);
  });

  it("diz que nada se moveu, em vez de devolver uma lista vazia", () => {
    const frases = diagnosticoDoVeiculo([
      linha({ diferenca: null, variacao: null, estado: "SEM_ALTERACAO", comparada: "4500" }),
    ]);
    expect(frases).toHaveLength(1);
    expect(frases[0]).toContain("Nenhuma variável de IPVA se moveu");
  });
});
