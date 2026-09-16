// @vitest-environment jsdom
//
// O MENU DIZ GANHO OU PERDA — COM A PALAVRA E COM A COR, PELA MESMA RÉGUA.
//
// A coluna da direita existe para decidir, num relance, se vale abrir aquele
// par. `+R$ 7.238,85/mês` obrigava quem lê a traduzir um símbolo antes de
// decidir; "Ganho R$ 7.238,85/mês" já é a leitura.
//
// A régua é o sinal do líquido: positivo é ganho, negativo é perda, zero não é
// nem um nem outro. E ela é **uma só** — a palavra e a cor saem da mesma
// `leitura` (`numerosDaLinha`), e não de duas contas sobre o mesmo número. Era
// aí que morava o defeito que estes casos guardam: com a cor lendo o sinal no
// seletor e o texto sendo escrito na outra ponta, bastava uma das duas mudar
// para a linha dizer "Perda" em verde.
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

type Balde = { periodicidade: string; natureza: "CUSTO" | "RECEITA" | null; valor: number };

/** Os baldes de julho, montados como a rota os publica. */
function montar(baldes: Balde[], alteracoes = 73) {
  const candidatos: CandidatosDoPar = {
    para: "ago",
    pendentes: 0,
    candidatos: [{ id: "jul", numeros: { alteracoes, impacto: { baldes } } }],
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
      idPrefixo="monitor"
    />,
  );
  fireEvent.keyDown(screen.getByLabelText("De (vigência de origem)"), { key: "Enter" });
}

/** A linha de julho no menu aberto. */
const linhaDeJulho = () =>
  screen.getAllByRole("option").find((o) => o.textContent?.includes("julho/2026"))!;

/** A cor de uma linha de dinheiro, pelo texto que ela mostra. */
const corDe = (texto: string) => {
  const alvo = [...linhaDeJulho().querySelectorAll("span")].find(
    (s) => s.textContent === texto,
  );
  expect(alvo, `não achei a linha "${texto}"`).toBeDefined();
  return alvo!.className;
};

afterEach(cleanup);

describe("a leitura de cada linha de dinheiro do menu", () => {
  it("positivo é Ganho, e sai em verde", () => {
    montar([{ periodicidade: "MENSAL", natureza: "CUSTO", valor: 7238.85 }], 7);

    expect(linhaDeJulho().textContent).toContain("Ganho R$ 7.238,85/mês");
    expect(corDe("Ganho R$ 7.238,85/mês")).toContain("text-emerald-700");
  });

  it("negativo é Perda, e sai em vermelho", () => {
    montar([{ periodicidade: "MENSAL", natureza: "CUSTO", valor: -21064.41 }], 11);

    expect(linhaDeJulho().textContent).toContain("Perda R$ 21.064,41/mês");
    expect(corDe("Perda R$ 21.064,41/mês")).toContain("text-destructive");
  });

  /* O valor vem em módulo: a palavra já é a direção, e o `−` ao lado dela
     pareceria sinal de outra conta. */
  it("o sinal não sobra ao lado da palavra", () => {
    montar([{ periodicidade: "MENSAL", natureza: "CUSTO", valor: -21064.41 }]);

    expect(linhaDeJulho().textContent).not.toContain("−R$ 21.064,41");
    expect(linhaDeJulho().textContent).not.toContain("+R$");
  });

  /*
    Zero não é ganho nem perda. Sem palavra e sem cor de direção — mas **com**
    número, porque a linha muda é "ainda não calculei", e esta calculou.
  */
  it("zero não ganha palavra nem cor", () => {
    montar([{ periodicidade: "MENSAL", natureza: "CUSTO", valor: 0 }], 3);

    const linha = linhaDeJulho().textContent ?? "";
    expect(linha).toContain("R$ 0,00");
    expect(linha).not.toContain("Ganho");
    expect(linha).not.toContain("Perda");
    expect(corDe("R$ 0,00")).toContain("text-muted-foreground");
  });

  /*
    O Monitor traz as duas naturezas na mesma periodicidade, e as duas se leem
    pela mesma régua. As linhas continuam separadas — somá-las seria publicar o
    "impacto líquido" que os cartões daquela tela recusam em letra grande.
  */
  it("no Monitor, as duas linhas da mesma periodicidade se leem igual", () => {
    montar([
      { periodicidade: "MENSAL", natureza: "CUSTO", valor: 7238.85 },
      { periodicidade: "MENSAL", natureza: "RECEITA", valor: -900 },
    ]);

    const linha = linhaDeJulho().textContent ?? "";
    expect(linha).toContain("Ganho R$ 7.238,85/mês");
    expect(linha).toContain("Perda R$ 900,00/mês");
    /* 7.238,85 − 900 = 6.338,85, e ele não aparece: as duas continuam duas. */
    expect(linha).not.toContain("6.338,85");
  });

  /* A rubrica manda `natureza: null` e lê pela mesma régua — a palavra não
     depende de qual lado da DRE é, só do sinal. */
  it("a rubrica de uma natureza só usa as mesmas palavras", () => {
    montar([{ periodicidade: "MENSAL", natureza: null, valor: 7238.85 }], 7);

    expect(linhaDeJulho().textContent).toContain("Ganho R$ 7.238,85/mês");
    expect(corDe("Ganho R$ 7.238,85/mês")).toContain("text-emerald-700");
  });
});
