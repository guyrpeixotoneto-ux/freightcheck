// @vitest-environment jsdom
//
// A página inteira, montada — as três dobras de ponta a ponta.
//
// O Panorama consolida quatro módulos que liam a mesma resposta do servidor, e
// o risco que ele traz é o inverso da redundância que desfaz: publicar um
// **quinto** número, diferente dos quatro, sobre o mesmo dado. Por isso o teste
// que mais importa aqui não é o de que a tela abre — é o que monta o Panorama e
// o Impacto Apurado sobre a **mesma** resposta e exige o mesmo líquido dos dois.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const PROCEDENCIA = {
  recorte: {
    operacao: "EMPURRADA",
    scopeHash: "hash-pe",
    canal: "EMPURRADA",
    period: "2026-08-01",
    label: "PERNAMBUCO · EMPURRADA",
  },
  importacoes: [],
  conservacao: {
    arquivos: 3,
    fecham: 3,
    celulasDosArquivos: 47318,
    residuo: 0,
    exclusivaDesteRecorte: true,
  },
  atribuido: { vigenciasVivas: 1, celulasEmFato: 12004 },
  ultima: {
    importRunId: "1",
    filename: "cavalos.xlsx",
    status: "PROMOTED",
    receivedAt: "2026-08-01T09:12:00Z",
  },
};

/** Todo endpoint que a página toca, com a resposta que o servidor daria. */
const servidor = () =>
  vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    if (url.includes("/changes/families")) return resposta(VIGENCIA);
    if (url.includes("/changes/grouped")) return resposta(VIGENCIA);
    if (url.includes("/balance/recorte")) return resposta(PROCEDENCIA);
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
    As três dobras, de ponta a ponta. É o único teste que percorre a página
    inteira com dado em mãos, e o único que pegaria um erro de montagem que só
    aparece quando há o que desenhar.
  */
  it("monta as três dobras", async () => {
    vi.stubGlobal("fetch", servidor());
    montar();

    // 1 — a manchete: a resposta, o contexto e a confiança, num cartão
    await waitFor(() => expect(screen.getByText("+R$ 21.931")).toBeTruthy());
    expect(screen.getByText("Impacto líquido apurado")).toBeTruthy();
    // a composição do líquido, na coluna ao lado do número
    expect(screen.getByText("Composição")).toBeTruthy();
    expect(screen.getByText("ganhos")).toBeTruthy();
    expect(screen.getByText("perdas")).toBeTruthy();
    // a régua de medidas, na segunda linha do mesmo cartão
    expect(screen.getByText("Alterações detectadas")).toBeTruthy();
    expect(screen.getByText("Veículos afetados")).toBeTruthy();
    expect(screen.getByText("Sem impacto calculável")).toBeTruthy();
    expect(screen.getByText("Cobertura da apuração")).toBeTruthy();
    // e a confiança, na terceira
    expect(screen.getByText(/apenas 7 de 102 alterações/)).toBeTruthy();

    // 2 — de onde vem: a ponte e o ranking, lado a lado
    expect(screen.getByText("Composição do impacto líquido")).toBeTruthy();
    expect(screen.getByText("Onde o dinheiro se mexeu")).toBeTruthy();

    // 3 — quando e onde: a trajetória e o mapa, lado a lado
    expect(screen.getByText("Impacto das alterações por vigência")).toBeTruthy();
    expect(screen.getByText("abra a Linha do Tempo")).toBeTruthy();
    expect(screen.getByText("Movimentação da frota")).toBeTruthy();
    expect(screen.getByText("Carreta — o mais tocado")).toBeTruthy();

    // o rodapé — a procedência
    await waitFor(() => expect(screen.getByText("De onde vêm estes números")).toBeTruthy());
    expect(screen.getByText("Fontes deste recorte")).toBeTruthy();

    /*
      E a fila não está mais aqui — nem como cartão, nem como promessa.

      A busca é por expressão regular e sem diferenciar maiúsculas de propósito.
      A versão exata (`"O que fazer agora"`) casava com o título do cartão e
      mais nada: passou verde enquanto a frase de abertura da tela continuava
      terminando em "…e o que fazer agora", prometendo um andar que já tinha
      saído. Um teste que só vigia o título não vigia a promessa.
    */
    expect(screen.queryByText(/o que fazer agora/i)).toBeNull();
  });

  /*
    **O número da vigência aparece uma vez.**

    Este é o teste da refeitura das dobras, e ele vigia o defeito que ela
    desfez: o líquido apurado estava impresso seis vezes na mesma tela — a
    manchete, o primeiro cartão do placar, a barra final da ponte, o rodapé dos
    dois cartões de pódio e a linha da lista de parâmetros. Não era desacordo
    entre números (eles concordavam, e os outros testes desta suíte garantem
    isso): era a mesma verdade ocupando cinco telas de rolagem, que é o que
    fazia a leitura executiva não caber numa leitura.

    A régua é o texto exato da manchete. A ponte desenha o líquido numa barra de
    SVG, sem nó de texto, e por isso ela não conta aqui — o que este teste
    proíbe é **reimprimir o número**.
  */
  it("publica o líquido da vigência uma vez, e não seis", async () => {
    vi.stubGlobal("fetch", servidor());
    montar();

    await waitFor(() => expect(screen.getByText("+R$ 21.931")).toBeTruthy());
    expect(screen.getAllByText("+R$ 21.931")).toHaveLength(1);

    /* E o par que o produz, idem: ele é da coluna da composição, e de mais
       ninguém. */
    expect(screen.getAllByText("+R$ 26.583")).toHaveLength(1);
  });

  /*
    O ranking é um cartão com duas chaves, e não três cartões.

    Eram dois pódios de família (o que somou, o que tirou) e uma lista de
    parâmetros — três blocos de largura inteira sobre a mesma lista. Aqui o grão
    é uma pastilha, e o que ela troca é a lista **no mesmo cartão**: a família
    sai, o parâmetro entra, e o título continua sendo um só.
  */
  it("o ranking desce de família para parâmetro sem virar outro cartão", async () => {
    vi.stubGlobal("fetch", servidor());
    montar();

    await waitFor(() => expect(screen.getByText("Onde o dinheiro se mexeu")).toBeTruthy());

    /* O grão de abertura é a família — o agregado antes do detalhe. */
    expect(screen.getByText(/por família da remuneração/)).toBeTruthy();
    expect(screen.getByText("AQUISICAO")).toBeTruthy();
    expect(screen.queryByText("financiamento")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Parâmetro" }));

    /* O parâmetro que compõe a família — o degrau abaixo, no mesmo cartão. */
    await waitFor(() => expect(screen.getByText("financiamento")).toBeTruthy());
    expect(screen.getByText(/por parâmetro/)).toBeTruthy();
    expect(screen.queryByText("AQUISICAO")).toBeNull();
    /* Um cartão, e não dois: o título não se multiplicou. */
    expect(screen.getAllByText("Onde o dinheiro se mexeu")).toHaveLength(1);
  });

  /*
    A ordem das dobras é a ordem das perguntas, e `getByText` não a vê: os
    títulos passariam na ordem inversa. A leitura desce da resposta para a
    composição e daí para o contexto — e é isso que este teste prende.
  */
  it("desce em ordem: a resposta, de onde vem, quando e onde", async () => {
    vi.stubGlobal("fetch", servidor());
    montar();

    await waitFor(() => expect(screen.getByText("Onde o dinheiro se mexeu")).toBeTruthy());

    const ordem = [
      "Impacto líquido apurado",
      "Composição do impacto líquido",
      "Onde o dinheiro se mexeu",
      "Impacto das alterações por vigência",
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
  it("há uma cobertura só na tela, e é a da apuração", async () => {
    vi.stubGlobal("fetch", servidor());
    montar();

    await waitFor(() => expect(screen.getByText("Cobertura da apuração")).toBeTruthy());

    /*
      A auditada saiu, e não foi para outro andar: ela era um percentual do
      acervo inteiro publicado debaixo do cabeçalho de uma unidade. O que a
      substitui são contagens do recorte — e nenhum percentual, porque o resíduo
      não se rateia.
    */
    expect(screen.queryByText("Cobertura auditada")).toBeNull();
    await waitFor(() => expect(screen.getByText("Células deste recorte")).toBeTruthy());
    expect(screen.getByText(/viraram fato · os arquivos trouxeram/)).toBeTruthy();
  });
});

/*
  O andar 6, nos quatro desfechos que eram um só.

  As duas leituras da procedência saíam com `.catch(() => null)`, e o `null`
  fazia o andar sumir. De modo que "não há importação conferida" — uma
  afirmação sobre o acervo —, "a API caiu", "você não tem acesso" e "ainda estou
  lendo" produziam exatamente a mesma tela: nenhuma. Num andar que existe para
  responder "posso confiar nisto?", isso faz **ausência de evidência** parecer
  **evidência de ausência**.

  O que estes casos protegem não é o texto de cada estado — é que os quatro
  continuem sendo quatro, e que nenhum deles volte a ser o silêncio.
*/
describe("a procedência, quando ela não tem o que publicar", () => {
  /** O mesmo servidor da suíte, com a rota da procedência trocável. */
  const servidorCom = (recorte: () => Response) =>
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes("/changes/families")) return resposta(VIGENCIA);
      if (url.includes("/changes/grouped")) return resposta(VIGENCIA);
      if (url.includes("/balance/recorte")) return recorte();
      return resposta({ from: "2026-07-01", to: "2026-08-01", periods: [], entries: [] });
    });

  const caiu = () => resposta({ error: "indisponível" }, 503);
  const negou = () => resposta({ error: "sem permissão" }, 403);
  /*
    Recorte legítimo, sem arquivo a conferir — a única lista vazia legítima da
    rota, e o que a tela lê como "não há o que conferir".
  */
  const vazio = () =>
    resposta({
      ...PROCEDENCIA,
      conservacao: { ...PROCEDENCIA.conservacao, arquivos: 0, fecham: 0, celulasDosArquivos: 0 },
      atribuido: { vigenciasVivas: 1, celulasEmFato: 0 },
      ultima: null,
    });

  it("com as duas rotas fora, diz que não conseguiu ler — e não que não há dado", async () => {
    vi.stubGlobal("fetch", servidorCom(caiu));
    montar();

    await waitFor(() =>
      expect(screen.getByText("Não foi possível conferir a procedência")).toBeTruthy(),
    );
    expect(screen.getByText(/está dizendo que não conseguiu ler/)).toBeTruthy();

    /* O endereço e o status saem por extenso: é o que liga a tela ao log. */
    expect(screen.getByText(/\/balance\/recorte · HTTP 503/)).toBeTruthy();

    /* E os andares acima continuam de pé — a falha é sobre a confiança neles. */
    expect(screen.getByText("Impacto líquido apurado")).toBeTruthy();
  });

  it("um 403 manda procurar o acesso, e não o servidor", async () => {
    vi.stubGlobal("fetch", servidorCom(negou));
    montar();

    await waitFor(() =>
      expect(
        screen.getByText("Seu acesso não alcança a conferência das importações"),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/você é que não o vê/)).toBeTruthy();

    /*
      Sem botão de tentar de novo: repetir o pedido devolve o mesmo 403, e um
      botão que não pode funcionar é uma promessa que a tela não cumpre.
    */
    expect(screen.queryByText("Tentar de novo")).toBeNull();
  });

  it("sem importação conferida, a frase é sobre o acervo — e o andar continua na tela", async () => {
    vi.stubGlobal("fetch", servidorCom(vazio));
    montar();

    await waitFor(() =>
      expect(
        screen.getByText("Nenhuma importação deste recorte passou pela conferência"),
      ).toBeTruthy(),
    );
    /* A frase salva os cinco andares acima em vez de deixá-los sob suspeita. */
    expect(screen.getByText(/continuam válidos/)).toBeTruthy();
    /* E o título do andar continua desenhado: ele não some mais. */
    expect(screen.getByText("De onde vêm estes números")).toBeTruthy();
  });

  it("publica a procedência do recorte aberto, e nomeia o recorte", async () => {
    vi.stubGlobal("fetch", servidor());
    montar();

    /*
      A pastilha do recorte é o que este andar não tinha, e por isso mentia de
      escopo: um número de procedência sem o recorte ao lado é indistinguível de
      um número do acervo inteiro — que é o que ele era.
    */
    await waitFor(() =>
      expect(screen.getByText(/o mesmo recorte dos andares acima/)).toBeTruthy(),
    );
    expect(screen.getByText("Fontes deste recorte")).toBeTruthy();
    expect(screen.getByText("Células deste recorte")).toBeTruthy();
    expect(screen.getByText("Última importação deste recorte")).toBeTruthy();
  });
});

/**
 * O PAR DO PANORAMA — as duas pontas, e o que Inverter pede ao servidor.
 *
 * O caso que mais importa aqui é o da volta, e ele não é sobre desenho: é sobre
 * de onde vem o número. Inverter **não** pode negar o sinal do que já está em
 * tela — 100→110 é +10,0% e 110→100 é −9,09% —, então o que este bloco prende é
 * que o clique produz uma pergunta nova ao motor, na rota do par, com as duas
 * pontas trocadas. Um teste que só olhasse a tela passaria verde sobre uma
 * implementação que multiplicasse tudo por −1.
 */
describe("o par do Panorama", () => {
  /** Os endereços que a tela pediu, na ordem. */
  let pedidos: string[] = [];

  /** O servidor do par: a leitura de sempre, e a do par quando ele é pedido. */
  const servidorDoPar = (doPar: () => Response = () => resposta(INVERTIDA)) =>
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      pedidos.push(url);
      if (url.includes("/changes/families/par")) return doPar();
      if (url.includes("/changes/families")) return resposta(VIGENCIA);
      if (url.includes("/changes/grouped")) return resposta(VIGENCIA);
      if (url.includes("/balance/recorte")) return resposta(PROCEDENCIA);
      return resposta({ from: "2026-07-01", to: "2026-08-01", periods: [], entries: [] });
    });

  /* A volta, como o servidor a devolveria: o mesmo corpo, com a chegada em
     julho. Os números não são o assunto deste bloco — de onde eles vêm, é. */
  const INVERTIDA = {
    ...VIGENCIA,
    period: "2026-07-01",
    periodLabel: "julho de 2026",
    par: { de: "2026-08-01", para: "2026-07-01", invertido: true, calculadas: 1 },
  };

  const abrirEm = (busca: string) =>
    window.history.pushState({}, "", busca ? `/?${busca}` : "/");

  afterEach(() => {
    pedidos = [];
    window.history.pushState({}, "", "/");
  });

  it("mostra as duas pontas do par, e o cabeçalho deixa de ter o seletor de vigência", async () => {
    abrirEm("period=2026-08-01");
    vi.stubGlobal("fetch", servidorDoPar());
    montar();

    await waitFor(() => expect(screen.getByText("+R$ 21.931")).toBeTruthy());

    /* As duas caixas, com o par natural dentro: de julho para agosto. */
    expect(screen.getByLabelText("De (vigência de origem)").textContent).toContain(
      "julho de 2026",
    );
    expect(screen.getByLabelText("Para (vigência de destino)").textContent).toContain(
      "agosto de 2026",
    );

    /*
      E o menu do cabeçalho saiu: dois controles escolhendo a mesma vigência, na
      mesma tela, seriam duas perguntas disputando o mesmo gesto.
    */
    expect(screen.queryByText("Trocar vigência")).toBeNull();
  });

  /*
    O par natural não escreve `?de=` no endereço, e por isso continua lendo
    `/changes/families` — a mesma chave de cache do Impacto Apurado e do
    Dashboard. É o que faz ir e voltar entre os módulos não custar requisição.
  */
  it("o par natural continua na leitura de sempre, sem rota nova", async () => {
    abrirEm("period=2026-08-01");
    vi.stubGlobal("fetch", servidorDoPar());
    montar();

    await waitFor(() => expect(screen.getByText("+R$ 21.931")).toBeTruthy());
    expect(pedidos.some((url) => url.includes("/changes/families?"))).toBe(true);
    expect(pedidos.some((url) => url.includes("/changes/families/par"))).toBe(false);
  });

  it("inverter pede o par invertido ao motor — não troca o sinal na tela", async () => {
    abrirEm("period=2026-08-01");
    vi.stubGlobal("fetch", servidorDoPar());
    montar();

    await waitFor(() => expect(screen.getByText("+R$ 21.931")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Inverter/ }));

    /* O endereço passa a descrever o par inteiro — e é colável. */
    await waitFor(() => expect(window.location.search).toContain("period=2026-07-01"));
    expect(window.location.search).toContain("base=2026-08-01");

    /* E a pergunta sai pela rota do par, com as pontas trocadas. */
    await waitFor(() =>
      expect(
        pedidos.some(
          (url) =>
            url.includes("/changes/families/par") &&
            url.includes("base=2026-08-01") &&
            url.includes("comparada=2026-07-01"),
        ),
      ).toBe(true),
    );

    /* As caixas seguem o endereço: agora se lê de agosto para julho. */
    await waitFor(() =>
      expect(screen.getByLabelText("De (vigência de origem)").textContent).toContain(
        "agosto de 2026",
      ),
    );
    expect(screen.getByLabelText("Para (vigência de destino)").textContent).toContain(
      "julho de 2026",
    );
  });

  /*
    A recusa do motor é uma frase escrita para quem clicou, e ela não pode levar
    o controle embora junto: sem as caixas em tela, desfazer a escolha exigiria o
    botão do navegador.
  */
  it("a recusa do motor fica escrita, e o seletor continua em tela", async () => {
    abrirEm("period=2026-07-01&base=2026-08-01");
    vi.stubGlobal(
      "fetch",
      servidorDoPar(() =>
        resposta(
          {
            error:
              'Coberturas diferentes: "EMPURRADA_1_8" cobre CAVALO e "EMPURRADA_1_7" cobre CARRETA+CAVALO.',
          },
          422,
        ),
      ),
    );
    montar();

    await waitFor(() => expect(screen.getByText(/Coberturas diferentes/)).toBeTruthy());
    expect(screen.getByLabelText("De (vigência de origem)")).toBeTruthy();
    expect(screen.getByLabelText("Para (vigência de destino)")).toBeTruthy();
  });
});
