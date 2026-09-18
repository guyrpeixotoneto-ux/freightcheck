// @vitest-environment jsdom
//
// A JANELA ABRE A GAVETA — e só onde há gaveta a abrir.
//
// O cartão "O que puxou a janela" nasceu de leitura: nomeava os parâmetros que
// puxaram o intervalo do gráfico e parava aí, enquanto o ranking ao lado, sobre
// a mesma gramática de linha, abria a gaveta do parâmetro. Duas listas do mesmo
// grão com regras de clique diferentes é a pergunta mais óbvia da tela morrendo
// numa delas.
//
// O que estes casos guardam é o **limite** do clique. A janela cobre várias
// vigências e a gaveta explica uma: o parâmetro que pesou em maio e não se
// mexeu na competência aberta não tem a quem perguntar, e um botão que escreve
// `?impacto=` no endereço sem abrir nada seria pior do que linha que não clica.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OQuePuxou } from "../o-que-puxou";
import type { JanelaDoImpacto } from "@/lib/panorama";

afterEach(cleanup);

const JANELA: JanelaDoImpacto = {
  rotulo: "maio/2026 · 2ªq → setembro/2026 · 1ªq",
  vigencias: 6,
  periodicity: "MENSAL",
  linhas: [
    {
      chave: "financiamento",
      nome: "Financiamento",
      contexto: "Aquisição e financiamento · em 2 de 6 vigências · 38 alterações",
      periodos: 2,
      classificacao: "ganho",
      valor: 37956,
      liquido: null,
      proporcao: 1,
    },
    {
      chave: "depreciacao",
      nome: "Depreciação",
      contexto: "Aquisição e financiamento · em 2 de 6 vigências · 5 alterações",
      periodos: 2,
      classificacao: "perda",
      valor: -35002,
      liquido: null,
      proporcao: 0.92,
    },
  ],
};

const linha = (nome: string) =>
  screen.getAllByRole("listitem").find((li) => li.textContent?.includes(nome))!;

describe("o cartão da janela", () => {
  it("abre a gaveta do parâmetro que a competência aberta tem", () => {
    const onAbrir = vi.fn();
    render(
      <OQuePuxou
        janela={JANELA}
        carregando={false}
        chaveAberta={null}
        abriveis={new Set(["financiamento", "depreciacao"])}
        onAbrir={onAbrir}
      />,
    );

    fireEvent.click(screen.getByTitle("De onde vem o impacto de Financiamento"));
    expect(onAbrir).toHaveBeenCalledWith("financiamento");
  });

  /*
    Sem botão, e não com botão inerte: um `disabled` ainda pararia o foco de
    quem navega por teclado em algo que nunca vai responder. A linha continua
    inteira — número, barra e contexto —, porque a leitura da janela é dela e
    não depende da gaveta.
  */
  it("não clica no parâmetro que não se mexeu na competência aberta", () => {
    render(
      <OQuePuxou
        janela={JANELA}
        carregando={false}
        chaveAberta={null}
        abriveis={new Set(["financiamento"])}
        onAbrir={() => {}}
      />,
    );

    expect(linha("Depreciação").querySelector("button")).toBeNull();
    expect(linha("Depreciação").textContent).toContain("em 2 de 6 vigências");
    expect(linha("Financiamento").querySelector("button")).toBeTruthy();
  });

  /* Sem destino nenhum — a Visão Geral, onde o intervalo soma unidade a unidade
     e não há recorte a quem perguntar de onde vem o número. */
  it("sem destino, nenhuma linha vira botão", () => {
    render(
      <OQuePuxou
        janela={JANELA}
        carregando={false}
        chaveAberta={null}
        abriveis={new Set(["financiamento"])}
        onAbrir={null}
      />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  /* A linha fica marcada atrás da gaveta dela — é o que diz, quando a gaveta
     fecha, de onde ela veio. */
  it("marca a linha cuja gaveta está aberta", () => {
    render(
      <OQuePuxou
        janela={JANELA}
        carregando={false}
        chaveAberta="depreciacao"
        abriveis={new Set(["financiamento", "depreciacao"])}
        onAbrir={() => {}}
      />,
    );

    expect(linha("Depreciação").querySelector("button")!.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(linha("Financiamento").querySelector("button")!.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });
});
