import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createDb, encerrarPoolDoProcesso } from "@workspace/db";
import { readMigrations, runMigrations } from "@workspace/db/migrate";

/**
 * A janela entre o `listen` e a convergência — reproduzida, e fechada.
 *
 * ---------------------------------------------------------------------------
 * A sequência que produziu o incidente de 22/08/2026
 * ---------------------------------------------------------------------------
 *   1. O build novo sobe. `app.listen()` acontece **antes** da fila: tem de
 *      acontecer, senão o startup probe do autoscale desiste e a publicação
 *      falha (ver `index.ts`).
 *   2. O roteador passa a encaminhar `/api/*` para esse processo.
 *   3. `applyMigrationsInBackground()` só então começa.
 *   4. Entre 2 e 3, a tela nova — com as duas casinhas do 03.08.18 — conversa
 *      com um banco cujo `check` de `fechamento_documento.tipo` ainda é o de
 *      antes da `0055`. O arquivo perfeito vira "o servidor falhou".
 *
 * A `0055` não é a causa: ela foi a primeira migration a mudar contrato de
 * banco depois que a janela existia. Qualquer próxima faria igual.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo prova
 * ---------------------------------------------------------------------------
 * Com o **app de verdade** montado sobre um banco parado na `0054` — a mesma
 * fila real, com registro, do ambiente daquele dia:
 *
 *   A. nenhuma requisição de produto atravessa a janela, e o banco continua
 *      literalmente vazio depois delas;
 *   B. o portão recusa **antes** da sessão — o que sobreviveria a uma reordem
 *      acidental de middleware;
 *   C. o `/auth/login` também é recusado, e **não** com a frase de credencial:
 *      quem tem a senha certa não pode ser informado de que ela está errada
 *      porque o banco está atrasado;
 *   D. o que serve para diagnosticar o próprio portão continua respondendo — o
 *      `/healthz` para onde o startup probe aponta, que não toca no banco, e o
 *      `/readyz`, que responde 503 com o diagnóstico inteiro;
 *   E. aplicada a `0055`, a prontidão fica verde **sem reiniciar**;
 *   F. o login passa a funcionar, com a mesma senha que foi recusada antes;
 *   G. e aí, e só aí, o 03.08.18 sobe e grava.
 *
 * A prova de que o 503 por rota continua de pé para o banco atrasado que não é
 * este processo — drift, outra instância — está em
 * `routes/__tests__/fechamento-fila-atrasada.test.ts`, e é a segunda linha.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const temBanco = Boolean(
  process.env.TEST_ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
);

/** A última migration antes da que separa o 03.08.18 por frota. */
const ANTES_DA_0055 = "0054_regra_de_alteracao";

const NOME = `fc_test_janela_${process.pid}`;

/** A senha de quem opera neste teste — a mesma antes e depois da fila. */
const SENHA = "quinzena-de-julho-2026";

let url: string;
let servidor: Server;
let base: string;
let poolDoTeste: ReturnType<typeof createDb>["pool"];
let cookie: string;

/** O 03.08.18 mínimo que o leitor aceita, da frota que a casinha declara. */
function disponibilidadeDe(frota: "FF" | "Van"): Buffer {
  const linhas = [
    ["Data", "Canal", "Contratada", "Desconto Total", "Tipo Frota"],
    ["16/07/2026", "Rota", "8", "300,00", frota],
  ];
  return Buffer.from(linhas.map((l) => l.join(";")).join("\r\n"), "latin1");
}

interface Resposta {
  status: number;
  body: any;
  retryAfter: string | null;
}

async function pedir(caminho: string, init?: RequestInit): Promise<Resposta> {
  const res = await fetch(`${base}${caminho}`, init);
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    retryAfter: res.headers.get("retry-after"),
  };
}

/** Com sessão — o cabeçalho que o navegador manda depois do login. */
const autenticado = (corpo: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify(corpo),
});

async function contar(tabela: string): Promise<number> {
  const { pool } = createDb(url);
  try {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${tabela}"`,
    );
    return Number(rows[0]!.n);
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  if (!temBanco) return;

  const admin = createDb(ADMIN);
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.pool.query(`CREATE DATABASE "${NOME}"`);
  await admin.pool.end();

  url = ADMIN.replace(/\/[^/?]*(\?|$)/, `/${NOME}$1`);

  /*
    A fila **com registro**, parada na `0054`: o estado de uma Production real
    que ainda não recebeu a última migration — schema e carimbos coerentes.
    Sem registro seria outro diagnóstico (`REGISTRO_PERDIDO`), e não é o que
    aconteceu.
  */
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
    if (m.tag === ANTES_DA_0055) break;
  }
  await pool.end();

  /*
    A partir daqui é o processo de verdade: `DATABASE_URL` apontando para o
    banco atrasado, e o `app` importado depois disso — como na partida.

    `DB_MIGRATE_ON_BOOT` fica desligado de propósito. Este arquivo prova o
    **portão**, e um processo que migrasse sozinho fecharia a janela antes de
    ela poder ser medida. O ambiente que ele reproduz é o de uma instância que
    sobe enquanto outra ainda está aplicando a fila — que é exatamente quando o
    portão precisa segurar.
  */
  process.env.DATABASE_URL = url;
  process.env.DB_MIGRATE_ON_BOOT = "0";

  const { default: app } = await import("../app");
  ({ pool: poolDoTeste } = createDb(url));

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (typeof endereco === "string" || endereco === null)
    throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;

  /*
    Uma sessão de verdade, aberta pela lib e não pela rota: enquanto o portão
    está fechado nem o login passa — e é isso que se quer. O que se exercita
    depois da convergência é a rota de produto com quem opera autenticado, e
    não a recusa por falta de sessão.
  */
  const { hashPassword } = await import("../lib/auth");
  const { rows } = await poolDoTeste.query<{ id: string }>(
    `INSERT INTO "app_user" ("name","email","password_hash","role")
     VALUES ('Guy','guy@freightcheck',$1,'OPERADOR') RETURNING id`,
    /*
      Um hash de verdade, e não um carimbo: metade deste arquivo passou a
      exercitar o `/auth/login` — recusado com a fila atrasada, aceito depois
      dela —, e um hash falso faria as duas respostas serem 401 pelo motivo
      errado.
    */
    [await hashPassword(SENHA)],
  );
  /*
    A linha da sessão entra por SQL, e não por `startSession`, e a razão é a
    própria premissa deste arquivo: o banco está parado antes da última
    migration, **de propósito**, e um INSERT do Drizzle fala sempre o schema do
    código — ele enumera toda coluna da tabela, inclusive a que a migration que
    falta ainda não criou. Pedir isso a este banco seria exigir dele exatamente
    o que o portão de prontidão existe para não deixar acontecer em produção, e
    o teste morreria no fixture em vez de medir o portão.

    O token continua real: `newSessionToken` e `hashSessionToken` são as mesmas
    funções que `startSession` usa, e é o hash delas que a sessão vai resolver
    depois da convergência.
  */
  const { newSessionToken, hashSessionToken } = await import("../lib/auth");
  const token = newSessionToken();
  await poolDoTeste.query(
    `INSERT INTO "user_session" ("user_id","token_hash","expires_at")
     VALUES ($1,$2, now() + interval '7 days')`,
    [rows[0]!.id, hashSessionToken(token)],
  );
  cookie = `freightcheck_session=${token}`;
}, 300_000);

afterAll(async () => {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }
  await poolDoTeste?.end().catch(() => {});
  await encerrarPoolDoProcesso().catch(() => {});
  if (!temBanco) return;
  const admin = createDb(ADMIN);
  await admin.pool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [NOME],
  );
  await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME}" WITH (FORCE)`);
  await admin.pool.end();
});

describe.skipIf(!temBanco)("a janela da partida, com o app de verdade", () => {
  /* ---------------------------------------------------------------- A e B */

  it("nenhuma rota de produto é executada — e o portão recusa antes da sessão", async () => {
    /*
      Sem sessão, de propósito. Se o portão estivesse montado depois de
      `requireSession`, esta chamada voltaria 401 — e um 401 significa que a
      sessão **já foi lida do banco**, isto é, que uma consulta atravessou a
      janela. O 503 é a prova de que nada foi lido.
    */
    const semSessao = await pedir("/api/fechamento/competencias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ano: 2026, mes: 7, quinzena: 1 }),
    });

    expect(semSessao.status).toBe(503);
    expect(semSessao.body.code).toBe("SERVICO_NAO_PRONTO");
    expect(semSessao.status).not.toBe(401);
    /* Um cliente que respeita o cabeçalho volta sozinho quando a fila terminar. */
    expect(semSessao.retryAfter).toBe("5");
  });

  it("com sessão válida também não passa — o portão não é autenticação", async () => {
    const { status, body } = await pedir(
      "/api/fechamento/competencias",
      autenticado({
        ano: 2026,
        mes: 7,
        quinzena: 1,
        unidade: { codigo: "081-0443", nome: "CRBS SA - CDD Belem" },
        transportadora: { codigo: "36", nome: "HORIZONTE LOGISTICA LTDA" },
        tipoDeOperacao: "PROPRIA",
      }),
    );

    expect(status).toBe(503);
    expect(body.code).toBe("SERVICO_NAO_PRONTO");
    /* O diagnóstico é o do `/healthz` — a mesma autoridade, e ela nomeia a
       migration que falta e o comando que a aplica. */
    expect(body.diagnostico.estado).toBe("MIGRATIONS_PENDENTES");
    expect(body.diagnostico.acao.comando).toMatch(/run migrate/);
    expect(body.contexto).toMatch(/nada foi gravado/i);
  });

  /* ------------------------------------------------------------------- C */

  it("o login é recusado — e não pela senha, que está certa", async () => {
    /*
      **A tela de entrada é rota de produto, e é a que mais importa aqui.** Ela
      lê o banco (`app_user`, `session`) exatamente como qualquer outra, e uma
      leitura dentro desta janela é uma leitura sob contrato divergente.

      O que este teste fixa é o que a pessoa **não** pode receber: a frase de
      credencial. Quem digitou a senha certa e ouve "e-mail ou senha
      incorretos" conclui que perdeu o acesso, troca a senha, abre chamado — e
      nada disso tem a ver com o que houve. A resposta é 503 com o diagnóstico
      do ambiente, e o `Retry-After` que faz o cliente voltar sozinho.
    */
    const { status, body, retryAfter } = await pedir("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "guy@freightcheck", password: SENHA }),
    });

    expect(status).toBe(503);
    expect(status).not.toBe(401);
    expect(status).not.toBe(500);
    expect(body.code).toBe("SERVICO_NAO_PRONTO");
    expect(body.diagnostico.estado).toBe("MIGRATIONS_PENDENTES");
    expect(retryAfter).toBe("5");
    expect(JSON.stringify(body)).not.toMatch(/senha incorret/i);
    /* E a frase principal não manda ninguém abrir endpoint técnico nenhum. */
    expect(body.diagnostico.humano).not.toMatch(/healthz|readyz|\/api\//);
    expect(body.diagnostico.humano).not.toMatch(/migration|pnpm|SQLSTATE/i);
  });

  it("a senha errada, dentro da janela, recebe a mesma resposta do ambiente", async () => {
    /*
      E não a de credencial — que seria verdadeira por acidente. O portão
      recusa antes de qualquer leitura, então o servidor **não sabe** se a
      senha confere: afirmar que não confere seria inventar um fato que ninguém
      apurou.
    */
    const { status, body } = await pedir("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "guy@freightcheck", password: "errada" }),
    });

    expect(status).toBe(503);
    expect(body.code).toBe("SERVICO_NAO_PRONTO");
  });

  it("o banco continua vazio depois das tentativas — a janela ficou intocada", async () => {
    /*
      A afirmação forte, e a razão de este arquivo existir: não é que a
      resposta ficou mais bonita — é que **nada aconteceu**. Nenhuma
      competência aberta, nenhum documento gravado, nenhuma linha.
    */
    await pedir(
      "/api/fechamento/competencias/00000000-0000-0000-0000-000000000000/documentos",
      autenticado({
        tipo: "DISPONIBILIDADE_FF",
        filename: "03.08.18_FF.csv",
        contentBase64: disponibilidadeDe("FF").toString("base64"),
      }),
    );

    expect(await contar("fechamento_competencia")).toBe(0);
    expect(await contar("fechamento_documento")).toBe(0);
  });

  /* ------------------------------------------------------------------- D */

  it("o startup probe continua passando — e o liveness não fala do banco", async () => {
    const health = await pedir("/api/healthz");

    /* 200: o deployment precisa subir para poder ser diagnosticado. */
    expect(health.status).toBe(200);
    expect(health.body.status).toBe("ok");
    /*
      E nada além disso. Enquanto o `/healthz` respondia o estado do banco, ele
      virou o endereço que a interface mandava a pessoa abrir — "confira
      /api/healthz" na tela de login. Liveness aqui, readiness em `/readyz`.
    */
    expect(health.body.database).toBeUndefined();
    expect(health.body.ready).toBeUndefined();
  });

  it("a prontidão responde 503 com o diagnóstico inteiro", async () => {
    const ready = await pedir("/api/readyz");

    expect(ready.status).toBe(503);
    expect(ready.body.ready).toBe(false);
    expect(ready.retryAfter).toBe("5");
    expect(ready.body.diagnostico.estado).toBe("MIGRATIONS_PENDENTES");
    /* O detalhe técnico continua existindo, e é aqui que ele mora. */
    expect(ready.body.database.migrations.pending).toContain(
      "0055_disponibilidade_por_frota",
    );
  });

  it("o que diagnostica o próprio portão atravessa o portão fechado", async () => {
    /* As quatro que o deployer e quem opera precisam, e nenhuma lê produto. */
    expect((await pedir("/api/build")).status).toBe(200);
    expect((await pedir("/api")).status).toBe(200);
  });

  /* ----------------------------------------------------------- E, F and G */

  it("aplicada a 0055, o serviço fica pronto sem reiniciar", async () => {
    /*
      Ninguém reinicia nada aqui — é o mesmo processo, com o mesmo `app`, o
      mesmo servidor e a mesma porta. A prontidão é **medida**, não declarada
      na partida: por isso ela acompanha o banco assim que ele converge, tenha
      sido este processo, outra instância ou uma pessoa a aplicar a fila.
    */
    expect((await runMigrations(url)).failure).toBeUndefined();

    const ready = await pedir("/api/readyz");
    expect(ready.status).toBe(200);
    expect(ready.body.ready).toBe(true);
    expect(ready.body.diagnostico.estado).toBe("SAUDAVEL");
    expect(ready.body.database.migrations.pending).toEqual([]);
  });

  it("e o login funciona — com a mesma senha que foi recusada antes", async () => {
    /*
      **O fecho do que a pessoa vive.** A mesma credencial, o mesmo processo, a
      mesma porta: o que mudou foi o banco convergir. Nenhum reinício, nenhuma
      nova sessão de deploy — a prontidão é medida, e a primeira chamada depois
      da fila já atravessa.
    */
    const entrou = await pedir("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "guy@freightcheck", password: SENHA }),
    });

    expect(entrou.status).toBe(200);
    expect(entrou.body.user.email).toBe("guy@freightcheck");
  });

  it("e a senha errada volta a ser senha errada — 401, e não 503", async () => {
    /* A distinção que a janela apagava: com o ambiente pronto, credencial
       errada é credencial errada, e a frase é a dela. */
    const recusado = await pedir("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "guy@freightcheck", password: "errada" }),
    });

    expect(recusado.status).toBe(401);
    expect(recusado.body.error).toMatch(/senha incorretos/i);
    expect(recusado.body.diagnostico).toBeUndefined();
  });

  it("e aí o 03.08.18 sobe e grava — as duas casinhas", async () => {
    const abrir = await pedir(
      "/api/fechamento/competencias",
      autenticado({
        ano: 2026,
        mes: 7,
        quinzena: 1,
        unidade: { codigo: "081-0443", nome: "CRBS SA - CDD Belem" },
        transportadora: { codigo: "36", nome: "HORIZONTE LOGISTICA LTDA" },
        tipoDeOperacao: "PROPRIA",
      }),
    );
    expect(abrir.status).toBe(201);

    for (const [tipo, frota] of [
      ["DISPONIBILIDADE_FF", "FF"],
      ["DISPONIBILIDADE_VAN", "Van"],
    ] as const) {
      const enviado = await pedir(
        `/api/fechamento/competencias/${abrir.body.id}/documentos`,
        autenticado({
          tipo,
          filename: `03.08.18_${frota}.csv`,
          contentBase64: disponibilidadeDe(frota).toString("base64"),
        }),
      );

      expect(enviado.status, `${tipo}: ${JSON.stringify(enviado.body)}`).toBe(
        201,
      );
      expect(enviado.body.desfecho).toBe("PROMOVIDO");
      expect(enviado.body.linhasLidas).toBe(1);
    }

    expect(await contar("fechamento_documento")).toBe(2);
    expect(await contar("fechamento_disponibilidade")).toBe(2);
  });
});
