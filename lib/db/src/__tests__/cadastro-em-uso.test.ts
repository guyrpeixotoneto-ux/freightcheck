import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runMigrations } from "../migrate";
import {
  CadastroEmUso,
  cadastrarCargo,
  cadastrarDepartamento,
  excluirCargo,
  excluirDepartamento,
} from "../cadastro";
import { fluxoEtapaTable, fluxoOperacionalTable, unidadeTable } from "../schema";
import type { Database } from "../index";

/**
 * APAGAR UM CADASTRO QUE O MAPA DOS PROCESSOS AINDA APONTA.
 *
 * A `0079` deu ao cadastro da casa um segundo lugar onde doer: até ela, apagar
 * `Faturamento` só podia derrubar cargos e contas; hoje derruba também as
 * etapas que o escolheram como responsável. A chave estrangeira já barraria —
 * mas barraria com a violação crua do Postgres, que nomeia a constraint e não
 * diz o que fazer. O que se prova aqui é que a recusa chega antes, como frase,
 * e com o número de etapas dentro dela.
 *
 * Precisa de um Postgres. Na máquina de quem desenvolve, pula; no CI não pula.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_cadastro_uso_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function bancoAlcancavel(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: ADMIN, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const noCi = process.env.CI === "true" || process.env.CI === "1";
const temBanco = noCi || (await bancoAlcancavel());

describe.skipIf(!temBanco)("o cadastro em uso pelo mapa dos processos", () => {
  let pool: pg.Pool;
  let db: Database;
  let empresaId: string;
  let fluxoId: string;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    await admin.query(`CREATE DATABASE "${NOME}"`);
    await admin.end();
    const url = apontarPara(ADMIN, NOME);
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool) as unknown as Database;

    const [unidade] = await db
      .insert(unidadeTable)
      .values({ nome: "Transportes X", cnpj: "11222333000181" })
      .returning();
    empresaId = unidade.id;
    const [fluxo] = await db
      .insert(fluxoOperacionalTable)
      .values({ empresaId, nome: "Faturamento", slug: "faturamento", categoria: "Teste" })
      .returning();
    fluxoId = fluxo.id;
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`).catch(() => {});
    await admin.end().catch(() => {});
  });

  it("um departamento que uma etapa aponta não é excluído — e a frase diz quantas", async () => {
    const departamento = await cadastrarDepartamento(db, { nome: "Faturamento", criadoPor: "guy@x.com" });
    await db
      .insert(fluxoEtapaTable)
      .values({ empresaId, fluxoId, nome: "Conferir CTe", departamentoId: departamento.id });

    const recusa = await excluirDepartamento(db, departamento.id).catch((e: unknown) => e);
    expect(recusa).toBeInstanceOf(CadastroEmUso);
    expect((recusa as CadastroEmUso).message).toMatch(/1 etapa de processo aponta/);
  });

  it("um cargo que uma etapa aponta também não é excluído", async () => {
    const cargo = await cadastrarCargo(db, { nome: "Analista Fiscal", criadoPor: "guy@x.com" });
    await db
      .insert(fluxoEtapaTable)
      .values({ empresaId, fluxoId, nome: "Emitir", cargoId: cargo.id });
    await db
      .insert(fluxoEtapaTable)
      .values({ empresaId, fluxoId, nome: "Revisar", cargoId: cargo.id });

    const recusa = await excluirCargo(db, cargo.id).catch((e: unknown) => e);
    expect(recusa).toBeInstanceOf(CadastroEmUso);
    /* O plural é do número, e o número é a soma da etapa e da lista de itens. */
    expect((recusa as CadastroEmUso).message).toMatch(/2 etapas de processo apontam/);
  });

  it("o que ninguém aponta continua sendo excluível — a guarda não trava tudo", async () => {
    const solto = await cadastrarDepartamento(db, { nome: "Sem uso", criadoPor: "guy@x.com" });
    await expect(excluirDepartamento(db, solto.id)).resolves.toBeUndefined();
  });
});
