import { describe, expect, it } from "vitest";
import type { LinhaDeVelocidade } from "@workspace/comparison/velocidade-media";
import { diagnosticoDoTrecho, valorDaPonta } from "../detalhe";

/**
 * O diagnóstico é a única frase desta tela escrita em português corrido, e por
 * isso a única que pode sair **contradizendo o número ao lado dela**. A tela de
 * FINAME já mostrou como: "a parcela desceu +R$ 5.169,50", com o sinal de alta
 * dentro de uma frase de queda.
 *
 * Estes casos prendem essa regra e as três que são próprias desta tela:
 *
 * 1. **A partição do ciclo vem primeiro**, porque é a resposta ao que o verbete
 *    pedia — quanto do tempo é rodar e quanto é esperar.
 * 2. **A conferência sai da mesma função do núcleo** que a régua da vigência usa,
 *    montada a partir das linhas da gaveta. Uma segunda cópia da regra faria a
 *    frase contradizer o painel logo acima dela.
 * 3. **A folga do tempo pago é dita, nunca apagada** — é o que o dicionário da
 *    tabela de frete pede com todas as letras.
 */

/** 412 km de ciclo a 58 km/h dão 426,2 minutos rodando. */
const RODANDO = (412 / 58) * 60;

const linha = (over: Partial<LinhaDeVelocidade> = {}): LinhaDeVelocidade => ({
  id: 1,
  entityLabel: "CAMACARIFEIRADESANTANA",
  entityType: "TRECHO",
  variavel: "velocidade",
  rotuloDaVariavel: "Velocidade média declarada",
  medida: "VELOCIDADE",
  papel: "VELOCIDADE",
  versaoLucro: false,
  attributeCode: "trecho.velocidade_media_km_h",
  base: "58",
  comparada: "58",
  diferenca: null,
  variacao: null,
  estado: "SEM_ALTERACAO",
  motivo: null,
  impactoAmount: null,
  impactoPeriodicidade: null,
  impactoCalculado: false,
  foraDaSoma: null,
  ...over,
});

/** O trecho inteiro, coerente: ciclo que comporta as paradas e fecha a velocidade. */
function trechoCoerente(over: Partial<Record<string, string>> = {}): LinhaDeVelocidade[] {
  const valores: Record<string, string> = {
    velocidade: "58",
    ciclo: String(RODANDO + 270),
    tma_origem: "90",
    tma_destino: "120",
    refeicao: "60",
    km_ciclo: "412",
    km_ida: "206",
    trajeto: String(RODANDO / 2),
    ...over,
  };
  const de = (chave: string, rotulo: string, medida: LinhaDeVelocidade["medida"], papel: LinhaDeVelocidade["papel"]) =>
    linha({
      variavel: chave,
      rotuloDaVariavel: rotulo,
      medida,
      papel,
      attributeCode: `trecho.${chave}`,
      base: valores[chave] ?? null,
      comparada: valores[chave] ?? null,
    });

  return [
    de("velocidade", "Velocidade média declarada", "VELOCIDADE", "VELOCIDADE"),
    de("ciclo", "Tempo total de ciclo", "MINUTOS", "TEMPO_TOTAL"),
    de("tma_origem", "TMA na origem", "MINUTOS", "TEMPO_PARADO"),
    de("tma_destino", "TMA no destino", "MINUTOS", "TEMPO_PARADO"),
    de("refeicao", "Tempo de refeição", "MINUTOS", "TEMPO_PARADO"),
    de("km_ciclo", "Km do ciclo", "DISTANCIA", "DISTANCIA"),
    de("km_ida", "Km de ida", "DISTANCIA", "DISTANCIA"),
    de("trajeto", "Tempo de deslocamento fábrica → CD", "MINUTOS", "TEMPO_RODANDO"),
  ];
}

describe("as linhas viram o valor de uma ponta", () => {
  it("lê a ponta pedida, e não a outra", () => {
    const linhas = [
      linha({ variavel: "ciclo", base: "600", comparada: "660", papel: "TEMPO_TOTAL" }),
    ];
    expect(valorDaPonta(linhas, "BASE").ciclo).toBe(600);
    expect(valorDaPonta(linhas, "COMPARADA").ciclo).toBe(660);
  });

  it("devolve nulo para a variável que a comparação não trouxe", () => {
    const valor = valorDaPonta([linha()], "COMPARADA");
    expect(valor.tmaOrigem).toBeNull();
    expect(valor.cicloLucro).toBeNull();
  });
});

describe("o diagnóstico do trecho", () => {
  it("abre o ciclo entre rodar e esperar, antes de tudo", () => {
    const [frase] = diagnosticoDoTrecho(trechoCoerente());
    expect(frase).toContain("rodando");
    expect(frase).toContain("esperando");
    expect(frase).toContain("%");
  });

  it("confirma a velocidade quando o ciclo a devolve", () => {
    const frases = diagnosticoDoTrecho(trechoCoerente());
    expect(frases.some((f) => f.includes("A velocidade fecha"))).toBe(true);
  });

  it("acusa a velocidade declarada que não é a do ciclo", () => {
    const frases = diagnosticoDoTrecho(trechoCoerente({ velocidade: "40" }));
    const frase = frases.find((f) => f.includes("km/h, e o trecho declara"))!;
    /* `formatNumber` corta o zero à direita: 58 km/h, e não "58,0 km/h". */
    expect(frase).toContain("58 km/h");
    expect(frase).toContain("40 km/h");
  });

  it("acusa as paradas que não cabem no ciclo", () => {
    const frases = diagnosticoDoTrecho(trechoCoerente({ ciclo: "200" }));
    expect(frases.some((f) => f.includes("discorda de si mesma"))).toBe(true);
  });

  it("diz sobre qual distância o tempo de deslocamento foi calculado", () => {
    const frases = diagnosticoDoTrecho(trechoCoerente());
    expect(frases.some((f) => f.includes("sobre o km de ida"))).toBe(true);
  });

  it("não escreve o sinal de alta dentro de uma frase de queda", () => {
    const frases = diagnosticoDoTrecho([
      ...trechoCoerente(),
      linha({
        variavel: "tma_destino",
        rotuloDaVariavel: "TMA no destino",
        medida: "MINUTOS",
        papel: "TEMPO_PARADO",
        base: "150",
        comparada: "120",
        diferenca: -30,
        variacao: -20,
        estado: "ALTERADO",
      }),
    ]);
    const frase = frases.find((f) => f.includes("TMA no destino encurtou"))!;
    expect(frase).toContain("30 min");
    expect(frase).not.toContain("+");
  });

  it("liga o tempo parado ao custo de pessoal, que é o que ele vira", () => {
    const frases = diagnosticoDoTrecho([
      linha({
        variavel: "tma_origem",
        rotuloDaVariavel: "TMA na origem",
        medida: "MINUTOS",
        papel: "TEMPO_PARADO",
        base: "90",
        comparada: "140",
        diferenca: 50,
        variacao: 55.6,
        estado: "ALTERADO",
      }),
    ]);
    const frase = frases.find((f) => f.includes("TMA na origem cresceu"))!;
    expect(frase).toContain("fator motorista");
  });

  it("diz a folga entre o tempo pago e o praticado, com a direção", () => {
    const frases = diagnosticoDoTrecho([
      ...trechoCoerente(),
      linha({
        variavel: "ciclo_lucro",
        rotuloDaVariavel: "Tempo total de ciclo · versão lucro",
        medida: "MINUTOS",
        papel: "TEMPO_TOTAL",
        versaoLucro: true,
        base: String(RODANDO + 330),
        comparada: String(RODANDO + 330),
        foraDaSoma: "É o mesmo ciclo noutra régua.",
      }),
    ]);
    const frase = frases.find((f) => f.includes("O ciclo que remunera"))!;
    expect(frase).toContain("maior");
    expect(frase).toContain("1h 00min");
  });

  it("manda ligar o alternador quando não há com que abrir o ciclo", () => {
    expect(diagnosticoDoTrecho([])).toEqual([
      "Nenhum tempo e nenhuma velocidade se moveram neste trecho, e a comparação não " +
        "trouxe o ciclo nem as paradas com que abri-lo. Ligue “Mostrar trechos sem " +
        "alteração” para ler a partição do ciclo deste trecho.",
    ]);
  });

  it("repete o motivo do motor nas linhas que ele recusou comparar", () => {
    const frases = diagnosticoDoTrecho([
      linha({ estado: "CONFLITO", motivo: "Semântica mudou entre as vigências" }),
    ]);
    expect(frases.some((f) => f.includes("Semântica mudou entre as vigências"))).toBe(true);
  });
});
