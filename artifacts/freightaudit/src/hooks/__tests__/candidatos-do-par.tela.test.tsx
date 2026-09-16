// @vitest-environment jsdom
//
// O CRITÉRIO DE ACEITE DO MENU "DE", EXERCITADO CONTRA UM DOM DE VERDADE.
//
// O que se prende aqui é uma frase do produto, e não uma propriedade do React
// Query: *entro na tela, espero o carregamento normal e, quando abro o filtro,
// os números já estão lá — todos, sem esqueleto cinza e sem uma nova espera
// causada pela abertura.*
//
// Por isso o teste monta o seletor **real** alimentado pelo hook **real**, e a
// única coisa forjada é a resposta do servidor. Um teste que afirmasse
// `enabled: true` provaria a linha de código que ele mesmo copiou; este abre o
// menu e olha o que está escrito nele.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCandidatosDoPar } from "../use-candidatos-do-par";
import { SeletorDoPar, type VigenciaEscolhivel } from "@/components/comparacao/seletor-do-par";
import type { CandidatosDoPar } from "@/lib/candidatos";

/* O Radix mede e ancora o menu com APIs que o jsdom não traz; nenhuma delas é o
   que estes casos provam. */
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
/** A fila de respostas que o servidor forjado entrega, em ordem. */
let respostas: CandidatosDoPar[] = [];

vi.mock("@/lib/api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  fetchJson: vi.fn(async (caminho: string) => {
    pedidos.push(caminho);
    const proxima = respostas.length > 1 ? respostas.shift()! : respostas[0]!;
    return proxima;
  }),
}));

const VIGENCIAS: VigenciaEscolhivel[] = [
  { id: "v-jun", sourceLabel: "JUNHO", effectiveDate: "2026-06-01", entityTypeSet: "T", scopeHash: "ca" },
  { id: "v-jul", sourceLabel: "JULHO", effectiveDate: "2026-07-01", entityTypeSet: "T", scopeHash: "ca" },
  { id: "v-ago", sourceLabel: "AGOSTO", effectiveDate: "2026-08-01", entityTypeSet: "T", scopeHash: "ca" },
];

const ROTULOS = new Map([
  ["v-jun", "junho/2026 · 1ª quinzena"],
  ["v-jul", "julho/2026 · 1ª quinzena"],
  ["v-ago", "agosto/2026 · 1ª quinzena"],
]);

const comNumeros = (id: string, valor: number, alteracoes: number) => ({
  id,
  numeros: {
    alteracoes,
    /* Natureza nula: é uma rubrica, e a linha sai sem prefixo. */
    impacto: { baldes: [{ periodicidade: "MENSAL", natureza: null, valor }] },
  },
});

/** A tela como a auditoria a monta: o hook alimentando o seletor, e nada mais. */
function Tela({ para, escopo }: { para: string; escopo: string | null }) {
  const candidatos = useCandidatosDoPar("finame", para, escopo);
  return (
    <SeletorDoPar
      vigencias={VIGENCIAS}
      rotulos={ROTULOS}
      base="v-jun"
      comparada={para}
      onBase={() => {}}
      onComparada={() => {}}
      onInverter={() => {}}
      idPrefixo="finame"
      candidatos={candidatos.data}
      carregandoCandidatos={candidatos.isFetching}
      erroDosCandidatos={null}
    />
  );
}

function montar(para = "v-ago", escopo: string | null = "ca") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <Tela para={para} escopo={escopo} />
    </QueryClientProvider>,
  );
  return {
    ...utils,
    trocar: (p: string, e: string | null = "ca") =>
      utils.rerender(
        <QueryClientProvider client={client}>
          <Tela para={p} escopo={e} />
        </QueryClientProvider>,
      ),
  };
}

/** Abrir o menu "De" — o gesto que, no defeito, iniciava a conta. */
function abrirMenuDe() {
  fireEvent.keyDown(screen.getByLabelText("De (vigência de origem)"), { key: "Enter" });
}

const esqueletos = () => document.querySelectorAll(".animate-pulse");

beforeEach(() => {
  pedidos.length = 0;
  respostas = [];
});

afterEach(cleanup);

describe("os números do menu De", () => {
  it("são pedidos sem ninguém abrir o menu", async () => {
    respostas = [
      {
        para: "v-ago",
        pendentes: 0,
        candidatos: [comNumeros("v-jun", 7238.85, 7), comNumeros("v-jul", -1200, 1)],
      },
    ];

    montar();

    // Nenhum gesto entre montar a tela e esta espera — é esse o ponto.
    await waitFor(() => expect(pedidos).toEqual(["/finame/candidatos?para=v-ago"]));
  });

  it("estão todos na tela quando o menu abre, sem esqueleto e sem nova espera", async () => {
    /* Duas rodadas, como o servidor responde quando o orçamento não cobre a
       lista inteira: a primeira traz junho e deve julho; a segunda completa. */
    respostas = [
      {
        para: "v-ago",
        pendentes: 1,
        candidatos: [comNumeros("v-jun", 7238.85, 7), { id: "v-jul", numeros: null }],
      },
      {
        para: "v-ago",
        pendentes: 0,
        candidatos: [comNumeros("v-jun", 7238.85, 7), comNumeros("v-jul", -1200, 1)],
      },
    ];

    montar();

    // "Aguardo o carregamento normal": a fila drena sozinha, sem interação.
    await waitFor(() => expect(pedidos.length).toBe(2), { timeout: 10_000 });

    abrirMenuDe();

    // Os dois números já estão escritos no primeiro quadro em que o menu existe.
    expect(await screen.findByText("7 alterações")).toBeTruthy();
    expect(screen.getByText("1 alteração")).toBeTruthy();
    expect(screen.getByText("+R$ 7.238,85/mês")).toBeTruthy();
    expect(screen.getByText("−R$ 1.200,00/mês")).toBeTruthy();
    expect(esqueletos().length).toBe(0);
    // E abrir não fez pergunta nenhuma.
    expect(pedidos.length).toBe(2);
  });

  it("enquanto a fila não terminou, a linha sem número mostra esqueleto — e não vazio", async () => {
    respostas = [
      {
        para: "v-ago",
        pendentes: 1,
        candidatos: [comNumeros("v-jun", 7238.85, 7), { id: "v-jul", numeros: null }],
      },
    ];

    montar();
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(0));
    abrirMenuDe();

    expect(await screen.findByText("7 alterações")).toBeTruthy();
    await waitFor(() => expect(esqueletos().length).toBeGreaterThan(0));
  });

  it("trocar o Para é pergunta nova, e trocar a unidade também", async () => {
    respostas = [{ para: "v-ago", pendentes: 0, candidatos: [comNumeros("v-jun", 10, 1)] }];

    const { trocar } = montar("v-ago", "ca");
    await waitFor(() => expect(pedidos).toEqual(["/finame/candidatos?para=v-ago"]));

    trocar("v-jul", "ca");
    await waitFor(() =>
      expect(pedidos).toEqual([
        "/finame/candidatos?para=v-ago",
        "/finame/candidatos?para=v-jul",
      ]),
    );

    // A unidade não vai na URL — vai na chave. Trocá-la é chave nova.
    trocar("v-jul", "pe");
    await waitFor(() => expect(pedidos.length).toBe(3));
    expect(pedidos[2]).toBe("/finame/candidatos?para=v-jul");

    // E voltar ao que já foi perguntado sai do cache, sem chamada nova.
    trocar("v-ago", "ca");
    await new Promise((r) => setTimeout(r, 400));
    expect(pedidos.length).toBe(3);
  });

  it("uma fila que não anda encerra a pergunta em vez de virar laço", async () => {
    // O servidor devolve sempre o mesmo pendente: nada progride nunca.
    respostas = [
      { para: "v-ago", pendentes: 1, candidatos: [{ id: "v-jun", numeros: null }] },
    ];

    montar();
    await waitFor(() => expect(pedidos.length).toBeGreaterThan(1), { timeout: 10_000 });

    /* Recua e desiste: quatro rodadas sem andar (300ms, 600ms, 1,2s e 2,4s de
       espera), e não uma a cada 300ms para sempre. O que se espera é a fila
       **parar** — um trecho de tempo sem pergunta nova —, e não um prazo fixo,
       que só amarraria o teste aos milissegundos escolhidos hoje. */
    let anterior = -1;
    for (let volta = 0; volta < 12 && anterior !== pedidos.length; volta++) {
      anterior = pedidos.length;
      await new Promise((r) => setTimeout(r, 800));
    }
    expect(pedidos.length).toBe(anterior);
    expect(anterior).toBeLessThanOrEqual(6);
  }, 30_000);
});
