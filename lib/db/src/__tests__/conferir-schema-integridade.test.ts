/**
 * O comando inteiro, rodado de verdade contra um banco de verdade.
 *
 * Os outros arquivos provam as partes: a consulta, contra o export real, em
 * `lib/curation/src/__tests__/integridade-semantica.test.ts`; o texto, sem
 * banco, em `integridade-semantica.test.ts`. Falta a única coisa que nenhum dos
 * dois vê, e que é o que a automação consome: **o comando reprova**.
 *
 * O caso que isto trava é o pior de todos, porque não parece defeito: schema
 * em dia, 26 de 26 migrations registradas, nenhuma coluna faltando — e um
 * atributo somando dinheiro por uma semântica que a tela não mostra. Antes
 * destas invariantes, `conferir-schema` respondia "Schema em dia" e saía com 0
 * exatamente aí.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { runMigrations } from "../migrate";

const execFileAsync = promisify(execFile);

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(RAIZ, "src", "conferir-schema-cli.ts");

const criados: string[] = [];

async function bancoMigrado(nome: string): Promise<string> {
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
  await admin.query(`CREATE DATABASE "${nome}"`);
  await admin.end();
  criados.push(nome);
  const url = urlDe(nome);
  const relatorio = await runMigrations(url);
  expect(relatorio.failure).toBeUndefined();
  return url;
}

/** O comando como a automação o roda: saída e código de saída, nada mais. */
async function conferir(url: string): Promise<{ code: number; saida: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      ["--import", "tsx", CLI],
      { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url } },
    );
    return { code: 0, saida: stdout + stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, saida: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

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

describe("conferir-schema confere o conteúdo, e não só a forma", () => {
  it("aprova um banco recém-migrado, sem atributo nenhum", async () => {
    const url = await bancoMigrado("fc_integridade_limpa");
    const { code, saida } = await conferir(url);

    expect(code).toBe(0);
    expect(saida).toContain("Schema em dia");
    expect(saida).toContain("Integridade da semântica: OK");
  }, 120_000);

  it("reprova o atributo sem versão, com o schema em dia", async () => {
    const url = await bancoMigrado("fc_integridade_sem_versao");
    const banco = new pg.Pool({ connectionString: url });
    await banco.query(
      `INSERT INTO attribute (code, source_name, entity_type, data_type)
       VALUES ('cavalo.orfao', 'orfao', 'CAVALO', 'NUMERIC')`,
    );
    await banco.end();

    const { code, saida } = await conferir(url);

    // As duas metades da mesma saída: a forma passa, o conteúdo não.
    expect(saida).toContain("Schema em dia");
    expect(saida).toContain("cavalo.orfao");
    expect(saida).toContain("[SEM_VERSAO]");
    expect(code).toBe(1);
  }, 120_000);

  it("reprova a projeção que contradiz a versão em vigor, nomeando os dois valores", async () => {
    const url = await bancoMigrado("fc_integridade_divergente");
    const banco = new pg.Pool({ connectionString: url });
    await banco.query(
      `INSERT INTO attribute (code, source_name, entity_type, data_type, periodicity)
       VALUES ('cavalo.divergente', 'divergente', 'CAVALO', 'NUMERIC', 'MENSAL')`,
    );
    await banco.query(
      `INSERT INTO attribute_semantics
         (attribute_id, version, effective_from, periodicity, semantics_status)
       SELECT id, 1, DATE '1970-01-01', 'ANUAL', 'UNKNOWN'
         FROM attribute WHERE code = 'cavalo.divergente'`,
    );
    await banco.end();

    const { code, saida } = await conferir(url);

    expect(code).toBe(1);
    expect(saida).toContain(
      'cavalo.divergente.periodicity: projeção="MENSAL" versão="ANUAL"',
    );
    // E a promessa de não consertar sai junto, na mesma saída que acusa.
    expect(saida).toContain("não há bandeira que corrija");
  }, 120_000);

  it("não conserta nada, nem com --aplicar", async () => {
    /*
      `--aplicar` repõe coluna ausente, e é só isso que ele faz. Um dia alguém
      vai supor que a bandeira "arruma o banco" — este teste é o que responde
      antes que a suposição vire um UPDATE calado em cima de dado de cliente.
    */
    const url = await bancoMigrado("fc_integridade_aplicar");
    const banco = new pg.Pool({ connectionString: url });
    await banco.query(
      `INSERT INTO attribute (code, source_name, entity_type, data_type)
       VALUES ('cavalo.orfao', 'orfao', 'CAVALO', 'NUMERIC')`,
    );
    await banco.end();

    const { code, saida } = await conferir(url);
    expect(code).toBe(1);

    const comBandeira = await execFileAsync(
      "node",
      ["--import", "tsx", CLI, "--aplicar"],
      { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url } },
    ).catch((err: { code?: number; stdout?: string; stderr?: string }) => ({
      code: err.code ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    }));

    expect((comBandeira as { code?: number }).code ?? 0).toBe(1);

    // O banco continua exatamente como estava: nenhuma versão foi inventada.
    const depois = new pg.Pool({ connectionString: url });
    const { rows } = await depois.query<{ total: string }>(
      `SELECT count(*) AS total FROM attribute_semantics`,
    );
    await depois.end();
    expect(Number(rows[0].total)).toBe(0);
    expect(saida).toContain("cavalo.orfao");
  }, 120_000);
});
