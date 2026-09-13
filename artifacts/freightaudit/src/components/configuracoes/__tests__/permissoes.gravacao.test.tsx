// @vitest-environment jsdom
//
// A tela não desfaz sozinha o que a casa acabou de decidir.
//
// Dois defeitos produziam, cada um por seu caminho, o mesmo sintoma relatado:
// "desliguei, ele confirmou, e depois voltou ligado sozinho".
//
// 1. **Respostas fora de ordem.** Cada clique dispara um `PUT`, e o `onSuccess`
//    escreve no cache a lista inteira que o servidor devolveu. Com dois cliques
//    seguidos e duas respostas em voo, quem vence é a que **chega** por último —
//    e a resposta do primeiro pedido não conhece o segundo desligamento. A
//    captura do incidente tem quatro decisões em quatro segundos (17:48:22 a
//    :25), que é exatamente essa janela.
// 2. **Leitura ausente desenhada como "tudo ligado".** As listas nascem de
//    `data?.… ?? []`, e conjunto vazio faz todo módulo aparecer no ar. Uma
//    leitura que falhou ficava indistinguível de uma casa que não desligou nada.
//
// Os dois casos nasceram na tela de Módulos Universais e vieram junto com ela
// quando Permissões absorveu a decisão da casa: a fila é a mesma (agora por
// `scope`, um para a casa e um por perfil) e a recusa de desenhar sem leitura
// passou a exigir **as duas** leituras — a do perfil e a da casa.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PainelDePermissoes } from "../permissoes";
import { modulosPorGrupo, type Nivel } from "@/lib/permissoes";
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

/** O que o servidor tem guardado — a fonte da verdade, como no banco. */
let noServidor = new Set<string>();
/** O que o perfil fecha, chave a chave. A outra metade da fonte da verdade. */
let fechados: Record<string, Nivel> = {};
/** Quanto cada resposta demora para **chegar**, na ordem em que os PUTs saem. */
let atrasos: number[] = [];
let putsFeitos = 0;
/** Quantas respostas de `PUT` já **chegaram** — é a ordem de chegada que importa. */
let respostasEntregues = 0;
/** `partiu <chave>` e `chegou <chave>`, na ordem real — a fila lida de fora. */
let ordem: string[] = [];
let lerFalha = false;

const espelho = (): ModulosUniversais => ({
  desligadas: [...noServidor].map((chave) => ({
    chave,
    desligadoEm: "2026-09-13T17:48:22.000Z",
    desligadoPor: "chefe@x.com",
    motivo: null,
  })),
  protegidas: ["/configuracoes", "#administracao"],
  historico: [],
});

const detalhe = () => ({
  papel: GESTOR,
  permissoes: { ...fechados },
  universaisDesligadas: [...noServidor].sort(),
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
        niveis?: Record<string, Nivel>;
      };
      /*
        O servidor aplica e fotografa na hora em que **atende** — é o que o
        endpoint real faz, dentro da transação. O atraso abaixo é de entrega da
        resposta, e não de processamento: é assim que uma resposta antiga chega
        depois de uma nova.
      */
      const alvo = Object.keys(corpo.chaves ?? corpo.niveis ?? {})[0]!;
      ordem.push(`partiu ${alvo}`);
      for (const [chave, ligado] of Object.entries(corpo.chaves ?? {})) {
        if (ligado) noServidor.delete(chave);
        else noServidor.add(chave);
      }
      for (const [chave, nivel] of Object.entries(corpo.niveis ?? {})) {
        if (nivel === "EDITAR") delete fechados[chave];
        else fechados[chave] = nivel;
      }
      const foto = path === "/modulos-universais" ? espelho() : detalhe();
      const atraso = atrasos[putsFeitos++] ?? 0;
      if (atraso > 0) await new Promise((r) => setTimeout(r, atraso));
      ordem.push(`chegou ${alvo}`);
      respostasEntregues++;
      return foto;
    }
    /*
      A lista de perfis responde mesmo na falha, e é de propósito: o que este
      caso mede é o **guarda da matriz**, e ele mora dentro do perfil escolhido.
      Derrubar a lista junto pararia a tela um passo antes, no aviso de "a lista
      de perfis não pôde ser carregada" — honesto, mas outra coisa.
    */
    if (path === "/papeis") return [GESTOR];
    if (lerFalha) throw new Error("o servidor não respondeu");
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

/**
 * O módulo está no ar? O botão marcado (`aria-pressed`) é o de **Inativar**
 * quando ele não está — é o mesmo estado que o interruptor de antes mostrava.
 */
const noAr = (chave: string): boolean =>
  screen.getByTestId(`inativar-${chave}`).getAttribute("aria-pressed") ===
  "false";

/**
 * Deixa a tela assentar depois da última resposta.
 *
 * Sem isto, a conferência acontece entre a chegada da resposta atrasada e o
 * `onSuccess` que a escreve no cache — quer dizer, antes do defeito. `act`
 * drena o que o React tem pendente; o `setTimeout` dá margem para a escrita e
 * a repintura.
 */
async function assentar(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
}

/** O botão está marcado — o nível que a matriz diz estar valendo naquela linha. */
const marcado = (testid: string): boolean =>
  screen.getByTestId(testid).getAttribute("aria-pressed") === "true";

beforeEach(() => {
  noServidor = new Set();
  fechados = {};
  atrasos = [];
  putsFeitos = 0;
  respostasEntregues = 0;
  ordem = [];
  lerFalha = false;
});

afterEach(cleanup);

describe("duas decisões seguidas sobre o mesmo perfil", () => {
  /*
    O que estes dois casos cobram é **a fila**, e não o estado final da tela.

    O estado final está protegido duas vezes aqui, e a segunda é por acidente:
    `CHAVE_DOS_PERFIS` (`["papeis"]`) é prefixo de `CHAVE_DO_DETALHE`
    (`["papeis", id]`), então o `invalidateQueries` de cada `onSuccess` também
    relê o detalhe — e a releitura chega depois de qualquer resposta atrasada.
    Um teste de estado final passaria com a fila e sem ela, e não diria nada
    sobre o que o `scope` garante.

    O que ele garante é o que importa do lado do servidor: **o segundo `PUT` só
    parte depois de a resposta do primeiro chegar.** Cada `PUT` lê o estado
    atual antes de decidir o que mudou, e dois em voo ao mesmo tempo leem o
    mesmo "antes" — o histórico do perfil sairia dizendo que as duas decisões
    partiram do mesmo nível anterior, que é uma afirmação falsa sobre quem mudou
    o quê, e ela não é reparável depois.
  */
  const EM_FILA = (a: string, b: string) => [
    `partiu ${a}`,
    `chegou ${a}`,
    `partiu ${b}`,
    `chegou ${b}`,
  ];

  it(
    "o segundo PUT só parte depois de a resposta do primeiro chegar",
    async () => {
      /* O primeiro responde 200 ms depois; sem fila, o segundo partiria já. */
      atrasos = [200, 0];
      montar();
      await screen.findByTestId(`nivel-SEM_ACESSO-${PRIMEIRA}`, {}, ESPERA);

      fireEvent.click(screen.getByTestId(`nivel-SEM_ACESSO-${PRIMEIRA}`));
      fireEvent.click(screen.getByTestId(`nivel-SEM_ACESSO-${SEGUNDA}`));

      /*
        As **duas** respostas têm de ter chegado antes da conferência: o defeito
        só aparece quando a atrasada aterrissa, e conferir antes dela seria
        conferir justamente o instante em que a tela ainda está certa.
      */
      await waitFor(() => expect(respostasEntregues).toBe(2), ESPERA);
      await assentar();

      expect(ordem).toEqual(EM_FILA(PRIMEIRA, SEGUNDA));

      /* E as duas decisões estão no servidor e na tela, que é a outra metade. */
      expect(Object.keys(fechados).sort()).toEqual([PRIMEIRA, SEGUNDA].sort());
      expect(marcado(`nivel-SEM_ACESSO-${PRIMEIRA}`)).toBe(true);
      expect(marcado(`nivel-SEM_ACESSO-${SEGUNDA}`)).toBe(true);
    },
    PRAZO,
  );

  it(
    "o mesmo vale para Inativar, que é a decisão da casa",
    async () => {
      atrasos = [200, 0];
      montar();
      await screen.findByTestId(`inativar-${PRIMEIRA}`, {}, ESPERA);

      fireEvent.click(screen.getByTestId(`inativar-${PRIMEIRA}`));
      fireEvent.click(screen.getByTestId(`inativar-${SEGUNDA}`));

      await waitFor(() => expect(respostasEntregues).toBe(2), ESPERA);
      await assentar();

      expect(ordem).toEqual(EM_FILA(PRIMEIRA, SEGUNDA));
      expect([...noServidor].sort()).toEqual([PRIMEIRA, SEGUNDA].sort());
      expect(noAr(PRIMEIRA)).toBe(false);
      expect(noAr(SEGUNDA)).toBe(false);

      expect([...noServidor].sort()).toEqual([PRIMEIRA, SEGUNDA].sort());
    },
    PRAZO,
  );
});

describe("quando a leitura não volta", () => {
  it(
    "a matriz não desenha linha nenhuma — ausência de resposta não é 'tudo liberado'",
    async () => {
      lerFalha = true;
      montar();

      await screen.findByText(
        /não puderam\s+ser lidos/,
        {},
        ESPERA,
      );
      expect(screen.queryByTestId(`inativar-${PRIMEIRA}`)).toBeNull();
      expect(screen.queryByTestId("inativar-#visao-executiva")).toBeNull();
      expect(screen.queryByTestId(`nivel-EDITAR-${PRIMEIRA}`)).toBeNull();
    },
    PRAZO,
  );
});
