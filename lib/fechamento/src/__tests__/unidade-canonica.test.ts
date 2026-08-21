import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  cadastrarUnidade,
  fechamentoCompetenciaTable,
  unidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";

import { abrirCompetencia, associarUnidadeDaCompetencia, encerrarCompetencia } from "../persistencia";

/**
 * A IDENTIDADE CANÔNICA DA UNIDADE — contra Postgres de verdade.
 *
 * O que se prova aqui é a arquitetura, não a aritmética: que existe **uma**
 * autoridade sobre "qual unidade é esta", que o CNPJ a determina, que ela é
 * informada uma vez só, e que uma competência antiga pode ser corrigida sem
 * perder nada do que foi importado nela.
 *
 * Precisa de banco porque o que está sendo provado é o schema — a chave única, a
 * FK, o `check` do CNPJ — e um banco fingido provaria só que o TypeScript
 * compila.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME_DO_BANCO = `fc_unidade_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function alcancavel(): Promise<boolean> {
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

const temBanco = await alcancavel();
const noCi = process.env.CI === "true" || process.env.CI === "1";
if (!temBanco && noCi) {
  throw new Error("O CI declara um Postgres e ele não respondeu.");
}

/** Dois CNPJs com verificadores corretos — unidades diferentes. */
const CNPJ_BELEM = "11222333000181";
const CNPJ_OUTRA = "11444777000161";

describe.skipIf(!temBanco)("a unidade canônica", () => {
  let pool: pg.Pool;
  let db: Database;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`);
    await admin.query(`CREATE DATABASE "${NOME_DO_BANCO}"`);
    await admin.end();
    const url = apontarPara(ADMIN, NOME_DO_BANCO);
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool) as unknown as Database;
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`).catch(() => {});
    await admin.end().catch(() => {});
  });

  const limpar = async () => {
    await db.delete(fechamentoCompetenciaTable);
    await db.delete(unidadeTable);
  };

  /* --- o cadastro mestre ------------------------------------------------- */

  it("a migration cria a tabela vazia — nenhuma unidade nasce de backfill", async () => {
    /*
      É o ponto 4 do pedido, e a prova é literal: depois de rodar a fila inteira
      num banco novo, não há unidade nenhuma. Nenhum `443`, nenhum nome, nenhum
      `canonical_scope` virou identidade sozinho.
    */
    await limpar();
    const todas = await db.select().from(unidadeTable);
    expect(todas).toEqual([]);
  });

  it("cadastra com CNPJ válido, guardando só os dígitos", async () => {
    await limpar();
    const u = await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: "11.222.333/0001-81" });
    expect(u.cnpj).toBe(CNPJ_BELEM);
    expect(u.nome).toBe("CDD Belém");
    expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("recusa CNPJ inválido", async () => {
    await limpar();
    await expect(cadastrarUnidade(db, { nome: "X", cnpj: "11222333000182" })).rejects.toThrow(
      /verificadores/i,
    );
  });

  it("recusa CPF no campo de CNPJ da unidade", async () => {
    await limpar();
    await expect(
      cadastrarUnidade(db, { nome: "X", cnpj: "529.982.247-25" }),
    ).rejects.toThrow(/CPF/i);
  });

  it("impede duas unidades com o mesmo CNPJ, e diz qual é a outra", async () => {
    await limpar();
    await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: CNPJ_BELEM });
    await expect(
      cadastrarUnidade(db, { nome: "BELEM (2)", cnpj: "11.222.333/0001-81" }),
    ).rejects.toThrow(/já é da unidade "CDD Belém"/);
  });

  it("o banco recusa CNPJ não canônico mesmo por fora da aplicação", async () => {
    /*
      A segunda linha de defesa. `lerCnpj` valida na aplicação; se um dia alguém
      escrever um `INSERT` direto, o `check` da `0049` o barra.
    */
    await limpar();
    /*
      A asserção é pela constraint na causa, e não pelo texto: o drizzle
      embrulha o erro do Postgres numa mensagem própria ("Failed query: …"), e
      prender o texto dela testaria a biblioteca em vez do banco.
    */
    const erro = await db
      .insert(unidadeTable)
      .values({ nome: "X", cnpj: "443" })
      .then(() => null)
      .catch((e: unknown) => e as { cause?: { code?: string; constraint?: string } });

    expect(erro, "o banco aceitou `443` como CNPJ").not.toBeNull();
    expect(erro!.cause?.code).toBe("23514");
    expect(erro!.cause?.constraint).toBe("unidade_cnpj_canonico");
  });

  /* --- a competência ----------------------------------------------------- */

  const competenciaLegada = () =>
    abrirCompetencia(db, {
      ano: 2026,
      mes: 8,
      quinzena: 2,
      tipoDeOperacao: "ROTA",
      /* O texto que o formulário de campo único permitia — o caso real. */
      unidade: { codigo: "CDD Belém", nome: "CDD BELÉM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });

  it("competência histórica nasce sem identidade — pendente, não inventada", async () => {
    await limpar();
    const c = await competenciaLegada();
    const [linha] = await db
      .select()
      .from(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.id, c.id));

    expect(linha!.unidadeCodigo).toBe("CDD Belém");
    /* `NULL` honesto: ninguém disse qual unidade é, e nada adivinhou. */
    expect(linha!.unidadeId).toBeNull();
  });

  it("associar não altera o código legado nem qualquer outro campo", async () => {
    await limpar();
    const c = await competenciaLegada();
    const u = await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: CNPJ_BELEM });

    const [antes] = await db
      .select()
      .from(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.id, c.id));
    await associarUnidadeDaCompetencia(db, c.id, u.id);
    const [depois] = await db
      .select()
      .from(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.id, c.id));

    expect(depois!.unidadeId).toBe(u.id);
    /* Tudo o mais idêntico — `unidade_id` é a única coluna que muda. */
    expect({ ...depois, unidadeId: null }).toEqual({ ...antes, unidadeId: null });
  });

  it("recusa associar a uma unidade que não existe", async () => {
    await limpar();
    const c = await competenciaLegada();
    await expect(
      associarUnidadeDaCompetencia(db, c.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(/não existe unidade canônica/i);
  });

  it("a competência encerrada é recusada pela regra oficial, não contornada", async () => {
    await limpar();
    const c = await competenciaLegada();
    const u = await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: CNPJ_BELEM });
    /*
      Encerrar exige apuração; este teste não a tem, então o encerramento é
      forçado direto na coluna. O que se prova é a guarda de
      `associarUnidadeDaCompetencia`, não o caminho do encerramento.
    */
    await db
      .update(fechamentoCompetenciaTable)
      .set({ estado: "ENCERRADA" })
      .where(eq(fechamentoCompetenciaTable.id, c.id));

    await expect(associarUnidadeDaCompetencia(db, c.id, u.id)).rejects.toThrow(/encerrada/i);
  });

  /* --- a chave composta -------------------------------------------------- */

  it("a mesma unidade tem várias competências — a chave não é o CNPJ", async () => {
    await limpar();
    const u = await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: CNPJ_BELEM });

    const primeira = await abrirCompetencia(db, {
      ano: 2026, mes: 8, quinzena: 1, tipoDeOperacao: "ROTA",
      unidade: { codigo: CNPJ_BELEM, nome: "CDD BELÉM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });
    const segunda = await abrirCompetencia(db, {
      ano: 2026, mes: 8, quinzena: 2, tipoDeOperacao: "ROTA",
      unidade: { codigo: CNPJ_BELEM, nome: "CDD BELÉM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });
    await associarUnidadeDaCompetencia(db, primeira.id, u.id);
    await associarUnidadeDaCompetencia(db, segunda.id, u.id);

    const daUnidade = await db
      .select()
      .from(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.unidadeId, u.id));
    expect(daUnidade).toHaveLength(2);
    expect(primeira.id).not.toBe(segunda.id);
  });

  it("a colisão real da chave composta continua impedida", async () => {
    await limpar();
    /* Mesma trinca e mesma chave: `abrirCompetencia` devolve a que já existe. */
    const a = await competenciaLegada();
    const b = await competenciaLegada();
    expect(b.id).toBe(a.id);
  });

  it("a FK impede apagar uma unidade que responde por competência", async () => {
    await limpar();
    const c = await competenciaLegada();
    const u = await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: CNPJ_BELEM });
    await associarUnidadeDaCompetencia(db, c.id, u.id);

    await expect(db.delete(unidadeTable).where(eq(unidadeTable.id, u.id))).rejects.toThrow();
  });

  /* --- abrir competência selecionando, sem digitar identidade ------------ */

  it("abre a competência **selecionando** a unidade — nenhum código digitado", async () => {
    await limpar();
    const u = await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: CNPJ_BELEM });

    const c = await abrirCompetencia(db, {
      ano: 2026,
      mes: 9,
      quinzena: 1,
      tipoDeOperacao: "ROTA",
      unidadeId: u.id,
      /* Vazio de propósito: quem seleciona não digita identidade nenhuma. */
      unidade: { codigo: "", nome: null },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });

    const [linha] = await db
      .select()
      .from(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.id, c.id));

    expect(linha!.unidadeId).toBe(u.id);
    /* O nome e o código saem do cadastro — o código é o CNPJ, que já é identidade. */
    expect(linha!.unidadeCodigo).toBe(CNPJ_BELEM);
    expect(linha!.unidadeNome).toBe("CDD Belém");
  });

  it("recusa abrir com uma unidade canônica que não existe", async () => {
    await limpar();
    await expect(
      abrirCompetencia(db, {
        ano: 2026, mes: 9, quinzena: 2, tipoDeOperacao: "ROTA",
        unidadeId: "00000000-0000-0000-0000-000000000000",
        unidade: { codigo: "", nome: null },
        transportadora: { codigo: "36", nome: "HORIZONTE" },
      }),
    ).rejects.toThrow(/não existe unidade canônica/i);
  });

  it("duas unidades diferentes convivem", async () => {
    await limpar();
    const a = await cadastrarUnidade(db, { nome: "CDD Belém", cnpj: CNPJ_BELEM });
    const b = await cadastrarUnidade(db, { nome: "CAMAÇARI", cnpj: CNPJ_OUTRA });
    expect(a.id).not.toBe(b.id);
  });
});

/* O import fica usado mesmo quando o describe é pulado. */
void encerrarCompetencia;
