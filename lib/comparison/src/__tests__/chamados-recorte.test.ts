import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attributeTable,
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import {
  getTicketTotals,
  getTicketVigencias,
  getTicketsByParameter,
  listTicketChanges,
  rotulosNaJanela,
} from "../chamados";

/**
 * O recorte De/Até na aba Chamados.
 *
 * A aba nasceu sem recorte nenhum, e a razão escrita era boa: chamado não tem
 * unidade nem canal em lugar nenhum deste produto, e recortá-lo por um contexto
 * escolhido por padrão seria filtrar por algo que ninguém pediu.
 *
 * O que faltava perceber é que existe um eixo temporal que **o próprio chamado
 * declara**: a coluna `Vig. Abertura`, gravada em `ticket.vigencia_label`, que é
 * a mesma string de `snapshot.source_label` — a igualdade que a importação já
 * usa para achar o valor anterior de um parâmetro. É esse eixo que este arquivo
 * prova, e são três contratos:
 *
 * 1. **O eixo sai do envio**, e as datas saem dos rótulos pelo mesmo parser da
 *    importação. Nada é inventado, e nada vem de um contexto de vigências.
 * 2. **O recorte alcança os cartões, e não só a lista.** Ele não é um filtro de
 *    linha: é de que período a aba está falando. Um cartão dizendo 1.218 ao lado
 *    de um seletor dizendo "3 de 9 vigências" seriam dois números certos e uma
 *    leitura errada.
 * 3. **O que não tem vigência legível fica fora, e é contado.** Some da lista
 *    por construção — não há onde pô-lo num eixo de vigências —, e some em
 *    silêncio se ninguém disser quantos são.
 */

let ctx: TestDb;
let envioId: string;

/** `EMPURRADA_1_1_2026` → 01/01/2026, pelo mesmo parser da importação. */
const JAN = "2026-01-01";
const FEV = "2026-02-01";
const MAR = "2026-03-01";

beforeAll(async () => {
  ctx = await createTestDatabase("chamados_recorte");

  const [envio] = await ctx.db
    .insert(ticketImportTable)
    .values({
      filename: "chamados.xlsx",
      contentSha256: "sha-do-recorte",
      byteSize: 1,
      status: "READ",
      rowCount: 5,
      ticketCount: 5,
    })
    .returning();
  envioId = envio.id;

  /*
    Cinco chamados, e cada um existe por um motivo:

    - janeiro e março dão as pontas do eixo;
    - os **dois** de fevereiro escrevem o mesmo dia de duas formas —
      `EMPURRADA_1_2_2026` e `EMPURRADA_01_2_2026` —, que é a armadilha do eixo:
      ele é de datas e a fonte escreve rótulos, e um recorte que guardasse um
      rótulo por data deixaria o outro de fora sem dizer nada;
    - o último não declara vigência, e é o que mede o que nenhum recorte alcança.
  */
  const [jan, fevA, fevB, mar, sem] = await ctx.db
    .insert(ticketTable)
    .values([
      {
        ticketImportId: envioId,
        externalId: "CH-JAN",
        vigenciaLabel: "EMPURRADA_1_1_2026",
        statusBucket: "ATENDIDO",
        sourceRowIndex: 1,
        changedParameterCount: 2,
      },
      {
        ticketImportId: envioId,
        externalId: "CH-FEV-A",
        vigenciaLabel: "EMPURRADA_1_2_2026",
        statusBucket: "ATENDIDO",
        sourceRowIndex: 2,
        changedParameterCount: 1,
      },
      {
        ticketImportId: envioId,
        externalId: "CH-FEV-B",
        vigenciaLabel: "EMPURRADA_01_2_2026",
        statusBucket: "RECUSADO",
        sourceRowIndex: 3,
        changedParameterCount: 1,
      },
      {
        ticketImportId: envioId,
        externalId: "CH-MAR",
        vigenciaLabel: "EMPURRADA_1_3_2026",
        statusBucket: "ATENDIDO",
        sourceRowIndex: 4,
        changedParameterCount: 1,
      },
      {
        ticketImportId: envioId,
        externalId: "CH-SEM",
        vigenciaLabel: null,
        statusBucket: "ABERTO",
        sourceRowIndex: 5,
        changedParameterCount: 1,
      },
    ])
    .returning();

  /*
    A régua financeira dos chamados é a mesma da Planilha (`viraDinheiro`):
    para o impacto entrar num balde, o parâmetro precisa de uma semântica
    confirmada, monetária e somável — e de periodicidade, que dá o balde.
    Os dois códigos abaixo existem para isso; o que não tiver código na régua
    conta em `foraDaRegua`, nunca na soma.
  */
  await ctx.db.insert(attributeTable).values([
    {
      code: "cavalo.frete_peso",
      sourceName: "Frete peso",
      entityType: "CAVALO",
      dataType: "NUMBER",
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      semanticsStatus: "CONFIRMED",
      isMonetary: true,
      confirmedBy: "teste",
      confirmedAt: new Date(),
    },
    {
      code: "cavalo.pedagio",
      sourceName: "Pedágio",
      entityType: "CAVALO",
      dataType: "NUMBER",
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      semanticsStatus: "CONFIRMED",
      isMonetary: true,
      confirmedBy: "teste",
      confirmedAt: new Date(),
    },
  ]);

  const alteracao = (
    ticketId: string,
    parameterLabel: string,
    coluna: number,
    impacto: string | null,
    attributeCode: string | null = parameterLabel === "Pedágio"
      ? "cavalo.pedagio"
      : "cavalo.frete_peso",
  ) => ({
    ticketId,
    ticketImportId: envioId,
    parameterLabel,
    attributeCode,
    sourceColumnIndex: coluna,
    changeKind: "SET",
    beforeSource: "ARQUIVO",
    deltaAbsolute: impacto,
    impactAmount: impacto,
    impactConfidence: impacto === null ? "NOT_CALCULABLE" : "CALCULATED",
  });

  await ctx.db.insert(ticketChangeTable).values([
    alteracao(jan.id, "Frete peso", 0, "10"),
    alteracao(jan.id, "Pedágio", 1, "20"),
    alteracao(fevA.id, "Frete peso", 0, "100"),
    alteracao(fevB.id, "Frete peso", 0, "200"),
    alteracao(mar.id, "Frete peso", 0, "1000"),
    alteracao(sem.id, "Frete peso", 0, "7"),
  ]);
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

const rotulos = async (de?: string, ate?: string) =>
  rotulosNaJanela(await getTicketVigencias(ctx.db, envioId), { de, ate });

describe("o eixo sai do que o chamado declara", () => {
  it("deriva as datas dos rótulos, em ordem, sem contexto nenhum", async () => {
    const eixo = await getTicketVigencias(ctx.db, envioId);
    expect(eixo.disponiveis).toEqual([JAN, FEV, MAR]);
  });

  it("guarda todas as grafias de um mesmo dia, e não só a primeira", async () => {
    const eixo = await getTicketVigencias(ctx.db, envioId);
    // O eixo é de datas; a fonte escreve rótulos. Guardar um por data faria o
    // recorte de fevereiro perder metade dos chamados de fevereiro.
    expect(eixo.rotulos[FEV]).toEqual(["EMPURRADA_01_2_2026", "EMPURRADA_1_2_2026"]);
  });

  it("conta o que não tem vigência legível em vez de deixá-lo sumir", async () => {
    const eixo = await getTicketVigencias(ctx.db, envioId);
    expect(eixo.semVigencia).toBe(1);
  });
});

describe("o recorte, traduzido para os rótulos que ele cobre", () => {
  it("sem pedido, é null — e null é o envio inteiro", async () => {
    expect(await rotulos(undefined, undefined)).toBeNull();
  });

  it("meia janela é completada com o extremo do eixo", async () => {
    expect(await rotulos(FEV, undefined)).toEqual([
      "EMPURRADA_01_2_2026",
      "EMPURRADA_1_2_2026",
      "EMPURRADA_1_3_2026",
    ]);
    expect(await rotulos(undefined, JAN)).toEqual(["EMPURRADA_1_1_2026"]);
  });

  it("uma ponta que este envio não tem recorta o que houver entre as duas", async () => {
    // Não é aparada para a vigência mais próxima: aparar em silêncio faria a
    // aba responder por outro período com o título do pedido.
    expect(await rotulos("2026-02-15", "2026-02-20")).toEqual([]);
  });
});

describe("o recorte alcança a lista", () => {
  it("traz só as alterações dos chamados daquelas vigências", async () => {
    const { total, rows } = await listTicketChanges(ctx.db, envioId, {
      vigenciaLabels: await rotulos(FEV, FEV),
    });
    // As duas grafias de fevereiro entram, e nenhuma outra vigência.
    expect(total).toBe(2);
    expect(rows.map((r) => r.externalId).sort()).toEqual(["CH-FEV-A", "CH-FEV-B"]);
  });

  it("um recorte que não alcança nada devolve nada, e não tudo", async () => {
    // A distinção que este teste guarda: `null` é "sem recorte" e `[]` é "um
    // recorte que nenhuma vigência atende". Confundi-los faria a aba mostrar o
    // envio inteiro debaixo do título de um recorte.
    const { total } = await listTicketChanges(ctx.db, envioId, {
      vigenciaLabels: await rotulos("2026-02-15", "2026-02-20"),
    });
    expect(total).toBe(0);
  });

  it("o recorte se combina com os filtros de linha em vez de substituí-los", async () => {
    const { total } = await listTicketChanges(ctx.db, envioId, {
      vigenciaLabels: await rotulos(JAN, FEV),
      statusBucket: "ATENDIDO",
    });
    // CH-JAN traz duas alterações e CH-FEV-A uma; CH-FEV-B foi recusado.
    expect(total).toBe(3);
  });
});

describe("o recorte alcança os cartões, e não só a lista", () => {
  it("os totais respondem pelo mesmo período que a lista", async () => {
    const labels = await rotulos(JAN, FEV);
    const totais = await getTicketTotals(ctx.db, envioId, labels);
    const { total } = await listTicketChanges(ctx.db, envioId, {
      vigenciaLabels: labels,
    });

    expect(totais.changes).toBe(total);
    expect(totais.changes).toBe(4);
    expect(totais.tickets).toBe(3);
    // 10 + 20 + 100 + 200 — e o milhar de março fica fora. Na régua: os dois
    // parâmetros são mensais e confirmados, então o balde é um só.
    expect(totais.impacto.porPeriodicidade).toEqual({ MENSAL: 330 });
    expect(totais.impacto.foraDaRegua).toBe(0);
  });

  it("cada contagem continua prometendo o que o filtro entrega, dentro do recorte", async () => {
    const labels = await rotulos(JAN, FEV);
    const totais = await getTicketTotals(ctx.db, envioId, labels);

    for (const { statusBucket, count } of totais.byStatus) {
      const { total } = await listTicketChanges(ctx.db, envioId, {
        vigenciaLabels: labels,
        statusBucket,
      });
      expect(total, `situação ${statusBucket}`).toBe(count);
    }
  });

  it("os parâmetros mais pedidos são os do recorte", async () => {
    const porParametro = await getTicketsByParameter(
      ctx.db,
      envioId,
      await rotulos(MAR, MAR),
    );
    expect(porParametro).toEqual([
      {
        parameterLabel: "Frete peso",
        attributeCode: "cavalo.frete_peso",
        count: 1,
        impactSum: 1000,
      },
    ]);
  });

  it("sem recorte, tudo continua respondendo pelo envio inteiro", async () => {
    const totais = await getTicketTotals(ctx.db, envioId);
    // As seis alterações, inclusive a do chamado sem vigência declarada.
    expect(totais.changes).toBe(6);
    expect(totais.tickets).toBe(5);
  });
});

describe("o que nenhum recorte alcança", () => {
  it("o chamado sem vigência fica fora de qualquer intervalo", async () => {
    const doEixoInteiro = await listTicketChanges(ctx.db, envioId, {
      vigenciaLabels: await rotulos(JAN, MAR),
    });
    // Cinco das seis: a do chamado sem vigência não está em ponta nenhuma do
    // eixo, e por isso não entra nem no recorte mais largo possível.
    expect(doEixoInteiro.total).toBe(5);

    const semRecorte = await listTicketChanges(ctx.db, envioId, {});
    expect(semRecorte.total).toBe(6);

    // A diferença é exatamente o número que a aba escreve na tela.
    const eixo = await getTicketVigencias(ctx.db, envioId);
    expect(semRecorte.total - doEixoInteiro.total).toBe(eixo.semVigencia);
  });
});
