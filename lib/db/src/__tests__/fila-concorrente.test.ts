import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readMigrations, runMigrations } from "../migrate";
import { migrarComReparo } from "../fila";

/**
 * Várias instâncias subindo juntas contra o mesmo banco.
 *
 * ---------------------------------------------------------------------------
 * Por que isto precisa estar provado, e não só afirmado
 * ---------------------------------------------------------------------------
 * O deployment deste serviço é `autoscale`: no Publishing, mais de uma
 * instância sobe ao mesmo tempo, e **todas** chamam a fila na partida. O
 * `pg_advisory_lock` em `runMigrations` existe exatamente para isso, e a sua
 * correção nunca foi exercitada — era uma afirmação num comentário.
 *
 * Ela passou a sustentar mais coisa. O portão de prontidão
 * (`artifacts/api-server/src/lib/prontidao.ts`) recusa tráfego de produto até o
 * banco convergir, e a convergência é obra da fila: se duas instâncias
 * disputassem a fila e uma delas morresse na disputa, o portão daquela ficaria
 * fechado por um defeito nosso — indisponibilidade fabricada pelo mecanismo
 * que existe para evitar indisponibilidade.
 *
 * ---------------------------------------------------------------------------
 * O que se prova
 * ---------------------------------------------------------------------------
 * Com quatro chamadas concorrentes sobre um banco parado na `0054`:
 *
 *   1. nenhuma falha — a que espera encontra o trabalho feito e segue;
 *   2. a `0055` é aplicada **uma vez só**, e o carimbo dela não duplica;
 *   3. exatamente uma das chamadas a aplica; as outras a veem já aplicada;
 *   4. o efeito da migration está lá, inteiro — a lista fechada nova.
 *
 * O portão não entra na disputa: ele só **lê**. É por isso que fechá-lo não
 * precisou de lock nenhum, e é o que este arquivo também deixa registrado.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const temBanco = Boolean(
  process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
);

const ANTES_DA_0055 = "0054_regra_de_alteracao";
const A_0055 = "0055_disponibilidade_por_frota";

const criados: string[] = [];

async function comAdmin<T>(fn: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/** Um banco com a fila até a `0054`, com registro — a Production daquele dia. */
async function bancoNa0054(sufixo: string): Promise<string> {
  const nome = `fc_concorrente_${process.pid}_${sufixo}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);

  const url = ADMIN.replace(/\/[^/?]*(\?|$)/, `/${nome}$1`);
  const pool = new pg.Pool({ connectionString: url });
  try {
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
      if (m.tag === ANTES_DA_0055) break;
    }
  } finally {
    await pool.end();
  }
  return url;
}

afterAll(async () => {
  if (!temBanco) return;
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a
        .query(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`)
        .catch(() => undefined);
    }
  });
});

describe.skipIf(!temBanco)("quatro instâncias sobem juntas", () => {
  it("a fila é serializada: ninguém falha, e a 0055 entra uma vez só", async () => {
    const url = await bancoNa0054("fila");

    /*
      Sem `await` entre elas: as quatro entram na fila no mesmo instante, que é
      o que o autoscale faz. Uma pega o lock; as outras esperam nele — e não
      falham esperando, que é a diferença entre `pg_advisory_lock` e um
      `try_lock` que desiste.
    */
    const relatorios = await Promise.all([
      runMigrations(url),
      runMigrations(url),
      runMigrations(url),
      runMigrations(url),
    ]);

    for (const r of relatorios) {
      expect(r.failure, JSON.stringify(r.failure)).toBeUndefined();
    }

    /* Exatamente uma aplicou; as outras encontraram o trabalho feito. */
    const aplicaram = relatorios.filter((r) => r.applied.includes(A_0055));
    const acharamPronta = relatorios.filter((r) =>
      r.alreadyApplied.includes(A_0055),
    );
    expect(aplicaram).toHaveLength(1);
    expect(acharamPronta).toHaveLength(3);

    const pool = new pg.Pool({ connectionString: url });
    try {
      /* O carimbo não duplica: a fila decide por ele, e um registro duplo
         faria a próxima leitura contar migrations que não existem. */
      const { rows: carimbos } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "drizzle"."__drizzle_migrations"
          WHERE created_at = $1`,
        [readMigrations().find((m) => m.tag === A_0055)!.when],
      );
      expect(Number(carimbos[0]!.n)).toBe(1);

      /* E o efeito está inteiro — é o que o portão vai medir para abrir. */
      const { rows: check } = await pool.query<{ d: string }>(
        `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
          WHERE conname = 'fechamento_documento_tipo'`,
      );
      expect(check[0]!.d).toContain("DISPONIBILIDADE_FF");
      expect(check[0]!.d).toContain("DISPONIBILIDADE_VAN");
      expect(check[0]!.d).not.toContain("'DISPONIBILIDADE'::text");
    } finally {
      await pool.end();
    }
  }, 300_000);

  it("o mesmo vale pela porta que a partida usa — migrarComReparo", async () => {
    /*
      A partida não chama `runMigrations` direto: chama `migrarComReparo`, que
      a envolve. Provar só a de dentro deixaria de fora a camada que roda de
      verdade em Production — e é ela que, num banco íntegro, precisa ser
      inerte além da fila.
    */
    const url = await bancoNa0054("reparo");

    const desfechos = await Promise.all([
      migrarComReparo(url),
      migrarComReparo(url),
      migrarComReparo(url),
      migrarComReparo(url),
    ]);

    for (const d of desfechos) {
      expect(d.report.failure, JSON.stringify(d.report.failure)).toBeUndefined();
      /* Num banco íntegro o reparo é um não-evento: ele só roda se a fila
         parar, e aqui nenhuma parou. */
      expect(d.reparo).toBeUndefined();
    }
    expect(desfechos.filter((d) => d.report.applied.includes(A_0055))).toHaveLength(1);
  }, 300_000);
});
