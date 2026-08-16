/**
 * A tabela que diz em que valor cada parâmetro mexe.
 *
 * O que estes casos protegem não é a lista — ela cresce — e sim as três
 * propriedades sem as quais a visão por tipo passa a mentir em silêncio: o
 * nome do parâmetro é encontrado escrito de qualquer jeito, um parâmetro pode
 * mexer em dois valores, e o que não se conhece cai numa caixa visível em vez
 * de numa caixa qualquer.
 */
import { describe, expect, it } from "vitest";
import {
  CLASSIFICACAO_DE_PARAMETROS,
  CLASSES_DE_VALOR,
  NAO_CLASSIFICADO,
  chaveDeParametro,
  classesDoParametro,
  classificarParametro,
} from "../classificacao";

describe("chaveDeParametro", () => {
  it("acha o mesmo parâmetro escrito de três jeitos", () => {
    // O export mistura camelCase com nome de exibição: `taxaFiname` no formato
    // largo e `Taxa Finame (%)` no cabeçalho. Concluir "não classificado" por
    // causa da pontuação seria jogar o parâmetro na fila de trabalho errada.
    expect(chaveDeParametro("taxaFiname")).toBe("taxafiname");
    expect(chaveDeParametro("Taxa Finame (%)")).toBe("taxafiname");
    expect(chaveDeParametro("TAXA_FINAME")).toBe("taxafiname");
  });

  it("come o acento, e não a letra", () => {
    expect(chaveDeParametro("Tacógrafo")).toBe(chaveDeParametro("tacografo"));
    // Nomes que diferem por letra continuam sendo parâmetros diferentes.
    expect(chaveDeParametro("kmIda")).not.toBe(chaveDeParametro("kmVolta"));
  });
});

describe("classificarParametro", () => {
  it("classifica o que a planilha do time classificou", () => {
    expect(classificarParametro("seguro")?.classes).toEqual(["FIXO"]);
    expect(classificarParametro("freteReaisViagemPedagio")?.classes).toEqual([
      "VARIAVEL",
    ]);
    expect(classificarParametro("combustivelConsumoNeg")?.classes).toEqual([
      "VARIAVEL_DIESEL",
    ]);
  });

  it("deixa um parâmetro mexer em dois valores", () => {
    // `cavaloEmpurrada` está nas duas tabelas da planilha do time. Se alguém
    // "corrigir" isto para uma classe só, as somas por classe passam a fechar
    // com o total — e passam a estar erradas.
    expect(classificarParametro("cavaloEmpurrada")?.classes).toEqual([
      "FIXO",
      "VARIAVEL",
    ]);
  });

  it("devolve null para quem não está na tabela", () => {
    expect(classificarParametro("parametroQueNinguemViu")).toBeNull();
  });

  it("toda entrada diz de onde veio e por quê", () => {
    // Uma linha sem evidência é indistinguível de um palpite, e a tela mostra
    // este texto quando alguém pergunta por que o parâmetro caiu nesta caixa.
    for (const entrada of CLASSIFICACAO_DE_PARAMETROS) {
      expect(entrada.porque.length).toBeGreaterThan(20);
      expect(["PLANILHA", "IDENTIDADE", "CATALOGO"]).toContain(entrada.origem);
    }
  });

  it("não repete o mesmo parâmetro em duas linhas", () => {
    // Duas linhas para o mesmo nome fariam a segunda ser ignorada em silêncio,
    // e a classificação exibida seria a que ninguém escreveu por último.
    const chaves = CLASSIFICACAO_DE_PARAMETROS.map((p) =>
      chaveDeParametro(p.parametro),
    );
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});

describe("classesDoParametro", () => {
  it("manda o desconhecido para a caixa que aparece na tela", () => {
    expect(classesDoParametro("parametroQueNinguemViu")).toEqual([
      NAO_CLASSIFICADO,
    ]);
  });

  it("trata o conhecido-sem-classe como não classificado, e não como erro", () => {
    // Capacidade do tanque é especificação, não consumo. A linha existe para o
    // parâmetro sair da fila de trabalho sem entrar em nenhum valor.
    const capacidade = classificarParametro("combustivelCapacidade");
    expect(capacidade?.classes).toEqual([]);
    expect(classesDoParametro("combustivelCapacidade")).toEqual([
      NAO_CLASSIFICADO,
    ]);
  });

  it("nunca devolve lista vazia", () => {
    // A tela soma por classe percorrendo esta lista: uma alteração sem caixa
    // nenhuma sumiria de todas as contagens sem aparecer em lugar nenhum.
    for (const nome of ["seguro", "kmIda", "combustivelCapacidade", "inventado"]) {
      expect(classesDoParametro(nome).length).toBeGreaterThan(0);
    }
  });

  it("só usa códigos de classe que a tela sabe desenhar", () => {
    const conhecidos = new Set(CLASSES_DE_VALOR.map((c) => c.codigo));
    for (const entrada of CLASSIFICACAO_DE_PARAMETROS) {
      for (const classe of entrada.classes) {
        expect(conhecidos.has(classe)).toBe(true);
      }
    }
  });
});
