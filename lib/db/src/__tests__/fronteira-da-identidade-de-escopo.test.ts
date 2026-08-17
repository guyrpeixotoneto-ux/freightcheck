import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations } from "../migrate";

/**
 * A fronteira da identidade de escopo — uma chave, e não duas.
 *
 * O contrato que este arquivo transforma em máquina:
 *
 *   > O escopo de uma vigência tem **uma** identidade: o `canonical_scope`
 *   > normalizado pelo banco, cuja chave se lê por `chaveDeEscopoSql`. Não
 *   > existe `snapshot.scope_hash`, e nada aceita a grafia antiga.
 *
 * A `0022` derrubou a coluna e a aceitação. Enquanto as duas existiram, "qual é
 * o escopo desta vigência?" teve duas respostas certas — e uma pergunta com
 * duas respostas certas é exatamente como um módulo volta a discordar dos
 * outros sobre o que existe, que é o defeito que esta auditoria inteira
 * desfez.
 *
 * ---------------------------------------------------------------------------
 * Por que a prova é em três alturas, e por que a do banco não é a óbvia
 * ---------------------------------------------------------------------------
 *
 * 1. **A coluna.** Ela não existe no schema de um banco migrado. É a altura
 *    trivial, e é a que menos protege: quem a recriasse teria de escrever uma
 *    migration, que é revisada.
 *
 * 2. **O corpo das funções.** Esta é a altura que nasceu de um erro real.
 *    O levantamento que precedeu a remoção varreu TypeScript e concluiu que
 *    havia um leitor da coluna. Ele não varreu PL/pgSQL — e duas funções do
 *    próprio banco a citavam. `DROP COLUMN ... RESTRICT` não avisa: o Postgres
 *    não rastreia dependência de coluna dentro de corpo de função. A coluna
 *    caiu limpa, e o erro apareceu depois, em runtime, como
 *    `record "new" has no field "scope_hash"` — vindo do gatilho que roda em
 *    **todo** UPDATE de vigência, isto é, em toda promoção de revisão nova.
 *
 *    Uma varredura de fonte não teria pego isso, porque o corpo das funções
 *    mora no SQL das migrations e o que vale é o que está **instalado**. Por
 *    isso esta altura pergunta ao `pg_proc`, num banco de verdade.
 *
 * 3. **A aceitação.** Nenhum código de produção volta a mencionar a coluna, e
 *    `resolveContext` compara contra uma chave só.
 *
 * As três vêm com caso de controle, porque uma asserção de ausência que não
 * sabe encontrar presença não prova nada.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const RAIZ = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

const NOME = `fc_fronteira_escopo_${process.pid}`;
let pool: pg.Pool;

beforeAll(async () => {
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.query(`CREATE DATABASE "${NOME}"`);
  await admin.end();

  const url = ADMIN.replace("/postgres?", `/${NOME}?`);
  const relatorio = await runMigrations(url);
  expect(relatorio.failure, JSON.stringify(relatorio.failure)).toBeUndefined();
  pool = new pg.Pool({ connectionString: url });
}, 600_000);

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

// ---------------------------------------------------------------------------
// Altura 1 — a coluna
// ---------------------------------------------------------------------------

describe("altura 1 — a coluna não existe", () => {
  it("`snapshot` não tem `scope_hash`, e tem o que a substituiu", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'snapshot'`,
    );
    const colunas = rows.map((r) => r.column_name);

    // O controle: a varredura enxerga colunas de verdade.
    expect(colunas).toContain("canonical_scope");
    expect(colunas).toContain("canonical_snapshot_key");

    expect(colunas).not.toContain("scope_hash");
  }, 300_000);

  it("nenhum índice do schema é construído sobre ela", async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    );
    expect(rows.length).toBeGreaterThan(20); // controle
    expect(rows.filter((r) => r.indexdef.includes("scope_hash"))).toEqual([]);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Altura 2 — o corpo das funções instaladas
// ---------------------------------------------------------------------------

describe("altura 2 — nenhuma função instalada cita a coluna", () => {
  it("`pg_proc` não tem `scope_hash` em corpo nenhum", async () => {
    const { rows } = await pool.query<{ nome: string }>(
      `SELECT p.proname AS nome
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.prosrc ILIKE '%scope_hash%'`,
    );
    expect(
      rows.map((r) => r.nome).sort(),
      "função instalada citando uma coluna que não existe — ela só falha em runtime",
    ).toEqual([]);
  }, 300_000);

  it("o controle: a varredura de corpos de fato encontra o que existe", async () => {
    /*
      Sem isto, a asserção acima passaria num banco sem função nenhuma — que é
      precisamente o modo como esta altura poderia deixar de proteger sem que
      ninguém percebesse.
    */
    const { rows } = await pool.query<{ nome: string }>(
      `SELECT p.proname AS nome
         FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.prosrc ILIKE '%canonical_scope%'`,
    );
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((r) => r.nome)).toContain("freightcheck_snapshot_key");
  }, 300_000);

  it("a guarda de imutabilidade continua guardando — e sem a coluna", async () => {
    /*
      A remoção não podia afrouxar o gatilho, e é fácil afrouxá-lo por engano:
      apagar a linha errada da lista de colunas comparadas transforma "só a
      transição de status é permitida" em "quase tudo é permitido".
    */
    const { rows } = await pool.query<{ src: string }>(
      `SELECT p.prosrc AS src FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname = 'freightcheck_snapshot_is_immutable'`,
    );
    expect(rows).toHaveLength(1);
    const corpo = rows[0]!.src;
    for (const coluna of [
      "source_file_id",
      "import_run_id",
      "source_system",
      "source_label",
      "effective_date",
      "entity_type_set",
      "revision",
      "entity_count",
      "fact_count",
    ]) {
      expect(corpo, `a guarda parou de comparar ${coluna}`).toContain(
        `NEW.${coluna}`,
      );
    }
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Altura 3 — a aceitação, no código
// ---------------------------------------------------------------------------

/**
 * A fonte sem os comentários.
 *
 * A história desta coluna está escrita em dezenas de comentários deste
 * repositório, e é para ficar: quem ler `predicados.ts` ou `series.ts` daqui a
 * um ano precisa saber por que a chave é a que é. O que não pode voltar é
 * código.
 */
function semComentarios(fonte: string): string {
  /*
    Os três tipos que este repositório usa, e nenhum deles dá para ignorar.

    O bloco `/* … *\/` precisa sair **inteiro**, e não linha a linha: a prosa
    deste projeto escreve parágrafos dentro dele, e as linhas de continuação
    começam com palavra. Filtrar por prefixo acusaria oito arquivos que só
    contam a história da coluna — que é exatamente o que se quer preservar.

    O `--` sai porque há SQL em template literal, comentado como SQL.
  */
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((linha) => linha.replace(/--.*$/, ""))
    .filter((linha) => !linha.trimStart().startsWith("//"))
    .join("\n");
}

function fontesDeProducao(): string[] {
  const saida: string[] = [];
  const descer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const caminho = path.join(dir, entrada);
      if (statSync(caminho).isDirectory()) {
        if (["__tests__", "node_modules", "dist"].includes(entrada)) continue;
        descer(caminho);
        continue;
      }
      if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) saida.push(caminho);
    }
  };
  for (const grupo of ["lib", "artifacts"]) {
    for (const pacote of readdirSync(path.join(RAIZ, grupo))) {
      const src = path.join(RAIZ, grupo, pacote, "src");
      try {
        if (statSync(src).isDirectory()) descer(src);
      } catch {
        /* pacote sem src */
      }
    }
  }
  descer(path.join(RAIZ, "scripts/src"));
  return saida;
}

/**
 * O único arquivo de produção que pode escrever `scope_hash`, e por quê.
 *
 * `bridge.ts` reconstrói o schema de Production, que é anterior à `0022` e
 * portanto **tem** a coluna: sem ela, os dois índices legados que o bridge
 * recria não podem existir e o deploy cai. Ele a restaura no `down` e a derruba
 * no `up`, nominalmente, do mesmo jeito que faz com as nove colunas de
 * `ticket`. Não é uso: é remontagem declarada de um estado histórico.
 */
const RECONSTRUTOR = "lib/db/src/bridge.ts";

describe("altura 3 — nenhum código de produção volta a usá-la", () => {
  it("só o reconstrutor do bridge escreve `scope_hash`", () => {
    const culpados = fontesDeProducao()
      .filter((arquivo) => semComentarios(readFileSync(arquivo, "utf8")).includes("scope_hash"))
      .map((arquivo) => path.relative(RAIZ, arquivo))
      .sort();

    expect(culpados).toEqual([RECONSTRUTOR]);
  });

  it("o controle: a varredura de fato encontra a menção que existe", () => {
    // Se o padrão parasse de casar, o teste acima passaria por não achar nada.
    const bridge = semComentarios(readFileSync(path.join(RAIZ, RECONSTRUTOR), "utf8"));
    expect(bridge).toContain("scope_hash");
  });

  it("`ContextInfo` não volta a carregar uma lista de grafias legadas", () => {
    const todas = fontesDeProducao()
      .filter((arquivo) => readFileSync(arquivo, "utf8").includes("scopeHashesLegados"))
      .map((arquivo) => path.relative(RAIZ, arquivo));
    expect(todas).toEqual([]);
  });

  it("a condição de escopo de `resolveContext` continua sendo esta linha", () => {
    /*
      Um gatilho de forma, e é honesto dizer que é só isso.

      Esta asserção **não** prova semântica: ela fixa o texto exato da condição
      que compara o escopo. Qualquer edição naquela linha — acrescentar um
      `||`, trocar por uma função, guardar o pedido numa variável antes — faz
      esta prova cair e obriga quem editou a passar por aqui e ler por que a
      linha é assim. É a única coisa que uma varredura de fonte consegue fazer
      contra uma volta escrita de um jeito que ninguém previu; tentei contar
      comparações e uma reintrodução plausível passou reto.

      Quem prova o **comportamento** é `propagacao-divergencias.test.ts`, com
      duas grafias reais do mesmo CNPJ importadas pelo pipeline: lá o hash
      antigo recebe `ContextNotFoundError`, e a chave canônica resolve.
    */
    const series = readFileSync(
      path.join(RAIZ, "lib/comparison/src/series.ts"),
      "utf8",
    );
    const corpo = semComentarios(
      series.slice(series.indexOf("export async function resolveContext")),
    );
    const ateOFim = corpo.slice(0, corpo.indexOf("\n}"));

    const CONDICAO = "(!wantsScope || c.scopeHash === requested!.scopeHash) &&";
    expect(
      ateOFim.includes(CONDICAO),
      `a condição de escopo de resolveContext mudou de forma. Se a mudança for ` +
        `legítima, atualize esta linha; se for a volta da grafia antiga, não é.`,
    ).toBe(true);

    /*
      E `wantsScope` aparece três vezes e não quatro: a declaração, o atalho de
      "sem pedido nenhum" e a condição. Uma quarta é uma segunda condição sobre
      o escopo, que é a forma que a aceitação tinha.
    */
    expect([...ateOFim.matchAll(/wantsScope/g)]).toHaveLength(3);
  });
});
