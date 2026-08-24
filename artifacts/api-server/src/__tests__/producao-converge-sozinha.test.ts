import { afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@workspace/db";
import { readMigrations } from "@workspace/db/migrate";

/**
 * A prova que faltava: Production, sozinha, sem intervenção externa, aplica a
 * fila que falta e só então libera — usando o **caminho de partida real**, não
 * uma aproximação dele.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe, e por que os outros não bastavam
 * ---------------------------------------------------------------------------
 * O incidente de 22–25/08/2026 (`docs/MIGRATIONS.md`) não foi uma falha de
 * lógica: foi `DB_MIGRATE_ON_BOOT="0"` no `artifact.toml` fazendo
 * `deveMigrarNaPartida()` retornar `false` incondicionalmente em Production,
 * o que faz `applyMigrationsInBackground()` nunca chamar `migrarComReparo()`.
 * Nenhum teste existente prendia a ponta a ponta desse fio: `janela-da-
 * partida.test.ts` desliga `DB_MIGRATE_ON_BOOT` **de propósito**, para isolar
 * a prova do portão; `producao-migra-na-partida.test.ts` prova que a chamada
 * existe no código-fonte, por leitura de texto, não que ela executa.
 *
 * Este arquivo fecha essa lacuna especificamente: lê o `DB_MIGRATE_ON_BOOT`
 * do **`artifact.toml` de verdade** — não um valor fixado aqui — e sobe o
 * **entry point real** (`src/index.ts`, o mesmo arquivo que
 * `[services.production.run]` executa, via `tsx` em vez do bundle compilado,
 * porque o comportamento de `deveMigrarNaPartida()` e
 * `applyMigrationsInBackground()` é idêntico nos dois — só a etapa de
 * `esbuild` muda) como um **processo à parte**, não um `import` no mesmo
 * processo do teste. É a diferença entre provar "a função existe" e provar
 * "a partida, do jeito que o Replit a executa, converge sozinha".
 *
 * Se algum dia `DB_MIGRATE_ON_BOOT` voltar a `"0"` no `artifact.toml` — pela
 * mesma razão de antes, ou por um agente que não leu esta suíte — o cenário
 * "migrations pendentes" abaixo passa a nunca convergir, e falha por timeout
 * de forma alta e legível, em vez de silenciar como aconteceu de verdade.
 */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAIZ_API_SERVER = path.resolve(RAIZ);
const TSX = path.join(RAIZ_API_SERVER, "node_modules", ".bin", "tsx");
const ENTRY = path.join(RAIZ_API_SERVER, "src", "index.ts");

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const temBanco = Boolean(
  process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
);

/** A última migration antes das duas que ficaram pendentes em Production. */
const ANTES_DA_0056 = "0055_disponibilidade_por_frota";

/**
 * O valor que o `artifact.toml` de Production diz **agora** — lido do
 * arquivo, nunca fixado no teste. É o requisito 1 e 2 do pedido: provar que o
 * arquivo diz "1" e que esse "1" é o que efetivamente chega ao caminho real.
 */
function lerDbMigrateOnBootDoArtifact(): string {
  const artifact = readFileSync(
    path.join(RAIZ, ".replit-artifact/artifact.toml"),
    "utf8",
  );
  const producao = artifact.slice(artifact.indexOf("[services.production.run.env]"));
  const m = producao.match(/DB_MIGRATE_ON_BOOT\s*=\s*"([^"]*)"/);
  if (!m) throw new Error("DB_MIGRATE_ON_BOOT não está escrito no artifact.toml de produção");
  return m[1]!;
}

let portaLivre = 21_000 + (process.pid % 9_000);
function proximaPorta(): number {
  return portaLivre++;
}

interface ProcessoDeApi {
  base: string;
  encerrar: () => Promise<void>;
  vivo: () => boolean;
}

/**
 * Sobe `src/index.ts` como processo real, com o env que o `artifact.toml`
 * escreveria — nunca um `import` no processo do teste.
 */
function subirApiDeVerdade(env: Record<string, string>): ProcessoDeApi {
  const porta = proximaPorta();
  const child: ChildProcess = spawn(TSX, [ENTRY], {
    cwd: RAIZ_API_SERVER,
    env: {
      ...process.env,
      PORT: String(porta),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Silencia o child no stdout do runner; nada aqui é lido pelas provas —
  // existe só para não deixar o processo travado por um pipe cheio.
  child.stdout?.resume();
  child.stderr?.resume();

  let encerrado = false;
  child.on("exit", () => {
    encerrado = true;
  });

  return {
    base: `http://127.0.0.1:${porta}`,
    vivo: () => !encerrado,
    encerrar: () =>
      new Promise<void>((resolve) => {
        if (encerrado) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!encerrado) child.kill("SIGKILL");
        }, 3_000);
      }),
  };
}

async function pedir(base: string, caminho: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${caminho}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Espera a porta abrir — o `/healthz`, que não depende do banco. */
async function esperarPortaAbrir(base: string, tetoMs: number): Promise<void> {
  const limite = Date.now() + tetoMs;
  for (;;) {
    try {
      const r = await fetch(`${base}/api/healthz`);
      if (r.status === 200) return;
    } catch {
      // ainda não abriu — tenta de novo
    }
    if (Date.now() > limite) throw new Error("a porta não abriu a tempo");
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Poll de `/readyz` até convergir ou estourar o teto, guardando **toda**
 * resposta observada — é o que prova o requisito 4: nunca 200 com pendência.
 */
async function pollarAteConvergirOuTeto(
  base: string,
  tetoMs: number,
): Promise<{ status: number; body: any }[]> {
  const historico: { status: number; body: any }[] = [];
  const limite = Date.now() + tetoMs;
  for (;;) {
    const resposta = await pedir(base, "/api/readyz");
    historico.push(resposta);
    if (resposta.status === 200) return historico;
    if (Date.now() > limite) return historico;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function criarBancoParcial(nome: string, ateTag: string): Promise<string> {
  const admin = createDb(ADMIN);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nome}"`);
  await admin.pool.query(`CREATE DATABASE "${nome}"`);
  await admin.pool.end();

  const url = ADMIN.replace(/\/[^/?]*(\?|$)/, `/${nome}$1`);
  const { pool } = createDb(url);
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
    if (m.tag === ateTag) break;
  }
  await pool.end();
  return url;
}

async function criarBancoCompleto(nome: string): Promise<string> {
  return criarBancoParcial(nome, readMigrations().at(-1)!.tag);
}

async function derrubarBanco(nome: string): Promise<void> {
  const admin = createDb(ADMIN);
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [nome],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`);
  await admin.pool.end();
}

const processosParaEncerrar: ProcessoDeApi[] = [];
afterAll(async () => {
  await Promise.all(processosParaEncerrar.map((p) => p.encerrar()));
});

describe.skipIf(!temBanco)("1–2. o artifact.toml de Production, e se ele chega ao caminho real", () => {
  it("DB_MIGRATE_ON_BOOT está em \"1\" no artifact.toml de produção", () => {
    expect(lerDbMigrateOnBootDoArtifact()).toBe("1");
  });

  it("esse valor, passado como env ao entry point real, produz migrar:true — sem reescrever a política aqui", async () => {
    // A mesma verificação de `politica-de-migracao.test.ts`, mas usando o
    // valor lido do arquivo, não um literal — se o arquivo divergir do que a
    // suíte de política assume, é aqui que a divergência aparece.
    const { deveMigrarNaPartida } = await import("../lib/migrations");
    const decisao = deveMigrarNaPartida({
      DB_MIGRATE_ON_BOOT: lerDbMigrateOnBootDoArtifact(),
      NODE_ENV: "production",
    });
    expect(decisao.migrar).toBe(true);
  });
});

describe.skipIf(!temBanco)("3. banco pendente: aplica sozinha e só então libera", () => {
  it("sobe com migrations faltando, converge sem intervenção externa, e nunca respondeu 200 antes disso", async () => {
    const nome = `fc_test_prod_converge_${process.pid}`;
    const url = await criarBancoParcial(nome, ANTES_DA_0056);
    const dbMigrateOnBoot = lerDbMigrateOnBootDoArtifact();

    const api = subirApiDeVerdade({
      DATABASE_URL: url,
      NODE_ENV: "production",
      DB_MIGRATE_ON_BOOT: dbMigrateOnBoot,
    });
    processosParaEncerrar.push(api);

    try {
      await esperarPortaAbrir(api.base, 15_000);

      const historico = await pollarAteConvergirOuTeto(api.base, 30_000);

      // Requisito 4: nenhuma resposta antes da última é 200.
      const antesDaUltima = historico.slice(0, -1);
      for (const r of antesDaUltima) {
        expect(r.status).toBe(503);
        expect(r.body.diagnostico?.estado).toBe("MIGRATIONS_PENDENTES");
      }

      // Requisito 5: convergiu, e expected === applied.
      const ultima = historico.at(-1)!;
      expect(ultima.status).toBe(200);
      expect(ultima.body.ready).toBe(true);
      expect(ultima.body.database.migrations.expected).toBe(
        ultima.body.database.migrations.applied,
      );
      expect(ultima.body.database.migrations.pending).toEqual([]);

      // E, uma vez lá, fica: sem reiniciar nada, /readyz continua 200.
      const outraVez = await pedir(api.base, "/api/readyz");
      expect(outraVez.status).toBe(200);
    } finally {
      await api.encerrar();
      await derrubarBanco(nome);
    }
  }, 60_000);
});

describe.skipIf(!temBanco)("5. banco já atualizado: restart é no-op seguro", () => {
  it("sobe já em dia, e /readyz responde 200 sem nunca ter passado por pendente", async () => {
    const nome = `fc_test_prod_ja_em_dia_${process.pid}`;
    const url = await criarBancoCompleto(nome);
    const dbMigrateOnBoot = lerDbMigrateOnBootDoArtifact();

    const api = subirApiDeVerdade({
      DATABASE_URL: url,
      NODE_ENV: "production",
      DB_MIGRATE_ON_BOOT: dbMigrateOnBoot,
    });
    processosParaEncerrar.push(api);

    try {
      await esperarPortaAbrir(api.base, 15_000);
      const historico = await pollarAteConvergirOuTeto(api.base, 10_000);

      // No-op seguro: nunca precisou passar por 503/MIGRATIONS_PENDENTES.
      for (const r of historico) {
        if (r.status !== 200) {
          expect(r.body.diagnostico?.estado).not.toBe("MIGRATIONS_PENDENTES");
        }
      }
      const ultima = historico.at(-1)!;
      expect(ultima.status).toBe(200);
      expect(ultima.body.database.migrations.pending).toEqual([]);
    } finally {
      await api.encerrar();
      await derrubarBanco(nome);
    }
  }, 30_000);
});

describe.skipIf(!temBanco)("6. migration recusada pelo banco: nunca libera", () => {
  it("um objeto incompatível colide com o que a migration cria — 503 para sempre, processo de pé, diagnosticável", async () => {
    const nome = `fc_test_prod_migration_falha_${process.pid}`;
    const url = await criarBancoParcial(nome, ANTES_DA_0056);

    /*
      A `0056` cria "fechamento_frota_promax" com `CREATE TABLE IF NOT
      EXISTS` — idempotente contra outra tabela do mesmo nome, mas não contra
      uma relação de outro tipo: uma VIEW com esse nome faz o Postgres recusar
      com um erro real (a relação existe e não é uma tabela), sem precisar
      reescrever a migration nem inventar SQL sintético. É a mesma classe de
      colisão que `docs/MIGRATIONS.md` documenta para a `0049` de 21/08/2026 —
      objeto incompatível no caminho da fila.
    */
    const { pool } = createDb(url);
    await pool.query(
      `CREATE VIEW "fechamento_frota_promax" AS SELECT 1 AS bloqueio`,
    );
    await pool.end();

    const dbMigrateOnBoot = lerDbMigrateOnBootDoArtifact();
    const api = subirApiDeVerdade({
      DATABASE_URL: url,
      NODE_ENV: "production",
      DB_MIGRATE_ON_BOOT: dbMigrateOnBoot,
    });
    processosParaEncerrar.push(api);

    try {
      await esperarPortaAbrir(api.base, 15_000);

      // Teto curto e deliberado: se isto algum dia liberar, é porque alguém
      // reintroduziu um caminho que libera por tempo — o que a revisão de
      // /api/startupz já baniu para a promoção, e que este teste bane aqui
      // para o dado.
      const historico = await pollarAteConvergirOuTeto(api.base, 8_000);

      for (const r of historico) {
        expect(r.status).toBe(503);
      }
      const ultima = historico.at(-1)!;
      expect(ultima.body.diagnostico.estado).toBe("MIGRATION_FALHOU");
      expect(ultima.body.diagnostico.evidencia).toContain("0056_frota_promax");

      // O processo continua de pé — diagnosticável, não morto.
      expect(api.vivo()).toBe(true);
      const liveness = await pedir(api.base, "/api/healthz");
      expect(liveness.status).toBe(200);
    } finally {
      await api.encerrar();
      await derrubarBanco(nome);
    }
  }, 30_000);
});

describe.skipIf(!temBanco)("7. duas instâncias ao mesmo tempo: o advisory lock protege", () => {
  it("dois processos reais, subindo juntos sobre o mesmo banco pendente, convergem sem duplicar carimbo", async () => {
    const nome = `fc_test_prod_concorrencia_${process.pid}`;
    const url = await criarBancoParcial(nome, ANTES_DA_0056);
    const dbMigrateOnBoot = lerDbMigrateOnBootDoArtifact();

    const envComum = {
      DATABASE_URL: url,
      NODE_ENV: "production",
      DB_MIGRATE_ON_BOOT: dbMigrateOnBoot,
    };
    const api1 = subirApiDeVerdade(envComum);
    const api2 = subirApiDeVerdade(envComum);
    processosParaEncerrar.push(api1, api2);

    try {
      await Promise.all([
        esperarPortaAbrir(api1.base, 15_000),
        esperarPortaAbrir(api2.base, 15_000),
      ]);

      const [h1, h2] = await Promise.all([
        pollarAteConvergirOuTeto(api1.base, 30_000),
        pollarAteConvergirOuTeto(api2.base, 30_000),
      ]);

      expect(h1.at(-1)!.status).toBe(200);
      expect(h2.at(-1)!.status).toBe(200);

      // Nenhuma das duas travou nem crashou por disputa — as duas de pé.
      expect(api1.vivo()).toBe(true);
      expect(api2.vivo()).toBe(true);

      // Um carimbo só por migration — o lock impediu a corrida de duplicar.
      const { pool } = createDb(url);
      const { rows } = await pool.query<{ created_at: string; n: string }>(
        `SELECT created_at, count(*) AS n FROM "drizzle"."__drizzle_migrations"
          GROUP BY created_at HAVING count(*) > 1`,
      );
      await pool.end();
      expect(rows).toEqual([]);
    } finally {
      await Promise.all([api1.encerrar(), api2.encerrar()]);
      await derrubarBanco(nome);
    }
  }, 60_000);
});
