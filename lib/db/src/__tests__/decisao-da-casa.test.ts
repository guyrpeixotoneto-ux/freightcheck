import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runMigrations } from "../migrate";
import { reconvergirSeCabivel } from "../reconvergencia";
import {
  espelharDecisaoDaCasa,
  garantirEspelhoDaCasa,
  protegerDecisaoDaCasa,
  reporDecisaoDaCasa,
} from "../decisao-da-casa";

/**
 * A decisão da casa sobrevive ao Publish — ou o menu volta inteiro.
 *
 * Este arquivo reproduz a cadeia real, e não uma versão dela: banco de verdade,
 * fila de verdade, e o DDL destrutivo que o Provision do Publishing executa
 * quando Development está atrás de Production. Ele nasceu **vermelho** contra o
 * código anterior — a última asserção de "o incidente inteiro" era zero linha
 * depois da partida, que é exatamente o que acontecia em produção.
 *
 * Por que o `DROP TABLE` é escrito aqui à mão: é o que a proposta do Publishing
 * faz. Ela não passa pela fila, não escreve no registro de migrations e não
 * pergunta nada ao produto — o journal continua íntegro, e é por isso que a
 * partida seguinte conclui que não há nada pendente e reconverge a estrutura
 * **sem** o conteúdo. Simular por `DROP` é reproduzir o efeito exato; apagar
 * linhas seria reproduzir outro estado, que não é o que aconteceu.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

let sequencia = 0;
const criados: string[] = [];
const pools: pg.Pool[] = [];

async function comAdmin<T>(fn: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

afterAll(async () => {
  for (const p of pools) await p.end().catch(() => {});
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a.query(`DROP DATABASE IF EXISTS "${nome}"`).catch(() => {});
    }
  });
});

async function bancoNovo(): Promise<{ url: string; pool: pg.Pool }> {
  const nome = `fc_casa_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const url = urlDe(nome);
  const pool = new pg.Pool({ connectionString: url });
  pools.push(pool);
  expect((await runMigrations(url)).failure).toBeUndefined();
  return { url, pool };
}

const consultaDe =
  (pool: pg.Pool) =>
  async (texto: string): Promise<Record<string, unknown>[]> => {
    const { rows } = await pool.query(texto);
    return rows as Record<string, unknown>[];
  };

/** Uma casa que decidiu: três chaves fora do ar e o histórico delas. */
async function casaDecidida(): Promise<{ url: string; pool: pg.Pool }> {
  const banco = await bancoNovo();
  await banco.pool.query(
    `INSERT INTO "modulo_universal" ("chave","desligado_por","motivo") VALUES
       ('#qlp','chefe@x.com','esta operação não usa QLP'),
       ('/fluxos','chefe@x.com',NULL),
       ('@fechamento-rota','chefe@x.com','esta casa não opera rota')`,
  );
  await banco.pool.query(
    `INSERT INTO "modulo_universal_evento" ("chave","ligado","motivo","por") VALUES
       ('#qlp',false,'esta operação não usa QLP','chefe@x.com'),
       ('/fluxos',false,NULL,'chefe@x.com'),
       ('@fechamento-rota',false,'esta casa não opera rota','chefe@x.com')`,
  );
  // O espelho é escrito pela transação da decisão; aqui ele é escrito à mão
  // porque a decisão entrou por SQL direto, e não pelo serviço.
  await espelharDecisaoDaCasa(consultaDe(banco.pool));
  return banco;
}

/**
 * O que o Provision do Publishing faz quando Development está atrás: remove de
 * Production o que só Production tem. Sem tocar no registro de migrations.
 */
async function publishRemoveAsTabelas(pool: pg.Pool): Promise<void> {
  await pool.query(`DROP TABLE "modulo_universal_evento"`);
  await pool.query(`DROP TABLE "modulo_universal"`);
}

const chaves = async (pool: pg.Pool): Promise<string[]> => {
  const { rows } = await pool.query<{ chave: string }>(
    `SELECT chave FROM "modulo_universal"`,
  );
  return rows.map((r) => r.chave).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
};

const eventos = async (pool: pg.Pool): Promise<number> => {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::int AS n FROM "modulo_universal_evento"`,
  );
  return Number(rows[0]!.n);
};

describe("o incidente inteiro, do Publish à partida seguinte", () => {
  it("a decisão da casa continua de pé depois do DDL destrutivo e da reconvergência", async () => {
    const banco = await casaDecidida();
    const antes = await chaves(banco.pool);
    expect(antes).toEqual(["#qlp", "/fluxos", "@fechamento-rota"]);

    // 1. O Publish remove as tabelas por fora da fila.
    await publishRemoveAsTabelas(banco.pool);

    // 2. A partida: a fila não tem nada pendente (o journal está íntegro) e a
    //    reconvergência repõe a estrutura a partir das próprias migrations.
    expect((await runMigrations(banco.url)).failure).toBeUndefined();
    const reconvergencia = await reconvergirSeCabivel(banco.url);
    expect(reconvergencia.rodou).toBe(true);

    // É aqui que o produto dizia "tudo ligado": estrutura de volta, zero linha.
    expect(await chaves(banco.pool)).toEqual([]);

    // 3. E é aqui que a decisão volta — a mesma, não uma linha nova de hoje.
    const protecao = await protegerDecisaoDaCasa(consultaDe(banco.pool));
    expect(protecao.reposicao.repos).toBe(true);
    expect(await chaves(banco.pool)).toEqual(antes);
    expect(await eventos(banco.pool)).toBe(3);
  }, 180_000);

  it("o carimbo, o autor e o motivo voltam como estavam", async () => {
    const banco = await casaDecidida();
    const { rows: antes } = await banco.pool.query(
      `SELECT chave, desligado_em, desligado_por, motivo
         FROM "modulo_universal" ORDER BY chave`,
    );

    await publishRemoveAsTabelas(banco.pool);
    expect((await runMigrations(banco.url)).failure).toBeUndefined();
    await reconvergirSeCabivel(banco.url);
    await protegerDecisaoDaCasa(consultaDe(banco.pool));

    const { rows: depois } = await banco.pool.query(
      `SELECT chave, desligado_em, desligado_por, motivo
         FROM "modulo_universal" ORDER BY chave`,
    );
    expect(depois).toEqual(antes);
  }, 180_000);
});

describe("a reposição não age fora da impressão digital da perda", () => {
  it("não toca em nada quando a decisão está onde deveria estar", async () => {
    const banco = await casaDecidida();

    const r = await reporDecisaoDaCasa(consultaDe(banco.pool));

    expect(r.repos).toBe(false);
    expect(await chaves(banco.pool)).toEqual([
      "#qlp",
      "/fluxos",
      "@fechamento-rota",
    ]);
  }, 120_000);

  it("uma casa que religou tudo não é confundida com uma casa mutilada", async () => {
    /*
      O caso que separa esta reposição de um "vazio ≈ perdido" frouxo. Religar
      tudo esvazia `modulo_universal` — e **não** esvazia o histórico, que é
      append-only. Sem essa segunda condição, a partida seguinte devolveria ao
      ar a decisão que a casa acabou de desfazer.
    */
    const banco = await casaDecidida();
    await banco.pool.query(`DELETE FROM "modulo_universal"`);
    await banco.pool.query(
      `INSERT INTO "modulo_universal_evento" ("chave","ligado","por") VALUES
         ('#qlp',true,'chefe@x.com'),
         ('/fluxos',true,'chefe@x.com'),
         ('@fechamento-rota',true,'chefe@x.com')`,
    );
    await espelharDecisaoDaCasa(consultaDe(banco.pool));

    const r = await protegerDecisaoDaCasa(consultaDe(banco.pool));

    expect(r.reposicao.repos).toBe(false);
    expect(await chaves(banco.pool)).toEqual([]);
  }, 120_000);

  it("uma casa que nunca desligou nada atravessa a partida sem escrita nenhuma", async () => {
    const banco = await bancoNovo();

    const r = await protegerDecisaoDaCasa(consultaDe(banco.pool));

    expect(r.reposicao.repos).toBe(false);
    expect(await chaves(banco.pool)).toEqual([]);
    expect(await eventos(banco.pool)).toBe(0);
  }, 120_000);

  it("não escreve por cima de linha que já está lá", async () => {
    const banco = await casaDecidida();
    // Espelho com uma decisão antiga, tabela com outra, mais nova.
    await banco.pool.query(
      `INSERT INTO "modulo_universal" ("chave","desligado_por") VALUES ('/frota','outro@x.com')`,
    );

    const r = await reporDecisaoDaCasa(consultaDe(banco.pool));

    expect(r.repos).toBe(false);
    expect(await chaves(banco.pool)).toContain("/frota");
  }, 120_000);
});

describe("o espelho", () => {
  it("não é criado por cima de um espelho que já existe", async () => {
    /*
      A partida de logo depois da perda encontra `public` vazio. Se ela
      recriasse o espelho a partir dali, apagaria justamente o que ele guarda —
      e a reposição ficaria sem nada para repor.
    */
    const banco = await casaDecidida();
    await publishRemoveAsTabelas(banco.pool);
    expect((await runMigrations(banco.url)).failure).toBeUndefined();
    await reconvergirSeCabivel(banco.url);

    await garantirEspelhoDaCasa(consultaDe(banco.pool));

    const { rows } = await banco.pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM "drizzle"."modulo_universal__casa"`,
    );
    expect(Number(rows[0]!.n)).toBe(3);
  }, 180_000);

  it("nasce para a casa que já tinha decidido antes deste módulo existir", async () => {
    const banco = await bancoNovo();
    await banco.pool.query(
      `INSERT INTO "modulo_universal" ("chave","desligado_por") VALUES ('#qlp','chefe@x.com')`,
    );

    const criados = await garantirEspelhoDaCasa(consultaDe(banco.pool));

    expect(criados).toContain("modulo_universal__casa");
    const { rows } = await banco.pool.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM "drizzle"."modulo_universal__casa"`,
    );
    expect(Number(rows[0]!.n)).toBe(1);
  }, 120_000);

  it("vive fora de public, que é onde o Provision do Publishing mexe", async () => {
    const banco = await casaDecidida();

    const { rows } = await banco.pool.query<{ schema: string }>(
      `SELECT table_schema AS schema FROM information_schema.tables
        WHERE table_name = 'modulo_universal__casa'`,
    );
    expect(rows.map((r) => r.schema)).toEqual(["drizzle"]);
  }, 120_000);
});
