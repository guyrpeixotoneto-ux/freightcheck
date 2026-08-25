import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { type Database } from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import { abrirCompetencia, receberDocumento, totaisDoPagamentoDaCompetencia } from "../persistencia";

/**
 * O ROTA e o AS do mesmo 03.08.20, isolados na conferência declarado × calculado.
 *
 * **O que este teste protege.** O Fechamento Rota mostra só o canal ROTA na
 * etapa 4 (ver `pagamento-por-canal.ts`, no `freightaudit`), e essa filtragem
 * só é segura se `totaisDoPagamentoDaCompetencia` já devolver os dois canais
 * calculados **de forma independente** — nunca somados um no outro antes de
 * separar. Este teste prova isso pelo lado que importa: muda-se só o AS —
 * a verba dele e o total que ele declara — e o ROTA continua exatamente o
 * mesmo, byte a byte, nos dois lados (declarado e calculado).
 *
 * Sem esta prova, a filtragem de tela (`apenasCanalRota`) seria bonita e
 * inútil: se o cálculo já tivesse misturado os dois canais antes de a lista
 * chegar à tela, filtrar depois só esconderia a linha do AS — o número do
 * ROTA continuaria contaminado.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_totais_por_canal_${process.pid}`;

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
 * Um 03.08.20 com os dois canais — ROTA e AS —, cada um com uma verba e um
 * `Total Remuneracao` próprios. Os quatro números são parâmetros porque o
 * ponto do teste é variar só o lado do AS e observar que o ROTA não se move.
 */
function pagamentoComDoisCanais(valores: {
  rotaFaturado: string;
  rotaTotal: string;
  asFaturado: string;
  asTotal: string;
}): Buffer {
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
      `  01 - Frota Fixa Ativa                    1.600,00           0,00        2.000,00       ${valores.rotaFaturado}         0,00     1.800,00`,
      "",
      REGUA,
      `Total Remuneracao                                                                              ${valores.rotaTotal}`,
      "",
      "AS",
      "",
      "FRETE",
      REGUA,
      `  20 - Frota Fixa Ativa                      300,00           0,00          350,00       ${valores.asFaturado}         0,00       300,00`,
      "",
      REGUA,
      `Total Remuneracao                                                                              ${valores.asTotal}`,
      "",
    ].join("\r\n"),
    "latin1",
  );
}

describe.skipIf(!temBanco)("os totais do 03.08.20, ROTA e AS isolados", () => {
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

  /*
    O código da transportadora entra na chave da competência
    (`abrirCompetencia`), e por isso varia por chamada: duas competências com a
    mesma unidade, quinzena e transportadora seriam a mesma competência, e o
    segundo `receberDocumento` seria recusado como reenvio do mesmo documento
    — não é isso que este teste quer exercitar.
  */
  async function competenciaCom(conteudo: Buffer, transportadoraCodigo: string) {
    const competencia = await abrirCompetencia(db, {
      ano: 2026,
      mes: 8,
      quinzena: 1,
      unidade,
      transportadora: { codigo: transportadoraCodigo, nome: "TRANSPORTES FICTICIA LTDA" },
      tipoDeOperacao: "EMPURRADA",
    });
    await receberDocumento(db, {
      competenciaId: competencia.id,
      tipo: "PAGAMENTO",
      nomeDoArquivo: "03.08.20.txt",
      conteudo,
    });
    return competencia;
  }

  it("traz os dois canais, cada um com o declarado e o calculado do próprio rodapé", async () => {
    const competencia = await competenciaCom(
      pagamentoComDoisCanais({
        rotaFaturado: "2.000,00",
        rotaTotal: "2.000,00",
        asFaturado: "350,00",
        asTotal: "350,00",
      }),
      "36",
    );

    const { canais, temPagamento } = await totaisDoPagamentoDaCompetencia(db, competencia.id);

    expect(temPagamento).toBe(true);
    expect(canais).toEqual(
      expect.arrayContaining([
        { canal: "ROTA", declarado: 2000, calculado: 2000, diferenca: 0 },
        { canal: "AS", declarado: 350, calculado: 350, diferenca: 0 },
      ]),
    );
  });

  it("o ROTA não muda quando só o AS muda — nem no declarado, nem no calculado", async () => {
    const competenciaA = await competenciaCom(
      pagamentoComDoisCanais({
        rotaFaturado: "2.000,00",
        rotaTotal: "2.000,00",
        asFaturado: "350,00",
        asTotal: "350,00",
      }),
      "37",
    );
    const { canais: canaisA } = await totaisDoPagamentoDaCompetencia(db, competenciaA.id);
    const rotaA = canaisA.find((c) => c.canal === "ROTA");

    /*
      Uma segunda competência, com o ROTA idêntico e o AS bem diferente — verba
      maior e um `Total Remuneracao` que nem bate com a própria soma do AS (o
      caso que `total-do-pagamento.test.ts` já cobre para um canal só). Se o
      cálculo do ROTA dependesse do AS de qualquer jeito — soma cruzada, total
      geral dividido depois —, `rotaB` discordaria de `rotaA` aqui.
    */
    const competenciaB = await competenciaCom(
      pagamentoComDoisCanais({
        rotaFaturado: "2.000,00",
        rotaTotal: "2.000,00",
        asFaturado: "99.999,00",
        asTotal: "1,00",
      }),
      "38",
    );
    const { canais: canaisB } = await totaisDoPagamentoDaCompetencia(db, competenciaB.id);
    const rotaB = canaisB.find((c) => c.canal === "ROTA");
    const asB = canaisB.find((c) => c.canal === "AS");

    expect(rotaB).toEqual(rotaA);
    expect(rotaB).toEqual({ canal: "ROTA", declarado: 2000, calculado: 2000, diferenca: 0 });
    /* E o AS, nesta segunda competência, de fato não bate consigo mesmo. */
    expect(asB).toEqual({ canal: "AS", declarado: 1, calculado: 99999, diferenca: -99998 });
  });
});
