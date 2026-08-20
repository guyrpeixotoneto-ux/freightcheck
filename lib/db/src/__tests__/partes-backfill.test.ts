import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readMigrations, runMigrations } from "../migrate";

/**
 * O backfill da `0044` — o cadastro de partes nasce sabendo o que já existia.
 *
 * A tabela `fechamento_parte` conserta um defeito de uso: quem digitava
 * `443 — CDD Belém` para abrir uma competência e depois excluía a importação
 * perdia o nome junto com ela, porque a lista de partes era derivada das
 * competências e de mais nada.
 *
 * A tabela sozinha não bastaria. Sem o backfill, a promessa "o nome sobrevive à
 * exclusão" valeria só para o que fosse cadastrado depois do deploy: as
 * competências abertas antes dele nunca passaram por um cadastro, e excluir uma
 * delas perderia o nome exatamente como antes. É essa metade da garantia que
 * este arquivo guarda — e ela não é conferível pelos testes de
 * `@workspace/fechamento`, que nascem de um banco recém-migrado, onde não há
 * "antes" para trazer.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_partes_backfill_${process.pid}`;
const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

async function comAdmin<T>(f: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await f(pool);
  } finally {
    await pool.end().catch(() => {});
  }
}

async function bancoAlcancavel(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const noCi = process.env.CI === "true" || process.env.CI === "1";
const temBanco = noCi || (await bancoAlcancavel());

/** A fila até `ate` (inclusive), com registro — uma Production parada ali. */
async function migradoAte(pool: pg.Pool, ate: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  for (const m of readMigrations()) {
    for (const comando of m.statements) await pool.query(comando);
    await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ($1,$2)`,
      [m.hash, m.when],
    );
    if (m.tag === ate) return;
  }
  throw new Error(`migration ${ate} não existe`);
}

describe.skipIf(!temBanco)("a 0044 sobre um banco que já tinha competências", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    await comAdmin(async (a) => {
      await a.query(`DROP DATABASE IF EXISTS "${NOME}"`);
      await a.query(`CREATE DATABASE "${NOME}"`);
    });
    pool = new pg.Pool({ connectionString: urlDe(NOME) });
    await migradoAte(pool, "0043_pagamento");

    /*
      Duas competências do mesmo CDD, com a grafia corrigida na mais recente, e
      uma terceira de outro CDD aberta só com o código. É o material que separa
      um backfill certo de um plausível: o nome tem de ser o último escrito, e
      o código sem nome não pode virar nome vazio.
    */
    const abrir = async (
      chave: string,
      mes: number,
      unidade: [string, string | null],
      abertaEm: string,
    ) =>
      pool.query(
        `INSERT INTO "fechamento_competencia"
           ("chave","ano","mes","quinzena","inicio","fim",
            "unidade_codigo","unidade_nome",
            "transportadora_codigo","transportadora_nome","aberta_em")
         VALUES ($1, 2026, $2, 1, $3, $4, $5, $6, '36', 'TRANSPORTES FICTICIA', $7)`,
        [chave, mes, `2026-0${mes}-01`, `2026-0${mes}-15`, unidade[0], unidade[1], abertaEm],
      );

    await abrir("2026-06-Q1", 6, ["443", "CDD BELEM (GRAFIA VELHA)"], "2026-06-16T00:00:00Z");
    await abrir("2026-07-Q1", 7, ["443", "CDD BELÉM"], "2026-07-16T00:00:00Z");
    await abrir("2026-08-Q1", 8, ["901", null], "2026-08-16T00:00:00Z");
  }, 300_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await comAdmin(async (a) => {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [NOME],
      );
      await a.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    });
  }, 300_000);

  it("traz para o cadastro cada código já usado, com o nome mais recente", async () => {
    const relatorio = await runMigrations(urlDe(NOME));
    expect(relatorio.failure).toBeUndefined();
    /*
      A `0044` é a primeira que a fila aplica aqui — o banco foi parado logo
      antes dela. O que vem depois acompanha, e por isso a asserção é sobre a
      **primeira**: prender a lista inteira faria toda migration futura reprovar
      um teste que não fala dela.
    */
    expect(relatorio.applied[0]).toBe("0044_partes_cadastradas");

    const { rows } = await pool.query(
      `SELECT "tipo","codigo","nome" FROM "fechamento_parte" ORDER BY "tipo","codigo"`,
    );
    expect(rows).toEqual([
      { tipo: "TRANSPORTADORA", codigo: "36", nome: "TRANSPORTES FICTICIA" },
      /* A grafia velha ficou para trás: o cadastro guarda o último nome. */
      { tipo: "UNIDADE", codigo: "443", nome: "CDD BELÉM" },
      /* E o código sem nome entra sem nome, e não com uma string vazia. */
      { tipo: "UNIDADE", codigo: "901", nome: null },
    ]);
  }, 300_000);

  it("rodar o backfill de novo não duplica nem reescreve o que já está lá", async () => {
    /*
      A fila não repete uma migration aplicada — o carimbo a impede. O que se
      confere aqui é o outro caminho: a adoção de um banco que já tem a tabela,
      onde os comandos da `0044` rodam sobre linhas existentes. Alguém corrigiu
      o nome à mão; o `ON CONFLICT DO NOTHING` não pode desfazer a correção.
    */
    await pool.query(
      `UPDATE "fechamento_parte" SET "nome" = 'CDD BELÉM (CORRIGIDO À MÃO)'
        WHERE "tipo" = 'UNIDADE' AND "codigo" = '443'`,
    );

    const zeroQuatroQuatro = readMigrations().find((m) => m.tag === "0044_partes_cadastradas")!;
    for (const comando of zeroQuatroQuatro.statements) await pool.query(comando);

    const { rows } = await pool.query(
      `SELECT "codigo","nome" FROM "fechamento_parte" WHERE "tipo" = 'UNIDADE' ORDER BY "codigo"`,
    );
    expect(rows).toEqual([
      { codigo: "443", nome: "CDD BELÉM (CORRIGIDO À MÃO)" },
      { codigo: "901", nome: null },
    ]);
  }, 300_000);
});
