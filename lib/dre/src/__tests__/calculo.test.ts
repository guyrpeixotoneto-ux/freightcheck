import { describe, expect, it } from "vitest";
import { montarDRE, linha, subtotal } from "../motor";
import { atributosDaDRE, componentesDoEscopo, PLANO_DA_DRE } from "../plano";
import { conjuntoDeReferencia, lado } from "./fixtures";

/**
 * Cálculo: receita, custos, subtotais, percentual (§31).
 *
 * O teste que não pode falhar em silêncio é o do **subtotal inconclusivo**. Com
 * diesel, pneus, manutenção e motorista ausentes, EBITDA e margem de
 * contribuição são aritmeticamente produzíveis e economicamente falsos, e o
 * módulo inteiro existe para não exibi-los.
 */

const VIGENCIA = { effectiveDate: "2026-08-01", periodLabel: "Agosto/2026" };

function dreDoConjunto() {
  const { cavalo, carreta } = conjuntoDeReferencia();
  return montarDRE({ escopo: "CONJUNTO", ...VIGENCIA, lados: [cavalo, carreta] });
}

describe("receita", () => {
  it("usa custoFixo como a receita do conjunto, e não a soma dos dois lados", () => {
    const dre = dreDoConjunto();
    const receita = subtotal(dre, "RECEITA_BRUTA");

    /*
      17.000 é `carreta.custo_fixo`, que contém o cavalo. Somar os três
      componentes de receita — 17.000 do conjunto + 14.000 do cavalo + 3.000 da
      carreta — daria 34.000 e contaria o mesmo dinheiro duas vezes. O plano
      resolve isso pelo escopo: no CONJUNTO só a linha de conjunto existe.
    */
    expect(receita.valor).toBe(17000);
    expect(receita.conclusivo).toBe(true);
    expect(linha(dre, "receita.remuneracao_fixa_cavalo")).toBeNull();
    expect(linha(dre, "receita.remuneracao_fixa_carreta")).toBeNull();
  });

  it("soma as fontes dos dois lados numa linha de conjunto", () => {
    const dre = dreDoConjunto();
    /* 9.000 do cavalo + 1.800 do implemento. */
    expect(linha(dre, "financeiro.amortizacao")!.valor).toBe(10800);
    /* 4.900 + 600. */
    expect(linha(dre, "financeiro.juros")!.valor).toBe(5500);
  });

  it("marca como CALCULADO o que somou mais de uma fonte, e OBSERVADO o resto", () => {
    const dre = dreDoConjunto();
    expect(linha(dre, "financeiro.amortizacao")!.natureza).toBe("CALCULADO");
    expect(linha(dre, "receita.remuneracao_fixa")!.natureza).toBe("OBSERVADO");
  });
});

describe("subtotais", () => {
  it("fecha a receita bruta e recusa margem, EBITDA e resultado", () => {
    const dre = dreDoConjunto();

    expect(subtotal(dre, "RECEITA_BRUTA").conclusivo).toBe(true);
    expect(subtotal(dre, "RECEITA_LIQUIDA").conclusivo).toBe(true);

    for (const id of ["MARGEM_CONTRIBUICAO", "EBITDA", "RESULTADO_ECONOMICO"] as const) {
      const s = subtotal(dre, id);
      expect(s.conclusivo, `${id} não pode ser conclusivo sem custo variável`).toBe(false);
      expect(s.valor, `${id} não pode ter valor`).toBeNull();
      expect(s.bloqueadoPor.length).toBeGreaterThan(0);
    }
  });

  it("nomeia o que bloqueia cada subtotal, com o que destravaria", () => {
    const dre = dreDoConjunto();
    const bloqueios = subtotal(dre, "EBITDA").bloqueadoPor;
    const codigos = bloqueios.map((b) => b.code);

    expect(codigos).toContain("variavel.diesel");
    expect(codigos).toContain("variavel.pneus");
    expect(codigos).toContain("fixo.motorista");
    for (const b of bloqueios) {
      expect(b.oQueFalta.length, `${b.code} sem instrução do que falta`).toBeGreaterThan(20);
    }
  });

  it("o bloqueio é acumulado: nada abaixo da margem volta a ser conclusivo", () => {
    const dre = dreDoConjunto();
    const margem = subtotal(dre, "MARGEM_CONTRIBUICAO").bloqueadoPor.map((b) => b.code);
    const resultado = subtotal(dre, "RESULTADO_ECONOMICO").bloqueadoPor.map((b) => b.code);
    for (const code of margem) expect(resultado).toContain(code);
  });

  it("expõe o valor parcial sem nunca chamá-lo do nome do subtotal", () => {
    const dre = dreDoConjunto();
    const resultado = subtotal(dre, "RESULTADO_ECONOMICO");

    /* 17.000 − 10.800 − 5.500 − 1.000 (IPVA/12) − 100 (aluguel) = −400. */
    expect(resultado.valorParcial).toBe(-400);
    expect(resultado.valor).toBeNull();
  });
});

describe("percentuais", () => {
  it("calcula sobre a receita bruta apurada", () => {
    const dre = dreDoConjunto();
    /* 10.800 / 17.000 = 63,53%. */
    expect(linha(dre, "financeiro.amortizacao")!.percentualDaReceita).toBeCloseTo(63.53, 2);
  });

  it("não produz percentual quando a receita é nula", () => {
    const dre = montarDRE({
      escopo: "CAVALO",
      ...VIGENCIA,
      lados: [lado("CAVALO", "SEM0R00", { "cavalo.ipva_licenciamento": 12000 }, {
        "cavalo.ipva_licenciamento": { periodicity: "ANUAL" },
      })],
    });
    expect(subtotal(dre, "RECEITA_BRUTA").valor).toBeNull();
    expect(linha(dre, "fixo.ipva_licenciamento")!.percentualDaReceita).toBeNull();
    expect(dre.estado).toBe("INCONCLUSIVA");
  });
});

describe("o plano", () => {
  it("não tem componente sem fonte e sem motivo declarado", () => {
    for (const componente of PLANO_DA_DRE) {
      if (componente.fontes.length === 0) {
        expect(componente.ausencia, `${componente.code} sem ausência declarada`).toBeDefined();
        expect(componente.ausencia!.oQueFalta.length).toBeGreaterThan(20);
      }
      expect(componente.evidencia.length, `${componente.code} sem evidência`).toBeGreaterThan(40);
    }
  });

  it("não tem código repetido", () => {
    const codigos = PLANO_DA_DRE.map((c) => c.code);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("consome apenas atributos declarados", () => {
    const declarados = atributosDaDRE();
    const dre = dreDoConjunto();
    for (const secao of dre.secoes) {
      for (const l of secao.linhas) {
        for (const origem of l.origens) {
          expect(declarados).toContain(origem.attributeCode);
        }
      }
    }
  });

  it("dá a cada escopo o conjunto de componentes que lhe cabe", () => {
    const conjunto = componentesDoEscopo("CONJUNTO").map((c) => c.code);
    const cavalo = componentesDoEscopo("CAVALO").map((c) => c.code);

    expect(conjunto).toContain("receita.remuneracao_fixa");
    expect(cavalo).not.toContain("receita.remuneracao_fixa");
    expect(cavalo).toContain("receita.remuneracao_fixa_cavalo");
    /* Amortização é de conjunto e tem fonte do lado do cavalo: entra nos dois. */
    expect(cavalo).toContain("financeiro.amortizacao");
  });
});
