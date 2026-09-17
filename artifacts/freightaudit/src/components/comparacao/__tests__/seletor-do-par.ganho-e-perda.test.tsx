// @vitest-environment jsdom
//
// O MENU DIZ A DIREÇÃO PELO SINAL E PELA COR, PELA MESMA RÉGUA.
//
// A coluna da direita existe para decidir, num relance, se vale abrir aquele
// par. Houve aqui a palavra ("Ganho R$ 7.238,85/mês"), pela ideia de que o
// símbolo exigia tradução. `−R$ 21.064,41/mês` em vermelho já é perda para quem
// lê, e a palavra ao lado repetia o que o sinal e a cor diziam juntos.
//
// A régua é o sinal do líquido: positivo é ganho, negativo é perda, zero não é
// nem um nem outro. E ela é **uma só** — o sinal e a cor saem da mesma
// `leitura` (`numerosDaLinha`), e não de duas contas sobre o mesmo número. Era
// aí que morava o defeito que estes casos guardam: com a cor lendo o sinal no
// seletor e o texto sendo escrito na outra ponta, bastava uma das duas mudar
// para a linha escrever `−` em verde.
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

type Balde = { periodicidade: string; valor: number };

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
  it("positivo leva `+`, e sai em verde", () => {
    montar([{ periodicidade: "MENSAL", valor: 7238.85 }], 7);

    expect(linhaDeJulho().textContent).toContain("+R$ 7.238,85/mês");
    expect(corDe("+R$ 7.238,85/mês")).toContain("text-emerald-700");
  });

  it("negativo leva `−`, e sai em vermelho", () => {
    montar([{ periodicidade: "MENSAL", valor: -21064.41 }], 11);

    expect(linhaDeJulho().textContent).toContain("−R$ 21.064,41/mês");
    expect(corDe("−R$ 21.064,41/mês")).toContain("text-destructive");
  });

  /* O prefixo é quem carrega a direção, e o valor vem em módulo: a linha não
     pode escrever `−` duas vezes, nem repetir na palavra o que o sinal diz. */
  it("a palavra não sobra ao lado do sinal, e o sinal não sai dobrado", () => {
    montar([{ periodicidade: "MENSAL", valor: -21064.41 }]);

    const linha = linhaDeJulho().textContent ?? "";
    expect(linha).toContain("−R$ 21.064,41/mês");
    expect(linha).not.toContain("Perda");
    expect(linha).not.toContain("Ganho");
    expect(linha).not.toContain("−−R$");
  });

  /*
    Zero não é ganho nem perda. Sem sinal e sem cor de direção — mas **com**
    número, porque a linha muda é "ainda não calculei", e esta calculou.
  */
  it("zero não ganha sinal nem cor", () => {
    montar([{ periodicidade: "MENSAL", valor: 0 }], 3);

    const linha = linhaDeJulho().textContent ?? "";
    expect(linha).toContain("R$ 0,00");
    expect(linha).not.toContain("+R$ 0,00");
    expect(linha).not.toContain("−R$ 0,00");
    expect(corDe("R$ 0,00")).toContain("text-muted-foreground");
  });

  /*
    Duas periodicidades continuam duas linhas, e cada uma se lê pela mesma
    régua. Somá-las seria juntar R$/mês com R$/ano, que é a soma que o produto
    recusa em toda tela — no Monitor, que consolida cinco módulos, como nas
    rubricas.
  */
  it("duas periodicidades são duas linhas, lidas pela mesma régua", () => {
    montar([
      { periodicidade: "MENSAL", valor: 7238.85 },
      { periodicidade: "ANUAL", valor: -900 },
    ]);

    const linha = linhaDeJulho().textContent ?? "";
    expect(linha).toContain("+R$ 7.238,85/mês");
    expect(linha).toContain("−R$ 900,00/ano");
    /* 7.238,85 − 900 = 6.338,85, e ele não aparece: as duas continuam duas. */
    expect(linha).not.toContain("6.338,85");
    expect(corDe("+R$ 7.238,85/mês")).toContain("text-emerald-700");
    expect(corDe("−R$ 900,00/ano")).toContain("text-destructive");
  });
});
