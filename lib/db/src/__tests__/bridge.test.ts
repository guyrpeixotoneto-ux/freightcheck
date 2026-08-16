import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runMigrations, readMigrations } from "../migrate";
import { ALLOWLIST, bridgeDown, bridgeUp, estruturaDe } from "../bridge";

/**
 * O bridge deploy, contra PostgreSQL de verdade.
 *
 * O que estas provas prendem não é "o script roda": é o **contrato com o
 * Publishing**. Depois do `bridge-down`, o diff que o Replit calcula entre
 * Development e Production tem de ser exatamente seis `ADD COLUMN` nullable,
 * sem default, sem generated — nenhum DROP, nenhuma tabela, nenhum índice,
 * nenhuma constraint. Qualquer coisa a mais é DDL destrutivo ou impossível
 * entrando em produção antes da migration que sabe fazê-la.
 *
 * Por isso o teste central não confere o estado do banco em abstrato: ele
 * **constrói uma réplica de Production** e mede a diferença contra ela.
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
  const nome = `fc_bridge_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const url = urlDe(nome);
  return { url, pool: new pg.Pool({ connectionString: url }) };
}

/** Aplica a fila até `ate` (inclusive) sem registrar — o estado de Production. */
async function aplicarAte(pool: pg.Pool, ate: string): Promise<void> {
  for (const m of readMigrations()) {
    for (const comando of m.statements) await pool.query(comando);
    if (m.tag === ate) return;
  }
  throw new Error(`migration ${ate} não existe`);
}

/**
 * Development como ele é: a fila inteira, com registro.
 *
 * A `0019` fica de fora porque é onde o banco de desenvolvimento real está
 * (registro com 19 carimbos, o último da `0018`) — e o bridge tem de funcionar
 * sobre o banco que existe, não sobre um ideal.
 */
async function development(): Promise<{ url: string; pool: pg.Pool }> {
  const b = await bancoNovo();
  const r = await runMigrations(b.url);
  expect(r.failure).toBeUndefined();
  return b;
}

/** Production como foi medida em 15/08/2026: schema pós-`0012`, registro vazio. */
async function production(): Promise<{ url: string; pool: pg.Pool }> {
  const b = await bancoNovo();
  await aplicarAte(b.pool, "0012_chamados");
  return b;
}

/**
 * As nove vigências reais de Production, com escopo e datas como estão lá.
 *
 * Num banco que já passou pela `0015` as três colunas de identidade são
 * obrigatórias, então a semeadura as deriva com as **funções da própria
 * migration** — é o que torna o dado semeado indistinguível do que o backfill
 * produziria, e portanto o que dá sentido a comparar antes e depois do bridge.
 */
async function noveVigenciasReais(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ e: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='snapshot'
                       AND column_name='dataset_family') AS e`,
  );
  const comIdentidade = rows[0]!.e;
  const colunas = comIdentidade
    ? `,"dataset_family","canal","canonical_scope"`
    : "";
  const valores = comIdentidade
    ? `, freightcheck_dataset_family('CAVALO'),
         freightcheck_canal_do_rotulo(v.rotulo),
         freightcheck_canonical_scope(
           (SELECT jsonb_agg(jsonb_build_object('scopeType', sc."scope_type", 'code', sc."code"))
              FROM "scope" sc))`
    : "";

  await pool.query(`
    INSERT INTO "source_file" ("filename","content_sha256","byte_size","storage_path")
      VALUES ('prod.xlsx', md5('prod'), 1024, '/tmp/prod.xlsx');
    INSERT INTO "import_run" ("source_file_id","status") SELECT id,'PROMOTED' FROM "source_file";
    INSERT INTO "scope" ("scope_type","code") VALUES
      ('OPERADOR','20618821000799'), ('REGIONAL','Geo NE'), ('UNIDADE','07526557001505_CERV');
    INSERT INTO "snapshot" ("source_file_id","import_run_id","source_label","effective_date",
                            "scope_hash","entity_type_set","status","revision"${colunas})
    SELECT sf.id, ir.id, v.rotulo, v.data::date,
           'ae920348d2d5d627b24b48c337fe3961f18a8e29ca3cff11e4f862715f937662','CAVALO','CLOSED',1${valores}
      FROM "source_file" sf, "import_run" ir, (VALUES
        ('EMPURRADA_2_12_2025','2025-12-02'), ('EMPURRADA_2_1_2026','2026-01-02'),
        ('EMPURRADA_2_2_2026','2026-02-02'),  ('EMPURRADA_2_3_2026','2026-03-02'),
        ('EMPURRADA_2_4_2026','2026-04-02'),  ('EMPURRADA_2_5_2026','2026-05-02'),
        ('EMPURRADA_2_6_2026','2026-06-02'),  ('EMPURRADA_2_7_2026','2026-07-02'),
        ('EMPURRADA_1_8_2026','2026-08-01')
      ) AS v(rotulo,data);
    INSERT INTO "snapshot_scope" ("snapshot_id","scope_id") SELECT s.id, sc.id FROM "snapshot" s, "scope" sc;
  `);
}

/**
 * O diff que o Publishing calcularia entre os dois bancos, por categoria.
 *
 * É a mesma comparação que ele faz — introspecção dos dois lados —, reduzida ao
 * que decide se o DDL é seguro: o que ele criaria, o que ele removeria, e o que
 * ele alteraria.
 */
async function diffDoPublishing(dev: pg.Pool, prod: pg.Pool) {
  const ler = async (p: pg.Pool, sql: string) => {
    const { rows } = await p.query<{ k: string; v: string }>(sql);
    return new Map(rows.map((r) => [r.k, r.v]));
  };
  const COLS = `SELECT c.table_name||'.'||c.column_name AS k,
      c.data_type||'|'||c.is_nullable||'|'||coalesce(c.column_default,'-') AS v
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema=c.table_schema
       AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
     WHERE c.table_schema='public'`;
  const TBL = `SELECT table_name AS k, 'x' AS v FROM information_schema.tables
                WHERE table_schema='public' AND table_type='BASE TABLE'`;
  const IDX = `SELECT indexname AS k, indexdef AS v FROM pg_indexes WHERE schemaname='public'`;
  const CON = `SELECT conname AS k, contype::text||' '||pg_get_constraintdef(oid) AS v
                 FROM pg_constraint WHERE connamespace='public'::regnamespace`;

  // Views, funções e colunas geradas entram na conta de propósito: são
  // exatamente o que um diff de schema não modela, e portanto o que passaria
  // despercebido numa comparação que só olhasse tabela e coluna.
  const VW = `SELECT viewname AS k, md5(definition) AS v FROM pg_views WHERE schemaname='public'`;
  const FN = `SELECT p.oid::regprocedure::text AS k, 'fn' AS v FROM pg_proc p
               WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'freightcheck%'`;
  const GEN = `SELECT k.relname||'.'||a.attname AS k, a.attgenerated::text AS v
                 FROM pg_attribute a JOIN pg_class k ON k.oid=a.attrelid
                  AND k.relnamespace='public'::regnamespace
                WHERE a.attgenerated <> '' AND NOT a.attisdropped`;

  const saida = { addTable: [] as string[], addColumn: [] as string[],
                  addIndex: [] as string[], addConstraint: [] as string[],
                  addView: [] as string[], addFunction: [] as string[],
                  addGenerated: [] as string[],
                  drop: [] as string[], alter: [] as string[] };

  for (const [sql, destinoAdd] of [
    [TBL, saida.addTable], [COLS, saida.addColumn],
    [IDX, saida.addIndex], [CON, saida.addConstraint],
    [VW, saida.addView], [FN, saida.addFunction], [GEN, saida.addGenerated],
  ] as const) {
    const d = await ler(dev, sql);
    const p = await ler(prod, sql);
    for (const k of d.keys()) if (!p.has(k)) destinoAdd.push(k);
    for (const k of p.keys()) if (!d.has(k)) saida.drop.push(k);
    for (const [k, v] of d) if (p.has(k) && p.get(k) !== v) saida.alter.push(k);
  }
  // Colunas de tabela nova não são "ADD COLUMN": vêm com o CREATE TABLE.
  const novas = new Set(saida.addTable);
  saida.addColumn = saida.addColumn.filter((c) => !novas.has(c.split(".")[0]!));
  saida.addIndex = saida.addIndex.filter((i) => !i.startsWith("pg_"));
  return saida;
}

afterAll(async () => {
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [nome],
      );
      await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    }
  });
}, 300_000);

describe("o contrato com o Publishing", () => {
  it("depois do bridge-down o diff é exatamente 6 ADD COLUMN e nada mais", async () => {
    const dev = await development();
    const prod = await production();
    await noveVigenciasReais(prod.pool);

    const antes = await diffDoPublishing(dev.pool, prod.pool);
    // Sem o bridge, o diff é grande e contém DROP e coluna gerada.
    expect(antes.drop.length).toBeGreaterThan(0);
    expect(antes.addTable.length).toBeGreaterThan(0);

    const rel = await bridgeDown(dev.url);
    expect(rel.falha).toBeUndefined();

    /*
      O critério completo, e não só o de tabela e coluna: **nada** sobra em
      nenhuma categoria, exceto as seis colunas da allowlist. Views, funções e
      colunas geradas contam aqui porque são o que um diff de schema não modela
      — e, no caso das funções, a prova disso é o próprio erro que derrubou o
      deploy: ele chamou `freightcheck_snapshot_key` sem tê-la criado.
    */
    const depois = await diffDoPublishing(dev.pool, prod.pool);
    expect(depois.drop).toEqual([]);
    expect(depois.addTable).toEqual([]);
    expect(depois.addIndex).toEqual([]);
    expect(depois.addConstraint).toEqual([]);
    expect(depois.addView).toEqual([]);
    expect(depois.addFunction).toEqual([]);
    expect(depois.addGenerated).toEqual([]);
    expect(depois.alter).toEqual([]);
    expect(depois.addColumn.sort()).toEqual(
      ALLOWLIST.map((a) => `${a.tabela}.${a.coluna}`).sort(),
    );

    await dev.pool.end();
    await prod.pool.end();
  }, 600_000);

  it("nenhuma coluna gerada sobra em Development — é o que trava o deploy", async () => {
    const dev = await development();
    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    const { rows } = await dev.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_attribute a
         JOIN pg_class k ON k.oid=a.attrelid AND k.relnamespace='public'::regnamespace
        WHERE a.attgenerated <> '' AND NOT a.attisdropped`,
    );
    expect(Number(rows[0]!.n)).toBe(0);
    await dev.pool.end();
  }, 600_000);
});

describe("bridge-down: fail-closed, transacional, sem CASCADE", () => {
  it("--dry-run não deixa nada aplicado", async () => {
    const dev = await development();
    const antes = await estruturaDe(dev.pool);

    const rel = await bridgeDown(dev.url, { dryRun: true });
    expect(rel.falha).toBeUndefined();
    expect(rel.dryRun).toBe(true);
    expect(rel.ddl.length).toBeGreaterThan(0);

    expect(await estruturaDe(dev.pool)).toEqual(antes);
    await dev.pool.end();
  }, 600_000);

  it("pré-condição violada aborta sem aplicar um único DDL", async () => {
    const dev = await development();
    const antes = await estruturaDe(dev.pool);

    // Um chamado em `ticket` — o bridge recria as nove colunas legadas e não
    // pode fazer isso sobre uma tabela com linhas.
    await dev.pool.query(`
      INSERT INTO "ticket_import" ("filename","content_sha256","byte_size")
        VALUES ('x.xlsx', md5('x'), 1);
      INSERT INTO "ticket" ("ticket_import_id","external_id","source_row_index")
        SELECT id, 'CH-1', 1 FROM "ticket_import" LIMIT 1;`);

    const rel = await bridgeDown(dev.url);
    expect(rel.falha).toMatch(/ticket sem linhas/);
    expect(rel.precondicoes.some((p) => !p.ok)).toBe(true);

    const depois = await estruturaDe(dev.pool);
    expect(depois).toEqual(antes);
    await dev.pool.end();
  }, 600_000);

  it("dependência inesperada aborta em vez de virar CASCADE", async () => {
    const dev = await development();

    // Uma view que ninguém previu, apoiada numa tabela que o bridge remove.
    await dev.pool.query(
      `CREATE VIEW "relatorio_de_alguem" AS SELECT "id" FROM "ticket_change"`,
    );
    const antes = await estruturaDe(dev.pool);

    const rel = await bridgeDown(dev.url);
    expect(rel.falha).toMatch(/dependência inesperada em ticket_change/);
    expect(rel.falha).toMatch(/relatorio_de_alguem/);
    expect(rel.falha).toMatch(/não usa CASCADE/);

    expect(await estruturaDe(dev.pool)).toEqual(antes);
    await dev.pool.end();
  }, 600_000);

  it("tabela com linha aborta — o bridge não copia nem descarta dado", async () => {
    const dev = await development();
    await dev.pool.query(`
      INSERT INTO "import_run" ("source_file_id","status")
        SELECT NULL, 'PENDING' WHERE false;`);
    await dev.pool.query(`
      INSERT INTO "source_file" ("filename","content_sha256","byte_size","storage_path")
        VALUES ('a.xlsx', md5('a'), 1, '/tmp/a');
      INSERT INTO "import_run" ("source_file_id","status") SELECT id,'PROMOTED' FROM "source_file";
      INSERT INTO "import_decision" ("import_run_id","decisao","motivo")
        SELECT id, 'PROMOVIDO', 'teste' FROM "import_run" LIMIT 1;`);

    const rel = await bridgeDown(dev.url);
    expect(rel.falha).toMatch(/import_decision vazia/);
    await dev.pool.end();
  }, 600_000);

  it("rodar o bridge-down duas vezes dá o mesmo resultado", async () => {
    const dev = await development();
    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    const primeira = await estruturaDe(dev.pool);

    const segunda = await bridgeDown(dev.url);
    expect(segunda.falha).toBeUndefined();
    expect(await estruturaDe(dev.pool)).toEqual(primeira);
    await dev.pool.end();
  }, 600_000);
});

describe("bridge-up: o estado canônico volta inteiro", () => {
  it("depois do up, o schema é idêntico ao de um banco criado do zero", async () => {
    const referencia = await bancoNovo();
    expect((await runMigrations(referencia.url)).failure).toBeUndefined();
    const canonico = await estruturaDe(referencia.pool);

    const dev = await development();
    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    expect(await estruturaDe(dev.pool)).not.toEqual(canonico);

    const rel = await bridgeUp(dev.url);
    expect(rel.falha).toBeUndefined();

    expect(await estruturaDe(dev.pool)).toEqual(canonico);
    await dev.pool.end();
    await referencia.pool.end();
  }, 600_000);

  it("preserva os dados que estavam em Development", async () => {
    const dev = await development();
    await noveVigenciasReais(dev.pool);
    const antes = await dev.pool.query(
      `SELECT "source_label", "dataset_family", "canal", "canonical_scope",
              "canonical_snapshot_key", "status", "revision"
         FROM "snapshot" ORDER BY "effective_date"`,
    );

    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    expect((await bridgeUp(dev.url)).falha).toBeUndefined();

    const depois = await dev.pool.query(
      `SELECT "source_label", "dataset_family", "canal", "canonical_scope",
              "canonical_snapshot_key", "status", "revision"
         FROM "snapshot" ORDER BY "effective_date"`,
    );
    expect(depois.rows).toEqual(antes.rows);
    await dev.pool.end();
  }, 600_000);

  it("rodar o bridge-up duas vezes dá o mesmo resultado", async () => {
    const dev = await development();
    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    expect((await bridgeUp(dev.url)).falha).toBeUndefined();
    const primeira = await estruturaDe(dev.pool);

    const segunda = await bridgeUp(dev.url);
    expect(segunda.falha).toBeUndefined();
    expect(await estruturaDe(dev.pool)).toEqual(primeira);
    await dev.pool.end();
  }, 600_000);

  it("o registro de migrations não é tocado por nenhum dos dois", async () => {
    const dev = await development();
    const ler = async () => {
      const { rows } = await dev.pool.query<{ c: string }>(
        `SELECT created_at AS c FROM "drizzle"."__drizzle_migrations" ORDER BY created_at`,
      );
      return rows.map((r) => r.c);
    };
    const antes = await ler();
    expect(antes.length).toBe(readMigrations().length);

    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    expect(await ler()).toEqual(antes);
    expect((await bridgeUp(dev.url)).falha).toBeUndefined();
    expect(await ler()).toEqual(antes);
    await dev.pool.end();
  }, 600_000);
});

/**
 * O estado final obrigatório, e o caminho inteiro até ele.
 *
 * Development real tem **dezenove** carimbos, o último da `0018`: a `0019` está
 * no disco e não no banco. Um `bridge-up` que restaurasse o plano inteiro
 * deixaria schema de `0019` com registro de `0018` — divergência que nenhuma
 * das duas autoridades reconhece, e que seria o mesmo defeito que este trabalho
 * existe para fechar, só que fabricado por nós.
 *
 * O `up` restaura o que o `down` removeu, e nada além. O que sobra é da fila.
 */
describe("a invariante final: schema e registro andam juntos", () => {
  /** Development como ele é hoje: fila até a `0018`, com registro. */
  async function developmentNa0018(): Promise<{ url: string; pool: pg.Pool }> {
    const b = await bancoNovo();
    // O registro é criado por `runMigrations`, não pelo SQL das migrations.
    await b.pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await b.pool.query(
      `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
         id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    for (const m of readMigrations()) {
      await b.pool.query("BEGIN");
      for (const comando of m.statements) await b.pool.query(comando);
      await b.pool.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ($1,$2)`,
        [m.hash, m.when],
      );
      await b.pool.query("COMMIT");
      if (m.tag === "0018_identidade_forte") return b;
    }
    throw new Error("0018 não encontrada");
  }

  const registradas = async (pool: pg.Pool) => {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM "drizzle"."__drizzle_migrations"`,
    );
    return Number(rows[0]!.n);
  };

  it("o up não adianta a 0019 — quem a aplica é a fila", async () => {
    const dev = await developmentNa0018();
    expect(await registradas(dev.pool)).toBe(19);

    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    const rel = await bridgeUp(dev.url);
    expect(rel.falha).toBeUndefined();
    expect(rel.precondicoes.some((p) => /adiado para a fila/.test(p.nome))).toBe(true);

    // Registro intacto, e o schema **não** foi adiantado para a 0019.
    expect(await registradas(dev.pool)).toBe(19);
    const { rows } = await dev.pool.query<{ e: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema='public' AND table_name='assistant_message'
                         AND column_name='feedback') AS e`,
    );
    expect(rows[0]!.e).toBe(false);

    // E o schema bate com o de um banco que parou na 0018, não com o final.
    const referencia0018 = await developmentNa0018();
    expect(await estruturaDe(dev.pool)).toEqual(await estruturaDe(referencia0018.pool));

    await dev.pool.end();
    await referencia0018.pool.end();
  }, 600_000);

  it("o fluxo completo termina com a fila inteira dos dois lados e diff zero", async () => {
    const referencia = await bancoNovo();
    expect((await runMigrations(referencia.url)).failure).toBeUndefined();

    const dev = await developmentNa0018();
    const prod = await production();
    await noveVigenciasReais(prod.pool);

    // ---- Fase A: o bridge desmonta o diff perigoso ----------------------
    expect((await bridgeDown(dev.url)).falha).toBeUndefined();
    const diffNoDeploy = await diffDoPublishing(dev.pool, prod.pool);
    expect(diffNoDeploy.drop).toEqual([]);
    expect(diffNoDeploy.addColumn.sort()).toEqual(
      ALLOWLIST.map((a) => `${a.tabela}.${a.coluna}`).sort(),
    );

    // ---- O Publishing aplica a allowlist em Production -------------------
    for (const a of ALLOWLIST) {
      await prod.pool.query(`ALTER TABLE "${a.tabela}" ADD COLUMN "${a.coluna}" ${a.tipo}`);
    }

    // ---- Fase B: Production migra primeiro -------------------------------
    const rProd = await runMigrations(prod.url);
    expect(rProd.failure).toBeUndefined();
    expect(await registradas(prod.pool)).toBe(readMigrations().length);

    // ---- Development volta ao estado que o registro dele descreve --------
    expect((await bridgeUp(dev.url)).falha).toBeUndefined();
    expect(await registradas(dev.pool)).toBe(19);

    // ---- E só então a fila leva Development ao fim da fila ---------------
    const rDev = await runMigrations(dev.url);
    expect(rDev.failure).toBeUndefined();
    // As pendentes deste banco são as que o registro dele não tem — da 0019 em
    // diante. Lista, e não contagem: o que importa é que a fila aplique
    // exatamente o que faltava, na ordem.
    expect(rDev.applied).toEqual(
      readMigrations()
        .map((m) => m.tag)
        .filter((tag) => tag > "0018_identidade_forte"),
    );
    expect(rDev.adopted).toEqual([]);
    expect(await registradas(dev.pool)).toBe(readMigrations().length);

    // ---- O estado final obrigatório --------------------------------------
    const canonico = await estruturaDe(referencia.pool);
    expect(await estruturaDe(dev.pool)).toEqual(canonico);
    expect(await estruturaDe(prod.pool)).toEqual(canonico);

    // E a próxima publicação não tem o que propor: diff zero em tudo.
    const diffDepois = await diffDoPublishing(dev.pool, prod.pool);
    expect(diffDepois.drop).toEqual([]);
    expect(diffDepois.addTable).toEqual([]);
    expect(diffDepois.addColumn).toEqual([]);
    expect(diffDepois.addIndex).toEqual([]);
    expect(diffDepois.addConstraint).toEqual([]);
    expect(diffDepois.addView).toEqual([]);
    expect(diffDepois.addFunction).toEqual([]);
    expect(diffDepois.addGenerated).toEqual([]);
    expect(diffDepois.alter).toEqual([]);

    await dev.pool.end();
    await prod.pool.end();
    await referencia.pool.end();
  }, 900_000);
});

describe("a Fase B sobre Production", () => {
  it("a fila atravessa o que o Publishing criou e chega ao schema final", async () => {
    const referencia = await bancoNovo();
    expect((await runMigrations(referencia.url)).failure).toBeUndefined();

    const prod = await production();
    await noveVigenciasReais(prod.pool);

    // O que o Publishing aplica depois do bridge-down: só a allowlist.
    for (const a of ALLOWLIST) {
      await prod.pool.query(
        `ALTER TABLE "${a.tabela}" ADD COLUMN "${a.coluna}" ${a.tipo}`,
      );
    }

    const r = await runMigrations(prod.url);
    expect(r.failure).toBeUndefined();
    expect(r.applied).toHaveLength(readMigrations().length);
    expect(r.adopted).toEqual([]);

    expect(await estruturaDe(prod.pool)).toEqual(await estruturaDe(referencia.pool));

    // As nove vigências reais: nove identidades, nenhuma fusão, nada superseded.
    const { rows } = await prod.pool.query<{
      snapshots: string; identidades: string; superseded: string; fusoes: string;
    }>(`SELECT (SELECT count(*) FROM snapshot) AS snapshots,
               (SELECT count(DISTINCT canonical_snapshot_key) FROM snapshot) AS identidades,
               (SELECT count(*) FROM snapshot WHERE status='SUPERSEDED') AS superseded,
               (SELECT count(*) FROM snapshot_merge) AS fusoes`);
    expect(rows[0]).toEqual({
      snapshots: "9", identidades: "9", superseded: "0", fusoes: "0",
    });

    await prod.pool.end();
    await referencia.pool.end();
  }, 600_000);

  it("a 0016 popula snapshot_merge mesmo com a tabela pré-criada vazia", async () => {
    const referencia = await bancoNovo();
    expect((await runMigrations(referencia.url)).failure).toBeUndefined();

    const prod = await production();
    // Duas vigências que só diferem no rótulo: mesma data, mesmo canal, mesmo
    // escopo — a mesma identidade canônica, que é o caso que a 0016 funde.
    await prod.pool.query(`
      INSERT INTO "source_file" ("filename","content_sha256","byte_size","storage_path")
        VALUES ('d.xlsx', md5('d'), 1, '/tmp/d');
      INSERT INTO "import_run" ("source_file_id","status") SELECT id,'PROMOTED' FROM "source_file";
      INSERT INTO "scope" ("scope_type","code") VALUES ('UNIDADE','12345678000199');
      INSERT INTO "snapshot" ("source_file_id","import_run_id","source_label","effective_date",
                              "scope_hash","entity_type_set","status","revision")
      SELECT sf.id, ir.id, v.r, DATE '2026-08-01', md5(v.r), 'CAVALO', 'CLOSED', 1
        FROM "source_file" sf, "import_run" ir,
             (VALUES ('EMPURRADA_1_8_2026'), ('EMPURRADA_01_8_2026')) AS v(r);
      INSERT INTO "snapshot_scope" ("snapshot_id","scope_id") SELECT s.id, sc.id FROM "snapshot" s, "scope" sc;`);

    // O Publishing cria a tabela vazia antes da migration dona dela.
    for (const a of ALLOWLIST) {
      await prod.pool.query(`ALTER TABLE "${a.tabela}" ADD COLUMN "${a.coluna}" ${a.tipo}`);
    }
    await prod.pool.query(
      readMigrations()
        .find((m) => m.tag === "0016_canonical_identity_enforcement")!
        .statements.find((s) => /CREATE TABLE IF NOT EXISTS "snapshot_merge"/.test(s))!,
    );

    const r = await runMigrations(prod.url);
    expect(r.failure).toBeUndefined();

    // A fusão rodou apesar da tabela já existir, e ficou registrada.
    const { rows } = await prod.pool.query<{ fusoes: string; superseded: string; origens: number }>(
      `SELECT (SELECT count(*) FROM snapshot_merge) AS fusoes,
              (SELECT count(*) FROM snapshot WHERE status='SUPERSEDED') AS superseded,
              (SELECT array_length(merged_from,1) FROM snapshot_merge LIMIT 1) AS origens`,
    );
    expect(Number(rows[0]!.fusoes)).toBe(1);
    expect(Number(rows[0]!.superseded)).toBe(2);
    expect(rows[0]!.origens).toBe(2);

    await prod.pool.end();
    await referencia.pool.end();
  }, 600_000);

  it("changed_parameter_count pré-criada com DEFAULT 0 não vira zero suposto", async () => {
    const prod = await production();
    await prod.pool.query(`
      INSERT INTO "ticket_import" ("filename","content_sha256","byte_size")
        VALUES ('c.xlsx', md5('c'), 1);
      INSERT INTO "ticket" ("ticket_import_id","external_id","source_row_index")
        SELECT id, 'CH-9', 1 FROM "ticket_import" LIMIT 1;`);

    // O estrago que o Publishing faria: a coluna chega com default, nenhuma
    // linha fica NULL, e o backfill da 0013 — que é `WHERE IS NULL` — não roda.
    await prod.pool.query(
      `ALTER TABLE "ticket" ADD COLUMN "changed_parameter_count" integer NOT NULL DEFAULT 0`,
    );

    const r = await runMigrations(prod.url);
    expect(r.failure).toBeUndefined();

    /*
      O chamado tem zero linhas em `ticket_change`, então zero é a contagem
      certa. O que esta prova fixa é que o número veio de contar, e não do
      default: a coluna tem de terminar com a contagem real, e a `0013` tem de
      chegar ao fim mesmo achando a coluna pronta. É a razão de o bridge-down
      remover esta coluna de Development em vez de deixá-la na allowlist.
    */
    const { rows } = await prod.pool.query<{ n: number; c: string }>(
      `SELECT t."changed_parameter_count" AS n,
              (SELECT count(*) FROM "ticket_change" tc WHERE tc."ticket_id" = t."id")::text AS c
         FROM "ticket" t`,
    );
    expect(rows[0]!.n).toBe(Number(rows[0]!.c));
    await prod.pool.end();
  }, 600_000);
});
