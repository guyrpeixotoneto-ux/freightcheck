import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { importRunTable, validationIssueTable } from "@workspace/db";
import {
  PromocaoRecusada,
  captureRaw,
  preview,
  promote,
  receiveFile,
  stage,
} from "../index";
import { createTestDatabase, type TestDb } from "../testing";

/**
 * O falso verde da importação vazia — o cenário nº 1 do produto, reproduzido.
 *
 * A origem renomeia uma coluna estrutural ("Vigencia" vira "Quinzena"), o
 * leitor rebaixa a aba a PIVOT sem nenhum ERRO, zero fatos entram, e a
 * importação terminava PREVIEWED → PROMOTED com cara de sucesso. Pior: no
 * balanço de massa a aba PIVOT é DESCARTE, então até o alarme desenhado para
 * pegar sumiço "fechava". Era exatamente o defeito que o produto existe para
 * denunciar na origem, acontecendo dentro dele.
 *
 * O que estas provas fixam:
 * 1. com tipo declarado, aba com linhas rebaixada é ERRO impeditivo nomeado;
 * 2. sem tipo declarado, zero fatos impede a promoção com motivo legível;
 * 3. a promoção recusa um run vazio mesmo que algo o tenha posto em PREVIEWED;
 * 4. o arquivo bom continua passando — a guarda não pega quem não deve.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("falso_verde_vazio");
}, 120_000);

afterAll(async () => {
  await ctx?.drop();
});

function escrever(nomeAba: string, linhas: unknown[][]): string {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(linhas as never),
    nomeAba,
  );
  const destino = path.join(
    mkdtempSync(path.join(tmpdir(), "falso-verde-")),
    `${nomeAba}.xlsx`,
  );
  writeFileSync(destino, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  return destino;
}

/** A planilha do incidente: a coluna Vigencia foi renomeada pela origem. */
const comVigenciaRenomeada = (aba: string) =>
  escrever(aba, [
    ["Quinzena", "Placa", "valorFrota"],
    ["EMPURRADA_1_8_2026", "ABC1D23", 10],
    ["EMPURRADA_1_8_2026", "DEF4E56", 20],
  ]);

async function importar(filePath: string, declaredType?: string) {
  const recebido = await receiveFile(ctx.db, {
    filePath,
    ...(declaredType ? { declaredType } : {}),
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  await preview(ctx.db, recebido.importRunId);
  const [run] = await ctx.db
    .select()
    .from(importRunTable)
    .where(eq(importRunTable.id, recebido.importRunId));
  return run;
}

describe("aba rebaixada com tipo declarado", () => {
  it("é erro impeditivo nomeado, nunca um rodapé", async () => {
    const run = await importar(comVigenciaRenomeada("cavalos_a"), "CAVALO");

    expect(run.status).toBe("VALIDATION_ERROR");
    expect(run.failureReason).toMatch(/coluna estrutural/i);

    const issues = await ctx.db
      .select()
      .from(validationIssueTable)
      .where(eq(validationIssueTable.importRunId, run.id));
    const rebaixada = issues.find(
      (i) => i.code === "ABA_REBAIXADA_COM_TIPO_DECLARADO",
    );
    expect(rebaixada).toBeDefined();
    expect(rebaixada!.severity).toBe("ERROR");
    expect(rebaixada!.message).toContain("cavalos_a");
  });
});

describe("importação sem nenhum fato", () => {
  it("não chega a PREVIEWED: zero fatos é impedimento com motivo", async () => {
    const run = await importar(comVigenciaRenomeada("cavalos_b"));

    expect(run.status).toBe("VALIDATION_ERROR");
    expect(run.failureReason).toMatch(/Nenhuma célula.*virou fato/is);
  });

  it("a promoção recusa o run vazio mesmo se algo o puser em PREVIEWED", async () => {
    const run = await importar(comVigenciaRenomeada("cavalos_c"));
    // O caminho legado: um run vazio que chegou a PREVIEWED antes desta guarda.
    await ctx.db
      .update(importRunTable)
      .set({ status: "PREVIEWED", failureReason: null })
      .where(eq(importRunTable.id, run.id));

    await expect(promote(ctx.db, run.id)).rejects.toThrow(PromocaoRecusada);

    const [depois] = await ctx.db
      .select()
      .from(importRunTable)
      .where(eq(importRunTable.id, run.id));
    expect(depois.status).toBe("VALIDATION_ERROR");
    expect(depois.failureReason).toMatch(/Nada a promover/i);
  });
});

describe("o arquivo bom continua passando", () => {
  it("com a coluna Vigencia no lugar, a importação chega a PREVIEWED", async () => {
    const bom = escrever("cavalos_d", [
      ["Vigencia", "Placa", "valorFrota"],
      ["EMPURRADA_1_8_2026", "ABC1D23", 10],
    ]);
    const run = await importar(bom);
    expect(run.status).toBe("PREVIEWED");
    expect(run.failureReason).toBeNull();
  });
});
