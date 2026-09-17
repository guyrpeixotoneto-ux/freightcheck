// @vitest-environment jsdom
//
// O Monitor de Justificativas — o cabeçalho, e o que ele deixou de fazer.
//
// Duas coisas se prendem aqui, e as duas se desfariam sem quebrar teste nenhum.
//
// A primeira é o cabeçalho: a vigência era uma caixa no meio dos filtros e virou
// o botão "Trocar vigência" do canto direito, o mesmo das outras telas — e a
// tela abre somando **todas**, dizendo ao lado do título qual está aberta.
//
// A segunda é a mudança que deu o nome novo à tela: **aqui não se justifica**.
// Cada módulo justifica as próprias alterações, e o que sobrou é a leitura de
// cobertura, com a tabela por rubrica levando à tela que grava. Um botão
// `Justificar` de volta nesta tela é a regressão que este arquivo existe para
// pegar.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import MonitorDeJustificativas from "@/pages/monitor-de-justificativas";
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
  /* O endereço é estado global do jsdom: um teste que abre `?tipo=CARRETA`
     deixaria o próximo lendo um recorte que ele não pediu. */
  window.history.replaceState({}, "", "/painel-de-justificativas");
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

/* As mesmas contagens da cobertura, quebradas por rubrica: o Finame tem tela e
   leva ao módulo; `carreta.frota_emprestada` não tem, e cai no parâmetro da
   família — os dois casos que a tabela precisa saber desenhar. */
const RUBRICAS = [
  {
    changeSetId: "cs-julho",
    entityType: "CAVALO",
    modulo: "CUSTO_FIXO",
    rubrica: "finame",
    alteracoes: 40,
    justificadas: 10,
    ultimaEm: "2026-07-20T12:00:00.000Z",
    ultimoAutor: "marina@ambev.com",
  },
  {
    changeSetId: "cs-julho",
    entityType: "CARRETA",
    modulo: "SEM_CLASSE",
    rubrica: "parametro:FROTA|Frota emprestada",
    alteracoes: 60,
    justificadas: 0,
    ultimaEm: null,
    ultimoAutor: null,
  },
  {
    changeSetId: "cs-agosto",
    entityType: "CAVALO",
    modulo: "CUSTO_VARIAVEL",
    rubrica: "manutencao",
    alteracoes: 400,
    justificadas: 100,
    ultimaEm: "2026-08-19T09:00:00.000Z",
    ultimoAutor: "joao@ambev.com",
  },
];

/** Uma rubrica do Custo Fixo — a seção não muda, e o que se lê é a ordem. */
function rubricaDoPainel(
  rubrica: string,
  alteracoes: number,
  justificadas: number,
  ultimaEm: string | null = null,
  ultimoAutor: string | null = null,
) {
  return {
    changeSetId: "cs-julho",
    entityType: "CAVALO",
    modulo: "CUSTO_FIXO",
    rubrica,
    alteracoes,
    justificadas,
    ultimaEm,
    ultimoAutor,
  };
}

const AUTORES = [
  {
    changeSetId: "cs-julho",
    criadoPor: "marina@ambev.com",
    justificadas: 80,
    ultimaEm: "2026-08-20T12:00:00.000Z",
  },
  {
    changeSetId: "cs-agosto",
    criadoPor: "joao@ambev.com",
    justificadas: 30,
    ultimaEm: "2026-08-19T09:00:00.000Z",
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
function servidor(
  cobertura: typeof COBERTURA = COBERTURA,
  porRubrica: readonly ReturnType<typeof rubricaDoPainel>[] = RUBRICAS,
) {
  const pedidos: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      pedidos.push(url);
      if (url.includes("/change-sets")) return resposta(CHANGE_SETS);
      if (url.includes("/justificativas/painel"))
        return resposta({ cobertura, autores: AUTORES, rubricas: porRubrica });
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
        <MonitorDeJustificativas />
      </Router>
    </QueryClientProvider>,
  );
}

describe("o cabeçalho do Monitor de Justificativas", () => {
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

    /* A caixa antiga vivia entre "Tipo de ativo" e o filtro seguinte; o recorte
       por seção ocupou o lugar do impacto, e é a ausência da vigência entre os
       filtros que este teste prende. */
    const filtros = screen.getByText("Tipo de ativo").closest("section");
    expect(filtros).not.toBeNull();
    expect(within(filtros as HTMLElement).queryByText("Vigência")).toBeNull();
    expect(within(filtros as HTMLElement).getByText("Seção")).toBeTruthy();
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
    expect(within(cabecalho).getByText(/^agosto\/2026/)).toBeTruthy();
    expect(within(cabecalho).queryByText("Todas as vigências")).toBeNull();
  });

  it("escolher uma vigência recorta a leitura inteira", async () => {
    const pedidos = servidor();
    montar();

    const botao = await screen.findByRole("button", { name: /Trocar vigência/ });
    fireEvent.keyDown(botao, { key: "Enter" });

    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByText(/^julho\/2026/));

    const cabecalho = screen.getByRole("banner");
    await waitFor(() => expect(within(cabecalho).getByText(/^julho\/2026/)).toBeTruthy());
    /* 40 + 60, e não as 500 do acervo. */
    await waitFor(() =>
      expect(within(cartao("Alterações no recorte")).getByText("100")).toBeTruthy(),
    );
    /* A tela não busca mais a lista por alteração: ela recorta o que já tem em
       mãos. A única consulta é a da cobertura — ver o cabeçalho da página. */
    expect(pedidos.some((p) => p.includes("/justificativas/pendencias"))).toBe(false);
  });
});

describe("o que o Monitor deixou de fazer", () => {
  it("não grava justificativa nenhuma: o botão leva embora, e não abre caixa", async () => {
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    /*
      O botão da linha voltou a se chamar "Justificar", e o que ele faz continua
      sendo **sair daqui**: quem grava são as telas de rubrica e a fila. O que
      este teste prende não é o rótulo — é que clicar nele troca de endereço em
      vez de abrir a caixa de escrever. Um diálogo de justificar nesta tela é a
      regressão que este arquivo existe para pegar.
    */
    const doFiname = within(tabela).getByText("Finame").closest("tr")!;
    fireEvent.click(within(doFiname).getByRole("button", { name: /Justificar/ }));
    await waitFor(() => expect(window.location.pathname).toBe("/custo-fixo-finame"));
    expect(screen.queryByRole("dialog")).toBeNull();
    /* Nem "Justificar selecionadas", nem a aba de situação que separava
       pendentes de justificadas para a lista que saiu. */
    expect(screen.queryByRole("button", { name: /selecionadas/i })).toBeNull();
    expect(screen.queryByText("Pendentes de justificativa")).toBeNull();
  });

  it("não traz mais a lista por placa", async () => {
    const pedidos = servidor();
    montar();

    await screen.findByText("Onde está a pendência");
    expect(pedidos.some((p) => p.includes("/justificativas/pendencias"))).toBe(false);
    expect(screen.queryByText("Placas com pendência")).toBeNull();
  });
});

describe("a leitura por seção", () => {
  it("soma cada seção e diz quanto falta em cada uma", async () => {
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    /* 400 alterações e 100 justificadas: 300 pendentes no Custo Variável. O
       número mora no cabeçalho do painel da seção, que é onde as linhas dela
       estão — não há mais uma segunda leitura da mesma soma acima da tabela. */
    const variavel = within(tabela).getByText("Custo Variável").closest("div")!;
    expect(variavel.textContent).toContain("300 pendentes");
    /* 100 de 400: a porcentagem é o que o cabeçalho escreve, e a contagem de
       justificadas está na coluna da linha e no cartão da tabela. */
    expect(variavel.textContent).toContain("25% justificado");
    /* O que a curadoria não classificou aparece com esse nome, e não somado ao
       módulo maior. */
    expect(within(tabela).getByText("Sem classe de custo")).toBeTruthy();
  });

  it("conta as rubricas com pendência, que é quantas telas alguém vai abrir", async () => {
    servidor();
    montar();

    await screen.findByText("Onde está a pendência");
    /* As três rubricas do acervo têm pendência: 30, 60 e 300. */
    expect(within(cartao("Rubricas com pendência")).getByText("3")).toBeTruthy();
  });

  it("nomeia a rubrica sem tela pelo parâmetro da família", async () => {
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    expect(within(tabela).getByText("Frota emprestada")).toBeTruthy();
    /* A chave crua nunca chega à tela. */
    expect(within(tabela).queryByText(/parametro:/)).toBeNull();
  });

  it("dá um painel a cada seção, na ordem do catálogo", async () => {
    /*
      A seção era um selo repetido em cada linha, virou cabeçalho de grupo e
      agora é o painel inteiro: cabeçalho com o subtotal, colunas próprias e as
      linhas dela. A ordem é a do catálogo, e não a da pendência — Manutenção
      tem 300 pendentes e vem depois do Finame, que tem 30.
    */
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    const paineis = [...tabela.querySelectorAll("table")].map(
      (t) => t.closest("section")!.querySelector("span")!.textContent!.trim(),
    );
    expect(paineis).toEqual(["Custo Fixo", "Custo Variável", "Sem classe de custo"]);
  });

  it("o cabeçalho do painel soma a seção no recorte, e não as linhas da página", async () => {
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    const doVariavel = within(tabela).getByText("Custo Variável").closest("div")!;
    expect(doVariavel.textContent).toContain("400 alterações");
    expect(doVariavel.textContent).toContain("300 pendentes");
    expect(doVariavel.textContent).toContain("1 rubrica");
  });

  it("ordena a tabela pela coluna, e o terceiro clique devolve a ordem natural", async () => {
    /*
      A tabela abre pela pendência — a leitura de por onde começar. O cabeçalho
      existe para as outras perguntas da mesma lista, e voltar tem de ser
      possível sem recarregar: crescente, decrescente, e de volta ao natural.

      As três rubricas são da mesma seção e têm as três ordens diferentes entre
      si — sem isso o teste passaria sem provar qual régua está valendo.
    */
    const daMesmaSecao = [
      rubricaDoPainel("finame", 100, 99),
      rubricaDoPainel("ipva", 20, 1),
      rubricaDoPainel("seguro", 50, 25),
    ];
    servidor(COBERTURA, daMesmaSecao);
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    const rubricas = () =>
      [...tabela.querySelectorAll("tbody tr")].map(
        (tr) => tr.querySelector("td")!.textContent!.trim(),
      );
    /* Pendência: Seguro 25, IPVA 19, Finame 1. */
    expect(rubricas()).toEqual(["Seguro e Aparato", "IPVA", "Finame"]);

    const porAlteracoes = within(tabela).getByRole("button", { name: /Alterações/ });
    fireEvent.click(porAlteracoes);
    expect(rubricas()).toEqual(["IPVA", "Seguro e Aparato", "Finame"]);
    fireEvent.click(porAlteracoes);
    expect(rubricas()).toEqual(["Finame", "Seguro e Aparato", "IPVA"]);
    fireEvent.click(porAlteracoes);
    expect(rubricas()).toEqual(["Seguro e Aparato", "IPVA", "Finame"]);
  });

  it("ordena por quem escreveu sem levar as ausências para o topo", async () => {
    /*
      Quem ordena por "quem escreveu" procura um nome. Uma coluna de traços no
      topo é a resposta que ele já tinha antes de clicar — e é o que acontece
      quando `null` entra na comparação como texto vazio.
    */
    const comEsemAutor = [
      rubricaDoPainel("finame", 10, 5, "2026-07-01T10:00:00.000Z", "zelia@x.com"),
      rubricaDoPainel("ipva", 10, 0),
      rubricaDoPainel("seguro", 10, 5, "2026-07-02T10:00:00.000Z", "ana@x.com"),
    ];
    servidor(COBERTURA, comEsemAutor);
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    fireEvent.click(within(tabela).getByRole("button", { name: /Quem escreveu/ }));
    const autores = [...tabela.querySelectorAll("tbody tr")].map((tr) =>
      tr.querySelectorAll("td")[4].textContent!.trim(),
    );
    expect(autores[0]).toContain("ana@x.com");
    expect(autores[1]).toContain("zelia@x.com");
    expect(autores[2]).toBe("—");
  });

  it("promete a tela de conjunto só onde ela existe", async () => {
    /*
      Custo Fixo tem o Monitor; Custo Variável e o que a curadoria não
      classificou não têm tela de conjunto, e a fila recorta por tipo de ativo e
      vigência, nunca por seção. O botão troca de nome em vez de prometer um
      filtro que não existe.
    */
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    const doFixo = within(tabela).getByText("Custo Fixo").closest("div")!.parentElement!;
    expect(within(doFixo).getByRole("button", { name: /Justificar todas/ })).toBeTruthy();

    const doVariavel = within(tabela).getByText("Custo Variável").closest("div")!.parentElement!;
    expect(within(doVariavel).queryByRole("button", { name: /Justificar todas/ })).toBeNull();
    expect(within(doVariavel).getByRole("button", { name: /Abrir na fila/ })).toBeTruthy();
  });

  it("não repete o nome da seção em cada linha da tabela", async () => {
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    const doFiname = within(tabela).getByText("Finame").closest("tr")!;
    /* Só o botão diz para onde se vai; o selo da seção mora no cabeçalho. */
    expect(within(doFiname).queryAllByText("Custo Fixo")).toHaveLength(0);
  });

  it("manda cada rubrica para a tela em que ela se justifica", async () => {
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    const doFiname = within(tabela).getByText("Finame").closest("tr")!;
    fireEvent.click(within(doFiname).getByRole("button", { name: /Justificar/ }));
    await waitFor(() => expect(window.location.pathname).toBe("/custo-fixo-finame"));
  });

  it("manda para a fila a rubrica que não tem tela própria", async () => {
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    const semTela = within(tabela).getByText("Frota emprestada").closest("tr")!;
    fireEvent.click(within(semTela).getByRole("button", { name: /Justificar/ }));
    await waitFor(() => expect(window.location.pathname).toBe("/justificativas"));
  });

  it("recorta a tabela pelo filtro de seção, sem mexer nos cartões", async () => {
    /*
      O recorte por seção era um clique na barra de "Cobertura por seção", que
      saiu quando a barra virou o cabeçalho do painel de cada seção. O filtro
      continua, na caixa "Seção" — e o que ele recorta é a tabela: os cartões
      do topo seguem sendo os do recorte inteiro, que é contra o que a tabela
      se confere.
    */
    servidor();
    montar();

    const tabela = (await screen.findByText("Onde está a pendência")).closest("section")!;
    expect(within(tabela).getByText("Manutenção")).toBeTruthy();

    const filtros = screen.getByText("Tipo de ativo").closest("section")!;
    const caixa = within(filtros)
      .getByText("Seção")
      .parentElement!.querySelector('[role="combobox"]') as HTMLElement;
    /* O Radix abre o menu pelo teclado no jsdom — a mesma porta de
       `unidade-do-envio.tela.test.tsx`. */
    fireEvent.keyDown(caixa, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /Custo Fixo/ }));

    await waitFor(() => expect(within(tabela).queryByText("Manutenção")).toBeNull());
    expect(within(tabela).getByText("Finame")).toBeTruthy();
    expect(within(cartao("Alterações no recorte")).getByText("500")).toBeTruthy();
  });
});

describe("a tabela por rubrica", () => {
  it("pagina em tela, sem voltar ao servidor", async () => {
    /*
      A cobertura por rubrica já chega inteira na primeira consulta — trocar de
      página é recorte do que está em mãos, e uma ida ao banco por página daria
      a mesma resposta por N vezes o custo.
    */
    const pedidos = servidor();
    montar();

    await screen.findByText("Onde está a pendência");
    const antes = pedidos.length;
    expect(screen.getByText(/3 rubricas/)).toBeTruthy();
    expect(pedidos.length).toBe(antes);
  });
});

describe("as quatro leituras", () => {
  it("abre pela leitura por seção, sem escrever a aba no endereço", async () => {
    servidor();
    montar();

    await screen.findByText("Onde está a pendência");
    expect(window.location.search).not.toContain("aba=");
  });

  it("troca de leitura pelo endereço, que é o que se cola num chat", async () => {
    servidor();
    montar();

    fireEvent.click(await screen.findByRole("tab", { name: /Por vigência/ }));
    await waitFor(() => expect(window.location.search).toContain("aba=vigencia"));
    expect(screen.getByText("Vigência a vigência")).toBeTruthy();
    /* Cada aba é uma leitura: a tabela por rubrica é da aba por seção. */
    expect(screen.queryByText("Onde está a pendência")).toBeNull();
  });

  it("lista quem justificou na aba por responsável, sem prometer dono da pendência", async () => {
    servidor();
    montar();

    fireEvent.click(await screen.findByRole("tab", { name: /Por responsável/ }));
    const secao = (await screen.findByText("Quem justificou")).closest("section")!;
    expect(within(secao).getByText("marina@ambev.com")).toBeTruthy();
    expect(within(secao).getByText(/não atribui alteração a ninguém/)).toBeTruthy();
  });

  it("diz na aba por tipo de ativo que o QLP não tem lugar nela", async () => {
    /* Ele não é ativo com placa — e uma leitura por tipo que o omitisse em
       silêncio seria lida como a cobertura inteira. */
    servidor();
    montar();

    fireEvent.click(await screen.findByRole("tab", { name: /Por tipo de ativo/ }));
    expect(await screen.findByText(/não é ativo com placa/)).toBeTruthy();
    expect(screen.getByText("Placas do recorte")).toBeTruthy();
  });

  it("aceita o ?tipo= antigo como filtro, e não como aba", async () => {
    /*
      O tipo era a aba; hoje é filtro. Um link colado meses atrás continua
      abrindo o recorte que prometia — agora na leitura por seção.
    */
    servidor();
    window.history.replaceState({}, "", "/painel-de-justificativas?tipo=CARRETA");
    montar();

    await screen.findByText("Onde está a pendência");
    expect(screen.getByText(/fala só das carretas/)).toBeTruthy();
    /* 60 alterações da carreta de julho, e não as 500 do acervo. */
    expect(within(cartao("Alterações no recorte")).getByText("60")).toBeTruthy();
  });
});

describe("copiar a cobrança", () => {
  /** O botão, já com a cobertura em mãos — antes dela ele está desligado. */
  async function botaoDeCobranca(): Promise<HTMLElement> {
    await screen.findByText("Onde está a pendência");
    return await waitFor(() => {
      const botao = screen.getByRole("button", { name: /Copiar cobrança/ });
      if (botao.hasAttribute("disabled")) throw new Error("ainda desligado");
      return botao;
    });
  }

  /** A área de transferência do jsdom — o que o navegador não traz. */
  function areaDeTransferencia(falhar = false) {
    const escrito: string[] = [];
    vi.stubGlobal("navigator", {
      ...globalThis.navigator,
      clipboard: {
        writeText: vi.fn(async (texto: string) => {
          if (falhar) throw new Error("negado");
          escrito.push(texto);
        }),
      },
    });
    return escrito;
  }

  it("põe na área de transferência o que falta, por seção e rubrica", async () => {
    servidor();
    const escrito = areaDeTransferencia();
    montar();

    /* O botão existe antes da cobertura chegar, e até lá está desligado: não
       há o que cobrar sem número. */
    fireEvent.click(await botaoDeCobranca());
    await waitFor(() => expect(escrito).toHaveLength(1));

    const texto = escrito[0];
    /* O total é o do cartão — quem recebe consegue reproduzi-lo na tela. */
    expect(texto).toContain("de 500 alterações");
    expect(texto).toContain("CUSTO VARIÁVEL");
    expect(texto).toContain("Manutenção: 300 pendentes de 400");
    expect(texto).toContain("justificar em Custo Variável");
    /* E o link da leitura, para quem recebe abrir o mesmo recorte. */
    expect(texto).toContain(`Leitura completa: ${window.location.href}`);
  });

  it("confirma na própria caixa do botão", async () => {
    servidor();
    areaDeTransferencia();
    montar();

    fireEvent.click(await botaoDeCobranca());
    expect(await screen.findByRole("button", { name: /Copiada/ })).toBeTruthy();
  });

  it("diz quando não deu para copiar, em vez de fingir que copiou", async () => {
    /* Fora de contexto seguro, ou com a permissão negada, quem cobra sairia
       daqui com a mensagem vazia na mão. */
    servidor();
    areaDeTransferencia(true);
    montar();

    fireEvent.click(await botaoDeCobranca());
    expect(await screen.findByRole("button", { name: /Não deu para copiar/ })).toBeTruthy();
  });

  it("não oferece cobrança quando não há pendência", async () => {
    const tudoJustificado = COBERTURA.map((l) => ({ ...l, justificadas: l.alteracoes }));
    servidor(tudoJustificado);
    montar();

    await screen.findByText("Onde está a pendência");
    expect(
      (await screen.findByRole("button", { name: /Copiar cobrança/ })).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("os estados sem número", () => {
  it("no recorte vazio diz o que houve e não oferece arquivo nem cobrança", async () => {
    /* Nada a justificar não é defeito: é uma resposta. E sobre ela não há CSV
       a gerar nem cobrança a mandar. */
    servidor([]);
    montar();

    expect(await screen.findByText("Nada a justificar neste recorte.")).toBeTruthy();
    for (const nome of [/Copiar cobrança/, /Exportar/]) {
      expect(screen.getByRole("button", { name: nome }).hasAttribute("disabled")).toBe(true);
    }
    /* E nenhuma leitura desenhada sobre o vazio. */
    expect(screen.queryByText("Cobertura por seção")).toBeNull();
  });
});
