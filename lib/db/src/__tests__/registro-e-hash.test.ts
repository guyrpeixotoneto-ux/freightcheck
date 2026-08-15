import { afterAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readMigrations, runMigrations } from "../migrate";

/**
 * O que `drizzle.__drizzle_migrations` guarda, e o que acontece quando o
 * arquivo de uma migration já aplicada muda.
 *
 * A pergunta é prática e apareceu duas vezes neste projeto: a reentrância das
 * `0000`–`0012` reescreveu treze arquivos que Development já tinha aplicado, e
 * uma guarda de tipo quase foi acrescentada à `0017` pelo mesmo caminho. Se o
 * runner decidisse por conteúdo, qualquer uma dessas edições faria a migration
 * rodar de novo — e uma que roda de novo num banco que já a tem é o defeito que
 * a reentrância existe para tolerar, não para provocar.
 *
 * O que estas provas fixam:
 *
 * 1. o registro guarda **hash e carimbo**, e o carimbo é a chave de decisão;
 * 2. editar o arquivo de uma migration aplicada **não** a faz rodar de novo;
 * 3. e o preço disso, que é real e precisa estar escrito: o hash gravado deixa
 *    de bater com o arquivo. Nenhum caminho deste repositório lê esse hash, mas
 *    ele fica divergente, e é por isso que editar migration aplicada é exceção
 *    — não conveniência.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);
const PASTA = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

let sequencia = 0;
const criados: string[] = [];

async function comAdmin<T>(fn: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function bancoNovo(): Promise<{ url: string; pool: pg.Pool }> {
  const nome = `fc_hash_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const url = urlDe(nome);
  return { url, pool: new pg.Pool({ connectionString: url }) };
}

afterAll(async () => {
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [nome],
      );
      await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    }
  });
}, 300_000);

describe("drizzle.__drizzle_migrations", () => {
  it("guarda hash e carimbo, um por migration do disco", async () => {
    const { url, pool } = await bancoNovo();
    expect((await runMigrations(url)).failure).toBeUndefined();

    const { rows: colunas } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='drizzle' AND table_name='__drizzle_migrations'
        ORDER BY column_name`,
    );
    expect(colunas.map((c) => c.column_name)).toEqual([
      "created_at",
      "hash",
      "id",
    ]);

    const { rows } = await pool.query<{ hash: string; created_at: string }>(
      `SELECT hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at`,
    );
    const disco = readMigrations();
    expect(rows).toHaveLength(disco.length);

    // O carimbo é o `when` do journal; o hash é o SHA-256 do arquivo inteiro,
    // a mesma conta que o migrator do drizzle faz.
    expect(rows.map((r) => Number(r.created_at))).toEqual(disco.map((m) => m.when));
    expect(rows.map((r) => r.hash)).toEqual(disco.map((m) => m.hash));
    for (const m of disco) {
      const conteudo = readFileSync(path.join(PASTA, `${m.tag}.sql`), "utf8");
      expect(m.hash).toBe(createHash("sha256").update(conteudo).digest("hex"));
    }
    await pool.end();
  }, 600_000);

  it("a decisão de rodar é pelo carimbo, não pelo conteúdo", async () => {
    const { url, pool } = await bancoNovo();
    expect((await runMigrations(url)).failure).toBeUndefined();

    // Uma migration aplicada, com hash trocado no registro — simula exatamente
    // o efeito de editar o arquivo depois de aplicá-lo.
    const alvo = readMigrations().at(-1)!;
    await pool.query(
      `UPDATE "drizzle"."__drizzle_migrations" SET hash = 'conteudo-diferente' WHERE created_at = $1`,
      [alvo.when],
    );

    const segunda = await runMigrations(url);
    expect(segunda.failure).toBeUndefined();
    // Não rodou de novo, não foi adotada, e não reclamou: o hash não é lido.
    expect(segunda.applied).toEqual([]);
    expect(segunda.adopted).toEqual([]);
    expect(segunda.alreadyApplied).toContain(alvo.tag);

    // E o preço: o registro segue divergente do disco, em silêncio.
    const { rows } = await pool.query<{ hash: string }>(
      `SELECT hash FROM "drizzle"."__drizzle_migrations" WHERE created_at = $1`,
      [alvo.when],
    );
    expect(rows[0]!.hash).toBe("conteudo-diferente");
    expect(rows[0]!.hash).not.toBe(alvo.hash);
    await pool.end();
  }, 600_000);

  it("carimbo ausente é o que faz uma migration entrar", async () => {
    const { url, pool } = await bancoNovo();
    expect((await runMigrations(url)).failure).toBeUndefined();

    const alvo = readMigrations().at(-1)!;
    await pool.query(
      `DELETE FROM "drizzle"."__drizzle_migrations" WHERE created_at = $1`,
      [alvo.when],
    );

    const segunda = await runMigrations(url);
    expect(segunda.failure).toBeUndefined();
    // Roda de novo — e atravessa, porque é reentrante. É a mesma propriedade
    // que destrava um banco com o registro perdido.
    expect(segunda.applied).toEqual([alvo.tag]);
    await pool.end();
  }, 600_000);
});
