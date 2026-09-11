import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations } from "../migrate";
import { conferirProposta } from "../bridge";

/**
 * Publicar com Development atrás apaga Production — e nada impede.
 *
 * ---------------------------------------------------------------------------
 * A cadeia que este arquivo reproduz
 * ---------------------------------------------------------------------------
 * O Publishing não aplica a fila: ele propõe a Production a **estrutura que
 * Development tem hoje**. Quando Development está atrás, o que só existe em
 * Production não aparece na proposta como "falta criar" — aparece como "sobra",
 * e a proposta o **remove**. É DDL destrutivo em produção, fora da fila, e
 * `textoDaProposta` já diz isso por extenso.
 *
 * O que acontece depois é o que torna a perda silenciosa: a partida do servidor
 * roda `reconvergirNaPartida`, que repõe a estrutura levantada das próprias
 * migrations. As tabelas voltam — **vazias**. O journal continua dizendo que as
 * 94 migrations foram aplicadas, nenhuma fica pendente, nada falha, e o produto
 * sobe com a decisão da casa e o histórico dela apagados.
 *
 * Foi assim que `modulo_universal` e `modulo_universal_evento` chegaram a
 * Production com zero linhas e zero histórico — um histórico que é append-only
 * e que a interface nunca apaga.
 *
 * ---------------------------------------------------------------------------
 * O que falta, e que este arquivo exige
 * ---------------------------------------------------------------------------
 * A **detecção** já existe: `conferirProposta` mede os dois bancos e devolve
 * `removeria`, e o `bridge-cli conferir` sai com código 1 quando ela não está
 * vazia. O que não existe é o **portão**: nada obriga essa conferência a
 * acontecer antes de publicar. Ela é um comando que alguém lembra de rodar, e
 * "alguém lembrou" não é uma garantia — é a ausência de uma.
 *
 * Por isso os testes abaixo não medem uma função isolada. Eles montam os dois
 * bancos de verdade, com a fila de verdade, e rodam **a mesma chamada que o
 * `publicar:conferir` roda**. A parte que falha hoje é só a última: a de que
 * existe algo capaz de recusar a publicação a partir daquela medição.
 *
 * Nenhum teste aqui escreve em Production real: os dois bancos são criados e
 * destruídos pelo próprio arquivo.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

/** A migration em que o Development real parou — 86 entradas no journal. */
const ULTIMA_DO_DEV = "0085_busca_ativa";

let sequencia = 0;
const criados: string[] = [];
const pools: pg.Pool[] = [];
const pastas: string[] = [];

async function comAdmin<T>(fn: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function bancoNovo(): Promise<{ url: string; pool: pg.Pool }> {
  const nome = `fc_portao_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const url = urlDe(nome);
  const pool = new pg.Pool({ connectionString: url });
  pools.push(pool);
  return { url, pool };
}

afterAll(async () => {
  for (const p of pools) await p.end().catch(() => {});
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a.query(`DROP DATABASE IF EXISTS "${nome}"`).catch(() => {});
    }
  });
  for (const dir of pastas) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Uma cópia da pasta de migrations truncada numa tag — o Development atrasado.
 *
 * Truncar o **journal** e não a lista de arquivos é o que torna a simulação
 * fiel: a fila lê `meta/_journal.json` para saber o que existe, e o banco fica
 * com exatamente as entradas registradas que o Development real tem. Apagar as
 * tabelas de um banco já migrado produziria a mesma estrutura e um journal
 * mentiroso — e é justamente o journal que faz a reconvergência da partida
 * achar que não há nada pendente.
 */
function pastaAte(tag: string): string {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), "fc-migrations-"));
  pastas.push(destino);
  fs.cpSync(MIGRATIONS, destino, { recursive: true });

  const journalPath = path.join(destino, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const corte = journal.entries.findIndex((e) => e.tag === tag);
  expect(corte, `a tag ${tag} precisa existir no journal`).toBeGreaterThanOrEqual(0);
  journal.entries = journal.entries.slice(0, corte + 1);
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return destino;
}

/** O retrato de uma tabela em Production: colunas, índices e as linhas. */
async function retratoDe(pool: pg.Pool, tabela: string) {
  const colunas = await pool.query<{ c: string }>(
    `SELECT column_name || ':' || data_type || ':' || is_nullable AS c
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 ORDER BY column_name`,
    [tabela],
  );
  const indices = await pool.query<{ i: string }>(
    `SELECT indexname AS i FROM pg_indexes
      WHERE schemaname='public' AND tablename=$1 ORDER BY indexname`,
    [tabela],
  );
  const linhas = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM "public"."${tabela}"`,
  );
  return {
    colunas: colunas.rows.map((r) => r.c),
    indices: indices.rows.map((r) => r.i),
    linhas: Number(linhas.rows[0]!.n),
  };
}

/**
 * O portão, como ele ainda **não** existe.
 *
 * Importado em tempo de execução de propósito: um `import` estático de um
 * símbolo ausente derruba o arquivo inteiro na coleta, e os testes que provam a
 * vulnerabilidade — os que medem a proposta e o estado de Production — nunca
 * chegariam a rodar. Assim a falha fica onde ela é: na ausência do portão, e
 * dita com estas palavras.
 */
async function portao(): Promise<(p: { removeria: string[] }) => string | null> {
  const bridge = (await import("../bridge")) as Record<string, unknown>;
  const fn = bridge["problemaDaPublicacao"];
  if (typeof fn !== "function") {
    throw new Error(
      "não existe portão: `problemaDaPublicacao` não é exportada de bridge.ts. " +
        "A conferência é hoje um comando que alguém lembra de rodar, e nada " +
        "impede a publicação destrutiva.",
    );
  }
  return fn as (p: { removeria: string[] }) => string | null;
}

describe("publicar com Development atrás não pode ser possível", () => {
  it(
    "dev atrás → a proposta remove objetos de Production, e o portão precisa recusar",
    async () => {
      // 1. Production: a fila inteira, como o banco real (94 migrations).
      const prod = await bancoNovo();
      expect((await runMigrations(prod.url)).failure).toBeUndefined();

      // 2. E com a decisão da casa dentro — o dado que a publicação destruiria.
      await prod.pool.query(
        `INSERT INTO "modulo_universal" ("chave","desligado_por","motivo") VALUES
           ('#visao-executiva','chefe@x.com','esta casa não usa a Visão Executiva'),
           ('/importacoes','chefe@x.com',NULL)`,
      );
      await prod.pool.query(
        `INSERT INTO "modulo_universal_evento" ("chave","ligado","motivo","por") VALUES
           ('#visao-executiva',false,'esta casa não usa a Visão Executiva','chefe@x.com'),
           ('/importacoes',false,NULL,'chefe@x.com')`,
      );

      const antesModulo = await retratoDe(prod.pool, "modulo_universal");
      const antesEvento = await retratoDe(prod.pool, "modulo_universal_evento");
      expect(antesModulo.linhas).toBe(2);
      expect(antesEvento.linhas).toBe(2);

      // 3. Development atrás: a fila só até a 0085, como o banco real.
      const dev = await bancoNovo();
      expect(
        (await runMigrations(dev.url, pastaAte(ULTIMA_DO_DEV))).failure,
      ).toBeUndefined();

      const registradas = async (pool: pg.Pool) =>
        Number(
          (
            await pool.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM "drizzle"."__drizzle_migrations"`,
            )
          ).rows[0]!.n,
        );
      expect(await registradas(dev.pool)).toBeLessThan(await registradas(prod.pool));

      // 4. A mesma lógica do `publicar:conferir`, sobre os dois bancos.
      const proposta = await conferirProposta(dev.url, prod.url);

      expect(proposta.removeria.length).toBeGreaterThan(0);
      const removeria = proposta.removeria.join("\n");
      expect(removeria).toContain("modulo_universal.chave");
      expect(removeria).toContain("modulo_universal_evento.por");
      expect(removeria).toContain("modulo_universal_chave_idx");

      /*
        5. Production intacta — e esta asserção vem **antes** da do portão de
        propósito. Ela é a metade que prova a vulnerabilidade: a medição
        aconteceu, ela diz que a publicação removeria a decisão da casa, e o
        dado ainda está lá porque ninguém publicou *ainda*. Depois do portão,
        esta linha nunca rodaria enquanto ele não existisse — e o que o teste
        precisa demonstrar hoje é exatamente o estado em que o dado está
        vulnerável, não protegido.
      */
      expect(await retratoDe(prod.pool, "modulo_universal")).toEqual(antesModulo);
      expect(await retratoDe(prod.pool, "modulo_universal_evento")).toEqual(antesEvento);

      // 6. O portão precisa recusar a publicação a partir dessa medição.
      const recusa = (await portao())(proposta);
      expect(recusa).not.toBeNull();
      expect(recusa).toContain("remov");
    },
    120_000,
  );

  it(
    "dev convergido → a proposta não remove nada, e o portão libera",
    async () => {
      const prod = await bancoNovo();
      expect((await runMigrations(prod.url)).failure).toBeUndefined();
      await prod.pool.query(
        `INSERT INTO "modulo_universal" ("chave","desligado_por") VALUES ('#compras','chefe@x.com')`,
      );

      const dev = await bancoNovo();
      expect((await runMigrations(dev.url)).failure).toBeUndefined();

      const proposta = await conferirProposta(dev.url, prod.url);
      expect(proposta.removeria).toEqual([]);

      // A decisão da casa continua lá — publicar convergido não custa dado.
      expect((await retratoDe(prod.pool, "modulo_universal")).linhas).toBe(1);

      expect((await portao())(proposta)).toBeNull();
    },
    120_000,
  );
});
