// @vitest-environment jsdom
//
// O MENU DO MONITOR ESCREVE DE QUAL LADO DA DRE ELE ESTÁ FALANDO.
//
// O Monitor Custo Fixo é o único recorte do produto em que custo e receita
// chegam juntos — ele lê os quatro módulos, e Lucro Fixo é receita. As quatro
// auditorias, cada uma de uma natureza só, escrevem `+R$ 7.238,85/mês` sem
// prefixo desde sempre, e continuam escrevendo: numa tela cujo nome já é o da
// rubrica, dizer "Custo" ao lado do número é repetir o que a tela inteira diz.
//
// Aqui não: duas linhas de dinheiro na mesma periodicidade, sem dono, são um
// convite a somá-las — e essa soma é exatamente o "impacto líquido" que
// `CartoesDoMonitor` recusa publicar em letra grande, que voltaria pela porta
// dos fundos num canto sem espaço para ressalva.
//
// Estes casos abrem o menu de verdade e leem o que está escrito nele.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SeletorDoPar, type VigenciaEscolhivel } from "../seletor-do-par";
import type { CandidatosDoPar } from "@/lib/candidatos";

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

function montar(candidatos: CandidatosDoPar) {
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
      idPrefixo="monitor"
    />,
  );
  fireEvent.keyDown(screen.getByLabelText("De (vigência de origem)"), { key: "Enter" });
}

/** A linha de julho, em texto, como o menu a escreve. */
const linhaDeJulho = () =>
  screen
    .getAllByRole("option")
    .find((o) => o.textContent?.includes("julho/2026"))
    ?.textContent?.trim() ?? "";

afterEach(cleanup);

describe("o menu do Monitor, com as duas naturezas", () => {
  /*
    Os números são os do acervo de prova, par julho/2ªq → agosto/1ªq de
    CAMAÇARI: `/monitor-custo-fixo/consolidado` responde 73 alterações, custo
    mensal +7.238,85 e receita mensal +4.677,85 para exatamente este par. O
    menu escreve os mesmos três, porque as duas rotas passam pela mesma função.
  */
  const DO_MONITOR: CandidatosDoPar = {
    para: "ago",
    pendentes: 0,
    candidatos: [
      {
        id: "jul",
        numeros: {
          alteracoes: 73,
          impacto: {
            baldes: [
              { periodicidade: "MENSAL", natureza: "CUSTO", valor: 7238.85 },
              { periodicidade: "MENSAL", natureza: "RECEITA", valor: 4677.85 },
            ],
          },
        },
      },
    ],
  };

  it("escreve o custo e a receita em duas linhas, cada uma com o seu nome", () => {
    montar(DO_MONITOR);
    const linha = linhaDeJulho();

    expect(linha).toContain("Custo +R$ 7.238,85/mês");
    expect(linha).toContain("Receita +R$ 4.677,85/mês");
    expect(linha).toContain("73 alterações");
  });

  it("não escreve a soma dos dois lados em lugar nenhum", () => {
    montar(DO_MONITOR);
    const linha = linhaDeJulho();

    /* 7.238,85 + 4.677,85 = 11.916,70, e a diferença é 2.561,00. Nenhum dos
       dois é um número que este produto publique: um soma custo com receita, o
       outro é o resultado, que sozinho trocaria o sinal do custo sem avisar. */
    expect(linha).not.toContain("11.916,70");
    expect(linha).not.toContain("2.561,00");
  });

  /*
    A regressão do outro lado: as quatro auditorias mandam `natureza: null`, e a
    linha delas não pode ganhar prefixo nenhum por causa desta mudança.
  */
  it("a rubrica de uma natureza só continua sem prefixo", () => {
    montar({
      para: "ago",
      pendentes: 0,
      candidatos: [
        {
          id: "jul",
          numeros: {
            alteracoes: 7,
            impacto: {
              baldes: [{ periodicidade: "MENSAL", natureza: null, valor: 7238.85 }],
            },
          },
        },
      ],
    });
    const linha = linhaDeJulho();

    expect(linha).toContain("+R$ 7.238,85/mês");
    expect(linha).not.toContain("Custo");
    expect(linha).not.toContain("Receita");
  });
});
