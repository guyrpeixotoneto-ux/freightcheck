import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ticketChangeTable,
  ticketImportTable,
  ticketTable,
} from "@workspace/db";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { getTicketTotals, listTicketChanges } from "../chamados";

/**
 * Os números que a tela põe ao lado de cada chip de filtro.
 *
 * Um número ao lado de um filtro não é decoração: é a promessa "é isto que
 * sobra se eu clicar". O contrato que este arquivo prova é que a promessa se
 * cumpre — cada contagem de `getTicketTotals` bate com o `total` que
 * `listTicketChanges` devolve ao aplicar aquele mesmo recorte.
 *
 * O grão é a armadilha. `ticket` e `ticket_change` são tabelas diferentes, e um
 * chamado que mexeu em três parâmetros é uma linha numa e três na outra. Contar
 * do lado errado dá um número que existe, parece certo e responde outra
 * pergunta — o pior tipo de número, porque nada na tela o denuncia.
 */

let ctx: TestDb;
let envioId: string;

beforeAll(async () => {
  ctx = await createTestDatabase("chamados_totais");

  const [envio] = await ctx.db
    .insert(ticketImportTable)
    .values({
      filename: "chamados.xlsx",
      contentSha256: "sha-de-teste",
      byteSize: 1,
      status: "READ",
      rowCount: 2,
      ticketCount: 2,
    })
    .returning();
  envioId = envio.id;

  // Dois chamados com número de parâmetros diferente de propósito: é essa
  // assimetria que separa "contar chamados" de "contar alterações".
  const [atendido, recusado] = await ctx.db
    .insert(ticketTable)
    .values([
      {
        ticketImportId: envioId,
        externalId: "CH-1",
        statusBucket: "ATENDIDO",
        sourceRowIndex: 1,
        changedParameterCount: 3,
      },
      {
        ticketImportId: envioId,
        externalId: "CH-2",
        statusBucket: "RECUSADO",
        sourceRowIndex: 2,
        changedParameterCount: 1,
      },
    ])
    .returning();

  await ctx.db.insert(ticketChangeTable).values([
    {
      ticketId: atendido.id,
      ticketImportId: envioId,
      parameterLabel: "Frete peso",
      sourceColumnIndex: 0,
      changeKind: "SET",
      beforeSource: "ARQUIVO",
      deltaAbsolute: "10",
      impactAmount: "10",
      impactConfidence: "CALCULATED",
    },
    {
      ticketId: atendido.id,
      ticketImportId: envioId,
      parameterLabel: "Pedágio",
      sourceColumnIndex: 1,
      changeKind: "SET",
      beforeSource: "VIGENCIA",
      deltaAbsolute: "-5",
    },
    {
      ticketId: atendido.id,
      ticketImportId: envioId,
      parameterLabel: "Ajudante",
      sourceColumnIndex: 2,
      changeKind: "FORM_THIS",
      beforeSource: "AUSENTE",
    },
    {
      ticketId: recusado.id,
      ticketImportId: envioId,
      parameterLabel: "Frete peso",
      sourceColumnIndex: 0,
      changeKind: "SET",
      beforeSource: "ARQUIVO",
      deltaAbsolute: "2",
    },
  ]);
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

const contarPor = <T extends { count: number }>(
  linhas: T[],
  achar: (linha: T) => boolean,
) => linhas.find(achar)?.count;

describe("getTicketTotals", () => {
  it("conta alterações por situação, e não chamados por situação", async () => {
    const totais = await getTicketTotals(ctx.db, envioId);
    // Um chamado atendido que mexeu em três parâmetros vale 3 aqui, não 1.
    expect(contarPor(totais.byStatus, (s) => s.statusBucket === "ATENDIDO")).toBe(
      3,
    );
    expect(contarPor(totais.byStatus, (s) => s.statusBucket === "RECUSADO")).toBe(
      1,
    );
  });

  it("cada contagem promete o que o filtro entrega", async () => {
    const totais = await getTicketTotals(ctx.db, envioId);

    for (const { statusBucket, count } of totais.byStatus) {
      const { total } = await listTicketChanges(ctx.db, envioId, {
        statusBucket,
      });
      expect(total, `situação ${statusBucket}`).toBe(count);
    }

    for (const { beforeSource, count } of totais.byBeforeSource) {
      const { total } = await listTicketChanges(ctx.db, envioId, {
        beforeSource,
      });
      expect(total, `valor anterior ${beforeSource}`).toBe(count);
    }

    for (const { changeKind, count } of totais.byChangeKind) {
      if (changeKind === null) continue;
      const { total } = await listTicketChanges(ctx.db, envioId, { changeKind });
      expect(total, `tipo ${changeKind}`).toBe(count);
    }
  });

  it("os três agrupamentos fecham com o mesmo total", async () => {
    const totais = await getTicketTotals(ctx.db, envioId);
    const soma = (linhas: { count: number }[]) =>
      linhas.reduce((total, linha) => total + linha.count, 0);

    expect(totais.changes).toBe(4);
    expect(soma(totais.byStatus)).toBe(4);
    expect(soma(totais.byBeforeSource)).toBe(4);
    expect(soma(totais.byChangeKind)).toBe(4);
    expect(totais.calculated + totais.notCalculable).toBe(4);
  });

  it("chamado continua sendo chamado onde a pergunta é sobre chamados", async () => {
    // `tickets` e `stillOpen` alimentam cartões, não chips: ali a unidade é o
    // chamado, e mudá-la para acompanhar `byStatus` seria trocar um erro por
    // outro.
    const totais = await getTicketTotals(ctx.db, envioId);
    expect(totais.tickets).toBe(2);
  });

  it("o corte de materialidade mede a variação, e não o impacto", async () => {
    // `minAbsImpact` compara com `abs(delta_absolute)`: a linha de -5 entra num
    // corte de 5, e a de 2 fica fora. É por isso que o rótulo da tela diz
    // "variação mínima" e não fala em reais.
    const { total } = await listTicketChanges(ctx.db, envioId, {
      minAbsImpact: 5,
    });
    expect(total).toBe(2);
  });
});
