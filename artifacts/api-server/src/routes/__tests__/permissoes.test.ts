import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import type { SessionUser } from "../../lib/session";

/**
 * Permissão por módulo, atravessada por HTTP.
 *
 * Três coisas são provadas aqui, e são as três que fazem a tela de Permissões
 * ser mais do que desenho:
 *
 * 1. **O padrão concede.** Uma conta sem nenhuma linha na tabela escreve como
 *    escrevia antes de a tabela existir. É a propriedade que impede a migration
 *    de virar apagão, e ela precisa de teste porque é fácil de perder num
 *    refactor que "fecha por padrão" achando que está endurecendo o sistema.
 * 2. **Tirar edição recusa escrita — no fio, com 403 e a frase certa.** Não
 *    basta a linha existir no banco: o portão tem de estar montado no caminho
 *    da requisição.
 * 3. **Os becos respondem 409.** Ninguém muda o próprio acesso, e ninguém tira
 *    Configurações de um administrador; as duas são a porta trancada por dentro.
 */

let ctx: TestDb;
let servidor: Server;
let base: string;

const CONTAS: Record<string, SessionUser> = {};

async function criarConta(email: string, role: string): Promise<SessionUser> {
  const { rows } = await ctx.pool.query<{ id: string }>(
    `INSERT INTO "app_user" ("name","email","password_hash","role")
     VALUES ($1,$1,'scrypt$x',$2) RETURNING id`,
    [email, role],
  );
  const user = { id: rows[0].id, name: email, email, role };
  CONTAS[email] = user;
  return user;
}

beforeAll(async () => {
  ctx = await createTestDatabase("permissoes");
  process.env.DATABASE_URL = ctx.url;

  await criarConta("chefe@x.com", "ADMIN");
  await criarConta("outro-chefe@x.com", "ADMIN");
  await criarConta("op@x.com", "OPERADOR");

  const { default: usersRouter } = await import("../users");
  const { portaoDePermissao } = await import(
    "../../middlewares/portao-de-permissao"
  );
  const { erroEmJson } = await import("../../middlewares/contrato-json");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      warn: () => {},
      info: () => {},
    };
    const quem = req.header("x-teste-como");
    if (quem && CONTAS[quem]) req.user = CONTAS[quem];
    next();
  });
  app.use(portaoDePermissao);
  app.use(usersRouter);
  /*
    Uma rota de escrita de outro módulo, montada aqui só para o portão ter o
    que recusar. `/imports` pertence a Importações no mapa de `lib/permissoes.ts`,
    e o que este teste mede é o portão — não o que a rota real faz depois dele.
  */
  app.post("/imports/qualquer", (_req, res) => {
    res.json({ passou: true });
  });
  app.use(erroEmJson);

  servidor = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const endereco = servidor.address();
  if (endereco === null || typeof endereco === "string") throw new Error("sem porta");
  base = `http://127.0.0.1:${endereco.port}`;
}, 120_000);

afterAll(async () => {
  await new Promise((r) => servidor?.close(r));
  const { encerrarPoolDoProcesso } = await import("@workspace/db");
  await encerrarPoolDoProcesso();
  await ctx?.drop();
});

const como = (email: string) => ({
  "Content-Type": "application/json",
  "x-teste-como": email,
});

async function definir(
  alvo: SessionUser,
  niveis: Record<string, string>,
  quem = "chefe@x.com",
): Promise<Response> {
  return fetch(`${base}/users/${alvo.id}/permissoes`, {
    method: "PUT",
    headers: como(quem),
    body: JSON.stringify({ niveis }),
  });
}

describe("o padrão é edição, e nenhuma conta nasce bloqueada", () => {
  it("sem linha na tabela, a escrita passa", async () => {
    const res = await fetch(`${base}/imports/qualquer`, {
      method: "POST",
      headers: como("op@x.com"),
      body: "{}",
    });
    expect(res.status).toBe(200);
  });

  it("a leitura de permissões devolve o mapa vazio — silêncio não é decisão", async () => {
    const res = await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
      headers: como("op@x.com"),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ permissoes: {}, historico: [] });
  });
});

describe("tirar edição recusa a escrita daquele módulo", () => {
  it("VISUALIZAR → 403 dizendo que é somente leitura", async () => {
    expect((await definir(CONTAS["op@x.com"], { "/importacoes": "VISUALIZAR" })).status).toBe(200);

    const res = await fetch(`${base}/imports/qualquer`, {
      method: "POST",
      headers: como("op@x.com"),
      body: "{}",
    });
    expect(res.status).toBe(403);
    const corpo = (await res.json()) as { error: string; modulo: string };
    expect(corpo.modulo).toBe("/importacoes");
    expect(corpo.error).toMatch(/somente leitura/i);
  });

  it("o módulo restrito não contamina os outros", async () => {
    const res = await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
      headers: como("op@x.com"),
    });
    const { permissoes } = (await res.json()) as {
      permissoes: Record<string, string>;
    };
    expect(permissoes).toEqual({ "/importacoes": "VISUALIZAR" });
  });

  it("voltar para EDITAR apaga a linha e devolve a escrita", async () => {
    expect((await definir(CONTAS["op@x.com"], { "/importacoes": "EDITAR" })).status).toBe(200);

    const res = await fetch(`${base}/imports/qualquer`, {
      method: "POST",
      headers: como("op@x.com"),
      body: "{}",
    });
    expect(res.status).toBe(200);

    const { rows } = await ctx.pool.query(
      `SELECT * FROM "permissao_de_modulo" WHERE "user_id" = $1`,
      [CONTAS["op@x.com"].id],
    );
    expect(rows).toHaveLength(0);
  });

  it("o histórico guarda as três decisões, com autor", async () => {
    const res = await fetch(`${base}/users/${CONTAS["op@x.com"].id}/permissoes`, {
      headers: como("chefe@x.com"),
    });
    const { historico } = (await res.json()) as {
      historico: Array<{ modulo: string; nivel: string; nivelAnterior: string | null; por: string }>;
    };
    expect(historico.map((h) => h.nivel)).toEqual(["EDITAR", "VISUALIZAR"]);
    expect(historico.every((h) => h.por === "chefe@x.com")).toBe(true);
    expect(historico.at(-1)?.nivelAnterior).toBeNull();
  });
});

describe("quem decide, e o que não se decide", () => {
  it("operador não mexe no acesso de ninguém → 403", async () => {
    const res = await definir(
      CONTAS["chefe@x.com"],
      { "/curadoria": "SEM_ACESSO" },
      "op@x.com",
    );
    expect(res.status).toBe(403);
  });

  it("ninguém muda o próprio acesso → 409", async () => {
    const res = await definir(
      CONTAS["chefe@x.com"],
      { "/curadoria": "SEM_ACESSO" },
      "chefe@x.com",
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/próprio acesso/i);
  });

  it("administrador não perde Configurações → 409", async () => {
    const res = await definir(CONTAS["outro-chefe@x.com"], {
      "/configuracoes": "SEM_ACESSO",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/Configurações/);
  });

  it("nível inventado → 400 dizendo os três que existem", async () => {
    const res = await definir(CONTAS["op@x.com"], { "/curadoria": "TALVEZ" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /EDITAR, VISUALIZAR ou SEM_ACESSO/,
    );
  });

  it("chave que não é endereço de menu → 400", async () => {
    const res = await definir(CONTAS["op@x.com"], { curadoria: "SEM_ACESSO" });
    expect(res.status).toBe(400);
  });
});
