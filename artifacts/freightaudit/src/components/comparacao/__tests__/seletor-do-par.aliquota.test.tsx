// @vitest-environment jsdom
//
// O MENU DOS IMPOSTOS DIZ EM QUANTOS PONTOS A ALÍQUOTA ANDOU.
//
// A coluna da direita existe para decidir, num relance, se vale abrir aquele
// par — e nos Impostos ela não decidia nada. O montante de ICMS é zero nas
// 1.215 linhas do acervo e o PIS/COFINS de aquisição é 9,250% da nota em todas
// elas, então a coluna do dinheiro escrevia `R$ 0,00 · 0 alterações` em **toda**
// linha do histórico, tivesse a taxa andado ou não. Num módulo de imposto a
// grandeza que distingue uma vigência da outra é o ponto percentual.
//
// O que estes casos guardam é a régua de sempre aplicada à terceira grandeza:
// ausência não é zero, zero não é ausência, e nada aqui soma o que não se soma
// — nem pontos entre si, nem ICMS com PIS/COFINS.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SeletorDoPar, type VigenciaEscolhivel } from "../seletor-do-par";
import type { CandidatosDoPar, MovimentoDePercentual } from "@/lib/candidatos";

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

const ACERVO = [v("jul", "2026-07-16"), v("ago", "2026-08-01")];

const ROTULOS = new Map([
  ["jul", "julho/2026 · 2ª quinzena"],
  ["ago", "agosto/2026 · 1ª quinzena"],
]);

/**
 * A linha de julho como a rota dos Impostos a publica.
 *
 * O dinheiro entra zerado de propósito: é o que aquela rubrica produz no acervo
 * real, e é contra esse `R$ 0,00` que a linha de alíquota tem de se distinguir.
 */
function montar(
  percentuais: MovimentoDePercentual[] | undefined,
  alteracoes = 0,
) {
  const candidatos: CandidatosDoPar = {
    para: "ago",
    pendentes: 0,
    candidatos: [
      {
        id: "jul",
        numeros: {
          alteracoes,
          impacto: { baldes: [] },
          ...(percentuais ? { percentuais } : {}),
        },
      },
    ],
  };
  render(
    <SeletorDoPar
      vigencias={ACERVO}
      rotulos={ROTULOS}
      base="jul"
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

/** A linha de julho no menu aberto. */
const linhaDeJulho = () =>
  screen
    .getAllByRole("option")
    .find((o) => o.textContent?.includes("julho/2026"))!;

afterEach(cleanup);

describe("o movimento da alíquota na linha do menu", () => {
  it("escreve os pontos ao lado do dinheiro, e não no lugar dele", () => {
    montar(
      [{ rotulo: "ICMS", alteradas: 1, maior: 2, ambasDirecoes: false }],
      1,
    );

    const linha = linhaDeJulho().textContent ?? "";
    expect(linha).toContain("ICMS +2,000 p.p.");
    expect(linha).toContain("R$ 0,00");
    expect(linha).toContain("1 alteração");
  });

  /*
    Nenhuma alíquota andou — e isso se escreve. Deixar a casa em branco seria
    dizer, nesta tela, "ainda não calculei": é a mesma fronteira que o `R$ 0,00`
    guarda na linha de cima.
  */
  it("alíquota parada é notícia, e sai por extenso", () => {
    montar([]);

    expect(linhaDeJulho().textContent).toContain("sem movimento de alíquota");
  });

  /* As outras quatro rubricas não auditam percentual: a linha delas segue como era. */
  it("não inventa linha de alíquota para quem não a audita", () => {
    montar(undefined, 73);

    const linha = linhaDeJulho().textContent ?? "";
    expect(linha).not.toContain("p.p.");
    expect(linha).not.toContain("alíquota");
    expect(linha).toContain("73 alterações");
  });

  /*
    Setenta e uma carretas que sobem até 6 p.p. não somam 426 p.p. — o que sai é
    o maior movimento, com a contagem ao lado dizendo sobre quantas ele fala.
  */
  it("publica o maior movimento, nunca a soma dos pontos", () => {
    montar(
      [{ rotulo: "ICMS", alteradas: 71, maior: 6, ambasDirecoes: false }],
      71,
    );

    const linha = linhaDeJulho().textContent ?? "";
    expect(linha).toContain("ICMS até +6,000 p.p. · 71 alíquotas");
    expect(linha).not.toContain("426");
  });

  it("ICMS e PIS/COFINS são duas linhas, e nunca um número só", () => {
    montar(
      [
        { rotulo: "ICMS", alteradas: 1, maior: 2, ambasDirecoes: false },
        {
          rotulo: "PIS/COFINS",
          alteradas: 1,
          maior: -0.05,
          ambasDirecoes: false,
        },
      ],
      2,
    );

    const linha = linhaDeJulho().textContent ?? "";
    expect(linha).toContain("ICMS +2,000 p.p.");
    expect(linha).toContain("PIS/COFINS −0,050 p.p.");
    expect(linha).not.toContain("+1,950 p.p.");
  });

  /*
    O ponto percentual não leva a cor do dinheiro. Verde é ganho e vermelho é
    perda; uma alíquota que sobe não é nem um nem outro enquanto o regime
    tributário do ativo não estiver no acervo (docs/ACHADO-IMPOSTOS.md).
  */
  it("não pinta o ponto percentual de ganho nem de perda", () => {
    montar(
      [{ rotulo: "ICMS", alteradas: 1, maior: 2, ambasDirecoes: false }],
      1,
    );

    const alvo = [...linhaDeJulho().querySelectorAll("span")].find(
      (s) => s.textContent === "ICMS +2,000 p.p.",
    );
    expect(alvo, "não achei a linha da alíquota").toBeDefined();
    expect(alvo!.className).toContain("text-muted-foreground");
    expect(alvo!.className).not.toContain("text-emerald-700");
    expect(alvo!.className).not.toContain("text-destructive");
  });
});
