import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readMigrations, runMigrations } from "../migrate";

/**
 * O backfill da `0055` — o 03.08.18 que já estava no banco vira dois.
 *
 * A `0055` separa o relatório de disponibilidade em duas fontes,
 * `DISPONIBILIDADE_FF` e `DISPONIBILIDADE_VAN`, porque ele sai do Promax em
 * dois arquivos e uma casinha só fazia o segundo apagar o primeiro. O tipo novo
 * resolve o **futuro**; o que já está gravado é problema desta migration.
 *
 * E é um problema com dinheiro dentro: as linhas do documento antigo sustentam
 * o desconto de disponibilidade do mês, FF e van somadas. Um backfill que
 * escolhesse uma frota e descartasse a outra derrubaria o desconto pela metade
 * sem nada acusar — e um que deixasse o tipo velho no banco travaria a
 * `CHECK` da coluna, que a `0055` fecha sem ele.
 *
 * O que se prova aqui é o que a suíte de `@workspace/fechamento` não alcança:
 * lá o banco nasce migrado, e não existe "antes" para trazer.
 */
const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_disp_frota_backfill_${process.pid}`;
const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

async function comAdmin<T>(f: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await f(pool);
  } finally {
    await pool.end().catch(() => {});
  }
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

/** A fila até `ate` (inclusive), com registro — uma Production parada ali. */
async function migradoAte(pool: pg.Pool, ate: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
       id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
  );
  for (const m of readMigrations()) {
    for (const comando of m.statements) await pool.query(comando);
    await pool.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash","created_at") VALUES ($1,$2)`,
      [m.hash, m.when],
    );
    if (m.tag === ate) return;
  }
  throw new Error(`migration ${ate} não existe`);
}

describe.skipIf(!temBanco)("a 0055 sobre um banco que já tinha 03.08.18 importado", () => {
  let pool: pg.Pool;
  /** Os quatro documentos de antes: as duas frotas, só a van, sem linha, e a competência congelada. */
  const documento = {
    duasFrotas: "11111111-1111-4111-8111-111111111111",
    soVan: "22222222-2222-4222-8222-222222222222",
    semLinha: "33333333-3333-4333-8333-333333333333",
    congelado: "44444444-4444-4444-8444-444444444444",
  };
  const competencia = {
    aberta: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    encerrada: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  };

  beforeAll(async () => {
    await comAdmin(async (a) => {
      await a.query(`DROP DATABASE IF EXISTS "${NOME}"`);
      await a.query(`CREATE DATABASE "${NOME}"`);
    });
    pool = new pg.Pool({ connectionString: urlDe(NOME) });
    await migradoAte(pool, "0054_regra_de_alteracao");

    const abrir = (id: string, chave: string, mes: number, estado: string) =>
      pool.query(
        `INSERT INTO "fechamento_competencia"
           ("id","chave","ano","mes","quinzena","inicio","fim","estado",
            "unidade_codigo","unidade_nome","transportadora_codigo","transportadora_nome")
         VALUES ($1, $2, 2026, $3, 2, $4, $5, $6, '443', 'CDD BELEM', '36', 'TRANSPORTES FICTICIA')`,
        [id, chave, mes, `2026-0${mes}-16`, `2026-0${mes}-30`, estado],
      );

    /*
      A competência encerrada é de propósito: o gatilho
      `fechamento_documento_congelada` recusa escrita nela, e é ele que faria a
      migration morrer em qualquer banco com uma quinzena já fechada — que é
      todo banco em uso. A `0055` o desliga enquanto separa e o religa depois.
    */
    await abrir(competencia.aberta, "2026-06-Q2", 6, "ABERTA");
    /* Nasce aberta e é congelada no fim do preparo: o gatilho recusa escrita na
       encerrada, e é justamente a escrita que precisa estar lá dentro. */
    await abrir(competencia.encerrada, "2026-07-Q2", 7, "ABERTA");

    const doc = (
      id: string,
      competenciaId: string,
      nome: string,
      sha: string,
      linhas: number,
      vigente: boolean,
    ) =>
      pool.query(
        `INSERT INTO "fechamento_documento"
           ("id","competencia_id","tipo","nome_do_arquivo","sha256","tamanho_em_bytes",
            "linhas_lidas","vigente","enviado_em")
         VALUES ($1,$2,'DISPONIBILIDADE',$3,$4,1024,$5,$6,'2026-07-20T10:00:00Z')`,
        [id, competenciaId, nome, sha, linhas, vigente],
      );

    /* Um vigente por (competência, tipo) — antes da `0055` o índice parcial é
       sobre `tipo` sozinho, e os três da mesma competência disputam a vaga. */
    await doc(documento.duasFrotas, competencia.aberta, "03.08.18.xlsx", "a".repeat(64), 3, true);
    await doc(documento.soVan, competencia.aberta, "03.08.18-vans.xlsx", "b".repeat(64), 1, false);
    await doc(documento.semLinha, competencia.aberta, "quarentena.xlsx", "c".repeat(64), 0, false);
    await doc(documento.congelado, competencia.encerrada, "03.08.18.xlsx", "d".repeat(64), 2, true);

    /* Os bytes do documento das duas frotas: o clone da van tem de recebê-los. */
    await pool.query(
      `INSERT INTO "fechamento_documento_conteudo" ("documento_id","conteudo","bytes_originais")
       VALUES ($1, decode('1f8b', 'hex'), 1024)`,
      [documento.duasFrotas],
    );

    const linha = (
      documentoId: string,
      competenciaId: string,
      frota: string,
      dia: string,
      total: string,
      numero: number,
    ) =>
      pool.query(
        `INSERT INTO "fechamento_disponibilidade"
           ("documento_id","competencia_id","linha_no_arquivo","tipo_de_frota","dia","canal",
            "frota_total","contratada","real_primeira_viagem","real_segunda_viagem","gap_total",
            "gap_da_cia","desconto_custo_fixo","desconto_equipe","desconto_indiretos",
            "desconto_fator_ajudante","desconto_total")
         VALUES ($1,$2,$3,$4,$5,'ROTA',10,8,6,0,2,1,0,0,0,0,$6)`,
        [documentoId, competenciaId, numero, frota, dia, total],
      );

    await linha(documento.duasFrotas, competencia.aberta, "FF", "2026-06-16", "300.00", 2);
    await linha(documento.duasFrotas, competencia.aberta, "FF", "2026-06-17", "100.00", 3);
    await linha(documento.duasFrotas, competencia.aberta, "VAN", "2026-06-16", "50.00", 2);
    await linha(documento.soVan, competencia.aberta, "VAN", "2026-06-18", "7.00", 2);
    await linha(documento.congelado, competencia.encerrada, "FF", "2026-07-16", "80.00", 2);
    await linha(documento.congelado, competencia.encerrada, "VAN", "2026-07-16", "9.00", 2);

    await pool.query(
      `UPDATE "fechamento_competencia" SET "estado" = 'ENCERRADA', "encerrada_em" = now()
        WHERE "id" = $1`,
      [competencia.encerrada],
    );
  }, 300_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await comAdmin(async (a) => {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
        [NOME],
      );
      await a.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    });
  }, 300_000);

  it("separa cada documento pela frota das linhas dele, sem perder nenhuma", async () => {
    const relatorio = await runMigrations(urlDe(NOME));
    expect(relatorio.failure).toBeUndefined();
    expect(relatorio.applied[0]).toBe("0055_disponibilidade_por_frota");

    /* Nenhuma linha de disponibilidade se perdeu: seis antes, seis depois. */
    const { rows: quantas } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM "fechamento_disponibilidade"`,
    );
    expect(Number(quantas[0]!.n)).toBe(6);

    /* E cada linha continua no documento certo — o da frota dela. */
    const { rows: pares } = await pool.query<{ tipo: string; tipo_de_frota: string; n: string }>(
      `SELECT d."tipo", l."tipo_de_frota", count(*) AS n
         FROM "fechamento_disponibilidade" l
         JOIN "fechamento_documento" d ON d."id" = l."documento_id"
        GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    expect(pares.map((p) => [p.tipo, p.tipo_de_frota, Number(p.n)])).toEqual([
      ["DISPONIBILIDADE_FF", "FF", 3],
      ["DISPONIBILIDADE_VAN", "VAN", 3],
    ]);
  }, 300_000);

  it("o documento das duas frotas vira dois — e o clone da van fica vigente com os bytes", async () => {
    const { rows } = await pool.query<{
      id: string;
      tipo: string;
      nome_do_arquivo: string;
      sha256: string;
      vigente: boolean;
      linhas_lidas: number;
      tem_bytes: boolean;
    }>(
      `SELECT d."id", d."tipo", d."nome_do_arquivo", d."sha256", d."vigente", d."linhas_lidas",
              (k."documento_id" IS NOT NULL) AS tem_bytes
         FROM "fechamento_documento" d
         LEFT JOIN "fechamento_documento_conteudo" k ON k."documento_id" = d."id"
        WHERE d."sha256" = $1 ORDER BY d."tipo"`,
      ["a".repeat(64)],
    );

    expect(rows.map((r) => r.tipo)).toEqual(["DISPONIBILIDADE_FF", "DISPONIBILIDADE_VAN"]);
    /* O original continua sendo o original; o clone é novo e nasce da mesma remessa. */
    expect(rows[0]!.id).toBe(documento.duasFrotas);
    expect(rows[1]!.id).not.toBe(documento.duasFrotas);
    for (const r of rows) {
      expect(r.nome_do_arquivo).toBe("03.08.18.xlsx");
      expect(r.vigente).toBe(true);
      /* Os bytes vão junto: sem eles o clone não teria de onde ser reimportado. */
      expect(r.tem_bytes).toBe(true);
    }
    /* E cada um declara as linhas que sustenta, não as três do arquivo inteiro. */
    expect(rows.map((r) => r.linhas_lidas)).toEqual([2, 1]);
  }, 300_000);

  it("o de uma frota só troca de nome, e o que não sustenta linha vai para a FF", async () => {
    const { rows } = await pool.query<{ id: string; tipo: string; linhas_lidas: number }>(
      `SELECT "id","tipo","linhas_lidas" FROM "fechamento_documento" WHERE "id" = ANY($1)
        ORDER BY "id"`,
      [[documento.soVan, documento.semLinha]],
    );
    const por = (id: string) => rows.find((r) => r.id === id)!;

    expect(por(documento.soVan).tipo).toBe("DISPONIBILIDADE_VAN");
    /*
      O documento em quarentena não sustenta linha nenhuma, e por isso não tem
      frota a preservar: ele fica na casinha da FF, que é onde o histórico o
      mostra, e o `linhas_lidas` que a importação leu não é mexido — zerá-lo
      apagaria o que ele diz sobre o próprio arquivo.
    */
    expect(por(documento.semLinha).tipo).toBe("DISPONIBILIDADE_FF");
    expect(por(documento.semLinha).linhas_lidas).toBe(0);
  }, 300_000);

  it("a competência encerrada é separada como as outras — o gatilho não a tranca", async () => {
    /*
      É a asserção que prende o desligamento do gatilho. Sem ele a migration
      morre na primeira quinzena já fechada, que é o estado de qualquer banco em
      uso — e a fila trava inteira, num banco que estava certo.
    */
    const { rows } = await pool.query<{ tipo: string; n: string }>(
      `SELECT d."tipo", count(*) AS n
         FROM "fechamento_documento" d
        WHERE d."competencia_id" = $1 GROUP BY 1 ORDER BY 1`,
      [competencia.encerrada],
    );
    expect(rows.map((r) => [r.tipo, Number(r.n)])).toEqual([
      ["DISPONIBILIDADE_FF", 1],
      ["DISPONIBILIDADE_VAN", 1],
    ]);

    /* E o gatilho voltou: a competência encerrada recusa escrita de novo. */
    await expect(
      pool.query(
        `UPDATE "fechamento_documento" SET "nome_do_arquivo" = 'depois.xlsx'
          WHERE "competencia_id" = $1`,
        [competencia.encerrada],
      ),
    ).rejects.toThrow(/está encerrada/);
  }, 300_000);

  it("depois dela o nome antigo não entra mais, e a repetição passa a ser por fonte", async () => {
    /* A lista fechada não admite mais o 03.08.18 sem frota. */
    await expect(
      pool.query(
        `UPDATE "fechamento_documento" SET "tipo" = 'DISPONIBILIDADE' WHERE "id" = $1`,
        [documento.semLinha],
      ),
    ).rejects.toThrow(/fechamento_documento_tipo/);

    /*
      E os mesmos bytes podem estar nas duas casinhas da mesma competência — é
      o `.xlsx` de duas abas, que é o arquivo da FF e o das vans ao mesmo
      tempo —, mas não duas vezes na mesma.
    */
    await expect(
      pool.query(
        `INSERT INTO "fechamento_documento"
           ("competencia_id","tipo","nome_do_arquivo","sha256","tamanho_em_bytes","vigente")
         VALUES ($1,'DISPONIBILIDADE_FF','de-novo.xlsx',$2,1024,false)`,
        [competencia.aberta, "a".repeat(64)],
      ),
    ).rejects.toThrow(/fechamento_documento_sem_repeticao/);
  }, 300_000);
});
