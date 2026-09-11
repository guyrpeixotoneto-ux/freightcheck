import { describe, expect, it } from "vitest";
import { normalizarUnidade, unidadeNoNomeDoArquivo } from "../nome-de-unidade";

/**
 * A UNIDADE DENTRO DO NOME DO ARQUIVO.
 *
 * O caso que trouxe este módulo, medido no acervo real: `Chamados Agosto
 * Camaçari.xlsx`, 2.349 chamados, coluna `Unidade` vazia em todas as linhas. A
 * leitura antiga do nome devolvia `Agosto Camaçari` — uma série que existe, que
 * particiona, e que não casa com unidade nenhuma da lateral. O envio ficava
 * tecnicamente particionado e praticamente invisível.
 *
 * Cada bloco abaixo fixa uma das três recusas que impedem a busca por conteúdo
 * de virar um "contém" solto, que é a única coisa pior do que não procurar.
 */

const CADASTRO = ["CAMAÇARI", "PERNAMBUCO", "CDD BELÉM"];

describe("normalizarUnidade", () => {
  it("a mesma unidade escrita de três jeitos vira a mesma palavra", () => {
    expect(normalizarUnidade("Camaçari")).toBe(normalizarUnidade("CAMACARI "));
    expect(normalizarUnidade("cdd  belem")).toBe(normalizarUnidade("CDD BELÉM"));
  });

  it("duas unidades diferentes continuam diferentes", () => {
    // A separação de que o casamento por igualdade depende: `CDD CEBRASA` e
    // `CEBRASA` podem ser a mesma unidade e podem não ser, e decidir isso
    // sozinho atribui chamados de uma unidade a outra sem dizer.
    expect(normalizarUnidade("CDD CEBRASA")).not.toBe(normalizarUnidade("CEBRASA"));
  });

  it("o que não é nome é nulo, e não string vazia", () => {
    expect(normalizarUnidade("   ")).toBeNull();
    expect(normalizarUnidade(null)).toBeNull();
  });
});

describe("a unidade que o nome do arquivo nomeia", () => {
  it("acha a unidade no meio da frase — o caso de Camaçari", () => {
    expect(unidadeNoNomeDoArquivo("Chamados Agosto Camaçari", CADASTRO)).toBe(
      "CAMAÇARI",
    );
  });

  it("devolve o nome como o cadastro o escreve, e não o pedaço do arquivo", () => {
    // É sobre o texto do cadastro que a lateral casa a unidade com a série.
    // Devolver `camacari` faria o casamento depender de a normalização das duas
    // pontas continuar igual para sempre.
    expect(unidadeNoNomeDoArquivo("export camacari final (3)", CADASTRO)).toBe(
      "CAMAÇARI",
    );
  });

  it("casa palavra inteira, e não pedaço de palavra", () => {
    expect(unidadeNoNomeDoArquivo("Chamados CAMACARIENSE", CADASTRO)).toBeNull();
    expect(unidadeNoNomeDoArquivo("Chamados 4432", ["443"])).toBeNull();
  });

  it("o mais específico vence quando um nome é pedaço do outro", () => {
    // O arquivo escreveu `CDD CEBRASA` inteiro; escolher `CEBRASA` seria
    // descartar metade da evidência que ele mesmo trouxe.
    expect(
      unidadeNoNomeDoArquivo("Chamados CDD CEBRASA", ["CEBRASA", "CDD CEBRASA"]),
    ).toBe("CDD CEBRASA");
  });

  it("duas unidades diferentes no mesmo nome não decidem nada", () => {
    // Devolver uma delas seria sorteio. `null` manda o envio para a série
    // indeterminada, que é um estado nomeado e reparável.
    expect(
      unidadeNoNomeDoArquivo("Chamados Recife e Camaçari", [
        "RECIFE",
        "CAMAÇARI",
      ]),
    ).toBeNull();
  });

  it("nome curto demais não é unidade, é acaso", () => {
    // Um código de dois dígitos casaria com qualquer coisa: `Chamados 08 2026`
    // acharia a unidade `08` e atribuiria o arquivo inteiro a ela.
    expect(unidadeNoNomeDoArquivo("Chamados 08 2026", ["08"])).toBeNull();
  });

  it("sem cadastro não há o que achar", () => {
    expect(unidadeNoNomeDoArquivo("Chamados Agosto Camaçari", [])).toBeNull();
  });
});
