import { describe, expect, it } from "vitest";

import { opcoesDeVigencia, type Comparacao } from "@/lib/justificativas";

/**
 * O seletor de vigência do Plano de Ação escrevia o rótulo do arquivo
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

  it("desempata a competência pelo dia quando o mês tem duas entregas", () => {
    const opcoes = opcoesDeVigencia(
      [
        comparacao({ id: "a", snapshotBDate: "2026-08-02" }),
        comparacao({ id: "b", snapshotBDate: "2026-08-01" }),
        comparacao({ id: "c", snapshotBDate: "2026-06-01" }),
      ],
      [],
    );

    // Agosto tem duas: vira dia. Junho tem uma só: continua competência.
    expect(opcoes.map((o) => o.competencia)).toEqual([
      "02/08/2026",
      "01/08/2026",
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
