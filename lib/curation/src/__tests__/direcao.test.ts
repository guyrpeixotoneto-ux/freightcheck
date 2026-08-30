import { describe, expect, it } from "vitest";
import { DIRECOES_ECONOMICAS, direcaoDe } from "../direcao";

/**
 * O vocabulário da direção econômica, e a regressão que ele existe para impedir.
 *
 * A tela passou a oferecer as quatro frases que quem cura usa — "maior é
 * melhor", "maior é pior", "menor é melhor", "menor é pior" —, e a tentação
 * óbvia é guardá-las como quatro códigos. Seria um defeito silencioso: quem lê
 * a coluna (`sinal()` no Radar de Trechos, `ehAlteracaoMaterial` na comparação)
 * conhece `HIGHER_IS_BETTER` e `HIGHER_IS_WORSE` e trata todo o resto como
 * neutro, então um `LOWER_IS_BETTER` novo entraria no radar como alteração
 * imaterial — exatamente o que o campo existe para evitar.
 *
 * Estes testes não pedem banco de propósito: a lista é pura, e é ela que a tela
 * do navegador importa.
 */
describe("o vocabulário da direção econômica", () => {
  it("tem quatro códigos, e nenhum deles é um LOWER_IS_*", () => {
    expect(DIRECOES_ECONOMICAS.map((d) => d.direcao)).toEqual([
      "HIGHER_IS_BETTER",
      "HIGHER_IS_WORSE",
      "NEUTRAL",
      "DEPENDS_ON_FORMULA",
    ]);
  });

  it("as duas direções econômicas carregam as duas frases da mesma afirmação", () => {
    const porCodigo = new Map(DIRECOES_ECONOMICAS.map((d) => [d.direcao, d]));
    expect(porCodigo.get("HIGHER_IS_BETTER")?.rotulo).toBe("Maior é melhor");
    expect(porCodigo.get("HIGHER_IS_BETTER")?.inverso).toBe("menor é pior");
    expect(porCodigo.get("HIGHER_IS_WORSE")?.rotulo).toBe("Maior é pior");
    expect(porCodigo.get("HIGHER_IS_WORSE")?.inverso).toBe("menor é melhor");
  });

  it("cadastro e “depende da fórmula” não têm inverso — não são afirmação sobre subir", () => {
    const porCodigo = new Map(DIRECOES_ECONOMICAS.map((d) => [d.direcao, d]));
    expect(porCodigo.get("NEUTRAL")?.inverso).toBeNull();
    expect(porCodigo.get("DEPENDS_ON_FORMULA")?.inverso).toBeNull();
  });

  it("toda opção tem rótulo e ajuda — a tela não mostra código", () => {
    for (const opcao of DIRECOES_ECONOMICAS) {
      expect(opcao.rotulo.trim()).not.toBe("");
      expect(opcao.ajuda.trim()).not.toBe("");
    }
  });

  it("uma direção nula é ausência de curadoria, e não NEUTRAL", () => {
    expect(direcaoDe(null)).toBeNull();
    expect(direcaoDe(undefined)).toBeNull();
    expect(direcaoDe("")).toBeNull();
    expect(direcaoDe("NEUTRAL")?.rotulo).toBe("Neutro");
  });

  it("um código que a tela não conhece devolve null em vez de inventar rótulo", () => {
    expect(direcaoDe("LOWER_IS_BETTER")).toBeNull();
  });
});
