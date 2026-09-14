// @vitest-environment jsdom
//
// Arquivar, ao lado de cada interruptor: tira da lista, e não do banco.
//
// Desligar já tirava a chave do menu de todo mundo, e não tirava desta tela:
// uma casa que não usa dois terços do produto administrava acesso rolando uma
// lista em que quase tudo estava riscado. O pedido que originou o gesto foi
// literal — "que pareça que eu apaguei, sem perder o trabalho".
//
// O que se prende aqui:
//
// 1. **o botão só existe sobre o que já está desligado** — o servidor recusa
//    arquivar o que está no ar, e a tela não oferece o gesto onde ele seria
//    recusado;
// 2. **arquivar some com a linha** e a põe na gaveta, com quem arquivou e
//    quando — a prova de que não se apagou nada;
// 3. **desarquivar devolve a linha à lista**, ainda fora do ar;
// 4. **a seção também se arquiva**, e leva os módulos dela junto: ela é uma
//    chave só, e foi essa chave que alguém tirou da vista.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PainelDeModulosUniversais } from "../modulos-universais";
import { chaveDaSecao, modulosPorGrupo } from "@/lib/permissoes";
import type { ModulosUniversais } from "../modulos-universais-consulta";

/* A montagem desta tela é a mais cara da suíte — o catálogo inteiro, com um
   `Switch` do Radix por linha. Os prazos são generosos porque não é isso que
   se mede aqui. */
const PRAZO = 30_000;
const ESPERA = { timeout: 15_000 };

const VISAO = modulosPorGrupo().find((s) => s.secao === "visao-executiva")!;
const MODULO = VISAO.itens[0]!.chave;
const SECAO = chaveDaSecao(VISAO.secao);

const enviados: Array<{ path: string; corpo: unknown }> = [];
/** O banco do servidor de mentira: chave → quando foi arquivada (ou nula). */
let noServidor = new Map<string, string | null>();

const espelho = (): ModulosUniversais => ({
  desligadas: [...noServidor].map(([chave, arquivadoEm]) => ({
    chave,
    desligadoEm: "2026-09-04T12:00:00.000Z",
    desligadoPor: "chefe@x.com",
    motivo: null,
    arquivadoEm,
    arquivadoPor: arquivadoEm === null ? null : "chefe@x.com",
  })),
  protegidas: ["/configuracoes", "#administracao"],
  historico: [],
});

vi.mock("@/lib/auth", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: "u1", name: "Chefe", email: "chefe@x.com", role: "ADMIN" },
  }),
}));

vi.mock("@/lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchJson: vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const corpo = JSON.parse(String(init.body)) as {
        chaves: Record<string, boolean>;
      };
      enviados.push({ path, corpo });
      if (path === "/modulos-universais/arquivadas") {
        for (const [chave, arquivado] of Object.entries(corpo.chaves)) {
          /* O servidor recusa arquivar o que está no ar; aqui ele simplesmente
             não tem linha onde gravar, que é a mesma verdade. */
          if (!noServidor.has(chave)) continue;
          noServidor.set(chave, arquivado ? "2026-09-14T10:00:00.000Z" : null);
        }
        return espelho();
      }
      for (const [chave, ligado] of Object.entries(corpo.chaves)) {
        if (ligado) noServidor.delete(chave);
        else noServidor.set(chave, null);
      }
      return espelho();
    }
    return espelho();
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

beforeEach(() => {
  enviados.length = 0;
  noServidor = new Map();
});

afterEach(cleanup);

describe("arquivar mora ao lado de inativar", () => {
  it(
    "não se oferece sobre o que está no ar — primeiro desliga, depois arruma",
    async () => {
      montar();
      await screen.findByTestId(`switch-universal-${MODULO}`, {}, ESPERA);
      expect(screen.queryByTestId(`arquivar-${MODULO}`)).toBeNull();

      fireEvent.click(screen.getByTestId(`switch-universal-${MODULO}`));
      await screen.findByTestId(`arquivar-${MODULO}`, {}, ESPERA);
    },
    PRAZO,
  );

  it(
    "arquivar some com a linha e a guarda na gaveta, com quem e quando",
    async () => {
      noServidor.set(MODULO, null);
      montar();
      await screen.findByTestId(`arquivar-${MODULO}`, {}, ESPERA);
      /* A gaveta não existe enquanto não há nada dentro dela. */
      expect(screen.queryByTestId("gaveta-de-arquivados")).toBeNull();

      fireEvent.click(screen.getByTestId(`arquivar-${MODULO}`));

      /* A linha sai da lista — é o "parece que eu apaguei". */
      await waitFor(
        () => expect(screen.queryByTestId(`switch-universal-${MODULO}`)).toBeNull(),
        ESPERA,
      );

      /* E está guardada, com autor e data — é o "sem perder o trabalho". */
      fireEvent.click(await screen.findByTestId("gaveta-de-arquivados", {}, ESPERA));
      await screen.findByTestId(`desarquivar-${MODULO}`, {}, ESPERA);
      expect(screen.getByText(/arquivado por chefe@x.com/)).toBeTruthy();

      /* Nada foi religado: o pedido foi para a rota do arquivamento, e a chave
         continua desligada no servidor. */
      expect(enviados.at(-1)?.path).toBe("/modulos-universais/arquivadas");
      expect(noServidor.has(MODULO)).toBe(true);
    },
    PRAZO,
  );

  it(
    "desarquivar devolve a linha à lista, ainda fora do ar",
    async () => {
      noServidor.set(MODULO, "2026-09-14T10:00:00.000Z");
      montar();

      const gaveta = await screen.findByTestId("gaveta-de-arquivados", {}, ESPERA);
      expect(screen.queryByTestId(`switch-universal-${MODULO}`)).toBeNull();

      fireEvent.click(gaveta);
      fireEvent.click(await screen.findByTestId(`desarquivar-${MODULO}`, {}, ESPERA));

      const interruptor = await screen.findByTestId(
        `switch-universal-${MODULO}`,
        {},
        ESPERA,
      );
      expect(interruptor.getAttribute("aria-checked")).toBe("false");
      expect(noServidor.get(MODULO)).toBeNull();
    },
    PRAZO,
  );

  it(
    "a seção desligada também se arquiva, e leva os módulos dela junto",
    async () => {
      noServidor.set(SECAO, null);
      montar();

      fireEvent.click(await screen.findByTestId(`arquivar-${SECAO}`, {}, ESPERA));

      await waitFor(
        () => expect(screen.queryByTestId(`switch-secao-${VISAO.secao}`)).toBeNull(),
        ESPERA,
      );
      for (const item of VISAO.itens) {
        expect(screen.queryByTestId(`switch-universal-${item.chave}`)).toBeNull();
      }
      await screen.findByTestId("gaveta-de-arquivados", {}, ESPERA);
    },
    PRAZO,
  );

  it(
    "o módulo que a seção derrubou não oferece arquivar — a decisão não é dele",
    async () => {
      noServidor.set(SECAO, null);
      montar();

      await screen.findByTestId(`switch-universal-${MODULO}`, {}, ESPERA);
      expect(screen.queryByTestId(`arquivar-${MODULO}`)).toBeNull();
      /* A da seção, sim: é ela que está desligada por decisão própria. */
      expect(screen.getByTestId(`arquivar-${SECAO}`)).toBeTruthy();
    },
    PRAZO,
  );
});
