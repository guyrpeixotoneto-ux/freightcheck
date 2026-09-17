// @vitest-environment jsdom
//
// CLASSIFICAR E APLICAR — o botão que muda o número, visto da tela.
//
// A prova de que a aplicação funciona é de banco e mora em
// `lib/ingest/src/financiamento-real/__tests__/decisao-aplicada.test.ts`: lá o
// valor sai da fila e entra no realizado, na tabela e no total. O que **esta**
// tela pode errar é outra coisa, e é o que se prende aqui:
//
//  - chamar a rota que só registra, e não a que aplica. As duas existem, têm
//    corpos idênticos e respondem 201 — o engano seria invisível: a tela diria
//    "pronto" e o número continuaria o mesmo, que é exatamente o defeito que
//    esta mudança existe para acabar;
//  - prometer no botão o que não faz. "Classificar" descreve o registro;
//    aplicar é o que acontece;
//  - deixar os números velhos em tela depois de mudá-los. Aplicar mexe no
//    confronto, nos cartões e nos totais, e sem invalidar as consultas a
//    pendência some com o resto da tela desatualizado ao lado.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PendenciasDoReal } from "../pendencias-do-real";

const PENDENCIAS = {
  duplicatas: [],
  semClassificacao: [
    {
      placa: "RPO0J60",
      competencias: ["2026-05-01", "2026-06-01"],
      lancamentos: 8,
      valor: 44326.64,
      contas: ["C.D.C. - VP"],
    },
  ],
  valorRetido: 0,
  valorSemClassificacao: 44326.64,
};

const APLICADA = {
  decisaoId: "d1",
  aplicada: true,
  lancamentosAfetados: 8,
  competencias: ["2026-05-01", "2026-06-01"],
  placas: ["RPO0J60"],
  valor: 44326.64,
  revisoes: [{ label: "EMPURRADA_MENSAL_5_2026", revisao: 2, snapshotId: "s1", fatos: 3 }],
  importRunIds: ["r1"],
  efeito:
    "Aplicada: R$ 44.326,64 entraram no realizado das competências 2026-05-01, 2026-06-01.",
};

/* O Radix mede e ancora o menu com APIs que o jsdom não traz. Nenhuma delas é
   o que estes casos provam — o que eles provam é para onde a escolha vai e o
   que ela leva no corpo. */
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

/** As chamadas que a tela fez, na ordem — é sobre elas que os testes falam. */
let chamadas: { url: string; method: string; body: unknown }[];

function responder(corpo: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  } as unknown as Response;
}

beforeEach(() => {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      chamadas.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.includes("/decisoes/aplicar")) return responder(APLICADA);
      return responder(PENDENCIAS);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function montar(): QueryClient {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cliente}>
      <PendenciasDoReal />
    </QueryClientProvider>,
  );
  return cliente;
}

describe("a fila de placas sem tipo", () => {
  it("o botão promete aplicar, e não só classificar", async () => {
    montar();
    expect(await screen.findByTestId("classificar-e-aplicar")).toHaveProperty(
      "textContent",
      "Classificar e aplicar",
    );
  });

  it("responder chama a rota que aplica, com o tipo e o motivo", async () => {
    montar();
    await screen.findByTestId("placa-sem-tipo");

    fireEvent.change(screen.getByPlaceholderText("Como se sabe?"), {
      target: { value: "Conferido no cadastro da transportadora." },
    });
    /*
      O `Select` do design system não é um `<select>` nativo, e abri-lo num jsdom
      depende de medições que ele não tem. O que este teste precisa provar é o
      contrato com o servidor — que a tela manda `CLASSIFICAR_ATIVO`, a placa, o
      tipo escolhido e o motivo para a rota que aplica —, e o tipo entra pelo
      caminho que o componente usa de verdade: o primeiro item da lista.
    */
    fireEvent.keyDown(screen.getByTestId("tipo-do-ativo"), { key: "Enter" });
    const opcao = await screen.findByRole("option", { name: "CAVALO" });
    fireEvent.click(opcao);

    fireEvent.click(screen.getByTestId("classificar-e-aplicar"));

    await waitFor(() => {
      expect(chamadas.some((c) => c.url.includes("/decisoes/aplicar"))).toBe(true);
    });
    const pedido = chamadas.find((c) => c.url.includes("/decisoes/aplicar"))!;
    expect(pedido.method).toBe("POST");
    expect(pedido.body).toMatchObject({
      tipo: "CLASSIFICAR_ATIVO",
      chave: "RPO0J60",
      valor: "CAVALO",
      motivo: "Conferido no cadastro da transportadora.",
    });

    /* A tela diz o que aconteceu, com as palavras do servidor. */
    expect(await screen.findByText(/Aplicada: R\$ 44\.326,64/)).toBeTruthy();
  });

  it("depois de aplicar, a tela busca de novo o que acabou de mudar", async () => {
    const cliente = montar();
    await screen.findByTestId("placa-sem-tipo");
    const invalidadas: unknown[] = [];
    const original = cliente.invalidateQueries.bind(cliente);
    cliente.invalidateQueries = ((filtros: { queryKey?: unknown }) => {
      invalidadas.push(filtros.queryKey);
      return original(filtros as never);
    }) as typeof cliente.invalidateQueries;

    fireEvent.change(screen.getByPlaceholderText("Como se sabe?"), {
      target: { value: "Conferido no cadastro da transportadora." },
    });
    fireEvent.keyDown(screen.getByTestId("tipo-do-ativo"), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "CAVALO" }));
    fireEvent.click(screen.getByTestId("classificar-e-aplicar"));

    await waitFor(() => {
      expect(invalidadas).toEqual([
        ["financiamento-real"],
        ["finame"],
        ["snapshots"],
      ]);
    });
  });
});
