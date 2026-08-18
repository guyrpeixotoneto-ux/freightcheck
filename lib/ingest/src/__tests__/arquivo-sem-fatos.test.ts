import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createTestDatabase, type TestDb } from "../testing";
import {
  captureRaw,
  preview,
  promote,
  PromocaoRecusada,
  receiveFile,
  stage,
} from "../pipeline";

/**
 * O falso positivo: a importação verde que não importou nada.
 *
 * O caso real que produziu este arquivo foi uma planilha de trecho. Ela foi
 * enviada, lida, conferida e aprovada — selo verde, SHA-256, hora, autor — e
 * nada tinha entrado: a aba não traz `Placa`, o leitor a classificou como
 * derivada, a staging não produziu fato nenhum, e a promoção percorreu uma
 * lista vazia de vigências sem reclamar. As telas seguintes ficaram vazias sem
 * que nada, em lugar nenhum, dissesse por quê.
 *
 * O fixture é escrito aqui em vez de sair de `planilha-sintetica.ts` porque
 * aquele módulo garante o grão — placa e vigência em toda linha —, e o que
 * precisa ser exercitado é justamente a aba que **não** o tem. As colunas são
 * as do dicionário de trecho do Freightec (`docs/planilha-atributos-frete-dre.xlsx`),
 * e não colunas inventadas: o objetivo é reproduzir o arquivo que o cliente
 * manda de verdade.
 */

let ctx: TestDb;

function escreverPlanilha(nomeDaAba: string, linhas: unknown[][]): string {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nomeDaAba);
  const destino = path.join(
    mkdtempSync(path.join(tmpdir(), "sem-fatos-")),
    `${nomeDaAba}.xlsx`,
  );
  XLSX.writeFile(wb, destino);
  return destino;
}

/**
 * Uma planilha de trecho como o Freightec a entrega: sem placa.
 *
 * O `variante` muda o conteúdo, e não o nome: o pipeline recusa arquivo
 * repetido pelo SHA-256 do conteúdo, então dois casos deste arquivo que
 * enviassem os mesmos bytes exercitariam a recusa de duplicata em vez da que
 * está sendo testada.
 */
function planilhaDeTrecho(variante = "A"): string {
  return escreverPlanilha("Trecho", [
    ["Vigencia", "chaveTrecho", "Origem", "Destino", "kmIda", "kmVolta"],
    ["EMPURRADA_1_8_2026", `CAM-SSA-001-${variante}`, "Camaçari", "Salvador", 62, 62],
    ["EMPURRADA_1_8_2026", `CAM-FSA-002-${variante}`, "Camaçari", "Feira", 108, 108],
  ]);
}

async function lerAteAPrevia(arquivo: string) {
  const recebido = await receiveFile(ctx.db, { filePath: arquivo });
  await captureRaw(ctx.db, recebido.importRunId);
  const staged = await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  return { importRunId: recebido.importRunId, staged, relatorio };
}

beforeAll(async () => {
  ctx = await createTestDatabase("arquivo_sem_fatos");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("uma planilha cuja aba não tem o grão que o leitor exige", () => {
  it("é recusada na prévia, com o motivo escrito, e não pode ser aprovada", async () => {
    const { importRunId, staged, relatorio } = await lerAteAPrevia(
      planilhaDeTrecho(),
    );

    // O que sempre aconteceu, e continua acontecendo: a aba é lida como
    // derivada e não produz fato.
    expect(staged.stagedFacts).toBe(0);
    expect(relatorio.sheets.map((s) => s.role)).toEqual(["PIVOT"]);

    // O que passou a acontecer: isso é um erro, e ele impede promover.
    const apontamento = relatorio.issuesByCode.find(
      (i) => i.code === "ARQUIVO_SEM_FATOS",
    );
    expect(apontamento).toBeDefined();
    expect(apontamento!.severity).toBe("ERROR");
    expect(apontamento!.sample).toMatch(/não entrou/i);
    expect(apontamento!.sample).toContain('"Trecho"');
    expect(relatorio.blockingErrors).toBeGreaterThan(0);

    const { rows } = await ctx.db.execute<{
      status: string;
      failure_reason: string | null;
    }>(sql`
      SELECT status, failure_reason FROM import_run WHERE id = ${importRunId}::uuid
    `);
    expect(rows[0]!.status).toBe("VALIDATION_ERROR");
    expect(rows[0]!.failure_reason).toMatch(/não entrou/i);

    // E a aprovação recusa — o run nem chega a PREVIEWED.
    await expect(promote(ctx.db, importRunId)).rejects.toThrow();
  }, 600_000);

  it("não deixa rastro no canônico: nenhuma entidade, coluna ou vigência", async () => {
    const contar = async (tabela: string) => {
      const { rows } = await ctx.db.execute<{ n: number }>(
        sql.raw(`SELECT count(*)::int AS n FROM ${tabela}`),
      );
      return rows[0]!.n;
    };
    expect(await contar("entity")).toBe(0);
    expect(await contar("attribute")).toBe(0);
    expect(await contar("snapshot")).toBe(0);
  }, 600_000);
});

describe("uma aba lida como fonte que não rende uma linha sequer", () => {
  it("também é recusada, e por um motivo diferente", async () => {
    // Cabeçalho com o grão inteiro, e nenhuma linha de dado abaixo dele.
    const arquivo = escreverPlanilha("cavalos", [
      ["Vigencia", "Unidade - CNPJ", "Placa", "chassi"],
    ]);
    const { relatorio } = await lerAteAPrevia(arquivo);

    const apontamento = relatorio.issuesByCode.find(
      (i) => i.code === "ARQUIVO_SEM_FATOS",
    );
    expect(apontamento?.sample).toMatch(/nenhuma linha produziu fato/);
  }, 600_000);
});

describe("a trava que sobra para os runs anteriores a esta correção", () => {
  it("promote recusa zero fato mesmo com o run já conferido", async () => {
    const { importRunId } = await lerAteAPrevia(planilhaDeTrecho("B"));

    // Um run PREVIEWED com zero fato é o estado em que ficavam os arquivos
    // lidos antes desta mudança. Ele existe no banco de produção, e a garantia
    // precisa morar também no lugar que grava.
    await ctx.db.execute(sql`
      UPDATE import_run SET status = 'PREVIEWED', failure_reason = NULL, finished_at = NULL
      WHERE id = ${importRunId}::uuid
    `);

    await expect(promote(ctx.db, importRunId)).rejects.toBeInstanceOf(
      PromocaoRecusada,
    );
  }, 600_000);
});
