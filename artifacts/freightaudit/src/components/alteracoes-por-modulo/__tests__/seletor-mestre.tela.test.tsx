// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SeletorMestre } from "../seletor-mestre";
import type { SituacaoDaCobertura } from "@/lib/seletor-mestre";

/**
 * O que este teste prende.
 *
 * O par mestre é uma promessa sobre o que chega aos olhos, e ela quebra de três
 * maneiras que nenhum teste de função pura pega:
 *
 * 1. **Volta a haver vários seletores em tela.** O ganho inteiro da mudança é
 *    um par visível por vez; se a gaveta abrir sozinha, a tela é a de antes com
 *    uma caixa a mais em cima.
 * 2. **O alcance do gesto deixa de ser dito.** Um par aplicado a três de quatro
 *    coberturas, sem a frase, é uma caixa afirmando um par que um quarto dos
 *    cartões não usa — e a pessoa volta a deduzir isso comparando caixas, que é
 *    o defeito de origem.
 * 3. **A cobertura que divergiu não é nomeada com o par dela.** Saber que
 *    "3 de 4" seguiram, sem saber qual ficou para trás nem em quê, não é
 *    informação: é um aviso.
 *
 * As três se testam renderizando.
 */

afterEach(cleanup);

const ROTULOS = new Map([
  ["f2", "agosto/2026 · 2ª quinzena"],
  ["f3", "setembro/2026 · 1ª quinzena"],
  ["t1", "julho/2026 · 1ª quinzena"],
  ["t2", "setembro/2026 · 2ª quinzena"],
]);

const DATAS = ["2026-09-16", "2026-09-01", "2026-08-16", "2026-07-01"];

const ROTULO_DA_DATA: Record<string, string> = {
  "2026-09-16": "setembro/2026 · 2ª quinzena",
  "2026-09-01": "setembro/2026 · 1ª quinzena",
  "2026-08-16": "agosto/2026 · 2ª quinzena",
  "2026-07-01": "julho/2026 · 1ª quinzena",
};

const MESTRE = { de: "2026-08-16", para: "2026-09-01" };

const segue = (cobertura: SituacaoDaCobertura["cobertura"]): SituacaoDaCobertura => ({
  cobertura,
  estado: "SEGUE",
  par: { base: "f2", comparada: "f3" },
  motivo: null,
});

const TRECHO_PROPRIO: SituacaoDaCobertura = {
  cobertura: "TRECHO",
  estado: "PROPRIO",
  par: { base: "t1", comparada: "t2" },
  motivo: null,
};

const ADMINISTRATIVO_SEM_PAR: SituacaoDaCobertura = {
  cobertura: "QLP_ADMINISTRATIVO",
  estado: "SEM_PAR",
  par: { base: "", comparada: "" },
  motivo: { motivo: "UMA_SO" },
};

const montar = (situacoes: SituacaoDaCobertura[], extras: Partial<Parameters<typeof SeletorMestre>[0]> = {}) =>
  render(
    <SeletorMestre
      datas={DATAS}
      rotuloDaData={(data) => ROTULO_DA_DATA[data] ?? data}
      mestre={MESTRE}
      situacoes={situacoes}
      rotulos={ROTULOS}
      onDe={vi.fn()}
      onPara={vi.fn()}
      onInverter={vi.fn()}
      {...extras}
    >
      <div data-testid="seletores-por-cobertura">os quatro seletores</div>
    </SeletorMestre>,
  );

describe("um par visível por vez", () => {
  /* O requisito 1 — e o motivo de a mudança existir. */
  it("mostra dois campos e esconde os seletores por cobertura", () => {
    montar([segue("EQUIPAMENTO"), segue("TRECHO")]);

    expect(screen.getByLabelText(/vigência de origem, para todas/i).textContent).toContain(
      "agosto/2026 · 2ª quinzena",
    );
    expect(screen.getByLabelText(/vigência de destino, para todas/i).textContent).toContain(
      "setembro/2026 · 1ª quinzena",
    );
    expect(screen.queryByTestId("seletores-por-cobertura")).toBeNull();
  });

  it("abre a gaveta com os quatro seletores quando alguém pede", () => {
    montar([segue("EQUIPAMENTO"), segue("TRECHO")]);

    fireEvent.click(screen.getByRole("button", { name: /ajustar por cobertura/i }));
    expect(screen.getByTestId("seletores-por-cobertura")).toBeTruthy();
  });
});

describe("a quantas coberturas o gesto chegou", () => {
  /* O requisito 2, no caso feliz: uma frase, e nenhum aviso. */
  it("no singular, põe o nome dentro da frase em vez de depois do ponto", () => {
    montar([segue("EQUIPAMENTO"), ADMINISTRATIVO_SEM_PAR]);

    expect(screen.getByRole("status").textContent).toContain(
      "Equipamento é a única cobertura com par no acervo, e seguiu este par.",
    );
  });

  it("diz que todas seguiram, e nomeia quais", () => {
    montar([segue("EQUIPAMENTO"), segue("TRECHO"), segue("QLP_OPERACIONAL")]);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("As 3 coberturas seguiram este par.");
    expect(status.textContent).toContain("Equipamento · Trecho · QLP operacional");
  });

  /* O requisito 3 — a dissidente nomeada, com o par dela junto. */
  it("nomeia quem ficou no par próprio, e em qual par", () => {
    montar([segue("EQUIPAMENTO"), TRECHO_PROPRIO, segue("QLP_OPERACIONAL")]);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("2 de 3 coberturas seguiram este par.");
    expect(status.textContent).toContain("Trecho");
    expect(status.textContent).toContain("julho/2026 · 1ª quinzena → setembro/2026 · 2ª quinzena");
  });

  it("o atalho da dissidente abre a gaveta", () => {
    montar([segue("EQUIPAMENTO"), TRECHO_PROPRIO]);

    expect(screen.queryByTestId("seletores-por-cobertura")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ajustar" }));
    expect(screen.getByTestId("seletores-por-cobertura")).toBeTruthy();
  });

  it("diz quando nenhuma cobertura tem o par escolhido", () => {
    montar([TRECHO_PROPRIO]);

    expect(screen.getByRole("status").textContent).toContain("Nenhuma cobertura tem este par.");
  });

  /* A cobertura sem par não entra na conta: ela não "deixou de seguir" — não
     havia par nenhum ali para seguir, e a gaveta diz o motivo. */
  it("não conta a cobertura sem par entre as que não seguiram", () => {
    montar([segue("EQUIPAMENTO"), segue("TRECHO"), ADMINISTRATIVO_SEM_PAR]);

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("As 2 coberturas seguiram este par.");
    expect(status.textContent).not.toContain("de 3");
  });
});
