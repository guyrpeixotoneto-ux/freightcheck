// @vitest-environment jsdom
//
// A página inteira, montada — o que se prova aqui é que ela **abre**, e o que
// ela escreve em cada um dos três desfechos da consulta: a espera, a falha e a
// vigência que não existe. Os três são estados de tela que nenhum teste de
// função pura alcança, e são exatamente os que aparecem primeiro para quem usa.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";

import ImpactoApurado from "@/pages/impacto-apurado";
import Dashboard from "@/pages/dashboard";
import type { Contexto } from "@/lib/contextos";

class ObservadorDeTamanho {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ObservadorDeTamanho as unknown as typeof ResizeObserver;

/*
  A casca fica de fora: ela pede sessão, permissões e o menu inteiro, e nada
  disso é o que esta página decide. O que se monta aqui é o corpo dela.
*/
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
});

function montar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cliente}>
      <Router>
        <ImpactoApurado />
      </Router>
    </QueryClientProvider>,
  );
}

/** Uma resposta do servidor, com o carimbo que `fetchJson` confere. */
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json", "X-FreightCheck-API": "1" },
  });


/**
 * Uma vigência como o servidor a entrega — o suficiente para a tela inteira.
 *
 * Os números são os da unidade da referência: R$ 26.583 somaram, R$ 4.652
 * saíram, líquido de R$ 21.931, e 7 de 102 alterações com preço.
 */
const contribuinte = (key: string, familia: string, amount: number) => ({
  key,
  name: key,
  family: familia,
  familyName: familia,
  changes: 1,
  vehicles: 4,
  amount,
});

const IMPACTO: {
  byPeriodicity: Record<string, number>;
  brutoByPeriodicity: Record<string, number>;
  rastro: { brutoByPeriodicity: Record<string, number>; degraus: []; oficialByPeriodicity: Record<string, number> };
  excludedChanges: number;
  calculatedChanges: number;
  notCalculable: number;
} = {
  byPeriodicity: { MENSAL: 21931 },
  brutoByPeriodicity: { MENSAL: 21931 },
  rastro: { brutoByPeriodicity: {}, degraus: [], oficialByPeriodicity: {} },
  excludedChanges: 0,
  calculatedChanges: 7,
  notCalculable: 95,
};

const VIGENCIA = {
  context: {
    scopeHash: "hash-pe",
    channel: "EMPURRADA",
    label: "PERNAMBUCO · EMPURRADA",
    scopes: [{ scopeType: "UNIDADE", code: "BR07", name: "PERNAMBUCO" }],
    latestPeriod: "2026-08-01",
    periods: 6,
  },
  otherContexts: [],
  period: "2026-08-01",
  periodLabel: "agosto de 2026",
  periods: [
    { date: "2026-07-01", label: "julho de 2026", series: [], tipos: [] },
    { date: "2026-08-01", label: "agosto de 2026", series: [], tipos: [] },
  ],
  composicao: { tipos: [] },
  series: [],
  missingSeries: [],
  complete: true,
  totals: {
    changes: 102,
    formatOnlyChanges: 0,
    groups: 16,
    vehiclesTouched: 80,
    entitiesAdded: 0,
    entitiesRemoved: 0,
    unchanged: 0,
    inconclusive: 0,
  },
  entityIdsTouched: [],
  impact: IMPACTO,
  accumulated: { ...IMPACTO, comparisons: 6, from: null, to: null },
  groups: [],
  families: [],
  freightechSemDado: [],
  summary: {
    impact: IMPACTO,
    lossesByPeriodicity: { MENSAL: -4652 },
    gainsByPeriodicity: { MENSAL: 26583 },
    sides: [
      {
        periodicity: "MENSAL",
        net: 21931,
        gains: {
          total: 26583,
          changes: 5,
          vehicles: 40,
          parameters: [
            contribuinte("financiamento", "AQUISICAO", 19742),
            contribuinte("frete", "FRETE", 6841),
          ],
        },
        losses: {
          total: -4652,
          changes: 2,
          vehicles: 9,
          parameters: [contribuinte("promocao", "COMERCIAL", -4652)],
        },
      },
    ],
    changes: 102,
    groups: 16,
    critical: 0,
    locked: 0,
    notCalculable: 95,
    vehiclesTouched: 80,
    topParameters: [],
    topVehicles: [],
  },
  cockpit: {
    kpis: {
      changes: 102,
      parameters: 16,
      attention: 0,
      vehicles: 80,
      fleet: 1284,
      impact: IMPACTO,
      hasImpact: true,
      anomalies: { groups: 0, changes: 0, formatOnlyGroups: 0, formatOnlyChanges: 0 },
    },
    baseline: { hasBaseline: true, seriesWithoutBaseline: [] },
    narrative: { headline: "", sentences: [] },
    panorama: {
      bySeverity: [],
      byBadge: [],
      byEquipment: [],
      pricing: {
        calculatedChanges: 7,
        excludedChanges: 0,
        notCalculableChanges: 95,
        lockedGroups: 0,
        reasons: [],
      },
    },
    priorities: [],
    history: { comparisons: 6, from: null, to: null, byPeriodicity: {}, sufficient: true },
  },
};

describe("a página do Impacto Apurado", () => {
  it("abre nomeando a pergunta que responde", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    montar();

    expect(screen.getByText(/Impacto Apurado —/)).toBeTruthy();
    expect(
      screen.getByText("O que mudou nesta competência, quanto já conseguimos apurar e onde agir."),
    ).toBeTruthy();
    expect(screen.getByText("Carregando o Impacto Apurado…")).toBeTruthy();
  });

  /*
    Um 404 de `/changes/families` quer dizer "não há vigência importada" — uma
    afirmação sobre o acervo, e não uma falha. A tela diz o que fazer em vez de
    mostrar um erro que ninguém consegue resolver.
  */
  it("banco sem vigência não é erro: diz o que falta importar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => resposta({ error: "Nenhuma vigência importada ainda." }, 404)),
    );
    montar();

    await waitFor(() => expect(screen.getByText("Nenhuma vigência para apurar ainda.")).toBeTruthy());
    expect(screen.queryByText(/Não foi possível montar/)).toBeNull();
  });

  /*
    A vigência inteira, montada: é o único teste que percorre o caminho de
    ponta a ponta — consulta, manchete, faixa de cobertura, ponte, ranking e
    pontos de ação — e o único que pegaria um erro de montagem que só aparece
    com dado em mãos.
  */
  it("com vigência, publica a manchete, a cobertura e o que explica o resultado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("/changes/families")) return resposta(VIGENCIA);
        /* A série do gráfico — o intervalo, que a tela pede depois. */
        return resposta({ from: "2026-07-01", to: "2026-08-01", periods: [], entries: [] });
      }),
    );
    montar();

    await waitFor(() => expect(screen.getByText("+R$ 21.931")).toBeTruthy());
    expect(screen.getByText("Impacto Apurado — PERNAMBUCO")).toBeTruthy();
    expect(screen.getByText(/apenas 7 de 102 alterações/)).toBeTruthy();
    expect(screen.getByText("Composição do impacto líquido")).toBeTruthy();
    expect(screen.getByText("Principais mudanças")).toBeTruthy();
    expect(screen.getByText("Onde agir agora")).toBeTruthy();
    expect(screen.getByText("95 alterações sem preço apurado")).toBeTruthy();
  });

  /*
    **O Impacto Líquido continua de pé, e os dois dizem o mesmo número.**

    A chegada do Impacto Apurado mexeu no módulo vizinho em dois pontos — os
    controles do cabeçalho saíram para um arquivo compartilhado, e a consulta
    da vigência passou a vir de `opcoesDaVigencia`. Este teste é o que guarda o
    que aquelas duas mudanças não podiam custar: a tela antiga abre, e o líquido
    que ela publica é o mesmo que a nova publica sobre a mesma resposta. Dois
    módulos do mesmo menu com dois impactos líquidos da mesma unidade é o
    defeito que o cache compartilhado existe para tornar impossível.
  */
  it("publica o mesmo líquido que o Impacto Líquido, sobre a mesma resposta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("/changes/families")) return resposta(VIGENCIA);
        return resposta({ from: "2026-07-01", to: "2026-08-01", periods: [], entries: [] });
      }),
    );

    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cliente}>
        <Router>
          <Dashboard />
        </Router>
      </QueryClientProvider>,
    );

    /* O cartão em destaque do módulo antigo escreve o líquido sem o sinal. */
    await waitFor(() => expect(screen.getAllByText("R$ 21.931").length).toBeGreaterThan(0));
    expect(screen.getByText(/Impacto Líquido —/)).toBeTruthy();
  });

  /*
    Os três desfechos sem líquido, montados de ponta a ponta: a tela tem de
    escrever três frases diferentes, e nenhuma delas pode ser a do outro caso.
    É o mesmo dado que separa os três — `sides`, `calculatedChanges` e
    `totals.changes` —, e é aqui que se prova que a página os lê como três.
  */
  const comVigencia = (ajustes: (v: typeof VIGENCIA) => void) => {
    const vigencia = structuredClone(VIGENCIA);
    ajustes(vigencia);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) =>
        String(entrada).includes("/changes/families")
          ? resposta(vigencia)
          : resposta({ from: "2026-07-01", to: "2026-08-01", periods: [], entries: [] }),
      ),
    );
    montar();
  };

  it("alterações sem preço nenhum: o líquido é desconhecido, não zero", async () => {
    comVigencia((v) => {
      v.summary.sides = [];
      v.summary.impact = { ...v.summary.impact, byPeriodicity: {}, calculatedChanges: 0, notCalculable: 102 };
      v.impact = { ...v.impact, byPeriodicity: {}, calculatedChanges: 0, notCalculable: 102 };
    });

    await waitFor(() => expect(screen.getByText("Nenhum valor apurado")).toBeTruthy());
    expect(screen.queryByText("R$ 0")).toBeNull();
    expect(screen.getByText(/apenas 0 de 102 alterações/)).toBeTruthy();
  });

  it("tudo apurado em R$ 0,00: o zero é medida, e a cobertura é completa", async () => {
    comVigencia((v) => {
      v.summary.sides = [];
      v.summary.impact = { ...v.summary.impact, byPeriodicity: { MENSAL: 0 }, calculatedChanges: 102, notCalculable: 0 };
      v.impact = { ...v.impact, byPeriodicity: { MENSAL: 0 }, calculatedChanges: 102, notCalculable: 0 };
    });

    await waitFor(() => expect(screen.getAllByText("R$ 0").length).toBeGreaterThan(0));
    expect(screen.getByText(/zero medido, e não ausência de apuração/)).toBeTruthy();
    expect(screen.getByText(/Resultado completo/)).toBeTruthy();
  });

  it("vigência sem anterior não diz que o cliente não mudou nada", async () => {
    comVigencia((v) => {
      v.summary.sides = [];
      v.totals.changes = 0;
      v.summary.changes = 0;
      v.summary.impact = { ...v.summary.impact, byPeriodicity: {}, calculatedChanges: 0, notCalculable: 0 };
      v.impact = { ...v.impact, byPeriodicity: {}, calculatedChanges: 0, notCalculable: 0 };
      v.cockpit.baseline = { hasBaseline: false, seriesWithoutBaseline: [] };
    });

    await waitFor(() =>
      expect(screen.getByText("Esta vigência não tem anterior com que comparar.")).toBeTruthy(),
    );
    expect(screen.getByText("Nada mudou")).toBeTruthy();
    expect(screen.queryByText(/o cliente não mudou nada/)).toBeNull();
  });

  it("falha do servidor vira aviso, e não uma tela em branco", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resposta({ error: "falhou" }, 500)));
    montar();

    await waitFor(() =>
      expect(screen.getByText(/Não foi possível montar o Impacto Apurado/)).toBeTruthy(),
    );
  });
});
