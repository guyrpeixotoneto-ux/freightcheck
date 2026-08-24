import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { lerFrotaPromax } from "../leitores/frota-promax";

/**
 * O LEITOR DA FROTA PROMAX — fixtures sintéticas, layout assumido.
 *
 * **TODO(Rebeca): estas fixtures não são o arquivo real do 01.22.02.00/
 * 01.22.08.00.** São um layout plausível (`Unidade`, `Placa`, `Modelo`,
 * `Categoria`), escolhido para exercitar a infraestrutura — detecção de
 * formato pelo conteúdo, o modelo `{ linhas, recusas }`, e a recusa explícita
 * de cabeçalho não reconhecido — sem inventar o layout de verdade. Ver
 * `leitores/mapeamento-frota-promax.ts`.
 */

function planilha(cabecalho: string[], linhas: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cabecalho, ...linhas]), "Frota");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const CABECALHO = ["Unidade", "Placa", "Modelo", "Categoria"];

function fixtureFrotaAtiva(): Buffer {
  return planilha(CABECALHO, [
    ["443", "ABC1D23", "TRUCK VW 24.280", "FF"],
    ["443", "XYZ9W88", "VAN FIORINO", "VAN"],
    ["443", "QRS5T44", "TRUCK MB 1719", "FF"],
  ]);
}

function fixtureFrotaInativa(): Buffer {
  return planilha(CABECALHO, [["443", "OLD2K11", "TRUCK VW 24.280", "FF"]]);
}

describe("lerFrotaPromax — o caminho feliz", () => {
  it("lê a frota ativa, uma linha por veículo, sem recusas", () => {
    const lido = lerFrotaPromax(fixtureFrotaAtiva(), "ATIVA");
    expect(lido.recusas).toEqual([]);
    expect(lido.linhas).toHaveLength(3);
    expect(lido.linhas.map((v) => v.placa)).toEqual(["ABC1D23", "XYZ9W88", "QRS5T44"]);
    for (const v of lido.linhas) {
      expect(v.situacao).toBe("ATIVA");
      expect(v.unidade).toBe("443");
    }
    expect(lido.linhas[0]!.categoria).toBe("FF");
    expect(lido.linhas[1]!.categoria).toBe("VAN");
  });

  it("lê a frota inativa com a situação certa", () => {
    const lido = lerFrotaPromax(fixtureFrotaInativa(), "INATIVA");
    expect(lido.linhas).toHaveLength(1);
    expect(lido.linhas[0]!.situacao).toBe("INATIVA");
    expect(lido.linhas[0]!.placa).toBe("OLD2K11");
  });

  it("a placa é normalizada em maiúsculas", () => {
    const arquivo = planilha(CABECALHO, [["443", "abc1d23", "TRUCK", "FF"]]);
    const lido = lerFrotaPromax(arquivo, "ATIVA");
    expect(lido.linhas[0]!.placa).toBe("ABC1D23");
  });

  it("a linha física é preservada — 1-based, como o Excel numera", () => {
    const lido = lerFrotaPromax(fixtureFrotaAtiva(), "ATIVA");
    /* Linha 1 é o cabeçalho; a primeira linha de dado é a 2. */
    expect(lido.linhas[0]!.linha).toBe(2);
    expect(lido.linhas[2]!.linha).toBe(4);
  });
});

describe("lerFrotaPromax — recusas linha a linha, nunca por chute", () => {
  it("recusa a linha sem placa, e mantém as demais", () => {
    const arquivo = planilha(CABECALHO, [
      ["443", "ABC1D23", "TRUCK", "FF"],
      ["443", "", "TRUCK", "FF"],
    ]);
    const lido = lerFrotaPromax(arquivo, "ATIVA");
    expect(lido.linhas).toHaveLength(1);
    expect(lido.recusas).toHaveLength(1);
    expect(lido.recusas[0]!.motivo).toMatch(/placa/i);
    expect(lido.recusas[0]!.linha).toBe(3);
  });

  it("recusa a linha sem unidade e a linha sem modelo", () => {
    const arquivo = planilha(CABECALHO, [
      ["", "ABC1D23", "TRUCK", "FF"],
      ["443", "XYZ9W88", "", "FF"],
    ]);
    const lido = lerFrotaPromax(arquivo, "ATIVA");
    expect(lido.linhas).toHaveLength(0);
    expect(lido.recusas).toHaveLength(2);
  });

  it("categoria é opcional — a linha entra mesmo sem ela", () => {
    const arquivo = planilha(["Unidade", "Placa", "Modelo"], [["443", "ABC1D23", "TRUCK"]]);
    const lido = lerFrotaPromax(arquivo, "ATIVA");
    expect(lido.linhas).toHaveLength(1);
    expect(lido.linhas[0]!.categoria).toBeNull();
  });
});

describe("lerFrotaPromax — falha explícita quando o cabeçalho não bate", () => {
  it("um arquivo com colunas completamente diferentes é recusado por inteiro, com mensagem clara", () => {
    const arquivo = planilha(["Coluna A", "Coluna B"], [["x", "y"]]);
    expect(() => lerFrotaPromax(arquivo, "ATIVA")).toThrow(/frota Promax/i);
    expect(() => lerFrotaPromax(arquivo, "ATIVA")).toThrow(/01\.22\.02\.00/);
  });

  it("a mensagem de erro nomeia o relatório certo para a situação INATIVA", () => {
    const arquivo = planilha(["Coluna A", "Coluna B"], [["x", "y"]]);
    expect(() => lerFrotaPromax(arquivo, "INATIVA")).toThrow(/01\.22\.08\.00/);
  });

  it("não interpreta por posição de coluna quando o cabeçalho não é reconhecido", () => {
    /* Duas colunas de texto livre, sem os nomes esperados — o leitor não deve
       "adivinhar" que a primeira é a unidade e a segunda a placa. */
    const arquivo = planilha(["X", "Y", "Z"], [["443", "ABC1D23", "TRUCK"]]);
    expect(() => lerFrotaPromax(arquivo, "ATIVA")).toThrow();
  });
});
