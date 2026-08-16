import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  DICIONARIO_CANONICO,
  EscritaNaoAutorizada,
  NUCLEO_CANONICO,
  autoridadeAtual,
  comoAutoridade,
  createDb,
  escritaNaoAutorizada,
  factTable,
  tabelasProtegidasEscritas,
  type Database,
} from "../index";
import { runMigrations } from "../migrate";

/**
 * A autoridade de escrita, exercida contra um banco de verdade.
 *
 * O que esta suíte protege é a diferença entre uma regra escrita e uma regra
 * que existe. A varredura de código (`fronteira-de-ingestao.test.ts`) recusa
 * escritores não declarados **no fonte**; ela é textual, e por isso não alcança
 * uma escrita montada em tempo de execução nem uma passada por indireção. Aqui
 * a pergunta é outra e é a definitiva: com uma conexão comum — a mesma que a
 * aplicação usa em produção —, o Postgres aceita um `INSERT` em `fact`?
 *
 * **A conexão destes testes não recebe concessão nenhuma.** `createTestDatabase`
 * concede `FIXTURE_DE_TESTE` ao banco descartável que ele cria, e é por isso que
 * as outras suítes seguem escrevendo direto; aqui o banco é criado por
 * `createDb` cru, exatamente como o processo do servidor o cria. É a única
 * forma de a prova valer para produção.
 */

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_test_autoridade_${process.pid}`;

let db: Database;
let encerrar: () => Promise<void>;

/**
 * A recusa que se espera, desembrulhada.
 *
 * O drizzle envolve o erro num `DrizzleQueryError`, de modo que
 * `rejects.toThrow(EscritaNaoAutorizada)` não a reconheceria — e é justamente
 * por isso que `escritaNaoAutorizada` percorre a cadeia de `cause`. Provar por
 * aqui é provar do jeito que um `catch` do produto teria de fazer.
 */
async function recusaDe(operacao: Promise<unknown>): Promise<EscritaNaoAutorizada> {
  const resultado = await operacao.then(
    () => new Error("a escrita passou, e deveria ter sido recusada"),
    (e: unknown) => e,
  );
  const recusa = escritaNaoAutorizada(resultado);
  expect(recusa, `esperava recusa de autoridade, veio: ${String(resultado)}`).toBeDefined();
  return recusa!;
}

beforeAll(async () => {
  const admin = createDb(ADMIN_URL);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.pool.query(`CREATE DATABASE "${NOME}"`);
  await admin.pool.end();

  const url = ADMIN_URL.replace("/postgres?", `/${NOME}?`);
  await runMigrations(url);

  /* Sem `autoridadeDaConexao`: é a conexão do servidor, não a de fixture. */
  const criada = createDb(url);
  db = criada.db;
  encerrar = async () => {
    await criada.pool.end();
    const limpeza = createDb(ADMIN_URL);
    await limpeza.pool.query(`DROP DATABASE IF EXISTS "${NOME}" WITH (FORCE)`);
    await limpeza.pool.end();
  };
}, 300_000);

afterAll(async () => {
  await encerrar?.().catch(() => {});
}, 60_000);

// ---------------------------------------------------------------------------
// A leitura do statement, sem banco
// ---------------------------------------------------------------------------

describe("o que conta como escrita protegida", () => {
  it("reconhece as formas de escrita, com e sem aspas", () => {
    expect(tabelasProtegidasEscritas(`INSERT INTO fact (id) VALUES (1)`)).toEqual([
      "fact",
    ]);
    expect(tabelasProtegidasEscritas(`insert into "snapshot" default values`)).toEqual([
      "snapshot",
    ]);
    expect(tabelasProtegidasEscritas(`UPDATE "entity" SET x = 1`)).toEqual(["entity"]);
    expect(tabelasProtegidasEscritas(`DELETE FROM entity_identifier WHERE id = 1`)).toEqual(
      ["entity_identifier"],
    );
  });

  it("não confunde `SELECT … FOR UPDATE` com escrita", () => {
    // O falso positivo clássico: a palavra UPDATE aparece, e o statement é um
    // bloqueio de leitura. Se ele fosse recusado, toda leitura concorrente do
    // pipeline morreria — e morreria com uma mensagem sobre arquitetura.
    expect(
      tabelasProtegidasEscritas(`SELECT * FROM snapshot WHERE id = $1 FOR UPDATE`),
    ).toEqual([]);
  });

  it("não confunde `ON CONFLICT DO UPDATE` com uma segunda tabela", () => {
    const upsert = `INSERT INTO scope (id) VALUES ($1) ON CONFLICT DO UPDATE SET id = $1`;
    expect(tabelasProtegidasEscritas(upsert)).toEqual(["scope"]);
  });

  it("deixa passar leitura, DDL e tabela não protegida", () => {
    expect(tabelasProtegidasEscritas(`SELECT count(*) FROM fact`)).toEqual([]);
    expect(tabelasProtegidasEscritas(`CREATE TABLE fact (id int)`)).toEqual([]);
    // `import_run`, `change`, `ticket`, `coverage_expectation`: nenhuma é o grão
    // nem a identidade dele, e todas seguem livres.
    expect(tabelasProtegidasEscritas(`UPDATE import_run SET status = 'FAILED'`)).toEqual(
      [],
    );
    expect(tabelasProtegidasEscritas(`INSERT INTO ticket (id) VALUES (1)`)).toEqual([]);
  });

  it("enxerga as duas escritas de uma CTE", () => {
    const cte = `WITH apagados AS (DELETE FROM fact WHERE snapshot_id = $1 RETURNING *)
                 INSERT INTO snapshot_merge (id) SELECT id FROM apagados`;
    expect(tabelasProtegidasEscritas(cte).sort()).toEqual(["fact", "snapshot_merge"]);
  });

  it("o núcleo e o dicionário estão ambos protegidos, e são o que a auditoria declarou", () => {
    expect([...NUCLEO_CANONICO].sort()).toEqual([
      "entity",
      "entity_identifier",
      "fact",
      "scope",
      "snapshot",
      "snapshot_attribute",
      "snapshot_entity_type",
      "snapshot_merge",
      "snapshot_scope",
    ]);
    expect([...DICIONARIO_CANONICO].sort()).toEqual([
      "attribute",
      "attribute_alias",
      "taxonomy_node",
    ]);
  });
});

// ---------------------------------------------------------------------------
// O bloqueio, contra o banco
// ---------------------------------------------------------------------------

describe("sem autoridade, o núcleo canônico recusa a escrita", () => {
  it("recusa um INSERT em `fact` pelo drizzle", async () => {
    const recusa = await recusaDe(
      db.insert(factTable).values({
        snapshotId: "00000000-0000-0000-0000-000000000000",
        entityId: "00000000-0000-0000-0000-000000000000",
        attributeId: "00000000-0000-0000-0000-000000000000",
        valueHash: "x",
        rawCellId: 1,
      }),
    );
    expect(recusa.tabela).toBe("fact");
  });

  it("recusa SQL cru, que é por onde uma indireção passaria", async () => {
    // A varredura de código não segue uma string montada em runtime. Esta
    // camada não precisa segui-la: ela lê o statement.
    const tabela = ["f", "a", "c", "t"].join("");
    const recusa = await recusaDe(
      db.execute(sql.raw(`INSERT INTO ${tabela} (value_hash) VALUES ('x')`)),
    );
    expect(recusa.tabela).toBe("fact");
  });

  it("recusa dentro de uma transação — que é por onde a promoção escreve tudo", async () => {
    // Guardar só o pool teria deixado passar exatamente este caminho: numa
    // transação o drizzle escreve por um `PoolClient`, e não pelo pool.
    const recusa = await recusaDe(
      db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM fact WHERE id = -1`);
      }),
    );
    expect(recusa.tabela).toBe("fact");
  });

  it("a recusa diz a tabela, a autoridade em vigor e o que seria aceito", async () => {
    const recusa = await recusaDe(
      db.execute(sql`DELETE FROM entity WHERE id = '00000000-0000-0000-0000-000000000000'`),
    );
    expect(recusa.tabela).toBe("entity");
    expect(recusa.autoridade).toBeUndefined();
    expect(recusa.message).toContain("INGESTAO");
  });

  it("leitura nunca é bloqueada", async () => {
    const { rows } = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM fact`,
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A concessão
// ---------------------------------------------------------------------------

describe("com autoridade, a escrita passa — e só a que aquela autoridade tem", () => {
  it("`INGESTAO` alcança o núcleo canônico", async () => {
    await comoAutoridade("INGESTAO", async () => {
      // Chega ao Postgres: a recusa que vem agora é do banco (nenhuma linha com
      // este id), não da arquitetura.
      await db.execute(sql`DELETE FROM fact WHERE id = -1`);
    });
  });

  it("`CURADORIA` alcança o dicionário", async () => {
    await comoAutoridade("CURADORIA", async () => {
      await db.execute(sql`UPDATE attribute SET display_name = display_name WHERE false`);
    });
  });

  it("`CURADORIA` **não** alcança o núcleo canônico", async () => {
    // O ponto do desenho: quem decide o significado de uma coluna não pode
    // criar nem apagar um fato. Uma autoridade só seria uma chave mestra.
    const recusa = await recusaDe(
      comoAutoridade("CURADORIA", async () => {
        await db.execute(sql`DELETE FROM fact WHERE id = -1`);
      }),
    );
    expect(recusa.autoridade).toBe("CURADORIA");
  });

  it("a autoridade não vaza para fora do escopo", async () => {
    await comoAutoridade("INGESTAO", async () => {
      expect(autoridadeAtual()).toBe("INGESTAO");
    });
    expect(autoridadeAtual()).toBeUndefined();
    await recusaDe(db.execute(sql`DELETE FROM fact WHERE id = -1`));
  });

  it("a autoridade atravessa `await` e transação, que é o caso real da promoção", async () => {
    await comoAutoridade("INGESTAO", async () => {
      await new Promise((r) => setTimeout(r, 1));
      await db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM fact WHERE id = -1`);
        await new Promise((r) => setTimeout(r, 1));
        await tx.execute(sql`DELETE FROM entity WHERE id = '00000000-0000-0000-0000-000000000000'`);
      });
    });
  });

  it("duas operações concorrentes não emprestam autoridade uma à outra", async () => {
    // `AsyncLocalStorage` e não uma variável de módulo: com mais de uma
    // requisição em voo, uma global daria a autoridade da importação a quem
    // estivesse passando por perto.
    const comAutoridade = comoAutoridade("INGESTAO", async () => {
      await new Promise((r) => setTimeout(r, 20));
      await db.execute(sql`DELETE FROM fact WHERE id = -1`);
      return "passou";
    });
    const semAutoridade = (async () => {
      await new Promise((r) => setTimeout(r, 5));
      return db
        .execute(sql`DELETE FROM fact WHERE id = -1`)
        .then(() => "passou")
        .catch((e: unknown) =>
          escritaNaoAutorizada(e) ? "recusado" : "outro erro",
        );
    })();

    expect(await Promise.all([comAutoridade, semAutoridade])).toEqual([
      "passou",
      "recusado",
    ]);
  });
});
