import { afterAll, describe, expect, it } from "vitest";
import { readMigrations } from "@workspace/db/migrate";
import { migrarComReparo } from "@workspace/db/fila";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { observarBanco } from "../migrations";

/**
 * `observarBanco` — e o campo novo, `aFrente` — depois de duas instâncias
 * disputando o `pg_advisory_lock` ao mesmo tempo.
 *
 * `lib/db/src/__tests__/fila-concorrente.test.ts` já prova o lock em si:
 * ninguém falha, um carimbo só, o efeito inteiro. O que faltava provar é a
 * leitura que `/api/startupz` e o portão dependem — `observarBanco`, deste
 * pacote — depois dessa disputa: nem pendência fantasma, nem `aFrente`
 * fantasma pelo simples fato de duas escritas terem corrido ao mesmo tempo.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const temBanco = Boolean(
  process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
);

const NOME = `fc_test_observar_concorrente_${process.pid}`;
const criados: string[] = [];

async function comAdmin<T>(fn: (p: ReturnType<typeof createDb>["pool"]) => Promise<T>): Promise<T> {
  const { pool } = createDb(ADMIN);
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

afterAll(async () => {
  await encerrarPoolDoProcesso().catch(() => {});
  if (!temBanco) return;
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a
        .query(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`)
        .catch(() => undefined);
    }
  });
});

describe.skipIf(!temBanco)(
  "observarBanco depois de duas instâncias disputando o lock",
  () => {
    it("banco em dia — sem pendência fantasma, sem aFrente fantasma", async () => {
      await comAdmin(async (a) => {
        await a.query(`DROP DATABASE IF EXISTS "${NOME}"`);
        await a.query(`CREATE DATABASE "${NOME}"`);
      });
      criados.push(NOME);
      const url = ADMIN.replace(/\/[^/?]*(\?|$)/, `/${NOME}$1`);

      /*
        Duas "instâncias" — sem `await` entre elas, o mesmo desenho do arquivo
        irmão — aplicando a fila inteira, do zero, ao mesmo banco.
      */
      const desfechos = await Promise.all([
        migrarComReparo(url),
        migrarComReparo(url),
      ]);
      for (const d of desfechos) {
        expect(d.report.failure, JSON.stringify(d.report.failure)).toBeUndefined();
      }

      process.env.DATABASE_URL = url;
      const observado = await observarBanco(url);

      expect(observado.pendentes).toEqual([]);
      expect(observado.aFrente ?? []).toEqual([]);
      expect(observado.aplicadas).toBe(readMigrations().length);

      const { pool } = createDb(url);
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "drizzle"."__drizzle_migrations"`,
      );
      expect(Number(rows[0]!.n)).toBe(readMigrations().length);
      await pool.end();
    }, 300_000);
  },
);
