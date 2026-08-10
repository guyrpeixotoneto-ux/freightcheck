import { describe, expect, it } from "vitest";
import { deriveEntityType, foldText, readWorkbook, slugifyColumn } from "../workbook";
import { realExportPath } from "./helpers/db";

describe("slugifyColumn", () => {
  it("recovers word boundaries from camelCase", () => {
    expect(slugifyColumn("ipvaLicenciamento")).toBe("ipva_licenciamento");
    expect(slugifyColumn("ipvaLicenciamentoMensal")).toBe("ipva_licenciamento_mensal");
    expect(slugifyColumn("dataFimContrato")).toBe("data_fim_contrato");
    expect(slugifyColumn("combustivelConsumoNegInteiro")).toBe(
      "combustivel_consumo_neg_inteiro",
    );
  });

  it("handles acronyms and spaced headers", () => {
    expect(slugifyColumn("Unidade - CNPJ")).toBe("unidade_cnpj");
    expect(slugifyColumn("TJLP")).toBe("tjlp");
    expect(slugifyColumn("Taxa Finame (%)")).toBe("taxa_finame");
    expect(slugifyColumn("statusFinanciamentoT1Shared")).toBe(
      "status_financiamento_t1_shared",
    );
  });

  it("folds accents so the slug stays ASCII", () => {
    expect(slugifyColumn("Custo Variável Simulado")).toBe("custo_variavel_simulado");
    expect(slugifyColumn("Padrão")).toBe("padrao");
    expect(foldText("CAMAÇARI")).toBe("camacari");
  });

  it("keeps genuinely different columns distinct", () => {
    // The pair that would silently merge under a naive slug.
    expect(slugifyColumn("ipvaLicenciamento")).not.toBe(
      slugifyColumn("ipvaLicenciamentoMensal"),
    );
    expect(slugifyColumn("valorPneu")).not.toBe(slugifyColumn("valorPneus"));
    expect(slugifyColumn("lucroVariavelPrevisto")).not.toBe(
      slugifyColumn("lucroVariavelPrevistoCarreta"),
    );
  });
});

describe("deriveEntityType", () => {
  it("singularises and uppercases the sheet name, and says why", () => {
    expect(deriveEntityType("cavalos").entityType).toBe("CAVALO");
    expect(deriveEntityType("carretas").entityType).toBe("CARRETA");
    expect(deriveEntityType("cavalos").reason).toContain("sheet name");
  });
});

describe("sheet classification on the real export", () => {
  it("separates fact sources from pivots by shape, not by name", () => {
    const { sheets } = readWorkbook(realExportPath());
    const byName = new Map(sheets.map((s) => [s.name, s]));

    expect(byName.get("cavalos")!.role).toBe("SOURCE");
    expect(byName.get("carretas")!.role).toBe("SOURCE");
    expect(byName.get("Quantidade")!.role).toBe("PIVOT");
    expect(byName.get("Análise Carreta")!.role).toBe("PIVOT");
    expect(byName.get("Análise Cavalo")!.role).toBe("PIVOT");

    // The reason is recorded so a reviewer can disagree with the classifier.
    expect(byName.get("Quantidade")!.roleReason).toMatch(/lacks the grain column/);
    expect(byName.get("cavalos")!.roleReason).toMatch(/vigencia \+ placa/);
  });

  it("finds no duplicate slug inside either source sheet", () => {
    const { sheets } = readWorkbook(realExportPath());
    for (const sheet of sheets.filter((s) => s.role === "SOURCE")) {
      const slugs = sheet.headers
        .filter((h): h is string => h !== null)
        .map(slugifyColumn);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});
