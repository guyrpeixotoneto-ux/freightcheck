import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../migrate";

/**
 * A `0092` move a 2ª quinzena do dia 2 para o dia 16 — nos dados que já entraram.
 *
 * O rótulo da fonte é `<CANAL>_<QUINZENA>_<MÊS>_<ANO>`, e `lib/ingest` o lia
 * como `<CANAL>_<DIA>_…`. `EMPURRADA_2_8_2026` virava `2026-08-02` em vez de
 * `2026-08-16`. O parser já foi corrigido; se o que está gravado não for
 * corrigido junto, a mesma vigência passa a ter duas chaves de negócio — a
 * antiga, no banco, e a nova, calculada a cada reimportação — e o produto
 * grava a vigência duas vezes sem que nada acuse.
 *
 * O que estas provas prendem:
 *
 * 1. a 2ª quinzena anda quinze dias, e a 1ª **não** anda (ela já estava certa);
 * 2. o snapshot CLOSED é reescrito apesar do trigger de imutabilidade — e o
 *    trigger volta a valer depois, o que é a metade que se esquece de provar;
 * 3. as tabelas que só têm a data (`entity_identifier`, a planilha de
 *    remuneração) andam junto, e uma data igual de **outra** natureza não é
 *    arrastada;
 * 4. rodar de novo não move nada nem estoura.
 *
 * O SQL é lido do arquivo da migration, e não copiado para cá: uma cópia
 * envelheceria em silêncio, e a prova seguiria verde sobre um texto que já não
 * é o que roda.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_test_quinzena_0092_${process.pid}`;
const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations/0092_quinzena_e_nao_dia_do_mes.sql",
);

let pool: pg.Pool;

/**
 * A migration, comando a comando, como o runner a aplica.
 *
 * Ela roda numa transação só — a tabela temporária é `ON COMMIT DROP` e o
 * `SET LOCAL` morre com a transação —, então a prova precisa reproduzir isso,
 * e não disparar os comandos soltos.
 */
async function aplicarMigration(cliente: pg.PoolClient): Promise<void> {
  const sql = readFileSync(MIGRATION, "utf8");
  await cliente.query("BEGIN");
  try {
    for (const comando of sql.split("--> statement-breakpoint")) {
      if (comando.trim() === "") continue;
      await cliente.query(comando);
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK");
    throw err;
  }
}

async function migrar(): Promise<void> {
  const cliente = await pool.connect();
  try {
    await aplicarMigration(cliente);
  } finally {
    cliente.release();
  }
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

/** O par arquivo + run que todo snapshot exige por FK. */
async function origem(): Promise<{ fileId: string; runId: string }> {
  const { rows: arquivo } = await pool.query<{ id: string }>(
    `INSERT INTO source_file (filename, content_sha256, byte_size, storage_path)
     VALUES ('EMPURRADA_Cavalo.xlsx', md5(random()::text), 1024, 'prova/0092.xlsx')
     RETURNING id`,
  );
  const { rows: run } = await pool.query<{ id: string }>(
    `INSERT INTO import_run (source_file_id, status)
     VALUES ($1, 'PROMOTED') RETURNING id`,
    [arquivo[0].id],
  );
  return { fileId: arquivo[0].id, runId: run[0].id };
}

/**
 * Uma vigência como a leitura antiga a gravou: o rótulo certo, a data errada.
 *
 * O `status` entra como CLOSED porque é esse o estado em que o trigger de
 * imutabilidade morde — gravar DRAFT provaria só que um rascunho é editável.
 */
async function vigenciaAntiga(opcoes: {
  label: string;
  data: string;
  unidade: string;
}): Promise<{ id: string; scopeHash: string }> {
  const { fileId, runId } = await origem();
  // UNIDADE e OPERADOR são normalizados como documento: um código sem dígitos
  // sai vazio da normalização e o escopo inteiro cai fora, contra a check
  // constraint. São CNPJs porque é o que a importação de verdade grava.
  const escopo = JSON.stringify([
    { scopeType: "UNIDADE", code: opcoes.unidade },
    { scopeType: "OPERADOR", code: "20618821000799" },
  ]);
  const { rows } = await pool.query<{ id: string; scope_hash: string }>(
    `INSERT INTO snapshot (
       source_file_id, import_run_id, source_system, dataset_family, canal,
       source_label, effective_date, scope_hash, canonical_scope,
       entity_type_set, status, revision
     )
     VALUES ($1, $2, 'FREIGHTEC', 'REMUNERACAO', 'EMPURRADA', $3, $4::date, $5,
             freightcheck_canonical_scope($6::jsonb), 'CAVALO', 'CLOSED', 1)
     RETURNING id, scope_hash`,
    [fileId, runId, opcoes.label, opcoes.data, `hash_${opcoes.unidade}`, escopo],
  );
  return { id: rows[0].id, scopeHash: rows[0].scope_hash };
}

async function dataDo(label: string): Promise<string> {
  const { rows } = await pool.query<{ d: string }>(
    `SELECT to_char(effective_date, 'YYYY-MM-DD') AS d
       FROM snapshot WHERE source_label = $1`,
    [label],
  );
  return rows[0].d;
}

describe("a 0092 corrige a data das vigências já importadas", () => {
  let planilhaDaSegunda: string;

  beforeAll(async () => {
    await vigenciaAntiga({
      label: "EMPURRADA_1_8_2026",
      data: "2026-08-01",
      unidade: "07526557001505",
    });
    const segunda = await vigenciaAntiga({
      label: "EMPURRADA_2_8_2026",
      data: "2026-08-02",
      unidade: "07526557001505",
    });
    await vigenciaAntiga({
      label: "EMPURRADA_2_7_2026",
      data: "2026-07-02",
      unidade: "07526557001505",
    });

    // Uma placa que passou a valer na 2ª quinzena de agosto, com a data que a
    // promoção copiava do snapshot.
    const { rows: entidade } = await pool.query<{ id: string }>(
      `INSERT INTO entity (entity_type) VALUES ('CAVALO')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO entity_identifier
         (entity_id, identifier_type, identifier_value, effective_from, is_current)
       VALUES ($1, 'PLACA', 'QYQ6A80', '2026-08-02'::date, true)`,
      [entidade[0].id],
    );

    // A planilha de remuneração daquela vigência, na mesma unidade.
    planilhaDaSegunda = segunda.scopeHash;
    await pool.query(
      `INSERT INTO remuneracao_planilha
         (scope_hash, canal, effective_date, chave, valor)
       VALUES ($1, 'EMPURRADA', '2026-08-02'::date, 'aliquota_pis', '1.65')`,
      [planilhaDaSegunda],
    );

    await migrar();
  }, 120_000);

  it("move a 2ª quinzena para o dia 16 e deixa a 1ª onde ela já estava certa", async () => {
    expect(await dataDo("EMPURRADA_2_8_2026")).toBe("2026-08-16");
    expect(await dataDo("EMPURRADA_2_7_2026")).toBe("2026-07-16");
    // A 1ª quinzena começa no dia 1: a leitura antiga acertava por acidente, e
    // mover essa também transformaria um acerto em erro.
    expect(await dataDo("EMPURRADA_1_8_2026")).toBe("2026-08-01");
  });

  it("as duas vigências do mês passam a cair em quinzenas distintas do calendário", async () => {
    /*
      É por isso que a correção aparece na tela sem que a camada de rótulo mude
      uma linha: `rotuloDaVigencia` escolhe a ordinal quando as datas do mês
      caem em metades diferentes. Com 01 e 02 as duas caíam na primeira, e o
      rótulo caía no desempate por dia — "dia 02", para uma quinzena que começa
      no 16.
    */
    const { rows } = await pool.query<{ quinzena: number; n: string }>(
      `SELECT CASE WHEN extract(day FROM effective_date) <= 15 THEN 1 ELSE 2 END AS quinzena,
              count(*) AS n
         FROM snapshot
        WHERE to_char(effective_date, 'YYYY-MM') = '2026-08'
        GROUP BY 1 ORDER BY 1`,
    );
    expect(rows.map((r) => Number(r.quinzena))).toEqual([1, 2]);
    expect(rows.map((r) => Number(r.n))).toEqual([1, 1]);
  });

  it("reescreve o snapshot CLOSED e devolve o trigger de imutabilidade no fim", async () => {
    // A migration suspende a proteção dentro da transação dela. Se a suspensão
    // vazasse, uma vigência fechada passaria a ser editável por qualquer
    // sessão — o que é pior que o bug que ela veio consertar.
    await expect(
      pool.query(
        `UPDATE snapshot SET entity_count = 99 WHERE source_label = 'EMPURRADA_2_8_2026'`,
      ),
    ).rejects.toThrow(/CLOSED and immutable/);
  });

  it("leva junto as tabelas que só têm a data", async () => {
    const { rows: placa } = await pool.query<{ d: string }>(
      `SELECT to_char(effective_from, 'YYYY-MM-DD') AS d
         FROM entity_identifier WHERE identifier_value = 'QYQ6A80'`,
    );
    expect(placa[0].d).toBe("2026-08-16");

    const { rows: planilha } = await pool.query<{ d: string }>(
      `SELECT to_char(effective_date, 'YYYY-MM-DD') AS d
         FROM remuneracao_planilha WHERE chave = 'aliquota_pis'`,
    );
    expect(planilha[0].d).toBe("2026-08-16");
  });

  it("rodar de novo não move nada nem estoura", async () => {
    // A migration é uma transação só e roda uma vez, mas um banco reexecutado
    // — restaurado, reaplicado à mão — não pode virar `2026-08-30`.
    await migrar();
    expect(await dataDo("EMPURRADA_2_8_2026")).toBe("2026-08-16");
    expect(await dataDo("EMPURRADA_1_8_2026")).toBe("2026-08-01");
  }, 60_000);
});

describe("o que a 0092 se recusa a adivinhar", () => {
  it("para quando uma 2ª quinzena está num dia que não é nem o 2 nem o 16", async () => {
    /*
      O mapa presume o erro conhecido: a 2ª quinzena gravada no dia 2. Uma
      gravada no dia 9 veio de outro caminho — e mover uma data que já está em
      outro lugar seria empilhar um segundo erro sobre o primeiro.
    */
    await vigenciaAntiga({
      label: "EMPURRADA_2_9_2026",
      data: "2026-09-09",
      unidade: "04333577000121",
    });

    await expect(migrar()).rejects.toThrow(/não é nem o dia 2 nem o dia 16/);

    // E a recusa é atômica: a transação inteira volta, então nada foi movido.
    expect(await dataDo("EMPURRADA_2_9_2026")).toBe("2026-09-09");
  }, 60_000);
});
