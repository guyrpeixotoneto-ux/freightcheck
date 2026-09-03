import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../migrate";

/**
 * A `0089` apaga a cópia que a máquina fez — e **só** ela.
 *
 * A migration limpa o `display_name` que a promoção antiga escrevia igual ao
 * nome de origem. O risco inteiro dela está numa coincidência banal: alguém
 * pode ter aberto a curadoria e salvo, à mão, exatamente o nome que já estava
 * lá. Pelo valor, essa linha é indistinguível da cópia automática; apagá-la
 * destruiria o único registro de que uma pessoa olhou aquela coluna e decidiu
 * que o nome estava bom — que é justamente o estado que a exclusão de
 * importação passou a proteger.
 *
 * O que as distingue é o rastro, não o valor: `saveMeaning` é o único caminho
 * de escrita humana em `attribute.display_name`, e grava um `curation_event`
 * com `field = 'display_name'` na mesma transação do UPDATE. A promoção
 * escrevia num INSERT, sem evento nenhum.
 *
 * Este arquivo prova as três coisas de que a segurança da migration depende:
 *
 * 1. a cópia automática sai;
 * 2. o nome salvo à mão fica — **inclusive quando é idêntico ao nome de
 *    origem**, que é o caso perigoso e o motivo desta guarda existir;
 * 3. ela é idempotente, e a volta atrás reconstrói o que foi tirado.
 *
 * O SQL é lido **do arquivo da migration**, e não copiado para cá: uma cópia
 * envelheceria em silêncio, e a prova continuaria verde sobre um texto que já
 * não é o que roda em produção.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_test_0089_${process.pid}`;
const MIGRATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations/0089_nome_gerencial_vazio.sql",
);

/** O UPDATE da migration, recortado do arquivo pelo que ele começa e termina. */
function comandoDaMigration(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const inicio = sql.indexOf("UPDATE attribute a");
  expect(inicio, "o UPDATE sumiu da 0089").toBeGreaterThan(-1);
  const fim = sql.indexOf(";", inicio);
  return sql.slice(inicio, fim + 1);
}

let pool: pg.Pool;

/** Os três casos, com o nome que cada um representa. */
const COPIA = "cavalo.copia_da_maquina";
const IGUAL_A_MAO = "cavalo.salvo_a_mao_igual";
const APELIDO = "cavalo.apelido_de_verdade";

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.query(`CREATE DATABASE "${NOME}"`);
  await admin.end();

  const url = ADMIN.replace("/postgres?", `/${NOME}?`);
  await runMigrations(url);
  pool = new pg.Pool({ connectionString: url });

  // As três colunas nascem como a promoção antiga as criava: `display_name`
  // igual ao nome de origem. É de propósito — o que separa uma da outra daqui
  // para a frente é só o rastro.
  await pool.query(
    `INSERT INTO attribute (code, source_name, display_name, entity_type, data_type)
     VALUES ($1, 'copiaDaMaquina',  'copiaDaMaquina',  'CAVALO', 'TEXT'),
            ($2, 'salvoAMaoIgual',  'salvoAMaoIgual',  'CAVALO', 'TEXT'),
            ($3, 'apelidoDeVerdade','Nome que alguém escolheu', 'CAVALO', 'TEXT')`,
    [COPIA, IGUAL_A_MAO, APELIDO],
  );

  // E uma delas ganha o rastro de quem a salvou — o mesmo evento que
  // `saveMeaning` grava, com o mesmo `field`.
  await pool.query(
    `INSERT INTO curation_event
       (target_kind, target_id, target_label, field, value_before, value_after, actor)
     SELECT 'ATTRIBUTE', id, code, 'display_name', NULL, 'salvoAMaoIgual', 'quem.curou@exemplo.com'
       FROM attribute WHERE code = $1`,
    [IGUAL_A_MAO],
  );
}, 300_000);

afterAll(async () => {
  await pool?.end();
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
    [NOME],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.end();
}, 300_000);

async function nomeGerencialDe(code: string): Promise<string | null> {
  const { rows } = await pool.query<{ display_name: string | null }>(
    `SELECT display_name FROM attribute WHERE code = $1`,
    [code],
  );
  return rows[0].display_name;
}

describe("a 0089 sobre nomes gerenciais", () => {
  it("apaga a cópia que a promoção escreveu, e preserva o que uma pessoa salvou", async () => {
    const { rowCount } = await pool.query(comandoDaMigration());

    // Uma linha só: a cópia sem rastro.
    expect(rowCount).toBe(1);
    expect(await nomeGerencialDe(COPIA)).toBeNull();

    // O caso perigoso: mesmo valor, mesma aparência, e fica — porque alguém o
    // salvou, e o evento prova.
    expect(await nomeGerencialDe(IGUAL_A_MAO)).toBe("salvoAMaoIgual");

    // E o apelido de verdade nunca esteve em risco.
    expect(await nomeGerencialDe(APELIDO)).toBe("Nome que alguém escolheu");
  });

  it("é idempotente: a segunda passada não encontra mais nada", async () => {
    const { rowCount } = await pool.query(comandoDaMigration());
    expect(rowCount).toBe(0);

    expect(await nomeGerencialDe(COPIA)).toBeNull();
    expect(await nomeGerencialDe(IGUAL_A_MAO)).toBe("salvoAMaoIgual");
    expect(await nomeGerencialDe(APELIDO)).toBe("Nome que alguém escolheu");
  });

  it("a volta atrás reconstrói a cópia, sem tocar em curadoria nenhuma", async () => {
    // O rollback documentado na própria migration. Ele só alcança o que está
    // nulo — e o que uma pessoa escreveu nunca está.
    await pool.query(
      `UPDATE attribute SET display_name = source_name WHERE display_name IS NULL`,
    );

    expect(await nomeGerencialDe(COPIA)).toBe("copiaDaMaquina");
    expect(await nomeGerencialDe(IGUAL_A_MAO)).toBe("salvoAMaoIgual");
    expect(await nomeGerencialDe(APELIDO)).toBe("Nome que alguém escolheu");

    // E o estado volta a ser reversível: rodar a migration de novo tira de novo
    // só a cópia.
    const { rowCount } = await pool.query(comandoDaMigration());
    expect(rowCount).toBe(1);
    expect(await nomeGerencialDe(COPIA)).toBeNull();
  });
});
