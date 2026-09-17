// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SeletorMestre } from "../seletor-mestre";
import type { CandidatosDoPar } from "@/lib/candidatos";
import type { SituacaoDaCobertura } from "@/lib/seletor-mestre";

/**
 * A COLUNA DE NÚMEROS DO SELETOR MESTRE — o que ela promete, e onde ela cala.
 *
 * O menu é por **data**, e não por vigência: uma quinzena aqui vale por até
 * quatro coberturas, e o número ao lado dela é o que as quatro produzem juntas.
 * Isso cria três promessas que nenhum teste de função pura pega, e são as três
 * que este arquivo prende:
 *
 * 1. **o dinheiro sai por régua, e não somado.** Custo fixo publica reais do
 *    período e custo variável publica razões; um `R$ 20.000,00/mês` que fosse a
 *    soma dos dois é o total geral que o domínio recusa por escrito
 *    (`alteracoes-por-modulo.ts`). Duas linhas, dois rótulos;
 * 2. **só o campo "De" escreve número.** No "Para" a pergunta não tem sujeito:
 *    cada linha ali mudaria a própria base da conta;
 * 3. **ausência de cálculo nunca vira zero.** A data que o servidor ainda não
 *    calculou mostra esqueleto, e nunca `R$ 0,00` — que é a única mentira que
 *    uma tela de auditoria não pode contar.
 */

afterEach(cleanup);

const DATAS = ["2026-09-01", "2026-08-16", "2026-08-01"];

const ROTULO_DA_DATA: Record<string, string> = {
  "2026-09-01": "setembro/2026 · 1ª quinzena",
  "2026-08-16": "agosto/2026 · 2ª quinzena",
  "2026-08-01": "agosto/2026 · 1ª quinzena",
};

const MESTRE = { de: "2026-08-16", para: "2026-09-01" };

const SEGUE: SituacaoDaCobertura = {
  cobertura: "EQUIPAMENTO",
  estado: "SEGUE",
  par: { base: "f1", comparada: "f2" },
  motivo: null,
};

const montar = (candidatos?: CandidatosDoPar, extras = {}) =>
  render(
    <SeletorMestre
      datas={DATAS}
      rotuloDaData={(data) => ROTULO_DA_DATA[data] ?? data}
      mestre={MESTRE}
      situacoes={[SEGUE]}
      rotulos={new Map()}
      onDe={vi.fn()}
      onPara={vi.fn()}
      onInverter={vi.fn()}
      candidatos={candidatos}
      {...extras}
    >
      <div>os quatro seletores</div>
    </SeletorMestre>,
  );

const abrir = (campo: "origem" | "destino") =>
  fireEvent.click(
    screen.getByLabelText(
      campo === "origem" ? /vigência de origem, para todas/i : /vigência de destino, para todas/i,
    ),
  );

const linhaDe = (rotulo: string) =>
  screen.getAllByRole("option").find((o) => o.textContent?.includes(rotulo))!;

describe("o que cada data produz, escrito ao lado dela", () => {
  /* O requisito 1: duas réguas, duas linhas, e nenhuma soma entre elas. */
  it("escreve uma linha de dinheiro por régua, com o nome da área", () => {
    montar({
      para: "2026-09-01",
      pendentes: 0,
      candidatos: [
        {
          id: "2026-08-16",
          numeros: {
            alteracoes: 357,
            impacto: {
              baldes: [
                { periodicidade: "MENSAL", valor: 11916.7, rotulo: "Custo Fixo" },
                { periodicidade: "MENSAL", valor: -240.5, rotulo: "Custo Variável" },
              ],
            },
          },
        },
      ],
    });
    abrir("origem");

    const linha = linhaDe("agosto/2026 · 2ª quinzena").textContent ?? "";
    expect(linha).toContain("Custo Fixo");
    expect(linha).toContain("+R$ 11.916,70/mês");
    expect(linha).toContain("Custo Variável");
    expect(linha).toContain("−R$ 240,50/mês");
    expect(linha).toContain("357 alterações");
    /* 11.916,70 − 240,50 = 11.676,20, e ele não existe em lugar nenhum. */
    expect(linha).not.toContain("11.676,20");
  });

  /* O requisito 2 — a assimetria que o seletor de par já tem um nível abaixo. */
  it("o campo Para não escreve número nenhum", () => {
    montar({
      para: "2026-09-01",
      pendentes: 0,
      candidatos: [
        {
          id: "2026-08-16",
          numeros: { alteracoes: 357, impacto: { baldes: [] } },
        },
      ],
    });
    abrir("destino");

    expect(linhaDe("agosto/2026 · 2ª quinzena").textContent).not.toContain("alterações");
  });

  /* O requisito 3, e a razão de `numeros: null` existir. */
  it("a data ainda não calculada mostra esqueleto, e nunca R$ 0,00", () => {
    montar({
      para: "2026-09-01",
      pendentes: 1,
      candidatos: [{ id: "2026-08-16", numeros: null }],
    });
    abrir("origem");

    const linha = linhaDe("agosto/2026 · 2ª quinzena");
    expect(linha.textContent).not.toContain("R$");
    expect(linha.textContent).not.toContain("alterações");
    expect(linha.querySelector('[class*="animate-pulse"]')).toBeTruthy();
  });

  /**
   * Calculada e sem movimento, a linha diz `R$ 0,00` — a conta que aconteceu e
   * deu zero, que é notícia, e não a mesma casa em branco da de cima.
   */
  it("o par sem movimento escreve o zero por extenso", () => {
    montar({
      para: "2026-09-01",
      pendentes: 0,
      candidatos: [{ id: "2026-08-16", numeros: { alteracoes: 0, impacto: { baldes: [] } } }],
    });
    abrir("origem");

    const linha = linhaDe("agosto/2026 · 2ª quinzena").textContent ?? "";
    expect(linha).toContain("R$ 0,00");
    expect(linha).toContain("0 alterações");
  });

  /**
   * O recorte que **não mede** dinheiro cala a coluna — um mestre que só forma
   * par nos dois quadros do QLP apura contagem e mais nada, e um `R$ 0,00` ali
   * afirmaria que o dinheiro não se moveu numa leitura que nunca olhou para ele.
   */
  it("sem régua de dinheiro nenhuma, escreve só a contagem", () => {
    montar({
      para: "2026-09-01",
      pendentes: 0,
      candidatos: [
        {
          id: "2026-08-16",
          numeros: {
            alteracoes: 12,
            impacto: { baldes: [] },
            semImpacto: "As colunas do quadro chegam sem semântica confirmada.",
          },
        },
      ],
    });
    abrir("origem");

    const linha = linhaDe("agosto/2026 · 2ª quinzena").textContent ?? "";
    expect(linha).not.toContain("R$");
    expect(linha).toContain("12 alterações");
  });

  /** A falha não tira o menu do ar: perde-se a coluna, não a escolha. */
  it("com a pergunta falhada, as datas continuam escolhíveis e a frase aparece", () => {
    montar(undefined, { erroDosCandidatos: "A comparação demorou mais do que o previsto." });
    abrir("origem");

    expect(screen.getAllByRole("option").length).toBe(DATAS.length);
    expect(
      within(screen.getByRole("listbox")).getByText(/demorou mais do que o previsto/i),
    ).toBeTruthy();
  });
});
