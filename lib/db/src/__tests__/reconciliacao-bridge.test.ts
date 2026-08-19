/**
 * O buraco entre o bridge e a fila de migrations, travado nos três pontos.
 *
 * ---------------------------------------------------------------------------
 * O estado que estes testes existem para impedir
 * ---------------------------------------------------------------------------
 * `bridgeDown` remove objetos que as migrations criam e **não toca no
 * registro** — está escrito em `bridge.ts` por quê. `runMigrations` pula toda
 * migration cujo `when` já está no registro. Some-se: depois de um `down`, só o
 * `up` devolve aqueles objetos; a fila estruturalmente não consegue. Um `up`
 * que não rode deixa o banco divergente para sempre, com `migrate` respondendo
 * "nada a aplicar" e `/healthz` respondendo SAUDAVEL.
 *
 * Foi o estado de 16/08/2026: `attribute.definition` ausente, `0022` registrada,
 * 23 de 23, e a fila de curadoria — única leitora daquela coluna — em 500.
 *
 * ---------------------------------------------------------------------------
 * O que cada bloco prova
 * ---------------------------------------------------------------------------
 * **A.** Banco novo termina sem divergência nenhuma contra o schema declarado.
 *   É a prova de que migrations e `schema/` não se separaram — e o teste que
 *   acusaria qualquer outro drift, não só o desta vez.
 * **B.** Um banco que passou pela `0022` e perdeu as colunas volta sozinho, só
 *   rodando `migrate`. É o reparo durável, e roda igual em DEV, produção e
 *   banco de teste porque é a mesma fila.
 * **C.** A lista do bridge não cresce em silêncio: toda entrada tem de estar
 *   reconciliada pela `0023` ou declarada como fora do alcance dela, com o
 *   motivo. Nunca esquecida no meio — que é como esta se perdeu.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runMigrations, readMigrations } from "../migrate";
import {
  COLUNAS_REMOVIDAS,
  INDICES_REMOVIDOS,
  bridgeDown,
  bridgeUp,
} from "../bridge";
import { bridgePendente } from "../bridge-marcador";
import { compararSchema, tabelasDeclaradas } from "../conferir-schema";

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const urlDe = (nome: string) => ADMIN.replace("/postgres?", `/${nome}?`);

let sequencia = 0;
const criados: string[] = [];

async function comAdmin<T>(fn: (p: pg.Pool) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: ADMIN });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function bancoNovo(): Promise<{ url: string; pool: pg.Pool }> {
  const nome = `fc_reconc_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const url = urlDe(nome);
  return { url, pool: new pg.Pool({ connectionString: url }) };
}

const abertos: pg.Pool[] = [];

afterAll(async () => {
  for (const p of abertos) await p.end().catch(() => {});
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a.query(`DROP DATABASE IF EXISTS "${nome}"`).catch(() => {});
    }
  });
});

/** O que o banco tem de verdade, no formato que `compararSchema` compara. */
async function colunasReais(pool: pg.Pool): Promise<Map<string, Set<string>>> {
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public'`,
  );
  const reais = new Map<string, Set<string>>();
  for (const l of rows) {
    if (!reais.has(l.table_name)) reais.set(l.table_name, new Set());
    reais.get(l.table_name)!.add(l.column_name);
  }
  return reais;
}

async function temColuna(
  pool: pg.Pool,
  tabela: string,
  coluna: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ existe: boolean }>(
    `select exists (
       select 1 from information_schema.columns
        where table_schema='public' and table_name=$1 and column_name=$2
     ) as existe`,
    [tabela, coluna],
  );
  return rows[0]!.existe;
}

/**
 * As migrations de reconciliação — **todas**, e não uma tag fixa.
 *
 * A `0024` foi a primeira, e a regra que ela estabeleceu é mais forte do que o
 * nome dela: *depois de um `bridge:down` sem `up`, quem devolve o objeto é uma
 * migration que o registro ainda não contém*. Isso obriga a reconciliação a
 * estar sempre **no fim da fila**, e faz de toda coluna criada depois dela um
 * buraco novo.
 *
 * Foi o que aconteceu com a `0026_direcao_economica`: quatro colunas que o
 * `down` remove, criadas depois da reconciliação, e portanto irrecuperáveis
 * pela fila. A `0027` as repõe.
 *
 * Fixar a tag faria este teste medir uma migration em vez de medir a regra —
 * e a terceira reconciliação, quando fizer falta, passaria despercebida
 * exatamente como esta passou. A união é o que mantém o caso vivo.
 */
const TAGS_DE_RECONCILIACAO = /_reconciliar_/;

// ---------------------------------------------------------------------------
// A — banco novo, zero divergência
// ---------------------------------------------------------------------------

describe("A. o banco que a fila constrói do zero", () => {
  let banco: { url: string; pool: pg.Pool };

  beforeAll(async () => {
    banco = await bancoNovo();
    abertos.push(banco.pool);
    const r = await runMigrations(banco.url);
    expect(r.failure).toBeUndefined();
  }, 120_000);

  it("aplica a reconciliação junto com o resto da fila", () => {
    expect(
      readMigrations().filter((m) => TAGS_DE_RECONCILIACAO.test(m.tag)).map((m) => m.tag),
      "sem nenhuma migration de reconciliação, um `down` sem `up` é definitivo",
    ).not.toEqual([]);
  });

  it("não tem divergência nenhuma contra o schema declarado", async () => {
    const d = compararSchema(tabelasDeclaradas(), await colunasReais(banco.pool));

    /*
      Falha aqui significa que `schema/` e as migrations se separaram — a mesma
      classe de defeito desta vez, achada antes de chegar a um banco de verdade.
      A mensagem nomeia o que falta para não obrigar ninguém a ir ao psql.
    */
    expect(
      d.colunasAusentes.map((c) => `${c.tabela}.${c.coluna}`),
      "colunas declaradas que a fila não cria",
    ).toEqual([]);
    expect(d.tabelasAusentes, "tabelas declaradas que a fila não cria").toEqual([]);
  });

  it("a reconciliação é no-op num banco saudável — roda duas vezes sem mudar nada", async () => {
    const antes = await colunasReais(banco.pool);
    for (const m of readMigrations()) {
      if (!TAGS_DE_RECONCILIACAO.test(m.tag)) continue;
      for (const comando of m.statements) await banco.pool.query(comando);
    }
    const depois = await colunasReais(banco.pool);

    expect(depois.get("attribute")!.size).toBe(antes.get("attribute")!.size);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// B — o caso vivido: um banco que passou pela 0022 e perdeu a coluna
// ---------------------------------------------------------------------------

describe("B. o banco divergente volta sozinho, só rodando migrate", () => {
  let banco: { url: string; pool: pg.Pool };

  beforeAll(async () => {
    banco = await bancoNovo();
    abertos.push(banco.pool);
    expect((await runMigrations(banco.url)).failure).toBeUndefined();

    /*
      O estado exato de 16/08/2026, montado em dois passos:

      1. o `down` derruba as colunas — aqui pelo DDL direto, para o teste medir
         a reconciliação e não o bridge, que tem os seus próprios testes;
      2. o registro da `0023` sai, que é o que faz deste um banco que passou
         pela `0022` e nunca viu o reparo. Sem este passo o teste provaria
         apenas que a fila roda uma vez.
    */
    for (const [tabela, coluna] of COLUNAS_REMOVIDAS) {
      if (tabela === "snapshot" && coluna === "canonical_snapshot_key") continue;
      await banco.pool.query(
        `ALTER TABLE "${tabela}" DROP COLUMN IF EXISTS "${coluna}" CASCADE`,
      );
    }
    /*
      A tabela da `0028` sai junto, e ela não é coluna: o `down` a remove, e é
      dela que pendem as duas chaves estrangeiras das colunas derrubadas acima.
      Sem removê-la, o bloco mediria uma reconciliação pela metade.
    */
    await banco.pool.query(`DROP TABLE IF EXISTS "semantic_meaning" CASCADE`);
    /*
      Todas as reconciliações são desmarcadas, e não só a primeira: o cenário
      que este bloco monta é "o down levou as colunas e o up não rodou", e a
      reposição está repartida entre elas — a `0024` cobre o que existia até
      ela, a `0027` cobre o que veio depois.
    */
    for (const m of readMigrations().filter((m) => TAGS_DE_RECONCILIACAO.test(m.tag))) {
      await banco.pool.query(
        `DELETE FROM "drizzle"."__drizzle_migrations" WHERE created_at = $1`,
        [m.when],
      );
    }
  }, 120_000);

  it("parte do estado divergente: a coluna da 0022 não está lá", async () => {
    expect(await temColuna(banco.pool, "attribute", "definition")).toBe(false);
  });

  it("o registro continua dando a 0022 por aplicada — é por isso que ninguém vê", async () => {
    const zeroVinteDois = readMigrations().find(
      (m) => m.tag === "0022_significado",
    )!;
    const { rows } = await banco.pool.query(
      `SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE created_at = $1`,
      [zeroVinteDois.when],
    );
    expect(rows).toHaveLength(1);
  });

  it("um `migrate` repõe a coluna que a fila de curadoria lê", async () => {
    const r = await runMigrations(banco.url);

    expect(r.failure).toBeUndefined();
    expect(r.applied.some((t) => TAGS_DE_RECONCILIACAO.test(t))).toBe(true);
    expect(await temColuna(banco.pool, "attribute", "definition")).toBe(true);
    expect(await temColuna(banco.pool, "attribute_semantics", "definition")).toBe(
      true,
    );
  }, 60_000);

  it("repõe todas as colunas que estão ao alcance dela, e não só a que doeu", async () => {
    for (const [tabela, coluna] of COLUNAS_REMOVIDAS) {
      if (tabela === "snapshot" && coluna === "canonical_snapshot_key") continue;
      expect(
        await temColuna(banco.pool, tabela, coluna),
        `${tabela}.${coluna} não voltou`,
      ).toBe(true);
    }
  }, 60_000);

  it("termina sem divergência — o mesmo schema do banco novo", async () => {
    const d = compararSchema(tabelasDeclaradas(), await colunasReais(banco.pool));

    expect(d.colunasAusentes.map((c) => `${c.tabela}.${c.coluna}`)).toEqual([]);
    expect(d.tabelasAusentes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C — a lista do bridge não cresce em silêncio
// ---------------------------------------------------------------------------

/**
 * A família da identidade canônica, declarada fora do alcance da `0023`.
 *
 * `canonical_snapshot_key` é `GENERATED ALWAYS AS (freightcheck_snapshot_key(…))
 * STORED` sobre funções que o próprio `down` remove, e a `0015` que a cria
 * confere geração, tipo e expressão antes de aceitar o que encontrar. Repô-la
 * com um `IF NOT EXISTS` mais fraco trocaria uma coluna ausente por uma coluna
 * presente e errada. Os três índices pendem dela.
 *
 * Estar nesta lista é uma decisão escrita, não um esquecimento — e é isso que o
 * teste abaixo exige de toda entrada nova.
 */
const FORA_DO_ALCANCE_COLUNAS = new Set(["snapshot.canonical_snapshot_key"]);
const FORA_DO_ALCANCE_INDICES = new Set([
  "snapshot_canonical_live_uq",
  "snapshot_canonical_revision_uq",
  "snapshot_canonical_key_idx",
]);

describe("C. toda entrada do bridge está de um dos dois lados da fronteira", () => {
  const sqlDaReconciliacao = readMigrations()
    .filter((m) => TAGS_DE_RECONCILIACAO.test(m.tag))
    .flatMap((m) => m.statements)
    .join("\n");

  it("toda coluna que o `down` remove é reconciliada ou declarada fora do alcance", () => {
    for (const [tabela, coluna] of COLUNAS_REMOVIDAS) {
      const chave = `${tabela}.${coluna}`;
      if (FORA_DO_ALCANCE_COLUNAS.has(chave)) continue;
      expect(
        new RegExp(
          `ALTER TABLE "${tabela}" ADD COLUMN IF NOT EXISTS "${coluna}"`,
          "i",
        ).test(sqlDaReconciliacao),
        `${chave} sai no bridge:down e nenhuma migration de reconciliação a repõe. ` +
          `Depois de um down sem up, nada mais devolve esta coluna: o registro ` +
          `já dá por aplicada a migration que a cria. A reconciliação tem de ser a ` +
          `última da fila, então uma coluna criada depois dela precisa de uma ` +
          `reconciliação nova — ou de estar em FORA_DO_ALCANCE_COLUNAS com o motivo.`,
      ).toBe(true);
    }
  });

  it("todo índice que o `down` remove é reconciliado ou declarado fora do alcance", () => {
    for (const indice of INDICES_REMOVIDOS) {
      if (FORA_DO_ALCANCE_INDICES.has(indice)) continue;
      expect(
        // `UNIQUE` opcional: a unicidade não muda a pergunta que esta prova
        // faz — "existe reconciliação para o que o `down` tira?" —, e o
        // primeiro índice único a sair no `down` (`import_run_leitura_aberta_uq`,
        // da `0040`) passava despercebido por um regex que só via o plural
        // comum.
        new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "${indice}"`, "i").test(
          sqlDaReconciliacao,
        ),
        `o índice ${indice} sai no bridge:down e nenhuma reconciliação o recria. ` +
          `Reconcilie-o, ou declare-o em FORA_DO_ALCANCE_INDICES.`,
      ).toBe(true);
    }
  });

  it("a lista de exceções não guarda item que saiu do bridge", () => {
    // Uma exceção órfã é uma decisão que ninguém revisita — e o próximo a ler
    // a lista acha que ela ainda vale.
    const colunas = new Set(COLUNAS_REMOVIDAS.map(([t, c]) => `${t}.${c}`));
    for (const chave of FORA_DO_ALCANCE_COLUNAS) {
      expect(colunas.has(chave), `${chave} não sai mais no down`).toBe(true);
    }
    for (const indice of FORA_DO_ALCANCE_INDICES) {
      expect(
        INDICES_REMOVIDOS.includes(indice),
        `${indice} não sai mais no down`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// D — o marcador: um bridge pela metade deixa de ser invisível
// ---------------------------------------------------------------------------

/**
 * A `0023` conserta os bancos que já estão divergentes, e conserta uma vez: ela
 * entra no registro, e o próximo `down` sem `up` volta a ser irrecuperável pela
 * fila. O que fecha isso para o futuro não é outra migration — é o banco saber
 * que está no meio de um bridge.
 *
 * Sem o marcador, um bridge pela metade é indistinguível de um banco saudável
 * por qualquer coisa que se pergunte de fora, e a primeira notícia é uma tela
 * em 500 — em 16/08/2026, semanas depois.
 */
describe("D. o bridge declara que desceu, e só o up limpa", () => {
  it("um banco que nunca viu bridge responde 'sem pendência' sem quebrar", async () => {
    // A tabela do marcador não existe aqui. Perguntar por ela não pode
    // levantar erro: quem pergunta é o /healthz, a rota que existe para dizer
    // se o banco está de pé.
    const banco = await bancoNovo();
    abertos.push(banco.pool);
    expect((await runMigrations(banco.url)).failure).toBeUndefined();

    const estado = await bridgePendente(async (texto) => {
      const r = await banco.pool.query(texto);
      return { rows: r.rows as Record<string, unknown>[] };
    });

    expect(estado.pendente).toBe(false);
  }, 120_000);

  it("o down deixa o marcador, o up o limpa, e migrate não mexe nele", async () => {
    const banco = await bancoNovo();
    abertos.push(banco.pool);
    expect((await runMigrations(banco.url)).failure).toBeUndefined();

    const ler = () =>
      bridgePendente(async (texto) => {
        const r = await banco.pool.query(texto);
        return { rows: r.rows as Record<string, unknown>[] };
      });

    const descida = await bridgeDown(banco.url);
    expect(descida.falha).toBeUndefined();

    const depoisDoDown = await ler();
    expect(depoisDoDown.pendente).toBe(true);
    expect(depoisDoDown.desde).toBeDefined();

    /*
      O passo que prova o ponto: no deploy real, `migrate` roda entre o `down` e
      o `up`. Se ele limpasse o marcador, o estado voltaria a ser invisível
      justamente na janela em que ele importa.
    */
    expect((await runMigrations(banco.url)).failure).toBeUndefined();
    expect((await ler()).pendente).toBe(true);

    const subida = await bridgeUp(banco.url);
    expect(subida.falha).toBeUndefined();
    expect((await ler()).pendente).toBe(false);
  }, 300_000);

  it("um down que aborta não deixa marcador — ele entra com a transação", async () => {
    // `dryRun` percorre tudo e dá ROLLBACK. O marcador é escrito dentro da
    // mesma transação, então some junto: um ensaio não pode deixar o banco
    // dizendo que está no meio de um bridge.
    const banco = await bancoNovo();
    abertos.push(banco.pool);
    expect((await runMigrations(banco.url)).failure).toBeUndefined();

    const ensaio = await bridgeDown(banco.url, { dryRun: true });
    expect(ensaio.falha).toBeUndefined();
    expect(ensaio.dryRun).toBe(true);

    const estado = await bridgePendente(async (texto) => {
      const r = await banco.pool.query(texto);
      return { rows: r.rows as Record<string, unknown>[] };
    });
    expect(estado.pendente).toBe(false);
  }, 300_000);
});
