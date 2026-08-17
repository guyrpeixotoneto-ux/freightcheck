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

    /*
      Sem declarar nada, a fila atravessa. Aqui ela travava na `0000` — um tipo
      que já existia, `42710`, e nenhuma migration nova entrava nunca mais —, e
      esse travamento era o que empurrava quem publica para as duas saídas
      ruins: aceitar o diff do Publishing ou copiar desenvolvimento por cima de
      produção. Agora cada migration confere antes de criar, então rodá-las
      sobre um banco que já as contém é trabalho repetido, não erro.

      A bandeira continua existindo, e continua sendo outra coisa: ela **pula**
      a migration e carimba o registro. Esta passada não pula nada — roda tudo.
    */
    const semDeclarar = await runMigrations(url);
    expect(semDeclarar.failure).toBeUndefined();
    expect(semDeclarar.applied).toEqual(primeira.applied);
    expect(semDeclarar.adopted).toEqual([]);

    // De novo o acidente, agora para exercitar a adoção declarada.
    const outraVez = createDb(url);
    await outraVez.pool.query(`DELETE FROM "drizzle"."__drizzle_migrations"`);
    await outraVez.pool.end();

    // Declarada a adoção, o registro é reconstruído sem rodar o que já está lá.
    const segunda = await runMigrations(url, undefined, { adoptExisting: true });
    expect(segunda.failure).toBeUndefined();
    expect(segunda.pending).toEqual([]);

    /*
      A adoção só reconhece migration que **cria objeto** — tabela, tipo, índice,
      coluna, gatilho. A `0018` não cria nenhum: ela valida o dado e acrescenta
      constraints, e nenhuma inspeção da forma do schema prova que ela rodou.

      Então ela não é adotada: é rodada. E rodar é o desfecho certo aqui, porque
      ela é idempotente por construção — adota a constraint que já existe, cria a
      que falta, e para se o dado não sustentar a identidade.
    */
    const semObjetoNovo = [
      "0018_identidade_forte",
      /*
        A `0022` está aqui pela mesma razão, e não por uma nova.

        Ela **remove**: derruba `snapshot.scope_hash`, traduz o recorte gravado
        nas conversas e redefine duas funções. Nenhuma inspeção da forma do
        schema prova que ela rodou — o que ela cria é uma ausência —, então ela
        é rodada em vez de adotada. E rodar é o desfecho certo, porque ela é
        idempotente por construção: a tradução é condicionada à existência da
        coluna, o `DROP` é `IF EXISTS` e as funções são `CREATE OR REPLACE`.
      */
      "0022_identidade_de_escopo_unica",
    ];
    expect(segunda.adopted).toEqual(
      primeira.applied.filter((tag) => !semObjetoNovo.includes(tag)),
    );
    expect(segunda.applied).toEqual(semObjetoNovo);

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

      // A 0012 não pode ser **adotada** — falta a tabela `ticket`. Adotá-la
      // faria o registro afirmar um estado que o banco não tem, e a 0013, que
      // altera `ticket`, entraria depois num vazio. Nem a bandeira força isso:
      // ela declara a intenção, não dispensa a conferência.
      expect(depois.adopted).not.toContain("0012_chamados");
      // O que vinha antes dela continua sendo adotado: é verdade conferida.
      expect(depois.adopted).toContain("0000_freightcheck_foundation");

      /*
        E o que não pôde ser adotado é **rodado**, em vez de derrubar a fila.
        Antes isto parava em `0012_chamados` e o banco ficava sem `ticket` para
        sempre; a migration recria o que falta e as seguintes entram em cima do
        estado certo. Recusar a adoção e recusar o conserto eram a mesma coisa,
        e não deviam ser.
      */
      expect(depois.applied).toContain("0012_chamados");
      expect(depois.failure).toBeUndefined();
      expect(depois.pending).toEqual([]);

      const conferencia = createDb(parcial);
      const { rows } = await conferencia.pool.query<{ existe: boolean }>(
        `SELECT to_regclass('public."ticket"') IS NOT NULL AS existe`,
      );
      await conferencia.pool.end();
      expect(rows[0]!.existe).toBe(true);
    } finally {
      await apagarBanco(nome);
    }
  }, 300_000);
});
