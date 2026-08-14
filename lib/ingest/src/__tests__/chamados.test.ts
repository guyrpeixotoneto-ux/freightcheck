import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeTicketImpact,
  normalizeStatus,
  parseTicketDate,
  parseTicketNumber,
  planTicketColumns,
  readTicketWorkbook,
} from "../chamados";

/** Um CSV em disco, para exercitar o leitor sem depender de um .xlsx binário. */
function csvTemporario(conteudo: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "chamados-test-"));
  const arquivo = path.join(dir, "chamados.csv");
  writeFileSync(arquivo, conteudo, "utf8");
  return arquivo;
}

/**
 * A leitura de um export de chamados, sem banco nenhum.
 *
 * O que se testa aqui é o único lugar deste caminho onde há julgamento: qual
 * coluna é qual campo, o que é número e o que é texto que *parece* número, e
 * quando um impacto pode ser afirmado. As três decisões são as que, se
 * erradas, produzem um número errado com cara de certo — que é o defeito que
 * este produto existe para não cometer.
 */

describe("planTicketColumns", () => {
  it("liga cada campo à coluna de nome exato antes de tentar aproximação", () => {
    const plan = planTicketColumns([
      "Chamado",
      "Data de abertura",
      "Status",
      "Parâmetro",
      "Valor pedido",
      "Valor aplicado",
    ]);
    expect(plan.bindings.externalId?.header).toBe("Chamado");
    expect(plan.bindings.externalId?.match).toBe("exato");
    expect(plan.bindings.openedAt?.header).toBe("Data de abertura");
    expect(plan.bindings.requestedValueRaw?.header).toBe("Valor pedido");
    expect(plan.bindings.appliedValueRaw?.header).toBe("Valor aplicado");
    expect(plan.unmapped).toEqual([]);
  });

  it("não deixa dois campos disputarem a mesma coluna", () => {
    // Sem a reserva, "Valor pedido pelo transportador" casaria por aproximação
    // com `requestedValueRaw` e com `appliedValueRaw` (que aceita "atendido"),
    // e o segundo campo apontaria para a coluna do primeiro.
    const plan = planTicketColumns([
      "Nº do chamado",
      "Valor pedido pelo transportador",
      "Valor aplicado na vigência",
    ]);
    const usados = Object.values(plan.bindings).map((b) => b.index);
    expect(new Set(usados).size).toBe(usados.length);
    expect(plan.bindings.requestedValueRaw?.header).toBe(
      "Valor pedido pelo transportador",
    );
    expect(plan.bindings.appliedValueRaw?.header).toBe(
      "Valor aplicado na vigência",
    );
  });

  it("prefere o alias mais específico quando dois casam por aproximação", () => {
    const plan = planTicketColumns(["Protocolo", "Valor aplicado (R$)"]);
    expect(plan.bindings.appliedValueRaw?.header).toBe("Valor aplicado (R$)");
    expect(plan.bindings.appliedValueRaw?.reason).toContain("valor aplicado");
  });

  it("reconhece o cabeçalho mais comum de todos: Nº do chamado", () => {
    // O indicador ordinal não é letra acentuada e sobrevive à decomposição:
    // sem tratá-lo, a coluna que mais aparece em export brasileiro seria a
    // única que nenhum nome conhecido casa.
    for (const escrita of ["Nº do chamado", "N° do chamado", "N. do chamado"]) {
      const plan = planTicketColumns([escrita, "Status"]);
      expect(plan.bindings.externalId?.header).toBe(escrita);
      expect(plan.bindings.externalId?.match).toBe("exato");
    }
  });

  it("lista o que não reconheceu em vez de deixá-lo sumir", () => {
    const plan = planTicketColumns(["Chamado", "Centro de custo", "SLA restante"]);
    expect(plan.unmapped).toEqual(["Centro de custo", "SLA restante"]);
  });

  it("escreve por que ligou cada coluna", () => {
    const plan = planTicketColumns(["Chamado", "Data de abertura do chamado"]);
    expect(plan.bindings.openedAt?.match).toBe("aproximado");
    expect(plan.bindings.openedAt?.reason).toContain("contém");
  });
});

describe("readTicketWorkbook", () => {
  it("lê um CSV — a fila do Freightech exporta nesse formato", () => {
    const arquivo = csvTemporario(
      [
        "Chamado,Status,Valor pedido",
        "CH-1,Concluído,1000",
        "CH-2,Aberto,250",
      ].join("\n"),
    );
    const sheet = readTicketWorkbook(arquivo);
    expect(sheet.headers).toEqual(["Chamado", "Status", "Valor pedido"]);
    expect(sheet.rows).toHaveLength(2);
    // A linha física é 1-based e conta o cabeçalho, como uma pessoa contaria.
    expect(sheet.rows[0].rowIndex).toBe(2);
  });

  it("não toma o título do relatório por cabeçalho", () => {
    // O título contém "chamados", e uma busca que aceitasse a primeira linha a
    // mencioná-lo pararia nele: o arquivo inteiro viraria dado sob nomes de
    // coluna que não existem. Uma coluna só nunca é cabeçalho.
    const arquivo = csvTemporario(
      [
        "Relatório de chamados — Freightech",
        "Extraído em 14/08/2026",
        "",
        "Nº do chamado,Status",
        "CH-9,Aberto",
      ].join("\n"),
    );
    const sheet = readTicketWorkbook(arquivo);
    expect(sheet.headers).toEqual(["Nº do chamado", "Status"]);
    expect(sheet.rows).toHaveLength(1);
    // A linha física conta as linhas puladas: o que a tela mostra como
    // "linha N do arquivo" precisa bater com o que se vê ao abri-lo.
    expect(sheet.rows[0].rowIndex).toBe(5);
  });

  it("preserva os acentos de um CSV em UTF-8", () => {
    // Entregue como bytes, o leitor adivinha a codificação e "Parâmetro" chega
    // como "ParÃ¢metro" — e aí a coluna deixa de ser reconhecida.
    const arquivo = csvTemporario("Nº do chamado,Parâmetro\nCH-1,Pedágio");
    const sheet = readTicketWorkbook(arquivo);
    expect(sheet.headers).toEqual(["Nº do chamado", "Parâmetro"]);
    expect(sheet.rows[0].cells[1]).toBe("Pedágio");
  });

  it("não deixa o leitor adivinhar data nem número num CSV", () => {
    /*
      Os dois defeitos que este caso trava, ambos produzindo número errado com
      cara de certo:

      - `01/07/2026` é 1º de julho, e o leitor o converteria para 7 de janeiro
        — enquanto deixaria `20/07/2026` como texto, porque 20 não pode ser
        mês. Metade das datas de um mesmo arquivo trocaria dia por mês.
      - `1.500,50` é mil e quinhentos, e o leitor o lê como um e meio.

      O texto tem de chegar como texto; quem o interpreta é `parseTicketDate` e
      `parseTicketNumber`, que sabem em que país estamos.
    */
    const arquivo = csvTemporario(
      [
        "Nº do chamado,Data de abertura,Valor pedido",
        'CH-1,01/07/2026,"1.500,50"',
      ].join("\n"),
    );
    const sheet = readTicketWorkbook(arquivo);
    expect(sheet.rows[0].cells[1]).toBe("01/07/2026");
    expect(parseTicketDate(sheet.rows[0].cells[1])?.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(parseTicketNumber(sheet.rows[0].cells[2])).toBe(1500.5);
  });

  it("recusa com uma frase útil quando não há coluna de chamado", () => {
    const arquivo = csvTemporario("Placa,Valor\nQYP3G72,100");
    expect(() => readTicketWorkbook(arquivo)).toThrow(
      /coluna do número do chamado/,
    );
  });
});

describe("parseTicketNumber", () => {
  it("lê dinheiro escrito à brasileira", () => {
    expect(parseTicketNumber("R$ 1.234,56")).toBe(1234.56);
    expect(parseTicketNumber("1.234,56")).toBe(1234.56);
    expect(parseTicketNumber("0,5")).toBe(0.5);
  });

  it("lê a forma americana quando os dois separadores aparecem", () => {
    expect(parseTicketNumber("1,234.56")).toBe(1234.56);
    expect(parseTicketNumber("1,234,567.89")).toBe(1234567.89);
  });

  it("trata ponto seguido de três dígitos como milhar", () => {
    // Numa fonte brasileira "1.234" é mil duzentos e trinta e quatro, não um
    // inteiro com três decimais.
    expect(parseTicketNumber("1.234")).toBe(1234);
    expect(parseTicketNumber("12.50")).toBe(12.5);
  });

  it("entende parênteses e sinal como negativo", () => {
    expect(parseTicketNumber("(120,00)")).toBe(-120);
    expect(parseTicketNumber("-42,5")).toBe(-42.5);
  });

  it("recusa o que não é inequivocamente número", () => {
    // O defeito que isto evita: "sob análise" virando 0 e entrando numa soma.
    expect(parseTicketNumber("sob análise")).toBeNull();
    expect(parseTicketNumber("a definir")).toBeNull();
    expect(parseTicketNumber("")).toBeNull();
    expect(parseTicketNumber(null)).toBeNull();
    expect(parseTicketNumber("12 unidades")).toBeNull();
  });

  it("aceita número que já veio número da planilha", () => {
    expect(parseTicketNumber(1234.56)).toBe(1234.56);
    expect(parseTicketNumber(Number.NaN)).toBeNull();
  });
});

describe("parseTicketDate", () => {
  it("lê o formato brasileiro, com e sem hora", () => {
    expect(parseTicketDate("15/03/2026")?.toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
    expect(parseTicketDate("15/03/2026 14:30")?.toISOString()).toBe(
      "2026-03-15T14:30:00.000Z",
    );
  });

  it("lê ISO", () => {
    expect(parseTicketDate("2026-03-15")?.toISOString()).toBe(
      "2026-03-15T00:00:00.000Z",
    );
  });

  it("devolve null para o que não é data — nunca a data de hoje", () => {
    expect(parseTicketDate("em aberto")).toBeNull();
    expect(parseTicketDate("")).toBeNull();
    expect(parseTicketDate(null)).toBeNull();
  });
});

describe("normalizeStatus", () => {
  it("agrupa as escritas usuais de cada caixa", () => {
    expect(normalizeStatus("Aberto")).toBe("ABERTO");
    expect(normalizeStatus("Em atendimento")).toBe("EM_ANDAMENTO");
    expect(normalizeStatus("Concluído")).toBe("ATENDIDO");
    expect(normalizeStatus("Rejeitado")).toBe("RECUSADO");
    expect(normalizeStatus("Cancelado")).toBe("CANCELADO");
  });

  it("decide a negação antes da palavra que ela nega", () => {
    // "Não atendido" contém "atendido"; sem a ordem certa viraria o oposto.
    expect(normalizeStatus("Não atendido")).toBe("RECUSADO");
    expect(normalizeStatus("Nao aprovado")).toBe("RECUSADO");
  });

  it("não inventa caixa para o que não reconhece", () => {
    expect(normalizeStatus("Etapa 7")).toBe("DESCONHECIDO");
    expect(normalizeStatus(null)).toBe("DESCONHECIDO");
    expect(normalizeStatus("")).toBe("DESCONHECIDO");
  });
});

describe("computeTicketImpact", () => {
  it("apura aplicado menos pedido quando o chamado já foi atendido", () => {
    const impacto = computeTicketImpact(1000, 800, "ATENDIDO", "1000", "800");
    expect(impacto.confidence).toBe("CALCULATED");
    expect(impacto.amount).toBe(-200);
  });

  it("segura o número enquanto o chamado não fechou", () => {
    // Um valor aplicado provisório é um número que muda sozinho na tela, o que
    // é pior do que não ter número.
    const impacto = computeTicketImpact(1000, 800, "EM_ANDAMENTO", "1000", "800");
    expect(impacto.confidence).toBe("NOT_CALCULABLE");
    expect(impacto.amount).toBeNull();
    expect(impacto.reason).toMatch(/ainda não foi atendido/);
  });

  it("diz qual dos dois valores faltou, e não só que faltou", () => {
    expect(
      computeTicketImpact(null, 800, "ATENDIDO", null, "800").reason,
    ).toMatch(/não trouxe valor pedido/);
    expect(
      computeTicketImpact(1000, null, "ATENDIDO", "1000", null).reason,
    ).toMatch(/não trouxe valor aplicado/);
  });

  it("cita o texto quando o valor existia mas não era número", () => {
    const impacto = computeTicketImpact(
      1000,
      null,
      "ATENDIDO",
      "1000",
      "sob análise",
    );
    expect(impacto.confidence).toBe("NOT_CALCULABLE");
    expect(impacto.reason).toContain("sob análise");
  });

  it("apura zero como zero — atendido pelo que se pediu é um fato", () => {
    const impacto = computeTicketImpact(500, 500, "ATENDIDO", "500", "500");
    expect(impacto.confidence).toBe("CALCULATED");
    expect(impacto.amount).toBe(0);
  });
});
