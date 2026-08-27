import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";

/**
 * **Depois do teto de rota, o processo ainda consegue desligar.**
 *
 * `comTetoDeRota` pega uma conexão avulsa do pool, aperta o `statement_timeout`
 * nela e a devolve no fim. O "como devolver" parece detalhe e não é: descartar a
 * conexão (`release(true)`) deixava o pool com um cliente que ele nunca dá por
 * encerrado, e `pool.end()` passava a esperar para sempre.
 *
 * O que isso custa em produção é o desligamento gracioso: bastava **uma**
 * requisição em `/changes/latest` para o processo parar de terminar sozinho —
 * ele fica pendurado até alguém matá-lo, e um deploy que espera o encerramento
 * limpo espera junto. O defeito não tinha teste porque nenhuma suíte fechava o
 * pool depois de exercitar essa rota; a de isolamento por operação foi a
 * primeira, e foi lá que ele apareceu.
 *
 * O caso abaixo é o defeito reduzido ao osso — sem Express, sem rota, sem
 * fixture: uma consulta com teto, o pool fechado em seguida, e um prazo. Se o
 * `end()` voltar a pendurar, é aqui que se vê.
 */

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("teto_de_rota_pool");
  process.env.DATABASE_URL = ctx.url;
}, 120_000);

afterAll(async () => {
  await ctx?.drop().catch(() => {});
});

it("devolve a conexão de modo que o pool ainda feche", async () => {
  const { comTetoDeRota } = await import("../lib/timeout-de-rota");
  const { encerrarPoolDoProcesso } = await import("@workspace/db");

  await comTetoDeRota(5_000, async (db) => {
    await db.execute(sql`SELECT 1`);
  });

  const desfecho = await Promise.race([
    encerrarPoolDoProcesso().then(() => "encerrou" as const),
    new Promise<"pendurou">((resolve) => setTimeout(() => resolve("pendurou"), 5_000)),
  ]);

  expect(desfecho).toBe("encerrou");
}, 60_000);
