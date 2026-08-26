import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { entityIdentifierTable, validationIssueTable } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type PlanilhaSpec } from "./planilha-sintetica";

/**
 * A resolução de placa e de chassi passou a checar todas as entidades do
 * arquivo numa consulta só, em vez de uma consulta por entidade — o ganho
 * que faz um arquivo de mais de um milhão de fatos promover em segundos, não
 * minutos. O caso que essa troca podia quebrar é o mesmo chassi aparecendo
 * em duas linhas do mesmo arquivo, para duas placas diferentes: a versão
 * antiga, sequencial, via a primeira gravação ao processar a segunda linha;
 * a versão em lote só olha o banco antes de gravar qualquer uma. Sem tratar
 * o lote em si, as duas inserções colidiriam no índice único em vez de
 * produzirem o apontamento de conflito.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("chassiconflito");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o mesmo chassi em duas linhas do mesmo arquivo", () => {
  it("a primeira placa fica com o chassi; a segunda gera um apontamento, não um erro", async () => {
    const CHASSI = "9BWZZZ377VT004251";

    const spec: PlanilhaSpec = {
      vigencia: "EMPURRADA_1_8_2041",
      abas: [
        {
          nome: "cavalos",
          linhas: [
            { placa: "DUP1C11", chassi: CHASSI },
            { placa: "DUP2C22", chassi: CHASSI },
          ],
        },
      ],
    };

    const recebido = await receiveFile(ctx.db, { filePath: escreverPlanilha(spec) });
    await captureRaw(ctx.db, recebido.importRunId);
    await stage(ctx.db, recebido.importRunId);
    const relatorio = await preview(ctx.db, recebido.importRunId);
    const promovido = await promote(ctx.db, recebido.importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });
    expect(promovido.snapshots).toHaveLength(1);

    const identificadores = await ctx.db
      .select()
      .from(entityIdentifierTable)
      .where(eq(entityIdentifierTable.identifierType, "CHASSI"));
    expect(identificadores).toHaveLength(1);
    expect(identificadores[0].identifierValue).toBe(CHASSI);

    const apontamentos = await ctx.db
      .select()
      .from(validationIssueTable)
      .where(
        and(
          eq(validationIssueTable.importRunId, recebido.importRunId),
          eq(validationIssueTable.code, "ENTITY_IDENTIFIER_CONFLICT"),
        ),
      );
    expect(apontamentos).toHaveLength(1);
  });
});
