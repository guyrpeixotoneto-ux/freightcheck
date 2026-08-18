import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  captureRaw,
  exigirTipoDeclarado,
  preview,
  promote,
  receiveFile,
  stage,
} from "../pipeline";
import { createTestDatabase, modelExportPaths, type TestDb } from "../testing";
import { corrigirValoresNumericos, escreverPlanilha } from "./planilha-sintetica";

/**
 * A declaração é promessa; a importação é quem confere.
 *
 * A identidade por conteúdo (`identidade-por-conteudo.test.ts`) prova o que o
 * pipeline faz quando ninguém diz nada. Este prova o que ele faz quando alguém
 * diz — e o que importa aqui não é a declaração ser aceita, é ela **não** ser
 * aceita quando o arquivo desmente: uma planilha de carreta enviada pela aba do
 * Cavalo não pode entrar como cavalo porque alguém clicou na aba errada.
 */

let ctx: TestDb;

async function importar(arquivo: string, declaredType?: string) {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    declaredType,
  });
  await captureRaw(ctx.db, recebido.importRunId);
  const staged = await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  return { importRunId: recebido.importRunId, staged, relatorio };
}

const planilhaDeTrecho = () =>
  escreverPlanilha({
    vigencia: "EMPURRADA_1_8_2026",
    abas: [
      {
        nome: "Planilha1",
        identificador: "chaveTrecho",
        linhas: [{ placa: "CAMACARI-SALVADOR" }, { placa: "CAMACARI-FEIRA" }],
      },
    ],
  });

beforeAll(async () => {
  ctx = await createTestDatabase("tipo_declarado");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("o tipo que a tela ainda não pode oferecer", () => {
  it("recusa QLP no recebimento, com o motivo por escrito", () => {
    expect(() => exigirTipoDeclarado("QLP_ADMINISTRATIVO")).toThrow(
      /ainda não pode ser importado/,
    );
    expect(() => exigirTipoDeclarado("QLP_OPERACIONAL")).toThrow(
      /quadro de pessoal/i,
    );
  });

  it("recusa um código que não é tipo nenhum", () => {
    expect(() => exigirTipoDeclarado("BITREM")).toThrow(/não é um tipo/);
  });

  it("não abre importação para o tipo recusado", async () => {
    await expect(
      receiveFile(ctx.db, {
        filePath: modelExportPaths().carreta,
        declaredType: "QLP_ADMINISTRATIVO",
      }),
    ).rejects.toThrow(/ainda não pode ser importado/);

    const { rows } = await ctx.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM import_run`,
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("a declaração que o arquivo sustenta", () => {
  it("entra como o tipo declarado, e a decisão diz que foi declarada", async () => {
    const { staged, relatorio, importRunId } = await importar(
      modelExportPaths().carreta,
      "CARRETA",
    );

    expect(staged.identities[0].decision.source).toBe("DECLARADO");
    expect(staged.identities[0].decision.entityType).toBe("CARRETA");
    expect(relatorio.blockingErrors).toBe(0);

    const { rows } = await ctx.db.execute<{ declared_type: string }>(
      sql`SELECT declared_type FROM import_run WHERE id = ${importRunId}::uuid`,
    );
    expect(rows[0].declared_type).toBe("CARRETA");

    // Promovida de propósito: é a promoção que escreve o dicionário, e é
    // contra o dicionário que a divergência mais abaixo se prova.
    await promote(ctx.db, importRunId);
  });

  it("abre o trecho num banco que nunca viu um, sem pedir confirmação depois", async () => {
    const { staged, relatorio } = await importar(planilhaDeTrecho(), "TRECHO");

    expect(staged.identities[0].decision.entityType).toBe("TRECHO");
    // A aba se chama "Planilha1": sem a declaração, o nome criaria o
    // equipamento PLANILHA1 e a promoção pararia para alguém confirmá-lo.
    expect(relatorio.pendingIdentities).toEqual([]);
    expect(relatorio.blockingErrors).toBe(0);
    // O que prova que o grão do trecho existe é isto: a chave da linha é a
    // chave do trecho, e não uma placa que a planilha não tem.
    expect(staged.stagedFacts).toBeGreaterThan(0);

    const { rows } = await ctx.db.execute<{ entity_key: string }>(sql`
      SELECT DISTINCT entity_key FROM staged_fact WHERE entity_type = 'TRECHO' ORDER BY 1
    `);
    expect(rows.map((r) => r.entity_key)).toEqual([
      "CAMACARIFEIRA",
      "CAMACARISALVADOR",
    ]);
  });
});

describe("a declaração que o arquivo desmente", () => {
  it("recusa a planilha de carreta enviada pela aba do Cavalo", async () => {
    /*
      O dicionário já conhece CARRETA — o teste acima a promoveu. É essa a
      condição em que o conteúdo consegue desmentir a declaração: cavalo e
      carreta se identificam os dois por placa, e o grão não os separa.

      O arquivo é uma cópia com os números somados de 1, e não o original: os
      mesmos bytes seriam recusados antes de chegar à conferência, pelo SHA-256.
    */
    const { relatorio, importRunId } = await importar(
      corrigirValoresNumericos(modelExportPaths().carreta),
      "CAVALO",
    );

    expect(relatorio.blockingErrors).toBeGreaterThan(0);

    const { rows } = await ctx.db.execute<{ status: string; failure_reason: string }>(
      sql`SELECT status, failure_reason FROM import_run WHERE id = ${importRunId}::uuid`,
    );
    expect(rows[0].status).toBe("VALIDATION_ERROR");
    expect(rows[0].failure_reason).toMatch(/Você escolheu Cavalo/);
    expect(rows[0].failure_reason).toMatch(/aba do tipo certo/);

    await expect(promote(ctx.db, importRunId)).rejects.toThrow();
  });

  it("recusa a planilha de placa enviada pela aba do Trecho, pelo grão", async () => {
    const { relatorio, importRunId } = await importar(
      modelExportPaths().cavalo,
      "TRECHO",
    );

    expect(relatorio.blockingErrors).toBeGreaterThan(0);

    const { rows } = await ctx.db.execute<{ failure_reason: string }>(
      sql`SELECT failure_reason FROM import_run WHERE id = ${importRunId}::uuid`,
    );
    // A recusa cita a coluna, e não o dicionário: é a conferência que funciona
    // no primeiro arquivo de um tipo, quando não há dicionário a consultar.
    expect(rows[0].failure_reason).toMatch(/chaveTrecho/);
    expect(rows[0].failure_reason).toMatch(/se identifica por "Placa"/);
  });
});
