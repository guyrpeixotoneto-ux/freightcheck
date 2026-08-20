import { describe, expect, it } from "vitest";

import { levantarInconsistencias, type QuadroParaLevantar } from "../inconsistencias";

/**
 * O levantamento das inconsistências, sobre um painel montado à mão.
 *
 * As linhas usadas são as da Rota, com os números de julho/2026 onde eles
 * dizem alguma coisa — o frete mínimo que a planilha lança em duas linhas
 * diferentes nas duas quinzenas, e as vans inativas, que o 03.08.20 não
 * nomeia. As duas divergências são reais e estão registradas em
 * `docs/MAPA-ROTA.md`.
 */
const linha = (p: Partial<QuadroParaLevantar["linhas"][number]>) => ({
  chave: "linha",
  rotulo: "LINHA",
  papel: "PARCELA",
  devido: { primeira: null, segunda: null },
  demonstrado: { primeira: null, segunda: null },
  falta: null,
  ...p,
});

const quadro = (linhas: QuadroParaLevantar["linhas"]): QuadroParaLevantar[] => [
  { quadro: "REMUNERACAO", titulo: "Remuneração", linhas },
];

describe("levantarInconsistencias", () => {
  it("cala quando as duas leituras concordam", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([
        linha({
          devido: { primeira: 731502.84, segunda: 739274.0 },
          demonstrado: { primeira: 731502.84, segunda: 739274.0 },
        }),
      ]),
    );
    expect(achados).toEqual([]);
  });

  it("um centavo de arredondamento não é achado", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([
        linha({
          devido: { primeira: 42745.64, segunda: null },
          demonstrado: { primeira: 42745.641, segunda: null },
        }),
      ]),
    );
    expect(achados).toEqual([]);
  });

  it("nomeia a quinzena, e só ela, quando só uma discorda", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([
        linha({
          chave: "desconto_complementar_negativo",
          rotulo: "DESCONTO COMPLEMENTAR NEGATIVO",
          papel: "DESCONTO",
          devido: { primeira: 11649.87, segunda: 14050.54 },
          demonstrado: { primeira: 0, segunda: 14050.54 },
        }),
      ]),
    );

    expect(achados).toHaveLength(1);
    expect(achados[0]).toMatchObject({
      chave: "desconto_complementar_negativo:1",
      quinzena: 1,
      tipo: "FONTES_DISCORDAM",
      valor: 11649.87,
      entre: ["o contrato (cadastro e diário)", "o 03.08.20"],
    });
    expect(achados[0]!.porque).toContain("11.649,87");
  });

  it("a linha que só o contrato sustenta vira SEM_DEMONSTRADO", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([
        linha({
          chave: "custo_vans_inativas",
          rotulo: "CUSTO VANS INATIVAS",
          devido: { primeira: 13088.62, segunda: null },
          demonstrado: { primeira: null, segunda: null },
        }),
      ]),
    );

    expect(achados).toHaveLength(1);
    expect(achados[0]).toMatchObject({ tipo: "SEM_DEMONSTRADO", valor: 13088.62, quinzena: 1 });
    expect(achados[0]!.destrava).toContain("VBZ");
  });

  it("a linha que só o demonstrativo paga vira SEM_DEVIDO, com o que falta", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([
        linha({
          chave: "outros_custos_parcela",
          rotulo: "TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS",
          devido: { primeira: null, segunda: null },
          demonstrado: { primeira: null, segunda: 359984.86 },
          falta: "o total de outros custos da quinzena (03.08.12.09)",
        }),
      ]),
    );

    expect(achados).toHaveLength(1);
    expect(achados[0]).toMatchObject({ tipo: "SEM_DEVIDO", quinzena: 2 });
    /* O sinal é `devido − demonstrado`: pagou-se o que o contrato não sustenta. */
    expect(achados[0]!.valor).toBe(-359984.86);
    expect(achados[0]!.destrava).toBe("o total de outros custos da quinzena (03.08.12.09)");
    expect(achados[0]!.entre).toEqual(["o 03.08.20", "o contrato (cadastro e diário)"]);
  });

  it("quinzena que ninguém importou não é achado", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([linha({ devido: { primeira: 1, segunda: null }, demonstrado: { primeira: 1, segunda: null } })]),
    );
    expect(achados).toEqual([]);
  });

  it("zero devido sem demonstrado é acordo, não divergência", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([
        linha({
          chave: "indisponibilidade_fixo",
          devido: { primeira: 0, segunda: 0 },
          demonstrado: { primeira: null, segunda: null },
        }),
      ]),
    );
    expect(achados).toEqual([]);
  });

  it("a linha de TOTAL fica de fora — ela é a soma das que já estão na lista", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([
        linha({
          chave: "total_remuneracao_rota_fixo",
          papel: "TOTAL",
          devido: { primeira: 1081504.98, segunda: null },
          demonstrado: { primeira: 1084580.45, segunda: null },
        }),
      ]),
    );
    expect(achados).toEqual([]);
  });

  it("ordena por tamanho — quem abre a lista pergunta por onde começar", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([
        linha({
          chave: "pequena",
          devido: { primeira: 128.05, segunda: null },
          demonstrado: { primeira: 0, segunda: null },
        }),
        linha({
          chave: "grande",
          devido: { primeira: 0, segunda: null },
          demonstrado: { primeira: 15532.65, segunda: null },
        }),
        linha({
          chave: "media",
          devido: { primeira: 1723.03, segunda: null },
          demonstrado: { primeira: 0, segunda: null },
        }),
      ]),
    );

    expect(achados.map((a) => a.linha)).toEqual(["grande", "media", "pequena"]);
  });

  it("uma linha que discorda nas duas quinzenas rende dois itens", () => {
    const achados = levantarInconsistencias(
      "ROTA",
      quadro([
        linha({
          chave: "custo_vans_inativas",
          devido: { primeira: 13088.62, segunda: 13103.05 },
          demonstrado: { primeira: 0, segunda: 0 },
        }),
      ]),
    );

    expect(achados.map((a) => a.chave)).toEqual([
      "custo_vans_inativas:2",
      "custo_vans_inativas:1",
    ]);
  });
});
