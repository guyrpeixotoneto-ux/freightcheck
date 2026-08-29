import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { captureRaw, preview, receiveFile, stage } from "@workspace/ingest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { listarBalancos } from "../balanco";
import { classificacao, semJit } from "../classificacao";
import { gravarCenso, recensearPendentes } from "../censo";

/**
 * O censo por importação — o que ele promete, e o que aconteceria se não
 * cumprisse.
 *
 * `GET /api/balance` deixou de reclassificar o acervo inteiro a cada leitura
 * (1.022.946 linhas lidas para devolver 2,5 KB) e passou a somar um censo
 * gravado por importação. A troca só é honesta se **a resposta for a mesma** —
 * e "a mesma" aqui não é "parecida": é linha a linha, destino a destino.
 *
 * Cada caso abaixo é uma forma de a promessa quebrar:
 *
 * | caso | o que quebraria sem ele |
 * |---|---|
 * | decomposição | a soma dos censos discordaria da varredura global |
 * | importação nova | o run entraria na lista sem censo, ou com o censo errado |
 * | ocultar / reexibir | ocultar apagaria o censo, e reexibir devolveria zeros |
 * | reprocessar | os dois runs dividiriam um censo, ou um sobrescreveria o outro |
 * | retry / idempotência | gravar duas vezes contaria as células duas vezes |
 * | histórico sem censo | o run sumiria da lista em vez de ser calculado na hora |
 * | excluir | o censo sobreviveria descrevendo células que não existem mais |
 */

let ctx: TestDb;

/** A classificação ao vivo, do jeito que a leitura fazia antes do censo. */
async function classificarAoVivo(
  db: TestDb["db"],
  importRunId?: string,
): Promise<Map<string, number>> {
  const { rows } = await semJit<{ run_id: string; destino: string; celulas: number }>(
    db,
    sql`
    ${classificacao(importRunId)}
    SELECT run_id, destino, count(*)::int AS celulas
    FROM classificada
    GROUP BY run_id, destino
  `,
  );
  return new Map(rows.map((r) => [`${r.run_id}|${r.destino}`, r.celulas]));
}

/** O censo gravado, na mesma forma, para comparar sem ambiguidade. */
async function censoGravado(db: TestDb["db"]): Promise<Map<string, number>> {
  const { rows } = await db.execute<{
    import_run_id: string;
    destino: string;
    celulas: number;
  }>(sql`SELECT import_run_id::text, destino, celulas FROM import_run_censo`);
  return new Map(rows.map((r) => [`${r.import_run_id}|${r.destino}`, r.celulas]));
}

/**
 * Uma planilha com um pouco de cada destino: fato preparado, cabeçalho, linha
 * em branco, linha recusada, coluna sem cabeçalho, coluna ambígua e aba de
 * apoio. É a mesma construção de `perdas.test.ts`, e o motivo de não usar os
 * workbooks reais é que o censo não depende de qual arquivo entrou — depende de
 * a classificação ser a mesma dos dois lados, e uma planilha pequena prova isso
 * em segundos em vez de minutos.
 */
function planilhaVariada(): string {
  const fonte = XLSX.utils.aoa_to_sheet([
    ["Vigencia", "Placa", "valorFrota", "Valor Frota", null],
    ["EMPURRADA_1_8_2026", "ABC1D23", 10, 20, 30],
    ["EMPURRADA_1_8_2026", null, 11, 21, 31],
    [null, null, null, null, null],
    ["ISTO_NAO_E_VIGENCIA", "ABC1D23", 13, 23, 33],
  ]);
  const apoio = XLSX.utils.aoa_to_sheet([
    ["Rótulos de Linha", "Soma de valor"],
    ["CAVALO", 1234],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, fonte, "Modelo_Teste");
  XLSX.utils.book_append_sheet(wb, apoio, "Resumo");
  const destino = path.join(
    mkdtempSync(path.join(tmpdir(), "balance-censo-")),
    "planilha.xlsx",
  );
  writeFileSync(destino, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  return destino;
}


/**
 * Um run descartável, com arquivo próprio.
 *
 * `import_run_leitura_aberta_uq` impede dois runs abertos sobre o mesmo
 * `source_file` — é a trava que garante que uma leitura por vez avança sobre um
 * arquivo. Por isso cada run de teste ganha o seu, em vez de reaproveitar o do
 * import de verdade.
 */
async function runDescartavel(marca: string, reprocessaDe?: string): Promise<string> {
  const { rows: arquivo } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO source_file (filename, content_sha256, byte_size, storage_path)
    VALUES (${`${marca}.xlsx`}, ${`sha-${marca}`}, 1, ${`/tmp/${marca}`})
    RETURNING id::text AS id
  `);
  const { rows } = await ctx.db.execute<{ id: string }>(sql`
    INSERT INTO import_run (source_file_id, status, reprocess_of_run_id, reprocess_reason)
    VALUES (
      ${arquivo[0]!.id}::uuid, 'PENDING', ${reprocessaDe ?? null}::uuid,
      ${reprocessaDe ? "releitura de teste" : null}
    )
    RETURNING id::text AS id
  `);
  return rows[0]!.id;
}

let runPromovido: string;
let runEmPreview: string;

beforeAll(async () => {
  /*
    Um banco próprio e um workbook, importado pelo caminho real do produto
    (`receiveFile` → `captureRaw` → `stage` → `preview`). É `stage()` que grava
    o censo, e é por isso que o primeiro caso — "uma importação nova sai já
    recenseada" — é uma afirmação sobre o produto, e não sobre a fixture.
  */
  ctx = await createTestDatabase("balance_censo");
  const recebido = await receiveFile(ctx.db, { filePath: planilhaVariada() });
  await captureRaw(ctx.db, recebido.importRunId);
  await stage(ctx.db, recebido.importRunId);
  await preview(ctx.db, recebido.importRunId);
  runPromovido = recebido.importRunId;
  runEmPreview = recebido.importRunId;
}, 600_000);

afterAll(async () => {
  await ctx?.drop();
});

describe("a decomposição por importação", () => {
  it("classificar tudo de uma vez e uma importação por vez dá o mesmo resultado", async () => {
    /*
      É a afirmação que autoriza gravar o censo. Se a classificação de uma
      célula dependesse de outra importação, somar censos daria um número e a
      varredura daria outro — e o produto passaria a publicar o primeiro.
    */
    const global = await classificarAoVivo(ctx.db);
    const { rows: todos } = await ctx.db.execute<{ id: string }>(sql`
      SELECT id::text AS id FROM import_run
    `);
    const porRun = new Map<string, number>();
    for (const { id } of todos) {
      for (const [k, v] of await classificarAoVivo(ctx.db, id)) porRun.set(k, v);
    }
    expect(Object.fromEntries(porRun)).toEqual(Object.fromEntries(global));
    expect(porRun.size).toBeGreaterThan(0);
  });

  it("o censo gravado é igual à classificação ao vivo", async () => {
    expect(Object.fromEntries(await censoGravado(ctx.db))).toEqual(
      Object.fromEntries(await classificarAoVivo(ctx.db)),
    );
  });
});

describe("uma importação nova", () => {
  it("sai da preparação já recenseada", async () => {
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM import_run WHERE censo_calculado_em IS NULL
    `);
    expect(rows[0]!.n).toBe(0);
  });

  it("entra na lista com a soma dos destinos igual às células capturadas", async () => {
    const balancos = await listarBalancos(ctx.db);
    expect(balancos.length).toBeGreaterThan(0);
    for (const b of balancos) {
      expect(b.destinos.reduce((t, d) => t + d.celulas, 0)).toBe(b.entrada);
      expect(b.entrada).toBe(b.entradaRegistrada);
      expect(b.residuo).toBe(0);
    }
  });
});

describe("ocultar e reexibir", () => {
  it("ocultar tira da lista sem tocar no censo, e reexibir devolve os mesmos números", async () => {
    const antes = await listarBalancos(ctx.db);
    const alvo = antes.find((b) => b.importRunId === runPromovido)!;

    await ctx.db.execute(
      sql`UPDATE import_run SET hidden_at = now() WHERE id = ${runPromovido}::uuid`,
    );
    const ocultado = await listarBalancos(ctx.db);
    expect(ocultado.map((b) => b.importRunId)).not.toContain(runPromovido);
    // O censo continua lá: `hidden_at` é filtro de leitura, não invalidação.
    const { rows } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM import_run_censo WHERE import_run_id = ${runPromovido}::uuid
    `);
    expect(rows[0]!.n).toBeGreaterThan(0);

    await ctx.db.execute(
      sql`UPDATE import_run SET hidden_at = NULL WHERE id = ${runPromovido}::uuid`,
    );
    const reexibido = await listarBalancos(ctx.db);
    expect(reexibido.find((b) => b.importRunId === runPromovido)).toEqual(alvo);
  });
});

describe("retry e reprocessamento", () => {
  it("gravar o censo duas vezes não conta nenhuma célula duas vezes", async () => {
    const antes = await censoGravado(ctx.db);
    await gravarCenso(ctx.db, runPromovido);
    await gravarCenso(ctx.db, runPromovido);
    expect(Object.fromEntries(await censoGravado(ctx.db))).toEqual(
      Object.fromEntries(antes),
    );
  });

  it("um reprocessamento é outro run, com censo próprio, e não mexe no anterior", async () => {
    /*
      Reprocessar relê o mesmo `source_file` num run novo. O run anterior
      continua com o censo dele — que continua verdadeiro sobre o que ele fez —
      e o novo grava o seu. Um censo por run, nunca um compartilhado.
    */
    const censoDoAnterior = [...(await censoGravado(ctx.db))].filter(([k]) =>
      k.startsWith(runPromovido),
    );

    const reprocessado = await runDescartavel("reprocesso", runPromovido);

    // Sem RAW próprio, o censo do run novo é vazio — e é o que ele deve ser.
    await gravarCenso(ctx.db, reprocessado);
    const { rows: doNovo } = await ctx.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM import_run_censo WHERE import_run_id = ${reprocessado}::uuid
    `);
    expect(doNovo[0]!.n).toBe(0);

    // E o do anterior não foi tocado.
    expect(
      [...(await censoGravado(ctx.db))].filter(([k]) => k.startsWith(runPromovido)),
    ).toEqual(censoDoAnterior);

    await ctx.db.execute(sql`DELETE FROM import_run WHERE id = ${reprocessado}::uuid`);
  });
});

describe("o histórico anterior ao censo", () => {
  it("um run sem censo aparece na lista com os números certos, calculados na hora", async () => {
    /*
      É o caminho por onde todo o acervo passa entre o deploy e o fim do
      backfill. Ele não pode fazer o run sumir da lista nem mostrar zeros: a
      tela existe para denunciar dado que sumiu, e seria a primeira a sumir com
      um.
    */
    const esperado = await listarBalancos(ctx.db);

    await ctx.db.execute(sql`DELETE FROM import_run_censo`);
    await ctx.db.execute(sql`UPDATE import_run SET censo_calculado_em = NULL`);

    const semCenso = await listarBalancos(ctx.db);
    expect(semCenso).toEqual(esperado);

    // E o backfill devolve o estado gravado, com o mesmo resultado.
    const n = await recensearPendentes(ctx.db);
    expect(n).toBeGreaterThan(0);
    expect(await listarBalancos(ctx.db)).toEqual(esperado);
  });

  it("recensear é reentrante: a segunda passada não tem o que fazer", async () => {
    expect(await recensearPendentes(ctx.db)).toBe(0);
  });
});

describe("excluir a importação", () => {
  it("leva o censo junto, pela cascata", async () => {
    /*
      A exclusão de verdade passa por `deleteImportRun`, que purga o RAW sob o
      `set_config` que destrava o trigger de imutabilidade. O que interessa
      aqui é a única parte que esta mudança acrescentou: a cascata. Um censo que
      sobrevivesse ao run descreveria células que não existem mais, e a lista
      somaria um fantasma — então o teste usa um run descartável, sem RAW, para
      exercitar a cascata sem depender do purge.
    */
    const descartavel = await runDescartavel("cascata");
    await ctx.db.execute(sql`
      INSERT INTO import_run_censo (import_run_id, destino, celulas)
      VALUES (${descartavel}::uuid, 'FATO_PREPARADO', 42)
    `);

    const contar = async () => {
      const { rows } = await ctx.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM import_run_censo WHERE import_run_id = ${descartavel}::uuid
      `);
      return rows[0]!.n;
    };
    expect(await contar()).toBe(1);

    await ctx.db.execute(sql`DELETE FROM import_run WHERE id = ${descartavel}::uuid`);
    expect(await contar()).toBe(0);
  });
});
