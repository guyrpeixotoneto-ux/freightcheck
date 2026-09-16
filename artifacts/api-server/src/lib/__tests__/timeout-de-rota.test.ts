import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { encerrarPoolDoProcesso, pool } from "@workspace/db";
import { comTetoDeRota } from "../timeout-de-rota";

/**
 * `comTetoDeRota` — e a conexão que ela devolve ao pool.
 *
 * ---------------------------------------------------------------------------
 * A regressão que este arquivo guarda
 * ---------------------------------------------------------------------------
 * O bloco `finally` de `comTetoDeRota` tinha um caminho de exceção que
 * descartava a conexão (`release(true)`), e o cabeçalho daquele arquivo já
 * media a consequência: no `pg` 8.22 uma conexão descartada assim deixa o pool
 * com uma que ele **nunca dá por encerrada** — `pool.end()` fica esperando para
 * sempre. Em produção é o processo que não desliga sozinho.
 *
 * O caminho de exceção existia para "conexão já morta ou transação abortada", e
 * a transação abortada não era o caso raro: é o caso **normal** quando o teto
 * estoura. `SET statement_timeout` vale para a sessão, `computeChangeSet` abre
 * transação por conta própria, e quando o teto mata a consulta lá dentro
 * (`57014`) a transação fica abortada — estado em que toda consulta seguinte,
 * o próprio `RESET` inclusive, falha com `25P02`. Ou seja: o teto disparar
 * levava direto ao descarte, e o descarte ao pool que não fecha.
 *
 * Foi assim que apareceu — `monitor-custo-fixo-candidatos.test.ts` é a suíte
 * mais pesada sob esse teto, e o `afterAll` dela estourou os 60s esperando o
 * `encerrarPoolDoProcesso` de um pool que nunca encerraria.
 *
 * ---------------------------------------------------------------------------
 * Por que estes casos não precisam de acervo
 * ---------------------------------------------------------------------------
 * Porque a pergunta é sobre a conexão, e não sobre dado nenhum: basta um
 * banco vazio de pé. O `beforeAll` cria um, e nada mais — sem importar
 * arquivo, sem curadoria, sem criar tabela. É por isso que este arquivo custa
 * segundos onde os de rota custam minutos.
 *
 * O `pool.end()` é do processo inteiro, então ele fica no fim, num `afterAll`.
 */

/** Uma consulta que estoura qualquer teto apertado. */
const DEMORADA = "SELECT pg_sleep(1)";

let ctx: TestDb;

beforeAll(async () => {
  ctx = await createTestDatabase("api_timeout_de_rota");
  /* O pool do processo é quem `comTetoDeRota` usa, e ele lê daqui. */
  process.env.DATABASE_URL = ctx.url;
}, 120_000);

afterAll(async () => {
  /*
    O que este arquivo prova é que o pool **fecha**. Se a correção regredir,
    aqui é onde a suíte trava em vez de falhar — por isso a corrida com o
    relógio: uma falha nomeada vale mais do que um timeout de hook.
  */
  const travou = await Promise.race([
    encerrarPoolDoProcesso().then(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(true), 15_000)),
  ]);
  expect(travou, "pool.end() não resolveu — a conexão ficou pendurada").toBe(false);
  await ctx?.pool.end().catch(() => {});
}, 30_000);

describe("comTetoDeRota devolve a conexão inteira", () => {
  /* O caminho de sempre, que continua o de sempre. */
  it("a conexão volta ao pool com o teto desfeito", async () => {
    await comTetoDeRota(5_000, async () => {});

    const client = await pool.connect();
    const { rows } = await client.query<{ statement_timeout: string }>(
      "SHOW statement_timeout",
    );
    client.release();
    /* O teto de 5s não pegou carona: a próxima rota recebe o do pool. */
    expect(rows[0]?.statement_timeout).not.toBe("5s");
  }, 30_000);

  /**
   * O caso que quebrava: o teto estoura **dentro de uma transação**.
   *
   * É o que acontece em produção quando `computeChangeSet` roda sob um teto
   * curto. A transação fica abortada, e a conexão precisa voltar mesmo assim.
   */
  it("o teto que estoura dentro de uma transação não pendura a conexão", async () => {
    const antes = pool.totalCount;

    await expect(
      comTetoDeRota(200, async (db) => {
        await db.execute("BEGIN" as never);
        await db.execute(DEMORADA as never);
      }),
    ).rejects.toThrow();

    /*
      A conexão voltou: o pool não perdeu nenhuma. Era aqui que ela sumia —
      descartada, e com ela a promessa de `pool.end()` resolver.
    */
    expect(pool.totalCount).toBe(antes);
    expect(pool.idleCount).toBeGreaterThan(0);

    /* E ela volta **usável**, não em transação abortada. */
    const client = await pool.connect();
    const { rows } = await client.query<{ um: number }>("SELECT 1 AS um");
    client.release();
    expect(rows[0]?.um).toBe(1);
  }, 30_000);

  /* O teto continua valendo — a correção não afrouxou o que ele protege. */
  it("o teto ainda mata a consulta que passa dele", async () => {
    const erro = await comTetoDeRota(200, async (db) => {
      await db.execute(DEMORADA as never);
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(erro).not.toBeNull();
    /*
      `57014` é `query_canceled` — o teto disparando, e não outra falha
      qualquer. O drizzle embrulha o erro do `pg` numa mensagem própria
      ("Failed query: …"), então o código vem no `cause`; afirmar sobre a
      mensagem de fora prenderia o teste ao texto do embrulho, e não ao fato.
    */
    expect((erro as { cause?: { code?: string } }).cause?.code).toBe("57014");
  }, 30_000);
});
