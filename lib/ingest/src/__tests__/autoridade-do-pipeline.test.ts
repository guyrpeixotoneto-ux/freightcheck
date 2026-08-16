import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  createDb,
  escritaNaoAutorizada,
  factTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import { modelExportPaths } from "../testing";
import { captureRaw, preview, promote, receiveFile, stage } from "../pipeline";
import { deleteImportRun } from "../deletion";

/**
 * O pipeline real, por uma conexão sem concessão nenhuma.
 *
 * As demais suítes usam `createTestDatabase`, que concede `FIXTURE_DE_TESTE` ao
 * banco descartável — necessário, porque os fixtures montam a camada canônica
 * direto. O efeito colateral é que **nenhuma delas exerce a autoridade**: tudo
 * passa, com ou sem ela.
 *
 * Esta suíte fecha esse buraco. O banco aqui é criado por `createDb` cru,
 * exatamente como o processo do servidor o cria em produção, e sobre ele roda o
 * export de verdade, do arquivo à vigência fechada. Se a autoridade estivesse
 * declarada no lugar errado — ou faltando —, a importação falharia aqui e em
 * nenhum outro lugar da suíte.
 *
 * É a prova dos dois lados ao mesmo tempo: a porta continua abrindo, e não há
 * segunda porta.
 */

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_test_autoridade_pipeline_${process.pid}`;

let db: Database;
let encerrar: () => Promise<void>;
let importRunId: string;

beforeAll(async () => {
  const admin = createDb(ADMIN_URL);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.pool.query(`CREATE DATABASE "${NOME}"`);
  await admin.pool.end();

  const url = ADMIN_URL.replace("/postgres?", `/${NOME}?`);
  await runMigrations(url);

  /* Sem concessão. É esta linha que faz a prova valer para produção. */
  const criada = createDb(url);
  db = criada.db;
  encerrar = async () => {
    await criada.pool.end();
    const limpeza = createDb(ADMIN_URL);
    await limpeza.pool.query(`DROP DATABASE IF EXISTS "${NOME}" WITH (FORCE)`);
    await limpeza.pool.end();
  };
}, 600_000);

afterAll(async () => {
  await encerrar?.().catch(() => {});
}, 60_000);

describe("a porta de Importações continua abrindo sob a autoridade", () => {
  it("recebe, lê, confere e promove o export real — sem concessão na conexão", async () => {
    const { carreta } = modelExportPaths();
    const recebido = await receiveFile(db, { filePath: carreta });
    importRunId = recebido.importRunId;

    await captureRaw(db, importRunId);
    await stage(db, importRunId);
    const relatorio = await preview(db, importRunId);

    const resultado = await promote(db, importRunId, {
      confirmNewEntityTypes: relatorio.pendingIdentities,
    });

    expect(resultado.snapshots.length).toBeGreaterThan(0);

    const { rows } = await db.execute<{ fatos: number; vigencias: number }>(sql`
      SELECT (SELECT count(*)::int FROM fact)     AS fatos,
             (SELECT count(*)::int FROM snapshot) AS vigencias
    `);
    expect(Number(rows[0].fatos)).toBeGreaterThan(0);
    expect(Number(rows[0].vigencias)).toBeGreaterThan(0);
  }, 600_000);

  it("e mesmo depois dela, quem não é a porta continua sem escrever", async () => {
    // A autoridade da promoção morre com ela. Se vazasse — por uma variável de
    // módulo, digamos —, esta escrita passaria justamente por ter havido uma
    // importação antes, que é o pior modo de falhar: intermitente e dependente
    // da ordem.
    const resultado = await db
      .insert(factTable)
      .values({
        snapshotId: "00000000-0000-0000-0000-000000000000",
        entityId: "00000000-0000-0000-0000-000000000000",
        attributeId: "00000000-0000-0000-0000-000000000000",
        valueHash: "x",
        rawCellId: 1,
      })
      .then(() => null, (e: unknown) => e);

    expect(escritaNaoAutorizada(resultado)?.tabela).toBe("fact");
  }, 60_000);

  it("a exclusão de importação também tem a autoridade — desfazer é da mesma porta", async () => {
    const resultado = await deleteImportRun(db, importRunId, {
      deletedBy: "teste:autoridade",
      reason: "prova de que a porta desfaz o que fez",
    });
    expect(resultado.removed.facts).toBeGreaterThan(0);

    const { rows } = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM fact`,
    );
    expect(Number(rows[0].n)).toBe(0);
  }, 600_000);
});
