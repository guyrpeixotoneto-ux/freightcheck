/**
 * O ciclo completo do deploy que mutilava Production — reproduzido, e fechado.
 *
 * A sequência real, confirmada pelo registro em `bridge.ts` (proposta do
 * Provision de 17/08/2026) e pelas telas de 18/08:
 *
 *   1. Production sobe; `runMigrations()` aplica a fila; registro completo.
 *   2. Development, por política, fica atrás da fila (`scripts/post-merge.sh`).
 *   3. Alguém publica. O Provision do Publishing compara os dois bancos e
 *      **remove de Production** o que Development não tem — colunas, tabelas,
 *      índices e constraints que migrations registradas criaram.
 *   4. O servidor novo sobe. `runMigrations()` não repõe nada: decide pelo
 *      carimbo, e os carimbos estão todos lá. As migrations de reconciliação
 *      também não: já constam aplicadas.
 *   5. Estado final: registro diz 35, objeto não existe, tela cai com 42703,
 *      `/healthz` contava migrations e dizia SAUDAVEL.
 *
 * Este arquivo constrói exatamente esse mundo — Production real com dado real,
 * Development na `0018` como o de verdade — e prova que, com a reconvergência
 * na partida, o passo 4 passa a devolver o schema inteiro: mesmo `estruturaDe`
 * byte a byte, dado preservado, segunda passada vazia, e a publicação seguinte
 * (com Development alinhado) sem nada a desfazer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyConfirmations,
  backfillSemantics,
  runProposalPass,
  seedTaxonomy,
} from "@workspace/curation";
import { importFixture, modelExportPaths } from "@workspace/ingest/testing";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { runMigrations, readMigrations } from "@workspace/db/migrate";
import { conferirProposta, estruturaDe } from "@workspace/db/bridge";
import { diagnosticar } from "@workspace/db/diagnostico";
import { reconvergirSchema } from "@workspace/db/reconvergencia";
import { CRIAR_MARCADOR, MARCAR_DESCIDA } from "@workspace/db/bridge-marcador";
import { observarBanco, reconvergirNaPartida } from "../lib/migrations";

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";
const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

type Pool = ReturnType<typeof createDb>["pool"];

let sequencia = 0;
const criados: string[] = [];

async function comAdmin<T>(fn: (p: Pool) => Promise<T>): Promise<T> {
  const { pool } = createDb(ADMIN);
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function bancoNovo(): Promise<{ url: string; pool: Pool }> {
  const nome = `fc_deploy_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  return { url: urlDe(nome), pool: createDb(urlDe(nome)).pool };
}

/** A fila até `ate` (inclusive), sem registro — a réplica de um banco antigo. */
async function aplicarAte(pool: Pool, ate: string): Promise<void> {
  for (const m of readMigrations()) {
    for (const comando of m.statements) await pool.query(comando);
    if (m.tag === ate) return;
  }
  throw new Error(`migration ${ate} não existe`);
}

async function colunasDe(pool: Pool): Promise<Map<string, Set<string>>> {
  const { rows } = await pool.query<{ t: string; c: string }>(
    `select table_name as t, column_name as c
       from information_schema.columns where table_schema = 'public'`,
  );
  const mapa = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!mapa.has(r.t)) mapa.set(r.t, new Set());
    mapa.get(r.t)!.add(r.c);
  }
  return mapa;
}

/**
 * O Provision, na direção que destrói: espelha em `prod` o que `dev` não tem.
 *
 * É a mesma comparação de `propostaDoPublishing`, executada — o que o serviço
 * da plataforma faz na fase Provision, antes de o servidor novo existir. Só os
 * tipos de objeto que o gerador dele administra: tabela, coluna, índice,
 * constraint. O registro de migrations vive no schema `drizzle` e sobrevive,
 * exatamente como no incidente real.
 */
async function provisionEspelha(dev: Pool, prod: Pool): Promise<string[]> {
  const removidos: string[] = [];
  const doDev = await colunasDe(dev);

  for (const [tabela] of await colunasDe(prod)) {
    if (doDev.has(tabela)) continue;
    await prod.query(`DROP TABLE IF EXISTS "${tabela}" CASCADE`);
    removidos.push(`tabela ${tabela}`);
  }

  for (const [tabela, colunas] of await colunasDe(prod)) {
    const noDev = doDev.get(tabela);
    if (!noDev) continue;
    for (const coluna of colunas) {
      if (noDev.has(coluna)) continue;
      await prod.query(
        `ALTER TABLE "${tabela}" DROP COLUMN IF EXISTS "${coluna}" CASCADE`,
      );
      removidos.push(`coluna ${tabela}.${coluna}`);
    }
  }

  const indices = async (p: Pool) =>
    new Set(
      (
        await p.query<{ nome: string }>(
          `select indexname as nome from pg_indexes where schemaname = 'public'`,
        )
      ).rows.map((r) => r.nome),
    );
  const idxDev = await indices(dev);
  for (const nome of await indices(prod)) {
    if (idxDev.has(nome)) continue;
    await prod.query(`DROP INDEX IF EXISTS "${nome}"`);
    removidos.push(`índice ${nome}`);
  }

  const constraints = async (p: Pool) =>
    (
      await p.query<{ nome: string; tabela: string }>(
        `select con.conname as nome, c.relname as tabela
           from pg_constraint con join pg_class c on c.oid = con.conrelid
          where con.connamespace = 'public'::regnamespace`,
      )
    ).rows;
  const conDev = new Set((await constraints(dev)).map((r) => r.nome));
  for (const { nome, tabela } of await constraints(prod)) {
    if (conDev.has(nome)) continue;
    await prod
      .query(`ALTER TABLE "${tabela}" DROP CONSTRAINT IF EXISTS "${nome}"`)
      .catch(() => {
        /* A ordem interna do gerador dele também falha — documentado. O que
           importa aqui é o estado final. */
      });
    removidos.push(`constraint ${nome}`);
  }

  return removidos;
}

let prod: { url: string; pool: Pool };
let dev: { url: string; pool: Pool };
let referencia: { url: string; pool: Pool };
let estruturaAntes: string[];
let contagensAntes: Record<string, number>;
let sentinelaCode: string;
let removidosPeloProvision: string[] = [];
let poolDeSemeadura: Pool | undefined;

const CONTADAS = [
  "fact",
  "entity",
  "snapshot",
  "attribute",
  "attribute_semantics",
];

async function contagens(pool: Pool): Promise<Record<string, number>> {
  const resultado: Record<string, number> = {};
  for (const tabela of CONTADAS) {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from "${tabela}"`,
    );
    resultado[tabela] = Number(rows[0]!.n);
  }
  return resultado;
}

beforeAll(async () => {
  // Production como um deploy a deixa: fila inteira, registro completo, dado real.
  prod = await bancoNovo();
  expect((await runMigrations(prod.url)).failure).toBeUndefined();
  process.env.DATABASE_URL = prod.url;

  const { db: prodDb, pool: prodSeedPool } = createDb(prod.url);
  poolDeSemeadura = prodSeedPool;
  const { carreta, cavalo } = modelExportPaths();
  for (const filePath of [carreta, cavalo])
    await importFixture(prodDb, filePath);
  await seedTaxonomy(prodDb, "test");
  await runProposalPass(prodDb, "test:proposal");
  await applyConfirmations(prodDb);
  await backfillSemantics(prodDb);

  /* Uma decisão humana numa coluna pós-0018 — o dado que o Provision destrói. */
  const { rows } = await prod.pool.query<{ code: string }>(
    `update attribute set cost_class = 'FIXO'
      where id = (select id from attribute order by code limit 1)
      returning code`,
  );
  sentinelaCode = rows[0]!.code;

  estruturaAntes = await estruturaDe(prod.pool);
  contagensAntes = await contagens(prod.pool);

  // Development como o real: fila parada na 0018, por política.
  dev = await bancoNovo();
  await aplicarAte(dev.pool, "0018_identidade_forte");

  // O banco de referência: a fila inteira, do zero — Development alinhado.
  referencia = await bancoNovo();
  expect((await runMigrations(referencia.url)).failure).toBeUndefined();
}, 900_000);

afterAll(async () => {
  await poolDeSemeadura?.end();
  await prod?.pool.end();
  await dev?.pool.end();
  await referencia?.pool.end();
  await encerrarPoolDoProcesso();
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [nome],
      );
      await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    }
  });
}, 300_000);

describe("1. a reprodução: o que o Publishing faz com um Development atrasado", () => {
  it("a proposta remove de Production o que a fila criou — medida, não suposta", async () => {
    const proposta = await conferirProposta(dev.url, prod.url);

    expect(proposta.removeria.length).toBeGreaterThan(0);
    const texto = proposta.removeria.join("\n");
    /* As vítimas conhecidas dos dois incidentes, nomeadas na proposta. */
    expect(texto).toContain("attribute.cost_class");
    expect(texto).toContain("change_set.impacto_oficial_by_periodicity");
    expect(texto).toContain("entity_expectation");
  }, 120_000);

  it("o Provision aplicado deixa Production no estado das telas de 18/08", async () => {
    removidosPeloProvision = await provisionEspelha(dev.pool, prod.pool);
    expect(removidosPeloProvision.length).toBeGreaterThan(0);

    /* O registro sobreviveu — vive no schema `drizzle`, fora do espelho. */
    const { rows } = await prod.pool.query<{ n: string }>(
      `select count(*) as n from drizzle."__drizzle_migrations"`,
    );
    expect(Number(rows[0]!.n)).toBe(readMigrations().length);
  }, 300_000);

  it("a fila não repõe nada: decide pelo carimbo, e os carimbos estão todos lá", async () => {
    const r = await runMigrations(prod.url);

    expect(r.failure).toBeUndefined();
    expect(r.applied).toEqual([]);
    expect(r.pending).toEqual([]);
  }, 300_000);

  it("o diagnóstico vê e nomeia: SCHEMA_DIVERGENTE, com as colunas pelo nome", async () => {
    const d = diagnosticar(await observarBanco(prod.url));

    expect(d.estado).toBe("SCHEMA_DIVERGENTE");
    expect(d.evidencia).toMatch(/falta/);
  }, 120_000);
});

describe("2. a correção: a partida reconverge pelo DDL da própria fila", () => {
  it("repõe tudo o que o Provision tirou — sem resto e sem falha", async () => {
    const resultado = await reconvergirNaPartida(prod.url);

    expect(resultado.rodou).toBe(true);
    if (!resultado.rodou) return;
    expect(resultado.relatorio.aplicados.length).toBeGreaterThan(0);
    expect(resultado.relatorio.semComando).toEqual([]);
    expect(resultado.relatorio.falhas).toEqual([]);
  }, 300_000);

  it("a estrutura volta byte a byte ao que era antes da mutilação", async () => {
    /*
      `estruturaDe` é a mesma régua do bridge: coluna, índice, constraint,
      gatilho, função, view e enum, com tipo e definição. Igualdade aqui é o
      critério de aceite inteiro — não "as telas voltaram", e sim "o schema é
      exatamente o que as migrations declaram".
    */
    const estruturaDepois = await estruturaDe(prod.pool);

    expect(estruturaDepois).toEqual(estruturaAntes);
  }, 120_000);

  it("o /healthz fica verde pelo motivo certo: conferiu, não só contou", async () => {
    const d = diagnosticar(await observarBanco(prod.url));

    expect(d.estado).toBe("SAUDAVEL");
    expect(d.evidencia).toMatch(/o schema confere/);
  }, 120_000);

  it("nenhuma linha de dado se perdeu nas tabelas que ficaram", async () => {
    expect(await contagens(prod.pool)).toEqual(contagensAntes);
  }, 120_000);

  it("a honestidade do reparo: o conteúdo da coluna destruída não volta", async () => {
    /*
      O Provision derrubou `attribute.cost_class` com o valor dentro; a
      reconvergência repõe a coluna — vazia. Estrutura é recuperável pela fila;
      decisão humana destruída não é recuperável por ninguém, e é por isso que
      a prevenção (`publicar:conferir` antes de todo Publish) continua de pé.
      Este teste existe para que ninguém leia o verde acima como "nada foi
      perdido".
    */
    const { rows } = await prod.pool.query<{ cost_class: string | null }>(
      `select cost_class from attribute where code = $1`,
      [sentinelaCode],
    );

    expect(rows[0]!.cost_class).toBeNull();
  }, 120_000);

  it("a segunda passada é vazia: reconvergir é idempotente", async () => {
    const relatorio = await reconvergirSchema(prod.url);

    expect(relatorio.aplicados).toEqual([]);
    expect(relatorio.semComando).toEqual([]);
    expect(relatorio.falhas).toEqual([]);
  }, 300_000);
});

describe("3. o deploy seguinte: com Development alinhado, não há o que desfazer", () => {
  it("a proposta do Publishing sai vazia nas duas direções", async () => {
    const proposta = await conferirProposta(referencia.url, prod.url);

    expect(proposta.removeria).toEqual([]);
    expect(proposta.criaria).toEqual([]);
  }, 120_000);
});

describe("4. onde a reconvergência se recusa a rodar", () => {
  it("banco vazio: a fila resolve, não ela", async () => {
    const vazio = await bancoNovo();
    try {
      const resultado = await reconvergirNaPartida(vazio.url);
      expect(resultado).toEqual({
        rodou: false,
        motivo: "schema ainda não existe — a fila resolve",
      });
    } finally {
      await vazio.pool.end();
    }
  }, 120_000);

  it("banco parcialmente migrado: pendência explica ausência, e a fila resolve", async () => {
    /* A réplica de Development é exatamente esse estado: schema até a 0018,
       registro sem os carimbos — tudo pendente aos olhos deste build. */
    const resultado = await reconvergirNaPartida(dev.url);

    expect(resultado.rodou).toBe(false);
    if (resultado.rodou) return;
    expect(resultado.motivo).toMatch(/pendente/);
  }, 120_000);

  it("bridge pendente: o estado é intencional, e o bridge:up resolve", async () => {
    for (const comando of CRIAR_MARCADOR) await referencia.pool.query(comando);
    await referencia.pool.query(MARCAR_DESCIDA, [JSON.stringify(["teste"])]);
    try {
      const resultado = await reconvergirNaPartida(referencia.url);

      expect(resultado.rodou).toBe(false);
      if (resultado.rodou) return;
      expect(resultado.motivo).toMatch(/bridge/);
    } finally {
      await referencia.pool.query(`DELETE FROM "drizzle"."bridge_estado"`);
    }
  }, 120_000);
});
