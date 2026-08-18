import { describe, expect, it } from "vitest";
import { montarDRE, linha, subtotal } from "../motor";
import { componentesDoEscopo, PLANO_DA_DRE, TODOS_OS_ESCOPOS } from "../plano";
import { conjuntoDeReferencia } from "./fixtures";

/**
 * Escopo: cavalo, carreta, conjunto (§18, §31).
 *
 * O teste central é o da **soma que não pode fechar duas vezes**: a receita do
 * conjunto e a soma das receitas dos dois lados descrevem o mesmo dinheiro, e o
 * módulo tem de saber disso. Aqui os dois caminhos são calculados e conferidos
 * um contra o outro — se um refactor voltar a somar `custoFixo` na linha da
 * carreta, esta asserção quebra antes de a tela existir.
 *
 * **O que mudou em 18/08/2026.** Os dois caminhos eram declarados *iguais*, e
 * não são: a coluna `custoFixo` da fonte soma o lucro fixo do cavalo duas vezes
 * — uma dentro de `finame` (que contém `finameCavalo`) e outra dentro de
 * `lucroFixomodeloNovoCiclo`. Medido nos 51 pares em que o financiamento do
 * cavalo já acabou, zero exceções. A linha da carreta passou a somar só a
 * parcela própria dela, e a diferença virou o que ela sempre foi: um número com
 * nome, conferido abaixo em vez de escondido numa igualdade.
 */

const VIGENCIA = { effectiveDate: "2026-08-01", periodLabel: "Agosto/2026" };

function dres() {
  const { cavalo, carreta } = conjuntoDeReferencia();
  return {
    cavalo: montarDRE({ escopo: "CAVALO", ...VIGENCIA, lados: [cavalo] }),
    carreta: montarDRE({ escopo: "CARRETA", ...VIGENCIA, lados: [carreta] }),
    conjunto: montarDRE({ escopo: "CONJUNTO", ...VIGENCIA, lados: [cavalo, carreta] }),
  };
}

const receita = (d: ReturnType<typeof montarDRE>) =>
  subtotal(d, "RECEITA_BRUTA").valorParcial;
const resultado = (d: ReturnType<typeof montarDRE>) =>
  subtotal(d, "RESULTADO_ECONOMICO").valorParcial;

describe("as três leituras", () => {
  it("dá a cada escopo a sua própria receita", () => {
    const { cavalo, carreta, conjunto } = dres();
    expect(receita(cavalo)).toBe(14000);
    /* finameImplemento 2.500 + a parcela própria do lucro fixo 400. */
    expect(receita(carreta)).toBe(2900);
    /* custoFixo, a coluna do conjunto, como a fonte a entrega. */
    expect(receita(conjunto)).toBe(17000);
  });

  it("a receita do conjunto excede a soma dos lados pelo lucro fixo do cavalo", () => {
    const { cavalo, carreta, conjunto } = dres();
    /*
      14.000 + 2.900 = 16.900, contra 17.000 de `custoFixo`. Os 100 de diferença
      são o `lucroFixomodeloNovoCicloCavalo` do fixture — contado uma vez dentro
      de `finameCavalo`, que é a receita do cavalo, e outra dentro de
      `lucroFixomodeloNovoCiclo`, que é parcela de `custoFixo`.

      A diferença é da fonte, não do módulo, e por isso ela é **afirmada** aqui:
      um refactor que a fizesse desaparecer estaria escolhendo um dos dois
      números sem ter com que decidir. Qual deles a Ambev paga é pergunta para a
      Ambev — ver docs/MAPA-MONETARIO-CAVALO-CARRETA.md.
    */
    const soma = receita(cavalo)! + receita(carreta)!;
    expect(soma).toBe(16900);
    expect(receita(conjunto)! - soma).toBe(100);
  });

  it("o resultado do conjunto é a soma dos resultados dos dois lados", () => {
    const { cavalo, carreta, conjunto } = dres();
    /* −900 do cavalo (lucro 100 − IPVA 1.000) + 400 da carreta = −500. */
    expect(resultado(cavalo)).toBe(-900);
    expect(resultado(carreta)).toBe(400);
    /* E o conjunto fica 100 acima da soma, pela mesma razão da receita. */
    expect(resultado(conjunto)! - (resultado(cavalo)! + resultado(carreta)!)).toBe(100);
  });
});

describe("dupla contagem", () => {
  it("a carreta não recebe o que o conjunto recebe", () => {
    const { carreta } = dres();
    /* custoFixo vale 17.000 e contém o cavalo. Se ele vazasse para cá, a
       receita da carreta saltaria de 2.900 para 17.000 ou 19.900. */
    expect(receita(carreta)).toBe(2900);
    expect(linha(carreta, "receita.remuneracao_fixa")).toBeNull();
    const codigos = carreta.secoes.flatMap((s) =>
      s.linhas.flatMap((l) => l.origens.map((o) => o.attributeCode)),
    );
    expect(codigos).not.toContain("carreta.custo_fixo");
    expect(codigos).not.toContain("carreta.finame");
    // E nem a coluna do lucro fixo do conjunto, que carrega o cavalo junto.
    expect(codigos).not.toContain("carreta.lucro_fixomodelo_novo_ciclo");
  });

  it("o conjunto não soma a receita do par com a receita de cada lado", () => {
    const { conjunto } = dres();
    const receitas = conjunto.secoes.find((s) => s.id === "RECEITA_BRUTA")!.linhas.filter(
      (l) => l.valor !== null,
    );
    expect(receitas).toHaveLength(1);
    expect(receitas[0].code).toBe("receita.remuneracao_fixa");
  });

  it("a amortização do implemento não entra na DRE de um cavalo sozinho", () => {
    const { cavalo } = dres();
    const amortizacao = linha(cavalo, "financeiro.amortizacao")!;
    expect(amortizacao.valor).toBe(9000);
    expect(amortizacao.origens.map((o) => o.attributeCode)).toEqual([
      "cavalo.amortizacao_cavalo",
    ]);
  });

  it("nenhum atributo alimenta duas linhas do mesmo escopo", () => {
    for (const escopo of TODOS_OS_ESCOPOS) {
      const vistos = new Map<string, string>();
      for (const componente of componentesDoEscopo(escopo)) {
        for (const fonte of componente.fontes) {
          const anterior = vistos.get(fonte.attributeCode);
          expect(
            anterior,
            `${fonte.attributeCode} alimenta ${anterior} e ${componente.code} em ${escopo}`,
          ).toBeUndefined();
          vistos.set(fonte.attributeCode, componente.code);
        }
      }
    }
  });
});

describe("o plano por escopo", () => {
  it("declara `apareceEm` em todo componente, com escopos válidos", () => {
    for (const c of PLANO_DA_DRE) {
      expect(c.apareceEm.length, `${c.code} sem escopo`).toBeGreaterThan(0);
      for (const e of c.apareceEm) expect(TODOS_OS_ESCOPOS).toContain(e);
    }
  });

  it("mostra toda lacuna nas três leituras — a lacuna é a mesma nas três", () => {
    for (const c of PLANO_DA_DRE) {
      if (c.fontes.length > 0) continue;
      expect(c.apareceEm.slice().sort(), `${c.code}`).toEqual(TODOS_OS_ESCOPOS.slice().sort());
    }
  });
});
