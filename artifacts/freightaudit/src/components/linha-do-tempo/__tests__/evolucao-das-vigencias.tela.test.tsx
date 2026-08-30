// @vitest-environment jsdom
//
// Precisa de DOM porque o que se prova aqui é interação: quantas colunas a
// janela escolhida desenha, e o que o clique no marco e no ponto do acumulado
// fazem. Nenhuma das duas é lida sem montar a seção.
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvolucaoDasVigencias } from "../linha-do-tempo-de-impacto";
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
