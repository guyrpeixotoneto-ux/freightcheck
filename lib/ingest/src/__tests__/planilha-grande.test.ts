import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  factTable,
  importRunTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
} from "@workspace/db";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type LinhaSpec } from "./planilha-sintetica";

/**
 * A planilha que não cabe num INSERT escrito valor a valor.
 *
 * O caminho de escrita em massa — uma array por coluna, `unnest` montando as
 * linhas no banco — só entra acima de um piso de linhas, e é ele que decide o
 * tempo do "Lendo o arquivo…" de um export de verdade: 14 mil linhas por dez
 * colunas são 140 mil células. As outras suítes exercitam planilhas pequenas,
 * que passam pelo caminho normal do drizzle; sem este arquivo, o caminho que
 * roda em produção seria o único sem prova.
 *
 * O que se afirma aqui não é velocidade — isso o perfil mede, e não um teste —,
 * é que **nada se perde**: as mesmas linhas, as mesmas células, os mesmos
 * fatos, com a mesma identidade de sempre.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("planilha_grande");
}, 120_000);

afterAll(async () => {
  await ctx.drop();
});

/** Placas distintas e válidas, sem depender de sorteio. */
function placa(i: number): string {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const l = (n: number) => letras[n % 26];
  return `${l(i)}${l(Math.floor(i / 26))}${l(Math.floor(i / 676))}${i % 10}${l(Math.floor(i / 7))}${String(i % 100).padStart(2, "0")}`;
}

/** Acima do piso do caminho em massa, e pequena o bastante para rodar sempre. */
const LINHAS = 600;

describe("uma planilha grande entra inteira", () => {
  it("grava todas as linhas, todas as células e todos os fatos", async () => {
    const linhas: LinhaSpec[] = Array.from({ length: LINHAS }, (_, i) => ({
      placa: placa(i),
      valores: { "Custo Fixo": 1000 + i, "Custo Variavel": 2000 + i },
    }));

    const caminho = escreverPlanilha({
      vigencia: "EMPURRADA_9_9_2031",
      abas: [{ nome: "cavalos", linhas }],
    });

    const recebido = await receiveFile(ctx.db, { filePath: caminho });
    const capturado = await captureRaw(ctx.db, recebido.importRunId);

    // Cabeçalho mais uma linha por equipamento; a planilha sintética escreve
    // seis colunas de escopo, duas de identidade e duas de fato.
    expect(capturado.rows).toBe(LINHAS + 1);
    expect(capturado.cells).toBe((LINHAS + 1) * 10);

    const [{ sheetId }] = await ctx.db
      .select({ sheetId: rawSheetTable.id })
      .from(rawSheetTable)
      .where(eq(rawSheetTable.importRunId, recebido.importRunId));

    const gravadas = await ctx.db
      .select({ id: rawCellTable.id, valor: rawCellTable.rawValue })
      .from(rawCellTable)
      .innerJoin(rawRowTable, eq(rawCellTable.rawRowId, rawRowTable.id))
      .where(eq(rawRowTable.rawSheetId, sheetId));
    expect(gravadas).toHaveLength((LINHAS + 1) * 10);

    // O valor da última linha chegou como está no arquivo: a array não
    // embaralhou a ordem nem trocou linha por linha.
    expect(gravadas.map((c) => c.valor)).toContain(String(1000 + LINHAS - 1));

    // Oito fatos por linha: das dez colunas, a vigência e a placa são o grão,
    // e as outras oito viram valor — inclusive as de escopo, que descrevem o
    // equipamento tanto quanto o custo.
    const FATOS_POR_LINHA = 8;

    const estagiado = await stage(ctx.db, recebido.importRunId);
    expect(estagiado.stagedFacts).toBe(LINHAS * FATOS_POR_LINHA);
    expect(estagiado.rowsRejected).toBe(0);
    expect(estagiado.chavesEmQuarentena).toBe(0);

    const relatorio = await preview(ctx.db, recebido.importRunId);
    await promote(ctx.db, recebido.importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    const [run] = await ctx.db
      .select()
      .from(importRunTable)
      .where(eq(importRunTable.id, recebido.importRunId));
    expect(run.status).toBe("PROMOTED");

    // Esta base é só deste arquivo de teste, e este é o único import dela: o
    // total da tabela é o total desta importação.
    const fatos = await ctx.db.select({ id: factTable.id }).from(factTable);
    expect(fatos).toHaveLength(LINHAS * FATOS_POR_LINHA);
  }, 180_000);
});
