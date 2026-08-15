import { describe, expect, it } from "vitest";
import { montarDRE, subtotal } from "../motor";
import { consolidar, ordenarRanking, veiculosComAtencao, type LinhaDoRanking } from "../consolidado";
import { lado } from "./fixtures";

/**
 * Consolidação (§16, §17, §31).
 *
 * O teste que dá nome ao arquivo é o da **média enganosa**. Um veículo pequeno
 * com margem enorme e um grande com margem mínima têm média aritmética de
 * margem que não descreve nada. A consolidação certa é a razão dos consolidados,
 * e a diferença entre as duas contas é a diferença entre uma frota que parece
 * saudável e uma que não é.
 */

const VIGENCIA = { effectiveDate: "2026-08-01", periodLabel: "Agosto/2026" };

/** Um cavalo com receita e custos escolhidos, para controlar a margem. */
function cavalo(placa: string, receita: number, amortizacao: number) {
  return montarDRE({
    escopo: "CAVALO",
    ...VIGENCIA,
    lados: [
      lado("CAVALO", placa, {
        "cavalo.finame_cavalo": receita,
        "cavalo.amortizacao_cavalo": amortizacao,
      }),
    ],
  });
}

describe("média enganosa", () => {
  it("consolida numerador e denominador, e não a média dos percentuais", () => {
    /* Um pequeno com 80% de margem e um grande com 5%. */
    const pequeno = cavalo("PEQ0E00", 500, 100);
    const grande = cavalo("GRA0N00", 100_000, 95_000);

    expect(subtotal(pequeno, "RESULTADO_ECONOMICO").valorParcial).toBe(400);
    expect(subtotal(grande, "RESULTADO_ECONOMICO").valorParcial).toBe(5000);

    const frota = consolidar([pequeno, grande], "CAVALO", VIGENCIA);
    const resultado = frota.subtotais.find((s) => s.id === "RESULTADO_ECONOMICO")!;
    const receita = frota.subtotais.find((s) => s.id === "RECEITA_BRUTA")!;

    expect(receita.valorParcial).toBe(100_500);
    expect(resultado.valorParcial).toBe(5400);

    /*
      A média simples das margens seria (80 + 5) / 2 = 42,5%. A margem da frota
      é 5.400 / 100.500 = 5,37%. Oito vezes menor, e é a verdadeira.
    */
    const margem = (resultado.valorParcial! / receita.valorParcial!) * 100;
    expect(margem).toBeCloseTo(5.37, 2);
    expect(margem).not.toBeCloseTo(42.5, 1);
  });

  it("recalcula o percentual de cada linha sobre a receita consolidada", () => {
    const frota = consolidar([cavalo("A0A0A00", 1000, 400), cavalo("B0B0B00", 3000, 1200)], "CAVALO", VIGENCIA);
    const amortizacao = frota.secoes
      .flatMap((s) => s.linhas)
      .find((l) => l.code === "financeiro.amortizacao")!;

    expect(amortizacao.valor).toBe(1600);
    /* 1.600 / 4.000 = 40%, e não a média de 40% com 40%. */
    expect(amortizacao.percentualDaReceita).toBe(40);
  });
});

describe("sem duplicação", () => {
  it("conta cada ativo exatamente uma vez", () => {
    const frota = consolidar(
      [cavalo("A0A0A00", 1000, 400), cavalo("B0B0B00", 3000, 1200), cavalo("C0C0C00", 500, 100)],
      "CAVALO",
      VIGENCIA,
    );
    expect(frota.unidades).toBe(3);
    expect(frota.ativos).toBe(3);
  });

  it("soma componente a componente, e não subtotal a subtotal", () => {
    /*
      O caso que exige a distinção: um veículo sem amortização. Somar os
      subtotais de cada um daria o mesmo número aqui; o que muda é o subtotal
      **conclusivo** — a frota herda a inconclusividade de quem a compõe, e não
      a apaga somando só os conclusivos.
    */
    const comTudo = cavalo("A0A0A00", 1000, 400);
    const semAmortizacao = montarDRE({
      escopo: "CAVALO",
      ...VIGENCIA,
      lados: [lado("CAVALO", "B0B0B00", { "cavalo.finame_cavalo": 2000 })],
    });

    const frota = consolidar([comTudo, semAmortizacao], "CAVALO", VIGENCIA);
    expect(frota.subtotais.find((s) => s.id === "RECEITA_BRUTA")!.valorParcial).toBe(3000);
    expect(
      frota.secoes.flatMap((s) => s.linhas).find((l) => l.code === "financeiro.amortizacao")!.valor,
    ).toBe(400);
  });

  it("nunca fecha um subtotal que os veículos não fecham", () => {
    const frota = consolidar([cavalo("A0A0A00", 1000, 400)], "CAVALO", VIGENCIA);
    for (const id of ["MARGEM_CONTRIBUICAO", "EBITDA", "RESULTADO_ECONOMICO"] as const) {
      expect(frota.subtotais.find((s) => s.id === id)!.conclusivo).toBe(false);
    }
  });
});

describe("distribuição", () => {
  it("separa positivos, negativos e sem apuração", () => {
    const positivo = cavalo("POS0I00", 1000, 400);
    const negativo = cavalo("NEG0A00", 1000, 1500);
    const semReceita = montarDRE({ escopo: "CAVALO", ...VIGENCIA, lados: [lado("CAVALO", "SEM0R00", {})] });

    const frota = consolidar([positivo, negativo, semReceita], "CAVALO", VIGENCIA);
    expect(frota.distribuicao.positivas).toBe(1);
    expect(frota.distribuicao.negativas).toBe(1);
    expect(frota.distribuicao.semResultado).toBe(1);
    expect(frota.estado).not.toBe("COMPLETA");
  });
});

// ---------------------------------------------------------------------------

function linhaDoRanking(over: Partial<LinhaDoRanking> = {}): LinhaDoRanking {
  return {
    id: "x",
    rotulo: "XXX0X00",
    escopo: "CAVALO",
    entityIds: ["x"],
    orfa: false,
    receita: 1000,
    resultado: 100,
    margemPercentual: 10,
    custo: 900,
    cobertura: 40,
    estado: "PARCIALMENTE_APURADA",
    variacaoResultado: null,
    variacaoResultadoPercentual: null,
    variacaoReceita: null,
    ...over,
  };
}

describe("ranking", () => {
  it("ordena por cada critério e mantém o desconhecido no fim", () => {
    const linhas = [
      linhaDoRanking({ id: "a", rotulo: "AAA", resultado: 100 }),
      linhaDoRanking({ id: "b", rotulo: "BBB", resultado: -500 }),
      linhaDoRanking({ id: "c", rotulo: "CCC", resultado: null }),
    ];

    expect(ordenarRanking(linhas, "MAIOR_RESULTADO").map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(ordenarRanking(linhas, "MENOR_RESULTADO").map((l) => l.id)).toEqual(["b", "a", "c"]);
  });

  it("põe o pior primeiro na deterioração", () => {
    const linhas = [
      linhaDoRanking({ id: "a", variacaoResultado: 50 }),
      linhaDoRanking({ id: "b", variacaoResultado: -900 }),
    ];
    expect(ordenarRanking(linhas, "MAIOR_DETERIORACAO")[0].id).toBe("b");
    expect(ordenarRanking(linhas, "MAIOR_MELHORA")[0].id).toBe("a");
  });
});

describe("atenção", () => {
  it("acende por resultado negativo, com o número na frase", () => {
    const alertas = veiculosComAtencao([
      linhaDoRanking({ rotulo: "ABC1D23", resultado: -4320, margemPercentual: -43.2 }),
    ]);
    const negativo = alertas.find((a) => a.motivo === "RESULTADO_NEGATIVO")!;
    expect(negativo.severidade).toBe("CRITICO");
    expect(negativo.mensagem).toContain("4.320,00");
    expect(negativo.numeros.resultado).toBe(-4320);
  });

  it("acende por deterioração acima do limiar, e não abaixo", () => {
    const acima = veiculosComAtencao([
      linhaDoRanking({ variacaoResultado: -380, variacaoResultadoPercentual: -38 }),
    ]);
    const abaixo = veiculosComAtencao([
      linhaDoRanking({ variacaoResultado: -10, variacaoResultadoPercentual: -1 }),
    ]);
    expect(acima.some((a) => a.motivo === "RESULTADO_DETERIOROU")).toBe(true);
    expect(abaixo.some((a) => a.motivo === "RESULTADO_DETERIOROU")).toBe(false);
  });

  it("acende quando não há apuração nenhuma", () => {
    const alertas = veiculosComAtencao([
      linhaDoRanking({ receita: null, resultado: null, margemPercentual: null }),
    ]);
    expect(alertas.map((a) => a.motivo)).toContain("SEM_APURACAO");
  });

  it("não inventa alerta para um veículo saudável", () => {
    expect(veiculosComAtencao([linhaDoRanking()])).toEqual([]);
  });
});
