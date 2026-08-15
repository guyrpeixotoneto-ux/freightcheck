import { describe, expect, it } from "vitest";
import { montarDRE, linha } from "../motor";
import { normalizarParaCompetencia } from "../normalizacao";
import { lado } from "./fixtures";

/**
 * Periodicidade (§20, §31).
 *
 * O que estes testes protegem é uma frase: **o valor original nunca se perde.**
 * Um IPVA de R$ 12.000/ano aparece na DRE mensal como R$ 1.000, e a linha
 * continua sabendo dizer que a fonte entregou 12.000 por ano e que a divisão por
 * doze é uma projeção linear — não um fato.
 */

const VIGENCIA = { effectiveDate: "2026-08-01", periodLabel: "Agosto/2026" };

describe("normalizarParaCompetencia", () => {
  it("deixa mensal intacto e marca a conversão como exata", () => {
    const r = normalizarParaCompetencia(1234.56, "MENSAL");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toBe(1234.56);
    expect(r.transformacao.fator).toBe(1);
    expect(r.transformacao.natureza).toBe("EXATA");
    expect(r.transformacao.formula).toBeNull();
  });

  it("divide anual por doze e marca como projeção, guardando o original", () => {
    const r = normalizarParaCompetencia(12000, "ANUAL");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toBe(1000);
    expect(r.transformacao.valorOriginal).toBe(12000);
    expect(r.transformacao.periodicidadeOriginal).toBe("ANUAL");
    expect(r.transformacao.natureza).toBe("PROJECAO_LINEAR");
    expect(r.transformacao.formula).toBe("12.000,00 ÷ 12");
  });

  it("recusa pontual, e diz por quê", () => {
    const r = normalizarParaCompetencia(665929.99, "PONTUAL");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.codigo).toBe("PONTUAL_NAO_CONVERTE");
    expect(r.explicacao).toMatch(/rateio|recorrência/i);
  });

  it("recusa periodicidade não confirmada", () => {
    for (const p of [null, "", "SEMANAL"]) {
      const r = normalizarParaCompetencia(100, p);
      expect(r.ok, `${p} não deveria converter`).toBe(false);
    }
  });
});

describe("na DRE", () => {
  it("mensaliza o IPVA anual e guarda o rastro na linha", () => {
    const dre = montarDRE({
      escopo: "CAVALO",
      ...VIGENCIA,
      lados: [
        lado(
          "CAVALO",
          "ABC1D23",
          { "cavalo.finame_cavalo": 14000, "cavalo.ipva_licenciamento": 12000 },
          { "cavalo.ipva_licenciamento": { periodicity: "ANUAL" } },
        ),
      ],
    });

    const ipva = linha(dre, "fixo.ipva_licenciamento")!;
    expect(ipva.valor).toBe(1000);
    expect(ipva.natureza).toBe("CALCULADO");

    const origem = ipva.origens[0];
    expect(origem.valorNaFonte).toBe(12000);
    expect(origem.valorNaDRE).toBe(1000);
    expect(origem.periodicity).toBe("ANUAL");
    expect(origem.transformacao.natureza).toBe("PROJECAO_LINEAR");
  });

  it("nunca soma mensal com anual sem converter", () => {
    const dre = montarDRE({
      escopo: "CAVALO",
      ...VIGENCIA,
      lados: [
        lado(
          "CAVALO",
          "ABC1D23",
          {
            "cavalo.finame_cavalo": 14000,
            "cavalo.amortizacao_cavalo": 9000,
            "cavalo.ipva_licenciamento": 12000,
          },
          { "cavalo.ipva_licenciamento": { periodicity: "ANUAL" } },
        ),
      ],
    });

    /*
      A conta certa é 14.000 − 9.000 − 1.000 = 4.000. Somando o IPVA cru daria
      14.000 − 9.000 − 12.000 = −7.000, e a frota inteira apareceria no vermelho
      por causa de uma unidade de tempo.
    */
    const resultado = dre.subtotais.find((s) => s.id === "RESULTADO_ECONOMICO")!;
    expect(resultado.valorParcial).toBe(4000);
  });

  it("mantém fora da DRE de resultado o que é grandeza de aquisição", () => {
    /* valorNfCompra é PONTUAL e não é fonte de nenhum componente — mesmo que
       fosse, `normalizarParaCompetencia` o recusaria. Aqui a prova é a de que
       ele não aparece: o plano nunca o declarou como custo do período. */
    const dre = montarDRE({
      escopo: "CAVALO",
      ...VIGENCIA,
      lados: [
        lado(
          "CAVALO",
          "ABC1D23",
          { "cavalo.finame_cavalo": 14000, "cavalo.valor_nf_compra": 665929.99 },
          { "cavalo.valor_nf_compra": { periodicity: "PONTUAL" } },
        ),
      ],
    });

    const codigos = dre.secoes.flatMap((s) => s.linhas.flatMap((l) => l.origens.map((o) => o.attributeCode)));
    expect(codigos).not.toContain("cavalo.valor_nf_compra");
    expect(dre.subtotais.find((s) => s.id === "RECEITA_BRUTA")!.valor).toBe(14000);
  });
});
