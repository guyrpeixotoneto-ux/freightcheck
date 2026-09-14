// @vitest-environment jsdom
//
// A tela não desfaz sozinha o que a casa acabou de decidir.
//
// Dois defeitos desta tela produziam, cada um por seu caminho, o mesmo sintoma
// relatado: "desliguei, ele confirmou, e depois voltou ligado sozinho".
//
// 1. **Respostas fora de ordem.** Cada clique dispara um `PUT`, e o `onSuccess`
//    escreve no cache a lista inteira que o servidor devolveu. Com dois cliques
//    seguidos e duas respostas em voo, quem vence é a que **chega** por último —
//    e a resposta do primeiro pedido não conhece o segundo desligamento. A
//    captura do incidente tem quatro decisões em quatro segundos (17:48:22 a
//    :25), que é exatamente essa janela.
// 2. **Leitura ausente desenhada como "tudo ligado".** `desligadas` nasce de
//    `data?.desligadas ?? []`, e conjunto vazio faz todo interruptor aparecer
//    ligado. Uma leitura que falhou ficava indistinguível de uma casa que não
//    desligou nada.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PainelDeModulosUniversais } from "../modulos-universais";
import { modulosPorGrupo } from "@/lib/permissoes";
import type { ModulosUniversais } from "../modulos-universais-consulta";

/*
  Duas chaves reais do catálogo, e não literais: a lista é o próprio menu, e um
  literal aqui envelheceria no dia em que o endereço de uma tela mudasse. As duas
  primeiras da Visão executiva servem — o que se mede é a ordem das respostas, e
  não quais chaves são.
*/
const VISAO = modulosPorGrupo().find((s) => s.secao === "visao-executiva")!;
const PRIMEIRA = VISAO.itens[0]!.chave;
const SEGUNDA = VISAO.itens[1]!.chave;

const PRAZO = 30_000;
const ESPERA = { timeout: 15_000 };

/** O que o servidor tem guardado — a fonte da verdade, como no banco. */
let noServidor = new Set<string>();
/** Quanto cada resposta demora para **chegar**, na ordem em que os PUTs saem. */
let atrasos: number[] = [];
let putsFeitos = 0;
/** Quantas respostas de `PUT` já **chegaram** — é a ordem de chegada que importa. */
let respostasEntregues = 0;
let lerFalha = false;

const espelho = (): ModulosUniversais => ({
  desligadas: [...noServidor].map((chave) => ({
    chave,
    desligadoEm: "2026-09-13T17:48:22.000Z",
    desligadoPor: "chefe@x.com",
    motivo: null,
    arquivadoEm: null,
    arquivadoPor: null,
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
  fetchJson: vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const corpo = JSON.parse(String(init.body)) as {
        chaves: Record<string, boolean>;
      };
      /*
        O servidor aplica e fotografa na hora em que **atende** — é o que o
        endpoint real faz, dentro da transação. O atraso abaixo é de entrega da
        resposta, e não de processamento: é assim que uma resposta antiga chega
        depois de uma nova.
      */
      for (const [chave, ligado] of Object.entries(corpo.chaves)) {
        if (ligado) noServidor.delete(chave);
        else noServidor.add(chave);
      }
      const foto = espelho();
      const atraso = atrasos[putsFeitos++] ?? 0;
      if (atraso > 0) await new Promise((r) => setTimeout(r, atraso));
      respostasEntregues++;
      return foto;
    }
    if (lerFalha) throw new Error("o servidor não respondeu");
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

const ligado = (chave: string): boolean =>
  screen.getByTestId(`switch-universal-${chave}`).getAttribute("data-state") ===
  "checked";

beforeEach(() => {
  noServidor = new Set();
  atrasos = [];
  putsFeitos = 0;
  respostasEntregues = 0;
  lerFalha = false;
});

afterEach(cleanup);

describe("dois desligamentos seguidos", () => {
  it(
    "a resposta atrasada do primeiro não devolve o segundo ao ar",
    async () => {
      /*
      O primeiro `PUT` responde 200 ms depois do segundo. Sem a fila do `scope`,
      a resposta dele — que só conhece `/qlp` — chega por último e sobrescreve o
      cache, e `/frota` reaparece ligado com o banco já correto por baixo.
    */
      atrasos = [200, 0];
      montar();
      await screen.findByTestId(`switch-universal-${PRIMEIRA}`, {}, ESPERA);

      fireEvent.click(screen.getByTestId(`switch-universal-${PRIMEIRA}`));
      fireEvent.click(screen.getByTestId(`switch-universal-${SEGUNDA}`));

      /*
      As **duas** respostas têm de ter chegado antes da conferência: o defeito
      só aparece quando a atrasada aterrissa, e conferir antes dela seria
      conferir justamente o instante em que a tela ainda está certa.
    */
      await waitFor(() => expect(respostasEntregues).toBe(2), ESPERA);
      await waitFor(() => {
        expect(ligado(PRIMEIRA)).toBe(false);
        expect(ligado(SEGUNDA)).toBe(false);
      }, ESPERA);

      /* E o banco simulado concorda com a tela — que é a outra metade. */
      expect([...noServidor].sort()).toEqual([PRIMEIRA, SEGUNDA].sort());
    },
    PRAZO,
  );
});

describe("quando a leitura não volta", () => {
  it(
    "a tela não desenha interruptor nenhum — ausência de resposta não é 'tudo ligado'",
    async () => {
      lerFalha = true;
      montar();

      await screen.findByText(
        /O que esta casa desligou não pôde ser lido/,
        {},
        ESPERA,
      );
      expect(screen.queryByTestId(`switch-universal-${PRIMEIRA}`)).toBeNull();
      expect(screen.queryByTestId("switch-secao-visao-executiva")).toBeNull();
    },
    PRAZO,
  );
});
