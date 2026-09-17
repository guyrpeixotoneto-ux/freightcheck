/**
 * OS TRÊS UNIVERSOS — provados separadamente, e provados incompletos.
 *
 * ---------------------------------------------------------------------------
 * O defeito que este arquivo existe para impedir
 * ---------------------------------------------------------------------------
 * A aritmética do confronto sempre esteve certa. O que estava errado era a
 * leitura: em setembro/2026, recorte Cavalo, `−R$ 87.393,05` — o saldo de 17
 * veículos conciliados — foi apresentado como o déficit de FINAME do mês. O mês
 * tem 64 veículos remunerados; os outros 47 levam R$ 630.919,82 sem nenhum
 * lançamento no razão, e 32 deles estão declarados FINANCIADO.
 *
 * Nenhum teste de soma pegaria isso, porque não havia soma errada. Os testes
 * abaixo afirmam a **outra** coisa: que os universos existem separados, que o
 * saldo carrega o escopo dele, e que nenhuma combinação dos três produz um
 * "total do mês" — nem por acidente, nem por alguém decidir somá-los depois.
 *
 * O cenário é o de setembro/2026, reduzido ao que importa e com os números
 * reais: eles conferem contra a planilha, e é isso que faz este arquivo valer
 * mais do que um fixture bonito.
 *
 * Ver `docs/DEFINICOES-DO-CONFRONTO-DE-FINAME.md`.
 */

import { describe, expect, it } from "vitest";
import { somarCentavos } from "@workspace/ingest/dinheiro";
import type { RemuneradoDaCompetencia } from "../competencia-de-finame";
import type { ValorRealizado } from "../realizado-de-finame";
import {
  confrontar,
  situacaoDoFinanciamentoDe,
  type EvidenciaDoRemunerado,
} from "../confronto-de-finame";

const COMPETENCIA = "2026-09";

function remunerado(
  entityLabel: string,
  valor: number | null,
  situacao: RemuneradoDaCompetencia["situacao"] = "CONSOLIDADO",
): RemuneradoDaCompetencia {
  return {
    competencia: COMPETENCIA,
    entityLabel,
    entityType: "CAVALO",
    valor,
    situacao,
    vigencias: ["2026-09-01"],
    valoresDivergentes: [],
  };
}

function realizado(entityLabel: string, valor: number): ValorRealizado {
  return {
    competencia: COMPETENCIA,
    entityLabel,
    entityType: "CAVALO",
    valor,
    bruto: -valor,
  };
}

function evidencia(
  entityLabel: string,
  statusDeclarado: string | null,
  partes: { amortizacao?: number; juros?: number; terceiraParcela?: number } = {},
): EvidenciaDoRemunerado {
  return {
    entityLabel,
    entityType: "CAVALO",
    situacaoDoFinanciamento: situacaoDoFinanciamentoDe(statusDeclarado),
    statusDeclarado,
    amortizacao: partes.amortizacao ?? null,
    juros: partes.juros ?? null,
    terceiraParcela: partes.terceiraParcela ?? null,
  };
}

/**
 * Setembro/2026 em miniatura, com números reais.
 *
 * Três conciliados (um déficit grande, um déficit pequeno, uma sobra), três sem
 * realizado (dois financiados, um quitado), uma recusada pela consolidação e
 * uma que só o realizado tem. Cobre os quatro estados de cobertura e as três
 * situações de financiamento sem virar uma planilha inteira.
 */
function cenarioDeSetembro() {
  return confrontar({
    competencia: COMPETENCIA,
    remunerado: [
      remunerado("RPG0C44", 16769.83),
      remunerado("RPH1H43", 15905.65),
      remunerado("RZG5A37", 13873.44),
      remunerado("RPG1I89", 17227.35),
      remunerado("RPG2I13", 17227.35),
      remunerado("QYP3G72", 4677.85),
      remunerado("DIVERG01", null, "DIVERGENCIA_INTRAMENSAL"),
    ],
    realizado: [
      realizado("RPG0C44", 25085.47),
      realizado("RPH1H43", 21803.02),
      realizado("RZG5A37", 4147.88),
      realizado("SOREAL9", 9999.99),
    ],
    evidenciaDoRemunerado: [
      evidencia("RPG0C44", "Descrição: FINANCIADO"),
      evidencia("RPH1H43", "Descrição: FINANCIADO"),
      evidencia("RZG5A37", "Descrição: FINANCIADO"),
      evidencia("RPG1I89", "Descrição: FINANCIADO"),
      evidencia("RPG2I13", "Descrição: FINAME"),
      evidencia("QYP3G72", "Descrição: QUITADO"),
      evidencia("DIVERG01", null),
    ],
  });
}

describe("universo 1 — conciliados", () => {
  it("conta e soma **só** as placas com os dois lados, e nada mais", () => {
    const { resumo } = cenarioDeSetembro();

    expect(resumo.veiculosConciliados).toBe(3);
    expect(resumo.totalRemunerado).toBe(somarCentavos([16769.83, 15905.65, 13873.44]));
    expect(resumo.totalRealizado).toBe(somarCentavos([25085.47, 21803.02, 4147.88]));
    expect(resumo.saldoDosConciliados).toBe(-4487.45);
    expect(resumo.veiculosComDeficit).toBe(2);
    expect(resumo.veiculosComSobra).toBe(1);
  });

  it("fecha a identidade na própria tela: saldo = remunerado − realizado", () => {
    const { resumo } = cenarioDeSetembro();
    expect(resumo.saldoDosConciliados).toBe(
      Number((resumo.totalRemunerado - resumo.totalRealizado).toFixed(2)),
    );
  });

  it("nenhuma placa fora do universo 1 entra em nenhum dos três números", () => {
    const comTodos = cenarioDeSetembro();
    /* O mesmo cenário sem as placas que não conciliam: os três números não se
       movem um centavo. É isto que "só conciliados entram" quer dizer. */
    const soConciliados = confrontar({
      competencia: COMPETENCIA,
      remunerado: [
        remunerado("RPG0C44", 16769.83),
        remunerado("RPH1H43", 15905.65),
        remunerado("RZG5A37", 13873.44),
      ],
      realizado: [
        realizado("RPG0C44", 25085.47),
        realizado("RPH1H43", 21803.02),
        realizado("RZG5A37", 4147.88),
      ],
    });

    expect(soConciliados.resumo.totalRemunerado).toBe(comTodos.resumo.totalRemunerado);
    expect(soConciliados.resumo.totalRealizado).toBe(comTodos.resumo.totalRealizado);
    expect(soConciliados.resumo.saldoDosConciliados).toBe(comTodos.resumo.saldoDosConciliados);
  });
});

describe("universo 2 — sem realizado", () => {
  it("é contado e somado à parte, e nunca dentro dos totais do universo 1", () => {
    const { resumo } = cenarioDeSetembro();

    expect(resumo.semRealizado.veiculos).toBe(3);
    expect(resumo.semRealizado.remunerado).toBe(somarCentavos([17227.35, 17227.35, 4677.85]));
    /* A prova de que os dois universos não se tocam. */
    expect(resumo.totalRemunerado).not.toBe(
      somarCentavos([resumo.totalRemunerado, resumo.semRealizado.remunerado]),
    );
  });

  it("separa o financiado do quitado — que é o que transforma ausência em achado", () => {
    const { resumo } = cenarioDeSetembro();

    expect(resumo.semRealizado.financiados).toBe(2);
    expect(resumo.semRealizado.remuneradoFinanciado).toBe(somarCentavos([17227.35, 17227.35]));
    expect(resumo.semRealizado.quitados).toBe(1);
    expect(resumo.semRealizado.indefinidos).toBe(0);
    /* As três partições somam o universo inteiro: ninguém cai fora da conta. */
    expect(
      resumo.semRealizado.financiados +
        resumo.semRealizado.quitados +
        resumo.semRealizado.indefinidos,
    ).toBe(resumo.semRealizado.veiculos);
  });

  it("sem evidência, sai INDEFINIDO — e nunca FINANCIADO por omissão", () => {
    const { resumo, linhas } = confrontar({
      competencia: COMPETENCIA,
      remunerado: [remunerado("SEMEVID1", 1000)],
      realizado: [],
    });

    expect(resumo.semRealizado.veiculos).toBe(1);
    expect(resumo.semRealizado.financiados).toBe(0);
    expect(resumo.semRealizado.remuneradoFinanciado).toBe(0);
    expect(resumo.semRealizado.indefinidos).toBe(1);
    expect(linhas[0].situacaoDoFinanciamento).toBe("INDEFINIDO");
  });

  it("carrega a situação na linha, para a tela poder listar quais são", () => {
    const { linhas } = cenarioDeSetembro();
    const financiadosSemReal = linhas.filter(
      (l) => l.cobertura === "SEM_REALIZADO" && l.situacaoDoFinanciamento === "FINANCIADO",
    );
    expect(financiadosSemReal.map((l) => l.entityLabel).sort()).toEqual(["RPG1I89", "RPG2I13"]);
    expect(financiadosSemReal[0].statusDeclarado).toBe("Descrição: FINANCIADO");
  });
});

describe("a cobertura — o escopo que viaja com o saldo", () => {
  it("o denominador são os veículos remunerados, não as linhas da tabela", () => {
    const c = cenarioDeSetembro();
    /* 7 remunerados; a tabela tem 8 linhas, porque SOREAL9 só existe no razão. */
    expect(c.resumo.veiculosRemunerados).toBe(7);
    expect(c.resumo.cobertura.total).toBe(8);
    expect(c.linhas).toHaveLength(8);
    expect(c.resumo.cobertura.fracaoDosRemunerados).toBeCloseTo(3 / 7, 10);
  });

  it("conta o remunerado que a consolidação recusou — ele é um veículo não medido", () => {
    const { resumo } = cenarioDeSetembro();
    /* DIVERG01 não concilia e mesmo assim é um cavalo remunerado do mês. Deixá-lo
       fora do denominador inflaria a cobertura para 3 de 6. */
    expect(resumo.veiculosRemunerados).toBe(7);
    expect(resumo.cobertura.naoConciliados).toBe(1);
  });

  it("sem remunerados a fração é null — e não zero por cento nem cem", () => {
    const { resumo } = confrontar({
      competencia: COMPETENCIA,
      remunerado: [],
      realizado: [realizado("SOREAL9", 100)],
    });
    expect(resumo.veiculosRemunerados).toBe(0);
    expect(resumo.cobertura.fracaoDosRemunerados).toBeNull();
  });
});

describe("o saldo conciliado não é o saldo do mês", () => {
  it("cobre uma fração do remunerado, e o resumo tem como dizer qual", () => {
    const { resumo } = cenarioDeSetembro();

    const remuneradoDoMes = somarCentavos([
      resumo.totalRemunerado,
      resumo.semRealizado.remunerado,
    ]);
    /*
      O número que a tela precisa poder mostrar: quanto do dinheiro remunerado o
      saldo alcança. Aqui são 46,9%; em setembro/2026 real, 30%.
    */
    expect(resumo.totalRemunerado).toBeLessThan(remuneradoDoMes);
    expect(resumo.veiculosConciliados).toBeLessThan(resumo.veiculosRemunerados);
  });

  it("um mês com muita ausência não move o saldo — e move muito a cobertura", () => {
    /*
      A armadilha, isolada. Dois cenários com **o mesmo** saldo conciliado e
      coberturas opostas: se a tela mostrasse só o saldo, os dois seriam a mesma
      tela. É por isso que a cobertura acompanha o número em toda renderização,
      e não só quando há o que avisar.
    */
    const conciliadoSozinho = confrontar({
      competencia: COMPETENCIA,
      remunerado: [remunerado("RPG0C44", 16769.83)],
      realizado: [realizado("RPG0C44", 25085.47)],
    });
    const mesmoSaldoComQuarentaAusentes = confrontar({
      competencia: COMPETENCIA,
      remunerado: [
        remunerado("RPG0C44", 16769.83),
        ...Array.from({ length: 40 }, (_, i) => remunerado(`AUSENTE${i}`, 16769.83)),
      ],
      realizado: [realizado("RPG0C44", 25085.47)],
    });

    expect(mesmoSaldoComQuarentaAusentes.resumo.saldoDosConciliados).toBe(
      conciliadoSozinho.resumo.saldoDosConciliados,
    );
    expect(conciliadoSozinho.resumo.cobertura.fracaoDosRemunerados).toBe(1);
    expect(mesmoSaldoComQuarentaAusentes.resumo.cobertura.fracaoDosRemunerados).toBeCloseTo(
      1 / 41,
      10,
    );
    /* E o dinheiro que ficou de fora é publicado, para que a diferença entre os
       dois cenários seja legível em reais e não só em contagem. */
    expect(mesmoSaldoComQuarentaAusentes.resumo.semRealizado.remunerado).toBe(
      somarCentavos(Array.from({ length: 40 }, () => 16769.83)),
    );
  });

  it("o resumo não publica nenhum campo que pareça um total do mês", () => {
    const { resumo } = cenarioDeSetembro();
    /*
      A guarda de nome. `resultadoLiquido` era o campo que a tela mostrava como
      resultado do mês; ele não existe mais, e nenhum outro campo do resumo
      oferece um total que misture os universos. Se alguém reintroduzir um, este
      teste é onde a discussão acontece — antes de a tela publicar o número.
    */
    const camposDeDinheiro = Object.entries(resumo)
      .filter(([, v]) => typeof v === "number")
      .map(([k]) => k);
    expect(camposDeDinheiro).not.toContain("resultadoLiquido");
    expect(camposDeDinheiro).not.toContain("totalDoMes");
    expect(camposDeDinheiro).not.toContain("remuneradoDoMes");
    expect(resumo).toHaveProperty("saldoDosConciliados");
    expect(resumo).toHaveProperty("veiculosRemunerados");
  });
});
