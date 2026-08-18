import { describe, expect, it } from "vitest";
import { slugifyColumn } from "@workspace/ingest";
import {
  CATALOGO_DECLARADO,
  entraNaDRE,
  FORA_DA_DRE,
  type TipoDeclarado,
} from "../catalogo-declarado";

/**
 * O catálogo declarado, sozinho — sem banco, porque ele não tem banco.
 *
 * Estes testes guardam três propriedades, e as três têm a mesma forma: são
 * coisas que, quando quebram, quebram **em silêncio** e só aparecem meses
 * depois como uma lacuna que ninguém consegue fechar.
 */

const porTipo = (t: TipoDeclarado) => CATALOGO_DECLARADO.filter((a) => a.entityType === t);

describe("os códigos", () => {
  /*
    A propriedade que sustenta o módulo inteiro.

    A expectativa cobra `trecho.pedagio`; o dia em que um arquivo de trecho
    chegar, a importação vai criar o atributo com o código que `slugifyColumn`
    produzir do cabeçalho. Se os dois não forem a mesma string, a lacuna nunca
    fecha: o dado entra com um nome e a cobrança fica no outro, para sempre — e
    o sintoma é uma tela que insiste em pedir uma coluna que está ali.

    Por isso o teste não confere uma lista de códigos escrita à mão. Ele aplica
    a função da importação ao `sourceName` de cada linha e exige igualdade.
  */
  it("são exatamente o que a importação geraria do cabeçalho", () => {
    for (const a of CATALOGO_DECLARADO) {
      expect(a.code).toBe(`${a.entityType.toLowerCase()}.${slugifyColumn(a.sourceName)}`);
    }
  });

  it("não colidem dentro do mesmo tipo", () => {
    for (const tipo of ["CAVALO", "CARRETA", "TRECHO"] as const) {
      const codes = porTipo(tipo).map((a) => a.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
});

describe("a classificação", () => {
  it("separa o cadastral do que alimenta a DRE", () => {
    const cadastrais = CATALOGO_DECLARADO.filter((a) => a.secaoDaDRE === FORA_DA_DRE);
    expect(cadastrais.every((a) => !entraNaDRE(a))).toBe(true);
    expect(cadastrais.length).toBeGreaterThan(0);
    expect(CATALOGO_DECLARADO.some((a) => entraNaDRE(a))).toBe(true);
  });

  /*
    Toda linha tem seção. Uma célula vazia na planilha vira `null` aqui, e
    `entraNaDRE` a trataria como cadastral — silenciosamente rebaixando um
    atributo financeiro a informativo, que é o bug que faz a cobertura crítica
    mentir para cima.
  */
  it("não deixa atributo sem seção", () => {
    const semSecao = CATALOGO_DECLARADO.filter((a) => a.secaoDaDRE === null);
    expect(semSecao.map((a) => a.code)).toEqual([]);
  });
});

describe("os três tipos", () => {
  it("estão todos declarados, inclusive o que nunca foi importado", () => {
    for (const tipo of ["CAVALO", "CARRETA", "TRECHO"] as const) {
      expect(porTipo(tipo).length).toBeGreaterThan(0);
    }
  });
});
