import { describe, expect, it } from "vitest";
import {
  contarFrota,
  medirAliquota,
  medirPisCofins,
  medirProporcaoDeDocumentos,
  resumoDeImpostos,
  type TrechoDaVigencia,
} from "../medicao";

/**
 * As medições do cadastro, exercitadas sem banco.
 *
 * O material é sintético e pequeno de propósito: o que se está conferindo é a
 * regra, e uma regra que precisa de vinte mil linhas para ser demonstrada não é
 * uma regra — é uma coincidência.
 *
 * A quinzena de referência é a da planilha que originou o módulo (CDD Belém ·
 * Horizonte, 01 a 15/08/2026): PIS 0,65%, COFINS 8,60%, ICMS 17,84%, ISS 5,90%,
 * e o resumo de impostos em 72,91% fora do município e 84,85% dentro. É contra
 * esses números que o caso do resumo fecha — é a única linha do cadastro cuja
 * conta a própria planilha demonstra, e prendê-la aqui é o que impede o módulo
 * de "melhorar" a fórmula um dia e passar a discordar do Excel calado.
 */

const trecho = (t: Partial<TrechoDaVigencia>): TrechoDaVigencia => ({
  tributo: null,
  percentualDeclarado: null,
  freteCtrc: null,
  imposto: null,
  pisCofins: null,
  previsaoViagens: null,
  ...t,
});

describe("a contagem da frota", () => {
  it("separa ativos de inativos e soma os dois na operação", () => {
    const contagem = contarFrota([
      { entityId: "a", ativo: true },
      { entityId: "b", ativo: true },
      { entityId: "c", ativo: false },
    ]);

    expect(contagem).toEqual({
      ativos: 2,
      inativos: 1,
      operacao: 3,
      semResposta: 0,
      total: 3,
    });
  });

  /*
    O veículo sem a coluna é a razão de `semResposta` existir. Contá-lo como
    inativo faria a planilha remunerar frota parada que ninguém disse estar
    parada — e o total de operação passaria a incluir quem nunca respondeu.
  */
  it("não trata ausência de resposta como inatividade", () => {
    const contagem = contarFrota([
      { entityId: "a", ativo: true },
      { entityId: "b", ativo: null },
    ]);

    expect(contagem.inativos).toBe(0);
    expect(contagem.semResposta).toBe(1);
    expect(contagem.operacao).toBe(1);
    expect(contagem.total).toBe(2);
  });
});

describe("a alíquota", () => {
  it("sai da razão entre imposto e documento, e não da coluna de percentual", () => {
    /*
      A coluna declarada vem em fração (`0.1784`) e a medida em pontos
      (`17.84`). Se a medição lesse a coluna, o cadastro mostraria 0,18% de
      ICMS — o número certo na escala errada, que é o defeito que a razão em
      reais existe para não ter.
    */
    const medida = medirAliquota(
      [
        trecho({ tributo: "ICMS", freteCtrc: 1000, imposto: 178.4, percentualDeclarado: 0.1784 }),
        trecho({ tributo: "ICMS", freteCtrc: 2000, imposto: 356.8, percentualDeclarado: 0.1784 }),
        trecho({ tributo: "ISS", freteCtrc: 500, imposto: 29.5, percentualDeclarado: 0.059 }),
      ],
      "ICMS",
    );

    expect(medida).not.toBeNull();
    expect(medida!.percentual).toBeCloseTo(17.84, 4);
    expect(medida!.trechos).toBe(2);
    expect(medida!.base).toBe(3000);
    expect(medida!.declarados).toEqual([0.1784]);
  });

  it("pondera pelo valor do documento quando a alíquota varia por trecho", () => {
    const medida = medirAliquota(
      [
        trecho({ tributo: "ICMS", freteCtrc: 9000, imposto: 1800, percentualDeclarado: 20 }),
        trecho({ tributo: "ICMS", freteCtrc: 1000, imposto: 120, percentualDeclarado: 12 }),
      ],
      "ICMS",
    );

    // 1.920 / 10.000 — e não a média simples de 20% e 12%, que daria 16%.
    expect(medida!.percentual).toBeCloseTo(19.2, 4);
    expect(medida!.declarados).toEqual([12, 20]);
  });

  it("devolve nulo quando o tributo não aparece — nulo não é zero", () => {
    expect(medirAliquota([trecho({ tributo: "ICMS", freteCtrc: 100, imposto: 18 })], "ISS")).toBeNull();
  });

  it("ignora o trecho que declara o tributo sem trazer as duas pontas em reais", () => {
    const medida = medirAliquota(
      [
        trecho({ tributo: "ISS", freteCtrc: 1000, imposto: 59, percentualDeclarado: 5.9 }),
        trecho({ tributo: "ISS", percentualDeclarado: 5.9 }),
      ],
      "ISS",
    );

    expect(medida!.trechos).toBe(1);
    expect(medida!.percentual).toBeCloseTo(5.9, 4);
    // O trecho sem reais não some da conferência: a alíquota declarada dele conta.
    expect(medida!.declarados).toEqual([5.9]);
  });
});

describe("PIS e COFINS", () => {
  it("são medidos juntos, porque o export os traz juntos", () => {
    const medida = medirPisCofins([
      trecho({ tributo: "ICMS", freteCtrc: 1000, pisCofins: 92.5 }),
      trecho({ tributo: "ISS", freteCtrc: 1000, pisCofins: 92.5 }),
    ]);

    expect(medida!.percentual).toBeCloseTo(9.25, 4);
    expect(medida!.trechos).toBe(2);
  });

  it("não se separam: o par é o que o acervo sustenta", () => {
    const medida = medirPisCofins([trecho({ freteCtrc: 1000, pisCofins: 92.5 })])!;

    // 0,65 + 8,60 = 9,25. O par bate com a planilha; as partes não vêm daqui.
    expect(medida.percentual).toBeCloseTo(0.65 + 8.6, 4);
  });
});

describe("a proporção de documentos", () => {
  it("pesa cada trecho pelas viagens que ele prevê", () => {
    const proporcao = medirProporcaoDeDocumentos([
      trecho({ tributo: "ISS", previsaoViagens: 2 }),
      trecho({ tributo: "ICMS", previsaoViagens: 40 }),
      trecho({ tributo: "ICMS", previsaoViagens: 38 }),
    ])!;

    expect(proporcao.criterio).toBe("VIAGENS_PREVISTAS");
    expect(proporcao.documentos).toBe(80);
    expect(proporcao.dentro).toBeCloseTo(2.5, 4);
    expect(proporcao.fora).toBeCloseTo(97.5, 4);
  });

  /*
    O recuo para contagem de trechos precisa ser total: pesar uns por viagens e
    outros por cabeça daria um denominador que não é nem uma medida nem a
    outra, e a tela não teria como dizer o que mostrou.
  */
  it("recua para contagem de trechos quando a previsão falta em algum", () => {
    const proporcao = medirProporcaoDeDocumentos([
      trecho({ tributo: "ISS", previsaoViagens: 2 }),
      trecho({ tributo: "ICMS", previsaoViagens: null }),
    ])!;

    expect(proporcao.criterio).toBe("TRECHOS");
    expect(proporcao.documentos).toBe(2);
    expect(proporcao.dentro).toBeCloseTo(50, 4);
  });

  it("deixa de fora, e conta, o trecho que não declara tributo", () => {
    const proporcao = medirProporcaoDeDocumentos([
      trecho({ tributo: "ISS", previsaoViagens: 1 }),
      trecho({ tributo: "ICMS", previsaoViagens: 1 }),
      trecho({ tributo: null, previsaoViagens: 99 }),
    ])!;

    expect(proporcao.semTributo).toBe(1);
    expect(proporcao.documentos).toBe(2);
    expect(proporcao.dentro).toBeCloseTo(50, 4);
  });

  it("devolve nulo quando nenhum trecho declara tributo", () => {
    expect(medirProporcaoDeDocumentos([trecho({ previsaoViagens: 10 })])).toBeNull();
  });
});

describe("o resumo de impostos", () => {
  /*
    Este é o caso que prende o módulo à planilha real. Com as quatro alíquotas
    da aba de CDD Belém, as duas linhas do RESUMO IMPOSTOS têm de sair
    exatamente como o Excel as mostra.
  */
  it("reproduz a planilha: 84,85% dentro do município e 72,91% fora", () => {
    const resumo = resumoDeImpostos({ pisCofins: 0.65 + 8.6, icms: 17.84, iss: 5.9 });

    expect(resumo.dentro).toBeCloseTo(84.85, 4);
    expect(resumo.fora).toBeCloseTo(72.91, 4);
  });

  it("não fecha metade da conta com meia alíquota", () => {
    expect(resumoDeImpostos({ pisCofins: 9.25, icms: null, iss: 5.9 })).toEqual({
      dentro: 84.85,
      fora: null,
    });
  });
});
