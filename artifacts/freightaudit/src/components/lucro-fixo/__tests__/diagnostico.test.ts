import { describe, expect, it } from "vitest";
import type { LinhaDeLucroFixo } from "@workspace/comparison/lucro-fixo";
import { diagnosticoDoVeiculo } from "../detalhe";
import { corDaDiferenca, escreverDiferenca, escreverValor } from "@/lib/lucro-fixo";

/**
 * O que estes casos prendem.
 *
 * Duas coisas, e a segunda é a que esta tela introduz no produto.
 *
 * A primeira é a de sempre: o diagnóstico é a única frase escrita em português
 * corrido, e por isso a única que pode sair contradizendo o número ao lado —
 * "desceu +R$ 5.169,50" foi o que a tela de FINAME mostrou na primeira
 * renderização sobre dado real.
 *
 * A segunda é **a cor**. As três auditorias de rubrica olham para remuneração,
 * e a régua é uma só: subir é verde, cair é vermelho. Inclusive a amortização,
 * que divide a tabela com o lucro fixo — ela cair é rubrica deixando de ser
 * paga, e pintar isso de verde chamaria de economia a pior notícia do mês.
 */

const linha = (over: Partial<LinhaDeLucroFixo> = {}): LinhaDeLucroFixo => ({
  id: 1,
  entityLabel: "RZM0B31",
  entityType: "CAVALO",
  variavel: "lucro_fixo",
  rotuloDaVariavel: "Lucro fixo",
  medida: "DINHEIRO",
  attributeCode: "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
  base: "0",
  comparada: "3318.01",
  diferenca: 3318.01,
  variacao: null,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: 3318.01,
  impactoPeriodicidade: "MENSAL",
  impactoCalculado: true,
  foraDaSoma: null,
  ...over,
});

const ciclo = (de: string, para: string, over: Partial<LinhaDeLucroFixo> = {}) =>
  linha({
    variavel: "ciclo",
    rotuloDaVariavel: "Ciclo",
    medida: "CICLO",
    attributeCode: "cavalo.ciclo",
    base: de,
    comparada: para,
    diferenca: Number(para) - Number(de),
    impactoAmount: null,
    impactoCalculado: false,
    ...over,
  });

const amortizacao = (over: Partial<LinhaDeLucroFixo> = {}) =>
  linha({
    variavel: "amortizacao",
    rotuloDaVariavel: "Amortização",
    attributeCode: "cavalo.amortizacao_cavalo",
    base: "3100",
    comparada: "0",
    diferenca: -3100,
    impactoAmount: -3100,
    ...over,
  });

describe("a cor: negativo é piora, em toda linha de dinheiro", () => {
  it("pinta de verde o lucro fixo que subiu — é receita", () => {
    expect(corDaDiferenca(3318.01, "DINHEIRO")).toBe("text-success");
  });

  it("pinta de vermelho o lucro fixo que caiu", () => {
    expect(corDaDiferenca(-3318.01, "DINHEIRO")).toBe("text-destructive");
  });

  /*
    A linha vizinha, na mesma tabela. Ela já saiu em verde ao cair, quando esta
    função tratava a amortização como custo: a rubrica é remunerada na tabela de
    frete, e cair é perder dinheiro, não deixar de gastá-lo.
  */
  it("pinta de vermelho a amortização que caiu — também é remuneração", () => {
    expect(corDaDiferenca(-3100, "DINHEIRO")).toBe("text-destructive");
  });

  it("pinta de verde a amortização que subiu", () => {
    expect(corDaDiferenca(3100, "DINHEIRO")).toBe("text-success");
  });

  it("não pinta o que não tem lado bom", () => {
    expect(corDaDiferenca(1, "CICLO")).toBe("");
    expect(corDaDiferenca(1, "ANO")).toBe("");
    expect(corDaDiferenca(0, "DINHEIRO")).toBe("");
    expect(corDaDiferenca(null, "DINHEIRO")).toBe("");
  });
});

describe("o ciclo escrito", () => {
  it("diz 'Ciclo 2', e não '2' — o número sozinho não diz o que é", () => {
    expect(escreverValor("2", "CICLO")).toBe("Ciclo 2");
  });

  it("não escreve diferença de ciclo como número: '+1 ciclo' ninguém diz", () => {
    expect(escreverDiferenca(1, "CICLO")).toBe("—");
  });

  it("branco continua travessão, e não 'Ciclo 0'", () => {
    expect(escreverValor("", "CICLO")).toBe("—");
    expect(escreverValor(null, "CICLO")).toBe("—");
  });
});

describe("o diagnóstico do veículo", () => {
  it("conta a virada como uma notícia só, com o dinheiro dos dois lados", () => {
    const [frase] = diagnosticoDoVeiculo([ciclo("1", "2"), linha(), amortizacao()]);
    expect(frase).toContain("Terminou de amortizar");
    expect(frase).toContain("R$ 3.100,00");
    expect(frase).toContain("R$ 3.318,01");
  });

  it("não repete o sinal que a palavra já diz", () => {
    const [frase] = diagnosticoDoVeiculo([ciclo("1", "2"), linha(), amortizacao()]);
    expect(frase).not.toContain("saíram −");
    expect(frase).not.toContain("entraram +");
  });

  it("nomeia o sentido que o modelo não prevê, sem afirmar a causa", () => {
    const [frase] = diagnosticoDoVeiculo([ciclo("2", "1")]);
    expect(frase).toContain("não desamortiza");
    expect(frase).toContain("ou houve");
  });

  it("sem virada, o lucro fixo que se move é a notícia — e diz que o ciclo não mudou", () => {
    const [frase] = diagnosticoDoVeiculo([linha({ base: "3000", diferenca: 318.01 })]);
    expect(frase).toContain("subiu");
    expect(frase).toContain("sem troca de ciclo");
  });

  it("acusa a coexistência no próprio ativo", () => {
    const frases = diagnosticoDoVeiculo([
      linha({ comparada: "3318.01" }),
      amortizacao({ comparada: "3100", diferenca: 0 }),
    ]);
    expect(frases.some((f) => f.includes("ao mesmo tempo"))).toBe(true);
  });

  it("não acusa coexistência quando um dos dois é zero — que é o caso normal", () => {
    const frases = diagnosticoDoVeiculo([linha(), amortizacao()]);
    expect(frases.some((f) => f.includes("ao mesmo tempo"))).toBe(false);
  });

  it("avisa que a coluna do conjunto não entra em soma nenhuma", () => {
    const frases = diagnosticoDoVeiculo([
      linha({
        variavel: "lucro_fixo_conjunto",
        rotuloDaVariavel: "Lucro fixo do conjunto (cavalo + carreta)",
        entityType: "CARRETA",
        foraDaSoma: "Medido: a coluna é a soma das duas parcelas.",
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

  it("um ciclo em branco não vira virada inventada", () => {
    const frases = diagnosticoDoVeiculo([ciclo("1", "")]);
    expect(frases).toHaveLength(1);
    expect(frases[0]).toContain("Nenhuma variável de lucro fixo se moveu");
  });

  it("diz que nada se moveu, em vez de devolver uma lista vazia", () => {
    const frases = diagnosticoDoVeiculo([
      linha({ diferenca: null, estado: "SEM_ALTERACAO", base: "3318.01" }),
    ]);
    expect(frases).toHaveLength(1);
    expect(frases[0]).toContain("Nenhuma variável de lucro fixo se moveu");
  });
});
