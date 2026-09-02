import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../migrate";

/**
 * A `0087` promove oito colunas de `payload` — **sem reimportar arquivo nenhum**.
 *
 * É a afirmação mais consequente daquela migration, e a mais fácil de quebrar
 * sem ninguém ver. Todo envio de chamados que já entrou tem a linha inteira do
 * arquivo em `ticket.payload`, com os cabeçalhos originais; se o backfill
 * errasse a grafia de um cabeçalho, a coluna nasceria **meio preenchida** — que
 * é pior do que vazia, porque parece completa e o Monitoramento passaria a
 * filtrar por uma unidade que só existe em metade das linhas.
 *
 * Este arquivo prova as três coisas de que isso depende:
 *
 * 1. o backfill lê o cabeçalho **dobrado** (sem acento, sem caixa, sem
 *    pontuação), como o leitor faz — e não por igualdade literal;
 * 2. as datas voltam certas, inclusive a brasileira (`03/09/2026` é 3 de
 *    setembro, e não 9 de março, que é o que um cast genérico devolveria);
 * 3. ele é reaplicável: rodar de novo não desfaz nada nem estoura em lixo.
 *
 * O SQL é lido **do arquivo da migration**, e não copiado para cá. Uma cópia
 * envelheceria em silêncio: a prova continuaria verde sobre um texto que já não
 * é o que roda em produção.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_test_backfill_0087_${process.pid}`;
const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations/0087_monitoramento_de_chamados.sql",
);

let pool: pg.Pool;

/**
 * O `UPDATE` do backfill, recortado da migration pelo que ele começa e termina.
 *
 * A migration inteira não pode ser reexecutada aqui — ela já rodou, e reexecutá-la
 * provaria a reentrância e não o backfill. O que interessa é o comando que
 * preenche as colunas, aplicado a linhas que já existiam.
 */
function comandoDeBackfill(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const inicio = sql.indexOf('UPDATE "ticket" SET');
  expect(inicio, "o UPDATE do backfill sumiu da 0087").toBeGreaterThan(-1);
  const fim = sql.indexOf(";", sql.indexOf("<> '{}'::jsonb", inicio));
  return sql.slice(inicio, fim + 1);
}

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.query(`CREATE DATABASE "${NOME}"`);
  await admin.end();

  const url = ADMIN.replace("/postgres?", `/${NOME}?`);
  const relatorio = await runMigrations(url);
  expect(relatorio.failure).toBeUndefined();
  pool = new pg.Pool({ connectionString: url });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.end();
});

/** Uma linha como um envio anterior à `0087` a deixou: só `payload`. */
async function chamadoAntigo(payload: Record<string, unknown>, linha: number) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO ticket_import (filename, content_sha256, byte_size, status)
     VALUES ($1, $2, 1, 'READ') RETURNING id`,
    [`Chamados_Recife.xlsx`, `sha-${linha}`],
  );
  await pool.query(
    `INSERT INTO ticket (ticket_import_id, external_id, source_row_index, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [rows[0]!.id, `CH-${linha}`, linha, JSON.stringify(payload)],
  );
  return rows[0]!.id;
}

async function colunasDe(externalId: string) {
  const { rows } = await pool.query(
    `SELECT unidade_raw, segmento_raw, operador_raw, aprovador_raw, sla_raw,
            categoria_raw, prazo_previsto, alterado_em_fonte
       FROM ticket WHERE external_id = $1`,
    [externalId],
  );
  return rows[0]!;
}

describe("o backfill da 0087", () => {
  it("preenche as oito colunas a partir da linha que já estava gravada", async () => {
    await chamadoAntigo(
      {
        "B.O": "CH-1",
        Unidade: "Recife",
        Segmento: "Operações",
        Operador: "Ana Lima",
        Aprovador: "João Silva",
        SLA: "5 dias",
        Categoria: "Reajuste",
        "Previsão Análise": "2026-09-15T00:00:00.000Z",
        "Data Alteração": "2026-09-02T11:15:00.000Z",
      },
      1,
    );

    await pool.query(comandoDeBackfill());
    const c = await colunasDe("CH-1");

    expect(c.unidade_raw).toBe("Recife");
    expect(c.segmento_raw).toBe("Operações");
    expect(c.operador_raw).toBe("Ana Lima");
    expect(c.aprovador_raw).toBe("João Silva");
    expect(c.sla_raw).toBe("5 dias");
    expect(c.categoria_raw).toBe("Reajuste");
    expect(new Date(c.prazo_previsto).toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(new Date(c.alterado_em_fonte).toISOString()).toBe("2026-09-02T11:15:00.000Z");
  });

  it("lê o cabeçalho dobrado: caixa, acento e pontuação não escondem a coluna", async () => {
    // O mesmo arquivo exportado por outra fila chega assim. Um backfill por
    // igualdade literal deixaria estas linhas com as colunas vazias, e a
    // unidade passaria a existir só em parte do acervo.
    await chamadoAntigo(
      {
        "B.O": "CH-2",
        UNIDADE: "Camaçari",
        "SEGMENTO ": "Fiscal",
        "Previsao  Analise": "2026-10-01",
      },
      2,
    );

    await pool.query(comandoDeBackfill());
    const c = await colunasDe("CH-2");

    expect(c.unidade_raw).toBe("Camaçari");
    expect(c.segmento_raw).toBe("Fiscal");
    expect(new Date(c.prazo_previsto).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("a data brasileira é dia/mês — e não o mês/dia que um cast genérico devolve", async () => {
    // `'03/09/2026'::timestamptz` é aceito pelo Postgres como **9 de março**
    // com o DateStyle padrão. É um erro que não estoura, não aparece em log
    // nenhum, e desloca prazo em meses.
    await chamadoAntigo(
      { "B.O": "CH-3", "Previsão Análise": "03/09/2026", "Data Alteração": "03/09/2026" },
      3,
    );

    await pool.query(comandoDeBackfill());
    const c = await colunasDe("CH-3");

    expect(new Date(c.prazo_previsto).toISOString().slice(0, 10)).toBe("2026-09-03");
    expect(new Date(c.alterado_em_fonte).toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  it("lixo e vazio não estouram, e não viram data nenhuma", async () => {
    // Um backfill que estourasse na primeira célula estranha deixaria a
    // migration irreaplicável — o que `docs/MIGRATIONS.md` proíbe.
    await chamadoAntigo(
      {
        "B.O": "CH-4",
        Unidade: "   ",
        "Previsão Análise": "a combinar",
        "Data Alteração": "",
      },
      4,
    );

    await pool.query(comandoDeBackfill());
    const c = await colunasDe("CH-4");

    expect(c.unidade_raw).toBeNull();
    expect(c.prazo_previsto).toBeNull();
    expect(c.alterado_em_fonte).toBeNull();
  });

  it("é reaplicável: rodar de novo não muda nada", async () => {
    const antes = await colunasDe("CH-1");
    await pool.query(comandoDeBackfill());
    await pool.query(comandoDeBackfill());
    expect(await colunasDe("CH-1")).toEqual(antes);
  });

  it("não sobrescreve o que o leitor já preencheu", async () => {
    // Depois da `0087` o leitor grava a coluna direto, e o `COALESCE` do
    // backfill existe para que um reprocessamento não a substitua pelo que o
    // payload diz — que pode ser a grafia de outro cabeçalho.
    await chamadoAntigo({ "B.O": "CH-5", Unidade: "Do payload" }, 5);
    await pool.query(`UPDATE ticket SET unidade_raw = 'Da coluna' WHERE external_id = 'CH-5'`);

    await pool.query(comandoDeBackfill());
    expect((await colunasDe("CH-5")).unidade_raw).toBe("Da coluna");
  });
});
