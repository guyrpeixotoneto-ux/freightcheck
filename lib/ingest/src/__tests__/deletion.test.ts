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
    // nenhuma delas apagada. Ver `attributesLeftWithoutData`.
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

/**
 * O dicionário não é do arquivo — e a exclusão parou de julgar quais colunas
 * são de alguém.
 *
 * O critério original era um só: "ficou sem nenhum fato, então sai". Ele é a
 * resposta certa para a coluna que a importação criou e ninguém nunca olhou, e
 * a errada para a coluna que alguém abriu a curadoria para batizar e explicar
 * — as duas ficam sem fato pelo mesmo motivo, e só uma se recupera reenviando
 * o arquivo.
 *
 * A correção seguinte protegeu a coluna curada por uma lista de campos em
 * prosa, e é essa lista que este teste mostra ser impossível de acertar. O ato
 * mais comum da curadoria não escreve prosa nenhuma: confirmar uma coluna pela
 * tela grava significado, unidade, categoria e autor, e a lista não via nada
 * disso — a coluna era apagada como se ninguém a tivesse tocado.
 *
 * Então não há mais lista, e não há mais exceção: **nenhuma coluna sai numa
 * exclusão**. É isso que o teste fixa, nas três formas em que a perda
 * aconteceria — a coluna descrita, a batizada e a confirmada sem uma linha de
 * texto —, e a última prova é a que fecha o ciclo: a importação seguinte
 * devolve os fatos às mesmas linhas, porque a identidade delas é o `code`.
 */
describe("nenhuma coluna sai quando a importação sai", () => {
  let runId: string;
  let descritoId: string;
  let batizadoId: string;
  let confirmadoId: string;
  let colunasAntes: number;
  let semanticasAntes: number;
  let confirmadosAntes: number;

  beforeAll(async () => {
    runId = await importar(modelExportPaths().carreta);

    // Três colunas, curadas de três jeitos diferentes, porque são três sinais
    // diferentes e cada um tem de bastar sozinho. Escritas direto na projeção
    // de propósito: é o mesmo UPDATE que `saveMeaning` faz, sem arrastar
    // `@workspace/curation` para dentro de um teste de ingestão.
    const descrito = await ctx.pool.query<{ id: string }>(
      `UPDATE attribute
          SET definition  = 'O seguro do casco, por carreta e por mês.',
              change_rule = 'Reajusta na renovação anual da apólice.'
        WHERE id = (SELECT id FROM attribute ORDER BY code LIMIT 1)
        RETURNING id`,
    );
    descritoId = descrito.rows[0].id;

    // Só o nome gerencial, e nada mais: batizar uma coluna já é trabalho que
    // nenhuma reimportação repõe.
    const batizado = await ctx.pool.query<{ id: string }>(
      `UPDATE attribute
          SET display_name = 'Prazo do FINAME, em meses'
        WHERE id = (SELECT id FROM attribute ORDER BY code OFFSET 1 LIMIT 1)
        RETURNING id`,
    );
    batizadoId = batizado.rows[0].id;

    /*
      E a terceira, que é a que a lista de campos em prosa não enxergava.

      É o que a tela de Curadoria escreve quando alguém confirma uma coluna
      pelo significado (`gravarSemanticaConfirmada`): estado, autor e data, sem
      uma palavra de texto livre. A coluna era apagada junto com o arquivo, e o
      `curation_event` daquele ato — que não tem chave estrangeira para
      `attribute` — sobrevivia apontando para um id inexistente: a auditoria
      afirmando que alguém confirmou uma coluna que o banco não tem.

      Ela não está no registro canônico, então não há promoção que a devolva:
      se sair, saiu.
    */
    const confirmado = await ctx.pool.query<{ id: string }>(
      `UPDATE attribute
          SET semantics_status = 'CONFIRMED',
              confirmed_by     = 'quem.curou@exemplo.com',
              confirmed_at     = now()
        WHERE id = (SELECT id FROM attribute
                     WHERE semantics_status <> 'CONFIRMED'
                     ORDER BY code OFFSET 2 LIMIT 1)
        RETURNING id`,
    );
    confirmadoId = confirmado.rows[0].id;

    colunasAntes = await contar(`SELECT count(*) AS n FROM attribute`);
    semanticasAntes = await contar(
      `SELECT count(*) AS n FROM attribute_semantics`,
    );
    confirmadosAntes = await contar(
      `SELECT count(*) AS n FROM attribute WHERE semantics_status = 'CONFIRMED'`,
    );
    // A importação carimba sozinha um bom pedaço do dicionário — é esse número
    // que precisa atravessar a exclusão inteiro.
    expect(confirmadosAntes).toBeGreaterThan(0);
  }, 600_000);

  it("a prévia conta as colunas que ficam sem dado, e não promete apagar nenhuma", async () => {
    const plano = (await planImportDeletion(ctx.db, runId))!;

    // Toda coluna do banco veio desta importação, então todas ficam sem dado —
    // e todas ficam. Uma coluna que caísse fora da conta sumiria sem aparecer
    // em número nenhum.
    expect(plano.removes.attributesKept).toBe(colunasAntes);
  });

  it("exclui tudo, e o dicionário atravessa inteiro", async () => {
    await deleteImportRun(ctx.db, runId, {
      deletedBy: "quem.excluiu@exemplo.com",
      reason: "arquivo do mês errado",
    });

    expect(await contar(`SELECT count(*) AS n FROM fact`)).toBe(0);
    expect(await contar(`SELECT count(*) AS n FROM import_run`)).toBe(0);

    // Nem uma linha a menos: nem a curada, nem a que ninguém olhou.
    expect(await contar(`SELECT count(*) AS n FROM attribute`)).toBe(colunasAntes);

    const { rows } = await ctx.pool.query<{
      id: string;
      definition: string | null;
      change_rule: string | null;
      display_name: string | null;
      semantics_status: string;
      confirmed_by: string | null;
      first_seen_import_run_id: string | null;
    }>(
      `SELECT id, definition, change_rule, display_name, semantics_status,
              confirmed_by, first_seen_import_run_id
         FROM attribute ORDER BY id`,
    );

    const descrito = rows.find((r) => r.id === descritoId)!;
    expect(descrito.definition).toMatch(/seguro do casco/);
    expect(descrito.change_rule).toMatch(/apólice/);

    const batizado = rows.find((r) => r.id === batizadoId)!;
    expect(batizado.display_name).toBe("Prazo do FINAME, em meses");

    const confirmado = rows.find((r) => r.id === confirmadoId)!;
    expect(confirmado.semantics_status).toBe("CONFIRMED");
    expect(confirmado.confirmed_by).toBe("quem.curou@exemplo.com");

    // A semântica de cada coluna fica com ela. Apagá-la deixaria colunas sem
    // versão em vigor, que é exatamente o que `atributosSemSemanticaAplicavel`
    // existe para acusar.
    expect(
      await contar(`SELECT count(*) AS n FROM attribute_semantics`),
    ).toBe(semanticasAntes);

    // Órfãs de dado, e sem apontar para um run que não existe mais.
    for (const linha of rows) expect(linha.first_seen_import_run_id).toBeNull();
  });

  it("a importação seguinte devolve os fatos às mesmas colunas", async () => {
    // O caminho é outro porque a exclusão apaga o arquivo em disco — a mesma
    // razão de `libera o mesmo arquivo para ser enviado de novo`.
    const copia = path.join(tmpdir(), `recuperacao-${process.pid}.xlsx`);
    copyFileSync(modelExportPaths().carreta, copia);
    await importar(copia);

    // A identidade da coluna é o `code`, que não mudou: a importação encontra a
    // linha que ficou em vez de criar outra, e a curadoria volta a descrever
    // números de verdade.
    const { rows } = await ctx.pool.query<{ n: string; definition: string | null }>(
      `SELECT count(f.id) AS n, max(a.definition) AS definition
         FROM attribute a JOIN fact f ON f.attribute_id = a.id
        WHERE a.id = $1`,
      [descritoId],
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
    expect(rows[0].definition).toMatch(/seguro do casco/);

    // E o dicionário não duplicou: reimportar o mesmo arquivo reencontra as
    // colunas que ficaram, uma a uma.
    expect(await contar(`SELECT count(*) AS n FROM attribute`)).toBe(colunasAntes);

    // A confirmação feita à mão continua de pé depois de a coluna ter passado
    // pela exclusão e voltado a ter dado — ela nunca teria voltado sozinha.
    expect(
      await contar(
        `SELECT count(*) AS n FROM attribute WHERE semantics_status = 'CONFIRMED'`,
      ),
    ).toBe(confirmadosAntes);
  });

  it("o nome gerencial não é preenchido pela importação", async () => {
    // O campo é para quem cura escrever, e um campo que nasce preenchido com o
    // nome de origem parece respondido sem ninguém ter respondido — ver a
    // migration 0089.
    expect(
      await contar(
        `SELECT count(*) AS n FROM attribute
          WHERE display_name IS NOT NULL AND display_name = source_name`,
      ),
    ).toBe(0);

    // E ninguém fica sem nome por isso: `source_name` é o que as telas mostram
    // enquanto não há apelido, e ele nunca é reescrito.
    expect(
      await contar(`SELECT count(*) AS n FROM attribute WHERE source_name IS NULL`),
    ).toBe(0);
  });
});
