import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { entityIdentifierTable } from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type PlanilhaSpec } from "./planilha-sintetica";

/**
 * A mesma placa pode aparecer em mais de uma aba do mesmo arquivo — cavalo e
 * carreta, por exemplo. A resolução de entidade em lote precisa continuar
 * reconhecendo isso como **uma** entidade, não duas: o primeiro tipo a
 * processar cria o identificador de placa, e o segundo tem de reaproveitá-lo,
 * mesmo quando os dois são novos e resolvidos dentro do mesmo lote (a
 * consulta em lote enxerga o banco antes de qualquer inserção deste arquivo).
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("placaentretipos");
}, 300_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a mesma placa em duas abas de tipos diferentes, ambas novas", () => {
  it("gera uma entidade só, com um identificador de placa só", async () => {
    const PLACA = "SHR1D11";

    const spec: PlanilhaSpec = {
      vigencia: "EMPURRADA_1_8_2042",
      abas: [
        { nome: "cavalos", linhas: [{ placa: PLACA }] },
        { nome: "carretas", linhas: [{ placa: PLACA }] },
      ],
    };

    const recebido = await receiveFile(ctx.db, { filePath: escreverPlanilha(spec) });
    await captureRaw(ctx.db, recebido.importRunId);
    await stage(ctx.db, recebido.importRunId);
    const relatorio = await preview(ctx.db, recebido.importRunId);
    await promote(ctx.db, recebido.importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    const identificadores = await ctx.db
      .select()
      .from(entityIdentifierTable)
      .where(
        and(
          eq(entityIdentifierTable.identifierType, "PLACA"),
          eq(entityIdentifierTable.identifierValue, PLACA),
        ),
      );
    expect(identificadores).toHaveLength(1);
  });
});
