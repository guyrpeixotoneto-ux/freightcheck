// @vitest-environment jsdom
//
// A matriz de Permissões — o que o gesto da seção alcança, e o que o piso muda.
//
// O primeiro bloco prende o defeito que a busca escondia, e que sobreviveu à
// mudança de tela: a ação da seção gravava as chaves dos módulos **que estavam
// na tela**, então filtrar por "Panorama" e inativar a seção inativava o
// Panorama e dizia ter tirado a Visão executiva inteira do ar. Hoje a ação é
// uma chave só — a da seção —, e o filtro não tem como estreitá-la. A tela
// também diz, em texto, o que a busca está escondendo: agir sobre a seção
// inteira é o certo, e deixar isso implícito não é.
//
// O segundo prende o que a `0095` trouxe: o **piso** do perfil. Um `Leitor` não
// tem linha nenhuma em `papel_permissao`, e é o piso que faz a matriz dele
// aparecer em `Visualizar` em vez de `Editar`. Se a matriz voltasse a ler a
// constante `NIVEL_PADRAO` no lugar do piso, um perfil só de leitura apareceria
// aqui como se editasse o produto inteiro — a tela mentindo sobre o que o
// portão faz.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PainelDePermissoes } from "../permissoes";
import { chaveDaSecao, modulosPorGrupo, type Nivel } from "@/lib/permissoes";
import type { ModulosUniversais } from "../modulos-universais-consulta";

/*
  Esta tela monta o catálogo **inteiro** — perto de noventa linhas, cada uma com
  quatro botões —, mais as oito seções e os oito ambientes. É a montagem mais
  cara da suíte da interface, e num runner de CI com quatro núcleos e uma dúzia
  de pacotes rodando em paralelo ela não cabe nos 5s que o vitest dá a um teste
  por padrão, nem nos 1000ms que o `findBy*` espera.

  Os prazos abaixo são generosos de propósito: eles não são o que o teste mede.
  Um teste que reprova por lentidão de máquina não diz nada sobre o código, e
  ensina a tratar vermelho como ruído — que é o pior efeito possível de uma
  suíte.
*/
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

/*
  O `Leitor` como o servidor o devolve: piso `VISUALIZAR`, **nenhuma** linha em
  `papel_permissao`, e o piso viajando no mapa na chave `*`. É essa forma que o
  segundo bloco cobra — a matriz tem de ler o piso do mapa, e não a constante.
*/
const LEITOR = {
  ...GESTOR,
  id: "22222222-2222-2222-2222-222222222222",
  nome: "Leitor",
  descricao: "Vê o produto inteiro e não escreve em lugar nenhum.",
  nivelPadrao: "VISUALIZAR" as Nivel,
  contas: 0,
};

const enviados: Array<{ path: string; corpo: unknown }> = [];
let universais: ModulosUniversais = {
  desligadas: [],
  protegidas: ["/configuracoes", "#administracao"],
  historico: [],
};
let perfis = [GESTOR, LEITOR];

vi.mock("@/lib/auth", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: "u1", name: "Chefe", email: "chefe@x.com", role: "ADMIN" },
  }),
}));

vi.mock("@/lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchJson: vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/papeis") return perfis;

    if (path.startsWith("/papeis/") && !path.endsWith("/permissoes")) {
      const perfil = perfis.find((p) => path.endsWith(p.id))!;
      return detalheDe(perfil);
    }

    if (path === "/modulos-universais" && init?.method === "PUT") {
      const corpo = JSON.parse(String(init.body)) as {
        chaves: Record<string, boolean>;
      };
      enviados.push({ path, corpo });
      universais = {
        ...universais,
        desligadas: [
          ...universais.desligadas,
          ...Object.entries(corpo.chaves)
            .filter(([, ligado]) => !ligado)
            .map(([chave]) => ({
              chave,
              desligadoEm: "2026-09-04T12:00:00.000Z",
              desligadoPor: "chefe@x.com",
              motivo: null,
              arquivadoEm: null,
              arquivadoPor: null,
            })),
        ],
      };
      return universais;
    }

    if (init?.method === "PUT") {
      enviados.push({ path, corpo: JSON.parse(String(init.body)) });
      const perfil = perfis.find((p) => path.startsWith(`/papeis/${p.id}`))!;
      return detalheDe(perfil);
    }

    return universais;
  }),
}));

/** O detalhe de um perfil, com o piso já no mapa — como o servidor o monta. */
function detalheDe(perfil: typeof GESTOR) {
  return {
    papel: perfil,
    permissoes:
      perfil.nivelPadrao === "EDITAR" ? {} : { "*": perfil.nivelPadrao },
    universaisDesligadas: universais.desligadas.map((d) => d.chave).sort(),
    historico: [],
  };
}

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

const VISAO = modulosPorGrupo().find((s) => s.secao === "visao-executiva")!;

beforeEach(() => {
  enviados.length = 0;
  perfis = [GESTOR, LEITOR];
  universais = {
    desligadas: [],
    protegidas: ["/configuracoes", "#administracao"],
    historico: [],
  };
});

afterEach(cleanup);

describe("o filtro de busca não estreita a ação da seção", () => {
  it("com a busca ativa, inativar a seção grava a chave da seção — e nada mais", async () => {
    montar();
    await screen.findByTestId("inativar-#visao-executiva", {}, ESPERA);

    fireEvent.change(screen.getByTestId("input-buscar-modulo"), {
      target: { value: "Panorama" },
    });

    /* A busca deixou um módulo na tela — e o botão da seção continua lá. */
    await waitFor(() => {
      expect(screen.getByTestId("inativar-/panorama")).toBeTruthy();
    }, ESPERA);
    expect(screen.queryByTestId("inativar-/dre")).toBeNull();

    fireEvent.click(screen.getByTestId("inativar-#visao-executiva"));

    await waitFor(() => expect(enviados).toHaveLength(1), ESPERA);
    expect(enviados[0]!.corpo).toMatchObject({
      chaves: { [chaveDaSecao("visao-executiva")]: false },
    });
    /* Uma chave só: nem as visíveis, nem as escondidas. */
    expect(
      Object.keys((enviados[0]!.corpo as { chaves: Record<string, boolean> }).chaves),
    ).toEqual(["#visao-executiva"]);
  }, PRAZO);

  it("a tela diz quantos módulos a busca escondeu, e que o botão vale para todos", async () => {
    montar();
    await screen.findByTestId("inativar-#visao-executiva", {}, ESPERA);

    fireEvent.change(screen.getByTestId("input-buscar-modulo"), {
      target: { value: "Panorama" },
    });

    const total = VISAO.itens.length;
    await screen.findByText(
      new RegExp(
        `A busca está escondendo ${total - 1} de\\s+${total} módulos desta seção`,
      ),
      {},
      ESPERA,
    );
    await screen.findByText(
      new RegExp(`O botão da seção vale para os ${total}`),
      {},
      ESPERA,
    );
  }, PRAZO);

  it("sem busca, o aviso não aparece — ele descreve um recorte que não existe", async () => {
    montar();
    await screen.findByTestId("inativar-#visao-executiva", {}, ESPERA);

    expect(screen.queryByText(/A busca está escondendo/)).toBeNull();
  }, PRAZO);
});

describe("a seção inativada decide pelos módulos dela na própria tela", () => {
  it("inativada a seção, os módulos dela param de oferecer o gesto próprio", async () => {
    montar();
    await screen.findByTestId("inativar-#visao-executiva", {}, ESPERA);

    fireEvent.click(screen.getByTestId("inativar-#visao-executiva"));

    /*
      O botão do módulo some em vez de ficar desabilitado: com a seção fora do
      ar, ele não muda o que se vê — e um gesto que não muda nada é pior do que
      um gesto ausente. A linha diz onde está o gesto que resolve.
    */
    await waitFor(() => {
      expect(screen.queryByTestId("inativar-/panorama")).toBeNull();
    }, ESPERA);
    await screen.findByText(/A seção inteira está fora do ar/, {}, ESPERA);
  }, PRAZO);

  it("a seção onde esta tela mora não oferece o gesto", async () => {
    montar();
    await screen.findByTestId("inativar-#visao-executiva", {}, ESPERA);

    expect(screen.queryByTestId("inativar-#administracao")).toBeNull();
    expect(screen.queryByTestId("inativar-/configuracoes")).toBeNull();
  }, PRAZO);
});

describe("o piso do perfil é a linha de base da matriz", () => {
  it("um Leitor sem nenhuma linha aparece em Visualizar, e não em Editar", async () => {
    montar();
    fireEvent.click(await screen.findByTestId("cartao-perfil-Leitor", {}, ESPERA));

    const emVisualizar = await screen.findByTestId(
      "nivel-VISUALIZAR-/panorama",
      {},
      ESPERA,
    );
    await waitFor(() => {
      expect(emVisualizar.getAttribute("aria-pressed")).toBe("true");
    }, ESPERA);
    expect(
      screen.getByTestId("nivel-EDITAR-/panorama").getAttribute("aria-pressed"),
    ).toBe("false");
  }, PRAZO);

  it("um Gestor sem nenhuma linha aparece em Editar — o piso que concede", async () => {
    montar();
    fireEvent.click(await screen.findByTestId("cartao-perfil-Gestor", {}, ESPERA));

    const emEditar = await screen.findByTestId(
      "nivel-EDITAR-/panorama",
      {},
      ESPERA,
    );
    await waitFor(() => {
      expect(emEditar.getAttribute("aria-pressed")).toBe("true");
    }, ESPERA);
  }, PRAZO);
});
