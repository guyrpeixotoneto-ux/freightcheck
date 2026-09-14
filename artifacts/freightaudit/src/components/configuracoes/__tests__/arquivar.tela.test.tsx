// @vitest-environment jsdom
//
// Arquivar tira da lista, e não do banco.
//
// Desligar já tirava do menu de todo mundo, e não tirava da tela onde a decisão
// se toma: uma casa que não usa dois terços do produto passava a administrar
// acesso dentro de uma matriz em que quase tudo estava riscado — as vinte
// linhas que ela usa de verdade perdidas entre as quarenta e sete que ninguém
// vai olhar de novo. O pedido que originou este gesto foi literal: "que pareça
// que eu apaguei, sem perder o trabalho".
//
// É isso que estes casos cobram, e nesta ordem:
//
// 1. **o gesto só existe sobre o que está fora do ar** — arrumar a lista não
//    pode derrubar tela de ninguém por tabela, e a tela não oferece o botão
//    onde o servidor o recusaria;
// 2. **arquivar some com a linha da matriz** e a põe na gaveta, com quem
//    arquivou e quando — que é a prova de que não se apagou nada;
// 3. **desarquivar devolve a linha à matriz**, ainda fora do ar: quem religa é
//    o outro botão;
// 4. **a seção arquivada leva os módulos dela junto** — ela é uma chave só, e
//    foi essa chave que alguém tirou da vista.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PainelDePermissoes } from "../permissoes";
import { chaveDaSecao, modulosPorGrupo, type Nivel } from "@/lib/permissoes";
import type { ModulosUniversais } from "../modulos-universais-consulta";

/* Chaves reais do catálogo, e não literais: a lista é o próprio menu, e um
   literal aqui envelheceria no dia em que o endereço de uma tela mudasse. */
const VISAO = modulosPorGrupo().find((s) => s.secao === "visao-executiva")!;
const MODULO = VISAO.itens[0]!.chave;
const SECAO = chaveDaSecao(VISAO.secao);

const ESPERA = { timeout: 15_000 };
const PRAZO = 30_000;

const GESTOR = {
  id: "11111111-1111-1111-1111-111111111111",
  nome: "Gestor",
  descricao: "Usa o produto inteiro.",
  gerenciaContas: false,
  nivelPadrao: "EDITAR" as Nivel,
  sistema: true,
  criadoEm: "2026-09-01T00:00:00.000Z",
  criadoPor: null,
  contas: 3,
  restricoes: 0,
};

/** O banco do servidor de mentira: chave → quando foi arquivada (ou nula). */
let noServidor = new Map<string, string | null>();

const espelho = (): ModulosUniversais => ({
  desligadas: [...noServidor].map(([chave, arquivadoEm]) => ({
    chave,
    desligadoEm: "2026-09-13T17:48:22.000Z",
    desligadoPor: "chefe@x.com",
    motivo: null,
    arquivadoEm,
    arquivadoPor: arquivadoEm === null ? null : "chefe@x.com",
  })),
  protegidas: ["/configuracoes", "#administracao"],
  historico: [],
});

const detalhe = () => ({
  papel: GESTOR,
  permissoes: {},
  universaisDesligadas: [...noServidor.keys()].sort(),
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
        chaves?: Record<string, boolean>;
      };
      if (path === "/modulos-universais/arquivadas") {
        for (const [chave, arquivado] of Object.entries(corpo.chaves ?? {})) {
          /* O servidor recusa arquivar o que está no ar; aqui ele simplesmente
             não tem linha onde gravar, que é a mesma verdade. */
          if (!noServidor.has(chave)) continue;
          noServidor.set(chave, arquivado ? "2026-09-14T10:00:00.000Z" : null);
        }
        return espelho();
      }
      for (const [chave, ligado] of Object.entries(corpo.chaves ?? {})) {
        if (ligado) noServidor.delete(chave);
        else noServidor.set(chave, null);
      }
      return path === "/modulos-universais" ? espelho() : detalhe();
    }
    if (path === "/papeis") return [GESTOR];
    if (path.startsWith("/papeis/")) return detalhe();
    return espelho();
  }),
}));

function montar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PainelDePermissoes />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  noServidor = new Map();
});

afterEach(cleanup);

describe("arquivar, na matriz da casa", () => {
  it(
    "não se oferece sobre o que está no ar — primeiro desliga, depois arruma",
    async () => {
      montar();
      await screen.findByTestId(`inativar-${MODULO}`, {}, ESPERA);
      expect(screen.queryByTestId(`arquivar-${MODULO}`)).toBeNull();

      fireEvent.click(screen.getByTestId(`inativar-${MODULO}`));
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

      /* A linha sai da matriz — é o "parece que eu apaguei". */
      await waitFor(
        () => expect(screen.queryByTestId(`inativar-${MODULO}`)).toBeNull(),
        ESPERA,
      );

      /* E está guardada, com o autor e a data — é o "sem perder o trabalho". */
      const gaveta = await screen.findByTestId("gaveta-de-arquivados", {}, ESPERA);
      fireEvent.click(gaveta);
      const volta = await screen.findByTestId(`desarquivar-${MODULO}`, {}, ESPERA);
      expect(volta).toBeTruthy();
      expect(screen.getByText(/arquivado por chefe@x.com/)).toBeTruthy();

      /* Nada foi religado: a chave continua desligada no servidor. */
      expect(noServidor.has(MODULO)).toBe(true);
    },
    PRAZO,
  );

  it(
    "desarquivar devolve a linha à matriz, ainda fora do ar",
    async () => {
      noServidor.set(MODULO, "2026-09-14T10:00:00.000Z");
      montar();

      const gaveta = await screen.findByTestId("gaveta-de-arquivados", {}, ESPERA);
      expect(screen.queryByTestId(`inativar-${MODULO}`)).toBeNull();

      fireEvent.click(gaveta);
      fireEvent.click(await screen.findByTestId(`desarquivar-${MODULO}`, {}, ESPERA));

      const botao = await screen.findByTestId(`inativar-${MODULO}`, {}, ESPERA);
      /* De volta à lista e ainda desligada: `aria-pressed` é o interruptor. */
      expect(botao.getAttribute("aria-pressed")).toBe("true");
      expect(noServidor.get(MODULO)).toBeNull();
    },
    PRAZO,
  );

  it(
    "a seção arquivada leva os módulos dela junto",
    async () => {
      noServidor.set(SECAO, "2026-09-14T10:00:00.000Z");
      montar();

      await screen.findByTestId("gaveta-de-arquivados", {}, ESPERA);
      for (const item of VISAO.itens) {
        expect(screen.queryByTestId(`inativar-${item.chave}`)).toBeNull();
      }
      expect(screen.queryByText(VISAO.grupo)).toBeNull();
    },
    PRAZO,
  );
});
