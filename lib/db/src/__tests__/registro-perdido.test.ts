import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../index";
import { runMigrations } from "../migrate";

/**
 * O registro de migrations se perdeu, e o banco tem o schema inteiro.
 *
 * Aconteceu num ambiente de verdade: `drizzle.__drizzle_migrations` vazio num
 * banco que já tinha doze migrations aplicadas. A fila recomeçava da `0000`,
 * esbarrava num tipo que já existia (`SQLSTATE 42710`) e parava ali — então a
 * `0013` nunca entrava, e toda tela que dependia dela respondia erro. Sem
 * saída, o ambiente ficava travado para sempre: nenhuma migration nova entraria
 * jamais.
 *
 * A adoção confere antes de registrar. Estes casos cobrem os dois lados dessa
 * conferência: o banco completo, que pode ser adotado, e o banco pela metade,
 * que não pode — porque adotá-lo faria o registro declarar um estado que o
 * banco não tem.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

async function criarBanco(nome: string): Promise<string> {
  const admin = createDb(ADMIN);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nome}"`);
  await admin.pool.query(`CREATE DATABASE "${nome}"`);
  await admin.pool.end();
  return urlDe(nome);
}

async function apagarBanco(nome: string): Promise<void> {
  const admin = createDb(ADMIN);
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
    [nome],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nome}"`);
  await admin.pool.end();
}

const NOME = `fc_test_registro_perdido_${process.pid}`;
let url: string;

beforeAll(async () => {
  url = await criarBanco(NOME);
}, 300_000);

afterAll(async () => {
  await apagarBanco(NOME);
}, 300_000);

describe("registro de migrations perdido", () => {
  it("adota o que já existe e aplica o que falta, em vez de travar na 0000", async () => {
    const primeira = await runMigrations(url);
    expect(primeira.failure).toBeUndefined();
    expect(primeira.applied.length).toBeGreaterThan(10);

    // O acidente: o schema fica, o registro some.
    const banco = createDb(url);
    await banco.pool.query(`DELETE FROM "drizzle"."__drizzle_migrations"`);
    await banco.pool.end();

    // Sem declarar nada, a fila trava na 0000 — que é o estado em que um
    // ambiente de verdade ficou, com toda migration nova barrada para sempre.
    const semDeclarar = await runMigrations(url);
    expect(semDeclarar.failure?.tag).toBe("0000_freightcheck_foundation");
    expect(semDeclarar.applied).toEqual([]);

    // Declarada a adoção, o registro é reconstruído e a fila anda.
    const segunda = await runMigrations(url, undefined, { adoptExisting: true });
    expect(segunda.failure).toBeUndefined();
    expect(segunda.adopted).toEqual(primeira.applied);
    expect(segunda.pending).toEqual([]);

    /*
      As que mexem em dados saem nomeadas: o schema não prova que o backfill
      delas rodou, e quem adotou precisa conferir esse pedaço. A `0015` faz
      backfill de verdade — `UPDATE` em cima de tabelas que já existiam.

      A `0009` não entra, e não entrar é o ponto: os `UPDATE` dela vivem todos
      dentro do corpo de `freightcheck_correct_entity_type`, e rodam quando
      alguém chama a função, não quando a migration entra. Enquanto ela era
      acusada aqui, a adoção mandava conferir à mão um backfill inexistente —
      e um aviso que não se sustenta ensina a ignorar os próximos.
    */
    expect(segunda.adoptedWithData).toContain("0015_canonical_identity");
    expect(segunda.adoptedWithData).not.toContain("0009_entity_type_correction");

    // E o registro volta a refletir o banco: uma terceira passada não tem o
    // que fazer, nem precisa da bandeira.
    const terceira = await runMigrations(url);
    expect(terceira.adopted).toEqual([]);
    expect(terceira.applied).toEqual([]);
    expect(terceira.alreadyApplied).toEqual(primeira.applied);
  }, 300_000);

  it("recusa adotar um banco pela metade", async () => {
    const nome = `${NOME}_parcial`;
    const parcial = await criarBanco(nome);
    try {
      await runMigrations(parcial);

      const banco = createDb(parcial);
      await banco.pool.query(`DELETE FROM "drizzle"."__drizzle_migrations"`);
      // Uma tabela da 0012 some: o banco deixa de ter tudo o que ela cria.
      await banco.pool.query(`DROP TABLE IF EXISTS "ticket" CASCADE`);
      await banco.pool.end();

      const depois = await runMigrations(parcial, undefined, {
        adoptExisting: true,
      });

      // A 0012 não pode ser adotada — falta a tabela `ticket`. Adotá-la faria
      // o registro afirmar um estado que o banco não tem, e a 0013, que altera
      // `ticket`, entraria depois num vazio. Nem a bandeira força isso: ela
      // declara a intenção, não dispensa a conferência.
      expect(depois.adopted).not.toContain("0012_chamados");
      expect(depois.failure?.tag).toBe("0012_chamados");
      // O que vinha antes dela continua sendo adotado: é verdade conferida.
      expect(depois.adopted).toContain("0000_freightcheck_foundation");
    } finally {
      await apagarBanco(nome);
    }
  }, 300_000);
});
