import { describe, expect, it } from "vitest";
import { segmentar } from "../segmentos";

/**
 * O que estes testes protegem: a moldura nunca vira lixo na tela.
 *
 * As formas novas — cartões lado a lado, abas por iniciativa — chegam como
 * texto, escritas pelo modelo enquanto ele escreve. Isso significa que a tela
 * vê a cerca aberta antes de ver a cerca fechada, e que um modelo pode errar a
 * sintaxe. Nos dois casos o pior resultado aceitável é perder a moldura; o
 * inaceitável é a pessoa que perguntou como funciona o preço do combustível ler
 * `:::cards` no meio da resposta.
 */

describe("segmentação das formas", () => {
  it("separa a cerca do texto em volta, na ordem", () => {
    const segmentos = segmentar(
      ["Abertura da resposta.", "", ":::cards", "### Temos", "- consumo", ":::", "", "Fecho."].join("\n"),
    );

    expect(segmentos.map((s) => s.tipo)).toEqual(["texto", "cerca", "texto"]);
    expect(segmentos[0].corpo).toBe("Abertura da resposta.");
    expect(segmentos[1]).toMatchObject({ nome: "cards", corpo: "### Temos\n- consumo" });
    expect(segmentos[2].corpo).toBe("Fecho.");
  });

  /*
    A linha em branco dentro da cerca é o caso que quebra a abordagem ingênua:
    quebrar o texto por parágrafo antes de procurar a cerca parte o bloco no
    meio e deixa o marcador órfão.
  */
  it("a cerca sobrevive a linhas em branco dentro dela", () => {
    const segmentos = segmentar(":::cards\n### Temos\n- a\n\n### Falta\n- b\n:::");
    expect(segmentos).toHaveLength(1);
    expect(segmentos[0].corpo).toContain("### Falta");
  });

  it("cerca ainda aberta é entregue montada — o texto chega em fluxo", () => {
    const segmentos = segmentar(":::abas\n### Tradicional\nvale o menor dos dois");
    expect(segmentos[0]).toMatchObject({ tipo: "cerca", nome: "abas" });
    expect(segmentos[0].corpo).toContain("Tradicional");
  });

  it("não confunde `:::` no meio de uma frase com abertura de cerca", () => {
    const segmentos = segmentar("O separador ::: aparece aqui no meio da linha.");
    expect(segmentos).toEqual([
      { tipo: "texto", corpo: "O separador ::: aparece aqui no meio da linha." },
    ]);
  });

  it("texto sem cerca nenhuma volta inteiro, num segmento só", () => {
    const segmentos = segmentar("Uma resposta curta.\n\nCom dois parágrafos.");
    expect(segmentos).toHaveLength(1);
    expect(segmentos[0].tipo).toBe("texto");
  });
});
