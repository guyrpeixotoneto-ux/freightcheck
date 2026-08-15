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
    expect(receita(carreta)).toBe(3000);
    expect(receita(conjunto)).toBe(17000);
  });

  it("a receita do conjunto é a soma dos dois lados — e é lida de uma coluna só", () => {
    const { cavalo, carreta, conjunto } = dres();
    /*
      14.000 + 3.000 = 17.000. A igualdade não é uma coincidência do fixture: é
      a identidade medida em 558 de 558 pares reais
      (finameImplemento + lucroFixo) + finameCavalo = custoFixo.
      O conjunto lê `custoFixo` direto, e não a soma — mas as duas contas têm de
      dar o mesmo, e é isso que esta linha confere.
    */
    expect(receita(conjunto)).toBe(receita(cavalo)! + receita(carreta)!);
  });

  it("o resultado do conjunto é a soma dos resultados dos dois lados", () => {
    const { cavalo, carreta, conjunto } = dres();
    /* −900 do cavalo (lucro 100 − IPVA 1.000) + 500 da carreta = −400. */
    expect(resultado(cavalo)).toBe(-900);
    expect(resultado(carreta)).toBe(500);
    expect(resultado(conjunto)).toBe(-400);
    expect(resultado(conjunto)).toBe(resultado(cavalo)! + resultado(carreta)!);
  });
});

describe("dupla contagem", () => {
  it("a carreta não recebe o que o conjunto recebe", () => {
    const { carreta } = dres();
    /* custoFixo vale 17.000 e contém o cavalo. Se ele vazasse para cá, a
       receita da carreta saltaria de 3.000 para 17.000 ou 20.000. */
    expect(receita(carreta)).toBe(3000);
    expect(linha(carreta, "receita.remuneracao_fixa")).toBeNull();
    const codigos = carreta.secoes.flatMap((s) =>
      s.linhas.flatMap((l) => l.origens.map((o) => o.attributeCode)),
    );
    expect(codigos).not.toContain("carreta.custo_fixo");
    expect(codigos).not.toContain("carreta.finame");
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
