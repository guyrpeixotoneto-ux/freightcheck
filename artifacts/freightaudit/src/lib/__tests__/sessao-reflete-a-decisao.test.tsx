// @vitest-environment jsdom
//
// Desligar uma seção muda o menu **agora**, e não em até dois minutos.
//
// A lateral vem da sessão (`/auth/session`), e a sessão é uma consulta com
// `refetchInterval` de dois minutos. Se a tela de Módulos Universais dependesse
// desse relógio, quem desligasse uma seção continuaria vendo-a na lateral por
// um tempo indeterminado — e concluiria, com razão, que a decisão não pegou.
//
// O que segura isso é uma linha só: a mutação invalida `["auth","session"]` no
// sucesso. É uma linha fácil de perder num refactor e impossível de notar em
// desenvolvimento, onde se recarrega a página o tempo todo. Por isso ela tem
// prova própria, ponta a ponta: a tela grava, a sessão é relida, e a lateral
// perde a seção — tudo dentro de um teste que dura milissegundos, muito abaixo
// dos 120.000 do intervalo.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PainelDeModulosUniversais } from "@/components/configuracoes/modulos-universais";
import { navGroupsAuditoria } from "@/components/layout/nav-auditoria";
import { AuthProvider } from "@/lib/auth";
import { filtrarGrupos, usePermissoes, type Nivel } from "@/lib/permissoes";
import type { ModulosUniversais } from "@/components/configuracoes/modulos-universais-consulta";

const INTERVALO_DA_SESSAO_MS = 2 * 60 * 1000;

let desligadas: string[] = [];
const chamadas: string[] = [];

/** O que o servidor devolveria em `/auth/session` com estas chaves desligadas. */
function permissoesDaCasa(): Record<string, Nivel> {
  return Object.fromEntries(desligadas.map((c) => [c, "SEM_ACESSO" as Nivel]));
}

function estadoDosModulos(): ModulosUniversais {
  return {
    desligadas: desligadas.map((chave) => ({
      chave,
      desligadoEm: "2026-09-04T12:00:00.000Z",
      desligadoPor: "chefe@x.com",
      motivo: null,
    })),
    protegidas: ["/configuracoes", "#administracao"],
    historico: [],
  };
}

vi.mock("@/lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchJson: vi.fn(async (path: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/auth/session") {
      return {
        user: { id: "u1", name: "Chefe", email: "chefe@x.com", role: "ADMIN" },
        permissoes: permissoesDaCasa(),
        visualizacao: null,
      };
    }
    if (init?.method === "PUT") {
      const corpo = JSON.parse(String(init.body)) as { chaves: Record<string, boolean> };
      for (const [chave, ligado] of Object.entries(corpo.chaves)) {
        if (!ligado && !desligadas.includes(chave)) desligadas.push(chave);
        if (ligado) desligadas = desligadas.filter((c) => c !== chave);
      }
      return estadoDosModulos();
    }
    return estadoDosModulos();
  }),
}));

/** A lateral, reduzida ao que este teste mede: que seções sobraram. */
function LateralDeTeste() {
  const { permissoes } = usePermissoes();
  const grupos = filtrarGrupos(navGroupsAuditoria("auditoria"), permissoes);
  return (
    <ul data-testid="lateral">
      {grupos.map((g) => (
        <li key={g.id} data-testid={`secao-no-menu-${g.id}`}>
          {g.titulo}
        </li>
      ))}
    </ul>
  );
}

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <PainelDeModulosUniversais />
        <LateralDeTeste />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  desligadas = [];
  chamadas.length = 0;
});

afterEach(cleanup);

describe("a decisão chega ao menu por invalidação, e não pelo relógio", () => {
  it("desligar a seção tira a seção da lateral sem recarregar a página", async () => {
    const comecou = Date.now();
    montar();

    /* A lateral começa com a seção no ar. */
    await screen.findByTestId("secao-no-menu-visao-executiva");

    fireEvent.click(await screen.findByTestId("switch-secao-visao-executiva"));

    await waitFor(
      () => {
        expect(screen.queryByTestId("secao-no-menu-visao-executiva")).toBeNull();
      },
      { timeout: 3_000 },
    );

    /*
      A prova de que não foi o `refetchInterval`: o teste inteiro coube em menos
      tempo do que o intervalo — muito menos —, então a única releitura possível
      da sessão é a que a invalidação pediu.
    */
    expect(Date.now() - comecou).toBeLessThan(INTERVALO_DA_SESSAO_MS);
    expect(chamadas.filter((c) => c === "GET /auth/session").length).toBeGreaterThan(1);

    /* E as outras seções continuam onde estavam. */
    expect(screen.getByTestId("secao-no-menu-chamados-ambev")).toBeTruthy();
  });

  it("ligar a seção de volta devolve a seção à lateral, na mesma sessão", async () => {
    desligadas = ["#visao-executiva"];
    montar();

    /*
      A primeira pintura acontece antes de `/auth/session` responder, e ali o
      mapa de permissões ainda está vazio — quer dizer, o menu inteiro no ar.
      Esperar a seção **sumir** é esperar a sessão chegar; espiar antes disso
      mediria o estado de carregamento, e não a decisão.
    */
    await waitFor(() => {
      expect(screen.queryByTestId("secao-no-menu-visao-executiva")).toBeNull();
    });
    expect(screen.getByTestId("secao-no-menu-chamados-ambev")).toBeTruthy();

    fireEvent.click(await screen.findByTestId("switch-secao-visao-executiva"));

    await waitFor(
      () => {
        expect(screen.getByTestId("secao-no-menu-visao-executiva")).toBeTruthy();
      },
      { timeout: 3_000 },
    );
  });

  it("desligar um módulo tira só aquele item, e a seção fica", async () => {
    montar();
    await screen.findByTestId("secao-no-menu-visao-executiva");

    fireEvent.click(await screen.findByTestId("switch-universal-/dre"));

    await waitFor(
      () => {
        expect(desligadas).toEqual(["/dre"]);
      },
      { timeout: 3_000 },
    );
    expect(screen.getByTestId("secao-no-menu-visao-executiva")).toBeTruthy();
  });
});
