import { describe, expect, it } from "vitest";

import {
  comparacoesDoEscopo,
  opcoesDeVigencia,
  type Comparacao,
} from "@/lib/justificativas";

/**
 * O seletor de vigência de Chamados escrevia o rótulo do arquivo
 * importado — o mesmo texto em todas as unidades da mesma data —, de modo que
 * cinco unidades produziam cinco linhas idênticas por competência. Estes
 * testes fixam o que passou a distinguir uma linha da outra: a competência no
 * formato dos demais seletores, o nome da unidade e a contagem de alterações.
 */

function comparacao(parcial: Partial<Comparacao> & { id: string }): Comparacao {
  return {
    snapshotBLabel: "EMPURRADA_2_8_2026",
    snapshotBDate: "2026-08-02",
    alteracoes: 0,
    scopeHash: null,
    ...parcial,
  };
}

describe("opcoesDeVigencia", () => {
  it("nomeia a unidade pelo escopo da vigência comparada", () => {
    const opcoes = opcoesDeVigencia(
      [
        comparacao({ id: "a", scopeHash: "h1", alteracoes: 102 }),
        comparacao({ id: "b", scopeHash: "h2", alteracoes: 355 }),
      ],
      [
        { scopeHash: "h1", label: "PERNAMBUCO · EMPURRADA" },
        { scopeHash: "h2", label: "MANAUS · EMPURRADA" },
      ],
    );

    expect(opcoes.map((o) => o.unidade)).toEqual([
      "PERNAMBUCO · EMPURRADA",
      "MANAUS · EMPURRADA",
    ]);
    expect(opcoes.map((o) => o.alteracoes)).toEqual([102, 355]);
  });

  it("desempata a competência pelo dia quando o mês tem duas entregas, sem abandonar o mês", () => {
    const opcoes = opcoesDeVigencia(
      [
        comparacao({ id: "a", snapshotBDate: "2026-08-02" }),
        comparacao({ id: "b", snapshotBDate: "2026-08-01" }),
        comparacao({ id: "c", snapshotBDate: "2026-06-01" }),
      ],
      [],
    );

    /*
      Agosto tem duas: ganha a marca do dia. Junho tem uma só: fica sem marca.
      O mês é o mesmo texto nos três — a lista do menu é uma coluna de meses, e
      escrever `02/08/2026` no meio de `junho/2026` obrigava quem procura
      agosto a traduzir o único item em dígitos.
    */
    expect(opcoes.map((o) => o.mes)).toEqual(["agosto/2026", "agosto/2026", "junho/2026"]);
    expect(opcoes.map((o) => o.marca)).toEqual(["dia 02", "dia 01", null]);

    // `competencia` é a forma de uma linha só — o título do diálogo, a coluna
    // do CSV —, e as três continuam distintas.
    expect(opcoes.map((o) => o.competencia)).toEqual([
      "agosto/2026 · dia 02",
      "agosto/2026 · dia 01",
      "junho/2026",
    ]);
  });

  it("fica só com a data quando o contexto da vigência não é conhecido", () => {
    const opcoes = opcoesDeVigencia(
      [comparacao({ id: "a", scopeHash: "desconhecido" })],
      [{ scopeHash: "h1", label: "PERNAMBUCO · EMPURRADA" }],
    );

    expect(opcoes[0].unidade).toBeNull();
  });

  it("aceita a data com hora, como o driver às vezes a entrega", () => {
    const opcoes = opcoesDeVigencia(
      [comparacao({ id: "a", snapshotBDate: "2026-08-02T00:00:00.000Z" })],
      [],
    );

    expect(opcoes[0].competencia).toBe("agosto/2026");
  });
});

/**
 * A tela listava as comparações de todas as unidades enquanto a lateral
 * nomeava uma: o seletor de PERNAMBUCO oferecia CAMAÇARI e MANAUS, e escolher
 * uma delas trocava a unidade sem que nada em tela dissesse isso.
 */
describe("comparacoesDoEscopo", () => {
  const acervo = [
    comparacao({ id: "pe", scopeHash: "h1" }),
    comparacao({ id: "ma", scopeHash: "h2" }),
    comparacao({ id: "pe-antiga", scopeHash: "h1" }),
    comparacao({ id: "sem-escopo" }),
  ];

  it("fica só com as comparações da unidade aberta", () => {
    expect(comparacoesDoEscopo(acervo, "h1").map((c) => c.id)).toEqual([
      "pe",
      "pe-antiga",
    ]);
  });

  it("devolve o acervo inteiro na Visão Geral", () => {
    expect(comparacoesDoEscopo(acervo, null)).toHaveLength(4);
  });

  it("deixa de fora a comparação sem escopo — ela não é de unidade nenhuma", () => {
    expect(comparacoesDoEscopo(acervo, "h2").map((c) => c.id)).toEqual(["ma"]);
  });
});
