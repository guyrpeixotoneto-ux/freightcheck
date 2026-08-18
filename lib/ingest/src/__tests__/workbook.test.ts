import { describe, expect, it } from "vitest";
import { deriveEntityType, foldText, readWorkbook, slugifyColumn } from "../workbook";
import { realExportPath } from "../testing";
import { escreverPlanilha } from "./planilha-sintetica";

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

describe("deriveEntityType — nomes de aba de qualquer empacotamento", () => {
  it("lê o nome da aba como frase, não como o tipo em si", () => {
    // Como a Ambev entregava: um arquivo, abas no plural.
    expect(deriveEntityType("carretas").entityType).toBe("CARRETA");
    expect(deriveEntityType("cavalos").entityType).toBe("CAVALO");
    // Como passou a entregar: um arquivo por equipamento.
    expect(deriveEntityType("Modelo_Carreta").entityType).toBe("CARRETA");
    expect(deriveEntityType("Modelo_Cavalo").entityType).toBe("CAVALO");
    // A primeira versão devolvia MODELOCARRETA aqui, criando uma segunda
    // identidade paralela para ativos que já existiam no sistema.
    expect(deriveEntityType("Modelo_Carreta").entityType).not.toBe("MODELOCARRETA");
  });

  it("descarta a palavra do documento e diz que descartou", () => {
    const { entityType, reason } = deriveEntityType("Base_Dados_Reboque");
    expect(entityType).toBe("REBOQUE");
    expect(reason).toMatch(/descartado o que descreve o documento/);
    expect(reason).toContain("base");
  });

  it("mantém o vocabulário de equipamento aberto", () => {
    // Nenhum tipo é enumerado no código: um equipamento novo entra sozinho.
    expect(deriveEntityType("Modelo Bitrem").entityType).toBe("BITREM");
    expect(deriveEntityType("Análise Carreta").entityType).toBe("CARRETA");
  });

  it("não inventa um tipo quando só há palavra de documento", () => {
    // "Modelos" sozinho não nomeia equipamento nenhum; melhor devolver o nome
    // inteiro do que um tipo vazio.
    expect(deriveEntityType("Modelos").entityType).toBe("MODELO");
  });
});

describe("deriveEntityType", () => {
  it("singularises and uppercases the sheet name, and says why", () => {
    expect(deriveEntityType("cavalos").entityType).toBe("CAVALO");
    expect(deriveEntityType("carretas").entityType).toBe("CARRETA");
    expect(deriveEntityType("cavalos").reason).toContain('nome da aba "cavalos"');
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
    expect(byName.get("Quantidade")!.roleReason).toMatch(/não traz vigencia/);
    // A recusa nomeia os dois identificadores que serviriam: quem lê precisa
    // saber que uma aba sem placa ainda pode ser uma aba de trecho legítima.
    expect(byName.get("Quantidade")!.roleReason).toMatch(/Placa ou chaveTrecho/);
    expect(byName.get("cavalos")!.roleReason).toMatch(/vigencia \+ Placa/);
    expect(byName.get("cavalos")!.identifierColumn).toBe("placa");
    expect(byName.get("Quantidade")!.identifierColumn).toBeNull();
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

/**
 * O trecho não tem placa, e isso não pode custar a aba inteira.
 *
 * Antes destes testes, uma aba sem `Placa` era rebaixada a PIVOT e não
 * produzia fato nenhum — em silêncio, com zero erro e zero aviso. A prova de
 * que a regra mudou é uma aba que só tem a outra chave e ainda assim é fonte.
 */
describe("o grão é do tipo, não da placa", () => {
  const planilhaDeTrecho = () =>
    escreverPlanilha({
      vigencia: "EMPURRADA_1_8_2026",
      abas: [
        {
          nome: "trechos",
          identificador: "chaveTrecho",
          linhas: [{ placa: "CAMACARI-SALVADOR" }, { placa: "CAMACARI-FEIRA" }],
        },
      ],
    });

  it("aceita como fonte uma aba identificada por chaveTrecho", () => {
    const { sheets } = readWorkbook(planilhaDeTrecho());
    const [aba] = sheets;

    expect(aba.role).toBe("SOURCE");
    expect(aba.identifierColumn).toBe("chavetrecho");
    expect(aba.entityType).toBe("TRECHO");
    expect(aba.roleReason).toMatch(/vigencia \+ chaveTrecho/);
  });

  it("continua aceitando a aba identificada por placa", () => {
    const caminho = escreverPlanilha({
      vigencia: "EMPURRADA_1_8_2026",
      abas: [{ nome: "cavalos", linhas: [{ placa: "ABC1D23" }] }],
    });
    const [aba] = readWorkbook(caminho).sheets;

    expect(aba.role).toBe("SOURCE");
    expect(aba.identifierColumn).toBe("placa");
  });

  it("recusa a aba sem identificador nenhum dizendo quais serviriam", () => {
    const pivo = readWorkbook(realExportPath()).sheets.find(
      (s) => s.role === "PIVOT",
    )!;

    expect(pivo.roleReason).toMatch(/Placa ou chaveTrecho/);
    expect(pivo.identifierColumn).toBeNull();
  });
});
