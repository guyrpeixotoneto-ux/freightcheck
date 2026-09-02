// @vitest-environment jsdom
//
// A página inteira, montada — os sete andares de ponta a ponta.
//
// O Panorama consolida quatro módulos que liam a mesma resposta do servidor, e
// o risco que ele traz é o inverso da redundância que desfaz: publicar um
// **quinto** número, diferente dos quatro, sobre o mesmo dado. Por isso o teste
// que mais importa aqui não é o de que a tela abre — é o que monta o Panorama e
// o Impacto Apurado sobre a **mesma** resposta e exige o mesmo líquido dos dois.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { TooltipProvider } from "@/components/ui/tooltip";

import Panorama from "@/pages/panorama";
import ImpactoApurado from "@/pages/impacto-apurado";
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

/** Uma resposta do servidor, com o carimbo que `fetchJson` confere. */
const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json", "X-FreightCheck-API": "1" },
  });

const contribuinte = (key: string, familia: string, amount: number) => ({
  key,
  name: key,
  family: familia,
  familyName: familia,
  changes: 1,
  vehicles: 4,
  amount,
});

const IMPACTO = {
  byPeriodicity: { MENSAL: 21931 },
  brutoByPeriodicity: { MENSAL: 21931 },
  rastro: { brutoByPeriodicity: {}, degraus: [], oficialByPeriodicity: {} },
  excludedChanges: 0,
  calculatedChanges: 7,
  notCalculable: 95,
};

/**
 * A vigência como o servidor a entrega — os mesmos números da suíte do Impacto
 * Apurado, de propósito. Se as duas telas leem a mesma resposta, os dois testes
 * têm de ler a mesma resposta: R$ 26.583 somaram, R$ 4.652 saíram, líquido de
 * R$ 21.931, e 7 de 102 alterações com preço.
 */
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
    entitiesAdded: 3,
    entitiesRemoved: 1,
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
    topParameters: [
      {
        key: "ipva",
        name: "IPVA",
        family: "TRIBUTOS",
        familyName: "Tributos",
        changes: 41,
        byPeriodicity: { MENSAL: -8200 },
      },
    ],
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
      byEquipment: [{ equipment: "Carreta", entityType: "CARRETA", changes: 61 }],
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

/** Todo endpoint que a página toca, com a resposta que o servidor daria. */
const servidor = () =>
  vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    if (url.includes("/changes/families")) return resposta(VIGENCIA);
    if (url.includes("/changes/grouped")) return resposta(VIGENCIA);
    if (url.includes("/balance")) {
      return resposta([
        {
          entrada: 1000,
          residuo: 0,
          porNatureza: { PERDA: 60, RESIDUO: 0, DESCARTE: 0, DADO: 940, OUTRO: 0 },
        },
      ]);
    }
    if (url.includes("/imports")) {
      return resposta([
        {
          importRunId: "1",
          status: "PROMOTED",
          filename: "cavalos.xlsx",
          receivedAt: "2026-08-01T09:12:00Z",
        },
      ]);
    }
    /* A série do gráfico — o intervalo, que a tela pede depois. */
    return resposta({ from: "2026-07-01", to: "2026-08-01", periods: [], entries: [] });
  });

function montar(Tela: () => React.ReactElement = Panorama) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  /*
    `TooltipProvider` está aqui porque está em `App.tsx`, na raiz da aplicação:
    o placar publica a definição de cada número num ⓘ, e o Radix exige o
    provedor acima de qualquer `Tooltip`. Montar sem ele testaria uma árvore que
    não existe em produção.
  */
  return render(
    <QueryClientProvider client={cliente}>
      <TooltipProvider>
        <Router>
          <Tela />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("a página do Panorama", () => {
  it("abre nomeando a pergunta que responde", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    montar();

    expect(screen.getByText(/Panorama —/)).toBeTruthy();
    expect(screen.getByText("Carregando o Panorama…")).toBeTruthy();
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

    await waitFor(() => expect(screen.getByText("Nenhuma vigência para ler ainda.")).toBeTruthy());
    expect(screen.queryByText(/Não foi possível montar/)).toBeNull();
  });

  /*
    Os seis andares, de ponta a ponta. É o único teste que percorre a página
    inteira com dado em mãos, e o único que pegaria um erro de montagem que só
    aparece quando há o que desenhar.
  */
  it("monta os seis andares", async () => {
    vi.stubGlobal("fetch", servidor());
    montar();

    // 1 — o veredito
    await waitFor(() => expect(screen.getByText("+R$ 21.931")).toBeTruthy());
    expect(screen.getByText("Impacto líquido apurado")).toBeTruthy();
    // a faixa de confiança, logo abaixo
    expect(screen.getByText(/apenas 7 de 102 alterações/)).toBeTruthy();

    // 2 — o placar
    expect(screen.getByText("Alterações detectadas")).toBeTruthy();
    expect(screen.getByText("Veículos afetados")).toBeTruthy();
    expect(screen.getByText("Sem impacto calculável")).toBeTruthy();
    expect(screen.getByText("Cobertura da apuração")).toBeTruthy();

    // 3 — a composição
    expect(screen.getByText("Composição do impacto líquido")).toBeTruthy();

    // 4 — a trajetória, e o funil que desce dela
    expect(screen.getByText("Impacto das alterações por vigência")).toBeTruthy();
    expect(screen.getByText("Maiores impactos positivos desta vigência")).toBeTruthy();
    expect(screen.getByText("Maiores impactos negativos desta vigência")).toBeTruthy();
    expect(screen.getByText("Principais mudanças")).toBeTruthy();
    expect(screen.getByText("abra a Linha do Tempo")).toBeTruthy();

    // 5 — o mapa
    expect(screen.getByText("Movimentação da frota")).toBeTruthy();
    expect(screen.getByText("Carreta — o mais tocado")).toBeTruthy();

    // 6 — a procedência
    await waitFor(() => expect(screen.getByText("De onde vêm estes números")).toBeTruthy());
    expect(screen.getByText("Cobertura auditada")).toBeTruthy();

    /*
      E a fila não está mais aqui. O andar que mandava embora saiu, e é este
      `queryByText` que impede que ele volte por descuido — um `getByText` a
      menos no teste acima não acusaria nada.
    */
    expect(screen.queryByText("O que fazer agora")).toBeNull();
  });

  /*
    A ordem do andar 4 é o ponto dele, e `getByText` não a vê: os quatro
    títulos passariam na ordem inversa. A leitura desce um degrau por vez —
    a vigência no gráfico, a família nos dois cartões, o parâmetro na lista —,
    e é isso que este teste prende.
  */
  it("desce o andar 4 em grão: vigência, família, parâmetro", async () => {
    vi.stubGlobal("fetch", servidor());
    montar();

    await waitFor(() => expect(screen.getByText("Impacto das alterações por vigência")).toBeTruthy());

    const ordem = [
      "Impacto das alterações por vigência",
      "Maiores impactos positivos desta vigência",
      "Principais mudanças",
    ].map((titulo) => screen.getByText(titulo));

    for (let i = 1; i < ordem.length; i += 1) {
      /*
        `DOCUMENT_POSITION_FOLLOWING` lê a ordem do documento, e não a do
        layout: é ela que o leitor de tela percorre e a que o `space-y` da
        página desenha de cima para baixo.
      */
      expect(
        ordem[i - 1].compareDocumentPosition(ordem[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  /*
    **A promessa central do módulo, no nível da página.**

    O Panorama existe para desfazer uma redundância entre quatro telas que liam
    a mesma resposta. O jeito de ele falhar é publicar um quinto número — e este
    é o teste que torna essa falha visível na revisão em vez de na reunião:
    duas telas, uma resposta, o mesmo líquido.
  */
  it("publica o mesmo líquido que o Impacto Apurado, sobre a mesma resposta", async () => {
    vi.stubGlobal("fetch", servidor());

    montar();
    await waitFor(() => expect(screen.getByText("+R$ 21.931")).toBeTruthy());
    cleanup();

    montar(ImpactoApurado);
    await waitFor(() => expect(screen.getByText("+R$ 21.931")).toBeTruthy());
  });

  /*
    As duas coberturas existem, e agora elas estão em andares diferentes com
    nomes que dizem de que são percentual. Era o defeito que a seção tinha: dois
    números do mesmo recorte, os dois em percentual, os dois num anel, e nada na
    tela dizendo que contavam populações diferentes.
  */
  it("separa as duas coberturas por assunto, e diz de que cada uma é percentual", async () => {
    vi.stubGlobal("fetch", servidor());
    montar();

    await waitFor(() => expect(screen.getByText("Cobertura da apuração")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Cobertura auditada")).toBeTruthy());

    /* A auditada diz, por extenso, que é percentual de célula de planilha. */
    expect(screen.getByText(/das células importadas/)).toBeTruthy();

    /*
      E a definição da outra nomeia a distinção em vez de deixá-la implícita:
      é a frase que faltava quando as duas moravam em telas vizinhas.
    */
    expect(
      screen.getByLabelText(/Não confundir com a cobertura auditada/),
    ).toBeTruthy();
  });
});
