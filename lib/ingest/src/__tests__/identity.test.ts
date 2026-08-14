import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { classifyEntityType, novasIdentidades, type KnownEntityType } from "../identity";
import { readWorkbook, slugifyColumn } from "../workbook";
import { modelExportPaths } from "../testing";

/**
 * A identidade decidida pelo conteúdo — com as colunas reais do export.
 *
 * O dicionário e as abas deste teste não são inventados: saem dos dois
 * arquivos de `attached_assets`. É a única forma de as notas significarem
 * alguma coisa — um fixture com cinco colunas provaria que o limiar funciona
 * num mundo que não existe.
 */

function colunasDaAba(caminho: string): string[] {
  const wb = readWorkbook(caminho);
  const aba = wb.sheets.find((s) => s.role === "SOURCE")!;
  return aba.headers
    .filter((h): h is string => h !== null && h.trim() !== "")
    .map((h) => slugifyColumn(h));
}

const { carreta, cavalo } = modelExportPaths();
const COLUNAS_CARRETA = colunasDaAba(carreta);
const COLUNAS_CAVALO = colunasDaAba(cavalo);

/** O dicionário como ele fica depois de importar cada arquivo. */
const dicionario = (colunas: string[], tipo: string): KnownEntityType => ({
  entityType: tipo,
  // Grão não vira coluna do dicionário: `vigencia` e `placa` são a chave.
  columns: new Set(colunas.filter((c) => c !== "vigencia" && c !== "placa")),
});

const SO_CARRETA = [dicionario(COLUNAS_CARRETA, "CARRETA")];
const OS_DOIS = [
  dicionario(COLUNAS_CARRETA, "CARRETA"),
  dicionario(COLUNAS_CAVALO, "CAVALO"),
];

describe("o nome da aba deixa de decidir", () => {
  /*
    Os três nomes que motivaram a mudança. Com a regra anterior — a que só sabe
    descartar palavras de documento conhecidas — cada um deles produzia um
    equipamento novo: MCARRETA, PLANILHA1, CARRETACAMACARI.
  */
  it.each(["m.carreta", "M. Carreta", "Planilha1", "Carreta Camaçari", "carreta_2026", "aba1"])(
    'uma aba chamada "%s" com colunas de carreta é CARRETA',
    (nome) => {
      const decisao = classifyEntityType(nome, COLUNAS_CARRETA, OS_DOIS);

      expect(decisao.entityType).toBe("CARRETA");
      expect(decisao.source).toBe("DICIONARIO");
      expect(decisao.isNew).toBe(false);
      expect(decisao.reason).toMatch(/não foi usado/);
    },
  );

  it("o cavalo continua sendo cavalo, com o mesmo dicionário na mesa", () => {
    const decisao = classifyEntityType("Planilha1", COLUNAS_CAVALO, OS_DOIS);
    expect(decisao.entityType).toBe("CAVALO");
    expect(decisao.source).toBe("DICIONARIO");
  });

  it("a distância entre os dois equipamentos é larga, e é ela que decide", () => {
    const decisao = classifyEntityType("qualquer", COLUNAS_CARRETA, OS_DOIS);
    const [primeiro, segundo] = decisao.scores;

    expect(primeiro.entityType).toBe("CARRETA");
    expect(primeiro.score).toBeGreaterThan(0.95);
    expect(segundo.entityType).toBe("CAVALO");
    // O cavalo compartilha ~60% das colunas da carreta: passaria por um limiar
    // frouxo sozinho, e é por isso que a margem é condição separada.
    expect(segundo.score).toBeGreaterThan(0.5);
    expect(segundo.score).toBeLessThan(0.7);
  });
});

describe("quando não há evidência, ninguém inventa identidade", () => {
  it("banco virgem: a identidade vem do nome, e vem marcada como nova", () => {
    const decisao = classifyEntityType("Modelo_Carreta", COLUNAS_CARRETA, []);

    expect(decisao.entityType).toBe("CARRETA");
    expect(decisao.source).toBe("NOME");
    expect(decisao.isNew).toBe(true);
    expect(decisao.reason).toMatch(/não conhece nenhum equipamento/);
  });

  it("equipamento de verdade novo não é forçado dentro de um tipo existente", () => {
    // O cavalo chegando num banco que só conhece carreta: 60% de sobreposição,
    // longe dos 75% exigidos. A resposta certa é "não sei", e não "é carreta".
    const decisao = classifyEntityType("Modelo_Cavalo", COLUNAS_CAVALO, SO_CARRETA);

    expect(decisao.entityType).toBe("CAVALO");
    expect(decisao.source).toBe("NOME");
    expect(decisao.isNew).toBe(true);
    expect(decisao.reason).toMatch(/abaixo dos 75%/);
  });

  it("uma aba que não parece nada conhecido cai no nome, marcada como nova", () => {
    const decisao = classifyEntityType("Modelo_Bitrem", ["eixos", "peso_bruto", "engate"], OS_DOIS);

    expect(decisao.entityType).toBe("BITREM");
    expect(decisao.source).toBe("NOME");
    expect(decisao.isNew).toBe(true);
  });

  it("empate entre dois tipos não é desempatado no chute", () => {
    /*
      Um dicionário com dois tipos idênticos: qualquer aba bate 100% nos dois.
      Sem a margem, o primeiro da ordenação levaria — e a ordenação não é
      evidência de nada.
    */
    const gemeos: KnownEntityType[] = [
      { entityType: "ALFA", columns: new Set(["a", "b", "c"]) },
      { entityType: "BETA", columns: new Set(["a", "b", "c"]) },
    ];
    const decisao = classifyEntityType("Modelo_Alfa", ["a", "b", "c"], gemeos);

    expect(decisao.source).toBe("NOME");
    expect(decisao.reason).toMatch(/perto demais/);
  });
});

describe("as colunas de grão não entram na conta", () => {
  it("uma aba só com vigência e placa não é reconhecida como nada", () => {
    const decisao = classifyEntityType("Planilha1", ["vigencia", "placa"], OS_DOIS);
    expect(decisao.source).toBe("NOME");
    expect(decisao.entityType).toBe("PLANILHA1");
  });
});

describe("o conjunto de identidades novas de uma importação inteira", () => {
  it("junta as abas e devolve só o que o dicionário não conhece", () => {
    expect(novasIdentidades(["CARRETA", "BITREM", "BITREM"], ["CARRETA", "CAVALO"])).toEqual([
      "BITREM",
    ]);
    expect(novasIdentidades(["CARRETA"], ["CARRETA", "CAVALO"])).toEqual([]);
  });
});

describe("a aba renomeada, lida do arquivo de verdade", () => {
  it("m.carreta escrito dentro do .xlsx é classificado como CARRETA", () => {
    /*
      Não é o mesmo teste de cima com outra roupa: aqui o nome é trocado
      **dentro do arquivo**, e as colunas vêm da leitura do workbook, passando
      por `readWorkbook` e `slugifyColumn` como numa importação real.
    */
    const wb = XLSX.readFile(carreta);
    const original = wb.SheetNames[0];
    wb.Sheets["m.carreta"] = wb.Sheets[original];
    delete wb.Sheets[original];
    wb.SheetNames[0] = "m.carreta";

    const destino = `${process.env.TMPDIR ?? "/tmp"}/m-carreta-${process.pid}.xlsx`;
    XLSX.writeFile(wb, destino);

    const lido = readWorkbook(destino);
    const aba = lido.sheets.find((s) => s.role === "SOURCE")!;
    expect(aba.name).toBe("m.carreta");
    // A derivação por nome, que ainda é o desempate, produziria MCARRETA.
    expect(aba.entityType).toBe("MCARRETA");

    const decisao = classifyEntityType(
      aba.name,
      aba.headers.filter((h): h is string => !!h).map((h) => slugifyColumn(h)),
      OS_DOIS,
    );
    expect(decisao.entityType).toBe("CARRETA");
    expect(decisao.source).toBe("DICIONARIO");
  });
});
