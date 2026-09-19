// @vitest-environment jsdom
//
// O MENU DIZ QUANTOS ATIVOS ENTRARAM E SAÍRAM — E É O QUE EXPLICA DOIS TOTAIS.
//
// A coluna da direita escrevia três frases nos Impostos, e as três eram
// verdade: `R$ 0,00`, `sem movimento de alíquota`, `0 alterações`. No acervo
// não há **uma** alteração nos dez códigos de imposto — nenhum ativo presente
// nas duas pontas teve alíquota ou montante mexido.
//
// E, no mesmo par, o total de PIS/COFINS da carreta que a própria tela publica
// cai de R$ 1.683.696,18 para R$ 1.584.322,25. A diferença não é alteração
// nenhuma: é frota, cinco carretas a menos. Três frases dizendo "nada mudou" a
// dois centímetros de R$ 99 mil de diferença é como uma tela correta vira
// ilegível — e é a quarta frase que separa "o imposto não mudou" de "nenhum
// ativo teve o imposto mexido", que é a única das duas que a conta sustenta.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SeletorDoPar, type VigenciaEscolhivel } from "../seletor-do-par";
import type { CandidatosDoPar, MovimentoDaFrota } from "@/lib/candidatos";

/* O Radix mede e ancora o menu com APIs que o jsdom não traz; nenhuma delas é o
   que estes casos provam. */
globalThis.DOMRect ??= class {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
  top = 0;
  left = 0;
  right = 0;
  bottom = 0;
  toJSON() {
    return this;
  }
} as unknown as typeof DOMRect;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

const UNIDADE = "scope-ca";

const v = (id: string, effectiveDate: string): VigenciaEscolhivel => ({
  id,
  sourceLabel: id.toUpperCase(),
  effectiveDate,
  entityTypeSet: "CARRETA+CAVALO",
  scopeHash: UNIDADE,
});

const ACERVO = [v("mar", "2026-03-16"), v("ago", "2026-08-01")];

const ROTULOS = new Map([
  ["mar", "março/2026 · 2ª quinzena"],
  ["ago", "agosto/2026 · 1ª quinzena"],
]);

/** A linha de março como a rota dos Impostos a publica. */
function montar(frota: MovimentoDaFrota | undefined) {
  const candidatos: CandidatosDoPar = {
    para: "ago",
    pendentes: 0,
    candidatos: [
      {
        id: "mar",
        numeros: {
          alteracoes: 0,
          impacto: { baldes: [] },
          percentuais: [],
          ...(frota ? { frota } : {}),
        },
      },
    ],
  };
  render(
    <SeletorDoPar
      vigencias={ACERVO}
      rotulos={ROTULOS}
      base="mar"
      comparada="ago"
      candidatos={candidatos}
      onBase={() => {}}
      onComparada={() => {}}
      onInverter={() => {}}
      idPrefixo="impostos"
    />,
  );
  fireEvent.keyDown(screen.getByLabelText("De (vigência de origem)"), {
    key: "Enter",
  });
}

/** A linha de março no menu aberto. */
const linhaDeMarco = () =>
  screen
    .getAllByRole("option")
    .find((o) => o.textContent?.includes("março/2026"))!;

afterEach(cleanup);

describe("o movimento da frota na linha do menu", () => {
  it("escreve entrada e saída ao lado das outras três, e não no lugar delas", () => {
    montar({ entraram: 4, sairam: 11 });

    const linha = linhaDeMarco().textContent ?? "";
    expect(linha).toContain("4 entraram · 11 ativos saíram");
    expect(linha).toContain("R$ 0,00");
    expect(linha).toContain("sem movimento de alíquota");
    expect(linha).toContain("0 alterações");
  });

  /* A régua do `R$ 0,00` aplicada à quarta grandeza: a conta que deu zero se
     escreve. Calá-la deixaria a linha sem dizer qual dos dois casos é o dela —
     frota parada, ou frota que ninguém olhou. */
  it("frota parada também se escreve", () => {
    montar({ entraram: 0, sairam: 0 });

    expect(linhaDeMarco().textContent).toContain("frota estável");
  });

  /* Ausente é o recorte que não audita frota — as outras rubricas —, e a linha
     delas segue exatamente como era. */
  it("a rubrica que não audita frota não ganha frase nenhuma", () => {
    montar(undefined);

    const linha = linhaDeMarco().textContent ?? "";
    expect(linha).not.toContain("frota");
    expect(linha).not.toContain("entraram");
    expect(linha).toContain("0 alterações");
  });

  /* Ativos de um lado, variáveis do outro: a contagem de alterações não absorve
     a frota, e nenhum número da linha é a soma dos dois. */
  it("a frota não entra na contagem de alterações", () => {
    montar({ entraram: 4, sairam: 11 });

    const linha = linhaDeMarco().textContent ?? "";
    expect(linha).toContain("0 alterações");
    expect(linha).not.toContain("15 alterações");
  });
});
