import { describe, expect, it } from "vitest";
import { estaDescrito } from "../curadoria";

/**
 * O verde da fila de curadoria promete uma coisa só: **os três campos do card
 * "Significado" estão escritos.**
 *
 * O que se guarda aqui é o "os três". Cair para dois — porque a fórmula de
 * cálculo chega `null` em atributo sem semântica versionada, que é a maioria da
 * fila — acenderia verde em coluna que ninguém terminou de descrever, e a fila
 * passaria a mentir sobre o próprio progresso justamente onde ela é usada para
 * decidir o que fazer em seguida.
 */

const descrito = {
  displayName: "Consumo de Combustível",
  definition: "Eficiência considerada para o cavalo, em km/L.",
  calculationBasis: "Litros = Quilometragem ÷ Consumo (km/L)",
};

describe("estaDescrito", () => {
  it("acende com os três campos escritos", () => {
    expect(estaDescrito(descrito)).toBe(true);
  });

  it.each(["displayName", "definition", "calculationBasis"] as const)(
    "não acende sem %s",
    (campo) => {
      expect(estaDescrito({ ...descrito, [campo]: null })).toBe(false);
      expect(estaDescrito({ ...descrito, [campo]: "" })).toBe(false);
    },
  );

  it("não conta espaço em branco como texto escrito", () => {
    expect(estaDescrito({ ...descrito, definition: "   \n " })).toBe(false);
  });

  it("não acende no atributo intocado, que é o estado inicial da fila", () => {
    expect(
      estaDescrito({
        displayName: null,
        definition: null,
        calculationBasis: null,
      }),
    ).toBe(false);
  });
});
