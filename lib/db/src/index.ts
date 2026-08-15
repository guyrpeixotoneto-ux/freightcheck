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
 * Encerra o pool do processo e esquece dele.
 *
 * **Por que não `pool.end()`.** O `pool` acima é um Proxy que encaminha
 * *leituras* e nada mais: um método obtido por ele roda com `this` apontando
 * para o Proxy, e as escritas que `end()` faz em si mesmo (`ending`, a fila de
 * clientes) caem no alvo vazio em vez de no pool de verdade. Chamar
 * `pool.end()` não encerra nada, e não avisa.
 *
 * **Por que isso importa fora de teste.** Quem troca `DATABASE_URL` em tempo de
 * execução — os testes que sobem um banco descartável e apontam as rotas para
 * ele — precisa devolver as conexões antes de derrubar o banco. Sem isto sobra
 * o recurso do Postgres: matar as conexões por fora, o que faz o `pg` emitir
 * `57P01` em cada cliente que estava aberto. Nove testes passam e a suíte falha
 * no desligamento, com quatro exceções não tratadas e nenhuma pista.
 *
 * Esquecer o pool é parte do contrato: a próxima leitura de `db` reconecta,
 * com a `DATABASE_URL` que valer naquele momento.
 */
export async function encerrarPoolDoProcesso(): Promise<void> {
  const atual = _pool;
  _pool = undefined;
  _db = undefined;
  if (atual) await atual.end();
}

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
