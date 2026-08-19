import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { readMigrations, runMigrations } from "../migrate";
import { bridgeDown, bridgeUp } from "../bridge";
import { reconvergirSchema } from "../reconvergencia";
import { diffDoPublishing } from "./diff-do-publishing";

/**
 * A `0037` como problema de migration/deploy — os cenários que um Publish real
 * atravessa, cada um contra Postgres de verdade.
 *
 * A pergunta que este arquivo responde não é "a coluna existe?": é **"todo
 * caminho pelo qual um banco chega ao estado da 0037 chega ao MESMO estado"**
 * — fila do zero, fila sobre banco pré-0037 com gente dentro, bridge
 * down→deploy→up, reconvergência pós-mutilação, e a segunda passada de
 * qualquer um deles. Estados iguais por fora e diferentes por dentro é
 * exatamente a classe de defeito que a reconvergência teve aqui: a coluna
 * voltava nullable e sem default, silenciosamente diferente da original.
 */

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

const poolsAbertos: pg.Pool[] = [];

async function bancoNovo(): Promise<{ url: string; pool: pg.Pool }> {
  const nome = `fc_papeis_${process.pid}_${++sequencia}`;
  await comAdmin(async (a) => {
    await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    await a.query(`CREATE DATABASE "${nome}"`);
  });
  criados.push(nome);
  const pool = new pg.Pool({ connectionString: urlDe(nome) });
  poolsAbertos.push(pool);
  return { url: urlDe(nome), pool };
}

/**
 * A fila até `ate` (inclusive), COM registro — o estado de uma Production real
 * parada ali: schema e carimbos coerentes, para que `runMigrations` aplique
 * exatamente o que falta, como faria na partida do deploy.
 */
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

async function criarUsuario(
  pool: pg.Pool,
  email: string,
  role?: string,
): Promise<void> {
  await pool.query(
    role
      ? `INSERT INTO "app_user" ("name","email","password_hash","role") VALUES ($1,$1,'scrypt$x',$2)`
      : `INSERT INTO "app_user" ("name","email","password_hash") VALUES ($1,$1,'scrypt$x')`,
    role ? [email, role] : [email],
  );
}

async function papeis(pool: pg.Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ email: string; role: string }>(
    `SELECT email, role FROM "app_user" ORDER BY email`,
  );
  return Object.fromEntries(rows.map((r) => [r.email, r.role]));
}

/** A forma da coluna e do CHECK, como o catálogo os descreve. */
async function formaDoPapel(pool: pg.Pool): Promise<{ coluna: string; check: string }> {
  const { rows: col } = await pool.query<{ v: string }>(
    `SELECT data_type||'|'||is_nullable||'|'||coalesce(column_default,'-') AS v
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name='app_user' AND column_name='role'`,
  );
  const { rows: ck } = await pool.query<{ v: string }>(
    `SELECT pg_get_constraintdef(oid) AS v FROM pg_constraint
      WHERE conname='app_user_role_ck' AND connamespace='public'::regnamespace`,
  );
  return { coluna: col[0]?.v ?? "AUSENTE", check: ck[0]?.v ?? "AUSENTE" };
}

afterAll(async () => {
  // Fechar os pools ANTES de derrubar os bancos: um terminate num cliente
  // ocioso vira exceção não tratada e mancha uma suíte verde.
  await Promise.all(poolsAbertos.map((p) => p.end().catch(() => {})));
  await comAdmin(async (a) => {
    for (const nome of criados) {
      await a.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1`,
        [nome],
      );
      await a.query(`DROP DATABASE IF EXISTS "${nome}"`);
    }
  });
}, 300_000);

describe("cenário 1 — banco vazio, fila completa", () => {
  it("a coluna nasce na forma final, e um INSERT que esqueça o papel não fabrica admin", async () => {
    const b = await bancoNovo();
    expect((await runMigrations(b.url)).failure).toBeUndefined();

    expect(await formaDoPapel(b.pool)).toEqual({
      coluna: "text|NO|'OPERADOR'::text",
      check: "CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OPERADOR'::text])))",
    });

    // Banco vazio: o backfill não inventou ninguém.
    const { rows } = await b.pool.query(`SELECT count(*)::int AS n FROM "app_user"`);
    expect(rows[0].n).toBe(0);

    // Fail-closed: sem papel declarado, OPERADOR; papel inválido, recusado.
    await criarUsuario(b.pool, "sem-papel@x.com");
    expect(await papeis(b.pool)).toEqual({ "sem-papel@x.com": "OPERADOR" });
    await expect(criarUsuario(b.pool, "root@x.com", "ROOT")).rejects.toThrow(
      /app_user_role_ck/,
    );
  });
});

describe("cenário 2 — deploy sobre Production pré-0037, com gente dentro", () => {
  it("caminho normal (proposta recusada): o diff é aditivo, a fila aplica, o backfill acerta", async () => {
    const prod = await bancoNovo();
    await migradoAte(prod.pool, "0036_funcoes_restauraveis");
    for (const email of ["a@x.com", "b@x.com", "c@x.com"]) {
      await prod.pool.query(
        `INSERT INTO "app_user" ("name","email","password_hash","created_by")
         VALUES ($1,$1,'scrypt$original','fixture')`,
        [email],
      );
    }

    const dev = await bancoNovo();
    expect((await runMigrations(dev.url)).failure).toBeUndefined();

    /*
      O diff que o Publishing veria ANTES do deploy: só criação — a coluna, o
      CHECK e as tabelas do ambiente Fechamento — e nada de DROP nem ALTER. É o
      diff que a política "recuse a proposta, publique só build e start"
      atravessa sem risco: recusar deixa Production intacta e o servidor novo
      aplica a fila na partida.

      As tabelas são conferidas por conjunto e não por lista ordenada: a ordem
      em que o diff as devolve é a de leitura do catálogo, e prendê-la aqui
      transformaria uma reordenação inofensiva em teste vermelho.
    */
    const antes = await diffDoPublishing(dev.pool, prod.pool);
    expect(antes.drop).toEqual([]);
    expect(antes.alter).toEqual([]);
    expect(new Set(antes.addTable)).toEqual(
      new Set([
        "fechamento_competencia",
        "fechamento_documento",
        "fechamento_viagem",
        "fechamento_cte",
        "fechamento_requisicao",
        "fechamento_disponibilidade",
        "fechamento_conciliacao_item",
        "fechamento_apuracao",
        "fechamento_apuracao_verba",
        "fechamento_divergencia",
      ]),
    );
    /*
      As colunas aditivas, todas elas — e a lista é fechada de propósito.

      `app_user.role` é da `0037`; as duas de `import_run` são da `0040`, o
      reprocessamento: elas dizem qual leitura um run releu e por quê. As três
      são aditivas e nulas, que é o que faz este diff atravessável — o servidor
      novo aplica a fila na partida e Production as ganha lá.

      Prendê-las aqui é o ponto: uma coluna nova que apareça neste diff sem
      alguém ter vindo escrevê-la nesta linha é uma mudança de schema que
      ninguém avaliou contra a política de deploy.
    */
    expect(new Set(antes.addColumn)).toEqual(
      new Set([
        "app_user.role",
        "import_run.reprocess_of_run_id",
        "import_run.reprocess_reason",
      ]),
    );
    /*
      As constraints das tabelas novas — chave primária, estrangeira e CHECK —
      vêm junto, e são conferidas pela regra "pertencem a uma tabela do
      Fechamento" em vez de por uma lista de trinta e um nomes. A lista
      congelaria a nomenclatura interna de dez tabelas num teste que não fala
      sobre ela; o que este cenário precisa provar é que **nada além** do que as
      duas mudanças trazem aparece no diff.
    */
    expect(
      new Set(antes.addConstraint.filter((c) => !c.startsWith("fechamento_"))),
    ).toEqual(
      new Set([
        "app_user_role_ck",
        // As duas da `0040`. Aditivas como a de cima: o FK e o CHECK do
        // reprocessamento nascem sobre colunas que ninguém tinha preenchido, e
        // por isso não há linha em Production que elas possam recusar.
        "import_run_reprocess_of_fk",
        "import_run_reprocess_completo",
      ]),
    );

    // A partida do servidor novo: exatamente as migrations que faltavam.
    const report = await runMigrations(prod.url);
    expect(report.failure).toBeUndefined();
    expect(report.applied).toEqual([
      "0037_papeis",
      "0038_reconciliar_papeis",
      "0039_fechamento",
      "0040_reprocessamento",
      "0041_reconciliar_reprocessamento",
    ]);

    // Preservação + backfill: as três contas continuam com o hash original e
    // viram ADMIN — era o que todas já podiam fazer.
    const { rows } = await prod.pool.query(
      `SELECT email, role, password_hash, created_by FROM "app_user" ORDER BY email`,
    );
    expect(rows).toEqual([
      { email: "a@x.com", role: "ADMIN", password_hash: "scrypt$original", created_by: "fixture" },
      { email: "b@x.com", role: "ADMIN", password_hash: "scrypt$original", created_by: "fixture" },
      { email: "c@x.com", role: "ADMIN", password_hash: "scrypt$original", created_by: "fixture" },
    ]);

    // DEPOIS do deploy o diff é vazio: os dois bancos na mesma fila.
    const depois = await diffDoPublishing(dev.pool, prod.pool);
    expect(depois.addColumn).toEqual([]);
    expect(depois.addConstraint).toEqual([]);
    expect(depois.drop).toEqual([]);
    expect(depois.alter).toEqual([]);
  }, 120_000);

  it("caminho bridge (Production na réplica histórica): o down tira o papel do diff, a fila migra tudo, o up devolve Development inteiro", async () => {
    /*
      O bridge é ferramenta de UM baseline: a Production presa na `0012` com
      registro vazio, como medida em 15/08/2026 — é para esse estado que o
      `down` molda Development. Contra uma Production que já anda com a fila
      (cenário anterior), o bridge é a ferramenta errada e o caminho é o
      normal: proposta aditiva, recusada, fila na partida. Este caso prova que
      a 0037 atravessa o caminho-bridge sem vazar para o diff.
    */
    const prod = await bancoNovo();
    // A réplica histórica: schema até a 0012, SEM registro — como lá.
    for (const m of readMigrations()) {
      for (const comando of m.statements) await prod.pool.query(comando);
      if (m.tag === "0012_chamados") break;
    }
    await prod.pool.query(
      `INSERT INTO "app_user" ("name","email","password_hash") VALUES ('p','p@x.com','scrypt$p')`,
    );

    const dev = await bancoNovo();
    expect((await runMigrations(dev.url)).failure).toBeUndefined();
    // Development com uma conta e uma decisão de papel que o down vai levar —
    // e que o up precisa devolver ao estado pós-migration, nunca deixar sem.
    await criarUsuario(dev.pool, "dev@x.com", "ADMIN");

    const down = await bridgeDown(dev.url);
    expect(down.falha).toBeUndefined();

    /*
      Com o down, o papel saiu do diff INTEIRO: não está no que o Publishing
      criaria, nem no que removeria, nem no que alteraria. O resto do diff — a
      allowlist de seis ADD COLUMN nullable — é contrato do bridge e já é
      provado em bridge.test.ts; aqui a pergunta é só sobre a 0037.
    */
    const durante = await diffDoPublishing(dev.pool, prod.pool);
    const sobreOPapel = (linhas: string[]) =>
      linhas.filter((l) => l.includes("role") || l.includes("app_user_role_ck"));
    expect(sobreOPapel(durante.addColumn)).toEqual([]);
    expect(sobreOPapel(durante.addConstraint)).toEqual([]);
    expect(sobreOPapel(durante.drop)).toEqual([]);
    expect(sobreOPapel(durante.alter)).toEqual([]);

    /*
      O deploy: o servidor novo aplica a fila na partida. Registro vazio com o
      schema de pé é o caso já domado ("Um banco que tem o schema e não tem o
      registro"): a fila atravessa reentrante da 0000 e aplica de verdade o que
      falta — inclusive a 0037 e o backfill dela.
    */
    const report = await runMigrations(prod.url);
    expect(report.failure).toBeUndefined();
    expect(report.applied).toContain("0037_papeis");
    expect(report.applied).toContain("0038_reconciliar_papeis");
    expect(await formaDoPapel(prod.pool)).toEqual({
      coluna: "text|NO|'OPERADOR'::text",
      check: "CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OPERADOR'::text])))",
    });
    expect(await papeis(prod.pool)).toEqual({ "p@x.com": "ADMIN" });

    // O up: Development volta à forma canônica, com o backfill da sentinela —
    // a conta que existia volta ADMIN, nunca fica sem papel.
    const up = await bridgeUp(dev.url);
    expect(up.falha).toBeUndefined();
    expect(await formaDoPapel(dev.pool)).toEqual(await formaDoPapel(prod.pool));
    expect(await papeis(dev.pool)).toEqual({ "dev@x.com": "ADMIN" });

    // E depois do deploy nada do papel separa os dois bancos.
    const depois = await diffDoPublishing(dev.pool, prod.pool);
    expect(sobreOPapel(depois.addColumn)).toEqual([]);
    expect(sobreOPapel(depois.addConstraint)).toEqual([]);
    expect(sobreOPapel(depois.drop)).toEqual([]);
    expect(sobreOPapel(depois.alter)).toEqual([]);
  }, 240_000);
});

describe("cenário 3 — o estado híbrido: mutilação reposta pela reconvergência", () => {
  it("a estrutura volta byte a byte; a perda de conteúdo é dita e tem saída", async () => {
    const b = await bancoNovo();
    expect((await runMigrations(b.url)).failure).toBeUndefined();
    await criarUsuario(b.pool, "chefe@x.com", "ADMIN");
    await criarUsuario(b.pool, "op@x.com", "OPERADOR");

    // A mutilação que um Provision aceito produziria: a coluna some, e o CHECK
    // some junto (depende dela).
    await b.pool.query(`ALTER TABLE "app_user" DROP COLUMN "role"`);

    const relatorio = await reconvergirSchema(b.url);
    expect(relatorio.falhas).toEqual([]);
    expect(relatorio.semComando).toEqual([]);
    expect(relatorio.aplicados.map((a) => a.alvo)).toEqual(
      expect.arrayContaining(["coluna app_user.role", "constraint app_user_role_ck"]),
    );

    // Byte a byte: a forma restaurada é a de um banco criado do zero.
    const referencia = await bancoNovo();
    expect((await runMigrations(referencia.url)).failure).toBeUndefined();
    expect(await formaDoPapel(b.pool)).toEqual(await formaDoPapel(referencia.pool));

    /*
      A honestidade do reparo: a reconvergência repõe ESTRUTURA, nunca escreve
      linha — todo mundo volta OPERADOR (o default fail-closed), inclusive quem
      era ADMIN. É perda de conteúdo, e é dita em vez de remendada: o estado é
      coerente (o CHECK vale), o portão fica fechado para todos (nenhum falso
      admin), e a saída é a documentada. A estrutura volta SOZINHA no próximo
      boot (reconvergência) — nenhum passo manual. O conteúdo perdido se
      recupera pelo mecanismo versionado: restore do backup automático (B3,
      RPO ≤ 24h). Criar um ADMIN pelo terminal é break-glass extraordinário —
      para quando o backup também se perdeu — e nunca faz parte do
      procedimento de deploy. O INSERT abaixo só prova que o estado reparado
      ACEITA a recuperação (o CHECK e o backfill-sentinela não a bloqueiam),
      não que ela seja o caminho normal.
    */
    expect(await papeis(b.pool)).toEqual({
      "chefe@x.com": "OPERADOR",
      "op@x.com": "OPERADOR",
    });
    await criarUsuario(b.pool, "recuperacao@x.com", "ADMIN");
    expect((await papeis(b.pool))["recuperacao@x.com"]).toBe("ADMIN");
  }, 120_000);
});

describe("cenário 4 — a segunda passada não muda nada", () => {
  it("fila, reconvergência e os próprios statements da 0037 são inertes num banco em dia", async () => {
    const b = await bancoNovo();
    expect((await runMigrations(b.url)).failure).toBeUndefined();
    // Um banco vivido: um admin e um operador — o alvo clássico da escalada.
    await criarUsuario(b.pool, "chefe@x.com", "ADMIN");
    await criarUsuario(b.pool, "op@x.com", "OPERADOR");

    const segunda = await runMigrations(b.url);
    expect(segunda.failure).toBeUndefined();
    expect(segunda.applied).toEqual([]);

    const reparo = await reconvergirSchema(b.url);
    expect(reparo.aplicados).toEqual([]);
    expect(reparo.semComando).toEqual([]);
    expect(reparo.falhas).toEqual([]);

    /*
      O rerun bruto da 0037 (o cenário registro-perdido): a sentinela do
      backfill — "só quando não existe nenhum ADMIN" — é o que impede a
      reaplicação de promover operadores. Sem ela, todo rerun seria uma
      escalada de privilégio silenciosa.
    */
    const m37 = readMigrations().find((m) => m.tag === "0037_papeis")!;
    for (const comando of m37.statements) {
      if (comando.startsWith("COMMENT")) continue;
      await b.pool.query(comando);
    }
    expect(await papeis(b.pool)).toEqual({
      "chefe@x.com": "ADMIN",
      "op@x.com": "OPERADOR",
    });
  }, 120_000);
});
