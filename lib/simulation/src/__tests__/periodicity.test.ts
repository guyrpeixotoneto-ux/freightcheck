import { describe, expect, it } from "vitest";
import { convertPeriodicity, MESES_NO_ANO, type Periodicity } from "../periodicity";

const TODAS: Periodicity[] = ["MENSAL", "ANUAL", "PONTUAL"];

/**
 * A tabela de conversão, exercida célula a célula.
 *
 * O teste percorre as nove combinações e afirma o desfecho de cada uma, em vez
 * de testar só os casos felizes. Uma conversão que passasse a ser permitida por
 * descuido quebraria aqui, que é o ponto: neste domínio, o que **não** se
 * converte importa tanto quanto o que se converte.
 */
describe("a tabela de conversão, inteira", () => {
  const esperado: Record<string, "exata" | "projecao" | "recusa"> = {
    "MENSAL→MENSAL": "exata",
    "MENSAL→ANUAL": "projecao",
    "MENSAL→PONTUAL": "recusa",
    "ANUAL→MENSAL": "projecao",
    "ANUAL→ANUAL": "exata",
    "ANUAL→PONTUAL": "recusa",
    "PONTUAL→MENSAL": "recusa",
    "PONTUAL→ANUAL": "recusa",
    "PONTUAL→PONTUAL": "exata",
  };

  for (const from of TODAS) {
    for (const to of TODAS) {
      const chave = `${from}→${to}`;
      it(`${chave} é ${esperado[chave]}`, () => {
        const resultado = convertPeriodicity(from, to);
        switch (esperado[chave]) {
          case "exata":
            expect(resultado.allowed).toBe(true);
            if (!resultado.allowed) return;
            expect(resultado.factor).toBe(1);
            expect(resultado.nature).toBe("EXATA");
            break;
          case "projecao":
            expect(resultado.allowed).toBe(true);
            if (!resultado.allowed) return;
            expect(resultado.nature).toBe("PROJECAO_LINEAR");
            break;
          case "recusa":
            expect(resultado.allowed).toBe(false);
            if (resultado.allowed) return;
            expect(resultado.code).toBe("PONTUAL_NAO_CONVERTE");
            break;
        }
      });
    }
  }

  it("conta exatamente nove células, para a tabela não encolher sem se notar", () => {
    expect(Object.keys(esperado)).toHaveLength(TODAS.length * TODAS.length);
  });
});

describe("qual fator foi aplicado", () => {
  it("mensal para anual multiplica por doze", () => {
    const r = convertPeriodicity("MENSAL", "ANUAL");
    expect(r.allowed && r.factor).toBe(MESES_NO_ANO);
  });

  it("anual para mensal divide por doze", () => {
    const r = convertPeriodicity("ANUAL", "MENSAL");
    expect(r.allowed && r.factor).toBe(1 / MESES_NO_ANO);
  });

  it("ida e volta devolve o valor original", () => {
    const ida = convertPeriodicity("MENSAL", "ANUAL");
    const volta = convertPeriodicity("ANUAL", "MENSAL");
    if (!ida.allowed || !volta.allowed) throw new Error("deveriam ser permitidas");
    expect(1000 * ida.factor * volta.factor).toBeCloseTo(1000, 10);
  });
});

describe("o resultado se declara projeção quando é premissa", () => {
  it("mensal↔anual sempre sai como projeção linear, nunca como custo apurado", () => {
    for (const [from, to] of [
      ["MENSAL", "ANUAL"],
      ["ANUAL", "MENSAL"],
    ] as const) {
      const r = convertPeriodicity(from, to);
      expect(r.allowed && r.nature).toBe("PROJECAO_LINEAR");
      expect(r.explanation).toMatch(/projeção linear/i);
      // A explicação precisa negar que seja custo apurado, não apenas evitar a
      // palavra: é o que a tela vai mostrar ao lado do número.
      expect(r.explanation).toMatch(/não\s+custo apurado/i);
    }
  });

  it("a conversão de identidade não se declara projeção", () => {
    for (const p of TODAS) {
      const r = convertPeriodicity(p, p);
      expect(r.allowed && r.nature).toBe("EXATA");
    }
  });
});

describe("pontual nunca é mensalizado nem anualizado", () => {
  it("recusa nas quatro direções que envolvem pontual e recorrente", () => {
    const pares = [
      ["PONTUAL", "MENSAL"],
      ["PONTUAL", "ANUAL"],
      ["MENSAL", "PONTUAL"],
      ["ANUAL", "PONTUAL"],
    ] as const;

    for (const [from, to] of pares) {
      const r = convertPeriodicity(from, to);
      expect(r.allowed).toBe(false);
      if (r.allowed) continue;
      expect(r.code).toBe("PONTUAL_NAO_CONVERTE");
    }
  });

  it("a recusa não devolve fator nenhum, nem zero", () => {
    const r = convertPeriodicity("PONTUAL", "ANUAL");
    expect(r).not.toHaveProperty("factor");
  });

  it("a recusa explica que rateio e recorrência seriam invenção nossa", () => {
    const r = convertPeriodicity("PONTUAL", "MENSAL");
    expect(r.explanation).toMatch(/rateio/i);
    expect(r.explanation).toMatch(/nunca declarou/i);
  });
});
