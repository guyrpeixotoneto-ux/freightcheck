// @vitest-environment jsdom
//
// A tela de Módulos Universais — o que o gesto da seção alcança.
//
// O que se prende aqui é o defeito que a busca escondia: a ação da seção
// gravava as chaves dos módulos **que estavam na tela**, então filtrar por
// "Panorama" e desligar a seção desligava o Panorama e dizia ter desligado a
// Visão executiva inteira. Hoje a ação é uma chave só — a da seção —, e o
// filtro não tem como estreitá-la. A tela também passou a dizer, em texto, o
// que a busca está escondendo: agir sobre a seção inteira é o certo, e deixar
// isso implícito não é.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PainelDeModulosUniversais } from "../modulos-universais";
import { chaveDaSecao, modulosPorGrupo } from "@/lib/permissoes";
import type { ModulosUniversais } from "../modulos-universais-consulta";

const enviados: Array<{ path: string; corpo: unknown }> = [];
let estado: ModulosUniversais = {
  desligadas: [],
  protegidas: ["/configuracoes", "#administracao"],
  historico: [],
};

vi.mock("@/lib/auth", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: "u1", name: "Chefe", email: "chefe@x.com", role: "ADMIN" } }),
}));

vi.mock("@/lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchJson: vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const corpo = JSON.parse(String(init.body)) as { chaves: Record<string, boolean> };
      enviados.push({ path, corpo });
      const desligadas = Object.entries(corpo.chaves)
        .filter(([, ligado]) => !ligado)
        .map(([chave]) => ({
          chave,
          desligadoEm: "2026-09-04T12:00:00.000Z",
          desligadoPor: "chefe@x.com",
          motivo: null,
        }));
      estado = { ...estado, desligadas: [...estado.desligadas, ...desligadas] };
      return estado;
    }
    return estado;
  }),
}));

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PainelDeModulosUniversais />
    </QueryClientProvider>,
  );
}

const VISAO = modulosPorGrupo().find((s) => s.secao === "visao-executiva")!;

beforeEach(() => {
  enviados.length = 0;
  estado = {
    desligadas: [],
    protegidas: ["/configuracoes", "#administracao"],
    historico: [],
  };
});

afterEach(cleanup);

describe("o filtro de busca não estreita a ação da seção", () => {
  it("com a busca ativa, desligar a seção grava a chave da seção — e nada mais", async () => {
    montar();
    await screen.findByTestId("switch-secao-visao-executiva");

    fireEvent.change(screen.getByPlaceholderText("Buscar seção ou módulo…"), {
      target: { value: "Panorama" },
    });

    /* A busca deixou um módulo na tela — e o interruptor da seção continua lá. */
    await waitFor(() => {
      expect(screen.getByTestId("switch-universal-/panorama")).toBeTruthy();
    });
    expect(screen.queryByTestId("switch-universal-/dre")).toBeNull();

    fireEvent.click(screen.getByTestId("switch-secao-visao-executiva"));

    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].corpo).toMatchObject({
      chaves: { [chaveDaSecao("visao-executiva")]: false },
    });
    /* Uma chave só: nem as visíveis, nem as escondidas. */
    expect(
      Object.keys((enviados[0].corpo as { chaves: Record<string, boolean> }).chaves),
    ).toEqual(["#visao-executiva"]);
  });

  it("a tela diz quantos módulos a busca escondeu, e que o interruptor vale para todos", async () => {
    montar();
    await screen.findByTestId("switch-secao-visao-executiva");

    fireEvent.change(screen.getByPlaceholderText("Buscar seção ou módulo…"), {
      target: { value: "Panorama" },
    });

    const total = VISAO.itens.length;
    await screen.findByText(
      new RegExp(
        `A busca está escondendo ${total - 1} de\\s+${total} módulos desta seção`,
      ),
    );
    await screen.findByText(new RegExp(`O interruptor da seção vale para os ${total}`));
  });

  it("sem busca, o aviso não aparece — ele descreve um recorte que não existe", async () => {
    montar();
    await screen.findByTestId("switch-secao-visao-executiva");

    expect(screen.queryByText(/A busca está escondendo/)).toBeNull();
  });
});

describe("a seção desligada decide pelos módulos dela na própria tela", () => {
  it("desligada a seção, os interruptores dos módulos param de aceitar clique", async () => {
    montar();
    await screen.findByTestId("switch-secao-visao-executiva");

    fireEvent.click(screen.getByTestId("switch-secao-visao-executiva"));

    await waitFor(() => {
      expect(
        screen.getByTestId("switch-universal-/panorama").getAttribute("disabled"),
      ).not.toBeNull();
    });
    await screen.findByText(/A seção inteira está fora do ar/);
  });

  it("a seção onde esta tela mora não oferece interruptor", async () => {
    montar();
    await screen.findByTestId("switch-secao-visao-executiva");

    expect(screen.queryByTestId("switch-secao-administracao")).toBeNull();
    expect(screen.getAllByText("Seção sempre ligada").length).toBeGreaterThan(0);
  });
});
