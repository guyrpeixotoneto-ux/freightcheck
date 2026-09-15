import { describe, expect, it } from "vitest";
import type { LinhaDeKm } from "@workspace/comparison/km-rodado";
import { diagnosticoDoTrecho, valorDaPonta } from "../detalhe";

/**
 * O diagnóstico é a única frase desta tela escrita em português corrido, e por
 * isso a única que pode sair **contradizendo o número ao lado dela**. A tela de
 * FINAME já mostrou como: "a parcela desceu +R$ 5.169,50", com o sinal de alta
 * dentro de uma frase de queda.
 *
 * Estes casos prendem essa regra e as duas que são próprias do km rodado:
 *
 * 1. **O preço do quilômetro é a soma das parcelas que se moveram**, e a frase
 *    tem de nomear a maior delas — sem isso ela é um número a mais, e não uma
 *    pergunta ao fornecedor.
 * 2. **A conferência do km sai da mesma função do núcleo** que a régua da
 *    vigência usa, montada a partir das linhas da gaveta. Uma segunda cópia da
 *    regra faria a frase contradizer o veredito da tabela logo acima dela.
 */

const razao = (over: Partial<LinhaDeKm> = {}): LinhaDeKm => ({
  id: 1,
  entityLabel: "CAMACARIFEIRADESANTANA",
  entityType: "TRECHO",
  variavel: "reais_km_diesel",
  rotuloDaVariavel: "R$/km · Diesel",
  medida: "REAIS_POR_KM",
  papel: "RAZAO",
  componente: "diesel",
  attributeCode: "trecho.frete_reais_km_diesel",
  base: "1.8400",
  comparada: "1.9100",
  diferenca: 0.07,
  variacao: 3.804348,
  estado: "ALTERADO",
  motivo: null,
  impactoAmount: null,
  impactoPeriodicidade: null,
  impactoCalculado: false,
  foraDaSoma: null,
  ...over,
});

const distancia = (over: Partial<LinhaDeKm> = {}): LinhaDeKm =>
  razao({
    variavel: "km_ciclo",
    rotuloDaVariavel: "Km do ciclo",
    medida: "DISTANCIA",
    papel: "DISTANCIA",
    componente: null,
    attributeCode: "trecho.km_rodado",
    base: "412",
    comparada: "412",
    diferenca: null,
    variacao: null,
    estado: "SEM_ALTERACAO",
    ...over,
  });

/** O trecho inteiro, coerente: 206 + 206 = 412, e o preço montado sobre 412. */
function trechoCoerente(kmDoPreco = 412): LinhaDeKm[] {
  return [
    distancia(),
    distancia({
      variavel: "km_ida",
      rotuloDaVariavel: "Km de ida",
      attributeCode: "trecho.km_ida",
      base: "206",
      comparada: "206",
    }),
    distancia({
      variavel: "km_volta",
      rotuloDaVariavel: "Km de volta",
      attributeCode: "trecho.km_volta",
      base: "206",
      comparada: "206",
    }),
    razao({ estado: "SEM_ALTERACAO", base: "1.84", comparada: "1.84", diferenca: null }),
    razao({
      variavel: "reais_viagem_diesel",
      rotuloDaVariavel: "R$/viagem · Diesel",
      medida: "DINHEIRO",
      papel: "POR_VIAGEM",
      attributeCode: "trecho.frete_reais_viagem_diesel",
      base: String(1.84 * kmDoPreco),
      comparada: String(1.84 * kmDoPreco),
      diferenca: null,
      estado: "SEM_ALTERACAO",
      foraDaSoma: "É o R$/km multiplicado pelo km do ciclo.",
    }),
  ];
}

describe("as linhas viram o valor de uma ponta", () => {
  it("lê a ponta pedida, e não a outra", () => {
    const linhas = [distancia({ base: "400", comparada: "412" })];
    expect(valorDaPonta(linhas, "BASE").kmCiclo).toBe(400);
    expect(valorDaPonta(linhas, "COMPARADA").kmCiclo).toBe(412);
  });

  it("devolve nulo para a variável que a comparação não trouxe", () => {
    const valor = valorDaPonta([distancia()], "COMPARADA");
    expect(valor.kmIda).toBeNull();
    expect(valor.razoes.diesel).toBeNull();
  });
});

describe("o diagnóstico do trecho", () => {
  it("não escreve o sinal de alta dentro de uma frase de queda", () => {
    const [frase] = diagnosticoDoTrecho([
      razao({ base: "1.91", comparada: "1.84", diferenca: -0.07, variacao: -3.66 }),
    ]);
    expect(frase).toContain("desceu");
    expect(frase).not.toContain("+");
  });

  it("soma as parcelas que se moveram e nomeia a maior delas", () => {
    const frases = diagnosticoDoTrecho([
      razao(),
      razao({
        variavel: "reais_km_pneu",
        rotuloDaVariavel: "R$/km · Pneus",
        componente: "pneu",
        attributeCode: "trecho.frete_reais_km_pneu",
        base: "0.21",
        comparada: "0.23",
        diferenca: 0.02,
        variacao: 9.52,
      }),
    ]);
    expect(frases[0]).toContain("subiu");
    expect(frases[0]).toContain("2 parcelas");
    expect(frases[1]).toContain("R$/km · Diesel");
  });

  it("diz quando as parcelas se anularam, em vez de somar zero calado", () => {
    const [frase] = diagnosticoDoTrecho([
      razao({ diferenca: 0.07 }),
      razao({
        variavel: "reais_km_pneu",
        rotuloDaVariavel: "R$/km · Pneus",
        componente: "pneu",
        attributeCode: "trecho.frete_reais_km_pneu",
        diferenca: -0.07,
      }),
    ]);
    expect(frase).toContain("se anularam");
  });

  it("conta a distância que mudou como o eixo que ela é", () => {
    const frases = diagnosticoDoTrecho([
      distancia({ base: "412", comparada: "430", diferenca: 18, variacao: 4.37, estado: "ALTERADO" }),
    ]);
    expect(frases.some((f) => f.includes("O km do ciclo cresceu"))).toBe(true);
    expect(frases.some((f) => f.includes("sem que nenhuma parcela tenha mudado"))).toBe(true);
  });

  it("confirma as duas contas quando o trecho fecha", () => {
    const frases = diagnosticoDoTrecho(trechoCoerente());
    expect(frases.some((f) => f.includes("As duas contas fecham"))).toBe(true);
  });

  it("acusa o preço montado sobre outra distância, e diz qual", () => {
    const frases = diagnosticoDoTrecho(trechoCoerente(206));
    const frase = frases.find((f) => f.includes("montado sobre"))!;
    /* `formatNumber` corta o zero à direita: 206 km, e não "206,0 km". */
    expect(frase).toContain("206 km");
    expect(frase).toContain("412 km");
  });

  it("acusa o ciclo que não fecha", () => {
    const linhas = trechoCoerente().map((l) =>
      l.variavel === "km_volta" ? { ...l, base: "260", comparada: "260" } : l,
    );
    const frases = diagnosticoDoTrecho(linhas);
    expect(frases.some((f) => f.includes("discorda sobre a distância"))).toBe(true);
  });

  it("manda ligar o alternador quando não há com que conferir", () => {
    expect(diagnosticoDoTrecho([])).toEqual([
      "Nenhuma variável de km rodado se moveu neste trecho, e a comparação não trouxe " +
        "distância nem R$/viagem com que conferir o km. Ligue “Mostrar trechos sem " +
        "alteração” para ler as duas contas deste trecho.",
    ]);
  });

  it("repete o motivo do motor nas linhas que ele recusou comparar", () => {
    const frases = diagnosticoDoTrecho([
      razao({
        estado: "CONFLITO",
        motivo: "Semântica mudou entre as vigências",
        diferenca: null,
        variacao: null,
      }),
    ]);
    expect(frases.some((f) => f.includes("Semântica mudou entre as vigências"))).toBe(true);
  });
});
