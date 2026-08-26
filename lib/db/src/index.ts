import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

/**
 * Os limites do pool — números escritos, nunca os defaults do driver.
 *
 * O default do `pg` é esperar **para sempre** por uma conexão livre e deixar
 * uma query rodar **para sempre**. Com dez conexões e uma consulta travada, o
 * efeito era o produto inteiro pendurado em silêncio — inclusive o check de
 * sessão, que roda em toda chamada. Um limite estourado vira erro nomeado no
 * log e um 500 com requestId; a espera infinita não vira nada.
 *
 * `statement_timeout` largo de propósito: a promoção de uma vigência grande é
 * uma transação legítima de dezenas de segundos, e um teto apertado a mataria
 * no meio. Migrations e reconvergência não passam por aqui — abrem conexão
 * própria — e continuam sem teto, porque backfill longo é trabalho, não
 * travamento.
 */
function limite(nome: string, padrao: number): number {
  const bruto = Number(process.env[nome]);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : padrao;
}

export function opcoesDoPool(): pg.PoolConfig {
  return {
    max: limite("DB_POOL_MAX", 10),
    connectionTimeoutMillis: limite("DB_CONNECT_TIMEOUT_MS", 10_000),
    idleTimeoutMillis: limite("DB_IDLE_TIMEOUT_MS", 30_000),
    statement_timeout: limite("DB_STATEMENT_TIMEOUT_MS", 120_000),
  };
}

/**
 * Build an isolated connection. Tests use this to talk to a scratch database
 * without touching the process-wide `db` below.
 */
export function createDb(connectionString: string): {
  db: Database;
  pool: pg.Pool;
} {
  const pool = new Pool({ connectionString, ...opcoesDoPool() });
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
 * O erro do Postgres, com os campos que o protocolo carrega além do SQLSTATE.
 *
 * Só os que alguém lê. `routine` é o menos óbvio e o mais útil: é o nome da
 * função do fonte do Postgres que levantou o erro (campo `R` da resposta), e
 * ele **não é traduzido** — o que o torna a única forma não-textual de separar
 * dois erros que compartilham o mesmo SQLSTATE. Ver `faltaSchema`, que precisa
 * exatamente disso para o `42P10`.
 */
export interface ErroDoPostgres {
  code: string;
  routine?: string;
  constraint?: string;
  position?: string;
  message?: string;
}

/**
 * O erro do Postgres dentro do que o embrulhou.
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
export function erroDoPostgres(err: unknown): ErroDoPostgres | undefined {
  let atual: unknown = err;
  for (let nivel = 0; nivel < 5; nivel++) {
    if (typeof atual !== "object" || atual === null) return undefined;
    const code = (atual as { code?: unknown }).code;
    if (typeof code === "string") return atual as ErroDoPostgres;
    atual = (atual as { cause?: unknown }).cause;
  }
  return undefined;
}

/** O SQLSTATE, quando só ele importa. */
export function codigoDoPostgres(err: unknown): string | undefined {
  return erroDoPostgres(err)?.code;
}

export * from "./schema";
export * from "./fato-visivel";
export * from "./unidade";
/*
  A invariante mora aqui, e não na curadoria, porque quem a precisa são dois
  pacotes que não podem se importar: a importação cria o atributo, a curadoria
  lê e escreve a versão dele. Foi essa fronteira que deixou a versão 1 órfã.
*/
export * from "./semantica-inicial";
export * from "./integridade-semantica";
/*
  E o registro das confirmações canônicas pelo mesmo motivo, um degrau adiante:
  a versão 1 nascia órfã de *versão*, e nascia órfã de *significado* — a lista
  de decisões que a destrava era chamada só pela curadoria. Ver
  `semantica-confirmada.ts`.
*/
export * from "./semantica-confirmada";
/*
  E a árvore da taxonomia, pelo mesmo motivo e no mesmo lugar: são os mesmos
  22 nós em toda base, a importação precisa deles para vincular o que confirma
  e a curadoria precisa deles para que exista o que escolher na tela.
*/
export * from "./taxonomia-canonica";
