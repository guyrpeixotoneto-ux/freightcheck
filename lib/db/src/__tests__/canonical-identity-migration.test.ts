import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readMigrations, runMigrations } from "../migrate";

/**
 * A `0015` contra bancos que não são o caso feliz.
 *
 * O caso feliz — banco novo, fila inteira — já é coberto por todo teste que
 * cria um banco de teste. O que se prova aqui é o resto: um banco parado na
 * `0014` com vigências históricas de verdade, um banco que atravessou pela
 * metade o SQL automático do Publishing, um banco em que alguém deixou um
 * objeto homônimo com outra definição, e dados históricos que não conseguem
 * virar identidade canônica.
 *
 * Tudo contra PostgreSQL de verdade. Coluna gerada, constraint, gatilho e
 * `ALTER TABLE ... DISABLE TRIGGER` não têm simulacro que prove alguma coisa.
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

/** Um banco em branco, com o registro de migrations já criado. */
async function bancoNovo(): Promise<{ nome: string; url: string; pool: pg.Pool }> {
  const nome = `fc_mig_${process.pid}_${++sequencia}`;
  await comAdmin(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await admin.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const url = urlDe(nome);
  const pool = new pg.Pool({ connectionString: url });
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  return { nome, url, pool };
}

/**
 * Aplica a fila até `ate` (inclusive) do mesmo jeito que `runMigrations` — uma
 * transação por migration, registro por carimbo — e para ali.
 *
 * O que já está registrado é pulado, de modo que dois pontos de parada em
 * sequência (`0014`, gravar histórico, `0019`) sejam a continuação da mesma
 * fila e não uma segunda tentativa de aplicá-la desde a `0000`.
 */
async function aplicarAte(pool: pg.Pool, ate: string): Promise<void> {
  const { rows } = await pool.query<{ created_at: string }>(
    `SELECT created_at FROM "drizzle"."__drizzle_migrations"`,
  );
  const aplicadas = new Set(rows.map((l) => Number(l.created_at)));

  for (const m of readMigrations()) {
    if (!aplicadas.has(m.when)) {
      await pool.query("BEGIN");
      for (const comando of m.statements) await pool.query(comando);
      await pool.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`,
        [m.hash, m.when],
      );
      await pool.query("COMMIT");
    }
    if (m.tag === ate) return;
  }
  throw new Error(`migration ${ate} não existe`);
}

interface VigenciaHistorica {
  rotulo: string;
  data: string;
  /** CNPJ da unidade. `null` grava a vigência sem nenhum escopo. */
  unidade: string | null;
  status?: "DRAFT" | "CLOSED" | "SUPERSEDED";
}

/**
 * Vigências como elas existiam antes da `0015`: sem as três colunas de
 * identidade, com o escopo em `snapshot_scope`, e com um fato cada uma para
 * que "os dados continuam íntegros" tenha o que conferir.
 */
async function gravarHistorico(
  pool: pg.Pool,
  vigencias: VigenciaHistorica[],
): Promise<string[]> {
  const ids: string[] = [];

  const { rows: arquivo } = await pool.query<{ id: string }>(
    `INSERT INTO "source_file" ("filename", "content_sha256", "byte_size", "storage_path")
     VALUES ('historico.xlsx', md5(random()::text), 1024, '/tmp/historico.xlsx')
     RETURNING "id"`,
  );
  const { rows: run } = await pool.query<{ id: string }>(
    `INSERT INTO "import_run" ("source_file_id", "status") VALUES ($1, 'PROMOTED') RETURNING "id"`,
    [arquivo[0]!.id],
  );
  const { rows: entidade } = await pool.query<{ id: string }>(
    `INSERT INTO "entity" ("entity_type") VALUES ('CARRETA') RETURNING "id"`,
  );
  const { rows: atributo } = await pool.query<{ id: string }>(
    `INSERT INTO "attribute" ("code", "source_name", "entity_type", "data_type", "first_seen_import_run_id")
     VALUES ('remuneracao.base', 'Remuneração base', 'CARRETA', 'NUMERIC', $1) RETURNING "id"`,
    [run[0]!.id],
  );

  // `fact.raw_cell_id` é obrigatório desde a fundação: todo fato aponta para a
  // célula de onde saiu.
  const { rows: aba } = await pool.query<{ id: string }>(
    `INSERT INTO "raw_sheet" ("import_run_id", "sheet_name", "sheet_index", "row_count", "column_count", "role", "role_reason")
     VALUES ($1, 'carretas', 0, 1, 1, 'SOURCE', 'fixture') RETURNING "id"`,
    [run[0]!.id],
  );
  const { rows: linha } = await pool.query<{ id: string }>(
    `INSERT INTO "raw_row" ("raw_sheet_id", "row_index", "is_header") VALUES ($1, 2, false) RETURNING "id"`,
    [aba[0]!.id],
  );

  let coluna = 0;
  for (const v of vigencias) {
    coluna++;
    const { rows: snap } = await pool.query<{ id: string }>(
      `INSERT INTO "snapshot" (
         "source_file_id", "import_run_id", "source_label", "effective_date",
         "scope_hash", "entity_type_set", "status")
       VALUES ($1, $2, $3, $4, md5($3), 'CARRETA', 'DRAFT')
       RETURNING "id"`,
      [arquivo[0]!.id, run[0]!.id, v.rotulo, v.data],
    );
    ids.push(snap[0]!.id);

    if (v.unidade !== null) {
      const { rows: escopo } = await pool.query<{ id: string }>(
        `INSERT INTO "scope" ("scope_type", "code") VALUES ('UNIDADE', $1)
         ON CONFLICT ("scope_type", "code") DO UPDATE SET "code" = EXCLUDED."code"
         RETURNING "id"`,
        [v.unidade],
      );
      await pool.query(
        `INSERT INTO "snapshot_scope" ("snapshot_id", "scope_id") VALUES ($1, $2)`,
        [snap[0]!.id, escopo[0]!.id],
      );
    }

    const { rows: celula } = await pool.query<{ id: string }>(
      `INSERT INTO "raw_cell" ("raw_row_id", "column_index", "column_letter", "raw_value", "source_type")
       VALUES ($1, $2, chr(64 + $2), '1234.56', 'n') RETURNING "id"`,
      [linha[0]!.id, coluna],
    );
    await pool.query(
      `INSERT INTO "fact" ("snapshot_id", "entity_id", "attribute_id", "value_numeric", "value_hash", "is_null", "raw_cell_id")
       VALUES ($1::uuid, $2, $3, 1234.56, md5($1::text), false, $4)`,
      [snap[0]!.id, entidade[0]!.id, atributo[0]!.id, celula[0]!.id],
    );

    // O fato entra com a vigência ainda DRAFT — depois dela fechada, o gatilho
    // de imutabilidade recusa qualquer INSERT, que é o comportamento correto.
    await pool.query(
      `UPDATE "snapshot" SET "status" = $2, "closed_at" = now(),
              "entity_count" = 1, "fact_count" = 1
        WHERE "id" = $1`,
      [snap[0]!.id, v.status ?? "CLOSED"],
    );
  }

  return ids;
}

/** O retrato do que a identidade canônica deixou no banco. */
async function retrato(pool: pg.Pool) {
  const { rows } = await pool.query(
    `SELECT s."source_label", s."dataset_family", s."canal", s."canonical_scope",
            s."canonical_snapshot_key", s."status", s."revision",
            (SELECT count(*) FROM "fact" f WHERE f."snapshot_id" = s."id") AS fatos
       FROM "snapshot" s ORDER BY s."source_label", s."revision"`,
  );
  return rows;
}

afterAll(async () => {
  await comAdmin(async (admin) => {
    for (const nome of criados) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [nome],
      );
      await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
    }
  });
}, 300_000);

describe("0015 sobre um banco parado na 0014", () => {
  it("converte as vigências históricas, tranca a identidade e não perde nada", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    const ids = await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
      { rotulo: "EMPURRADA_01_9_2026", data: "2026-09-01", unidade: "12.345.678/0001-99" },
      { rotulo: "ROTA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);

    const relatorio = await runMigrations(url);
    expect(relatorio.failure).toBeUndefined();
    expect(relatorio.applied).toEqual([
      "0015_canonical_identity",
      "0016_canonical_identity_enforcement",
      "0017_fato_herdado",
      "0018_identidade_forte",
      "0019_assistant_feedback",
      "0020_identidade_search_path",
    ]);

    const linhas = await retrato(pool);
    expect(linhas).toHaveLength(3);
    for (const linha of linhas) {
      expect(linha.dataset_family).toBe("REMUNERACAO_EQUIPAMENTO");
      expect(linha.canonical_snapshot_key).toMatch(/^[0-9a-f]{64}$/);
      expect(Number(linha.fatos)).toBe(1);
    }
    // O canal sai do rótulo, e o CNPJ mascarado e o numérico dão o mesmo escopo.
    expect(linhas.map((l) => l.canal)).toEqual(["EMPURRADA", "EMPURRADA", "ROTA"]);
    expect(linhas[0]!.canonical_scope).toEqual([
      { code: "12345678000199", scopeType: "UNIDADE" },
    ]);
    expect(linhas[1]!.canonical_scope).toEqual(linhas[0]!.canonical_scope);

    // Nenhum snapshot histórico sumiu.
    const { rows: sobrando } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "snapshot" WHERE "id" = ANY($1::uuid[])`,
      [ids],
    );
    expect(sobrando[0]!.n).toBe("3");

    // Canais diferentes na mesma data continuam identidades diferentes.
    const chaves = new Set(linhas.map((l) => l.canonical_snapshot_key));
    expect(chaves.size).toBe(3);
    await pool.end();
  }, 300_000);

  it("funde as duas vigências ativas que a mesma identidade tinha, sem apagar as origens", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    // O caso real: carretas e cavalos da mesma vigência entregues em dois
    // arquivos, com o rótulo escrito de dois jeitos.
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
      { rotulo: "EMPURRADA_01_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);

    const relatorio = await runMigrations(url);
    expect(relatorio.failure).toBeUndefined();

    const { rows: fusao } = await pool.query(
      `SELECT "merged_from", "revisoes_originais", "motivo" FROM "snapshot_merge"`,
    );
    expect(fusao).toHaveLength(1);
    expect(fusao[0]!.merged_from).toHaveLength(2);

    // As origens continuam inteiras, como SUPERSEDED, e a revisão fundida
    // carrega os fatos das duas.
    const { rows: estados } = await pool.query<{ status: string; n: string }>(
      `SELECT "status", count(*)::text AS n FROM "snapshot" GROUP BY 1 ORDER BY 1`,
    );
    expect(estados).toEqual([
      { status: "CLOSED", n: "1" },
      { status: "SUPERSEDED", n: "2" },
    ]);

    const { rows: ativas } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "freightcheck_snapshot_ativo_duplicado"`,
    );
    expect(ativas[0]!.n).toBe("0");
    await pool.end();
  }, 300_000);
});

describe("0015 sobre um banco que atravessou o SQL automático pela metade", () => {
  it("adota o que já está compatível, completa o resto e chega ao mesmo schema", async () => {
    const referencia = await bancoNovo();
    await runMigrations(referencia.url);

    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);

    // O que o diff do Publishing cria: as colunas (aqui já NOT NULL, como ele
    // as propõe), e nada do que as sustenta.
    await pool.query(`ALTER TABLE "snapshot" ADD COLUMN "dataset_family" text`);
    await pool.query(`ALTER TABLE "snapshot" ADD COLUMN "canal" text`);
    await pool.query(`ALTER TABLE "snapshot" ADD COLUMN "canonical_scope" jsonb`);
    // O gatilho de imutabilidade recusaria este UPDATE — e recusaria também o
    // do SQL automático. O estado que se quer montar aqui é o de depois, então
    // ele sai e volta, do mesmo jeito que a migration faz.
    await pool.query(`ALTER TABLE "snapshot" DISABLE TRIGGER "snapshot_immutable"`);
    await pool.query(`UPDATE "snapshot" SET "dataset_family" = 'X', "canal" = 'X', "canonical_scope" = '[]'::jsonb`);
    await pool.query(`ALTER TABLE "snapshot" ENABLE TRIGGER "snapshot_immutable"`);
    for (const c of ["dataset_family", "canal", "canonical_scope"]) {
      await pool.query(`ALTER TABLE "snapshot" ALTER COLUMN "${c}" SET NOT NULL`);
    }

    const relatorio = await runMigrations(url);
    expect(relatorio.failure).toBeUndefined();
    expect(relatorio.applied).toContain("0015_canonical_identity");

    // O valor artificial que estava lá não sobreviveu: identidade se deriva da
    // origem, sempre.
    const linhas = await retrato(pool);
    expect(linhas[0]!.canal).toBe("EMPURRADA");
    expect(linhas[0]!.dataset_family).toBe("REMUNERACAO_EQUIPAMENTO");
    expect(linhas[0]!.canonical_scope).toEqual([
      { code: "12345678000199", scopeType: "UNIDADE" },
    ]);
    expect(Number(linhas[0]!.fatos)).toBe(1);

    const daqui = await estrutura(pool);
    const de_referencia = await estrutura(referencia.pool);
    expect(daqui).toEqual(de_referencia);
    await pool.end();
    await referencia.pool.end();
  }, 300_000);

  it("adota a coluna gerada e o índice quando já estão com a definição certa", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);

    // Um estado ainda mais adiantado: alguém rodou o pedaço estrutural inteiro,
    // funções incluídas, e parou antes do backfill.
    const sql = readMigrations().find((m) => m.tag === "0015_canonical_identity")!;
    for (const comando of sql.statements) {
      if (/CREATE OR REPLACE FUNCTION/i.test(comando)) await pool.query(comando);
    }
    await pool.query(`ALTER TABLE "snapshot" ADD COLUMN "dataset_family" text`);
    await pool.query(`ALTER TABLE "snapshot" ADD COLUMN "canal" text`);
    await pool.query(`ALTER TABLE "snapshot" ADD COLUMN "canonical_scope" jsonb`);
    await pool.query(
      `ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text
       GENERATED ALWAYS AS (freightcheck_snapshot_key("source_system", "dataset_family", "canal", "effective_date", "canonical_scope")) STORED`,
    );
    await pool.query(
      `CREATE INDEX "snapshot_canonical_key_idx" ON "snapshot" USING btree ("canonical_snapshot_key")`,
    );

    const relatorio = await runMigrations(url);
    expect(relatorio.failure).toBeUndefined();
    const linhas = await retrato(pool);
    expect(linhas[0]!.canal).toBe("EMPURRADA");
    expect(linhas[0]!.canonical_snapshot_key).toMatch(/^[0-9a-f]{64}$/);
    await pool.end();
  }, 300_000);
});

describe("0015 diante de um objeto incompatível", () => {
  it("aborta quando canonical_snapshot_key existe com outra expressão", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);
    await pool.query(
      `ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text
       GENERATED ALWAYS AS (md5("source_label")) STORED`,
    );

    const relatorio = await runMigrations(url);
    expect(relatorio.failure?.tag).toBe("0015_canonical_identity");
    expect(relatorio.failure?.message).toContain("canonical_snapshot_key");
    expect(relatorio.failure?.message).toContain("Nada foi alterado");

    // A transação inteira voltou: nem as colunas nem o backfill ficaram.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns
        WHERE table_name = 'snapshot' AND column_name = 'canal'`,
    );
    expect(rows[0]!.n).toBe("0");
    await pool.end();
  }, 300_000);

  it("aborta quando uma constraint da identidade existe com outra definição", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);
    await pool.query(`ALTER TABLE "snapshot" ADD COLUMN "canal" text`);
    await pool.query(
      `ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_canal_nao_vazio_ck" CHECK (length("canal") > 3)`,
    );

    const relatorio = await runMigrations(url);
    expect(relatorio.failure?.tag).toBe("0015_canonical_identity");
    expect(relatorio.failure?.message).toContain("snapshot_canal_nao_vazio_ck");
    expect(relatorio.failure?.message).toContain("outra definição");
    await pool.end();
  }, 300_000);

  it("aborta quando uma função da identidade existe com outra assinatura", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await pool.query(
      `CREATE FUNCTION freightcheck_norm_canal(v text, extra int) RETURNS text
         AS $$ SELECT v $$ LANGUAGE sql IMMUTABLE`,
    );

    const relatorio = await runMigrations(url);
    expect(relatorio.failure?.tag).toBe("0015_canonical_identity");
    expect(relatorio.failure?.message).toContain("freightcheck_norm_canal");
    await pool.end();
  }, 300_000);
});

describe("0015 diante de dado que não vira identidade", () => {
  it("aborta, nomeando a vigência, quando o rótulo não produz canal", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
      { rotulo: "___", data: "2026-08-01", unidade: "12345678000199" },
    ]);

    const relatorio = await runMigrations(url);
    expect(relatorio.failure?.tag).toBe("0015_canonical_identity");
    expect(relatorio.failure?.message).toContain("canal vazio");
    expect(relatorio.failure?.message).toContain("___");

    // Parou antes do NOT NULL: a coluna não chegou a existir.
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns
        WHERE table_name = 'snapshot' AND column_name = 'canal'`,
    );
    expect(rows[0]!.n).toBe("0");
    await pool.end();
  }, 300_000);

  it("aborta, nomeando a vigência, quando ela não tem escopo nenhum", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: null },
    ]);

    const relatorio = await runMigrations(url);
    expect(relatorio.failure?.tag).toBe("0015_canonical_identity");
    expect(relatorio.failure?.message).toContain("sem escopo");
    expect(relatorio.failure?.message).toContain("EMPURRADA_1_8_2026");
    await pool.end();
  }, 300_000);

  it("não converte identidade inválida em valor padrão para caber no NOT NULL", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "___", data: "2026-08-01", unidade: "12345678000199" },
    ]);
    await runMigrations(url);

    const { rows } = await pool.query(
      `SELECT "source_label" FROM "snapshot"`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source_label).toBe("___");
    await pool.end();
  }, 300_000);
});

describe("reentrância", () => {
  it("reaplicar a 0015 sobre um banco já migrado não altera nada", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
      { rotulo: "ROTA_1_8_2026", data: "2026-08-01", unidade: "98765432000111" },
    ]);
    expect((await runMigrations(url)).failure).toBeUndefined();

    const antes = await retrato(pool);
    const estruturaAntes = await estrutura(pool);

    // A `0015` de novo, statement por statement, como se o registro tivesse se
    // perdido e a fila recomeçasse dali.
    const m = readMigrations().find((x) => x.tag === "0015_canonical_identity")!;
    await pool.query("BEGIN");
    for (const comando of m.statements) await pool.query(comando);
    await pool.query("COMMIT");

    expect(await retrato(pool)).toEqual(antes);
    expect(await estrutura(pool)).toEqual(estruturaAntes);

    // E o gatilho de imutabilidade continua de pé.
    await expect(
      pool.query(`UPDATE "snapshot" SET "entity_count" = 99 WHERE "status" = 'CLOSED'`),
    ).rejects.toThrow(/CLOSED and immutable/);
    await pool.end();
  }, 300_000);

  it("devolve o gatilho de imutabilidade mesmo quando o backfill falha", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "___", data: "2026-08-01", unidade: "12345678000199" },
    ]);
    // Falha na validação, depois do backfill e com o gatilho já reposto.
    expect((await runMigrations(url)).failure).toBeDefined();

    const { rows } = await pool.query<{ habilitado: string }>(
      `SELECT t.tgenabled AS habilitado FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'snapshot' AND t.tgname = 'snapshot_immutable'`,
    );
    expect(rows[0]!.habilitado).toBe("O");
    await pool.end();
  }, 300_000);
});

describe("0013 sobre um banco em que o diff dos chamados foi aceito", () => {
  /**
   * O estado do print: produção parada na `0012`, e alguém aceitou a proposta
   * do Publishing — as nove colunas de parâmetro saíram de `ticket`,
   * `changed_parameter_count` entrou, `ticket_change` foi criada. O schema
   * mudou; o registro de migrations, não.
   *
   * Sem reentrância a fila morria aqui, em `duplicate_column`, e `0014`–`0018`
   * nunca entrariam. É o mesmo travamento que a adoção já teve de resolver uma
   * vez neste projeto.
   */
  it("adota o que o diff deixou pronto e completa o resto", async () => {
    const referencia = await bancoNovo();
    await runMigrations(referencia.url);

    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0012_chamados");

    for (const coluna of [
      "parameter_label",
      "attribute_code",
      "requested_value_raw",
      "requested_value_numeric",
      "applied_value_raw",
      "applied_value_numeric",
      "impact_amount",
      "impact_confidence",
      "impact_reason",
    ]) {
      await pool.query(`ALTER TABLE "ticket" DROP COLUMN IF EXISTS "${coluna}"`);
    }
    await pool.query(
      `ALTER TABLE "ticket" ADD COLUMN "changed_parameter_count" integer DEFAULT 0 NOT NULL`,
    );

    const relatorio = await runMigrations(url);
    expect(relatorio.failure).toBeUndefined();
    expect(relatorio.applied).toContain("0013_chamados_por_parametro");
    expect(relatorio.applied).toContain("0018_identidade_forte");

    expect(await estrutura(pool)).toEqual(await estrutura(referencia.pool));
    await pool.end();
    await referencia.pool.end();
  }, 300_000);

  it("aborta quando a coluna homônima chegou com outro tipo", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0012_chamados");
    await pool.query(
      `ALTER TABLE "ticket" ADD COLUMN "changed_parameter_count" text`,
    );

    const relatorio = await runMigrations(url);
    expect(relatorio.failure?.tag).toBe("0013_chamados_por_parametro");
    expect(relatorio.failure?.message).toContain("changed_parameter_count");
    expect(relatorio.failure?.message).toContain("Nada foi alterado");
    await pool.end();
  }, 300_000);
});

describe("0018 sobre um banco que já tinha passado pela 0015 antiga", () => {
  /** As quatro constraints, como um banco pré-`0018` não as tinha. */
  async function tirarAsConstraints(pool: pg.Pool): Promise<void> {
    for (const nome of [
      "snapshot_canonical_scope_ck",
      "snapshot_canal_nao_vazio_ck",
      "snapshot_dataset_family_nao_vazio_ck",
      "snapshot_canonical_scope_nao_vazio_ck",
    ]) {
      await pool.query(`ALTER TABLE "snapshot" DROP CONSTRAINT IF EXISTS "${nome}"`);
    }
  }

  async function rodar0018(pool: pg.Pool): Promise<void> {
    const m = readMigrations().find((x) => x.tag === "0018_identidade_forte")!;
    await pool.query("BEGIN");
    for (const comando of m.statements) await pool.query(comando);
    await pool.query("COMMIT");
  }

  const nomes = async (pool: pg.Pool) => {
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'snapshot' AND c.contype = 'c' ORDER BY 1`,
    );
    return rows.map((r) => r.conname);
  };

  it("completa as constraints que faltavam, sem tocar em dado", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);
    expect((await runMigrations(url)).failure).toBeUndefined();

    const antes = await retrato(pool);
    await tirarAsConstraints(pool);
    expect(await nomes(pool)).toEqual([]);

    await rodar0018(pool);
    expect(await nomes(pool)).toEqual([
      "snapshot_canal_nao_vazio_ck",
      "snapshot_canonical_scope_ck",
      "snapshot_canonical_scope_nao_vazio_ck",
      "snapshot_dataset_family_nao_vazio_ck",
    ]);
    expect(await retrato(pool)).toEqual(antes);
    await pool.end();
  }, 300_000);

  it("não faz nada quando elas já estão lá, e pode rodar de novo", async () => {
    const { url, pool } = await bancoNovo();
    await runMigrations(url);
    const antes = await nomes(pool);
    await rodar0018(pool);
    await rodar0018(pool);
    expect(await nomes(pool)).toEqual(antes);
    await pool.end();
  }, 300_000);

  it("aborta, nomeando a vigência, quando o dado já não sustenta a identidade", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);
    await runMigrations(url);

    // Um banco pré-`0018`, em que alguém esvaziou o canal por fora.
    await tirarAsConstraints(pool);
    await pool.query(`ALTER TABLE "snapshot" DISABLE TRIGGER "snapshot_immutable"`);
    await pool.query(`UPDATE "snapshot" SET "canal" = ''`);
    await pool.query(`ALTER TABLE "snapshot" ENABLE TRIGGER "snapshot_immutable"`);

    await expect(rodar0018(pool)).rejects.toThrow(/canal vazio/);
    await pool.query("ROLLBACK").catch(() => {});
    await pool.end();
  }, 300_000);
});

/**
 * O DDL que derrubou o deploy — e de onde ele veio.
 *
 * O erro de produção foi `function freightcheck_snapshot_key(text, text, text,
 * date, jsonb) does not exist`, num `ALTER TABLE ... ADD COLUMN
 * canonical_snapshot_key ... GENERATED ALWAYS AS (...)`. O comando não estava
 * no repositório: a `0015` escreve os identificadores entre aspas, numa linha
 * só, dentro de um `DO $$`, e *depois* de criar as funções. A forma do erro —
 * sem aspas, em caixa baixa — é a que `pg_get_expr()` devolve ao ler a
 * expressão de um banco vivo, que é como uma ferramenta de diff a obtém.
 *
 * O que se prova aqui: aquele DDL, sozinho, falha exatamente com o erro do
 * deploy; e a fila versionada atravessa o mesmo banco sem tropeçar nele.
 */
describe("o DDL do deploy, e a fila que não precisa dele", () => {
  /** O comando como a introspecção o produz — o que foi parar em produção. */
  const DDL_INTROSPECTADO = `ALTER TABLE "snapshot"
     ADD COLUMN "canonical_snapshot_key" text
     GENERATED ALWAYS AS (
       freightcheck_snapshot_key(
         source_system, dataset_family, canal, effective_date, canonical_scope)
     ) STORED`;

  it("é a introspecção de um banco vivo, e não o texto desta migration", async () => {
    const { url, pool } = await bancoNovo();
    await runMigrations(url);

    // O banco devolve a expressão sem aspas e em caixa baixa: é a forma do
    // erro do deploy, e é o que qualquer ferramenta de diff copia.
    const { rows } = await pool.query<{ expressao: string }>(
      `SELECT pg_get_expr(d.adbin, d.adrelid) AS expressao
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE c.relname = 'snapshot' AND a.attname = 'canonical_snapshot_key'`,
    );
    expect(rows[0]!.expressao).toBe(
      "freightcheck_snapshot_key(source_system, dataset_family, canal, effective_date, canonical_scope)",
    );

    // E o repositório escreve a mesma coluna de outro jeito — com aspas, numa
    // linha só — o que é o que permite dizer que o DDL do deploy não saiu
    // daqui. (A forma sem aspas também aparece na `0015`, mas como o valor
    // *esperado* de uma conferência, nunca como DDL.)
    const m = readMigrations().find((x) => x.tag === "0015_canonical_identity")!;
    const criacao = m.statements
      .flatMap((s) => s.split("\n"))
      .filter((linha) => linha.includes("GENERATED ALWAYS"));
    expect(criacao).toHaveLength(1);
    expect(criacao[0]).toContain(`freightcheck_snapshot_key("source_system"`);
    expect(criacao[0]).not.toContain("(source_system,");
    await pool.end();
  }, 300_000);

  it("aplicado num banco parado na 0014, reproduz o erro do deploy", async () => {
    const { pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);

    // As três colunas que o diff acrescenta antes da coluna gerada. Nenhuma
    // função vem junto: o modelo de snapshot do drizzle não representa função.
    for (const [coluna, tipo] of [
      ["dataset_family", "text"],
      ["canal", "text"],
      ["canonical_scope", "jsonb"],
    ]) {
      await pool.query(`ALTER TABLE "snapshot" ADD COLUMN "${coluna}" ${tipo}`);
    }

    await expect(pool.query(DDL_INTROSPECTADO)).rejects.toThrow(
      /function freightcheck_snapshot_key\(text, text, text, date, jsonb\) does not exist/,
    );
    await pool.end();
  }, 300_000);

  it("a fila versionada atravessa o mesmo banco e preserva as vigências", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    const ids = await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
      { rotulo: "ROTA_1_8_2026", data: "2026-08-01", unidade: "98765432000111" },
    ]);

    const relatorio = await runMigrations(url);
    expect(relatorio.failure).toBeUndefined();
    expect(relatorio.applied).toContain("0015_canonical_identity");
    expect(relatorio.applied).toContain("0020_identidade_search_path");

    // As duas vigências continuam lá, com os mesmos ids e os mesmos fatos.
    const linhas = await retrato(pool);
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => Number(l.fatos))).toEqual([1, 1]);
    const { rows: sobreviventes } = await pool.query<{ id: string }>(
      `SELECT "id" FROM "snapshot" ORDER BY "source_label"`,
    );
    expect(sobreviventes.map((s) => s.id).sort()).toEqual([...ids].sort());
    await pool.end();
  }, 300_000);

  it("a fila se recupera do diff que morreu no meio do caminho", async () => {
    // O estado em que o deploy deixou o banco: as três colunas entraram, a
    // coluna gerada não, e o registro de migrations continua na 0014.
    const referencia = await bancoNovo();
    await runMigrations(referencia.url);

    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
    ]);
    for (const [coluna, tipo] of [
      ["dataset_family", "text"],
      ["canal", "text"],
      ["canonical_scope", "jsonb"],
    ]) {
      await pool.query(`ALTER TABLE "snapshot" ADD COLUMN "${coluna}" ${tipo}`);
    }
    await pool.query(DDL_INTROSPECTADO).catch(() => {
      // Falha esperada — é o que produção viu.
    });

    const relatorio = await runMigrations(url);
    expect(relatorio.failure).toBeUndefined();

    // Mesmo schema de um banco que nunca viu o diff, e o dado convertido.
    expect(await estrutura(pool)).toEqual(await estrutura(referencia.pool));
    const linhas = await retrato(pool);
    expect(linhas[0]!.canal).toBe("EMPURRADA");
    expect(linhas[0]!.canonical_snapshot_key).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(linhas[0]!.fatos)).toBe(1);
    await pool.end();
    await referencia.pool.end();
  }, 300_000);
});

/**
 * A `0020` — a identidade deixa de depender do `search_path` de quem escreve.
 *
 * As onze funções da `0015` são `LANGUAGE sql` de corpo textual: os nomes que
 * elas chamam por dentro são resolvidos na primeira chamada de **cada sessão**,
 * com o `search_path` de quem chamou. Como `freightcheck_snapshot_key` é a
 * expressão de uma coluna **gerada**, isso vale para todo `INSERT` em
 * `snapshot` — e uma conexão com outro `search_path` perdia o caminho de
 * escrita inteiro.
 */
describe("0020 sobre a identidade já gravada", () => {
  /** Um `INSERT` em `snapshot` de uma sessão com `search_path` zerado. */
  async function inserirComSearchPathVazio(url: string): Promise<string> {
    const cliente = new pg.Client({ connectionString: url });
    await cliente.connect();
    try {
      await cliente.query(`SET search_path = ''`);
      const { rows: arquivo } = await cliente.query<{ id: string }>(
        `INSERT INTO public."source_file" ("filename", "content_sha256", "byte_size", "storage_path")
         VALUES ('sem-search-path.xlsx', md5(random()::text), 1, '/tmp/x.xlsx') RETURNING "id"`,
      );
      const { rows: run } = await cliente.query<{ id: string }>(
        `INSERT INTO public."import_run" ("source_file_id", "status")
         VALUES ($1, 'PROMOTED') RETURNING "id"`,
        [arquivo[0]!.id],
      );
      const { rows } = await cliente.query<{ chave: string }>(
        `INSERT INTO public."snapshot" (
           "source_file_id", "import_run_id", "source_label", "effective_date",
           "scope_hash", "entity_type_set", "dataset_family", "canal", "canonical_scope")
         VALUES ($1, $2, 'EMPURRADA_1_10_2026', '2026-10-01', md5('x'), 'CARRETA',
                 'REMUNERACAO_EQUIPAMENTO', 'EMPURRADA',
                 '[{"scopeType": "UNIDADE", "code": "12345678000199"}]'::jsonb)
         RETURNING "canonical_snapshot_key" AS chave`,
        [arquivo[0]!.id, run[0]!.id],
      );
      return rows[0]!.chave;
    } finally {
      await cliente.end();
    }
  }

  /** Só a `0020`, do disco, como `runMigrations` a aplicaria. */
  async function rodar0020(pool: pg.Pool): Promise<void> {
    const m = readMigrations().find(
      (x) => x.tag === "0020_identidade_search_path",
    )!;
    await pool.query("BEGIN");
    try {
      for (const comando of m.statements) await pool.query(comando);
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  }

  it("antes dela a coluna gerada não se calcula com search_path vazio; depois, sim", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0019_assistant_feedback");

    // O defeito, medido: a função interna some para quem chama de fora do
    // `public`, e o que quebra é a coluna gerada — não uma consulta qualquer.
    await expect(inserirComSearchPathVazio(url)).rejects.toThrow(
      /function freightcheck_norm_canal\(text\) does not exist/,
    );

    await rodar0020(pool);

    const chave = await inserirComSearchPathVazio(url);
    expect(chave).toMatch(/^[0-9a-f]{64}$/);

    // E é a mesma chave que uma sessão normal calcularia.
    const { rows } = await pool.query<{ chave: string }>(
      `SELECT freightcheck_snapshot_key(
                'FREIGHTEC', 'REMUNERACAO_EQUIPAMENTO', 'EMPURRADA', '2026-10-01'::date,
                '[{"scopeType": "UNIDADE", "code": "12345678000199"}]'::jsonb) AS chave`,
    );
    expect(chave).toBe(rows[0]!.chave);
    await pool.end();
  }, 300_000);

  it("não muda nenhuma identidade já gravada, e pode rodar de novo", async () => {
    const { url, pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");
    await gravarHistorico(pool, [
      { rotulo: "EMPURRADA_1_8_2026", data: "2026-08-01", unidade: "12345678000199" },
      { rotulo: "EMPURRADA_01_9_2026", data: "2026-09-01", unidade: "12.345.678/0001-99" },
      { rotulo: "ROTA_1_8_2026", data: "2026-08-01", unidade: "98765432000111" },
    ]);
    await aplicarAte(pool, "0019_assistant_feedback");

    const antes = await retrato(pool);
    const estruturaAntes = await estrutura(pool);
    expect(antes).toHaveLength(3);

    await rodar0020(pool);
    expect(await retrato(pool)).toEqual(antes);

    // Rodar de novo é inócuo — é o que um registro perdido faria.
    await rodar0020(pool);
    expect(await retrato(pool)).toEqual(antes);

    // A única diferença de schema é o `SET` das funções, que não aparece em
    // coluna, constraint nem índice.
    expect(await estrutura(pool)).toEqual(estruturaAntes);
    const { rows } = await pool.query<{ proname: string; proconfig: string[] }>(
      `SELECT p.proname, p.proconfig FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE 'freightcheck_%'
          AND p.proname NOT LIKE '%immutable%'
          AND p.proname NOT IN ('freightcheck_correct_entity_type', 'freightcheck_purge_em_curso')
        ORDER BY 1`,
    );
    expect(rows).toHaveLength(11);
    for (const f of rows) {
      expect(f.proconfig).toEqual(["search_path=pg_catalog, public"]);
    }
    await pool.end();
  }, 300_000);

  it("aborta, nomeando o que falta, quando as funções não estão lá", async () => {
    const { pool } = await bancoNovo();
    await aplicarAte(pool, "0014_chamados_formato_real");

    await expect(rodar0020(pool)).rejects.toThrow(
      /Funções da identidade canônica ausentes[\s\S]*freightcheck_snapshot_key/,
    );
    await pool.end();
  }, 300_000);
});

/** Estrutura comparável: colunas, constraints e índices que importam aqui. */
async function estrutura(pool: pg.Pool) {
  const { rows: colunas } = await pool.query(
    `SELECT table_name, column_name, data_type, is_nullable, is_generated
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, column_name`,
  );
  const { rows: constraints } = await pool.query(
    `SELECT t.relname AS tabela, c.conname AS nome, pg_get_constraintdef(c.oid) AS definicao
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY 1, 2`,
  );
  const { rows: indices } = await pool.query(
    `SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' ORDER BY 1`,
  );
  return { colunas, constraints, indices };
}
