// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ConferenciaDaLinha } from "@workspace/comparison/qlp";
import { TabelaDeCargos } from "../tabela";

/**
 * O que este teste prende: **a identidade do cargo vem em colunas**.
 *
 * A chave legível do quadro é a emenda das colunas de identidade do tipo, e no
 * operacional são três — unidade, cargo e turno. Escritas numa célula só, elas
 * viravam um título como
 * `07526557001505_CERV · Cargo: MOTORISTA 28 · Cargo: EQUIPE ATIVA 8x16`, em que
 * nada se compara entre linhas. Isso não é verificável numa função pura: o que
 * se prende é a tabela montada.
 *
 * E prende também o que a tela **não** faz: aparar o prefixo `Cargo:` da origem
 * não toca na chave normalizada, que continua inteira embaixo do cargo.
 */

afterEach(cleanup);

const conta = (): ConferenciaDaLinha["contas"][number] => ({
  conta: "ordenados",
  rotulo: "Ordenados",
  forma: "PRODUTO",
  esperado: 7_200,
  declarado: 7_200,
  diferenca: 0,
  confere: true,
});

const linha = (chave: string, nome: string | null): ConferenciaDaLinha => ({
  chave,
  nome,
  contas: [conta()],
  conferem: 1,
  divergem: 0,
  semBase: 0,
  veredito: "CONFERE",
});

const OPERACIONAL = [
  linha(
    "07526557001505CARGOMOTORISTA28CARGOEQUIPEATIVA8X16",
    "07526557001505_CERV · Cargo: MOTORISTA 28 · Cargo: EQUIPE ATIVA 8x16",
  ),
  linha(
    "07526557001505CARGOMOTORISTA28CARGOEQUIPEATIVA12X36",
    "07526557001505_CERV · Cargo: MOTORISTA 28 · Cargo: EQUIPE ATIVA 12x36",
  ),
];

const ADMINISTRATIVO = [linha("20618821000799AUXILIARADM", "20.618.821/0007-99 · AUXILIAR ADM")];

describe("a identidade do cargo na tabela", () => {
  /*
    As linhas do corpo declaram `role="button"` — a linha inteira abre a gaveta
    —, então elas não são `row` para as queries por papel. Daí o corpo ser lido
    pelo DOM, e não por `getAllByRole("row")`.
  */
  const celulasDaLinha = (container: HTMLElement, indice: number): string[] =>
    [...container.querySelectorAll("tbody > tr")[indice].querySelectorAll(":scope > td")].map(
      (td) => td.textContent ?? "",
    );

  it("dá uma coluna a cada pedaço da chave legível", () => {
    const { container } = render(<TabelaDeCargos linhas={OPERACIONAL} />);

    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual([
      "",
      "Unidade",
      "Cargo",
      "Turno",
      "Fecham",
      "Não fecham",
      "Sem base",
      "Leitura",
    ]);

    const celulas = celulasDaLinha(container, 0);
    expect(celulas[1]).toBe("07526557001505_CERV");
    /* Sem o prefixo `Cargo:` da origem — que é ruído sob estes cabeçalhos. */
    expect(celulas[2]).toContain("MOTORISTA 28");
    expect(celulas[2]).not.toContain("Cargo:");
    expect(celulas[3]).toBe("EQUIPE ATIVA 8x16");
  });

  it("o mesmo cargo em dois turnos deixa de ser duas linhas com o mesmo título", () => {
    const { container } = render(<TabelaDeCargos linhas={OPERACIONAL} />);
    const turnos = [0, 1].map((i) => celulasDaLinha(container, i)[3]);
    expect(turnos).toEqual(["EQUIPE ATIVA 8x16", "EQUIPE ATIVA 12x36"]);
  });

  it("a chave normalizada continua embaixo do cargo, inteira", () => {
    render(<TabelaDeCargos linhas={OPERACIONAL} />);
    expect(
      screen.getByText("07526557001505CARGOMOTORISTA28CARGOEQUIPEATIVA8X16"),
    ).toBeTruthy();
  });

  it("o quadro administrativo não ganha uma coluna de turno vazia", () => {
    render(<TabelaDeCargos linhas={ADMINISTRATIVO} />);
    const cabecalhos = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(cabecalhos).toEqual([
      "",
      "Unidade",
      "Cargo",
      "Fecham",
      "Não fecham",
      "Sem base",
      "Leitura",
    ]);
  });

  it("sem nome legível, a chave normalizada ocupa a coluna do cargo — e não some", () => {
    const { container } = render(<TabelaDeCargos linhas={[linha("SEMNOME", null)]} />);
    /* Sem unidade em linha nenhuma, a coluna some: o cargo é a primeira. */
    expect(celulasDaLinha(container, 0)[1]).toBe("SEMNOME");
  });
});
