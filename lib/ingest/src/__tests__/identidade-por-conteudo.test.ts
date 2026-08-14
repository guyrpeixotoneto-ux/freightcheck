import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import path from "node:path";
import { tmpdir } from "node:os";
import { createTestDatabase, modelExportPaths, type TestDb } from "../testing";
import {
  captureRaw,
  preview,
  promote,
  receiveFile,
  stage,
  type PromoteOptions,
} from "../pipeline";

/**
 * A identidade decidida pelo conteúdo, pelo pipeline inteiro.
 *
 * O teste de `identity.test.ts` prova a regra; este prova o caminho — que a
 * decisão chega na staging, no código do atributo, no tipo da entidade e na
 * cobertura da vigência, e que a promoção recusa o que ninguém declarou.
 *
 * O arquivo é o `Modelo_Carreta.xlsx` de verdade, com a aba renomeada dentro
 * do `.xlsx` para `m.carreta` — o nome que a pergunta original citava, e que a
 * derivação por nome transformaria em MCARRETA.
 */

let ctx: TestDb;

function comAbaRenomeada(origem: string, nome: string): string {
  const wb = XLSX.readFile(origem);
  const original = wb.SheetNames[0];
  wb.Sheets[nome] = wb.Sheets[original];
  if (nome !== original) delete wb.Sheets[original];
  wb.SheetNames[0] = nome;
  const destino = path.join(tmpdir(), `${nome.replace(/\W+/g, "-")}-${process.pid}.xlsx`);
  XLSX.writeFile(wb, destino);
  return destino;
}

async function importar(arquivo: string, opcoes: PromoteOptions = {}) {
  const recebido = await receiveFile(ctx.db, { filePath: arquivo });
  await captureRaw(ctx.db, recebido.importRunId);
  const staged = await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  const promovido = await promote(ctx.db, recebido.importRunId, opcoes);
  return { importRunId: recebido.importRunId, staged, relatorio, promovido };
}

beforeAll(async () => {
  ctx = await createTestDatabase("identidade_conteudo");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a primeira importação, num banco que não conhece nada", () => {
  it("aceita o nome da aba, e diz que foi o nome", async () => {
    const { staged, relatorio } = await importar(modelExportPaths().carreta);

    const identidade = staged.identities[0];
    expect(identidade.decision.entityType).toBe("CARRETA");
    expect(identidade.decision.source).toBe("NOME");
    expect(identidade.decision.isNew).toBe(true);
    expect(identidade.decision.reason).toMatch(/não conhece nenhum equipamento/);

    // Num banco virgem não existe identidade paralela possível, então a
    // primeira importação não fica travada — o aviso vai para a tela.
    expect(relatorio.pendingIdentities).toEqual([]);
  }, 600_000);
});

describe("a mesma planilha com a aba chamada de outro jeito", () => {
  it("entra como CARRETA — o nome m.carreta não cria equipamento nenhum", async () => {
    const { staged, promovido } = await importar(
      comAbaRenomeada(modelExportPaths().carreta, "m.carreta"),
      // Mesmo conteúdo, mesma vigência: a segunda entrega é uma revisão, e
      // revisão se declara — é a trava que já existia, e não a desta mudança.
      { onExistingSnapshot: "NEW_REVISION" },
    );

    const identidade = staged.identities[0];
    expect(identidade.sheetName).toBe("m.carreta");
    expect(identidade.decision.entityType).toBe("CARRETA");
    expect(identidade.decision.source).toBe("DICIONARIO");
    expect(identidade.decision.isNew).toBe(false);

    // E o que foi escrito: nenhuma entidade, coluna ou vigência de MCARRETA.
    const { rows: tipos } = await ctx.db.execute<{ entity_type: string; n: number }>(sql`
      SELECT entity_type, count(*)::int AS n FROM entity GROUP BY 1 ORDER BY 1
    `);
    expect(tipos).toEqual([{ entity_type: "CARRETA", n: expect.any(Number) }]);

    const { rows: colunas } = await ctx.db.execute<{ entity_type: string }>(sql`
      SELECT DISTINCT entity_type FROM attribute ORDER BY 1
    `);
    expect(colunas.map((c) => c.entity_type)).toEqual(["CARRETA"]);

    const { rows: coberturas } = await ctx.db.execute<{ entity_type_set: string }>(sql`
      SELECT DISTINCT entity_type_set FROM snapshot ORDER BY 1
    `);
    expect(coberturas.map((c) => c.entity_type_set)).toEqual(["CARRETA"]);

    expect(promovido.snapshotIds.length).toBeGreaterThan(0);
  }, 600_000);
});

describe("um equipamento que o dicionário não conhece", () => {
  it("é dito na pré-visualização e recusado na promoção sem declaração", async () => {
    const recebido = await receiveFile(ctx.db, { filePath: modelExportPaths().cavalo });
    await captureRaw(ctx.db, recebido.importRunId);
    const staged = await stage(ctx.db, recebido.importRunId);
    const relatorio = await preview(ctx.db, recebido.importRunId);

    // O cavalo compartilha ~60% das colunas da carreta: perto, e longe do
    // bastante. "Não sei" é a resposta certa, e não "é carreta".
    expect(staged.identities[0].decision.entityType).toBe("CAVALO");
    expect(staged.identities[0].decision.source).toBe("NOME");
    expect(staged.identities[0].decision.isNew).toBe(true);
    expect(relatorio.pendingIdentities).toEqual(["CAVALO"]);

    await expect(promote(ctx.db, recebido.importRunId)).rejects.toThrow(
      /criaria um equipamento que o dicionário não conhece: CAVALO/,
    );

    // A recusa não deixou nada escrito: o cavalo continua fora do dicionário.
    const { rows } = await ctx.db.execute<{ entity_type: string }>(sql`
      SELECT DISTINCT entity_type FROM attribute ORDER BY 1
    `);
    expect(rows.map((r) => r.entity_type)).toEqual(["CARRETA"]);

    // Declarado, entra — equipamento novo continua permitido, deixou de ser
    // efeito colateral de um nome de aba.
    const promovido = await promote(ctx.db, recebido.importRunId, {
      confirmNewEntityTypes: ["CAVALO"],
    });
    expect(promovido.snapshotIds.length).toBeGreaterThan(0);

    const { rows: depois } = await ctx.db.execute<{ entity_type: string }>(sql`
      SELECT DISTINCT entity_type FROM attribute ORDER BY 1
    `);
    expect(depois.map((r) => r.entity_type)).toEqual(["CARRETA", "CAVALO"]);
  }, 600_000);
});
