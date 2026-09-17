// @vitest-environment jsdom
//
// A FONTE REAL, DE PONTA A PONTA — do pedido à célula desenhada.
//
// Este é o teste de integração da fonte Real: monta o painel de verdade, com
// React Query de verdade, e a única coisa substituída é o transporte
// (`fetchJson`). O que ele prova não é layout — é que a tela **pergunta à fonte
// certa** e **escreve o que a fonte respondeu**, inclusive quando a resposta é
// "não existe".
//
// As três afirmações que custam caro se forem falsas:
//
// 1. a fonte Real nunca pede `/finame/comparacao` — se pedisse, a tela estaria
//    lendo duas vigências remuneradas sob o rótulo Real;
// 2. ausência não vira R$ 0,00 em lugar nenhum — nem no cartão, nem na célula;
// 3. não há "De", "Para" nem "Inverter": a direção do confronto é fixa.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfrontoDeFiname } from "../confronto";

/*
  Os três escopos da tela, nomeados.

  A tela deixou de ser "cartões + tabela": ela tem agora a fileira de
  indicadores, os três blocos de universo, o painel dos financiados, os alertas
  e a tabela — e vários números aparecem de propósito em mais de um deles. Uma
  busca global por "R$ 2.200,00" passou a achar dois elementos, o que **é o
  comportamento certo** e quebrava a asserção. Escopar é o que mantém cada teste
  falando do lugar de que ele fala.
*/
const naTabela = () => within(document.querySelector("table")!);
const nosIndicadores = () =>
  within(document.querySelector('[aria-label="Indicadores do confronto"]')!);
const nosUniversos = () =>
  within(document.querySelector('[aria-label="Os três universos da competência"]')!);

const linhaDa = (placa: string): HTMLElement =>
  naTabela().getByText(placa).closest("tr")!;

const pedidos: string[] = [];
const respostas = new Map<string, unknown>();

vi.mock("@/lib/api", () => ({
  fetchJson: (url: string) => {
    pedidos.push(url);
    const rota = url.split("?")[0];
    if (!respostas.has(rota)) return Promise.reject(new Error(`sem resposta para ${rota}`));
    return Promise.resolve(respostas.get(rota));
  },
  salvarArquivo: () => {},
}));

const COMPETENCIAS = {
  competencias: [
    {
      competencia: "2026-08",
      rotulo: "agosto/2026",
      vigencias: [
        { id: "v1", effectiveDate: "2026-08-01", sourceLabel: "EMPURRADA_1_8_2026" },
        { id: "v2", effectiveDate: "2026-08-16", sourceLabel: "EMPURRADA_2_8_2026" },
      ],
      temRealizado: true,
    },
    {
      competencia: "2026-09",
      rotulo: "setembro/2026",
      vigencias: [{ id: "v3", effectiveDate: "2026-09-01", sourceLabel: "EMPURRADA_1_9_2026" }],
      temRealizado: true,
    },
  ],
  realizado: { disponivel: true, fonte: "teste" },
};

/**
 * Uma competência com os quatro casos que a tela precisa saber escrever:
 * sobra, déficit, um lado ausente e uma placa não conciliada.
 */
const CONFRONTO = {
  competencia: "2026-09",
  rotulo: "setembro/2026",
  remunerado: {
    veiculos: 4,
    consolidados: 3,
    divergencias: 1,
    coberturaParcial: 0,
    semValor: 0,
    semPlaca: 0,
    vigencias: [{ id: "v3", effectiveDate: "2026-09-01", sourceLabel: "EMPURRADA_1_9_2026" }],
  },
  realizado: { disponivel: true, fonte: "teste" },
  confronto: {
    competencia: "2026-09",
    linhas: [
      {
        competencia: "2026-09",
        entityLabel: "SOBRA001",
        entityType: "CAVALO",
        remunerado: 5000,
        realizado: 4000,
        diferenca: 1000,
        variacao: 0.25,
        resultado: "SOBRA",
        cobertura: "COMPLETA",
        motivo: null,
        situacaoDoRemunerado: "CONSOLIDADO",
        situacaoDoFinanciamento: "FINANCIADO",
        statusDeclarado: "Descrição: FINANCIADO",
      },
      {
        competencia: "2026-09",
        entityLabel: "DEFIC002",
        entityType: "CAVALO",
        remunerado: 3000,
        realizado: 3500,
        diferenca: -500,
        variacao: -0.142857,
        resultado: "DEFICIT",
        cobertura: "COMPLETA",
        motivo: null,
        situacaoDoRemunerado: "CONSOLIDADO",
        situacaoDoFinanciamento: "FINANCIADO",
        statusDeclarado: "Descrição: FINANCIADO",
      },
      {
        competencia: "2026-09",
        entityLabel: "SEMREAL3",
        entityType: "CARRETA",
        remunerado: 2200,
        realizado: null,
        diferenca: null,
        variacao: null,
        resultado: "NAO_CALCULAVEL",
        cobertura: "SEM_REALIZADO",
        motivo: null,
        situacaoDoRemunerado: "CONSOLIDADO",
        situacaoDoFinanciamento: "FINANCIADO",
        statusDeclarado: "Descrição: FINANCIADO",
      },
      {
        competencia: "2026-09",
        entityLabel: "DIVERG04",
        entityType: "CAVALO",
        remunerado: null,
        realizado: null,
        diferenca: null,
        variacao: null,
        resultado: "NAO_CALCULAVEL",
        cobertura: "NAO_CONCILIADO",
        motivo: "As vigências deste mês declaram parcelas diferentes para esta placa.",
        situacaoDoRemunerado: "DIVERGENCIA_INTRAMENSAL",
        situacaoDoFinanciamento: "INDEFINIDO",
        statusDeclarado: null,
      },
    ],
    resumo: {
      competencia: "2026-09",
      veiculosConciliados: 2,
      veiculosRemunerados: 4,
      totalRemunerado: 8000,
      totalRealizado: 7500,
      saldoDosConciliados: 500,
      veiculosComSobra: 1,
      veiculosComDeficit: 1,
      veiculosEmEquilibrio: 0,
      cobertura: {
        total: 4,
        conciliados: 2,
        semRealizado: 1,
        semRemunerado: 0,
        naoConciliados: 1,
        fracaoDosRemunerados: 0.5,
      },
      semRealizado: {
        veiculos: 1,
        remunerado: 2200,
        financiados: 1,
        remuneradoFinanciado: 2200,
        quitados: 0,
        indefinidos: 0,
      },
      foraDoConfronto: {
        remuneradoSemRealizado: 2200,
        realizadoSemRemunerado: 0,
        veiculos: 2,
      },
    },
  },
  universos: {
    conciliados: { veiculos: 2, de: 4, remunerado: 8000, realizado: 7500, saldo: 500 },
    semRealizado: {
      veiculos: 1,
      remunerado: 2200,
      financiados: 1,
      remuneradoFinanciado: 2200,
      quitados: 0,
      indefinidos: 0,
    },
    pendenteDeClassificacao: {
      naCompetencia: { placas: 2, valor: 3300 },
      noExtrato: { placas: 8, valor: 174826.25 },
    },
  },
  alertas: [
    {
      tipo: "SOBRA_COM_DUPLICATA_RETIDA",
      competencia: "2026-09",
      entityLabel: "SOBRA001",
      entityType: "CAVALO",
      titulo: "Sobra confirmada, com percentual influenciado por duplicata retida",
      porque: "Esta placa tem lançamento retido como duplicata provável nesta competência.",
      evidencia: [
        { rotulo: "Realizado usado (uma cópia)", valor: "R$ 4.000,00" },
        { rotulo: "Realizado se forem dois pagamentos", valor: "R$ 8.000,00" },
      ],
    },
  ],
};

const SEM_FONTE = {
  competencia: "2026-09",
  rotulo: "setembro/2026",
  remunerado: {
    veiculos: 104,
    consolidados: 98,
    divergencias: 4,
    coberturaParcial: 2,
    semValor: 0,
    semPlaca: 0,
    vigencias: [{ id: "v3", effectiveDate: "2026-09-01", sourceLabel: "EMPURRADA_1_9_2026" }],
  },
  realizado: {
    disponivel: false,
    fonte: "sem-fonte",
    motivo: "SEM_FONTE",
    frase: "Não há fonte de FINAME realizado conectada a esta instalação.",
    oQueFalta: "Uma origem com custo de FINAME por placa e competência mensal.",
  },
  confronto: null,
};

function montar(competencia = "2026-09") {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={cliente}>
      {/* O provedor está aqui porque está em `App.tsx`: o ⓘ de cada cartão é um
          tooltip do Radix, e sem ele a árvore montada não seria a do produto. */}
      <TooltipProvider>
      <ConfrontoDeFiname
        consulta={new URLSearchParams("scopeHash=CAMACARI")}
        tipo="TODOS"
        competencia={competencia}
        onCompetencia={() => {}}
        onCompetenciasCarregadas={() => {}}
      />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  pedidos.length = 0;
  respostas.clear();
  respostas.set("/finame/competencias", COMPETENCIAS);
});

afterEach(cleanup);

describe("a fonte Real em tela", () => {
  beforeEach(() => respostas.set("/finame/confronto", CONFRONTO));

  it("pergunta à fonte Real, e nunca à comparação entre vigências", async () => {
    montar();
    await screen.findByText(/Remunerado × Realizado por veículo/);

    expect(pedidos.some((p) => p.startsWith("/finame/competencias"))).toBe(true);
    expect(pedidos.some((p) => p.startsWith("/finame/confronto"))).toBe(true);
    /* A contaminação que este teste existe para impedir. */
    expect(pedidos.some((p) => p.startsWith("/finame/comparacao"))).toBe(false);
    expect(pedidos.some((p) => p.startsWith("/finame/totais"))).toBe(false);
    /* E toda pergunta declara a fonte — o servidor não adivinha. */
    expect(pedidos.every((p) => p.includes("fonte=real"))).toBe(true);
  });

  it("os cartões são os do confronto, e não os estados de mudança", async () => {
    montar();
    await screen.findByText("Veículos conciliados");

    expect(screen.getByText("Remunerado na competência")).toBeTruthy();
    expect(screen.getByText("Realizado na competência")).toBeTruthy();
    expect(screen.getByText("Sobra de remuneração")).toBeTruthy();
    expect(screen.getByText("Déficit de remuneração")).toBeTruthy();
    expect(screen.getByText("Saldo dos veículos conciliados")).toBeTruthy();
    /* O nome antigo prometia um total do mês que o número nunca foi. */
    expect(screen.queryByText("Resultado líquido")).toBeNull();

    expect(screen.queryByText("Sem alteração")).toBeNull();
    expect(screen.queryByText("Novos na vigência")).toBeNull();
    expect(screen.queryByText("Ausentes na comparada")).toBeNull();
  });

  it("não há De, Para nem Inverter — a direção do confronto é fixa", async () => {
    montar();
    await screen.findByText(/Competência analisada/i);

    expect(screen.queryByText(/^Inverter$/)).toBeNull();
    expect(screen.queryByText(/^DE$/)).toBeNull();
    expect(screen.queryByText(/^PARA$/)).toBeNull();
  });

  it("o eixo do tempo é mensal — nenhuma quinzena aparece", async () => {
    montar();
    await screen.findByText(/Competência analisada/i);

    expect(document.body.textContent).not.toMatch(/quinzena/i);
    expect(screen.getAllByText(/setembro\/2026/).length).toBeGreaterThan(0);
  });

  it("escreve os dois lados do mês, para conferir o intervalo econômico", async () => {
    montar();
    await screen.findByText("Remunerado:");
    expect(screen.getByText("Realizado:")).toBeTruthy();
    expect(screen.getByText(/competência mensal/)).toBeTruthy();
  });

  it("a diferença é remunerado − realizado, escrita linha a linha", async () => {
    montar();
    /* `findAll`: a placa aparece na tabela **e** no painel de alertas, de
       propósito. O escopo de cada asserção é `linhaDa`, logo abaixo. */
    await screen.findAllByText("SOBRA001");

    const linha = linhaDa("SOBRA001");
    expect(linha.textContent).toContain("1.000,00");
    /* `formatNumber(_, 1)` não enche casa decimal à toa: 25 sai "25", e
       14,2857… sai "14,3". O sinal do positivo é explícito porque numa coluna
       com negativos um número sem sinal se lê como negativo por contágio. */
    expect(linha.textContent).toContain("+25%");
    expect(linha.textContent).toContain("Sobra");

    const deficit = linhaDa("DEFIC002");
    /* O menos é o tipográfico (−), como no resto do produto: o hífen some ao
       lado do cifrão em corpo grande, e uma perda lida como ganho é o erro mais
       caro que uma formatação pode produzir. Ver `formatBrl`. */
    expect(deficit.textContent).toContain("−R$ 500,00");
    expect(deficit.textContent).toContain("Déficit");
  });

  /*
    A regra mais importante desta tela, e a mais fácil de quebrar sem perceber:
    uma célula sem valor não pode desenhar zero. Zero é uma afirmação sobre
    dinheiro; o traço é a ausência dela.
  */
  it("ausência vira traço, nunca R$ 0,00", async () => {
    montar();
    /* `findAll`: a placa aparece na tabela **e** no painel dos financiados sem
       lançamento real — que é justamente o ponto do painel. */
    await screen.findAllByText("SEMREAL3");

    const semRealizado = linhaDa("SEMREAL3");
    expect(semRealizado.textContent).toContain("—");
    expect(semRealizado.textContent).not.toContain("R$ 0,00");
    expect(semRealizado.textContent).toContain("Sem realizado");

    const naoConciliada = linhaDa("DIVERG04");
    expect(naoConciliada.textContent).not.toContain("R$ 0,00");
    expect(naoConciliada.textContent).toContain("Não conciliado");
  });

  it("a placa não conciliada explica por que não conciliou", async () => {
    montar();
    await screen.findByText("DIVERG04");
    const celula = naTabela().getByText(/Não conciliado/);
    expect(celula.getAttribute("title")).toContain("parcelas diferentes");
  });

  it("o que ficou de fora além dos três universos continua dito numa frase", async () => {
    montar();
    await screen.findByText(/1 placa sem realizado correspondente/);
    /* O que ficou fora dos totais é dito, para a soma na mão bater. */
    expect(screen.getByText(/fora do confronto:/)).toBeTruthy();
  });

  it("o saldo é a diferença dos dois totais publicados ao lado", async () => {
    montar();
    await screen.findByText("Saldo dos veículos conciliados");
    /* 8.000 − 7.500 = 500, e os três números estão na mesma fileira. */
    expect(nosIndicadores().getByText("R$ 8.000,00")).toBeTruthy();
    expect(nosIndicadores().getByText("R$ 7.500,00")).toBeTruthy();
    expect(nosIndicadores().getByText("R$ 500,00")).toBeTruthy();
  });
});

/**
 * A LEITURA EXECUTIVA — o que impede o saldo de 2 veículos de ser lido como o
 * saldo de 4.
 *
 * Estes testes não olham aritmética; ela já está provada em
 * `lib/comparison/src/__tests__/universos-do-confronto.test.ts`. O que eles
 * olham é a **frase que a tela produz na cabeça de quem lê** — que foi o único
 * defeito que setembro/2026 teve.
 */
describe("a tela não apresenta o saldo conciliado como saldo do mês", () => {
  beforeEach(() => respostas.set("/finame/confronto", CONFRONTO));

  it("a cobertura acompanha o saldo na própria fileira de cartões", async () => {
    montar();
    await screen.findByText("Saldo dos veículos conciliados");
    /* "2 de 4 veículos" ao lado do número, e não numa frase que some quando a
       cobertura está completa. */
    const cartoes = nosIndicadores().getAllByText(/2 de 4 veículos/);
    expect(cartoes.length).toBeGreaterThan(0);
  });

  it("desenha os três universos como blocos separados, e diz que não se somam", async () => {
    montar();
    await screen.findByText(/três universos que não se somam/);
    expect(screen.getByText("1 · Conciliados")).toBeTruthy();
    expect(screen.getByText("2 · Sem realizado")).toBeTruthy();
    expect(screen.getByText("3 · Real pendente de classificação")).toBeTruthy();
  });

  it("o universo 2 publica a remuneração sem contrapartida, à parte dos totais", async () => {
    montar();
    await screen.findByText("2 · Sem realizado");
    expect(nosUniversos().getByText("Remuneração sem contrapartida")).toBeTruthy();
    expect(nosUniversos().getByText("R$ 2.200,00")).toBeTruthy();
    /* E o total dos conciliados continua sendo 8.000 — o universo 2 não entrou
       nele nem apareceu somado a ele em lugar nenhum, na tela inteira. */
    expect(screen.queryByText("R$ 10.200,00")).toBeNull();
  });

  it("o universo 3 separa o mês analisado da fila do extrato inteiro", async () => {
    montar();
    await screen.findByText("3 · Real pendente de classificação");
    expect(nosUniversos().getByText("Nesta competência")).toBeTruthy();
    expect(nosUniversos().getByText("R$ 3.300,00")).toBeTruthy();
    /* O número grande do extrato existe, e vem rotulado como o que é. */
    expect(nosUniversos().getByText("Na fila do extrato inteiro")).toBeTruthy();
    expect(nosUniversos().getByText(/174\.826,25/)).toBeTruthy();
  });

  it("os financiados sem lançamento real têm painel próprio, fora da tabela", async () => {
    montar();
    const painel = await screen.findByTestId("financiados-sem-realizado");
    /* A placa aparece no painel — e não só na página 1 de uma tabela de 50. */
    expect(painel.textContent).toContain("SEMREAL3");
    expect(painel.textContent).toContain("R$ 2.200,00");
    expect(painel.textContent).toContain("declarado financiado sem lançamento real");
  });

  it("escreve os alertas com a evidência que os sustenta", async () => {
    montar();
    const alertas = await screen.findByTestId("alertas-do-confronto");
    expect(alertas.textContent).toContain("SOBRA001");
    expect(alertas.textContent).toContain("percentual influenciado por duplicata retida");
    /* A evidência, e não só a frase: é o que permite conferir sem reabrir nada. */
    expect(alertas.textContent).toContain("Realizado usado (uma cópia)");
    expect(alertas.textContent).toContain("R$ 8.000,00");
  });
});

describe("a fonte Real sem fonte do realizado", () => {
  beforeEach(() => respostas.set("/finame/confronto", SEM_FONTE));

  it("diz que não há fonte, em vez de desenhar zeros", async () => {
    montar();
    await screen.findByText("Fonte sem dados");

    expect(screen.getByText(/Não há fonte de FINAME realizado/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("R$ 0,00");
    /* E nenhum cartão de total é desenhado: não há total a mostrar. */
    expect(screen.queryByText("Resultado líquido")).toBeNull();
  });

  it("diz o que falta, e que o lado remunerado está lido", async () => {
    montar();
    await screen.findByText("Fonte sem dados");
    expect(screen.getByText(/Uma origem com custo de FINAME por placa/)).toBeTruthy();
    expect(screen.getByText(/98 de 104 veículos com parcela mensal única/)).toBeTruthy();
  });
});

describe("a fonte Real sem competência nenhuma", () => {
  it("não inventa um mês", async () => {
    respostas.set("/finame/competencias", {
      competencias: [],
      realizado: { disponivel: false, fonte: "sem-fonte", motivo: "SEM_FONTE", frase: "x" },
    });
    montar();
    await waitFor(() =>
      expect(screen.getByText("Nenhuma competência para analisar")).toBeTruthy(),
    );
    expect(pedidos.some((p) => p.startsWith("/finame/confronto"))).toBe(false);
  });
});
