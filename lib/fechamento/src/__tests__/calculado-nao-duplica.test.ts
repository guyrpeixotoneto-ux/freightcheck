import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Database } from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import { abrirCompetencia, receberDocumento, totaisDoPagamentoDaCompetencia } from "../persistencia";

/**
 * O `calculado` do card "declarado × calculado" contra um 03.08.20 com a
 * seção de verbas gravada duas vezes.
 *
 * **O bug que este teste prova corrigido.** `somarDemonstrativo` somava
 * `valor_faturado` direto das linhas gravadas no banco, sem passar pela
 * mesma deduplicação de linha exatamente idêntica que a tela "Verbas" já
 * aplicava (`consolidarDuplicatasExatas`, replicada aqui em `duplicatas.ts`
 * para o servidor). Um 03.08.20 cujo exportador duplicou a seção inteira —
 * as mesmas linhas, byte a byte, uma segunda vez — fazia o `calculado` sair
 * exatamente em dobro do `declarado` do rodapé, acusando uma diferença que
 * não existia. Ver a conversa que originou este teste: o card mostrava
 * Declarado R$ 404.047,64 e Calculado R$ 808.095,28 — 2× — enquanto a tabela
 * de verbas, abaixo, já dizia "5 verbas estavam duplicadas no arquivo".
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_calculado_sem_duplicata_${process.pid}`;

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
 * Um 03.08.20 do ROTA com o bloco FRETE gravado duas vezes, linha por linha
 * idêntica — o mesmo padrão que um export duplicado produz. O rodapé só
 * declara o total de uma ocorrência, como o relatório real fecha.
 */
function pagamentoComBlocoDuplicado(): Buffer {
  const linhaDaVerba =
    "  01 - Frota Fixa Ativa                    1.600,00           0,00        2.000,00       2.000,00         0,00     1.800,00";
  return Buffer.from(
    [
      "Periodo: 01/08/2026 a 15/08/2026",
      "Transportadora: 36 - TRANSPORTES FICTICIA LTDA",
      "Unidade: 443 - CDD FICTICIO",
      "",
      "ROTA",
      "",
      "FRETE",
      REGUA,
      linhaDaVerba,
      "",
      REGUA,
      "",
      "FRETE",
      REGUA,
      linhaDaVerba,
      "",
      REGUA,
      "Total Remuneracao                                                                              2.000,00",
      "",
    ].join("\r\n"),
    "latin1",
  );
}

describe.skipIf(!temBanco)("o calculado do 03.08.20 contra uma seção duplicada no arquivo", () => {
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

  it("não conta a verba duas vezes — calculado bate com declarado, diferença zero", async () => {
    const competencia = await abrirCompetencia(db, {
      ano: 2026,
      mes: 8,
      quinzena: 1,
      unidade,
      transportadora,
      tipoDeOperacao: "EMPURRADA",
    });
    await receberDocumento(db, {
      competenciaId: competencia.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20.txt",
      conteudo: pagamentoComBlocoDuplicado(),
    });

    const { canais } = await totaisDoPagamentoDaCompetencia(db, competencia.id);

    expect(canais).toEqual([{ canal: "ROTA", declarado: 2000, calculado: 2000, diferenca: 0 }]);
  });
});
