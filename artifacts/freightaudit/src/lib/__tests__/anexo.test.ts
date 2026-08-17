import { describe, expect, it } from "vitest";
import { nomeDoAnexo } from "../api";

/**
 * O nome do arquivo que o servidor mandou, lido do `Content-Disposition`.
 *
 * O cabeçalho vem em duas formas ao mesmo tempo — a reserva ASCII e o
 * `filename*` da RFC 5987 — porque só a segunda carrega acento. Ler a errada não
 * quebra nada visível: o arquivo baixa, com um nome onde "CAMAÇARI" virou
 * "CAMA_ARI". É o tipo de defeito que ninguém abre um bug para relatar e que
 * ninguém consegue explicar depois, e é por isso que ele tem teste.
 */
describe("nomeDoAnexo", () => {
  it("prefere o nome com acento à reserva ASCII", () => {
    const cabecalho =
      'attachment; filename="Impacto - CAMA_ARI.xlsx"; ' +
      "filename*=UTF-8''Impacto%20-%20CAMA%C3%87ARI.xlsx";
    expect(nomeDoAnexo(cabecalho)).toBe("Impacto - CAMAÇARI.xlsx");
  });

  it("lê a reserva quando o servidor só mandou ela", () => {
    expect(nomeDoAnexo('attachment; filename="impacto.xlsx"')).toBe("impacto.xlsx");
  });

  it("lê o nome sem aspas, que é forma válida do cabeçalho", () => {
    expect(nomeDoAnexo("attachment; filename=impacto.xlsx")).toBe("impacto.xlsx");
  });

  it("cai na reserva quando o percent-encoding do servidor está quebrado", () => {
    // `%C3%8` está truncado — `decodeURIComponent` estoura, e um nome de arquivo
    // não é motivo para derrubar um download que chegou inteiro.
    const cabecalho =
      'attachment; filename="impacto.xlsx"; filename*=UTF-8\'\'impacto%C3%8.xlsx';
    expect(nomeDoAnexo(cabecalho)).toBe("impacto.xlsx");
  });

  it("devolve null quando não há cabeçalho ou não há nome nele", () => {
    expect(nomeDoAnexo(null)).toBeNull();
    expect(nomeDoAnexo("attachment")).toBeNull();
    expect(nomeDoAnexo('attachment; filename=""')).toBeNull();
  });
});
