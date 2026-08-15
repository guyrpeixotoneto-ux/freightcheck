import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "../schema";
import { MIGRATIONS_FOLDER, readMigrations } from "../migrate";

/**
 * O `meta/` do drizzle contra o disco e contra um banco de verdade.
 *
 * Este arquivo existe por causa de um defeito com nome: o último snapshot era o
 * `0011` enquanto o `_journal.json` já ia até o `0017`. Qualquer ferramenta que
 * diferencie `schema.ts` contra o `meta/` — o `drizzle-kit generate`, o passo
 * de schema do Publishing — concluía que as seis migrations seguintes nunca
 * tinham existido e propunha refazê-las: três colunas `NOT NULL` sem backfill
 * numa tabela com dado, a coluna gerada sem as funções que a sustentam, os
 * índices únicos sem a fusão que os torna possíveis.
 *
 * O que se prova aqui:
 *
 * 1. existe um snapshot por entrada do journal, e a cadeia `prevId` fecha;
 * 2. o último snapshot descreve exatamente o `schema.ts` de hoje — o diff é
 *    vazio, e portanto não há o que uma ferramenta de schema proponha;
 * 3. cada snapshot de `0012` em diante descreve um banco que as migrations
 *    daquele ponto de fato produzem. Os de `0015` e `0016` são derivados (não
 *    existe `schema.ts` histórico para eles); é esta conferência que os
 *    sustenta.
 */
const META = path.join(MIGRATIONS_FOLDER, "meta");

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

interface Snapshot {
  id: string;
  prevId: string;
  tables: Record<
    string,
    {
      name: string;
      schema: string;
      columns: Record<string, { name: string; notNull?: boolean }>;
      indexes: Record<string, { name: string }>;
      checkConstraints?: Record<string, { name: string }>;
    }
  >;
  enums: Record<string, { name: string; values: string[] }>;
}

const journal = JSON.parse(
  readFileSync(path.join(META, "_journal.json"), "utf8"),
) as { entries: { idx: number; tag: string }[] };

const ler = (idx: number): Snapshot =>
  JSON.parse(
    readFileSync(
      path.join(META, `${String(idx).padStart(4, "0")}_snapshot.json`),
      "utf8",
    ),
  ) as Snapshot;

const criados: string[] = [];

afterAll(async () => {
  const admin = new pg.Pool({ connectionString: ADMIN });
  for (const nome of criados) {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
      [nome],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
  }
  await admin.end();
}, 300_000);

describe("metadata do drizzle", () => {
  it("tem um snapshot para cada migration do journal, e nenhum sobrando", () => {
    const noDisco = readdirSync(META)
      .filter((f) => f.endsWith("_snapshot.json"))
      .map((f) => f.slice(0, 4))
      .sort();
    const noJournal = journal.entries
      .map((e) => String(e.idx).padStart(4, "0"))
      .sort();
    expect(noDisco).toEqual(noJournal);
    // O defeito que isto prende: o journal ia até 0017 e o disco parava em 0011.
    expect(noDisco.at(-1)).toBe("0017");
  });

  it("encadeia os snapshots por prevId, sem buraco", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      expect(ler(i).prevId).toBe(ler(i - 1).id);
    }
  });

  it("não deixa nenhuma alteração de schema pendente — o diff é vazio", async () => {
    const ultimo = ler(journal.entries.at(-1)!.idx);
    const agora = generateDrizzleJson(schema as Record<string, unknown>);
    const statements = await generateMigration(
      ultimo as never,
      agora as never,
    );
    expect(statements).toEqual([]);
  });

  it("descreve, em cada snapshot, um banco que as migrations daquele ponto produzem", async () => {
    // Um banco por ponto de parada, da 0012 em diante — que é onde os
    // snapshots tinham deixado de ser escritos.
    for (const entrada of journal.entries.filter((e) => e.idx >= 12)) {
      const nome = `fc_meta_${process.pid}_${entrada.idx}`;
      const admin = new pg.Pool({ connectionString: ADMIN });
      await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
      await admin.query(`CREATE DATABASE "${nome}"`);
      await admin.end();
      criados.push(nome);

      const pool = new pg.Pool({
        connectionString: ADMIN.replace("/postgres?", `/${nome}?`),
      });
      for (const m of readMigrations()) {
        await pool.query("BEGIN");
        for (const comando of m.statements) await pool.query(comando);
        await pool.query("COMMIT");
        if (m.tag === entrada.tag) break;
      }

      const snapshot = ler(entrada.idx);
      const faltando: string[] = [];

      const { rows: colunas } = await pool.query<{
        tabela: string;
        coluna: string;
        obrigatoria: boolean;
      }>(
        `SELECT table_name AS tabela, column_name AS coluna,
                (is_nullable = 'NO') AS obrigatoria
           FROM information_schema.columns WHERE table_schema = 'public'`,
      );
      const noBanco = new Map(
        colunas.map((c) => [`${c.tabela}.${c.coluna}`, c.obrigatoria]),
      );
      const { rows: indices } = await pool.query<{ nome: string }>(
        `SELECT indexname AS nome FROM pg_indexes WHERE schemaname = 'public'`,
      );
      const indicesNoBanco = new Set(indices.map((i) => i.nome));
      const { rows: checks } = await pool.query<{ nome: string }>(
        `SELECT c.conname AS nome FROM pg_constraint c
           JOIN pg_namespace n ON n.oid = c.connamespace
          WHERE n.nspname = 'public' AND c.contype = 'c'`,
      );
      const checksNoBanco = new Set(checks.map((c) => c.nome));
      const { rows: enums } = await pool.query<{ nome: string; valor: string }>(
        `SELECT t.typname AS nome, e.enumlabel AS valor
           FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid`,
      );
      const valoresNoBanco = new Set(enums.map((e) => `${e.nome}.${e.valor}`));

      for (const tabela of Object.values(snapshot.tables)) {
        for (const coluna of Object.values(tabela.columns)) {
          const chave = `${tabela.name}.${coluna.name}`;
          if (!noBanco.has(chave)) {
            faltando.push(`coluna ausente: ${chave}`);
            continue;
          }
          if ((coluna.notNull ?? false) !== noBanco.get(chave)) {
            faltando.push(
              `obrigatoriedade diferente em ${chave}: snapshot diz ${coluna.notNull ?? false}, banco diz ${noBanco.get(chave)}`,
            );
          }
        }
        for (const indice of Object.values(tabela.indexes)) {
          if (!indicesNoBanco.has(indice.name)) {
            faltando.push(`índice ausente: ${indice.name}`);
          }
        }
        for (const ck of Object.values(tabela.checkConstraints ?? {})) {
          if (!checksNoBanco.has(ck.name)) {
            faltando.push(`check ausente: ${ck.name}`);
          }
        }
      }
      for (const e of Object.values(snapshot.enums)) {
        for (const valor of e.values) {
          if (!valoresNoBanco.has(`${e.name}.${valor}`)) {
            faltando.push(`valor de enum ausente: ${e.name}.${valor}`);
          }
        }
      }

      await pool.end();
      expect(
        faltando,
        `snapshot ${entrada.tag} promete o que o banco não tem`,
      ).toEqual([]);
    }
  }, 300_000);
});

/**
 * O que o snapshot **não** representa, e que por isso é autoridade exclusiva do
 * SQL das migrations. Documentado como teste para que a lista não envelheça em
 * silêncio: se um dia o drizzle passar a modelar algum destes, este teste falha
 * e a `docs/MIGRATIONS.md` é atualizada junto.
 */
describe("os objetos que só o SQL conhece", () => {
  it("não têm onde caber no snapshot: ele não modela função, view nem gatilho", () => {
    const ultimo = ler(journal.entries.at(-1)!.idx) as unknown as Record<
      string,
      unknown
    >;
    // O formato do snapshot não tem sequer uma seção para funções ou gatilhos, e
    // a de views está vazia — as três views de diagnóstico são SQL puro.
    expect(Object.keys(ultimo)).not.toContain("functions");
    expect(Object.keys(ultimo)).not.toContain("triggers");
    expect(ultimo["views"]).toEqual({});

    const texto = JSON.stringify(ultimo);
    for (const objeto of [
      "freightcheck_snapshot_ativo_duplicado",
      "freightcheck_identidade_vigencia",
      "freightcheck_fato_duplicado",
      "snapshot_immutable",
      // Índice parcial que o `schema.ts` não declara: a `0017` o cria e só o
      // SQL sabe dele.
      "fact_inherited_idx",
    ]) {
      expect(texto).not.toContain(objeto);
    }

    // `freightcheck_snapshot_key` e `freightcheck_canonical_scope` aparecem —
    // mas só como *chamada*, dentro da expressão da coluna gerada e do CHECK.
    // O corpo delas não está aqui, e é por isso que aplicar este snapshot sem a
    // migration produz um banco que não funciona: a coluna gerada referencia
    // uma função que ninguém criou.
    expect(texto).toContain("freightcheck_snapshot_key(");
    expect(texto).not.toContain("CREATE OR REPLACE FUNCTION");
  });
});
