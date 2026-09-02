// @vitest-environment jsdom
//
// Precisa de DOM porque o que se prova aqui é interação: quantas colunas a
// janela escolhida desenha, e o que o clique no marco e no ponto do acumulado
// fazem. Nenhuma das duas é lida sem montar a seção.
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CartoesDeResumo, EvolucaoDasVigencias } from "../linha-do-tempo-de-impacto";
import type { RangeMovement, ResumoDoIntervalo } from "@/lib/analise";

const PERIODICIDADE = "MENSAL";

/** Uma vigência do histórico, com o impacto já apurado na periodicidade aberta. */
function vigencia(period: string, impacto: number): RangeMovement {
  return {
    period,
    label: period,
    comparisons: 1,
    changes: 10,
    vehicles: 0,
    impact: { byPeriodicity: { [PERIODICIDADE]: impacto }, notCalculable: 0 },
  };
}

/** Oito meses seguidos — mais do que a menor janela mostra, e mais do que a padrão. */
const LINHAS = [
  vigencia("2026-01-01", -100),
  vigencia("2026-02-01", -200),
  vigencia("2026-03-01", 300),
  vigencia("2026-04-01", -400),
  vigencia("2026-05-01", 500),
  vigencia("2026-06-01", -600),
  vigencia("2026-07-01", -700),
  vigencia("2026-08-01", 800),
];

const RESUMO: ResumoDoIntervalo = {
  fromLabel: "2026-01-01",
  toLabel: "2026-08-01",
  impact: { byPeriodicity: { [PERIODICIDADE]: -400 }, notCalculable: 0 },
  gainsByPeriodicity: { [PERIODICIDADE]: 1600 },
  lossesByPeriodicity: { [PERIODICIDADE]: -2000 },
  totals: { changes: 80, vehiclesTouched: 0 },
  gaps: [],
};

function montar(onAbrirVigencia?: (linha: RangeMovement) => void) {
  return render(
    <EvolucaoDasVigencias
      dados={RESUMO}
      linhas={LINHAS}
      periodicidades={[PERIODICIDADE]}
      periodicidade={PERIODICIDADE}
      onPeriodicidade={() => {}}
      recorteBase={null}
      onAbrirVigencia={onAbrirVigencia}
      rotuloDeAbrir="Abrir esta vigência"
    />,
  );
}

/** Os marcos desenhados — um por vigência visível, na ordem do tempo. */
const marcos = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-testid^='marco-']"));

const vigenciasVisiveis = () =>
  marcos().map((marco) => marco.getAttribute("data-testid")?.replace("marco-", ""));

const clicar = (nome: string | RegExp) => fireEvent.click(screen.getByRole("button", { name: nome }));

afterEach(cleanup);

describe("a janela da evolução das vigências", () => {
  it("abre nas 6 últimas vigências — a ponta recente, cheia", () => {
    montar(() => {});
    expect(vigenciasVisiveis()).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
  });

  it("o seletor troca o tamanho da janela sem sair da ponta recente", () => {
    montar(() => {});
    clicar("3");

    expect(vigenciasVisiveis()).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
  });

  it("contar em meses recorta o calendário, e não as entregas", () => {
    montar(() => {});
    clicar("3");
    clicar("meses");

    // Junho, julho e agosto — três meses de calendário a partir da última.
    expect(vigenciasVisiveis()).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
  });

  it("o paginador anda para trás dentro do tamanho escolhido", () => {
    montar(() => {});
    clicar("3");
    clicar("Vigências anteriores");

    expect(vigenciasVisiveis()).toEqual(["2026-03-01", "2026-04-01", "2026-05-01"]);
  });
});

/**
 * O mês crítico é o **maior** movimento do intervalo, de qualquer lado. Com
 * "crítico" ocupando o lugar de "ganho" e "perda" no mesmo valor, a vigência
 * que mais somou saía com o número em verde e o selo escrito "Perda" —
 * a ênfase do tamanho apagando o lado.
 */
describe("o selo de cada vigência", () => {
  it("segue o sinal do número, inclusive no mês crítico", () => {
    montar(() => {});

    // A janela padrão mostra 300, −400, 500, −600, −700 e 800 — três de cada
    // lado, e o crítico (agosto, +800) é um dos ganhos.
    expect(screen.getAllByText("Ganho")).toHaveLength(3);
    expect(screen.getAllByText("Perda")).toHaveLength(3);
    expect(screen.getByText("Mês crítico")).toBeTruthy();
  });
});

/**
 * Os cartões do topo somam o intervalo inteiro, e o Panorama executivo publica
 * a vigência aberta sozinha sob o mesmo rótulo — "Impacto líquido". Sem esta
 * linha, as duas telas mostram números diferentes para o que parece ser a
 * mesma pergunta, e é o mesmo desencontro que o clique numa vigência da linha
 * do tempo produz: o nó traz uma comparação, o cartão traz todas.
 */
describe("o placar do intervalo", () => {
  it("escreve de que recorte os números são", () => {
    render(
      <CartoesDeResumo
        dados={RESUMO}
        periodicidade={PERIODICIDADE}
        comparacoes={LINHAS.length}
      />,
    );

    const escopo = screen.getByText(/somam o intervalo inteiro/);
    expect(escopo.textContent).toContain("2026-01-01");
    expect(escopo.textContent).toContain("2026-08-01");
    expect(escopo.textContent).toContain("8 comparações");
  });

  it("sem comparação nenhuma, não promete um intervalo que não leu", () => {
    render(<CartoesDeResumo dados={RESUMO} periodicidade={PERIODICIDADE} comparacoes={0} />);

    expect(screen.queryByText(/somam o intervalo inteiro/)).toBeNull();
  });
});

describe("o clique numa vigência", () => {
  it("no marco, abre a vigência apontada", () => {
    const abrir = vi.fn();
    montar(abrir);
    fireEvent.click(screen.getByTestId("marco-2026-07-01"));

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir.mock.calls[0][0].period).toBe("2026-07-01");
  });

  it("no ponto do acumulado, abre a mesma vigência que o marco", () => {
    const abrir = vi.fn();
    montar(abrir);
    const grafico = screen.getByRole("group", { name: /Impacto líquido acumulado/ });
    fireEvent.click(
      within(grafico).getByRole("button", { name: "Abrir esta vigência — 2026-07-01" }),
    );

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir.mock.calls[0][0].period).toBe("2026-07-01");
  });

  it("o ponto do acumulado também responde ao teclado", () => {
    const abrir = vi.fn();
    montar(abrir);
    const grafico = screen.getByRole("group", { name: /Impacto líquido acumulado/ });
    fireEvent.keyDown(
      within(grafico).getByRole("button", { name: "Abrir esta vigência — 2026-08-01" }),
      { key: "Enter" },
    );

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir.mock.calls[0][0].period).toBe("2026-08-01");
  });

  it("sem destino nenhum, o marco não finge ser botão", () => {
    montar(undefined);

    expect(marcos()).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: /^Abrir esta vigência — / })).toHaveLength(0);
    expect(screen.getByRole("img", { name: /Impacto líquido acumulado/ })).toBeTruthy();
  });
});

/**
 * No celular a mesma janela não cabe deitada — cinco colunas de ~7rem viram
 * rolagem horizontal dentro de um cartão que já rola na vertical. A seção
 * vira lista: uma vigência por linha, com o mesmo destino no clique.
 */
describe("a leitura de celular", () => {
  const larguraOriginal = window.innerWidth;

  const estreitar = (largura: number) => {
    Object.defineProperty(window, "innerWidth", {
      value: largura,
      configurable: true,
      writable: true,
    });
  };

  afterEach(() => estreitar(larguraOriginal));

  it("empilha uma vigência por linha, sem a linha do tempo deitada", () => {
    estreitar(390);
    montar(() => {});

    const linhas = screen.getAllByRole("listitem");
    expect(linhas).toHaveLength(6);
    expect(linhas.map((linha) => linha.textContent)).toEqual([
      expect.stringContaining("2026-03-01"),
      expect.stringContaining("2026-04-01"),
      expect.stringContaining("2026-05-01"),
      expect.stringContaining("2026-06-01"),
      expect.stringContaining("2026-07-01"),
      expect.stringContaining("2026-08-01"),
    ]);
    // Os marcos clicáveis são da versão deitada — no celular a linha é o alvo.
    expect(marcos()).toHaveLength(0);
  });

  it("o cartão da vigência crítica diz o lado dela junto do selo de crítico", () => {
    estreitar(390);
    montar(() => {});

    // A última da janela é agosto: +800, o maior movimento do intervalo.
    const critica = screen.getAllByRole("listitem").at(-1);
    expect(critica?.textContent).toContain("Mês crítico");
    expect(critica?.textContent).toContain("Ganho");
    expect(critica?.textContent).not.toContain("Perda");
  });

  it("o clique na linha abre a mesma vigência que o cartão da versão deitada", () => {
    estreitar(390);
    const abrir = vi.fn();
    montar(abrir);
    // Dentro da lista: o ponto do acumulado promete o mesmo destino com o
    // mesmo nome, e é ele que a versão deitada já cobre.
    const lista = screen.getByRole("list");
    fireEvent.click(
      within(lista).getByRole("button", { name: "Abrir esta vigência — 2026-07-01" }),
    );

    expect(abrir).toHaveBeenCalledTimes(1);
    expect(abrir.mock.calls[0][0].period).toBe("2026-07-01");
  });
});
