import { describe, expect, it } from "vitest";
import pg from "pg";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MIGRATIONS_FOLDER, runMigrations } from "../migrate";
import { migrarComReparo } from "../fila";
import { reconvergirRegistradas } from "../reconvergencia";

/**
 * O incidente de 21/08/2026, preso por teste.
 *
 * Production tinha as 49 primeiras migrations registradas e **não tinha**
 * `remuneracao_unidade`, a tabela que a `0048` cria: algo de fora da fila a
 * havia removido (o Provision do Publishing, que espelha um Development
 * atrasado — ver `../reconvergencia`). A `0049` morreu em cima dela com 42P01,
 * a `0050` nunca foi tentada, e a tela da Remuneração respondia com o
 * diagnóstico de MIGRATION_FALHOU.
 *
 * O estado é estável, e é isso que o torna perigoso: `runMigrations()` decide
 * por carimbo e não repõe o que falta; a reconvergência repõe mas se recusa a
 * rodar com pendência. Cada partida repetia idêntico.
 *
 * Estes casos montam aquele banco a partir da fila real — rodando-a até a
 * `0048` numa pasta truncada, que é o que "um banco daquele dia" quer dizer —
 * e não por DDL escrito à mão que imite o resultado.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

/** Quem cria a tabela, e quem morreu em cima dela. */
const CRIA_A_TABELA = "0048_unidade_sem_acervo";
const MORREU_EM_CIMA = "0049_unidade_canonica";
const TABELA = "remuneracao_unidade";

/** As dez colunas que a `0048` declara — a forma que o reparo tem de devolver. */
const COLUNAS_DA_0048 = [
  "autor_id",
  "autor_nome",
  "canal",
  "codigo",
  "criada_em",
  "id",
  "nome",
  "scope_hash",
  "scope_type",
  "vigencia_inicial",
];

interface Journal {
  entries: { idx: number; version: string; when: number; tag: string }[];
}

/**
 * Uma pasta de migrations que termina onde a fila daquele banco terminava.
 *
 * Truncar a fila é o que distingue "um banco que parou na 0048" de "um banco
 * de hoje com objetos apagados": no primeiro, o registro não conhece as
 * seguintes — que é exatamente o estado do Production. Fazer isso pela pasta,
 * e não por `DELETE` no registro, mantém o teste verdadeiro quando a fila
 * ganhar a `0051`.
 */
function filaAte(ate: string): string {
  const origem = MIGRATIONS_FOLDER;
  const journal = JSON.parse(
    readFileSync(path.join(origem, "meta", "_journal.json"), "utf8"),
  ) as Journal;

  const corte = journal.entries.findIndex((e) => e.tag === ate);
  expect(corte, `${ate} não está no journal`).toBeGreaterThanOrEqual(0);
  const entries = journal.entries.slice(0, corte + 1);

  const destino = mkdtempSync(path.join(tmpdir(), "fc-fila-"));
  mkdirSync(path.join(destino, "meta"), { recursive: true });
  writeFileSync(
    path.join(destino, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries) {
    copyFileSync(
      path.join(origem, `${entry.tag}.sql`),
      path.join(destino, `${entry.tag}.sql`),
    );
  }
  return destino;
}

async function comBanco(
  rotulo: string,
  corpo: (url: string) => Promise<void>,
): Promise<void> {
  const nome = `fc_${rotulo}_${process.pid}`;
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
  await admin.query(`CREATE DATABASE "${nome}"`);
  try {
    await corpo(ADMIN.replace("/postgres?", `/${nome}?`));
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await admin.end();
  }
}

async function perguntar<T extends pg.QueryResultRow>(
  url: string,
  consulta: string,
  valores: unknown[] = [],
): Promise<T[]> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    return (await pool.query<T>(consulta, valores)).rows;
  } finally {
    await pool.end();
  }
}

async function executar(url: string, ...comandos: string[]): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    for (const comando of comandos) await pool.query(comando);
  } finally {
    await pool.end();
  }
}

/** O banco daquele dia: fila até a 0048, e a tabela dela arrancada por fora. */
async function comoOProductionEstava(url: string): Promise<void> {
  const ate0048 = filaAte(CRIA_A_TABELA);
  const primeira = await runMigrations(url, ate0048);
  expect(primeira.failure).toBeUndefined();
  expect(primeira.applied).toContain(CRIA_A_TABELA);

  await executar(url, `DROP TABLE IF EXISTS "${TABELA}" CASCADE`);
}

async function existe(url: string, relacao: string): Promise<boolean> {
  const rows = await perguntar<{ existe: boolean }>(
    url,
    `select to_regclass($1) is not null as existe`,
    [`public."${relacao}"`],
  );
  return rows[0]?.existe === true;
}

async function colunasDe(url: string, tabela: string): Promise<string[]> {
  const rows = await perguntar<{ column_name: string }>(
    url,
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1
      order by column_name`,
    [tabela],
  );
  return rows.map((r) => r.column_name);
}

describe("a fila que esbarra no próprio chão", () => {
  it("sem reparo, morre em 42P01 na 0049 — o erro do Production", async () => {
    await comBanco("fila_sem_reparo", async (url) => {
      await comoOProductionEstava(url);

      const report = await runMigrations(url);

      expect(report.failure?.tag).toBe(MORREU_EM_CIMA);
      expect(report.failure?.code).toBe("42P01");
      expect(report.failure?.message).toContain(TABELA);
      /* A 0050 não chega a ser tentada — e é por isso que uma migration de
         reparo colocada depois da 0049 nunca resolveria este banco. */
      expect(report.pending[0]).toBe(MORREU_EM_CIMA);
      expect(report.pending.length).toBeGreaterThan(1);
      expect(await existe(url, "unidade")).toBe(false);
    });
  }, 300_000);

  it("com reparo, a tabela volta pela DDL da 0048 e a fila anda até o fim", async () => {
    await comBanco("fila_com_reparo", async (url) => {
      await comoOProductionEstava(url);

      const { report, reparo } = await migrarComReparo(url);

      expect(report.failure).toBeUndefined();
      expect(report.applied).toContain(MORREU_EM_CIMA);
      expect(reparo?.aplicados.map((a) => a.alvo)).toContain(`tabela ${TABELA}`);
      expect(reparo?.semComando).toEqual([]);
      expect(reparo?.falhas).toEqual([]);

      /* A tabela volta com as colunas da 0048 e ganha, pela fila, a coluna que
         a 0049 acrescenta — nesta ordem, que é a que prova que o reparo não
         montou a forma final por conta própria. */
      expect(await colunasDe(url, TABELA)).toEqual(
        [...COLUNAS_DA_0048, "unidade_id"].sort(),
      );
      const indices = await perguntar<{ indexname: string }>(
        url,
        `select indexname from pg_indexes where schemaname='public' and tablename=$1`,
        [TABELA],
      );
      expect(indices.map((i) => i.indexname)).toContain(
        "remuneracao_unidade_unica",
      );
      expect(await existe(url, "unidade")).toBe(true);
    });
  }, 300_000);

  it("o reparo repõe o que a 0048 criou e não faz o trabalho da 0049", async () => {
    await comBanco("fila_escopo", async (url) => {
      await comoOProductionEstava(url);

      const desfecho = await reconvergirRegistradas(url);

      expect(desfecho.rodou).toBe(true);
      if (!desfecho.rodou) return;
      expect(await existe(url, TABELA)).toBe(true);
      /*
        `unidade` é declarada no schema.ts e falta neste banco — e mesmo assim
        não é reposta: quem a cria é a 0049, que está pendente. Ausência de
        migration pendente é silêncio, não `semComando`; repô-la aqui seria o
        reparo criando objeto fora de ordem, com o DDL final e sem os passos
        que a migration leva junto.
      */
      expect(await existe(url, "unidade")).toBe(false);
      expect(desfecho.relatorio.semComando).toEqual([]);
      expect(desfecho.relatorio.falhas).toEqual([]);
    });
  }, 300_000);

  it("não devolve dado, e não encosta no que está de pé", async () => {
    await comBanco("fila_dados", async (url) => {
      await comoOProductionEstava(url);
      await executar(
        url,
        `INSERT INTO "fechamento_competencia"
           (chave, ano, mes, quinzena, inicio, fim, unidade_codigo, transportadora_codigo)
         VALUES ('2026-07-1', 2026, 7, 1, '2026-07-01', '2026-07-15', 'CDD Belém', '443')`,
      );

      const { report, reparo } = await migrarComReparo(url);

      expect(report.failure).toBeUndefined();
      /*
        Exatamente dois comandos, e nada além deles: a tabela e o índice único
        que morreu junto com ela. O `ON CONFLICT` da importação arbitra por
        esse índice — repor a tabela sem ele deixaria a fila verde e a
        importação morrendo em 42P10 depois.
      */
      expect(reparo?.aplicados.map((a) => a.alvo)).toEqual([
        `tabela ${TABELA}`,
        `índice remuneracao_unidade_unica`,
      ]);

      /* A linha que já estava lá continua lá, e ganhou a coluna nova vazia. */
      const linhas = await perguntar<{ chave: string; unidade_id: string | null }>(
        url,
        `select chave, unidade_id from "fechamento_competencia"`,
      );
      expect(linhas).toEqual([{ chave: "2026-07-1", unidade_id: null }]);
      /* E a tabela reposta volta vazia: o que ela guardava morreu com o DROP,
         e nada aqui finge o contrário. */
      const reposta = await perguntar<{ n: string }>(
        url,
        `select count(*)::text as n from "${TABELA}"`,
      );
      expect(reposta[0]?.n).toBe("0");
    });
  }, 300_000);

  it("repetir é seguro: a segunda passada não repara nem aplica nada", async () => {
    await comBanco("fila_repetivel", async (url) => {
      await comoOProductionEstava(url);

      expect((await migrarComReparo(url)).report.failure).toBeUndefined();
      const segunda = await migrarComReparo(url);

      expect(segunda.report.failure).toBeUndefined();
      expect(segunda.report.applied).toEqual([]);
      expect(segunda.reparo).toBeUndefined();
    });
  }, 300_000);

  it("num banco íntegro o reparo é um não-evento", async () => {
    await comBanco("fila_integra", async (url) => {
      const { report, reparo } = await migrarComReparo(url);

      expect(report.failure).toBeUndefined();
      expect(report.applied).toContain(MORREU_EM_CIMA);
      /* Nem sequer consultado: sem falha, a segunda autoridade não é chamada. */
      expect(reparo).toBeUndefined();
    });
  }, 300_000);
});
