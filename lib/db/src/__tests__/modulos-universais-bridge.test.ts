import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runMigrations } from "../migrate";
import { bridgeDown, bridgeUp } from "../bridge";

/**
 * A decisão da casa atravessa o bridge — ou o deploy a apaga.
 *
 * `modulo_universal` guarda o que a instalação desligou para todo mundo, e
 * `modulo_universal_evento` guarda quem desligou, quando e por quê. As duas
 * entraram em `TABELAS_REMOVIDAS` porque Production não as conhece até a fila
 * rodar lá, e o contrato com o Publishing exige que o `down` as tire de
 * Development — nada disso mudou.
 *
 * O que mudou é o que acontece com o **conteúdo** enquanto elas estão fora.
 * Antes: a pré-condição de tabela vazia travava o `down` no dia em que alguém
 * desligasse o primeiro módulo, e a única saída oferecida era esvaziar as duas
 * — inclusive o histórico, que é append-only e é a única resposta para "quem
 * tirou o QLP do menu". Um bridge que só desce depois de destruir a decisão que
 * ele deveria proteger não é preservação de nada.
 *
 * Agora as duas são **preservadas**: o `down` copia as linhas para o schema
 * `drizzle` — fora de `public`, onde o Publishing não olha — antes de derrubar
 * as tabelas, e o `up` as devolve inteiras. O contrato de estrutura continua
 * igual: depois do `down` as tabelas não existem em `public`, que é o que
 * mantém a proposta do Publishing sem `CREATE TABLE`.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

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
  const nome = `fc_modun_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const url = urlDe(nome);
  return { url, pool: new pg.Pool({ connectionString: url }) };
}

const pools: pg.Pool[] = [];

afterAll(async () => {
  for (const p of pools) await p.end().catch(() => {});
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a.query(`DROP DATABASE IF EXISTS "${nome}"`).catch(() => {});
    }
  });
});

/** Um Development com a casa já decidida: três chaves fora e o histórico delas. */
async function comDecisaoDaCasa(): Promise<{ url: string; pool: pg.Pool }> {
  const banco = await bancoNovo();
  pools.push(banco.pool);
  expect((await runMigrations(banco.url)).failure).toBeUndefined();

  await banco.pool.query(
    `INSERT INTO "modulo_universal" ("chave","desligado_por","motivo") VALUES
       ('#qlp','chefe@x.com','esta operação não usa QLP'),
       ('/fluxos','chefe@x.com','esta operação não usa QLP'),
       ('@fechamento-as','chefe@x.com',NULL)`,
  );
  await banco.pool.query(
    `INSERT INTO "modulo_universal_evento" ("chave","ligado","motivo","por") VALUES
       ('#qlp',false,'esta operação não usa QLP','chefe@x.com'),
       ('/fluxos',false,'esta operação não usa QLP','chefe@x.com'),
       ('/fluxos',true,NULL,'chefe@x.com'),
       ('/fluxos',false,'voltou a sair','chefe@x.com'),
       ('@fechamento-as',false,NULL,'chefe@x.com')`,
  );
  return banco;
}

const chaves = async (pool: pg.Pool): Promise<string[]> => {
  const { rows } = await pool.query<{ chave: string }>(
    `SELECT chave FROM "modulo_universal" ORDER BY chave`,
  );
  return rows.map((r) => r.chave);
};

const historico = async (pool: pg.Pool): Promise<string[]> => {
  const { rows } = await pool.query<{ linha: string }>(
    `SELECT chave || '|' || ligado || '|' || coalesce(motivo,'-') || '|' || por AS linha
       FROM "modulo_universal_evento" ORDER BY em, chave, ligado`,
  );
  return rows.map((r) => r.linha);
};

describe("o ciclo do bridge não custa a decisão da casa", () => {
  it("o down desce com módulos desligados — sem exigir que alguém apague a decisão", async () => {
    const dev = await comDecisaoDaCasa();

    const down = await bridgeDown(dev.url);

    expect(down.falha).toBeUndefined();
    /*
      O contrato com o Publishing continua de pé: as duas tabelas saem de
      `public`, senão a proposta volta a trazer `CREATE TABLE`.
    */
    const { rows } = await dev.pool.query<{ existe: boolean }>(
      `SELECT to_regclass('public.modulo_universal') IS NOT NULL
           OR to_regclass('public.modulo_universal_evento') IS NOT NULL AS existe`,
    );
    expect(rows[0]?.existe).toBe(false);
  }, 120_000);

  it("o up devolve as linhas de modulo_universal inteiras", async () => {
    const dev = await comDecisaoDaCasa();
    const antes = await chaves(dev.pool);

    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    expect((await bridgeUp(dev.url)).falha).toBeUndefined();

    expect(await chaves(dev.pool)).toEqual(antes);
    expect(antes).toEqual(["#qlp", "/fluxos", "@fechamento-as"]);
  }, 120_000);

  it("o up devolve o histórico inteiro, que é append-only e não se recompõe", async () => {
    const dev = await comDecisaoDaCasa();
    const antes = await historico(dev.pool);
    expect(antes).toHaveLength(5);

    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    expect((await bridgeUp(dev.url)).falha).toBeUndefined();

    expect(await historico(dev.pool)).toEqual(antes);
  }, 120_000);

  it("o carimbo e o autor voltam como estavam — não é uma linha nova com a data de hoje", async () => {
    const dev = await comDecisaoDaCasa();
    const { rows: antes } = await dev.pool.query(
      `SELECT chave, desligado_em, desligado_por, motivo
         FROM "modulo_universal" ORDER BY chave`,
    );

    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    expect((await bridgeUp(dev.url)).falha).toBeUndefined();

    const { rows: depois } = await dev.pool.query(
      `SELECT chave, desligado_em, desligado_por, motivo
         FROM "modulo_universal" ORDER BY chave`,
    );
    expect(depois).toEqual(antes);
  }, 120_000);

  it("um banco sem decisão nenhuma atravessa o ciclo como sempre atravessou", async () => {
    const banco = await bancoNovo();
    pools.push(banco.pool);
    expect((await runMigrations(banco.url)).failure).toBeUndefined();

    expect((await bridgeDown(banco.url)).falha).toBeUndefined();
    expect((await bridgeUp(banco.url)).falha).toBeUndefined();

    expect(await chaves(banco.pool)).toEqual([]);
    expect(await historico(banco.pool)).toEqual([]);
  }, 120_000);

  it("dois down seguidos não descartam o que o primeiro guardou", async () => {
    const dev = await comDecisaoDaCasa();
    const antesChaves = await chaves(dev.pool);
    const antesHistorico = await historico(dev.pool);

    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    expect((await bridgeUp(dev.url)).falha).toBeUndefined();

    expect(await chaves(dev.pool)).toEqual(antesChaves);
    expect(await historico(dev.pool)).toEqual(antesHistorico);
  }, 180_000);
});
