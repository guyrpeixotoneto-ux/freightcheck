// @vitest-environment jsdom
//
// O cabeçalho do Painel de Justificativas — onde se troca de vigência.
//
// A vigência era uma caixa no meio dos filtros e virou o botão "Trocar
// vigência" do canto direito, o mesmo das outras telas. O que se prende aqui é
// justamente o que uma volta atrás desfaria sem quebrar teste nenhum: que o
// botão está no cabeçalho, que a tela diz qual vigência está aberta, que ela
// abre somando **todas**, e que a caixa antiga não voltou para os filtros.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import PainelDeJustificativas from "@/pages/painel-de-justificativas";
import type { Contexto } from "@/lib/contextos";

class ObservadorDeTamanho {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ObservadorDeTamanho as unknown as typeof ResizeObserver;

/* O Radix mede e ancora o menu com APIs que o jsdom não traz. Nenhuma delas é
   o que este teste prova — o que ele prova é o que o menu lista. */
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

/* A casca pede sessão, permissões e o menu inteiro, e nada disso é o que esta
   página decide — o mesmo corte dos outros testes de página. */
vi.mock("@/components/layout/layout", () => ({
  Layout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const CONTEXTOS: Contexto[] = [
  {
    scopeHash: "hash-pe",
    channel: "EMPURRADA",
    label: "PERNAMBUCO · EMPURRADA",
    scopes: [{ scopeType: "UNIDADE", code: "BR07", name: "PERNAMBUCO" }],
    latestPeriod: "2026-08-01",
    periods: 6,
    periodosDisponiveis: ["2026-07-01", "2026-08-01"],
  },
];

vi.mock("@/lib/contextos", async (original) => ({
  ...(await original<typeof import("@/lib/contextos")>()),
  useContextosDaCasca: () => ({ contextos: CONTEXTOS, carregando: false, indisponivel: false }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const resposta = (corpo: unknown) =>
  new Response(JSON.stringify(corpo), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-FreightCheck-API": "1" },
  });

/* Duas vigências da mesma unidade, com cobertura de dois tipos cada uma: o
   suficiente para a lista do menu ter o que listar e para as contagens de cada
   linha serem diferentes entre si. */
const COBERTURA = [
  {
    changeSetId: "cs-julho",
    entityType: "CAVALO",
    alteracoes: 40,
    justificadas: 10,
    placas: 12,
    placasPendentes: 9,
  },
  {
    changeSetId: "cs-julho",
    entityType: "CARRETA",
    alteracoes: 60,
    justificadas: 0,
    placas: 20,
    placasPendentes: 20,
  },
  {
    changeSetId: "cs-agosto",
    entityType: "CAVALO",
    alteracoes: 400,
    justificadas: 100,
    placas: 80,
    placasPendentes: 60,
  },
];

const CHANGE_SETS = [
  {
    id: "cs-julho",
    snapshot_b_label: "EMPURRADA_1_7_2026",
    snapshot_b_date: "2026-07-01",
    value_changes: 100,
    snapshot_b_scope_hash: "hash-pe",
  },
  {
    id: "cs-agosto",
    snapshot_b_label: "EMPURRADA_2_8_2026",
    snapshot_b_date: "2026-08-01",
    value_changes: 400,
    snapshot_b_scope_hash: "hash-pe",
  },
];

/** Guarda os endereços pedidos, para conferir o recorte que a lista recebeu. */
function servidor(cobertura: typeof COBERTURA = COBERTURA) {
  const pedidos: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      pedidos.push(url);
      if (url.includes("/change-sets")) return resposta(CHANGE_SETS);
      if (url.includes("/justificativas/painel"))
        return resposta({ cobertura, autores: [] });
      if (url.includes("/justificativas/pendencias"))
        return resposta({ total: 0, linhas: [] });
      return resposta({});
    }),
  );
  return pedidos;
}

/** O cartão de um título — os números repetem pela tela, e é o cartão que se lê. */
function cartao(titulo: string): HTMLElement {
  const secao = screen.getByText(titulo).closest("section");
  if (!secao) throw new Error(`sem cartão para ${titulo}`);
  return secao as HTMLElement;
}

function montar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cliente}>
      <Router>
        <PainelDeJustificativas />
      </Router>
    </QueryClientProvider>,
  );
}

describe("o cabeçalho do Painel de Justificativas", () => {
  it("abre somando todas as vigências, e diz isso ao lado do título", async () => {
    servidor();
    montar();

    await screen.findByRole("button", { name: /Trocar vigência/ });
    const cabecalho = screen.getByRole("banner");
    expect(within(cabecalho).getByText("Todas as vigências")).toBeTruthy();
    /* O cartão soma as duas vigências: 40 + 60 + 400. */
    expect(within(cartao("Alterações no recorte")).getByText("500")).toBeTruthy();
  });

  it("põe a troca no botão do cabeçalho, e não numa caixa entre os filtros", async () => {
    servidor();
    montar();

    await screen.findByRole("button", { name: /Trocar vigência/ });
    const cabecalho = screen.getByRole("banner");
    expect(within(cabecalho).getByRole("button", { name: /Trocar vigência/ })).toBeTruthy();

    /* A caixa antiga vivia entre "Tipo de ativo" e "Impacto"; as duas
       continuam, e é a ausência da terceira que este teste prende. */
    const filtros = screen.getByText("Tipo de ativo").closest("section");
    expect(filtros).not.toBeNull();
    expect(within(filtros as HTMLElement).queryByText("Vigência")).toBeNull();
    expect(within(filtros as HTMLElement).getByText("Impacto")).toBeTruthy();
  });

  it("lista as vigências com a contagem de cada uma, e todas na primeira linha", async () => {
    servidor();
    montar();

    const botao = await screen.findByRole("button", { name: /Trocar vigência/ });
    fireEvent.keyDown(botao, { key: "Enter" });

    const menu = await screen.findByRole("menu");
    const linhas = within(menu).getAllByRole("menuitem");
    expect(linhas[0].textContent).toContain("Todas as vigências");
    expect(linhas[0].textContent).toContain("500 alterações");
    expect(linhas.map((l) => l.textContent)).toEqual([
      expect.stringContaining("Todas as vigências"),
      expect.stringContaining("agosto/2026"),
      expect.stringContaining("julho/2026"),
    ]);
  });

  it("com uma vigência só não oferece troca, e nomeia a que está aberta", async () => {
    servidor([COBERTURA[2]]);
    montar();

    await screen.findByText("Tipo de ativo");
    const cabecalho = screen.getByRole("banner");
    expect(within(cabecalho).queryByRole("button", { name: /Trocar vigência/ })).toBeNull();
    expect(within(cabecalho).getByText("agosto/2026")).toBeTruthy();
    expect(within(cabecalho).queryByText("Todas as vigências")).toBeNull();
  });

  it("escolher uma vigência recorta a leitura inteira", async () => {
    const pedidos = servidor();
    montar();

    const botao = await screen.findByRole("button", { name: /Trocar vigência/ });
    fireEvent.keyDown(botao, { key: "Enter" });

    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByText("julho/2026"));

    const cabecalho = screen.getByRole("banner");
    await waitFor(() => expect(within(cabecalho).getByText("julho/2026")).toBeTruthy());
    /* 40 + 60, e não as 500 do acervo. */
    await waitFor(() =>
      expect(within(cartao("Alterações no recorte")).getByText("100")).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        pedidos.some((p) => p.includes("/justificativas/pendencias") && p.includes("cs-julho")),
      ).toBe(true),
    );
  });
});
