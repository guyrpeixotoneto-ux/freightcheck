import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createTestDatabase, modelExportPaths, type TestDb } from "../testing";
import { corrigirValoresNumericos } from "./planilha-sintetica";
import {
  captureRaw,
  preview,
  promote,
  receiveFile,
  stage,
} from "../pipeline";
import {
  deleteImportRun,
  ImportDeletionRefused,
  listImportDeletions,
  planImportDeletion,
} from "../deletion";

/**
 * Excluir uma importação, e o que "excluir" quer dizer neste banco.
 *
 * O teste ataca as duas metades da promessa. A primeira é que a coisa some de
 * verdade — não escondida, não marcada como inativa: sem fatos, sem vigência,
 * sem célula RAW, e com o arquivo liberado para ser reenviado, que é o efeito
 * que o operador vai procurar depois de ter importado o arquivo errado. A
 * segunda é que a invariante continua de pé fora dessa porta: a trigger volta
 * a recusar DELETE assim que a transação termina.
 */

let ctx: TestDb;

async function importar(arquivo: string, opcoes: { revisao?: boolean } = {}) {
  const recebido = await receiveFile(ctx.db, {
    filePath: arquivo,
    receivedBy: "quem.importou@exemplo.com",
  });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  const relatorio = await preview(ctx.db, recebido.importRunId);
  await promote(ctx.db, recebido.importRunId, {
    confirmNewEntityTypes: relatorio.pendingIdentities,
    onExistingSnapshot: opcoes.revisao ? "NEW_REVISION" : "FAIL",
  });
  return recebido.importRunId;
}

async function contar(query: string): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: string }>(query);
  return Number(rows[0].n);
}

beforeAll(async () => {
  ctx = await createTestDatabase("deletion");
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a prévia diz o que sairia, antes de sair", () => {
  it("conta fatos, vigências e evidência do run promovido", async () => {
    const runId = await importar(modelExportPaths().carreta);
    const plano = await planImportDeletion(ctx.db, runId);

    expect(plano).not.toBeNull();
    expect(plano!.refusal).toBeNull();
    expect(plano!.labels.length).toBeGreaterThan(0);
    expect(plano!.removes.facts).toBeGreaterThan(0);
    expect(plano!.removes.rawCells).toBeGreaterThan(0);
    expect(plano!.removes.entities).toBeGreaterThan(0);
    // Colunas que ficam sem dado — contadas para aparecer na prévia, e
    // nenhuma delas apagada. Ver `attributeIdsLeftWithoutData`.
    expect(plano!.removes.attributesKept).toBeGreaterThan(0);
    // O arquivo é só desta importação, então ele sai junto — é o que devolve
    // ao operador o direito de reenviá-lo.
    expect(plano!.removes.sourceFile).toBe(1);

    // A prévia não pode ter apagado nada.
    expect(await contar("SELECT count(*) AS n FROM fact")).toBe(
      plano!.removes.facts,
    );
  });

  it("devolve null para um id que não existe", async () => {
    expect(
      await planImportDeletion(ctx.db, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});

describe("excluir apaga de verdade", () => {
  it("tira fatos, vigências, RAW e o arquivo — e registra a exclusão", async () => {
    const [{ id: runId }] = (
      await ctx.pool.query<{ id: string }>(`SELECT id FROM import_run LIMIT 1`)
    ).rows;

    const plano = (await planImportDeletion(ctx.db, runId))!;
    const resultado = await deleteImportRun(ctx.db, runId, {
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "planilha de teste",
    });

    expect(resultado.removed.facts).toBe(plano.removes.facts);

    for (const tabela of [
      "fact",
      "snapshot",
      "snapshot_attribute",
      "snapshot_scope",
      "raw_cell",
      "raw_row",
      "raw_sheet",
      "staged_fact",
      "column_mapping",
      "validation_issue",
      "import_run",
      "source_file",
      "entity",
    ]) {
      expect([tabela, await contar(`SELECT count(*) AS n FROM ${tabela}`)]).toEqual([
        tabela,
        0,
      ]);
    }

    // O dicionário fica. É a fronteira do que "excluir" quer dizer: sai o
    // dado, e a coluna — que é a identidade pela qual o dado volta, e onde
    // mora o que uma pessoa afirmou sobre ele — não sai nunca.
    const colunas = await contar(`SELECT count(*) AS n FROM attribute`);
    expect(colunas).toBe(plano.removes.attributesKept);
    expect(colunas).toBeGreaterThan(0);

    const [registro] = await listImportDeletions(ctx.db);
    expect(registro.importRunId).toBe(runId);
    expect(registro.deletedBy).toBe("quem.excluiu@exemplo.com");
    expect(registro.reason).toBe("planilha de teste");
    expect(registro.labels).toEqual(plano.labels);
    expect(registro.removed.facts).toBe(plano.removes.facts);
    // O SHA-256 fica no registro depois de o arquivo sair: é o que permite
    // reconhecer, meses depois, que aquele conteúdo já esteve aqui.
    expect(registro.contentSha256).toBe(plano.contentSha256);
  });

  it("libera o mesmo arquivo para ser enviado de novo", async () => {
    // O caminho é outro de propósito: a exclusão apaga o arquivo em disco, e
    // um reenvio real vem de outro lugar (o upload grava o seu).
    const copia = path.join(tmpdir(), `reenvio-${process.pid}.xlsx`);
    copyFileSync(modelExportPaths().carreta, copia);

    const recebido = await receiveFile(ctx.db, { filePath: copia });
    expect(recebido.isDuplicate).toBe(false);

    await captureRaw(ctx.db, recebido.importRunId);
    await stage(ctx.db, recebido.importRunId);
    const relatorio = await preview(ctx.db, recebido.importRunId);
    await promote(ctx.db, recebido.importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    expect(await contar("SELECT count(*) AS n FROM fact")).toBeGreaterThan(0);
  });
});

describe("a invariante continua de pé depois da exclusão", () => {
  it("recusa DELETE em RAW fora de uma exclusão", async () => {
    await expect(ctx.pool.query(`DELETE FROM raw_cell`)).rejects.toThrow(
      /RAW layer is immutable/,
    );
    await expect(ctx.pool.query(`DELETE FROM snapshot`)).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it("recusa UPDATE em RAW mesmo com a porta aberta", async () => {
    // A porta é só para DELETE. Reescrever uma célula continua sendo o que
    // este produto não faz em circunstância nenhuma.
    const client = await ctx.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `SELECT set_config('freightcheck.purge_import_run', 'seja-o-que-for', true)`,
      );
      await expect(
        client.query(`UPDATE raw_cell SET raw_value = 'adulterado'`),
      ).rejects.toThrow(/RAW layer is immutable/);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("não deixa a porta aberta para a próxima conexão", async () => {
    const { rows } = await ctx.pool.query<{ v: string | null }>(
      `SELECT current_setting('freightcheck.purge_import_run', true) AS v`,
    );
    expect(rows[0].v ?? "").toBe("");
  });
});

describe("a ordem em que as coisas podem ser desfeitas", () => {
  let primeira: string;
  let segunda: string;

  beforeAll(async () => {
    // A revisão 2 da mesma vigência: o caso real de uma correção reimportada.
    //
    // Com a identidade canônica, reenviar o mesmo conteúdo é reconhecido como
    // dado igual e não abre revisão nenhuma — que é o comportamento correto.
    // Para haver revisão 2, o arquivo precisa de fato corrigir alguma coisa, e
    // é por isso que este envio leva bytes diferentes: `revisao` aqui só decide
    // o `onExistingSnapshot`, não a defesa do SHA-256. Reler o **mesmo** byte é
    // outra porta, com procedência própria — ver `reprocessamento.test.ts`.
    [primeira] = (
      await ctx.pool.query<{ id: string }>(
        `SELECT id FROM import_run ORDER BY started_at LIMIT 1`,
      )
    ).rows.map((r) => r.id);
    segunda = await importar(corrigirValoresNumericos(modelExportPaths().carreta), {
      revisao: true,
    });
  }, 600_000);

  it("recusa apagar a importação que outra corrigiu depois", async () => {
    const plano = await planImportDeletion(ctx.db, primeira);
    expect(plano!.refusal).toMatch(/corrigida depois/);

    await expect(
      deleteImportRun(ctx.db, primeira, { deletedBy: "alguem@exemplo.com" }),
    ).rejects.toBeInstanceOf(ImportDeletionRefused);

    expect(await contar(`SELECT count(*) AS n FROM fact`)).toBeGreaterThan(0);
  });

  it("apagando a correção, a revisão anterior volta a valer", async () => {
    const plano = (await planImportDeletion(ctx.db, segunda))!;
    expect(plano.refusal).toBeNull();
    expect(plano.restoredLabels.length).toBeGreaterThan(0);

    await deleteImportRun(ctx.db, segunda, {
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "correção enviada por engano",
    });

    const superadas = await contar(
      `SELECT count(*) AS n FROM snapshot WHERE status = 'SUPERSEDED'`,
    );
    expect(superadas).toBe(0);
    expect(
      await contar(`SELECT count(*) AS n FROM snapshot WHERE status = 'CLOSED'`),
    ).toBe(plano.restoredLabels.length);

    // A revisão 1 continua inteira: os fatos dela nunca foram tocados.
    expect(await contar(`SELECT count(*) AS n FROM fact`)).toBeGreaterThan(0);

    const [registro] = await listImportDeletions(ctx.db);
    expect(registro.restoredLabels).toEqual(plano.restoredLabels);
  });

  it("agora aceita apagar a primeira, e o banco fica vazio", async () => {
    await deleteImportRun(ctx.db, primeira, {
      deletedBy: "quem.excluiu@exemplo.com",
    });

    expect(await contar(`SELECT count(*) AS n FROM fact`)).toBe(0);
    expect(await contar(`SELECT count(*) AS n FROM snapshot`)).toBe(0);
    expect(await contar(`SELECT count(*) AS n FROM import_run`)).toBe(0);
    // O que sobra é o histórico das exclusões — e ele não sai.
    expect((await listImportDeletions(ctx.db)).length).toBe(3);
  });

  it("recusa apagar o registro da exclusão", async () => {
    await expect(ctx.pool.query(`DELETE FROM import_deletion`)).rejects.toThrow(
      /append-only/,
    );
    await expect(
      ctx.pool.query(`UPDATE import_deletion SET deleted_by = 'outro'`),
    ).rejects.toThrow(/append-only/);
  });
});

/*
  O contrato conceitual — "excluir apaga dados, nunca a identidade nem o
  dicionário dos atributos" — mora em `dicionario-sobrevive-a-exclusao.test.ts`,
  com os seis casos que o fixam. Aqui ficam as mecânicas da exclusão, e o que
  elas asseguram acima sobre `attribute` é o bastante para este arquivo: o
  dicionário atravessa inteiro.
*/
