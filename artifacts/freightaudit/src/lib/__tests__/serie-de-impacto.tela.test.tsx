// @vitest-environment jsdom
//
// O gráfico entre duas respostas — e por que isto precisa de DOM: o que se
// prova aqui é *quando* a série é pedida e o que fica na tela enquanto ela não
// chega, e as duas coisas são efeitos de observador do React Query.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSerieDeImpacto } from "../serie-de-impacto";
import { GraficoDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import type { Contexto } from "../contextos";
import type { FamiliesView } from "@/components/inicio/types";
import type { Movimentos, RangeEntry } from "../analise";

/**
 * As três promessas desta rodada, e o defeito que cada uma fecha.
 *
 *   1. **A série parte junto com a tela.** A janela do gráfico saía de
 *      `/changes/families` — a leitura pesada da vigência —, então
 *      `/changes/range` só começava depois que ela respondia. Duas idas em
 *      fila: o gráfico aparecia sempre uma resposta inteira depois do resto.
 *      Agora a janela sai de `/contexts`, que a casca já tem em memória.
 *   2. **Trocar de unidade não apaga o gráfico.** Sem `placeholderData` a
 *      chave nova nascia sem dado, e o gráfico caía no ramo do vazio.
 *   3. **Esperar não é dizer que não houve nada.** O ramo do vazio escreve
 *      "Nenhuma alteração valorada no intervalo recente", que é uma afirmação
 *      sobre um dado que ainda não chegou.
 */

// O `ResponsiveContainer` do Recharts mede o elemento, e jsdom não traz o
// observador que ele usa. Um esboço basta: o que estes testes leem é o que o
// gráfico decide desenhar, nunca o tamanho em pixels que ele desenhou.
class ObservadorDeTamanho {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ObservadorDeTamanho as unknown as typeof ResizeObserver;

const CONTEXTOS: Contexto[] = [
  {
    scopeHash: "pe",
    channel: null,
    label: "PERNAMBUCO",
    scopes: [],
    latestPeriod: "2026-08-02",
    periods: 3,
    periodosDisponiveis: ["2026-06-01", "2026-07-01", "2026-08-02"],
  },
  {
    scopeHash: "ba",
    channel: null,
    label: "BAHIA",
    scopes: [],
    latestPeriod: "2026-08-02",
    periods: 2,
    periodosDisponiveis: ["2026-07-01", "2026-08-02"],
  },
];

vi.mock("../contextos", async (original) => ({
  ...(await original<typeof import("../contextos")>()),
  // A casca já leu `/contexts` antes de a página montar: o que importa aqui é
  // que a lista esteja em memória, não como ela chegou.
  useContextosDaCasca: () => ({
    contextos: CONTEXTOS,
    carregando: false,
    indisponivel: false,
  }),
}));

const buscar = vi.fn<(caminho: string) => Promise<Movimentos | null>>();
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  fetchJsonOrNull: (caminho: string) => buscar(caminho),
}));

function entrada(period: string, amount: number): RangeEntry {
  return {
    key: `${period}:${amount}`,
    period,
    periodLabel: period,
    parameterKey: "p",
    parameterName: "P",
    family: "AQUISICAO",
    attributeCode: "cavalo.finame",
    title: "P",
    equipment: "CAVALO",
    entityType: "CAVALO",
    vehicles: 1,
    unit: null,
    amount,
    periodicity: "MENSAL",
    confidence: "CALCULATED",
    reason: null,
    badge: "b",
    badgeLabel: "B",
    group: { key: "g", attributeCode: "cavalo.finame" } as RangeEntry["group"],
  };
}

function movimentos(valor: number): Movimentos {
  return {
    from: "2026-06-01",
    fromLabel: "jun",
    to: "2026-08-02",
    toLabel: "ago",
    periods: [
      { date: "2026-06-01", label: "01/06/2026" },
      { date: "2026-08-02", label: "02/08/2026" },
    ],
    movements: [],
    gaps: [],
    impact: { byPeriodicity: {}, notCalculable: 0 },
    lossesByPeriodicity: {},
    gainsByPeriodicity: {},
    totals: { changes: 1, vehiclesTouched: 1, comparisons: 1 },
    byParameter: [],
    entries: [entrada("2026-08-02", valor)],
  };
}

/** A tela mínima: a mesma chamada do Dashboard, e o gráfico que ela alimenta. */
function Tela({ scopeHash, view }: { scopeHash: string; view: FamiliesView | null }) {
  const consulta = new URLSearchParams({ scopeHash });
  const serie = useSerieDeImpacto(view, consulta, true);
  return (
    <>
      <span data-testid="pontos">{serie.pontos.length}</span>
      <span data-testid="ganhos">{serie.pontos.map((p) => p.ganhos).join(",")}</span>
      <GraficoDeImpacto
        pontos={serie.pontos}
        periodicity={serie.periodicity}
        carregando={serie.carregando}
      />
    </>
  );
}

function comCliente(no: React.ReactNode, cliente: QueryClient) {
  return <QueryClientProvider client={cliente}>{no}</QueryClientProvider>;
}

const novoCliente = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => {
  cleanup();
  buscar.mockReset();
});

describe("a série do gráfico de impacto", () => {
  it("é pedida sem esperar a vigência responder", async () => {
    buscar.mockResolvedValue(movimentos(10));
    const cliente = novoCliente();

    // `view` nulo é a tela recém-aberta: `/changes/families` ainda não voltou.
    render(comCliente(<Tela scopeHash="pe" view={null} />, cliente));

    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));
    const caminho = buscar.mock.calls[0]![0];
    // A janela veio de `/contexts`: da vigência mais antiga da unidade até a
    // que a lateral anuncia como aberta.
    expect(caminho).toContain("from=2026-06-01");
    expect(caminho).toContain("to=2026-08-02");
    expect(caminho).toContain("scopeHash=pe");
    // `period` nunca vai junto: o intervalo é `from`/`to`, e mandar os dois
    // faria o servidor receber duas respostas para a mesma pergunta.
    expect(caminho).not.toContain("period=");

    await waitFor(() => expect(screen.getByTestId("pontos").textContent).toBe("2"));
  });

  it("mostra a moldura enquanto espera, e nunca a frase do vazio", async () => {
    let responder: (m: Movimentos) => void = () => {};
    buscar.mockReturnValue(new Promise<Movimentos>((r) => (responder = r)));

    render(comCliente(<Tela scopeHash="pe" view={null} />, novoCliente()));

    expect(screen.getByTestId("grafico-carregando")).toBeTruthy();
    expect(screen.queryByText(/Nenhuma alteração valorada/)).toBeNull();

    responder(movimentos(10));
    await waitFor(() => expect(screen.queryByTestId("grafico-carregando")).toBeNull());
  });

  it("diz o vazio só quando o intervalo foi lido e não tinha nada valorado", async () => {
    buscar.mockResolvedValue({ ...movimentos(0), entries: [] });

    render(comCliente(<Tela scopeHash="pe" view={null} />, novoCliente()));

    await waitFor(() => expect(screen.getByText(/Nenhuma alteração valorada/)).toBeTruthy());
  });

  it("mantém o gráfico anterior na troca de unidade, e o declara", async () => {
    const cliente = novoCliente();
    buscar.mockResolvedValue(movimentos(10));

    const tela = render(comCliente(<Tela scopeHash="pe" view={null} />, cliente));
    await waitFor(() => expect(screen.getByTestId("ganhos").textContent).toBe("0,10"));

    let responder: (m: Movimentos) => void = () => {};
    buscar.mockReturnValue(new Promise<Movimentos>((r) => (responder = r)));
    tela.rerender(comCliente(<Tela scopeHash="ba" view={null} />, cliente));

    // O gráfico da unidade anterior continua desenhado — e o selo ao lado do
    // subtítulo diz que é o anterior. Nem tela em branco, nem afirmação falsa.
    expect(screen.getByTestId("ganhos").textContent).toBe("0,10");
    expect(screen.getByTestId("em-atualizacao")).toBeTruthy();
    expect(screen.queryByText(/Nenhuma alteração valorada/)).toBeNull();

    responder(movimentos(70));
    await waitFor(() => expect(screen.getByTestId("ganhos").textContent).toBe("0,70"));
    expect(screen.queryByTestId("em-atualizacao")).toBeNull();
  });

  it("volta a uma unidade já vista sem pedir de novo", async () => {
    const cliente = novoCliente();
    buscar.mockResolvedValue(movimentos(10));

    const tela = render(comCliente(<Tela scopeHash="pe" view={null} />, cliente));
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));

    tela.rerender(comCliente(<Tela scopeHash="ba" view={null} />, cliente));
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2));

    // Dentro do minuto de `LEITURA_DE_APURACAO`: o gráfico da unidade que já
    // foi vista aparece no primeiro quadro, sem chamada nova.
    tela.rerender(comCliente(<Tela scopeHash="pe" view={null} />, cliente));
    expect(screen.getByTestId("pontos").textContent).toBe("2");
    expect(screen.queryByTestId("em-atualizacao")).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(buscar).toHaveBeenCalledTimes(2);
  });
});
