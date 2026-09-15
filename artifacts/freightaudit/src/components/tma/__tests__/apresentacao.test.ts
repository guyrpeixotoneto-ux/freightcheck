import { describe, expect, it } from "vitest";
import type { LocalDeTma, TrechoDeTma } from "@workspace/comparison/tma";
import {
  FILTROS_VAZIOS,
  contagemPorVeredito,
  escreverDiferencaDeTempo,
  escreverFracao,
  escreverMinutos,
  filtrarLocais,
  filtrarTrechos,
  linhasDoCsvDeLocais,
  linhasDoCsvDeTrechos,
} from "@/lib/tma";

/**
 * O que estes casos prendem.
 *
 * A conta inteira é do núcleo e já está presa em `lib/comparison`. O que sobra
 * para a tela é **escrita e recorte**, e é onde moram os erros próprios desta
 * camada:
 *
 * 1. um tempo escrito de um jeito que não existe no relógio — "3h 60min";
 * 2. uma diferença sem sinal, que faz uma porta que ganhou meia hora parecer
 *    igual a uma que perdeu;
 * 3. um recorte que abre com as duas vigências misturadas, mostrando cada local
 *    duas vezes onde se esperava o retrato de hoje;
 * 4. um CSV que escreve zero onde o núcleo devolveu nulo.
 */

const local = (over: Partial<LocalDeTma> = {}): LocalDeTma => ({
  ponta: "COMPARADA",
  local: "CAMAÇARI",
  porta: "ORIGEM",
  trechos: 3,
  minimo: 90,
  medio: 90,
  maximo: 90,
  amplitude: 0,
  desvio: 0,
  pagoMedio: 90,
  folgaMedia: 0,
  trechosComFolga: 0,
  pesoNoCiclo: 0.13,
  veredito: "TMA_UNICO",
  ...over,
});

const trecho = (over: Partial<TrechoDeTma> = {}): TrechoDeTma => ({
  ponta: "COMPARADA",
  entityLabel: "CAMACARIFEIRADESANTANA",
  origem: "CAMAÇARI",
  destino: "FEIRA DE SANTANA",
  tmaOrigem: 90,
  tmaDestino: 120,
  tempoDePorta: 210,
  pagoDePorta: 210,
  folga: 0,
  ciclo: 700,
  pesoNoCiclo: 0.3,
  veredito: "IGUAL",
  ...over,
});

describe("o tempo escrito", () => {
  it("fica em minutos abaixo de uma hora — '0h 45min' se lê pior que '45 min'", () => {
    expect(escreverMinutos(45)).toBe("45 min");
  });

  it("vira horas e minutos acima de uma hora, que é onde a comparação de cabeça falha", () => {
    expect(escreverMinutos(210)).toBe("3h 30min");
    expect(escreverMinutos(120)).toBe("2h 00min");
  });

  it("nunca escreve um horário que não existe no relógio", () => {
    /* 59,7 min arredondam para 60, e "3h 60min" é a hora que ninguém tem. */
    expect(escreverMinutos(239.7)).toBe("4h 00min");
  });

  it("não inventa zero para o que não veio", () => {
    expect(escreverMinutos(null)).toBe("—");
    expect(escreverDiferencaDeTempo(null)).toBe("—");
    expect(escreverFracao(null)).toBe("—");
  });

  it("põe o sinal na diferença, porque o sinal é a informação", () => {
    expect(escreverDiferencaDeTempo(30)).toBe("+30 min");
    expect(escreverDiferencaDeTempo(-30)).toBe("−30 min");
    expect(escreverDiferencaDeTempo(0)).toBe("0 min");
  });

  it("escreve a fração do ciclo como percentual", () => {
    expect(escreverFracao(0.285)).toBe("28,5%");
    /* `formatNumber` corta o zero à direita: 28,0% sai como "28%". */
    expect(escreverFracao(0.28)).toBe("28%");
  });
});

describe("o recorte da tabela", () => {
  it("abre na vigência comparada, e não com as duas misturadas", () => {
    const locais = [local(), local({ ponta: "BASE" })];
    expect(filtrarLocais(locais, FILTROS_VAZIOS)).toHaveLength(1);
    expect(filtrarLocais(locais, { ...FILTROS_VAZIOS, ponta: "TODAS" })).toHaveLength(2);
  });

  it("separa as duas portas, que é a distinção que a tela inteira defende", () => {
    const locais = [local(), local({ porta: "DESTINO" })];
    expect(filtrarLocais(locais, { ...FILTROS_VAZIOS, porta: "DESTINO" })).toHaveLength(1);
  });

  it("filtra pela leitura do local — a fila de trabalho é a da contradição", () => {
    const locais = [local(), local({ local: "ALAGOINHAS", veredito: "VARIA_POR_TRECHO" })];
    const so = filtrarLocais(locais, { ...FILTROS_VAZIOS, veredito: "VARIA_POR_TRECHO" });
    expect(so.map((l) => l.local)).toEqual(["ALAGOINHAS"]);
  });

  it("busca o trecho pelo nome e pelas duas pontas do percurso", () => {
    const trechos = [trecho(), trecho({ entityLabel: "OUTRO", origem: "SALVADOR" })];
    expect(filtrarTrechos(trechos, { ...FILTROS_VAZIOS, busca: "salvador" })).toHaveLength(1);
    expect(filtrarTrechos(trechos, { ...FILTROS_VAZIOS, busca: "feira" })).toHaveLength(2);
  });

  it("conta os vereditos sobre o mesmo recorte da tabela, e não sobre tudo", () => {
    const locais = [
      local(),
      local({ local: "ALAGOINHAS", veredito: "VARIA_POR_TRECHO" }),
      local({ ponta: "BASE", veredito: "VARIA_POR_TRECHO" }),
    ];
    const contagem = contagemPorVeredito(locais, FILTROS_VAZIOS);
    /* A ponta base fica de fora: contá-la faria o seletor prometer três linhas
       e a tabela mostrar duas. */
    expect(contagem.TODOS).toBe(2);
    expect(contagem.VARIA_POR_TRECHO).toBe(1);
  });
});

describe("os dois CSVs", () => {
  it("dá a cada grão o seu arquivo, com cabeçalho próprio", () => {
    const deLocais = linhasDoCsvDeLocais([local()]);
    const deTrechos = linhasDoCsvDeTrechos([trecho()]);
    expect(deLocais[0][0]).toBe("Local");
    expect(deTrechos[0][0]).toBe("Trecho");
    expect(deLocais[0]).toHaveLength(12);
    expect(deTrechos[0]).toHaveLength(12);
  });

  it("escreve o tempo como número que a planilha soma, e não como '3h 30min'", () => {
    const [, linha] = linhasDoCsvDeTrechos([trecho()]);
    /* Com a vírgula decimal e duas casas, que é o que a planilha pt-BR lê como
       número — e "3h 30min" ela leria como texto. */
    expect(linha[6]).toBe("210,00");
  });

  it("deixa a célula vazia onde o núcleo devolveu nulo — zero seria outra afirmação", () => {
    const [, linha] = linhasDoCsvDeTrechos([
      trecho({ tempoDePorta: null, pesoNoCiclo: null, folga: null }),
    ]);
    expect(linha[6]).toBe("");
    expect(linha[10]).toBe("");
  });
});
