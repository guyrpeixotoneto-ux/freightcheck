import { describe, expect, it } from "vitest";
import type { LinhaDeImpostos } from "@workspace/comparison/impostos";
import { aliquotaDaPonta, diagnosticoDoVeiculo } from "../detalhe";

/**
 * O diagnóstico é a única frase desta tela escrita em português corrido, e por
 * isso a única que pode sair **contradizendo o número ao lado dela**. A tela de
 * FINAME já mostrou como: "a parcela desceu +R$ 5.169,50", com o sinal de alta
 * dentro de uma frase de queda.
 *
 * Estes casos prendem essa regra e as duas que são próprias dos impostos:
 *
 * 1. **Alíquota declarada sem montante não é imposto zero.** É o estado do ICMS
 *    no acervo inteiro, e a frase tem de dizer "coluna sem dado" — dizer "0% de
 *    imposto" afirmaria uma isenção que ninguém declarou.
 * 2. **Uma taxa que se move sozinha é o achado.** Quando a alíquota declarada
 *    muda e o montante não muda, a frase precisa nomear as duas hipóteses: ou a
 *    taxa não foi aplicada, ou o montante ficou para trás.
 */

const montante = (over: Partial<LinhaDeImpostos> = {}): LinhaDeImpostos => ({
  id: 1,
  entityLabel: "QYQ6A80",
  entityType: "CAVALO",
  variavel: "pis_cofins",
  rotuloDaVariavel: "PIS/COFINS da compra",
  medida: "DINHEIRO",
  tributo: "PIS_COFINS",
  papel: "MONTANTE",
  attributeCode: "cavalo.valor_pis_cofins",
  base: "37890.84",
  comparada: "41625.00",
  diferenca: 3734.16,
  variacao: 9.854,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: 3734.16,
  impactoPeriodicidade: "PONTUAL",
  impactoCalculado: true,
  foraDaSoma: null,
  ...over,
});

const nota = (over: Partial<LinhaDeImpostos> = {}): LinhaDeImpostos =>
  montante({
    variavel: "valor_nf",
    rotuloDaVariavel: "Valor de NF",
    tributo: null,
    papel: "BASE",
    attributeCode: "cavalo.valor_nf_compra",
    base: "409630.16",
    comparada: "450000.00",
    diferenca: 40369.84,
    variacao: 9.854,
    estado: "ALTERADO",
    impactoAmount: null,
    impactoCalculado: false,
    ...over,
  });

/** A mesma nota nas duas pontas — o caso em que só o imposto se move. */
const notaParada = (): LinhaDeImpostos =>
  nota({
    comparada: "409630.16",
    diferenca: null,
    variacao: null,
    estado: "SEM_ALTERACAO",
  });

const declarada = (over: Partial<LinhaDeImpostos> = {}): LinhaDeImpostos =>
  montante({
    variavel: "percentual_icms",
    rotuloDaVariavel: "ICMS declarado",
    medida: "PERCENTUAL",
    tributo: "ICMS",
    papel: "ALIQUOTA",
    attributeCode: "cavalo.percentual_icms",
    base: "12",
    comparada: "12",
    diferenca: null,
    variacao: null,
    estado: "SEM_ALTERACAO",
    impactoAmount: null,
    impactoCalculado: false,
    ...over,
  });

describe("a alíquota de uma ponta", () => {
  it("é o montante sobre a nota, em pontos percentuais", () => {
    expect(aliquotaDaPonta(37_890.79, 409_630.16)).toBeCloseTo(9.25, 3);
  });

  it("não vira 0% quando falta a nota — nem quando ela é zero", () => {
    expect(aliquotaDaPonta(37_890.79, null)).toBeNull();
    expect(aliquotaDaPonta(37_890.79, 0)).toBeNull();
  });

  it("não vira 0% quando o montante é zero, que aqui é ausência", () => {
    expect(aliquotaDaPonta(0, 409_630.16)).toBeNull();
  });
});

describe("o diagnóstico do veículo", () => {
  it("não escreve o sinal de alta dentro de uma frase de queda", () => {
    const [frase] = diagnosticoDoVeiculo([
      montante({
        base: "41625.00",
        comparada: "37890.84",
        diferenca: -3734.16,
        variacao: -8.97,
      }),
    ]);
    expect(frase).toContain("desceu");
    expect(frase).not.toContain("+");
    expect(frase).not.toContain("−R$");
  });

  it("cola a alíquota medida na frase do montante que se moveu", () => {
    const frases = diagnosticoDoVeiculo([
      montante({ base: "37890.79", comparada: "41625.00" }),
      nota(),
    ]);
    const doMontante = frases.find((f) => f.includes("PIS/COFINS subiu"))!;
    expect(doMontante).toContain("9,250%");
    expect(doMontante).toContain("do valor de nota");
  });

  it("chama de coluna sem dado a alíquota declarada sem montante", () => {
    const frases = diagnosticoDoVeiculo([
      declarada(),
      montante({
        variavel: "icms",
        rotuloDaVariavel: "ICMS da compra",
        tributo: "ICMS",
        attributeCode: "cavalo.valor_icms",
        base: "0",
        comparada: "0",
        diferenca: null,
        variacao: null,
        estado: "SEM_ALTERACAO",
        foraDaSoma: "Zero nas 1.215 linhas do acervo.",
      }),
      notaParada(),
    ]);
    const doIcms = frases.find((f) => f.startsWith("ICMS:"))!;
    expect(doIcms).toContain("12,000%");
    expect(doIcms).toContain("coluna sem dado");
    expect(frases.some((f) => f.includes("0,000% da nota"))).toBe(false);
  });

  it("diz que confere quando a declarada e a medida caem no mesmo número", () => {
    const frases = diagnosticoDoVeiculo([
      montante({
        base: "37890.79",
        comparada: "37890.79",
        diferenca: null,
        variacao: null,
        estado: "SEM_ALTERACAO",
      }),
      declarada({
        variavel: "percentual_pis_cofins",
        rotuloDaVariavel: "PIS/COFINS declarado",
        tributo: "PIS_COFINS",
        attributeCode: "carreta.pis_cofins",
        base: "9.3",
        comparada: "9.3",
      }),
      notaParada(),
    ]);
    const conferencia = frases.find((f) => f.startsWith("PIS/COFINS:"))!;
    expect(conferencia).toContain("confere");
    expect(conferencia).toContain("9,250%");
  });

  it("acusa a distância quando a declarada não é a que o dinheiro revela", () => {
    const frases = diagnosticoDoVeiculo([
      montante({
        base: "37890.79",
        comparada: "37890.79",
        diferenca: null,
        variacao: null,
        estado: "SEM_ALTERACAO",
      }),
      declarada({
        variavel: "percentual_pis_cofins",
        rotuloDaVariavel: "PIS/COFINS declarado",
        tributo: "PIS_COFINS",
        attributeCode: "carreta.pis_cofins",
        base: "0",
        comparada: "0",
      }),
      notaParada(),
    ]);
    const conferencia = frases.find((f) => f.startsWith("PIS/COFINS:"))!;
    expect(conferencia).toContain("distância de 9,250%");
  });

  it("nomeia as duas hipóteses quando a taxa muda e o dinheiro não", () => {
    const frases = diagnosticoDoVeiculo([
      declarada({
        base: "12",
        comparada: "7",
        diferenca: -5,
        variacao: -41.67,
        estado: "ALTERADO",
      }),
    ]);
    const frase = frases.find((f) => f.includes("alíquota declarada de ICMS"))!;
    expect(frase).toContain("sem que o montante em reais mudasse");
    expect(frase).toContain("ficou para trás");
  });

  it("conta a nota que se moveu sozinha, que muda a alíquota sem mudar o tributo", () => {
    const frases = diagnosticoDoVeiculo([
      montante({ diferenca: null, variacao: null, estado: "SEM_ALTERACAO" }),
      nota(),
    ]);
    expect(frases.some((f) => f.includes("O valor de nota subiu"))).toBe(true);
  });

  it("diz que nada se moveu quando nada se moveu, em vez de calar", () => {
    expect(diagnosticoDoVeiculo([])).toEqual([
      "Nenhuma variável de imposto se moveu neste veículo, e o acervo não trouxe " +
        "alíquota nem montante com que conferir.",
    ]);
  });

  it("repete o motivo do motor nas linhas que ele recusou comparar", () => {
    const frases = diagnosticoDoVeiculo([
      montante({
        estado: "CONFLITO",
        motivo: "Semântica mudou entre as vigências",
        diferenca: null,
        variacao: null,
      }),
    ]);
    expect(frases.some((f) => f.includes("Semântica mudou entre as vigências"))).toBe(true);
  });
});
