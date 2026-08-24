import { describe, expect, it } from "vitest";
import { rotuloDaCompetencia } from "../frotas";

/**
 * O rótulo da competência na lista de Frota.
 *
 * **Por que este teste existe.** A lista nasceu com `MES_LONGO[c.mes]` em vez
 * de `MES_LONGO[c.mes - 1]`, escrito inline no JSX. O mês vem 1-indexado do
 * banco (1 = janeiro) e o vetor é 0-indexado, então toda competência aparecia
 * com o mês seguinte — uma competência de julho lida como agosto na tela — e
 * dezembro caía fora do vetor, virando `undefined`. Nenhum teste pegava isso
 * porque não havia o que chamar: era texto dentro de JSX.
 *
 * O erro é silencioso por natureza — a tela continua carregando, a conferência
 * continua certa, só o rótulo mente —, e numa tela cuja função é dizer "a que
 * período pertence esta frota", o rótulo mentir é o bastante para conferir a
 * quinzena errada.
 */
describe("o rótulo da competência na lista de Frota", () => {
  it("usa o mês que a competência tem, e não o seguinte", () => {
    expect(rotuloDaCompetencia({ mes: 7, ano: 2026, quinzena: 2 })).toBe(
      "julho/2026, 2ª quinzena",
    );
  });

  it("janeiro é o primeiro do vetor, não o segundo", () => {
    expect(rotuloDaCompetencia({ mes: 1, ano: 2026, quinzena: 1 })).toBe(
      "janeiro/2026, 1ª quinzena",
    );
  });

  /*
    O caso que o off-by-one transformava em `undefined`: dezembro é o índice
    11, e `MES_LONGO[12]` não existe.
  */
  it("dezembro tem nome — é onde o índice trocado saía do vetor", () => {
    const rotulo = rotuloDaCompetencia({ mes: 12, ano: 2026, quinzena: 2 });
    expect(rotulo).toBe("dezembro/2026, 2ª quinzena");
    expect(rotulo).not.toContain("undefined");
  });

  it("todo mês do ano tem nome, e nenhum se repete", () => {
    const nomes = Array.from({ length: 12 }, (_, i) =>
      rotuloDaCompetencia({ mes: i + 1, ano: 2026, quinzena: 1 }).split("/")[0],
    );
    expect(nomes).not.toContain("undefined");
    expect(new Set(nomes).size).toBe(12);
  });
});
