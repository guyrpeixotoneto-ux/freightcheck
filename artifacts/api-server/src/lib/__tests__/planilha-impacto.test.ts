import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type {
  AbaDeImpacto,
  ExportacaoDeImpacto,
  QuinzenaCell,
} from "@workspace/comparison";
import {
  FORA_DA_FROTA,
  SEM_VALOR,
  agoraEmBrasilia,
  celulaDaMatriz,
  linhasDaAba,
  linhaDoCabecalho,
  linhasDoIndice,
  montarPlanilhaDeImpacto,
  nomeDeAba,
  nomeDoArquivo,
} from "../planilha-impacto";

/**
 * O que o arquivo do Excel promete, conferido sem banco.
 *
 * A exportação é o único lugar deste produto onde o dado sai do alcance da tela:
 * não há `title` para explicar uma célula, não há faixa amarela, e quem abre o
 * arquivo três semanas depois só tem o que está escrito nele. Os casos abaixo
 * cobrem exatamente as afirmações que o arquivo faz por conta própria.
 *
 * O primeiro grupo é o mais importante: **ausência não é zero**. Os quatro
 * estados da matriz precisam chegar ao Excel como três coisas distintas, e
 * nenhuma delas pode ser um número — senão `SOMA()` sobre a coluna passa a
 * incluir ativos que não estavam na frota, e o total do arquivo deixa de fechar
 * com o da tela.
 */

const celula = (
  state: QuinzenaCell["state"],
  value: number | null = null,
  movimento: QuinzenaCell["movimento"] = null,
): QuinzenaCell => ({ value, state, delta: null, movimento });

/** Só os valores de uma linha — o tom é conferido nos casos que falam de cor. */
const valores = (linha: { valor: string | number | null }[]) =>
  linha.map((c) => c.valor);

function aba(over: Partial<AbaDeImpacto> = {}): AbaDeImpacto {
  const periods = [
    {
      effectiveDate: "2025-12-02",
      sourceLabel: "EMPURRADA_2_12_2025",
      delivered: true,
      entities: 2,
      withValue: 2,
      total: 9.83,
    },
    {
      effectiveDate: "2026-01-02",
      sourceLabel: "EMPURRADA_2_1_2026",
      delivered: true,
      entities: 2,
      withValue: 1,
      total: 5,
    },
  ];
  return {
    parametro: {
      code: "cavalo.consumo_combustivel",
      title: "Consumo de Combustível",
      entityType: "CAVALO",
      equipment: "Cavalos",
      changes: 494,
      entities: 64,
      entitiesNaSerie: 64,
      from: null,
      to: null,
      variacao: null,
      unit: "KM_L",
      periodicity: null,
      aggregation: null,
      isMonetary: false,
      semanticsStatus: "UNKNOWN",
      impactoCalculavel: false,
      impactoMotivo: "Semântica desconhecida: o atributo ainda não foi confirmado.",
      classeDeCusto: "SEM_CLASSE",
      grupoDeCusto: null,
      papel: "SIMPLES",
      dentroDe: null,
      parcelas: [],
      contem: null,
      evidencia: null,
      reconciliacao: null,
    },
    linhaEconomica: true,
    groupedBy: { code: "cavalo.data", title: "Data" },
    periods,
    groups: [
      {
        key: "2021-01-01",
        label: "01/01/21",
        rows: [
          {
            entityId: "e1",
            plate: "QYQ6A80",
            cells: [celula("VALOR", 4.92), celula("VALOR", 5, "SUBIU")],
            total: 9.92,
            first: 4.92,
            last: 5,
            delta: 0.08,
            periods: 2,
          },
          {
            entityId: "e2",
            plate: "QYQ6B30",
            cells: [celula("VALOR", 4.91), celula("FORA_DA_FROTA", null, "SAIU")],
            total: 4.91,
            first: 4.91,
            last: 4.91,
            delta: 0,
            periods: 1,
          },
        ],
        totals: [9.83, 5],
        total: 14.83,
      },
    ],
    totals: [9.83, 5],
    grandTotal: 14.83,
    ativos: 2,
    pontaAPonta: null,
    ...over,
  };
}

function exportacao(over: Partial<ExportacaoDeImpacto> = {}): ExportacaoDeImpacto {
  return {
    context: {
      scopeHash: "abc",
      channel: "EMPURRADA",
      label: "CAMAÇARI · EMPURRADA",
      scopes: [],
      latestPeriod: "2026-08-01",
      periods: 9,
      periodosDisponiveis: ["2025-12-02", "2026-01-02"],
      periodosNaJanela: 2,
    },
    corte: "TUDO",
    corteNome: null,
    periodos: [
      { effectiveDate: "2025-12-02", sourceLabel: "EMPURRADA_2_12_2025" },
      { effectiveDate: "2026-01-02", sourceLabel: "EMPURRADA_2_1_2026" },
    ],
    totais: {
      linhasEconomicas: 16,
      parametrosAlterados: 16,
      comImpacto: 0,
      semImpacto: 16,
      alteracoes: 2301,
      ativosAfetados: 64,
    },
    abas: [aba()],
    ...over,
  };
}

describe("celulaDaMatriz", () => {
  it("mantém o zero como número — ele é um valor, não uma ausência", () => {
    // O caso que a planilha do cliente não consegue distinguir: passou a custar
    // nada é diferente de não estar mais na frota.
    expect(celulaDaMatriz(celula("VALOR", 0)).valor).toBe(0);
  });

  it("nunca devolve número para ausência nenhuma", () => {
    for (const estado of ["SEM_VALOR", "FORA_DA_FROTA", "NAO_ENTREGUE"] as const) {
      expect(typeof celulaDaMatriz(celula(estado)).valor).not.toBe("number");
    }
  });

  it("dá três aparências às três ausências", () => {
    expect(celulaDaMatriz(celula("FORA_DA_FROTA")).valor).toBe(FORA_DA_FROTA);
    expect(celulaDaMatriz(celula("SEM_VALOR")).valor).toBe(SEM_VALOR);
    // Vigência que não trouxe o equipamento não é afirmação sobre o ativo.
    expect(celulaDaMatriz(celula("NAO_ENTREGUE")).valor).toBeNull();
  });
});

describe("nomeDeAba", () => {
  it("separa os equipamentos que têm parâmetro de mesmo nome", () => {
    const usados = new Set<string>();
    expect(nomeDeAba("CAVALO", "Consumo de Combustível", usados)).toBe(
      "CAV Consumo de Combustível",
    );
    expect(nomeDeAba("CARRETA", "Consumo de Combustível", usados)).toBe(
      "CAR Consumo de Combustível",
    );
  });

  it("respeita o limite de 31 caracteres do Excel", () => {
    const nome = nomeDeAba(
      "CAVALO",
      "Lucro Fixo Modelo Novo Ciclo Completo Renovado",
      new Set(),
    );
    expect(nome.length).toBeLessThanOrEqual(31);
  });

  it("troca o que o Excel recusa em vez de deixar o arquivo não abrir", () => {
    const nome = nomeDeAba("CAVALO", "R$/km [médio] * 2", new Set());
    expect(nome).not.toMatch(/[\\/?*[\]:]/);
  });

  it("desempata dois nomes longos que coincidem no corte", () => {
    const usados = new Set<string>();
    const longo = "Custo Variável Simulado Sem Pneu Novo";
    const primeiro = nomeDeAba("CAVALO", longo, usados);
    const segundo = nomeDeAba("CAVALO", `${longo} e Sem Motor`, usados);
    expect(segundo).not.toBe(primeiro);
    expect(segundo.length).toBeLessThanOrEqual(31);
  });
});

describe("linhasDaAba", () => {
  const linhas = linhasDaAba(aba());
  const cabecalho = linhas.findIndex((l) => l[1]?.valor === "placa");

  it("põe uma coluna por vigência, entre a identificação e os totais", () => {
    expect(valores(linhas[cabecalho])).toEqual([
      "Data",
      "placa",
      "EMPURRADA_2_12_2025",
      "EMPURRADA_2_1_2026",
      "Total Geral",
      "Δ",
    ]);
  });

  it("repete o grupo em cada linha de ativo, para a planilha ser dinamizável", () => {
    const doAtivo = linhas.filter(
      (l) => l[1]?.valor === "QYQ6A80" || l[1]?.valor === "QYQ6B30",
    );
    expect(doAtivo).toHaveLength(2);
    expect(doAtivo.every((l) => l[0].valor === "01/01/21")).toBe(true);
  });

  it("marca o subtotal na coluna da placa, para ninguém somá-lo com os ativos", () => {
    const subtotal = linhas.find((l) =>
      String(l[1]?.valor ?? "").startsWith("subtotal"),
    );
    expect(subtotal?.[0].valor).toBe("01/01/21");
    expect(valores(subtotal!.slice(2))).toEqual([9.83, 5, 14.83, null]);
  });

  it("escreve a legenda das ausências e o aviso do total antes da tabela", () => {
    const antes = linhas.slice(0, cabecalho).flat().map((c) => c.valor).join(" ");
    expect(antes).toContain("Nenhuma das três é zero");
    expect(antes).toContain("não é o custo de um período");
  });

  it("diz que não há leitura financeira quando não há, com o motivo", () => {
    const antes = linhas.slice(0, cabecalho).flat().map((c) => c.valor).join(" ");
    expect(antes).toContain("Sem leitura financeira apurada");
    expect(antes).toContain("Semântica desconhecida");
  });

  it("avisa quando a aba não soma com as outras", () => {
    const conjunto = aba({
      linhaEconomica: false,
      parametro: {
        ...aba().parametro,
        papel: "CONJUNTO",
        contem: "cavalo.custo_fixo",
      },
    });
    const antes = linhasDaAba(conjunto)
      .flat()
      .map((c) => c.valor)
      .join(" ");
    expect(antes).toContain("já contém o outro equipamento");
    expect(antes).toContain("duas vezes");
  });

  it("fecha com o Total Geral da frota", () => {
    const ultima = linhas[linhas.length - 1];
    expect(ultima[0].valor).toBe("Total Geral");
    expect(valores(ultima.slice(2))).toEqual([9.83, 5, 14.83, null]);
  });
});

describe("linhasDoIndice", () => {
  it("liga o nome curto da aba ao nome inteiro do parâmetro", () => {
    const nomes = new Map([["cavalo.consumo_combustivel", "CAV Consumo de Combu"]]);
    const linhas = linhasDoIndice(exportacao(), nomes, "17/08/2026 14:32");
    const linha = linhas.find((l) => l[0]?.valor === "CAV Consumo de Combu");
    expect(linha?.[1].valor).toBe("Consumo de Combustível");
  });

  it("repete os totais do panorama, para o arquivo dizer de onde veio", () => {
    const texto = linhasDoIndice(exportacao(), new Map(), "17/08/2026 14:32")
      .flat()
      .map((c) => c.valor)
      .join(" ");
    expect(texto).toContain("CAMAÇARI · EMPURRADA");
    expect(texto).toContain("16 linhas econômicas");
    expect(texto).toContain("EMPURRADA_2_12_2025");
    expect(texto).toContain("17/08/2026 14:32");
  });
});

describe("nomeDoArquivo", () => {
  it("diz o contexto e as pontas, sem caractere que o sistema de arquivos recuse", () => {
    const nome = nomeDoArquivo(exportacao());
    expect(nome).not.toMatch(/[\\/:*?"<>|]/);
    expect(nome).toMatch(/\.xlsx$/);
    expect(nome).toContain("EMPURRADA_2_12_2025 a EMPURRADA_2_1_2026");
  });

  it("nomeia o corte quando há um", () => {
    expect(nomeDoArquivo(exportacao({ corte: "FIXO", corteNome: "Custo fixo" }))).toContain(
      "Custo fixo",
    );
  });
});

/**
 * A cor, que é informação e não enfeite.
 *
 * Na tela, verde e vermelho são o que faz a alteração aparecer sem ninguém
 * comparar duas colunas de cabeça. No arquivo elas são a **única** pista que
 * sobra: não há `title` para explicar uma célula. Por isso a cor sai do
 * `movimento` que o servidor apurou, e estes casos protegem exatamente isso —
 * que ela não seja recalculada aqui, e que o que não se moveu fique sem cor.
 */
describe("as cores repetem as da tela", () => {
  const linhas = linhasDaAba(aba());
  const doAtivo = (placa: string) => linhas.find((l) => l[1]?.valor === placa)!;

  it("pinta de verde o que subiu e de vermelho o que caiu", () => {
    const subiu = doAtivo("QYQ6A80");
    // A primeira vigência não tem anterior com que comparar: sem movimento,
    // sem cor — como na tela.
    expect(subiu[2].tom).toBeUndefined();
    expect(subiu[3].tom).toBe("SUBIU");

    const caiu = linhasDaAba(
      aba({
        groups: [
          {
            ...aba().groups[0],
            rows: [
              {
                ...aba().groups[0].rows[0],
                cells: [celula("VALOR", 5), celula("VALOR", 4.9, "CAIU")],
              },
            ],
          },
        ],
      }),
    ).find((l) => l[1]?.valor === "QYQ6A80")!;
    expect(caiu[3].tom).toBe("CAIU");
  });

  it("não pinta o que ficou igual", () => {
    const igual = linhasDaAba(
      aba({
        groups: [
          {
            ...aba().groups[0],
            rows: [
              {
                ...aba().groups[0].rows[0],
                cells: [celula("VALOR", 5), celula("VALOR", 5, "IGUAL")],
              },
            ],
          },
        ],
      }),
    ).find((l) => l[1]?.valor === "QYQ6A80")!;
    expect(igual[3].tom).toBeUndefined();
  });

  it("distingue a saída de frota da ausência sem movimento", () => {
    expect(doAtivo("QYQ6B30")[3].tom).toBe("SAIU");
    expect(celulaDaMatriz(celula("FORA_DA_FROTA")).tom).toBeUndefined();
    expect(celulaDaMatriz(celula("NAO_ENTREGUE")).tom).toBe("NAO_ENTREGUE");
    expect(celulaDaMatriz(celula("SEM_VALOR")).tom).toBe("SEM_VALOR");
  });

  it("dá ao Δ da linha a cor do sinal, e nenhuma cor ao zero", () => {
    expect(doAtivo("QYQ6A80").at(-1)!.tom).toBe("SUBIU");
    // QYQ6B30 tem delta 0 — não subiu nem caiu.
    expect(doAtivo("QYQ6B30").at(-1)!.tom).toBeUndefined();
  });

  it("marca cabeçalho, subtotal e total como estrutura, não como movimento", () => {
    const cab = linhas.find((l) => l[1]?.valor === "placa")!;
    expect(cab.every((c) => c.tom === "CABECALHO")).toBe(true);
    const subtotal = linhas.find((l) =>
      String(l[1]?.valor ?? "").startsWith("subtotal"),
    )!;
    expect(subtotal.every((c) => c.tom === "GRUPO")).toBe(true);
    expect(linhas.at(-1)!.every((c) => c.tom === "CABECALHO")).toBe(true);
  });
});

/**
 * O arquivo, escrito e lido de volta.
 *
 * Um `.xlsx` que não abre é o pior desfecho possível desta rota — o defeito
 * aparece no computador de quem baixou, sem log nenhum. Reabrir o que acabou de
 * ser escrito é o que prova que o nome das abas, o formato e os tipos de célula
 * sobreviveram à serialização.
 */
describe("montarPlanilhaDeImpacto", () => {
  let lido: ExcelJS.Workbook;

  beforeAll(async () => {
    const bytes = await montarPlanilhaDeImpacto(exportacao(), "17/08/2026 14:32");
    lido = new ExcelJS.Workbook();
    await lido.xlsx.load(bytes as unknown as Parameters<typeof lido.xlsx.load>[0]);
  });

  it("abre, com o índice na frente e uma aba por parâmetro", () => {
    expect(lido.worksheets.map((w) => w.name)).toEqual([
      "Índice",
      "CAV Consumo de Combustível",
    ]);
  });

  it("guarda valor como número e ausência como texto", () => {
    const ws = lido.getWorksheet("CAV Consumo de Combustível")!;
    const numerica = ws.getCell(linhaDaPlaca(ws, "QYQ6A80"), 3);
    expect(numerica.value).toBe(4.92);
    expect(numerica.type).toBe(ExcelJS.ValueType.Number);
    expect(celulaComValor(ws, FORA_DA_FROTA).type).toBe(ExcelJS.ValueType.String);
  });

  it("leva a cor até o arquivo: verde no que subiu, vermelho no que caiu", () => {
    const ws = lido.getWorksheet("CAV Consumo de Combustível")!;
    // Ancorado na linha da placa, e não no primeiro 5 que aparecer: o subtotal
    // do grupo tem o mesmo valor e o tom da estrutura, não do movimento.
    const subiu = ws.getCell(linhaDaPlaca(ws, "QYQ6A80"), 4);
    expect((subiu.fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFECFDF5");
    expect((subiu.font?.color as { argb?: string })?.argb).toBe("FF065F46");
    // A seta vai no formato do número, para a célula continuar somável.
    expect(subiu.numFmt).toBe('"↗ "#,##0.00');
    expect(subiu.type).toBe(ExcelJS.ValueType.Number);
  });

  it("hachura a vigência que não trouxe o equipamento", async () => {
    const comLacuna = aba({
      groups: [
        {
          ...aba().groups[0],
          rows: [
            {
              ...aba().groups[0].rows[0],
              cells: [celula("VALOR", 4.92), celula("NAO_ENTREGUE")],
            },
          ],
        },
      ],
    });
    const bytes = await montarPlanilhaDeImpacto(
      exportacao({ abas: [comLacuna] }),
      "17/08/2026 14:32",
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.getWorksheet("CAV Consumo de Combustível")!;
    const linha = linhaDaPlaca(ws, "QYQ6A80");
    const celulaVazia = ws.getCell(linha, 4);
    expect(celulaVazia.value).toBeNull();
    expect((celulaVazia.fill as ExcelJS.FillPattern).pattern).toBe("lightUp");
  });

  it("congela o cabeçalho e as duas colunas que identificam o ativo", () => {
    const ws = lido.getWorksheet("CAV Consumo de Combustível")!;
    const vista = ws.views[0] as {
      state?: string;
      xSplit?: number;
      ySplit?: number;
    };
    expect(vista.state).toBe("frozen");
    // Grupo e placa presas à esquerda, como a coluna de placa na tela.
    expect(vista.xSplit).toBe(2);
    // E o cabeçalho preso no topo, na linha em que ele de fato está.
    expect(vista.ySplit).toBe(linhaDoCabecalho(linhasDaAba(aba())));
    expect(ws.getRow(vista.ySplit!).getCell(2).value).toBe("placa");
  });

  it("acompanha o cabeçalho quando o bloco de texto acima dele cresce", () => {
    // A aba que não é linha econômica ganha uma linha de aviso a mais; um
    // número fixo congelaria o lugar errado justamente nela.
    const comAviso = linhasDaAba(aba({ linhaEconomica: false }));
    expect(linhaDoCabecalho(comAviso)).toBe(
      linhaDoCabecalho(linhasDaAba(aba())) + 1,
    );
    expect(comAviso[linhaDoCabecalho(comAviso) - 1][1].valor).toBe("placa");
  });

  it("formata os números com duas casas, sem repetir a unidade em cada célula", () => {
    const ws = lido.getWorksheet("CAV Consumo de Combustível")!;
    expect(ws.getCell(linhaDaPlaca(ws, "QYQ6A80"), 3).numFmt).toBe("#,##0.00");
  });
});

/** A primeira célula da aba com este valor — a busca que os casos acima fazem. */
function celulaComValor(ws: ExcelJS.Worksheet, valor: string | number): ExcelJS.Cell {
  let achada: ExcelJS.Cell | undefined;
  ws.eachRow((row) =>
    row.eachCell((c) => {
      if (achada === undefined && c.value === valor) achada = c;
    }),
  );
  expect(achada, `nenhuma célula com ${valor}`).toBeDefined();
  return achada!;
}

/** O número da linha em que a placa aparece. */
function linhaDaPlaca(ws: ExcelJS.Worksheet, placa: string): number {
  let numero = 0;
  ws.eachRow((row, i) => {
    if (numero === 0 && row.getCell(2).value === placa) numero = i;
  });
  expect(numero, `placa ${placa} não está na aba`).toBeGreaterThan(0);
  return numero;
}

describe("agoraEmBrasilia", () => {
  it("escreve no fuso de quem lê o arquivo, não em UTC", () => {
    // 17:32Z é 14:32 em Brasília (UTC-3) — o horário que quem confere reconhece.
    expect(agoraEmBrasilia(new Date("2026-08-17T17:32:00Z"))).toBe("17/08/2026, 14:32");
  });
});
