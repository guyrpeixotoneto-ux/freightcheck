/**
 * O `--aplicar` como quem segue a tela o roda — e o beco que ele deixou de ser.
 *
 * A tela de SCHEMA_DIVERGENTE de 18/08/2026 mandava rodar `conferir-schema`, e
 * o `--aplicar` daquela época repunha só coluna: com `entity_expectation`
 * inteira ausente, quem obedecia a tela terminava com a mesma tela. Este
 * arquivo prova o contrato novo pelo caminho que a automação e o operador
 * usam — o processo, a saída, o código de saída —, com o estado exato daquele
 * incidente: 36 migrations registradas e os seis objetos que o Provision levou.
 *
 * As peças da reconvergência têm prova própria em `reconvergencia.test.ts`, e o
 * ciclo do deploy em `deploy-normal-reconverge.test.ts`. O que só este arquivo
 * vê é a porta de entrada do operador: a bandeira repara por inteiro, e as
 * recusas — fila pendente, bridge pendente — saem pela mesma porta, com o
 * comando de quem resolve.
 */
import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { runMigrations } from "../migrate";
import { CRIAR_MARCADOR, MARCAR_DESCIDA } from "../bridge-marcador";

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
async function conferir(
  url: string,
  ...flags: string[]
): Promise<{ code: number; saida: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      ["--import", "tsx", CLI, ...flags],
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

describe("--aplicar repõe o schema inteiro, não só coluna", () => {
  it("o estado das telas de 18/08 — tabela e cinco colunas fora — volta inteiro", async () => {
    const url = await bancoMigrado("fc_aplicar_provision");
    const banco = new pg.Pool({ connectionString: url });
    /* A mutilação como o Provision a fez, objeto por objeto da tela. */
    for (const comando of [
      `DROP TABLE "entity_expectation" CASCADE`,
      `ALTER TABLE "attribute_semantics" DROP COLUMN "cost_class"`,
      `ALTER TABLE "attribute" DROP COLUMN "cost_class"`,
      `ALTER TABLE "change_set" DROP COLUMN "impacto_oficial_by_periodicity"`,
      `ALTER TABLE "change_set" DROP COLUMN "deducao_rastro"`,
      `ALTER TABLE "import_run" DROP COLUMN "declared_type"`,
    ]) {
      await banco.query(comando);
    }
    await banco.end();

    /* Sem bandeira: acusa, nomeia a tabela, não toca em nada. */
    const leitura = await conferir(url);
    expect(leitura.code).toBe(1);
    expect(leitura.saida).toContain("entity_expectation");
    expect(leitura.saida).toContain("--aplicar");

    const reparo = await conferir(url, "--aplicar");
    expect(reparo.saida).toContain("Reposto: tabela entity_expectation");
    expect(reparo.saida).toContain("Reposto: coluna attribute.cost_class");
    expect(reparo.code).toBe(0);

    /* A régua final é a leitura seguinte: em dia, pela mesma porta. */
    const depois = await conferir(url);
    expect(depois.saida).toContain("Schema em dia");
    expect(depois.code).toBe(0);
  }, 300_000);

  it("com migration pendente, recusa e aponta a fila — nada é criado fora de ordem", async () => {
    const url = await bancoMigrado("fc_aplicar_pendente");
    const banco = new pg.Pool({ connectionString: url });
    /* Registro incompleto + o objeto da migration pendente ausente: o estado
       em que reconvergir criaria a coluna antes de a fila decidir. */
    await banco.query(
      `DELETE FROM drizzle."__drizzle_migrations"
        WHERE created_at = (SELECT max(created_at) FROM drizzle."__drizzle_migrations")`,
    );
    await banco.query(`ALTER TABLE "import_run" DROP COLUMN "declared_type"`);

    const reparo = await conferir(url, "--aplicar");
    expect(reparo.code).toBe(1);
    expect(reparo.saida).toMatch(/pendente/);
    expect(reparo.saida).toContain("run migrate");

    const { rows } = await banco.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'import_run' AND column_name = 'declared_type'`,
    );
    await banco.end();
    expect(rows).toEqual([]);
  }, 300_000);

  it("com bridge pendente, recusa e aponta o bridge:up", async () => {
    const url = await bancoMigrado("fc_aplicar_bridge");
    const banco = new pg.Pool({ connectionString: url });
    for (const comando of CRIAR_MARCADOR) await banco.query(comando);
    await banco.query(MARCAR_DESCIDA, [JSON.stringify(["teste"])]);
    await banco.query(`ALTER TABLE "attribute" DROP COLUMN "cost_class"`);

    const reparo = await conferir(url, "--aplicar");
    expect(reparo.code).toBe(1);
    expect(reparo.saida).toMatch(/bridge/);
    expect(reparo.saida).toContain("run bridge:up");

    const { rows } = await banco.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'attribute' AND column_name = 'cost_class'`,
    );
    await banco.end();
    expect(rows).toEqual([]);
  }, 300_000);
});
