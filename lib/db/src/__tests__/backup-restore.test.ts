import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { runMigrations } from "../migrate";
import {
  fazerBackup,
  listarBackups,
  restaurarBackup,
  ultimoBackup,
} from "../backup";

/**
 * A prova do backup é o restore — um dump que nunca voltou não é cópia, é fé.
 *
 * O ciclo inteiro roda aqui, contra Postgres real: banco criado pela fila
 * versionada, dado dentro (inclusive bytea, onde truncamento aparece primeiro),
 * `pg_dump` para o diretório, `pg_restore` num banco novo e VAZIO, e a
 * conferência do que voltou — linhas, bytes e os objetos que o drizzle não
 * modela (função de trigger da imutabilidade), porque foram exatamente eles
 * que o Provision derrubou e ninguém tinha de onde repor.
 *
 * Sem `pg_dump` no PATH este arquivo NÃO pula: com banco disponível e binário
 * ausente, a resposta certa é vermelho — um ambiente de CI que não consegue
 * provar o restore é um achado, não um detalhe.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

let sequencia = 0;
const criados: string[] = [];
const dirs: string[] = [];

async function comAdmin<T>(fn: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function bancoNovo(): Promise<{ nome: string; url: string }> {
  const nome = `fc_backup_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  return { nome, url: urlDe(nome) };
}

function dirNovo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fc-backup-"));
  dirs.push(dir);
  return dir;
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
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 300_000);

describe("o ciclo dump → restore devolve o banco inteiro", () => {
  it("pg_dump e pg_restore existem e falam a versão do servidor", () => {
    // Falha nomeada em vez de um erro de spawn ilegível três testes depois.
    const versao = execFileSync("pg_dump", ["--version"], { encoding: "utf8" });
    expect(versao).toMatch(/pg_dump \(PostgreSQL\) \d+/);
  });

  it(
    "migra, escreve, copia, restaura num banco vazio e confere o que voltou",
    async () => {
      const origem = await bancoNovo();
      expect((await runMigrations(origem.url)).failure).toBeUndefined();

      // Dado com as três naturezas que o restore pode perder: linhas comuns,
      // bytes (bytea) e um carimbo de auditoria.
      const conteudo = Buffer.from(
        Array.from({ length: 4096 }, (_, i) => i % 251),
      );
      const pool = new pg.Pool({ connectionString: origem.url });
      try {
        await pool.query(
          `INSERT INTO app_user (name, email, password_hash, created_by)
           VALUES ('Prova Restore', 'prova@restore.local', 'scrypt$fake', 'teste')`,
        );
        await pool.query(
          `INSERT INTO book_entry
             (block_key, block_category, block_title, kind, revision, filename,
              content, mime_type, byte_size, content_sha256, created_by)
           VALUES ('prova.backup', 'PROVA', 'Prova de restore', 'DOCUMENTO', 1,
                   'prova.bin', $1, 'application/octet-stream', $2,
                   repeat('b', 64), 'teste')`,
          [conteudo, conteudo.length],
        );
      } finally {
        await pool.end();
      }

      const dir = dirNovo();
      const resultado = await fazerBackup({ databaseUrl: origem.url, dir });
      expect(resultado.bytes).toBeGreaterThan(0);
      expect(statSync(resultado.arquivo).size).toBe(resultado.bytes);
      expect(ultimoBackup(dir)?.arquivo).toBe(resultado.arquivo);

      const destino = await bancoNovo();
      await restaurarBackup({ databaseUrl: destino.url, arquivo: resultado.arquivo });

      const restaurado = new pg.Pool({ connectionString: destino.url });
      try {
        // As linhas voltaram, com o conteúdo byte a byte.
        const usuario = await restaurado.query(
          `SELECT name FROM app_user WHERE email = 'prova@restore.local'`,
        );
        expect(usuario.rows).toHaveLength(1);

        const book = await restaurado.query<{ content: Buffer }>(
          `SELECT content FROM book_entry WHERE block_key = 'prova.backup'`,
        );
        expect(Buffer.compare(book.rows[0].content, conteudo)).toBe(0);

        // Os objetos que o drizzle não modela — a razão de o formato ser
        // pg_dump, e não um SELECT caseiro: função de trigger da imutabilidade
        // e o registro de migrations.
        const funcao = await restaurado.query(
          `SELECT 1 FROM pg_proc WHERE proname = 'freightcheck_raw_is_immutable'`,
        );
        expect(funcao.rows).toHaveLength(1);

        const registro = await restaurado.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM drizzle.__drizzle_migrations`,
        );
        expect(Number(registro.rows[0].n)).toBeGreaterThan(0);

        // E o banco restaurado continua se defendendo: o trigger de
        // imutabilidade veio junto e recusa UPDATE em RAW.
        await restaurado.query(
          `INSERT INTO source_file (filename, byte_size, content_sha256, storage_path, received_by)
           VALUES ('prova.xlsx', 10, repeat('a', 64), '/tmp/prova.xlsx', 'teste')`,
        );
        await expect(
          restaurado.query(`UPDATE source_file SET filename = 'outra.xlsx'`),
        ).rejects.toThrow(/immutable|imut/i);
      } finally {
        await restaurado.end();
      }
    },
    120_000,
  );

  it("a poda mantém a retenção e nunca conta um parcial como backup", async () => {
    const origem = await bancoNovo();
    expect((await runMigrations(origem.url)).failure).toBeUndefined();

    const dir = dirNovo();
    // Três "backups antigos" forjados com nomes válidos e datas antigas…
    for (let i = 0; i < 3; i++) {
      const nome = path.join(dir, `freightcheck-2020010${i + 1}-000000.dump`);
      writeFileSync(nome, `antigo ${i}`);
      const quando = new Date(2020, 0, i + 1);
      utimesSync(nome, quando, quando);
    }
    // …e um parcial, que a listagem tem de ignorar.
    writeFileSync(path.join(dir, "freightcheck-20200104-000000.dump.parcial"), "meio");

    expect(listarBackups(dir)).toHaveLength(3);

    const resultado = await fazerBackup({ databaseUrl: origem.url, dir, retencao: 2 });
    const restantes = listarBackups(dir);
    expect(restantes).toHaveLength(2);
    expect(restantes[0].arquivo).toBe(resultado.arquivo);
    expect(resultado.podados).toBe(2);
  }, 60_000);
});
