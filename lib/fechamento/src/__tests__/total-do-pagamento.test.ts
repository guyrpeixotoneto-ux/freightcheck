import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  fechamentoPagamentoItemTable,
  fechamentoPagamentoTotalTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import { abrirCompetencia, receberDocumento } from "../persistencia";

/**
 * O `Total Remuneração` que o 03.08.20 declara — guardado, e não recalculado.
 *
 * **O que este teste protege.** Antes da `0057`, o total do relatório era lido
 * por `lerPagamento` e descartado na gravação; na releitura ele voltava
 * *somado* a partir de `valor_faturado`. O efeito é sutil e caro: o total
 * declarado e a soma das verbas eram a mesma conta **por construção**, e
 * portanto nunca podiam divergir. Um 03.08.20 cujo rodapé não fecha com as
 * próprias linhas — porque o leitor perdeu uma verba, porque o export veio
 * truncado, porque apareceu um desconto que o leitor não conhece — passava sem
 * sintoma nenhum, e a única conferência independente que o relatório oferece
 * era destruída na porta de entrada.
 *
 * O caso decisivo é o terceiro: um relatório em que o rodapé **não** bate com
 * a soma. Ele é o que prova que os dois números são independentes de verdade;
 * os dois primeiros só provariam que o número sobreviveu.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_total_pagamento_${process.pid}`;

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

const REGUA = "-".repeat(120);

/**
 * Um 03.08.20 com uma verba e um `Total Remuneracao` que o chamador escolhe.
 *
 * O total é parâmetro justamente para poder discordar da soma: é isso que o
 * terceiro caso exercita.
 */
function pagamentoCom(faturado: string, total: string, quinzena: 1 | 2): Buffer {
  /*
    O período precisa bater com o da competência: o 03.08.20 é uma das duas
    fontes com guarda de período na porta (`recusarPagamentoDeOutroPeriodo`), e
    mandar a quinzena errada é recusado antes de qualquer gravação.
  */
  const periodo = quinzena === 1 ? "01/08/2026 a 15/08/2026" : "16/08/2026 a 31/08/2026";
  return Buffer.from(
    [
      `Periodo: ${periodo}`,
      "Transportadora: 36 - TRANSPORTES FICTICIA LTDA",
      "Unidade: 443 - CDD FICTICIO",
      "",
      "ROTA",
      "",
      "FRETE",
      REGUA,
      `  01 - Frota Fixa Ativa                    1.600,00           0,00        2.000,00       ${faturado}         0,00     1.800,00`,
      "",
      REGUA,
      `Total Remuneracao                                                                              ${total}`,
      "",
    ].join("\r\n"),
    "latin1",
  );
}

describe.skipIf(!temBanco)("o Total Remuneração do 03.08.20", () => {
  let pool: pg.Pool;
  let db: Database;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    await admin.query(`CREATE DATABASE "${NOME}"`);
    await admin.end();
    const url = apontarPara(ADMIN, NOME);
    await runMigrations(url);
    pool = new pg.Pool({ connectionString: url });
    db = drizzle(pool) as unknown as Database;
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`).catch(() => {});
    await admin.end().catch(() => {});
  });

  const unidade = { codigo: "443", nome: "CDD FICTICIO" };
  const transportadora = { codigo: "36", nome: "TRANSPORTES FICTICIA LTDA" };
  const tipoDeOperacao = "EMPURRADA";

  async function competenciaCom(quinzena: 1 | 2, conteudo: Buffer) {
    const competencia = await abrirCompetencia(db, {
      ano: 2026,
      mes: 8,
      quinzena,
      unidade,
      transportadora,
      tipoDeOperacao,
    });
    await receberDocumento(db, {
      competenciaId: competencia.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20.txt",
      conteudo,
    });
    return competencia;
  }

  /** O total declarado e a soma das verbas, lidos do banco. */
  async function doBanco(competenciaId: string) {
    const [totais, itens] = await Promise.all([
      db
        .select()
        .from(fechamentoPagamentoTotalTable)
        .where(eq(fechamentoPagamentoTotalTable.competenciaId, competenciaId)),
      db
        .select()
        .from(fechamentoPagamentoItemTable)
        .where(eq(fechamentoPagamentoItemTable.competenciaId, competenciaId)),
    ]);
    return {
      declarado: totais.map((t) => ({ canal: t.canal, total: Number(t.total) })),
      somado: itens.reduce((s, i) => s + Number(i.valorFaturado), 0),
    };
  }

  it("sobrevive à gravação, com o canal que o relatório declarou", async () => {
    const competencia = await competenciaCom(1, pagamentoCom("2.000,00", "2.000,00", 1));

    const { declarado } = await doBanco(competencia.id);
    expect(declarado).toEqual([{ canal: "ROTA", total: 2000 }]);
  });

  /*
    O caso que justifica a tabela existir. O rodapé diz 9.999,00 e a única
    verba fatura 2.000,00 — um arquivo que não fecha consigo mesmo. Antes da
    `0057` isto era invisível: a releitura devolveria 2.000,00 nos dois lados,
    porque o "declarado" era a soma. Agora o número declarado volta como o
    relatório o escreveu, e a divergência fica disponível para quem for
    conferir.
  */
  it("volta como o relatório declarou, mesmo quando não bate com a soma das verbas", async () => {
    const competencia = await competenciaCom(2, pagamentoCom("2.000,00", "9.999,00", 2));

    const { declarado, somado } = await doBanco(competencia.id);

    expect(declarado.find((t) => t.canal === "ROTA")?.total).toBe(9999);
    expect(somado).toBe(2000);
    /* O ponto do teste: os dois números são independentes e podem discordar. */
    expect(declarado.find((t) => t.canal === "ROTA")?.total).not.toBe(somado);
  });
});
