// @vitest-environment jsdom
//
// A lista que "Trocar vigência" abre.
//
// Dois defeitos de leitura moram aqui, e nenhum deles quebra teste nenhum se
// alguém os desfizer no CSS:
//
//   1. a coluna da esquerda saía em dois idiomas — `setembro/2026` sobre
//      `02/08/2026` sobre `julho/2026` —, e quem procurava agosto tinha de
//      traduzir o único item escrito em dígitos;
//   2. a coluna da direita dizia só quantas alterações a vigência trouxe, e
//      402 alterações não distinguem a que mudou o contrato da que mexeu em
//      muita linha barata.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MenuDeVigencias, SeletorDeVigencia } from "@/components/vigencia/seletor-de-vigencia";
import type { FamiliesView } from "@/components/inicio/types";

/* O menu deste arquivo é sobre rótulo, não sobre números: a leitura de
   `/changes/range` não sai, e as colunas ficam vazias — que é como o menu abre
   enquanto ela não voltou. */
vi.mock("@/lib/api", () => ({ fetchJsonOrNull: async () => null }));

class ObservadorDeTamanho {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ObservadorDeTamanho as unknown as typeof ResizeObserver;

/* O Radix mede e ancora o menu com APIs que o jsdom não traz. Nenhuma delas é
   o que este teste prova — o que ele prova é o que o menu escreve. */
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

afterEach(cleanup);

const VIGENCIAS = [
  { valor: "2026-09-01", mes: "setembro/2026", marca: null, alteracoes: 12, impacto: -1_200 },
  { valor: "2026-08-02", mes: "agosto/2026", marca: "dia 02", alteracoes: 383, impacto: -82_140 },
  { valor: "2026-08-01", mes: "agosto/2026", marca: "dia 01", alteracoes: 402, impacto: 4_500 },
  { valor: "2026-07-01", mes: "julho/2026", marca: null, alteracoes: 400, impacto: null },
];

function abrir(opcoes: React.ComponentProps<typeof MenuDeVigencias>["opcoes"], periodicidade?: string) {
  render(
    <MenuDeVigencias
      rotulo="Trocar vigência"
      cabecalho={`${opcoes.length} vigências no histórico`}
      periodicidade={periodicidade}
      opcoes={opcoes}
      ativa={null}
      onEscolher={() => {}}
    />,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: /Trocar vigência/ }), { key: "Enter" });
  return screen.getByRole("menu");
}

describe("a lista de vigências", () => {
  it("escreve o mês em toda linha — nenhuma volta a ser só dígitos", () => {
    const menu = abrir(VIGENCIAS, "MENSAL");
    const linhas = within(menu).getAllByRole("menuitem");

    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringContaining("setembro/2026"),
      expect.stringContaining("agosto/2026"),
      expect.stringContaining("agosto/2026"),
      expect.stringContaining("julho/2026"),
    ]);
    expect(menu.textContent).not.toContain("02/08/2026");
  });

  it("as duas de agosto continuam distinguíveis, pela marca ao lado do mês", () => {
    const menu = abrir(VIGENCIAS, "MENSAL");
    const deAgosto = within(menu)
      .getAllByRole("menuitem")
      .filter((l) => l.textContent?.includes("agosto/2026"));

    expect(deAgosto).toHaveLength(2);
    expect(deAgosto[0].textContent).toContain("dia 02");
    expect(deAgosto[1].textContent).toContain("dia 01");
  });

  it("cada linha diz quanto custou e quantas alterações produziram isso", () => {
    const menu = abrir(VIGENCIAS, "MENSAL");
    const linhas = within(menu).getAllByRole("menuitem");

    /* `getByText` normaliza o espaço; `formatBrlShort` usa um inquebrável, de
       propósito, para que "R$" nunca desgrude do número na quebra de linha. */
    expect(within(linhas[1]).getByText("−R$ 82.140")).toBeTruthy();
    expect(within(linhas[1]).getByText("383 alterações")).toBeTruthy();
    expect(within(linhas[2]).getByText("R$ 4.500")).toBeTruthy();
    expect(within(linhas[2]).getByText("402 alterações")).toBeTruthy();
  });

  it("perda em vermelho, ganho em verde — o sinal também se lê sem ler o número", () => {
    const menu = abrir(VIGENCIAS, "MENSAL");
    const linhas = within(menu).getAllByRole("menuitem");

    expect(within(linhas[1]).getByText("−R$ 82.140").className).toContain("text-red-700");
    expect(within(linhas[2]).getByText("R$ 4.500").className).toContain("text-emerald-700");
  });

  it("o empate não é verde — zero não é ganho", () => {
    /*
      Um ternário entre vermelho e verde entrega o zero ao verde, e a linha
      passa a afirmar que a vigência subiu a remuneração quando ela fechou no
      mesmo lugar. O empate fica no cinza do texto de apoio.
    */
    const menu = abrir([{ ...VIGENCIAS[0], impacto: 0 }], "MENSAL");
    const zero = within(menu).getByText("R$ 0");

    expect(zero.className).toContain("text-muted-foreground");
    expect(zero.className).not.toContain("text-emerald-700");
  });

  it("nomeia a periodicidade da coluna uma vez, no cabeçalho", () => {
    /*
      R$/mês e R$/ano não se comparam. Sem esta linha, `−R$ 82.140` numa lista
      de vigências não diz se é por mês, por ano ou de uma vez.
    */
    const menu = abrir(VIGENCIAS, "MENSAL");
    expect(menu.textContent).toContain("Impacto líquido em R$/mês");
    expect(menu.textContent).toContain("4 vigências no histórico");
  });

  it("vigência sem impacto apurado fica só com a contagem — nada de R$ 0 inventado", () => {
    const menu = abrir(VIGENCIAS, "MENSAL");
    const julho = within(menu)
      .getAllByRole("menuitem")
      .find((l) => l.textContent?.includes("julho/2026"))!;

    expect(julho.textContent).toContain("400 alterações");
    expect(julho.textContent).not.toContain("R$");
  });

  it("sem impacto em lugar nenhum, a coluna e o cabeçalho dela somem, e a contagem fica", () => {
    const menu = abrir(
      VIGENCIAS.map((v) => ({ ...v, impacto: null })),
      undefined,
    );

    expect(menu.textContent).not.toContain("Impacto líquido");
    expect(menu.textContent).not.toContain("R$");
    expect(menu.textContent).toContain("383 alterações");
  });
});

describe("o seletor de uma unidade", () => {
  /* Só o que o componente lê. O resto de `FamiliesView` não entra na conta do
     rótulo, e forjá-lo inteiro faria o teste medir a forma do tipo. */
  const view = (periods: string[], periodosDisponiveis: string[]) =>
    ({
      period: periods[0],
      periods: periods.map((date) => ({ date, label: date })),
      context: { periodosDisponiveis },
    }) as unknown as FamiliesView;

  function abrirDaUnidade(v: FamiliesView) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeletorDeVigencia view={v} consulta={new URLSearchParams()} onTrocar={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /Trocar vigência/ }), { key: "Enter" });
    return screen.getByRole("menu");
  }

  it("desempata pelo histórico do contexto, e não pelo recorte visível", () => {
    /*
      Com uma janela aplicada, `periods` traz só o recorte — aqui, uma das duas
      entregas de agosto. Se o desempate saísse daí, agosto pareceria um mês de
      entrega única e a vigência perderia o `dia 02` que ela tem na tela sem
      janela: a mesma vigência com dois nomes, conforme o recorte. É a mesma
      escolha que o servidor faz em `grouped.ts`.
    */
    const menu = abrirDaUnidade(
      view(
        ["2026-09-01", "2026-08-02"],
        ["2026-08-01", "2026-08-02", "2026-09-01"],
      ),
    );
    const linhas = within(menu).getAllByRole("menuitem");

    expect(linhas.map((l) => l.textContent)).toEqual([
      "setembro/2026",
      expect.stringContaining("agosto/2026"),
    ]);
    expect(linhas[1].textContent).toContain("dia 02");
  });

  it("sem a lista completa, o recorte visível serve de denominador", () => {
    const menu = abrirDaUnidade(view(["2026-09-01", "2026-08-02", "2026-08-01"], []));
    const linhas = within(menu).getAllByRole("menuitem");

    expect(linhas[1].textContent).toContain("dia 02");
    expect(linhas[2].textContent).toContain("dia 01");
  });

  it("enquanto os números não chegam, a lista abre só com as vigências", () => {
    const menu = abrirDaUnidade(view(["2026-09-01", "2026-08-01"], []));

    expect(menu.textContent).toContain("2 vigências no histórico");
    expect(menu.textContent).not.toContain("alterações");
    expect(menu.textContent).not.toContain("R$");
  });
});
