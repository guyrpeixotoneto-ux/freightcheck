import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { montarLinhas, type AtributoDoModelo } from "@workspace/curation";
import {
  lerModeloDeAtributos,
  montarModeloDeAtributos,
} from "../planilha-de-atributos";

/**
 * O arquivo escrito aqui tem de ser legível aqui — e é só isso que este teste
 * mede, de propósito.
 *
 * A ida e a volta usam bibliotecas diferentes (`exceljs` escreve, `xlsx` lê), e
 * essa escolha tem motivo: o leitor é o mesmo do resto do produto, que engole o
 * que o Google Sheets e o LibreOffice devolvem. O risco dessa assimetria é
 * exatamente um — as duas metades divergirem sem ninguém notar, porque nenhum
 * teste fecha o círculo — e é o que este arquivo fecha.
 *
 * A leitura é por **rótulo de cabeçalho**, e a prova disso é o teste da coluna
 * movida: uma planilha que passou por três pessoas tem coluna arrastada, e ler
 * pela posição seria ler o que calhar de estar lá.
 */

const catalogos = {
  significados: [
    { code: "brl_mes", label: "R$ por mês" },
    { code: "brl_km", label: "R$ por km" },
  ],
  categorias: [
    { code: "cf_seguros", caminho: "Custo Fixo › Seguros" },
    { code: "cv_pneus", caminho: "Custo Variável › Pneus" },
  ],
};

const base: AtributoDoModelo[] = [
  {
    code: "cavalo.seguro",
    sourceName: "seguro",
    entityType: "CAVALO",
    semanticsStatus: "PRESUMED",
    valueCount: 558,
    displayName: "Seguro do cavalo",
    definition: null,
    calculationBasis: null,
    meaningCode: null,
    taxonomyCode: null,
  },
  {
    code: "carreta.valor_pneu",
    sourceName: "valorPneu",
    entityType: "CARRETA",
    semanticsStatus: "CONFIRMED",
    valueCount: 720,
    displayName: null,
    definition: "Preço unitário do pneu.",
    calculationBasis: null,
    meaningCode: "brl_mes",
    taxonomyCode: "cv_pneus",
  },
];

async function arquivo(): Promise<Buffer> {
  return montarModeloDeAtributos({
    linhas: montarLinhas(base, catalogos),
    ...catalogos,
    geradoPor: "teste@freightcheck",
    geradoEm: "17/08/2026 20:00",
  });
}

describe("o modelo de atributos", () => {
  it("sai com uma aba por equipamento, mais instruções", async () => {
    const workbook = XLSX.read(await arquivo(), { type: "buffer" });
    expect(workbook.SheetNames).toContain("Instruções");
    expect(workbook.SheetNames).toContain("Cavalo");
    expect(workbook.SheetNames).toContain("Carreta");
  });

  it("volta a ser lido pelo leitor do produto, linha por linha", async () => {
    const leitura = lerModeloDeAtributos(await arquivo());
    if (!leitura.ok) throw new Error(leitura.erro);

    expect(leitura.linhas.map((l) => l.code).sort()).toEqual([
      "carreta.valor_pneu",
      "cavalo.seguro",
    ]);
    const pneu = leitura.linhas.find((l) => l.code === "carreta.valor_pneu")!;
    expect(pneu.aba).toBe("Carreta");
    expect(pneu.definition).toBe("Preço unitário do pneu.");
    // O que estava gravado sai escrito no arquivo: é o que faz a volta ser um
    // diff e não um preenchimento do zero.
    expect(pneu.significado).toBe("R$ por mês");
    expect(pneu.categoria).toBe("Custo Variável › Pneus");
  });

  it("a aba de instruções não vira linha — ela não tem coluna Código", async () => {
    const leitura = lerModeloDeAtributos(await arquivo());
    if (!leitura.ok) throw new Error(leitura.erro);
    expect(leitura.linhas.every((l) => l.aba !== "Instruções")).toBe(true);
  });

  it("lê pelo rótulo do cabeçalho, e não pela posição da coluna", () => {
    const workbook = XLSX.utils.book_new();
    const aba = XLSX.utils.aoa_to_sheet([
      ["O que é", "Código", "Nome gerencial"],
      ["Seguro contratado.", "cavalo.seguro", "Seguro"],
    ]);
    XLSX.utils.book_append_sheet(workbook, aba, "Cavalo");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const leitura = lerModeloDeAtributos(bytes);
    if (!leitura.ok) throw new Error(leitura.erro);
    expect(leitura.linhas[0]).toMatchObject({
      code: "cavalo.seguro",
      definition: "Seguro contratado.",
      displayName: "Seguro",
    });
  });

  it("recusa um arquivo que não é o modelo, em vez de ler zero linhas em silêncio", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["Placa", "Valor"], ["ABC1D23", 1200]]),
      "Dados",
    );
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const leitura = lerModeloDeAtributos(bytes);
    expect(leitura.ok).toBe(false);
    if (!leitura.ok) expect(leitura.erro).toMatch(/coluna "Código"/);
  });

  it("recusa bytes que não são planilha", () => {
    const leitura = lerModeloDeAtributos(Buffer.from("isto não é um xlsx"));
    expect(leitura.ok).toBe(false);
  });

  it("ignora a linha em branco do fim, e não a linha preenchida sem código", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Código", "O que é"],
        ["cavalo.seguro", "Seguro contratado."],
        ["", ""],
        ["", "Descrição órfã, sem código."],
      ]),
      "Cavalo",
    );
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const leitura = lerModeloDeAtributos(bytes);
    if (!leitura.ok) throw new Error(leitura.erro);
    expect(leitura.linhas).toHaveLength(2);
    expect(leitura.linhas[1]).toMatchObject({
      code: "",
      definition: "Descrição órfã, sem código.",
    });
  });
});
