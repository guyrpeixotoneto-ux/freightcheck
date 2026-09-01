// @vitest-environment jsdom
//
// Precisa de DOM porque o que se prova aqui é o que a tela **escreve** em cada
// estado do dado — e a diferença entre "R$ 0" e "sem valor apurado" só existe
// no texto renderizado. Nenhum teste daqui olha pixel: o que se lê é a frase.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Manchete, type ContextoDaManchete } from "@/components/impacto-apurado/manchete";
import {
  FaixaDeCobertura,
  FaixaSemAlteracao,
} from "@/components/impacto-apurado/faixa-de-cobertura";
import { PrincipaisMudancas } from "@/components/impacto-apurado/principais-mudancas";
import { OndeAgirAgora } from "@/components/impacto-apurado/onde-agir";
import { EvolucaoPorVigencia } from "@/components/impacto-apurado/evolucao-por-vigencia";
import {
  coberturaApurada,
  type MudancaRelevante,
  type SituacaoDaApuracao,
} from "@/lib/impacto-apurado";
import { comOperacao } from "@/lib/api";
import { consultaDoRecorte, sufixoDaConsulta } from "@/lib/leitura-da-vigencia";
import { JANELA_PADRAO } from "@/lib/janela-de-vigencias";
import type { LadosDoImpacto } from "@/lib/visao-geral";
import type { PontoDeImpacto } from "@/components/dashboard/grafico-de-impacto";

// O `ResponsiveContainer` do Recharts mede o elemento, e jsdom não traz o
// observador que ele usa — o mesmo esboço de `serie-de-impacto.tela.test.tsx`.
class ObservadorDeTamanho {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ObservadorDeTamanho as unknown as typeof ResizeObserver;

afterEach(cleanup);

const LADOS: LadosDoImpacto = {
  periodicity: "MENSAL",
  liquido: 21931,
  ganhos: 26583,
  perdas: -4652,
  fatiaDeGanho: 0.85,
};

const CONTEXTO: ContextoDaManchete = {
  alteracoes: 102,
  tiposDeAlteracao: 16,
  veiculos: 80,
  frota: 1284,
  veiculosDeduplicados: true,
};

const mudanca = (parcial: Partial<MudancaRelevante> = {}): MudancaRelevante => ({
  key: "financiamento",
  name: "Financiamento",
  familyCode: "AQUISICAO",
  familyName: "Aquisição e financiamento",
  ganhos: 18742,
  perdas: 0,
  liquido: 18742,
  movimento: 18742,
  alteracoes: 3,
  veiculos: 24,
  classificacao: "ganho",
  proporcao: 1,
  doisLados: false,
  ...parcial,
});

const montarManchete = (
  situacao: SituacaoDaApuracao,
  contexto: Partial<ContextoDaManchete> = {},
  outras: LadosDoImpacto[] = [],
) => render(<Manchete situacao={situacao} outras={outras} contexto={{ ...CONTEXTO, ...contexto }} />);

describe("a manchete", () => {
  it("publica o líquido com o sinal e a periodicidade colada", () => {
    montarManchete({ estado: "com_movimento", lados: LADOS });
    expect(screen.getByText("+R$ 21.931")).toBeTruthy();
    expect(screen.getByText("/mês")).toBeTruthy();
    expect(screen.getByText("Impacto líquido apurado")).toBeTruthy();
  });

  it("põe os dois lados e o contexto ao redor, sem competir com o número", () => {
    montarManchete({ estado: "com_movimento", lados: LADOS });
    expect(screen.getByText("+R$ 26.583")).toBeTruthy();
    expect(screen.getByText("−R$ 4.652")).toBeTruthy();
    expect(screen.getByText("80")).toBeTruthy();
    expect(screen.getByText("de 1.284 (6%)")).toBeTruthy();
    expect(screen.getByText("16 tipos de alteração")).toBeTruthy();
  });

  /*
    O defeito que este teste fecha: um `?? 0` no caminho da manchete faria a
    tela publicar "R$ 0" para uma vigência em que nada foi apurado — que se lê
    como "a mudança não custou nada", e não como "ainda não sabemos quanto
    custou".
  */
  it("sem apuração, diz que não há valor — nunca R$ 0", () => {
    montarManchete({ estado: "nada_apurado", semPreco: 102 }, { frota: null });
    expect(screen.getByText("Nenhum valor apurado")).toBeTruthy();
    expect(screen.getAllByText("sem valor apurado")).toHaveLength(2);
    expect(screen.queryByText("R$ 0")).toBeNull();
  });

  /*
    Os três desfechos sem movimento diziam a mesma frase, e não são o mesmo
    fato. O pior deles era o terceiro: uma vigência **apurada** cujo resultado
    deu zero aparecia como "nenhum valor apurado", apagando a apuração.
  */
  it("apurado em R$ 0,00 é medida, e não ausência de apuração", () => {
    montarManchete({ estado: "apurado_em_zero", periodicity: "MENSAL", alteracoes: 7 });

    expect(screen.getAllByText("R$ 0").length).toBeGreaterThan(0);
    expect(screen.getByText(/zero medido, e não ausência de apuração/)).toBeTruthy();
    expect(screen.queryByText("Nenhum valor apurado")).toBeNull();
    expect(screen.queryByText("sem valor apurado")).toBeNull();
  });

  it("vigência sem alteração não é vigência sem preço", () => {
    montarManchete({ estado: "sem_alteracao" });

    expect(screen.getByText("Nada mudou")).toBeTruthy();
    expect(screen.getAllByText("sem alteração")).toHaveLength(2);
    expect(screen.queryByText("R$ 0")).toBeNull();
  });

  /*
    Líquido zero por compensação é um quarto fato: houve ganho, houve perda, e
    eles se anularam. O número sozinho não mostra isso — a frase mostra.
  */
  it("líquido zero por compensação diz que houve movimento dos dois lados", () => {
    montarManchete({
      estado: "com_movimento",
      lados: { periodicity: "MENSAL", liquido: 0, ganhos: 5000, perdas: -5000, fatiaDeGanho: 0.5 },
    });

    expect(screen.getByText(/Ganhos e perdas se compensaram/)).toBeTruthy();
    expect(screen.getByText("+R$ 5.000")).toBeTruthy();
  });

  /*
    R$/mês e R$/ano não somam. A manchete publica um só, e o outro tem de
    aparecer em linha própria em vez de sumir da tela.
  */
  it("nomeia as outras periodicidades em vez de deixá-las sumir", () => {
    montarManchete({ estado: "com_movimento", lados: LADOS }, {}, [
      { periodicity: "ANUAL", liquido: -12000, ganhos: 0, perdas: -12000, fatiaDeGanho: null },
    ]);

    expect(screen.getByText(/também tem/)).toBeTruthy();
    expect(screen.getByText(/−R\$ 12\.000\/ano/)).toBeTruthy();
    expect(screen.getByText(/não somam com a de cima/)).toBeTruthy();
  });

  it("sem denominador confiável, não inventa percentual de frota", () => {
    montarManchete({ estado: "com_movimento", lados: LADOS }, { frota: null });
    expect(screen.queryByText(/de 1\.284/)).toBeNull();
    expect(screen.getByText("ativos distintos")).toBeTruthy();
  });

  it("diz quando a contagem de veículos é soma de unidades, e não ativos distintos", () => {
    montarManchete({ estado: "com_movimento", lados: LADOS }, {
      frota: null,
      veiculosDeduplicados: false,
    });
    expect(screen.getByText("soma das unidades")).toBeTruthy();
  });
});

describe("a faixa de cobertura", () => {
  it("declara o resultado parcial e quantas alterações ainda podem mudá-lo", () => {
    render(
      <FaixaDeCobertura cobertura={coberturaApurada(102, 95)!} verDetalhes="/alteracoes?x=1" />,
    );
    expect(screen.getByText(/Resultado parcial/)).toBeTruthy();
    expect(screen.getByText(/apenas 7 de 102 alterações \(7%\)/)).toBeTruthy();
    expect(screen.getByText(/95 alterações ainda não possuem preço apurado/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Ver detalhes/ })).toBeTruthy();
  });

  it("cobertura completa não vira alerta, e não oferece porta para uma lista vazia", () => {
    render(<FaixaDeCobertura cobertura={coberturaApurada(102, 0)!} verDetalhes="/alteracoes" />);
    expect(screen.getByText(/Resultado completo/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Ver detalhes/ })).toBeNull();
  });

  it("vigência sem alteração não é cobertura zero", () => {
    expect(coberturaApurada(0, 0)).toBeNull();
    render(<FaixaSemAlteracao temAnterior />);
    expect(screen.getByText("Nenhuma alteração detectada nesta vigência.")).toBeTruthy();
    expect(screen.queryByText(/0%/)).toBeNull();
  });

  /*
    "Nada mudou" é notícia sobre o cliente; "não há anterior" é notícia sobre o
    acervo. As duas chegam aqui como zero alteração, e trocá-las faria a tela
    afirmar que o cliente não mexeu em nada quando ninguém olhou.
  */
  it("vigência sem anterior não é vigência em que nada mudou", () => {
    render(<FaixaSemAlteracao temAnterior={false} />);
    expect(screen.getByText("Esta vigência não tem anterior com que comparar.")).toBeTruthy();
    expect(screen.queryByText(/não mudou nada/)).toBeNull();
  });
});

describe("as principais mudanças", () => {
  const LINHAS = [
    mudanca(),
    mudanca({
      key: "promocao",
      name: "Promoção",
      familyCode: "COMERCIAL",
      familyName: "Condição comercial",
      ganhos: 0,
      perdas: -3012,
      liquido: -3012,
      movimento: 3012,
      classificacao: "perda",
      proporcao: 0.16,
    }),
  ];

  const montar = (props: Partial<Parameters<typeof PrincipaisMudancas>[0]> = {}) =>
    render(
      <PrincipaisMudancas
        linhas={LINHAS}
        periodicity="MENSAL"
        filtro="todos"
        onFiltro={() => {}}
        onAbrir={() => {}}
        {...props}
      />,
    );

  it("mistura ganho e perda numa lista só, na ordem do dinheiro", () => {
    montar();
    const itens = screen.getAllByRole("listitem");
    expect(itens[0].textContent).toContain("Financiamento");
    expect(itens[0].textContent).toContain("Ganho");
    expect(itens[1].textContent).toContain("Promoção");
    expect(itens[1].textContent).toContain("Perda");
  });

  it("cada linha abre o parâmetro por dentro", () => {
    const abertos: string[] = [];
    montar({ onAbrir: (key) => abertos.push(key) });
    fireEvent.click(screen.getAllByRole("button")[3]);
    expect(abertos).toEqual(["financiamento"]);
  });

  it("sem painel a abrir, a linha não finge ser clicável", () => {
    montar({ onAbrir: null });
    // Sobram os três botões do filtro — nenhuma linha vira botão.
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("não oferece um recorte que resultaria em lista vazia", () => {
    montar({ linhas: [mudanca()] });
    const perdas = screen.getByRole("button", { name: "Perdas" }) as HTMLButtonElement;
    expect(perdas.disabled).toBe(true);
  });

  it("sem valor apurado, diz que não há o que ranquear", () => {
    montar({ linhas: [] });
    expect(screen.getByText(/não há o que ranquear/)).toBeTruthy();
  });
});

describe("onde agir agora", () => {
  it("mostra o que o dado sustenta, com o destino de cada item", () => {
    render(
      <OndeAgirAgora
        acoes={[
          {
            chave: "sem-preco",
            tom: "atencao",
            titulo: "95 alterações sem preço apurado",
            detalhe: "Podem alterar o resultado final.",
            href: "/alteracoes?impactConfidence=NOT_CALCULABLE",
          },
        ]}
      />,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toContain("NOT_CALCULABLE");
  });

  it("nada a fazer não vira um cartão de parabéns vazio", () => {
    render(<OndeAgirAgora acoes={[]} />);
    expect(screen.getByText(/Nada nesta vigência exige ação/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("a evolução por vigência", () => {
  const ponto = (periodo: string, liquido: number): PontoDeImpacto => ({
    periodo,
    label: periodo,
    ganhos: liquido > 0 ? liquido : 0,
    perdas: liquido < 0 ? liquido : 0,
    liquido,
  });

  const montar = (pontos: PontoDeImpacto[], carregando = false) =>
    render(
      <EvolucaoPorVigencia
        pontos={pontos}
        periodicity="MENSAL"
        janela={JANELA_PADRAO}
        onJanela={() => {}}
        vigenciaAberta="2026-08-01"
        onEscolherVigencia={() => {}}
        carregando={carregando}
      />,
    );

  it("esperar não é dizer que não houve nada", () => {
    montar([], true);
    expect(screen.getByText("Carregando a série…")).toBeTruthy();
    expect(screen.queryByText(/Nenhuma vigência com valor apurado/)).toBeNull();
  });

  it("com uma vigência só, não desenha uma tendência que não existe", () => {
    montar([ponto("2026-08-01", 21931)]);
    expect(screen.getByText(/não há evolução a desenhar/)).toBeTruthy();
    expect(screen.queryByText("Melhor vigência")).toBeNull();
  });

  it("com histórico, nomeia a melhor e a pior do intervalo desenhado", () => {
    montar([ponto("2026-07-01", -61243), ponto("2026-08-01", 21931)]);
    expect(screen.getByText("Melhor vigência")).toBeTruthy();
    expect(screen.getByText("Pior vigência")).toBeTruthy();
    expect(screen.getByText("−R$ 61.243")).toBeTruthy();
  });
});

/**
 * O que a tela pede ao servidor — e o que ela se recusa a repassar.
 *
 * O Impacto Apurado não tem endpoint próprio: lê `GET /changes/families`, o
 * mesmo do Impacto Líquido, com o recorte da URL e o carimbo da operação que
 * `lib/api.ts` põe em toda chamada. As duas garantias abaixo são as que
 * sustentam o isolamento do lado do cliente — a prova de que o servidor honra o
 * parâmetro está em `isolamento-por-operacao.test.ts`, do outro lado.
 */
describe("a chamada da tela", () => {
  it("leva unidade, canal e vigência, com a operação do ambiente aberto", () => {
    const consulta = consultaDoRecorte("?period=2026-08-01&scopeHash=hash-pe&canal=EMPURRADA");
    const url = comOperacao(
      `/changes/families${sufixoDaConsulta(consulta)}`,
      "/auditoria-rota/impacto-apurado",
    );
    expect(url).toBe(
      "/changes/families?period=2026-08-01&scopeHash=hash-pe&canal=EMPURRADA&operacao=ROTA",
    );
  });

  it("não deixa a URL da tela ampliar o acervo que a chamada alcança", () => {
    const consulta = consultaDoRecorte("?operacao=APOIO&scopeHash=hash-pe");
    const url = comOperacao(
      `/changes/families${sufixoDaConsulta(consulta)}`,
      "/impacto-apurado",
    );
    expect(url).toBe("/changes/families?scopeHash=hash-pe&operacao=EMPURRADA");
  });
});
