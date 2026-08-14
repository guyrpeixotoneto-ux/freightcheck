import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

/**
 * Build an isolated connection. Tests use this to talk to a scratch database
 * without touching the process-wide `db` below.
 */
export function createDb(connectionString: string): {
  db: Database;
  pool: pg.Pool;
} {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool, { schema }), pool };
}

let _pool: pg.Pool | undefined;
let _db: Database | undefined;

function connect() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL must be set. Did you forget to provision a database?",
    );
  }
  if (!_pool || !_db) {
    const created = createDb(process.env.DATABASE_URL);
    _pool = created.pool;
    _db = created.db;
  }
  return { db: _db, pool: _pool };
}

/**
 * Lazy proxies: importing this module no longer requires DATABASE_URL to be
 * set, only *using* the connection does. Keeps schema-only importers (and the
 * migration tooling) from needing a live database.
 */
export const db: Database = new Proxy({} as Database, {
  get(_t, prop) {
    return Reflect.get(connect().db as object, prop);
  },
});

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_t, prop) {
    return Reflect.get(connect().pool as object, prop);
  },
});

/**
 * O SQLSTATE de um erro do Postgres — procurado também dentro do que o
 * embrulhou.
 *
 * O drizzle não deixa o erro do `pg` subir cru: ele o envolve num
 * `DrizzleQueryError` com a consulta e os parâmetros, e põe o original em
 * `cause`. Quem só olhasse a superfície nunca acharia código nenhum — foi por
 * isso que o `23505` que uma rota tratava para transformar uma corrida de
 * gravação num 409 com instrução voltou a responder "Internal server error"
 * quando o drizzle passou a embrulhar.
 *
 * A cadeia é percorrida com um limite: `cause` é campo livre, e um ciclo nele
 * não pode virar laço infinito dentro de um `catch`.
 */
export function codigoDoPostgres(err: unknown): string | undefined {
  let atual: unknown = err;
  for (let nivel = 0; nivel < 5; nivel++) {
    if (typeof atual !== "object" || atual === null) return undefined;
    const code = (atual as { code?: unknown }).code;
    if (typeof code === "string") return code;
    atual = (atual as { cause?: unknown }).cause;
  }
  return undefined;
}

export * from "./schema";
