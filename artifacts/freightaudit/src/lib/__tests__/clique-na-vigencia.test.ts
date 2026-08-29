import { describe, expect, it } from "vitest";
import { vigenciaDoClique } from "../clique-na-vigencia";

/**
 * O clique no gráfico — o que ele pede, e quando ele não pede nada.
 *
 * A tela inteira — no Dashboard os indicadores, o pódio, a tabela e a gaveta;
 * na Linha do Tempo o histórico e o detalhe do intervalo — passa a falar da
 * vigência clicada, então um clique lido errado não erra só o gráfico: leva
 * a tela toda para uma vigência que ninguém apontou. Daí o teste ser da
 * regra, e não do desenho de cada gráfico.
 */
describe("vigenciaDoClique", () => {
  const clique = (periodo: string) => ({ activePayload: [{ payload: { periodo } }] });

  it("pede a vigência do ponto que o tooltip estava mostrando", () => {
    expect(vigenciaDoClique(clique("2026-07-01"), "2026-08-01")).toBe("2026-07-01");
  });

  it("não pede nada no clique fora de qualquer ponto", () => {
    expect(vigenciaDoClique({}, "2026-08-01")).toBeNull();
    expect(vigenciaDoClique(null, "2026-08-01")).toBeNull();
    expect(vigenciaDoClique({ activePayload: [] }, "2026-08-01")).toBeNull();
  });

  it("não repete a vigência já aberta — nada a trocar, nada no histórico", () => {
    expect(vigenciaDoClique(clique("2026-08-01"), "2026-08-01")).toBeNull();
  });

  it("navega mesmo sem vigência acesa, como na Visão Geral sem competência", () => {
    expect(vigenciaDoClique(clique("2026-06-01"), null)).toBe("2026-06-01");
  });
});
