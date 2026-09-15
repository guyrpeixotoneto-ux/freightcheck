// @vitest-environment jsdom
//
// O seletor de vigência do cabeçalho do módulo — Visão Geral, Linha do Tempo,
// Dashboard e Gestão à Vista.
//
// A mesma frase do menu "De" das auditorias, no outro lugar em que ela valia:
// as duas colunas do menu (o impacto e a contagem de alterações) esperavam o
// clique que abre a lista, e apareciam depois dele. Aqui se abre o menu e se
// olha o que está escrito — e se confere que abrir não foi o que disparou a
// leitura.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeletorDeVigenciaGeral } from "../seletor-de-vigencia";

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

const pedidos: string[] = [];

vi.mock("@/lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchJsonOrNull: vi.fn(async (caminho: string) => {
    pedidos.push(caminho);
    return {
      serie: [
        { period: "2026-07-01", changes: 6, impact: { byPeriodicity: { MENSAL: -1200 } } },
        { period: "2026-08-01", changes: 714, impact: { byPeriodicity: { MENSAL: -82140 } } },
      ],
    };
  }),
}));

const PERIODOS = ["2026-08-01", "2026-07-01", "2026-06-01"];

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SeletorDeVigenciaGeral periodos={PERIODOS} ativa="2026-08-01" onTrocar={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  pedidos.length = 0;
});

afterEach(cleanup);

describe("o seletor de vigência do módulo", () => {
  it("lê o histórico assim que a tela monta, sem ninguém abrir o menu", async () => {
    montar();
    await waitFor(() => expect(pedidos.length).toBe(1));
    expect(pedidos[0]).toContain("/changes/range/overview");
  });

  it("abre com as duas colunas já escritas", async () => {
    montar();
    await waitFor(() => expect(pedidos.length).toBe(1));

    /* O Radix abre o menu no `pointerdown`/teclado, e não num `click`
       sintético — `Enter` no gatilho é o gesto de quem navega pelo teclado. */
    fireEvent.keyDown(screen.getByText("Trocar vigência"), { key: "Enter" });

    expect(await screen.findByText("714 alterações")).toBeTruthy();
    expect(screen.getByText("6 alterações")).toBeTruthy();
    // Abrir não pediu nada: o que está na lista já estava carregado.
    expect(pedidos.length).toBe(1);
  });
});
