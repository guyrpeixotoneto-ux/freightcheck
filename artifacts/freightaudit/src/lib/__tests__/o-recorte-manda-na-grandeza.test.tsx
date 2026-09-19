// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// O RECORTE MANDA NA GRANDEZA — a bateria do defeito de 18/09/2026
// ---------------------------------------------------------------------------
//
// O que se prova aqui é uma frase só: **o que decide o eixo do gráfico é o
// recorte que a tela desenha, e nada fora dele**.
//
// O defeito que ela fecha tinha três partes, e as três estão cobertas abaixo:
//
//   1. a grandeza era escolhida sobre o intervalo **carregado** (até 24
//      vigências) e o desenho acontecia sobre o **recorte** (3, 6 ou 12). Uma
//      alteração anual de meio milhão em janeiro elegia R$/ano, e as seis
//      vigências mensais desenhadas saíam todas coladas no zero;
//   2. a vigência sem preço apurado era desenhada como `R$ 0`, que é a
//      afirmação oposta à verdadeira — "apurou-se, e não moveu nada" no lugar
//      de "ninguém apurou";
//   3. o seletor De/Para escolhia a periodicidade da coluna por uma régua
//      própria, e publicava R$/mês ao lado de um gráfico em R$/ano.
//
// Os testes leem as três superfícies da mesma dobra — o gráfico, o seletor e o
// cartão da janela — porque o defeito só aparecia quando elas eram lidas
// juntas: cada uma, sozinha, estava certa.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSerieDeImpacto } from "../serie-de-impacto";
import { resumirIntervalo } from "@/hooks/use-resumo-por-vigencia";
import { janelaDoImpacto } from "../panorama";
import { GraficoDeImpacto } from "@/components/dashboard/grafico-de-impacto";
import type { Janela } from "@/lib/janela-de-vigencias";
import type { Movimentos, RangeEntry } from "../analise";

class ObservadorDeTamanho {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ObservadorDeTamanho as unknown as typeof ResizeObserver;

const CONTEXTOS = [
  {
    scopeHash: "camacari",
    channel: null,
    label: "CAMAÇARI",
    scopes: [],
    latestPeriod: "2026-08-01",
    periods: 8,
    periodosDisponiveis: [
      "2026-01-16",
      "2026-02-16",
      "2026-03-16",
      "2026-04-16",
      "2026-05-16",
      "2026-06-16",
      "2026-07-16",
      "2026-08-01",
    ],
  },
];

vi.mock("../contextos", async (original) => ({
  ...(await original<typeof import("../contextos")>()),
  useContextosDaCasca: () => ({ contextos: CONTEXTOS, carregando: false, indisponivel: false }),
}));

const buscar = vi.fn<(caminho: string) => Promise<Movimentos | null>>();
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  fetchJsonOrNull: (caminho: string) => buscar(caminho),
}));

afterEach(() => {
  cleanup();
  buscar.mockReset();
});

// ---------------------------------------------------------------------------
// O dado — o de Camaçari, que é onde o defeito foi visto
// ---------------------------------------------------------------------------

/**
 * O dinheiro deste histórico, e por que ele é exatamente assim:
 *
 * - **janeiro** carrega −R$ 590.437,65 **por ano** — o valor anual grande, e a
 *   única vigência anual do histórico. É ele que, de fora do recorte, elegia
 *   o eixo;
 * - **maio, junho e agosto** carregam dezenas de milhares **por mês** — o
 *   dinheiro que o gráfico chapado escondia;
 * - **março** tem 400 alterações e nenhuma com preço: a vigência desconhecida;
 * - **fevereiro** não teve alteração nenhuma: o zero de verdade.
 */
const VALORES: { period: string; amount: number | null; periodicity: string | null }[] = [
  { period: "2026-01-16", amount: -590437.65, periodicity: "ANUAL" },
  { period: "2026-04-16", amount: 16588.35, periodicity: "MENSAL" },
  { period: "2026-05-16", amount: 73772.05, periodicity: "MENSAL" },
  { period: "2026-06-16", amount: -20996.9, periodicity: "MENSAL" },
  { period: "2026-08-01", amount: 11916.7, periodicity: "MENSAL" },
  // Março: alteração detectada, preço nenhum.
  { period: "2026-03-16", amount: null, periodicity: null },
  // Julho: idem — é a segunda vigência sem apuração do recorte de seis.
  { period: "2026-07-16", amount: null, periodicity: null },
];

const ALTERACOES: Record<string, number> = {
  "2026-01-16": 560,
  "2026-02-16": 0,
  "2026-03-16": 400,
  "2026-04-16": 402,
  "2026-05-16": 383,
  "2026-06-16": 269,
  "2026-07-16": 593,
  "2026-08-01": 267,
};

function entrada(period: string, amount: number | null, periodicity: string | null): RangeEntry {
  return {
    key: `${period}:${periodicity}`,
    period,
    periodLabel: period,
    parameterKey: "REMUNERACAO|p",
    parameterName: "p",
    family: "REMUNERACAO",
    attributeCode: "cavalo.finame",
    title: "P",
    equipment: "CAVALO",
    entityType: "CAVALO",
    vehicles: 1,
    unit: null,
    amount,
    periodicity,
    confidence: amount === null ? "NOT_CALCULABLE" : "CALCULATED",
    reason: null,
    badge: "b",
    badgeLabel: "B",
    group: { key: `g:${period}`, attributeCode: "cavalo.finame" } as RangeEntry["group"],
  };
}

const PERIODOS = CONTEXTOS[0].periodosDisponiveis;

/** O `byPeriodicity` de uma vigência — o que o servidor soma por ela. */
function porPeriodicidade(period: string): Record<string, number> {
  const somas: Record<string, number> = {};
  for (const v of VALORES) {
    if (v.period !== period || v.amount === null || v.periodicity === null) continue;
    somas[v.periodicity] = (somas[v.periodicity] ?? 0) + v.amount;
  }
  return somas;
}

function movimentos(): Movimentos {
  return {
    from: PERIODOS[0],
    fromLabel: "jan",
    to: "2026-08-01",
    toLabel: "ago",
    periods: PERIODOS.map((date) => ({ date, label: date })),
    movements: PERIODOS.map((period) => ({
      period,
      changes: ALTERACOES[period],
      impact: { byPeriodicity: porPeriodicidade(period) },
    })) as unknown as Movimentos["movements"],
    gaps: [],
    impact: { byPeriodicity: {}, notCalculable: 0 },
    lossesByPeriodicity: {},
    gainsByPeriodicity: {},
    totals: { changes: 3274, vehiclesTouched: 112, comparisons: 7 },
    byParameter: [],
    entries: VALORES.map((v) => entrada(v.period, v.amount, v.periodicity)),
  };
}

// ---------------------------------------------------------------------------
// A tela mínima — a mesma ligação que o Panorama faz
// ---------------------------------------------------------------------------

function Tela({ janela }: { janela: Janela }) {
  const consulta = new URLSearchParams({ scopeHash: "camacari", period: "2026-08-01" });
  const serie = useSerieDeImpacto(null, consulta, true, null, janela);
  return (
    <>
      <span data-testid="eixo">{serie.periodicity ?? "—"}</span>
      <span data-testid="vigencias">{serie.pontos.map((p) => p.periodo).join(" ")}</span>
      <span data-testid="liquidos">
        {serie.pontos.map((p) => (p.liquido === null ? "null" : String(p.liquido))).join(" ")}
      </span>
      <GraficoDeImpacto
        pontos={serie.pontos}
        periodicity={serie.periodicity}
        carregando={serie.carregando}
        carregadas={serie.carregadas}
        cobertura={serie.cobertura}
        janela={janela}
        periodicidades={serie.disponiveis}
        onPeriodicidade={() => {}}
      />
    </>
  );
}

const cliente = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

function montar(janela: Janela) {
  buscar.mockResolvedValue(movimentos());
  return render(
    <QueryClientProvider client={cliente()}>
      <Tela janela={janela} />
    </QueryClientProvider>,
  );
}

const eixo = () => screen.getByTestId("eixo").textContent;
const liquidos = () => screen.getByTestId("liquidos").textContent!.split(" ");
const vigencias = () => screen.getByTestId("vigencias").textContent!.split(" ");

// ---------------------------------------------------------------------------

describe("a vigência anual grande fora do recorte", () => {
  it("não elege o eixo das seis vigências desenhadas — o defeito dos prints", async () => {
    montar({ unidade: "vigencias", quantidade: 6 });

    await waitFor(() => expect(eixo()).not.toBe("—"));

    /*
      Janeiro (−R$ 590.437,65/ano) é a maior magnitude do histórico carregado e
      está **fora** das seis desenhadas (março→agosto). Era ela que punha o
      eixo em R$/ano; agora o recorte decide, e o recorte é mensal.
    */
    expect(vigencias()).not.toContain("2026-01-16");
    expect(eixo()).toBe("MENSAL");

    // E o que se desenha tem dinheiro: não são seis pontos colados no zero.
    const comValor = liquidos().filter((v) => v !== "null" && v !== "0");
    expect(comValor.length).toBeGreaterThan(1);
  });

  it("a grandeza de fora também não aparece no seletor de grandeza do gráfico", async () => {
    montar({ unidade: "vigencias", quantidade: 6 });
    await waitFor(() => expect(eixo()).toBe("MENSAL"));

    /*
      Com uma grandeza só no recorte, não há troca a oferecer: o botão R$/ano
      prometeria uma série que o recorte não tem.
    */
    expect(screen.queryByRole("group", { name: "Grandeza do gráfico" })).toBeNull();
  });
});

describe("o recorte totalmente desconhecido", () => {
  it("publica o estado, e não uma linha chapada em zero", async () => {
    /*
      O recorte de março→abril tem uma vigência sem preço (março) e uma
      apurada (abril). Para provar o recorte **todo** desconhecido, a leitura
      volta sem nenhuma linha com preço.
    */
    buscar.mockResolvedValue({
      ...movimentos(),
      entries: [entrada("2026-07-16", null, null), entrada("2026-08-01", null, null)],
    });
    render(
      <QueryClientProvider client={cliente()}>
        <Tela janela={{ unidade: "vigencias", quantidade: 3 }} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("Impacto financeiro ainda não calculado")).toBeTruthy(),
    );
    expect(
      screen.getByText(
        /As alterações deste período ainda não possuem preço apurado\. O resultado é desconhecido, não zero\./,
      ),
    ).toBeTruthy();

    // Requisito 3: nenhum valor desconhecido publicado como R$ 0.
    expect(screen.queryByText(/R\$\s?0/)).toBeNull();
    expect(eixo()).toBe("—");
    expect(liquidos().every((v) => v === "null")).toBe(true);
  });
});

describe("o recorte misto — calculado e desconhecido lado a lado", () => {
  it("desenha só os calculados, deixa lacuna nos demais e declara a cobertura", async () => {
    montar({ unidade: "vigencias", quantidade: 6 });
    await waitFor(() => expect(eixo()).toBe("MENSAL"));

    // março e julho não têm preço; abril, maio, junho e agosto têm.
    const porVigencia = Object.fromEntries(
      vigencias().map((periodo, i) => [periodo, liquidos()[i]]),
    );
    expect(porVigencia["2026-03-16"]).toBe("null");
    expect(porVigencia["2026-07-16"]).toBe("null");
    expect(porVigencia["2026-05-16"]).toBe("73772.05");

    // A cobertura do recorte, escrita ao lado do gráfico.
    expect(
      screen.getByText(/4 de 6 vigências com valor apurado em R\$\/mês — 2 sem preço apurado\./),
    ).toBeTruthy();
    expect(screen.getByText(/desconhecido, não zero/)).toBeTruthy();
  });

  it("a vigência sem alteração nenhuma continua sendo zero, e não lacuna", async () => {
    montar({ unidade: "vigencias", quantidade: 12 });
    await waitFor(() => expect(eixo()).not.toBe("—"));

    const porVigencia = Object.fromEntries(
      vigencias().map((periodo, i) => [periodo, liquidos()[i]]),
    );
    // Fevereiro: 0 alterações no intervalo — nada mudou, e isso é um zero.
    expect(porVigencia["2026-02-16"]).toBe("0");
    // Março: 400 alterações, nenhuma com preço — desconhecido.
    expect(porVigencia["2026-03-16"]).toBe("null");
  });
});

describe("a troca entre 3, 6 e 12 vigências", () => {
  it("cada recorte resolve a própria grandeza, e nenhum herda a do vizinho", async () => {
    const tres = montar({ unidade: "vigencias", quantidade: 3 });
    await waitFor(() => expect(eixo()).toBe("MENSAL"));
    // junho, julho, agosto — só mensal, e julho em branco.
    expect(vigencias()).toEqual(["2026-06-16", "2026-07-16", "2026-08-01"]);
    expect(liquidos()).toEqual(["-20996.9", "null", "11916.7"]);
    tres.unmount();
    cleanup();

    const seis = montar({ unidade: "vigencias", quantidade: 6 });
    await waitFor(() => expect(eixo()).toBe("MENSAL"));
    expect(vigencias()).toHaveLength(6);
    expect(vigencias()).not.toContain("2026-01-16");
    seis.unmount();
    cleanup();

    /*
      Em doze, janeiro entra no recorte — e aí a grandeza dele **manda**, porque
      agora ele é parte do que a tela mostra. É a mesma régua: quem está dentro
      decide, quem está fora não opina. O eixo vira R$/ano e as vigências
      mensais viram lacuna declarada, em vez de zeros.
    */
    montar({ unidade: "vigencias", quantidade: 12 });
    await waitFor(() => expect(vigencias()).toContain("2026-01-16"));
    expect(eixo()).toBe("ANUAL");
    const porVigencia = Object.fromEntries(
      vigencias().map((periodo, i) => [periodo, liquidos()[i]]),
    );
    expect(porVigencia["2026-01-16"]).toBe("-590437.65");
    expect(porVigencia["2026-05-16"]).toBe("null");
    // E a tela diz que o mensal existe: as duas grandezas viram um gesto.
    expect(screen.getByRole("group", { name: "Grandeza do gráfico" })).toBeTruthy();
  });

  it("o seletor de janela aparece pelo intervalo carregado, não pelo recorte", async () => {
    montar({ unidade: "vigencias", quantidade: 3 });
    await waitFor(() => expect(eixo()).toBe("MENSAL"));
    /*
      Três pontos em tela e oito vigências carregadas: sem `carregadas`, o
      gráfico concluiria do próprio desenho que não há o que recortar e
      esconderia o seletor — prendendo quem abriu no recorte de três.
    */
    expect(screen.getByRole("button", { name: "12" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "6" })).toBeTruthy();
  });
});

describe("a coerência entre o gráfico, o seletor e o cartão da janela", () => {
  it("as três superfícies publicam a mesma grandeza — uma régua só", async () => {
    montar({ unidade: "vigencias", quantidade: 6 });
    await waitFor(() => expect(eixo()).toBe("MENSAL"));

    const leitura = movimentos();

    /*
      O SELETOR De/Para. A régua dele era a presença ("em quantas vigências
      esta grandeza existe"), e a do gráfico era o movimento no recorte; com o
      histórico inteiro na mão, a presença dá MENSAL e tudo parece bem — o
      defeito aparecia quando o gráfico caía em ANUAL e a coluna ficava em
      MENSAL. Agora a coluna recebe a grandeza que o gráfico resolveu.
    */
    const coluna = resumirIntervalo(leitura.movements, { periodicidade: eixo() });
    expect(coluna.periodicidade).toBe(eixo());
    expect(coluna.porVigencia.get("2026-05-16")?.impacto).toBe(73772.05);
    // A vigência sem preço não vira R$ 0 na coluna tampouco.
    expect(coluna.porVigencia.get("2026-03-16")?.impacto).toBeNull();

    /*
      O CARTÃO DA JANELA, ao lado do gráfico: mesma grandeza, pela mesma
      função do contrato.
    */
    const cartao = janelaDoImpacto(
      { ...leitura, impact: { byPeriodicity: { MENSAL: 81280.2, ANUAL: -590437.65 } } },
      eixo(),
      5,
    );
    expect(cartao?.periodicity).toBe(eixo());
  });

  it("em R$/ano, as três seguem juntas — e nenhuma publica a outra grandeza", async () => {
    montar({ unidade: "vigencias", quantidade: 12 });
    await waitFor(() => expect(eixo()).toBe("ANUAL"));

    const leitura = movimentos();
    const coluna = resumirIntervalo(leitura.movements, { periodicidade: eixo() });
    expect(coluna.periodicidade).toBe("ANUAL");
    /*
      A coluna fica muda nas vigências mensais — e a linha delas diz que o
      dinheiro está noutra régua (`outrasPeriodicidades`), que é o que impede
      a ausência de ser lida como "não teve nada".
    */
    expect(coluna.porVigencia.get("2026-05-16")?.impacto).toBeNull();
    expect(coluna.porVigencia.get("2026-05-16")?.outrasPeriodicidades).toEqual(["MENSAL"]);

    const cartao = janelaDoImpacto(
      { ...leitura, impact: { byPeriodicity: { MENSAL: 81280.2, ANUAL: -590437.65 } } },
      eixo(),
      5,
    );
    expect(cartao?.periodicity).toBe("ANUAL");
  });
});
